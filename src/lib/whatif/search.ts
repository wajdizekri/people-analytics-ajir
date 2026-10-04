import type Database from "better-sqlite3";
import { computeMonth, type FeatureVector } from "../features/compute";
import { predict, type LoadedModel, type RiskLevel } from "../scoring";
import {
  LEVER_LIMITS,
  NO_LEVERS,
  WhatIfError,
  applyLevers,
  forkDataset,
  loadSimulationBase,
  place,
  simulateFrom,
  type Levers,
  type Placement,
  type SimulationBase,
  type SimulationOptions,
  type WhatIfResult,
} from "./index";

// Recherche des plus petites combinaisons de leviers qui font passer le niveau de risque sous le niveau actuel,
// avec le modèle du calcul publié et les seuils en vigueur. Méthode, coût et limites : docs/RESULTATS_IA_LEVIER.md.

export const LEVER_STEPS = { salaryPct: 2.5, overtimeCutH: 10, trainingHours: 20 } as const;
// Une promotion pèse autant qu'un levier poussé à sa limite
export const PROMOTION_EFFORT = 1;
export const MAX_PROPOSALS = 3;
// Vérifications exactes au plus (une par piste, plus une marge si la composition et le recalcul complet divergeaient)
const MAX_CHECKS = 2 * MAX_PROPOSALS;
const EPS = 1e-9;

export const LEVEL_RANK: Record<RiskLevel, number> = { FAIBLE: 0, MOYEN: 1, ELEVE: 2 };
export const NO_COMBINATION_MESSAGE = "Aucune combinaison dans les limites de la simulation ne fait baisser le niveau ; voir les facteurs associés.";
export const ALREADY_LOW_MESSAGE = "Le niveau de risque est déjà Faible : aucune piste à rechercher.";

const range = (step: number, max: number) => Array.from({ length: Math.floor(max / step + EPS) + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
export const LEVER_VALUES = {
  salaryPct: range(LEVER_STEPS.salaryPct, LEVER_LIMITS.salaryPct),
  overtimeCutH: range(LEVER_STEPS.overtimeCutH, LEVER_LIMITS.overtimeCutH),
  trainingHours: range(LEVER_STEPS.trainingHours, LEVER_LIMITS.trainingHours),
};

export type LeverSearchStatus = "TROUVE" | "AUCUNE" | "DEJA_FAIBLE";
export type LeverProposal = { levers: Levers; effort: number; result: WhatIfResult };
export type LeverSearchStats = { combos: number; evaluated: number; pruned: number; engineRuns: number; ms: number };
export type LeverSearchResult = {
  asOf: string;
  before: Placement;
  status: LeverSearchStatus;
  proposals: LeverProposal[];
  stats: LeverSearchStats;
  notes: string[];
};

// Coût normalisé : part de la borne utilisée pour chaque levier continu, plus PROMOTION_EFFORT pour une promotion
export function leverEffort(l: Levers): number {
  return (
    l.salaryPct / LEVER_LIMITS.salaryPct +
    l.overtimeCutH / LEVER_LIMITS.overtimeCutH +
    l.trainingHours / LEVER_LIMITS.trainingHours +
    (l.promotion ? PROMOTION_EFFORT : 0)
  );
}

export const leversUsed = (l: Levers) => (l.salaryPct > 0 ? 1 : 0) + (l.overtimeCutH > 0 ? 1 : 0) + (l.trainingHours > 0 ? 1 : 0) + (l.promotion ? 1 : 0);

export const sameLevers = (a: Levers, b: Levers) =>
  a.salaryPct === b.salaryPct && a.overtimeCutH === b.overtimeCutH && a.trainingHours === b.trainingHours && a.promotion === b.promotion;

// a domine b : b utilise chaque levier au moins autant que a ; si a suffit, b n'apporte qu'un surcoût
export function dominates(a: Levers, b: Levers): boolean {
  return a.salaryPct <= b.salaryPct && a.overtimeCutH <= b.overtimeCutH && a.trainingHours <= b.trainingHours && (!a.promotion || b.promotion) && !sameLevers(a, b);
}

// Effort croissant, puis moins de leviers, puis moins de salaire ; ordre total et déterministe
export function compareLevers(a: Levers, b: Levers): number {
  const d = leverEffort(a) - leverEffort(b);
  if (Math.abs(d) > EPS) return d;
  return (
    leversUsed(a) - leversUsed(b) ||
    a.salaryPct - b.salaryPct ||
    Number(a.promotion) - Number(b.promotion) ||
    a.overtimeCutH - b.overtimeCutH ||
    a.trainingHours - b.trainingHours
  );
}

export function leverGrid(allowed: { salary: boolean; promotion: boolean } = { salary: true, promotion: true }): Levers[] {
  const out: Levers[] = [];
  for (const promotion of allowed.promotion ? [false, true] : [false])
    for (const salaryPct of allowed.salary ? LEVER_VALUES.salaryPct : [0])
      for (const overtimeCutH of LEVER_VALUES.overtimeCutH)
        for (const trainingHours of LEVER_VALUES.trainingHours) {
          const l = { salaryPct, overtimeCutH, trainingHours, promotion };
          if (leversUsed(l) > 0) out.push(l);
        }
  return out.sort(compareLevers);
}

// Grille triée par effort croissant : la première combinaison qui suffit est la plus petite ; une combinaison qui
// contient une piste déjà retenue (dominée) est écartée sans calcul. Résultat : les `max` plus petites pistes non dominées.
export function pickMinimal(grid: Levers[], succeeds: (l: Levers) => boolean, max = MAX_PROPOSALS) {
  const picked: Levers[] = [];
  let evaluated = 0;
  let pruned = 0;
  for (const l of grid) {
    if (picked.length >= max) break;
    if (picked.some((p) => dominates(p, l))) {
      pruned++;
      continue;
    }
    evaluated++;
    if (succeeds(l)) picked.push(l);
  }
  return { picked, evaluated, pruned };
}

// Équivalent exact de place() (rankAndLevel) pour une population fixe : scores des autres salariés calculés une fois,
// position par recherche dichotomique, même départage, même somme pour la moyenne (même ordre d'addition).
export function makePlacer(model: LoadedModel, population: FeatureVector[], employeeId: number, capacityRate: number, mediumLift: number) {
  const pop = population.map((r) => ({ id: r.employeeId, score: predict(model, r.values) })).sort((a, b) => b.score - a.score || a.id - b.id);
  const scores = pop.map((p) => p.score);
  const prefix = new Float64Array(scores.length + 1);
  for (let j = 0; j < scores.length; j++) prefix[j + 1] = prefix[j] + scores[j];
  const n = scores.length + 1;
  const k = Math.max(1, Math.floor(n * capacityRate + 1e-9));
  const b0 = model.kind === "B0";
  return (values: number[]): Placement => {
    const s = predict(model, values);
    let lo = 0;
    let hi = pop.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((s - pop[mid].score || pop[mid].id - employeeId) < 0) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    let sum = prefix[i] + s;
    for (let j = i; j < scores.length; j++) sum += scores[j];
    const mean = sum / n;
    const firstExcluded = k < n ? (i < k ? scores[k - 1] : i === k ? s : scores[k]) : -Infinity;
    const lift = mean > 0 ? s / mean : 0;
    const positive = !b0 || s > 0;
    const level: RiskLevel = i < k && s > firstExcluded && positive ? "ELEVE" : positive && lift >= mediumLift ? "MOYEN" : "FAIBLE";
    return { score: s, level, rank: i + 1, lift, population: n };
  };
}

type Delta = [number, number][];
const payKey = (salaryPct: number, promotion: boolean) => `${salaryPct}|${promotion ? 1 : 0}`;

// Les leviers agissent sur des sources disjointes : paie et carrière (salaire, promotion), pointages (heures sup),
// formations ; chaque variable ne lit qu'une de ces sources. Les variables d'une combinaison se composent donc à partir
// des recalculs par famille : au plus 25 + 4 + 10 recalculs au lieu de 1 429. Les pistes retenues sont recalculées en entier.
export function leverEvaluator(base: SimulationBase, employeeId: number, asOf: string) {
  let engineRuns = 0;
  const notes = new Set<string>();
  const cache = new Map<string, number[] | null>();
  const exact = (l: Levers): number[] | null => {
    const key = `${l.salaryPct}|${l.overtimeCutH}|${l.trainingHours}|${l.promotion ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key)!;
    engineRuns++;
    let out: number[] | null = null;
    try {
      const ds = forkDataset(base.ds, employeeId);
      for (const n of applyLevers(ds, employeeId, asOf, l).notes) notes.add(n);
      out = computeMonth(ds, asOf, [employeeId])[0]?.values ?? null;
    } catch (e) {
      if (!(e instanceof WhatIfError)) throw e;
      notes.add(e.message);
    }
    cache.set(key, out);
    return out;
  };
  const delta = (v: number[] | null): Delta => (v ?? base.before).flatMap((x, i): Delta => (x !== base.before[i] ? [[i, x]] : []));

  const allowed = {
    salary: exact({ ...NO_LEVERS, salaryPct: LEVER_STEPS.salaryPct }) !== null,
    promotion: exact({ ...NO_LEVERS, promotion: true }) !== null,
  };
  const pay = new Map<string, Delta>();
  for (const promotion of allowed.promotion ? [false, true] : [false])
    for (const salaryPct of allowed.salary ? LEVER_VALUES.salaryPct : [0])
      pay.set(payKey(salaryPct, promotion), salaryPct || promotion ? delta(exact({ ...NO_LEVERS, salaryPct, promotion })) : []);
  const overtime = new Map(LEVER_VALUES.overtimeCutH.map((h): [number, Delta] => [h, h ? delta(exact({ ...NO_LEVERS, overtimeCutH: h })) : []]));
  const training = new Map(LEVER_VALUES.trainingHours.map((h): [number, Delta] => [h, h ? delta(exact({ ...NO_LEVERS, trainingHours: h })) : []]));

  const values = (l: Levers): number[] => {
    const v = [...base.before];
    for (const d of [pay.get(payKey(l.salaryPct, l.promotion)), overtime.get(l.overtimeCutH), training.get(l.trainingHours)])
      for (const [i, x] of d ?? []) v[i] = x;
    return v;
  };
  return {
    allowed,
    values,
    notes: () => [...notes],
    engineRuns: () => engineRuns,
  };
}

// Calcul borné : au plus 1 + 39 recalculs des variables, 1 429 prédictions et MAX_CHECKS simulations complètes.
export function searchLevers(
  sqlite: Database.Database,
  model: LoadedModel,
  employeeId: number,
  asOf: string,
  opts: SimulationOptions & { maxProposals?: number },
): LeverSearchResult {
  const t0 = performance.now();
  const base = loadSimulationBase(sqlite, model, employeeId, asOf);
  const before = place(model, base.population, employeeId, base.before, opts.capacityRate, opts.mediumLift);
  const stats: LeverSearchStats = { combos: 0, evaluated: 0, pruned: 0, engineRuns: 1, ms: 0 };
  const finish = (status: LeverSearchStatus, proposals: LeverProposal[], notes: string[]): LeverSearchResult => ({
    asOf,
    before,
    status,
    proposals,
    stats: { ...stats, ms: Math.round(performance.now() - t0) },
    notes,
  });
  if (before.level === "FAIBLE") return finish("DEJA_FAIBLE", [], []);

  const ev = leverEvaluator(base, employeeId, asOf);
  const placeOf = makePlacer(model, base.population, employeeId, opts.capacityRate, opts.mediumLift);
  const lower = (p: Placement) => LEVEL_RANK[p.level] < LEVEL_RANK[before.level];
  const grid = leverGrid(ev.allowed);
  const verified = new Map<Levers, WhatIfResult>();
  let checks = 0;
  const { picked, evaluated, pruned } = pickMinimal(
    grid,
    (l) => {
      if (checks >= MAX_CHECKS || !lower(placeOf(ev.values(l)))) return false;
      checks++;
      const r = simulateFrom(model, base, employeeId, asOf, l, opts);
      if (!lower(r.after)) return false;
      verified.set(l, r);
      return true;
    },
    opts.maxProposals ?? MAX_PROPOSALS,
  );
  Object.assign(stats, { combos: grid.length, evaluated, pruned, engineRuns: 1 + ev.engineRuns() + checks });
  const proposals = picked.map((l) => ({ levers: l, effort: Math.round(leverEffort(l) * 1000) / 1000, result: verified.get(l)! }));
  return finish(proposals.length ? "TROUVE" : "AUCUNE", proposals, ev.notes());
}

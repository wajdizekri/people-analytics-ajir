import type Database from "better-sqlite3";
import { FEATURE_NAMES, GROUP_CODES, loadEmployeeDataset, readSnapshots } from "../features";
import { computeMonth, payContext, type FeatureVector } from "../features/compute";
import type { CareerRow, Dataset } from "../features/dataset";
import { addMonths, monthOf, toDay } from "../features/dates";
import { explain, rankAndLevel, type LoadedModel, type RiskLevel } from "../scoring";

export const LEVER_LIMITS = { salaryPct: 30, overtimeCutH: 40, trainingHours: 200 } as const;
export const DEFAULT_CHARGE_RATE_PCT = 16.57;
export const MAX_GRADE = 8;
export const NON_CAUSAL_NOTICE = "Estimation non causale : le modèle décrit des associations, pas l'effet garanti d'une action.";

export type Levers = { salaryPct: number; overtimeCutH: number; trainingHours: number; promotion: boolean };
export const NO_LEVERS: Levers = { salaryPct: 0, overtimeCutH: 0, trainingHours: 0, promotion: false };

export class WhatIfError extends Error {}

export type AppliedLevers = {
  salary: { before: number; after: number } | null;
  grade: { before: string; after: string } | null;
  overtimeRemovedH: number;
  trainingHours: number;
  notes: string[];
};

export type Placement = { score: number; level: RiskLevel; rank: number; lift: number; population: number };

export type WhatIfResult = {
  asOf: string;
  before: Placement;
  after: Placement;
  groups: { group: string; before: number; after: number }[];
  changes: { feature: string; before: number; after: number }[];
  applied: AppliedLevers;
  cost: { monthlySalaryDelta: number; annual: number; chargeRate: number };
};

const gradeLevel = (g: string | null) => {
  const m = g ? /(\d+)/.exec(g) : null;
  return m ? Number(m[1]) : null;
};

function addCareer(ds: Dataset, id: number, ev: CareerRow) {
  const list = ds.careers.get(id) ?? [];
  list.push(ev);
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  ds.careers.set(id, list);
}

// Applique les leviers aux sources chargées, comme s'ils avaient été saisis dans AJIR à la date t.
export function applyLevers(ds: Dataset, id: number, t: string, levers: Levers): AppliedLevers {
  const notes: string[] = [];
  const pay = payContext(ds, t);
  const base = pay.salary(id);
  const grade = pay.grade(id);
  let target = base;
  let gradeChange: AppliedLevers["grade"] = null;

  if (levers.salaryPct > 0) {
    if (base == null) throw new WhatIfError("Aucun salaire de base visible à cette date : le levier salaire est inapplicable.");
    target = base * (1 + levers.salaryPct / 100);
  }
  if (levers.promotion) {
    const level = gradeLevel(grade);
    if (grade == null || level == null) throw new WhatIfError("Grade inconnu à cette date : promotion impossible.");
    if (level >= MAX_GRADE) throw new WhatIfError(`Grade maximal (G${MAX_GRADE}) déjà atteint : promotion impossible.`);
    const next = grade.replace(/\d+/, String(level + 1));
    const med = pay.median(id, next);
    if (med == null) notes.push(`Aucun salaire de référence en ${next} pour cette famille de métier : salaire non ajusté à la médiane.`);
    else if (target != null) target = Math.max(target, med);
    addCareer(ds, id, { date: t, type: "PROMOTION", oldValue: grade, newValue: next, rec: t });
    gradeChange = { before: grade, after: next };
  }

  let salary: AppliedLevers["salary"] = null;
  if (target != null) target = Math.round(target * 1000) / 1000;
  if (base != null && target != null && target > base) {
    const month = monthOf(t);
    const rows = (ds.payroll.get(id) ?? []).filter((p) => p.month !== month);
    rows.push({ month, base: target, rec: t });
    ds.payroll.set(id, rows);
    addCareer(ds, id, { date: t, type: "AUGMENTATION", oldValue: String(base), newValue: String(target), rec: t });
    salary = { before: base, after: target };
  }

  let removedMin = 0;
  if (levers.overtimeCutH > 0) {
    const att = ds.attendance.get(id);
    if (!att) notes.push("Aucun pointage sur la période : le levier heures supplémentaires est sans effet.");
    else
      for (let m = 0; m < 3; m++) {
        const from = toDay(addMonths(t, -(m + 1))) + 1;
        const to = toDay(addMonths(t, -m));
        let total = 0;
        for (let k = 0; k < att.day.length; k++) if (att.day[k] >= from && att.day[k] <= to) total += att.ot[k];
        if (total <= 0) continue;
        const cut = Math.min(total, levers.overtimeCutH * 60);
        for (let k = 0; k < att.day.length; k++) if (att.day[k] >= from && att.day[k] <= to) att.ot[k] *= 1 - cut / total;
        removedMin += cut;
      }
  }

  if (levers.trainingHours > 0) {
    const list = ds.trainings.get(id) ?? [];
    list.push({ mandatory: false, start: t, end: t, due: null, hours: levers.trainingHours, status: "TERMINEE" });
    ds.trainings.set(id, list);
  }

  return { salary, grade: gradeChange, overtimeRemovedH: removedMin / 60, trainingHours: levers.trainingHours, notes };
}

function place(model: LoadedModel, population: FeatureVector[], id: number, values: number[], capacityRate: number, mediumLift: number): Placement {
  const rows = rankAndLevel(model, [...population, { employeeId: id, values, partial: false }], capacityRate, mediumLift);
  const r = rows.find((x) => x.employeeId === id)!;
  return { score: r.score, level: r.level, rank: r.rank, lift: r.lift, population: rows.length };
}

function byGroup(model: LoadedModel, values: number[]): Map<string, number> {
  return new Map(explain(model, values).map((g) => [g.group, g.contribution]));
}

// Recalcule les variables du salarié avec et sans leviers (mêmes fonctions que le batch), puis score et niveau
// dans la population du mois (snapshots des autres salariés). Rien n'est écrit en base.
export function simulate(
  sqlite: Database.Database,
  model: LoadedModel,
  employeeId: number,
  asOf: string,
  levers: Levers,
  opts: { capacityRate: number; mediumLift: number; chargeRate: number },
): WhatIfResult {
  const ds = loadEmployeeDataset(sqlite, employeeId, asOf);
  const [before] = computeMonth(ds, asOf, [employeeId]);
  if (!before) throw new WhatIfError("Collaborateur non évalué à cette date (hors du calcul des risques) : simulation impossible.");
  const applied = applyLevers(ds, employeeId, asOf, levers);
  const [after] = computeMonth(ds, asOf, [employeeId]);

  const population = readSnapshots(sqlite, asOf, model.fsv).filter((r) => r.employeeId !== employeeId);
  if (!population.length) throw new WhatIfError("Variables du mois indisponibles : simulation impossible.");

  const gb = byGroup(model, before.values);
  const ga = byGroup(model, after.values);
  const groups = GROUP_CODES.filter((g) => gb.has(g) || ga.has(g)).map((g) => ({ group: g, before: gb.get(g) ?? 0, after: ga.get(g) ?? 0 }));
  const changes = FEATURE_NAMES.flatMap((feature, i) =>
    before.values[i] !== after.values[i] ? [{ feature, before: before.values[i], after: after.values[i] }] : [],
  );
  const monthlySalaryDelta = applied.salary ? applied.salary.after - applied.salary.before : 0;

  return {
    asOf,
    before: place(model, population, employeeId, before.values, opts.capacityRate, opts.mediumLift),
    after: place(model, population, employeeId, after.values, opts.capacityRate, opts.mediumLift),
    groups,
    changes,
    applied,
    cost: { monthlySalaryDelta, annual: monthlySalaryDelta * 12 * (1 + opts.chargeRate), chargeRate: opts.chargeRate },
  };
}

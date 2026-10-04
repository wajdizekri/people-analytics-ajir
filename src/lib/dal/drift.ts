import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db/client";
import { featureShortLabel } from "@/lib/drift/labels";
import { PSI_THRESHOLDS, computePsi, driftStatus, type DriftStatus, type PsiBin } from "@/lib/drift/psi";
import { FEATURES, FSV, GROUPS } from "@/lib/features/spec";
import { loadChampion, predict, type LoadedModel } from "@/lib/scoring";
import { getSetting } from "@/lib/settings";
import { ensureRole } from "./admin";
import type { AccessContext } from "./context";
import { monthEnd } from "./pilotage-metrics";

// Dérive des données (RH et ADMIN) : PSI de chaque variable de shared/features.json entre la période d'entraînement du champion
// (train_from / train_to du bundle, sinon les 12 premiers mois disponibles) et le dernier mois de feature_snapshot, calculé à la volée ;
// suivi du taux de démission observé (v_label_panel, cohortes à suivi complet) contre le taux prévu.
// Indicateurs agrégés uniquement : aucun nom, matricule ni valeur individuelle. ADMIN : sans taux de démission (O/E seulement).

export const FALLBACK_REFERENCE_MONTHS = 12;
export const CALIBRATION_MONTHS = 24;
export const RECENT_COHORTS = 6;
export const OE_TARGET: [number, number] = [0.8, 1.25];

export type DriftVariable = {
  name: string;
  label: string;
  group: string;
  groupLabel: string;
  psi: number | null;
  status: DriftStatus | null;
  nRef: number;
  nCur: number;
  kind: "DISCRETE" | "QUANTILE" | null;
  bins: PsiBin[];
};

type CalibrationStatus = "DANS_LA_CIBLE" | "HORS_CIBLE" | null;
type CalibrationSource = "PROBABILITE" | "TAUX_REFERENCE" | null;
type CalibrationBase = { source: CalibrationSource; target: [number, number]; recentCohorts: number; status: CalibrationStatus };
export type CalibrationPointRh = { asOf: string; n: number; observed: number | null; expected: number | null; oe: number | null };
export type CalibrationRh = CalibrationBase & {
  points: CalibrationPointRh[];
  recent: { n: number; observed: number | null; expected: number | null; oe: number | null } | null;
  referenceRate: number | null;
};
export type CalibrationAdmin = CalibrationBase & { points: { asOf: string; n: number; oe: number | null }[]; recent: { n: number; oe: number | null } | null };

export type RetrainAdvice = { level: "REENTRAINER" | "SURVEILLER" | "RAS"; reasons: string[] };

type DriftCommon = {
  fsv: string;
  model: { version: string; kind: "B0" | "LOGREG" } | null;
  reference: { from: string; to: string; months: number; rows: number; source: "BUNDLE" | "PREMIERS_MOIS" } | null;
  current: { asOf: string; rows: number } | null;
  thresholds: typeof PSI_THRESHOLDS;
  variables: DriftVariable[];
  summary: Record<DriftStatus, number>;
  recommendation: RetrainAdvice;
};
export type DriftRh = DriftCommon & { view: "RH"; calibration: CalibrationRh };
export type DriftAdmin = DriftCommon & { view: "ADMIN"; calibration: CalibrationAdmin };
export type DriftDto = DriftRh | DriftAdmin;

type DriftRaw = Omit<DriftCommon, "recommendation"> & { calibration: CalibrationRh };

// ---------- Période de référence ----------

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function trainPeriodOf(v: unknown): { from: string; to: string } | null {
  const o = obj(v);
  const from = o?.train_from;
  const to = o?.train_to;
  return typeof from === "string" && typeof to === "string" && PERIOD_RE.test(from) && PERIOD_RE.test(to) && from <= to ? { from, to } : null;
}

const ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd());

// Bundle sur disque : repli pour un manifeste enregistré avant l'ajout de train_from / train_to au schéma (scoring/model.ts) ;
// chemin confiné au projet
function bundleFilePeriod(bundlePath: string | null): { from: string; to: string } | null {
  if (!bundlePath) return null;
  const abs = path.resolve(/*turbopackIgnore: true*/ ROOT, bundlePath);
  const file = path.basename(abs) === "model.json" ? abs : path.join(abs, "model.json");
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    return trainPeriodOf(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
  } catch {
    return null;
  }
}

function championTrainPeriod(modelId: number | null): { from: string; to: string } | null {
  if (modelId == null) return null;
  const row = getDb().sqlite.prepare("SELECT manifest_json AS m, metrics_json AS x, bundle_path AS p FROM model_version WHERE id = ?").get(modelId) as
    | { m: string | null; x: string | null; p: string | null }
    | undefined;
  if (!row) return null;
  const parse = (s: string | null) => {
    try {
      return s ? (JSON.parse(s) as unknown) : null;
    } catch {
      return null;
    }
  };
  const bundle = obj(obj(parse(row.m))?.bundle);
  return trainPeriodOf(bundle) ?? trainPeriodOf(bundle?.metrics) ?? trainPeriodOf(parse(row.x)) ?? bundleFilePeriod(row.p);
}

// ---------- Lecture des variables ----------

function readColumns(fsv: string, from: string, to: string): { columns: number[][]; rows: number } {
  const rows = getDb()
    .sqlite.prepare(
      `SELECT values_json FROM feature_snapshot WHERE fsv = @fsv AND as_of BETWEEN @from AND @to
       AND employee_id NOT IN (SELECT employee_id FROM employee_opposition)`,
    )
    .raw()
    .all({ fsv, from, to }) as [string][];
  const columns = FEATURES.map(() => new Array<number>(rows.length));
  rows.forEach(([json], i) => {
    const v = JSON.parse(json) as number[];
    for (let j = 0; j < columns.length; j++) columns[j][i] = typeof v[j] === "number" ? v[j] : NaN;
  });
  return { columns, rows: rows.length };
}

// ---------- Observé contre prévu ----------

type Cohort = { asOf: string; n: number; y: number; expected: number | null };

function calibration(model: LoadedModel | null, fsv: string, refMonths: string[]): CalibrationRh {
  const { sqlite } = getDb();
  const end = getSetting(sqlite, "data_end_date");
  const base: CalibrationRh = { source: null, target: OE_TARGET, recentCohorts: RECENT_COHORTS, status: null, points: [], recent: null, referenceRate: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return base;
  const complete = (
    sqlite.prepare("SELECT DISTINCT as_of AS asOf FROM feature_snapshot WHERE fsv = ? AND date(as_of, '+6 months') <= ? ORDER BY as_of").all(fsv, end) as { asOf: string }[]
  ).map((r) => r.asOf);
  const months = complete.slice(-CALIBRATION_MONTHS);
  const labelsOf = (asOfs: string[]) =>
    sqlite
      .prepare(
        `SELECT as_of AS asOf, employee_id AS id, MAX(y6) AS y FROM v_label_panel
         WHERE fsv = @fsv AND followup_complete = 1 AND as_of IN (SELECT value FROM json_each(@asOfs))
           AND employee_id NOT IN (SELECT employee_id FROM employee_opposition)
         GROUP BY as_of, employee_id`,
      )
      .all({ fsv, asOfs: JSON.stringify(asOfs) }) as { asOf: string; id: number; y: number }[];

  const probabilistic = model?.kind === "LOGREG" && model.fsv === fsv;
  let referenceRate: number | null = null;
  if (!probabilistic) {
    const refComplete = refMonths.filter((m) => complete.includes(m));
    const labels = refComplete.length ? labelsOf(refComplete) : [];
    referenceRate = labels.length ? labels.reduce((s, l) => s + l.y, 0) / labels.length : null;
  }
  const source: CalibrationSource = probabilistic ? "PROBABILITE" : referenceRate != null ? "TAUX_REFERENCE" : null;

  const cohorts = new Map<string, Cohort>(months.map((m) => [m, { asOf: m, n: 0, y: 0, expected: null }]));
  const labels = months.length ? labelsOf(months) : [];
  const labelled = new Map<string, number>();
  for (const l of labels) {
    const c = cohorts.get(l.asOf)!;
    c.n++;
    c.y += l.y;
    labelled.set(`${l.asOf}:${l.id}`, l.y);
  }
  if (probabilistic && months.length) {
    const sums = new Map<string, number>();
    const rows = sqlite
      .prepare("SELECT as_of AS asOf, employee_id AS id, values_json AS v FROM feature_snapshot WHERE fsv = @fsv AND as_of IN (SELECT value FROM json_each(@asOfs))")
      .all({ fsv, asOfs: JSON.stringify(months) }) as { asOf: string; id: number; v: string }[];
    for (const r of rows) if (labelled.has(`${r.asOf}:${r.id}`)) sums.set(r.asOf, (sums.get(r.asOf) ?? 0) + predict(model!, JSON.parse(r.v) as number[]));
    for (const c of cohorts.values()) c.expected = c.n ? (sums.get(c.asOf) ?? 0) : null;
  } else if (referenceRate != null) for (const c of cohorts.values()) c.expected = c.n ? referenceRate * c.n : null;

  const list = [...cohorts.values()].filter((c) => c.n > 0);
  const points = list.map((c) => ({
    asOf: c.asOf,
    n: c.n,
    observed: c.y / c.n,
    expected: c.expected != null ? c.expected / c.n : null,
    oe: c.expected ? c.y / c.expected : null,
  }));
  const last = list.slice(-RECENT_COHORTS);
  const n = last.reduce((s, c) => s + c.n, 0);
  const y = last.reduce((s, c) => s + c.y, 0);
  const e = source ? last.reduce((s, c) => s + (c.expected ?? 0), 0) : null;
  const recent = n ? { n, observed: y / n, expected: e != null ? e / n : null, oe: e ? y / e : null } : null;
  const status: CalibrationStatus = recent?.oe == null ? null : recent.oe >= OE_TARGET[0] && recent.oe <= OE_TARGET[1] ? "DANS_LA_CIBLE" : "HORS_CIBLE";
  return { source, target: OE_TARGET, recentCohorts: RECENT_COHORTS, status, points, recent, referenceRate };
}

// ---------- Recommandation ----------

const dec = (n: number, d = 2) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function retrainAdvice(variables: Pick<DriftVariable, "label" | "status">[], cal: { source: CalibrationSource; status: CalibrationStatus; oe: number | null }): RetrainAdvice {
  const strong = variables.filter((v) => v.status === "FORTE");
  const moderate = variables.filter((v) => v.status === "MODEREE");
  const reasons: string[] = [];
  let level: RetrainAdvice["level"] = "RAS";
  const names = (vs: { label: string }[]) =>
    vs
      .slice(0, 4)
      .map((v) => v.label.charAt(0).toLowerCase() + v.label.slice(1))
      .join(", ") + (vs.length > 4 ? ` et ${vs.length - 4} autre${vs.length > 5 ? "s" : ""}` : "");
  if (strong.length) {
    level = "REENTRAINER";
    reasons.push(`${strong.length} variable${strong.length > 1 ? "s" : ""} en dérive forte (PSI ≥ ${dec(PSI_THRESHOLDS.strong)}) : ${names(strong)}.`);
  }
  if (cal.status === "HORS_CIBLE" && cal.oe != null) {
    if (cal.source === "PROBABILITE") {
      level = "REENTRAINER";
      reasons.push(
        `Taux de démission observé égal à ${dec(cal.oe)} fois le taux prévu sur les ${RECENT_COHORTS} dernières cohortes à suivi complet (cible : ${dec(OE_TARGET[0])} à ${dec(OE_TARGET[1])}).`,
      );
    } else {
      if (level === "RAS") level = "SURVEILLER";
      reasons.push(`Taux de démission observé égal à ${dec(cal.oe)} fois celui de la période de référence sur les ${RECENT_COHORTS} dernières cohortes à suivi complet.`);
    }
  }
  if (moderate.length) {
    if (level === "RAS") level = "SURVEILLER";
    reasons.push(`${moderate.length} variable${moderate.length > 1 ? "s" : ""} en dérive modérée (PSI entre ${dec(PSI_THRESHOLDS.moderate)} et ${dec(PSI_THRESHOLDS.strong)}) : ${names(moderate)}.`);
  }
  return { level, reasons };
}

// ---------- Calcul et cache ----------

const CACHE_TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __paDrift?: Map<string, { at: number; raw: DriftRaw }> };
const cache = () => (g.__paDrift ??= new Map());

export function clearDriftCache(): void {
  cache().clear();
}

function computeDrift(): DriftRaw {
  const { sqlite } = getDb();
  const model = loadChampion(sqlite);
  const fsv = FSV;
  const months = (sqlite.prepare("SELECT DISTINCT as_of AS asOf FROM feature_snapshot WHERE fsv = ? ORDER BY as_of").all(fsv) as { asOf: string }[]).map((r) => r.asOf);
  const current = months[months.length - 1] ?? null;
  const period = model && model.kind !== "B0" ? championTrainPeriod(model.id) : null;
  let refMonths = period && current ? months.filter((m) => m >= monthEnd(period.from.slice(0, 7)) && m <= monthEnd(period.to.slice(0, 7)) && m < current) : [];
  let source: "BUNDLE" | "PREMIERS_MOIS" = "BUNDLE";
  if (!refMonths.length) {
    refMonths = months.slice(0, Math.min(FALLBACK_REFERENCE_MONTHS, Math.max(0, months.length - 1)));
    source = "PREMIERS_MOIS";
  }
  const modelDto = model ? { version: model.version, kind: model.kind } : null;
  const summary: Record<DriftStatus, number> = { STABLE: 0, MODEREE: 0, FORTE: 0 };
  const cal = calibration(model, fsv, refMonths);
  if (!current || !refMonths.length)
    return { fsv, model: modelDto, reference: null, current: current ? { asOf: current, rows: 0 } : null, thresholds: PSI_THRESHOLDS, variables: [], summary, calibration: cal };

  const ref = readColumns(fsv, refMonths[0], refMonths[refMonths.length - 1]);
  const cur = readColumns(fsv, current, current);
  const variables: DriftVariable[] = FEATURES.map((f, j) => {
    const r = computePsi(ref.columns[j], cur.columns[j]);
    const status = driftStatus(r.psi);
    if (status) summary[status]++;
    return {
      name: f.name,
      label: featureShortLabel(f.name),
      group: f.group,
      groupLabel: GROUPS[f.group]?.label_rh ?? f.group,
      psi: r.psi == null ? null : Math.round(r.psi * 10000) / 10000,
      status,
      nRef: r.nRef,
      nCur: r.nCur,
      kind: r.spec?.kind ?? null,
      bins: r.bins,
    };
  }).sort((a, b) => (b.psi ?? -1) - (a.psi ?? -1) || a.label.localeCompare(b.label, "fr"));
  return {
    fsv,
    model: modelDto,
    reference: { from: refMonths[0], to: refMonths[refMonths.length - 1], months: refMonths.length, rows: ref.rows, source },
    current: { asOf: current, rows: cur.rows },
    thresholds: PSI_THRESHOLDS,
    variables,
    summary,
    calibration: cal,
  };
}

function cachedDrift(): DriftRaw {
  const { sqlite } = getDb();
  const version = sqlite
    .prepare(
      `SELECT (SELECT COUNT(*) FROM feature_snapshot) AS n, (SELECT MAX(as_of) FROM feature_snapshot) AS last,
        (SELECT id || ':' || IFNULL(promoted_at, '') FROM model_version WHERE status = 'CHAMPION') AS champion,
        (SELECT value FROM app_setting WHERE key = 'data_end_date') AS dataEnd,
        (SELECT COUNT(*) FROM employee_opposition) AS opposed`,
    )
    .get();
  const key = JSON.stringify(version);
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.raw;
  const raw = computeDrift();
  cache().clear();
  cache().set(key, { at: Date.now(), raw });
  return raw;
}

export function getDrift(ctx: AccessContext): DriftDto {
  ensureRole(ctx, ["RH", "ADMIN"], "drift.view");
  const raw = cachedDrift();
  const cal = raw.calibration;
  const common: DriftCommon = {
    fsv: raw.fsv,
    model: raw.model ? { ...raw.model } : null,
    reference: raw.reference ? { ...raw.reference } : null,
    current: raw.current ? { ...raw.current } : null,
    thresholds: raw.thresholds,
    variables: raw.variables.map((v) => ({ ...v, bins: v.bins.map((b) => ({ ...b })) })),
    summary: { ...raw.summary },
    recommendation: retrainAdvice(raw.variables, { source: cal.source, status: cal.status, oe: cal.recent?.oe ?? null }),
  };
  const base = { source: cal.source, target: cal.target, recentCohorts: cal.recentCohorts, status: cal.status };
  if (ctx.role === "RH")
    return { ...common, view: "RH", calibration: { ...base, points: cal.points.map((p) => ({ ...p })), recent: cal.recent ? { ...cal.recent } : null, referenceRate: cal.referenceRate } };
  // ADMIN : taux de démission retirés (indicateur RH) ; seul le rapport observé / prévu reste
  return {
    ...common,
    view: "ADMIN",
    calibration: { ...base, points: cal.points.map((p) => ({ asOf: p.asOf, n: p.n, oe: p.oe })), recent: cal.recent ? { n: cal.recent.n, oe: cal.recent.oe } : null },
  };
}

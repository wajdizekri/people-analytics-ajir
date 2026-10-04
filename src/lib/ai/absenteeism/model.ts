import type { CoverageCell } from "../conformal";
import type { MonthCal } from "./series";

// Inférence du bundle models/absenteeism/<version>/model.json (ridge direct par horizon, ml/absenteeism/model.py).
// Même suite d'opérations que le Python : parité 1e-9 vérifiée sur golden.json.

export const FEATURES = [
  "r_last", "ma3", "ma12", "seasonal", "parent_ma12", "trend", "company_trend",
  "ramadan_share", "ramadan_delta12", "bridge_days", "holidays", "seance_unique_share", "workdays",
  "log_size", "is_team", "is_dept",
] as const;
const MA12 = FEATURES.indexOf("ma12");

export type Scope = "ENTREPRISE" | "DEPARTEMENT" | "EQUIPE";
export type Family = "EQUIPE" | "AGREGE";
export type HorizonModel = { mean: number[]; std: number[]; coef: number[]; intercept: number; offset: "ma12" | "none" };
// Champ additif des versions calibrées (ml/absenteeism/conformal.py) : quantiles signés [bas, haut] par portée et horizon,
// même échelle que l'intervalle v1. Absent (ou portée manquante) : quantiles v1 par famille.
export type AbsConformal = { level: number; quantiles: Partial<Record<Scope, Record<string, [number, number]>>>; coverage?: Partial<Record<Scope, CoverageCell>> };
export type AbsBundle = {
  version: string;
  kind: "RIDGE_DIRECT";
  features: string[];
  horizons: number[];
  models: Record<string, Partial<Record<"ALL" | Family, HorizonModel>>>;
  intervals: { level: number; rate_floor: number; quantiles: Record<Family, Record<string, [number, number]>> };
  visibility_lag_days: number;
  min_group: number;
  conformal?: AbsConformal;
  metrics?: unknown;
};
export type Pair = [number[], number[]]; // [num[12], den[12]] des mois O-11 .. O

export const familyOf = (scope: Scope): Family => (scope === "EQUIPE" ? "EQUIPE" : "AGREGE");

export function validateBundle(b: AbsBundle): AbsBundle {
  if (b.kind !== "RIDGE_DIRECT") throw new Error(`Type de modèle d'absentéisme inattendu : ${b.kind}`);
  if (b.features.length !== FEATURES.length || b.features.some((f, i) => f !== FEATURES[i])) throw new Error("Variables du modèle d'absentéisme incompatibles.");
  for (const h of b.horizons) if (!b.models[String(h)] || !b.intervals.quantiles.EQUIPE[String(h)] || !b.intervals.quantiles.AGREGE[String(h)]) throw new Error(`Horizon ${h} incomplet.`);
  for (const byH of Object.values(b.conformal?.quantiles ?? {}))
    for (const q of Object.values(byH ?? {}))
      if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1]) || q[0] > 0 || q[1] < 0) throw new Error("Quantiles conformes du modèle d'absentéisme invalides.");
  return b;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// [ma12, ma3, r_last] avec replis (ma3 -> ma12, r_last -> ma3) ; null si aucun jour ouvré sur 12 mois
export function windowStats(num: number[], den: number[]): [number, number, number] | null {
  const sd = sum(den);
  if (sd <= 0) return null;
  const ma12 = sum(num) / sd;
  const d3 = den[9] + den[10] + den[11];
  const ma3 = d3 > 0 ? (num[9] + num[10] + num[11]) / d3 : ma12;
  const r = den[11] > 0 ? num[11] / den[11] : null;
  return [ma12, ma3, r ?? ma3];
}

export function features(h: number, scope: Scope, own: Pair, parent: Pair, company: Pair, calT: MonthCal, calT12: MonthCal): number[] {
  const w = windowStats(own[0], own[1]);
  if (!w) throw new Error("Unité sans jour ouvré sur 12 mois.");
  const [ma12, ma3, rLast] = w;
  const seasonal = own[1][h - 1] > 0 ? own[0][h - 1] / own[1][h - 1] : ma12;
  const p = windowStats(parent[0], parent[1]);
  const c = windowStats(company[0], company[1]);
  return [
    rLast, ma3, ma12, seasonal, p ? p[0] : ma12, ma3 - ma12, c ? c[1] - c[0] : 0,
    calT.ram, calT.ram - calT12.ram, calT.bridge, calT.hol, calT.su, calT.wd,
    Math.log(1 + sum(own[1]) / 12), scope === "EQUIPE" ? 1 : 0, scope === "DEPARTEMENT" ? 1 : 0,
  ];
}

export function predictRate(m: HorizonModel, x: number[]): number {
  let s = m.intercept;
  for (let j = 0; j < x.length; j++) {
    const sd = m.std[j];
    s += m.coef[j] * ((x[j] - m.mean[j]) / (sd === 0 ? 1 : sd));
  }
  if (m.offset === "ma12") s += x[MA12];
  return s > 0 ? s : 0;
}

export const intervalScale = (pred: number, ownDen: number[], floor: number) => Math.sqrt(Math.max(pred, floor) / Math.max(sum(ownDen) / 12, 1));

export type UnitForecast = { h: number; x: number[]; value: number; lower: number; upper: number };

export function forecastUnit(b: AbsBundle, h: number, scope: Scope, own: Pair, parent: Pair, company: Pair, calT: MonthCal, calT12: MonthCal): UnitForecast {
  const byGroup = b.models[String(h)];
  const m = byGroup.ALL ?? byGroup[familyOf(scope)];
  if (!m) throw new Error(`Modèle absent pour l'horizon ${h}.`);
  const x = features(h, scope, own, parent, company, calT, calT12);
  const value = predictRate(m, x);
  const [qlo, qhi] = b.conformal?.quantiles[scope]?.[String(h)] ?? b.intervals.quantiles[familyOf(scope)][String(h)];
  const s = intervalScale(value, own[1], b.intervals.rate_floor);
  return { h, x, value, lower: Math.max(0, value + qlo * s), upper: value + qhi * s };
}

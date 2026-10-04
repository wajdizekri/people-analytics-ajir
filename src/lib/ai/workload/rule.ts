import type Database from "better-sqlite3";
import { getSetting } from "../../settings";
import type { WorkloadBundle } from "./model";
import { individualOvertime } from "./panel";

// Surcharge individuelle soutenue : règle explicable (aucun modèle individuel).
// Salarié actif en fin de mois dont les heures sup pointées dépassent le seuil chaque mois depuis au moins N mois
// consécutifs (un mois sans pointage rompt la série). Paramètres : app_setting (défauts 20 h / 3 mois dans
// DEFAULT_SETTINGS) ; valeur vide ou hors bornes : bundle, sinon RULE_DEFAULTS.

export const RULE_DEFAULTS = { thresholdH: 20, months: 3 };
export const SETTING_THRESHOLD = "workload_ot_threshold_h";
export const SETTING_MONTHS = "workload_ot_months";

export type RuleParams = { thresholdH: number; months: number };

export function ruleParams(sqlite: Database.Database, bundle?: WorkloadBundle | null): RuleParams {
  const thr = Number(getSetting(sqlite, SETTING_THRESHOLD));
  const n = Number(getSetting(sqlite, SETTING_MONTHS));
  return {
    thresholdH: Number.isFinite(thr) && thr > 0 && thr <= 200 ? thr : (bundle?.rule.threshold_h ?? RULE_DEFAULTS.thresholdH),
    months: Number.isInteger(n) && n >= 1 && n <= 12 ? n : (bundle?.rule.consecutive_months ?? RULE_DEFAULTS.months),
  };
}

export type Overload = { employeeId: number; months: number; start: string; hours: { month: string; hours: number }[] };

// Série en cours à la fin de la fenêtre (mois d'origine inclus)
export function streakOf(hours: number[], days: number[], thresholdH: number): number {
  let n = 0;
  for (let i = hours.length - 1; i >= 0 && days[i] > 0 && hours[i] > thresholdH; i--) n++;
  return n;
}

export function sustainedOverloads(data: ReturnType<typeof individualOvertime>, p: RuleParams): Overload[] {
  const out: Overload[] = [];
  for (const r of data.rows) {
    const n = streakOf(r.hours, r.days, p.thresholdH);
    if (n < p.months) continue;
    const from = data.months.length - n;
    out.push({
      employeeId: r.employeeId,
      months: n,
      start: data.months[from],
      hours: data.months.slice(from).map((month, i) => ({ month, hours: r.hours[from + i] })),
    });
  }
  return out.sort((a, b) => b.months - a.months || a.employeeId - b.employeeId);
}

// Deux passes : les N derniers mois pour repérer les candidats, puis 36 mois d'historique pour eux seuls
export function detectOverloads(sqlite: Database.Database, originMonth: string, p: RuleParams, lookback = 36): Overload[] {
  const candidates = sustainedOverloads(individualOvertime(sqlite, originMonth, p.months), p).map((o) => o.employeeId);
  if (!candidates.length) return [];
  return sustainedOverloads(individualOvertime(sqlite, originMonth, Math.max(lookback, p.months), candidates), p);
}

import type Database from "better-sqlite3";
import { project, type Projection, type Scenario, type WorkforceState } from "./engine";
import { publishedProb6, type WorkforceModels } from "./models";
import { buildState, type MemberInfo } from "./state";

export const BUDGET_KEY_PREFIX = "budget_masse_salariale_";

export type WorkforceComputation = { state: WorkforceState; members: MemberInfo[]; proj: Projection };

export function computeWorkforce(sqlite: Database.Database, asOf: string, models: WorkforceModels, scenario: Scenario = {}): WorkforceComputation {
  const { state, members } = buildState(sqlite, asOf, models.be, models.bm, publishedProb6(sqlite, asOf));
  return { state, members, proj: project(models.be, models.bm, state, scenario) };
}

// Budgets annuels de masse salariale brute (TND), clés app_setting budget_masse_salariale_<AAAA>
export function readBudgets(sqlite: Database.Database): Map<number, number> {
  const rows = sqlite.prepare("SELECT key, value FROM app_setting WHERE key LIKE ?").all(`${BUDGET_KEY_PREFIX}%`) as { key: string; value: string }[];
  const out = new Map<number, number>();
  for (const r of rows) {
    const y = Number(r.key.slice(BUDGET_KEY_PREFIX.length));
    const v = Number(r.value);
    if (Number.isInteger(y) && Number.isFinite(v) && v > 0) out.set(y, v);
  }
  return out;
}

// Masse brute observée (agg_kpi_monthly) des mois de chaque année jusqu'au mois d'origine inclus
export function observedMassByYear(sqlite: Database.Database, month0: string): Map<number, { total: number; months: number }> {
  const rows = sqlite
    .prepare(
      `SELECT CAST(substr(month, 1, 4) AS INTEGER) AS y, SUM(payroll_mass) AS total, COUNT(DISTINCT month) AS months
       FROM agg_kpi_monthly WHERE month <= ? AND month >= ? GROUP BY 1`,
    )
    .all(month0, `${Number(month0.slice(0, 4)) - 1}-01`) as { y: number; total: number; months: number }[];
  return new Map(rows.map((r) => [r.y, { total: r.total, months: r.months }]));
}

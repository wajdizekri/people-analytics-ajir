import type Database from "better-sqlite3";
import { excludeOpposed } from "../privacy/opposition";
import { computeMonth, type ComputeOptions, type FeatureVector } from "./compute";
import { loadDataset } from "./dataset";
import { addMonths, addMonthsToMonth, monthEnd, monthRange, monthStart } from "./dates";
import { FSV } from "./spec";

export { FEATURES, FEATURE_NAMES, FEATURE_INDEX, GROUPS, GROUP_CODES, B0_RULES, FSV, featureSpec } from "./spec";
export type { FeatureSpec, GroupSpec, B0Rule } from "./spec";
export type { FeatureVector, ComputeOptions } from "./compute";

const HISTORY_MONTHS = 13;
const ATTENDANCE_MONTHS = 7;
const PAYROLL_MONTHS = 25;

const windowsFor = (firstAsOf: string) => ({
  attendanceFrom: addMonths(firstAsOf, -ATTENDANCE_MONTHS),
  payrollFrom: addMonths(firstAsOf, -PAYROLL_MONTHS),
});
const BACKFILL_CHUNK_MONTHS = 24;

function checkDate(asOf: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`Date de coupure invalide : ${asOf}`);
}

export function computeFeatures(
  sqlite: Database.Database,
  employeeId: number,
  asOf: string,
): { values: number[]; partial: boolean } | null {
  checkDate(asOf);
  const ds = loadDataset(sqlite, addMonths(asOf, -HISTORY_MONTHS), asOf, { employeeId, ...windowsFor(asOf) });
  const [r] = computeMonth(ds, asOf, [employeeId]);
  return r ? { values: r.values, partial: r.partial } : null;
}

export function computeFeaturesForMonth(sqlite: Database.Database, asOf: string, opts: ComputeOptions = {}): FeatureVector[] {
  checkDate(asOf);
  const ds = loadDataset(sqlite, addMonths(asOf, -HISTORY_MONTHS), asOf, windowsFor(asOf));
  return computeMonth(ds, asOf, undefined, opts);
}

export function writeSnapshots(sqlite: Database.Database, asOf: string, rows: FeatureVector[]): number {
  const del = sqlite.prepare("DELETE FROM feature_snapshot WHERE as_of = ? AND fsv = ?");
  const ins = sqlite.prepare(
    "INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json, partial_history) VALUES (?, ?, ?, ?, ?)",
  );
  sqlite.transaction(() => {
    del.run(asOf, FSV);
    for (const r of rows) ins.run(r.employeeId, asOf, FSV, JSON.stringify(r.values), r.partial ? 1 : 0);
  }).immediate();
  return rows.length;
}

export function readSnapshots(sqlite: Database.Database, asOf: string, fsv = FSV): FeatureVector[] {
  const rows = sqlite
    .prepare("SELECT employee_id AS id, values_json AS v, partial_history AS p FROM feature_snapshot WHERE as_of = ? AND fsv = ? ORDER BY employee_id")
    .all(asOf, fsv) as { id: number; v: string; p: number }[];
  return rows.map((r) => ({ employeeId: r.id, values: JSON.parse(r.v) as number[], partial: !!r.p }));
}

// Écrit feature_snapshot (fsv courante) pour chaque fin de mois de [fromMonth, toMonth]. Les salariés opposés au
// traitement prédictif sont exclus (et leurs variables du mois effacées) : aucun réentraînement ne peut les lire.
export function backfillFeatures(
  sqlite: Database.Database,
  fromMonth: string,
  toMonth: string,
  opts: { onMonth?: (month: string, rows: number) => void } = {},
): number {
  const months = monthRange(fromMonth, toMonth);
  let total = 0;
  for (let i = 0; i < months.length; i += BACKFILL_CHUNK_MONTHS) {
    const chunk = months.slice(i, i + BACKFILL_CHUNK_MONTHS);
    const ds = loadDataset(
      sqlite,
      monthStart(addMonthsToMonth(chunk[0], -HISTORY_MONTHS)),
      monthEnd(chunk[chunk.length - 1]),
      windowsFor(monthEnd(chunk[0])),
    );
    for (const m of chunk) {
      const asOf = monthEnd(m);
      const n = writeSnapshots(sqlite, asOf, excludeOpposed(sqlite, computeMonth(ds, asOf)));
      total += n;
      opts.onMonth?.(m, n);
    }
  }
  return total;
}

// Sources chargées exactement comme pour computeFeatures : les surcouches (what-if) les ajustent avant computeMonth.
export function loadEmployeeDataset(sqlite: Database.Database, employeeId: number, asOf: string): ReturnType<typeof loadDataset> {
  checkDate(asOf);
  return loadDataset(sqlite, addMonths(asOf, -HISTORY_MONTHS), asOf, { employeeId, ...windowsFor(asOf) });
}

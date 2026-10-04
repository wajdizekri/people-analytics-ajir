import type Database from "better-sqlite3";

// Sans dépendance vers les variables : importable par src/lib/features (backfill) sans cycle.

export function opposedEmployeeIds(sqlite: Database.Database): Set<number> {
  const rows = sqlite.prepare("SELECT employee_id AS id FROM employee_opposition").all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

export function isOpposed(sqlite: Database.Database, employeeId: number): boolean {
  return !!sqlite.prepare("SELECT 1 AS ok FROM employee_opposition WHERE employee_id = ?").get(employeeId);
}

// Filtre générique pour toute liste individuelle avant calcul ou écriture (variables, scoring, étapes IA, export du panel)
export function excludeOpposed<T extends { employeeId: number }>(sqlite: Database.Database, rows: T[]): T[] {
  const opposed = opposedEmployeeIds(sqlite);
  return opposed.size ? rows.filter((r) => !opposed.has(r.employeeId)) : rows;
}

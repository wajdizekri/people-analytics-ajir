import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "@/db/client";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import type { AccessContext } from "@/lib/dal/context";

// Petite base calculable à la main. Historique importé à partir du 01/01/2024 (premier pointage), données au 31/08/2026.
// M (manager, embauché en 2015) > A1..A8 (Production, 04/03/2024), T (SIVP 2023 puis CDD 03/06/2024, Production),
//   B1..B3 (Commercial, 06/01/2025), C1..C3 (Qualité, 02/06/2025), S (SIVP seul), P (embauché en 2019, avant l'historique).
// Sorties de l'équipe de M : A1 démission et C1 licenciement à 183 jours, A2 fin de CDD à 365 jours, A6 démission à 610 jours,
//   A7 abandon à 638 jours ; A3 sortie le 20/08/2026 saisie le 03/09/2026 (invisible), A4 sortie prévue le 15/09/2026.
// Q (manager, hors périmètre de M) > Q1..Q6 (Production, 02/09/2024), Q1 démission à 183 jours.
// Z (manager) > Z1..Z3 (Commercial, 2025) : équipe trop petite.

export const DATA_END = "2026-08-31";
export const WINDOW_START = "2024-01-01";

export type Fixture = { file: string; ids: Record<string, number> };

export function createFixture(name: string): Fixture {
  const file = path.join(os.tmpdir(), `pa-retention-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const s = getDb().sqlite;
  migrate(drizzle(s), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(s);
  setSetting(s, "data_end_date", DATA_END);

  const dept: Record<string, number> = {};
  for (const [code, label] of [
    ["PROD", "Production"],
    ["COM", "Commercial"],
    ["QUA", "Qualité"],
  ])
    dept[code] = Number(s.prepare("INSERT INTO department (code, name) VALUES (?, ?)").run(code, label).lastInsertRowid);

  const ids: Record<string, number> = {};
  const insEmp = s.prepare(
    "INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id, job_family, birth_date) VALUES (?, ?, 'Test', ?, ?, ?, ?, '1990-01-01')",
  );
  const insContract = s.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, ?, ?)");
  const emp = (key: string, hire: string, d: string, manager: string | null, contracts: [string, string][] = [["CDI", hire]], family = "Production") => {
    ids[key] = Number(insEmp.run(`R-${key}`, `Nom${key}`, hire, dept[d], manager ? ids[manager] : null, family).lastInsertRowid);
    for (const [type, start] of contracts) insContract.run(ids[key], type, start);
  };
  const exit = (key: string, date: string, reason: string, recordedAt = date) => {
    s.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, ?, ?, ?)").run(ids[key], date, reason, recordedAt);
    s.prepare("UPDATE employee SET exit_date = ?, status = CASE WHEN ? <= ? THEN 'SORTI' ELSE 'ACTIF' END WHERE id = ?").run(date, date, DATA_END, ids[key]);
  };

  emp("M", "2015-03-02", "PROD", null);
  for (let i = 1; i <= 8; i++) emp(`A${i}`, "2024-03-04", "PROD", "M", [[i === 2 ? "CDD" : "CDI", "2024-03-04"]], i <= 4 ? "Production" : "Support");
  emp("T", "2023-06-05", "PROD", "M", [
    ["SIVP", "2023-06-05"],
    ["CDD", "2024-06-03"],
  ]);
  for (let i = 1; i <= 3; i++) emp(`B${i}`, "2025-01-06", "COM", "M", [["CDI", "2025-01-06"]], "Commercial");
  for (let i = 1; i <= 3; i++) emp(`C${i}`, "2025-06-02", "QUA", "M");
  emp("S", "2025-02-03", "PROD", "M", [["SIVP", "2025-02-03"]]);
  emp("P", "2019-05-06", "PROD", "M");
  emp("Q", "2016-04-04", "PROD", null);
  for (let i = 1; i <= 6; i++) emp(`Q${i}`, "2024-09-02", "PROD", "Q");
  emp("Z", "2017-01-02", "COM", null);
  for (let i = 1; i <= 3; i++) emp(`Z${i}`, "2025-04-07", "COM", "Z", [["CDI", "2025-04-07"]], "Commercial");

  exit("A1", "2024-09-02", "DEMISSION", "2024-08-02");
  exit("C1", "2025-12-01", "LICENCIEMENT");
  exit("A2", "2025-03-03", "FIN_CDD");
  exit("A6", "2025-11-03", "DEMISSION", "2025-10-03");
  exit("A7", "2025-12-01", "ABANDON", "2025-12-05");
  exit("A3", "2026-08-20", "DEMISSION", "2026-09-03");
  exit("A4", "2026-09-15", "DEMISSION", "2026-08-15");
  exit("Q1", "2025-03-03", "DEMISSION", "2025-02-03");

  s.prepare("INSERT INTO attendance_daily (employee_id, date, check_in, check_out, worked_minutes, overtime_minutes, late_minutes) VALUES (?, ?, '08:00', '17:00', 480, 0, 0)").run(
    ids.M,
    WINDOW_START,
  );
  return { file, ids };
}

export function cleanupFixture(file: string) {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

export const rh: AccessContext = { userId: 1, login: "rh.test", role: "RH", employeeId: null };
export const admin: AccessContext = { userId: 2, login: "admin.test", role: "ADMIN", employeeId: null };
export const manager = (employeeId: number): AccessContext => ({ userId: 3, login: "mgr.test", role: "MANAGER", employeeId });

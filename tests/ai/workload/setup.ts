import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite } from "@/db/client";
import { buildCalendar } from "@/lib/calendar";
import { monthRange } from "@/lib/dal/pilotage-metrics";
import { seedDefaultSettings } from "@/lib/settings";
import { promoteTopicModel, registerTopicModel } from "@/lib/ai/registry";

export const MODELS_ROOT = path.resolve(process.cwd(), "models", "workload");
export const latestBundleDir = () => {
  const versions = fs.readdirSync(MODELS_ROOT).filter((d) => fs.existsSync(path.join(MODELS_ROOT, d, "model.json"))).sort();
  return path.join(MODELS_ROOT, versions[versions.length - 1]);
};

export const AS_OF = "2026-08-31";
const FIRST = "2024-07";
const LAST = "2026-08";

export type Fixture = {
  file: string;
  deptA: number;
  deptB: number;
  head: number; // chef du département A, manager des managers A1 et A2
  mgrA1: number; // équipe de 6 (charge élevée)
  mgrA2: number; // équipe de 3 (trop petite)
  mgrB: number; // équipe de 5 (charge faible), autre hiérarchie
  overloaded: number; // surcharge soutenue
  opposed: number; // surcharge soutenue mais opposé au traitement prédictif
  version: string;
};

// Base temporaire : 2 départements, 3 équipes, 26 mois de pointages déterministes, modèle CHARGE_TRAVAIL promu
export function setupWorkloadDb(name: string): Fixture {
  const file = path.join(os.tmpdir(), `pa-workload-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const sqlite = openSqlite(file);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  seedDefaultSettings(sqlite);
  buildCalendar(sqlite, 2024, 2027);
  const fx = seed(sqlite);
  const row = registerTopicModel(sqlite, "CHARGE_TRAVAIL", latestBundleDir());
  promoteTopicModel(sqlite, row.version);
  sqlite.prepare("INSERT OR REPLACE INTO app_setting (key, value) VALUES ('data_end_date', ?)").run(AS_OF);
  sqlite.close();
  return { file, ...fx, version: row.version };
}

function seed(sqlite: Database.Database): Omit<Fixture, "file" | "version"> {
  const dept = sqlite.prepare("INSERT INTO department (code, name) VALUES (?, ?)");
  const deptA = Number(dept.run("DA", "Direction A").lastInsertRowid);
  const deptB = Number(dept.run("DB", "Direction B").lastInsertRowid);
  let n = 0;
  const emp = (d: number, mgr: number | null, first: string, last: string) =>
    Number(
      sqlite
        .prepare(
          `INSERT INTO employee (matricule, last_name, first_name, sex, birth_date, hire_date, department_id, job_family, grade, manager_id, status)
           VALUES (?, ?, ?, 'M', '1985-01-01', '2022-01-03', ?, 'IT', 'G3', ?, 'ACTIF')`,
        )
        .run(`W${++n}`, last, first, d, mgr).lastInsertRowid,
    );
  const head = emp(deptA, null, "Hela", "Chef");
  const mgrA1 = emp(deptA, head, "Amine", "Manager");
  const mgrA2 = emp(deptA, head, "Sonia", "Manager");
  const headB = emp(deptB, null, "Rim", "Chef");
  const mgrB = emp(deptB, headB, "Walid", "Manager");
  const teamA1 = Array.from({ length: 6 }, (_, i) => emp(deptA, mgrA1, `Membre${i}`, "EquipeA"));
  const teamA2 = Array.from({ length: 3 }, (_, i) => emp(deptA, mgrA2, `Petit${i}`, "EquipeA2"));
  const teamB = Array.from({ length: 5 }, (_, i) => emp(deptB, mgrB, `Membre${i}`, "EquipeB"));
  for (const id of [head, mgrA1, mgrA2, headB, mgrB, ...teamA1, ...teamA2, ...teamB])
    sqlite.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, 'CDI', '2022-01-03')").run(id);
  const overloaded = teamA1[0];
  const opposed = teamA1[1];
  sqlite.prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, '2026-01-10')").run(opposed);

  // Heures sup mensuelles visées (h) : équipe A1 chargée (~16 h, pic en fin d'année), A2 et B faibles ;
  // deux salariés de A1 au-delà de 20 h les 5 derniers mois
  const monthly = (id: number, m: string, k: number): number => {
    const recent = m >= "2026-04";
    if ((id === overloaded || id === opposed) && recent) return 26;
    if (teamA1.includes(id)) return 14 + (Number(m.slice(5, 7)) >= 9 ? 3 : 0) + (k % 3);
    if (teamB.includes(id)) return 4 + (k % 2);
    return 3;
  };
  const days = sqlite.prepare("SELECT date FROM dim_date WHERE date BETWEEN ? AND ? AND is_weekend = 0 AND is_holiday = 0 ORDER BY date");
  const ins = sqlite.prepare(
    "INSERT INTO attendance_daily (employee_id, date, check_in, check_out, worked_minutes, overtime_minutes, late_minutes) VALUES (?, ?, '08:00', '17:00', 480, ?, 0)",
  );
  sqlite.transaction(() => {
    monthRange(FIRST, LAST).forEach((m, k) => {
      const ds = (days.all(`${m}-01`, `${m}-31`) as { date: string }[]).map((r) => r.date);
      for (const id of [head, mgrA1, mgrA2, headB, mgrB, ...teamA1, ...teamA2, ...teamB]) {
        const total = Math.round(monthly(id, m, k) * 60);
        ds.forEach((d, i) => ins.run(id, d, Math.floor(total / ds.length) + (i < total % ds.length ? 1 : 0)));
      }
    });
  })();
  return { deptA, deptB, head, mgrA1, mgrA2, mgrB, overloaded, opposed };
}

export function cleanupWorkloadDb(file: string) {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } }; __paWorkload?: unknown };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  delete g.__paWorkload;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

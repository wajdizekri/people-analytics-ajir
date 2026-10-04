import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb, openSqlite } from "@/db/client";
import { seedDefaultSettings } from "@/lib/settings";
import type { AccessContext } from "@/lib/dal/context";
import { seedDevUi, type SeedResult } from "../../scripts/seed-dev-ui";

// Base temporaire propre à chaque fichier de test ; getDb() l'ouvre paresseusement via DATABASE_PATH
export async function setupSeededDb(name: string): Promise<{ file: string; seed: SeedResult }> {
  const file = path.join(os.tmpdir(), `pa-pilotage-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const sqlite = openSqlite(file);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  seedDefaultSettings(sqlite);
  const seed = await seedDevUi(sqlite);
  sqlite.close();
  return { file, seed };
}

export function cleanupDb(file: string) {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

export const rhCtx = (seed: SeedResult): AccessContext => ({ userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
export const managerCtx = (seed: SeedResult): AccessContext => ({
  userId: seed.managerUserId,
  login: "mgr.demo",
  role: "MANAGER",
  employeeId: seed.managerEmployeeId,
});

export const db = () => getDb().sqlite;

const FORBIDDEN_KEY = /salar|payroll|gross|compensation|masse|mass|prob|lift|contribution|phrase_?rh|estimate|modelVersion|modelKind|healthDays|absences|individual|comment|feedback/i;

// Parcours récursif : aucune clé sensible, aucune valeur égale à un montant ou une probabilité connus, aucune phrase chiffrée
export function findLeaks(value: unknown, sensitiveNumbers: number[], sensitiveStrings: string[], at = "$"): string[] {
  const leaks: string[] = [];
  const isSensitiveNumber = (n: number) => sensitiveNumbers.some((s) => Math.abs(s - n) < 1e-9);
  if (typeof value === "number") {
    if (isSensitiveNumber(value)) leaks.push(`${at} = ${value}`);
  } else if (typeof value === "string") {
    if (value.trim() !== "" && !Number.isNaN(Number(value)) && isSensitiveNumber(Number(value))) leaks.push(`${at} = "${value}"`);
    if (/TND/.test(value) || sensitiveStrings.some((s) => s && value.includes(s))) leaks.push(`${at} = "${value}"`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => leaks.push(...findLeaks(v, sensitiveNumbers, sensitiveStrings, `${at}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(k)) leaks.push(`${at}.${k} (clé interdite)`);
      leaks.push(...findLeaks(v, sensitiveNumbers, sensitiveStrings, `${at}.${k}`));
    }
  }
  return leaks;
}

export function sensitiveValues(employeeIds: number[]): { numbers: number[]; strings: string[] } {
  const s = db();
  const ids = JSON.stringify(employeeIds);
  const numbers = [
    ...(s.prepare(`SELECT base_salary AS v FROM payroll_monthly WHERE employee_id IN (SELECT value FROM json_each(?))`).all(ids) as { v: number }[]),
    ...(s.prepare(`SELECT gross_salary AS v FROM payroll_monthly WHERE employee_id IN (SELECT value FROM json_each(?))`).all(ids) as { v: number }[]),
    ...(s.prepare(`SELECT prob6 AS v FROM prediction WHERE employee_id IN (SELECT value FROM json_each(?))`).all(ids) as { v: number }[]),
    ...(s.prepare(`SELECT lift AS v FROM prediction WHERE employee_id IN (SELECT value FROM json_each(?))`).all(ids) as { v: number }[]),
    ...(s.prepare(`SELECT payroll_mass AS v FROM agg_kpi_monthly`).all() as { v: number }[]),
  ]
    .map((r) => r.v)
    .filter((v) => v !== 0 && !Number.isInteger(v));
  const oldNew = s
    .prepare(`SELECT old_value AS a, new_value AS b FROM career_event WHERE type = 'AUGMENTATION' AND employee_id IN (SELECT value FROM json_each(?))`)
    .all(ids) as { a: string; b: string }[];
  numbers.push(...oldNew.flatMap((r) => [Number(r.a), Number(r.b)]));
  const strings = (
    s.prepare(`SELECT DISTINCT f.phrase_rh AS p FROM prediction_factor f JOIN prediction p ON p.id = f.prediction_id WHERE p.employee_id IN (SELECT value FROM json_each(?))`).all(ids) as {
      p: string;
    }[]
  ).map((r) => r.p);
  return { numbers, strings };
}

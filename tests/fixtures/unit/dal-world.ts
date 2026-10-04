import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "@/db/client";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import type { AccessContext } from "@/lib/dal/context";
import { Fixture, type EmpInput } from "../engine/db";

export const REF = "2025-06-30";

// Base temporaire propre au fichier de test, dans son propre dossier (la boîte de dépôt des imports est à côté) ;
// getDb() (utilisé par la DAL) l'ouvre via DATABASE_PATH.
export function openDalDb(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pa-unit-${name}-`));
  const file = path.join(dir, "test.db");
  process.env.DATABASE_PATH = file;
  const g = globalThis as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  g.__paDb = undefined;
  const { sqlite } = getDb();
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  seedDefaultSettings(sqlite);
  return {
    sqlite,
    file,
    dir,
    close: () => {
      g.__paDb?.sqlite.close();
      g.__paDb = undefined;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

type Ctx = "admin" | "rh" | "mgr" | "mgr2" | "sub" | "orphan";

// Hiérarchie : DG > MGR > (T1..T5, SUB > (S1, S2)) ; DG > MGR2 > X1. Départements PROD (MGR) et COM (MGR2).
// T5 : CDD en cours ; T4 : sorti (démission) ; X1 : contrat STAGE. Données au REF (2025-06-30).
export function buildWorld(sqlite: ReturnType<typeof openDalDb>["sqlite"]) {
  const fx = new Fixture(sqlite);
  const prod = fx.dept("PROD", "Production");
  const com = fx.dept("COM", "Commercial");
  const e: Record<string, number> = {};
  const add = (m: string, o: Partial<EmpInput>) => (e[m] = fx.emp({ matricule: m, hire: "2018-01-01", dept: prod, ...o }));
  add("DG", { hire: "2005-01-01", birth: "1965-01-01", grade: "G8" });
  add("MGR", { hire: "2010-03-01", birth: "1975-01-01", grade: "G6", managerId: e.DG });
  add("T1", { hire: "2023-09-15", birth: "1998-02-01", managerId: e.MGR });
  add("T2", { hire: "2019-05-01", birth: "1990-06-01", managerId: e.MGR });
  add("T3", { hire: "2012-01-01", birth: "1970-01-01", managerId: e.MGR });
  add("T4", { hire: "2016-01-01", birth: "1985-01-01", managerId: e.MGR });
  add("T5", { hire: "2024-11-01", birth: "1995-01-01", managerId: e.MGR, contract: { type: "CDD", end: "2025-12-31" } });
  add("SUB", { hire: "2014-01-01", birth: "1980-01-01", managerId: e.MGR });
  add("S1", { hire: "2021-01-01", birth: "1992-01-01", managerId: e.SUB });
  add("S2", { hire: "2021-01-01", birth: "1993-01-01", managerId: e.SUB });
  add("MGR2", { hire: "2011-01-01", dept: com, managerId: e.DG });
  add("X1", { hire: "2024-01-01", dept: com, managerId: e.MGR2, contract: { type: "STAGE" } });
  fx.exit(e.T4, "2025-03-31", "DEMISSION", { resignation: "2025-03-01", recordedAt: "2025-03-02" });
  sqlite.prepare("UPDATE employee SET last_name = 'Ben_Ali%', first_name = 'Sami' WHERE id = ?").run(e.T2);

  const user = (login: string, role: string, employeeId: number | null) =>
    Number(sqlite.prepare("INSERT INTO app_user (login, password_hash, role, employee_id) VALUES (?, 'x', ?, ?)").run(login, role, employeeId).lastInsertRowid);
  const users = {
    admin: user("admin", "ADMIN", null),
    rh: user("rh", "RH", null),
    mgr: user("mgr", "MANAGER", e.MGR),
    mgr2: user("mgr2", "MANAGER", e.MGR2),
    sub: user("sub", "MANAGER", e.SUB),
    orphan: user("orphan", "MANAGER", null),
  };
  const ctx = Object.fromEntries(
    (Object.keys(users) as Ctx[]).map((k) => [
      k,
      {
        userId: users[k],
        login: k,
        role: k === "admin" ? "ADMIN" : k === "rh" ? "RH" : "MANAGER",
        employeeId: { mgr: e.MGR, mgr2: e.MGR2, sub: e.SUB }[k as "mgr"] ?? null,
      } satisfies AccessContext,
    ]),
  ) as Record<Ctx, AccessContext>;
  setSetting(sqlite, "data_end_date", REF);
  return { fx, dept: { prod, com }, e, users, ctx };
}

// Run publié à la main : niveaux, scores et facteurs maîtrisés.
export function publishRun(
  sqlite: ReturnType<typeof openDalDb>["sqlite"],
  kind: "B0" | "LOGREG",
  asOf: string,
  preds: { employeeId: number; level: "ELEVE" | "MOYEN" | "FAIBLE"; prob6: number; lift: number; factors?: { group: string; phraseRh?: string | null; phraseManager?: string | null; contribution?: number }[] }[],
  opts: { current?: boolean; status?: "PUBLIE" | "STAGING" | "ECHEC"; version?: string } = {},
): number {
  const version = opts.version ?? `${kind.toLowerCase()}-${asOf}`;
  const existing = sqlite.prepare("SELECT id FROM model_version WHERE version = ?").get(version) as { id: number } | undefined;
  const modelId =
    existing?.id ?? Number(sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES (?, ?, 'RETIRE', 'v1')").run(version, kind).lastInsertRowid);
  if (opts.current ?? true) {
    sqlite.prepare("UPDATE model_version SET status = 'RETIRE' WHERE status = 'CHAMPION'").run();
    sqlite.prepare("UPDATE model_version SET status = 'CHAMPION' WHERE id = ?").run(modelId);
  }
  const runId = Number(
    sqlite
      .prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored, finished_at) VALUES (?, ?, ?, ?, '2025-07-01T00:00:00.000Z')")
      .run(asOf, modelId, opts.status ?? "PUBLIE", preds.length).lastInsertRowid,
  );
  const insP = sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insF = sqlite.prepare(
    "INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction, phrase_rh, phrase_manager) VALUES (?, ?, ?, ?, 'HAUSSE', ?, ?)",
  );
  preds.forEach((p, i) => {
    const pid = Number(insP.run(runId, p.employeeId, asOf, p.prob6, p.level, i + 1, p.lift, modelId).lastInsertRowid);
    (p.factors ?? []).forEach((f, j) => insF.run(pid, f.group, f.contribution ?? 1 - j / 10, j + 1, f.phraseRh ?? null, f.phraseManager ?? null));
  });
  if (opts.current ?? true) setSetting(sqlite, "current_run_id", String(runId));
  return runId;
}

export function expectHttp(fn: () => unknown, status: number, code?: string): void {
  let err: unknown = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  const h = err as { status?: number; code?: string } | null;
  if (!h || h.status !== status || (code && h.code !== code)) throw new Error(`HttpError ${status}${code ? ` ${code}` : ""} attendue, obtenu : ${String(err)}`);
}

export async function expectHttpAsync(fn: () => Promise<unknown>, status: number, code?: string): Promise<void> {
  let err: unknown = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  const h = err as { status?: number; code?: string } | null;
  if (!h || h.status !== status || (code && h.code !== code)) throw new Error(`HttpError ${status}${code ? ` ${code}` : ""} attendue, obtenu : ${String(err)}`);
}

export const auditOf = (sqlite: ReturnType<typeof openDalDb>["sqlite"], action: string) =>
  sqlite.prepare("SELECT user_id AS userId, target_type AS targetType, target_id AS targetId, outcome, detail_json AS detail, ip FROM audit_log WHERE action = ? ORDER BY id").all(action) as {
    userId: number | null;
    targetType: string | null;
    targetId: string | null;
    outcome: string;
    detail: string | null;
    ip: string | null;
  }[];

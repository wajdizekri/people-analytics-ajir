import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb, openSqlite } from "@/db/client";
import { promoteTopicModel, registerTopicModel } from "@/lib/ai/registry";
import type { AccessContext } from "@/lib/dal/context";
import { seedDefaultSettings } from "@/lib/settings";
import { seedDevUi, type SeedResult } from "../../../scripts/seed-dev-ui";

const MODELS = path.resolve(process.cwd(), "models", "workforce");
export const latestBundle = (prefix: string) =>
  path.join(
    MODELS,
    fs
      .readdirSync(MODELS)
      .filter((d) => d.startsWith(prefix) && fs.existsSync(path.join(MODELS, d, "model.json")))
      .sort()
      .at(-1)!,
  );

// Base de démonstration temporaire (3 départements, run LOGREG publié au 2026-08-31) + modèles EFFECTIF et MASSE promus
export async function setupWorkforceDb(name: string): Promise<{ file: string; seed: SeedResult }> {
  const file = path.join(os.tmpdir(), `pa-wf-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const sqlite = openSqlite(file);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  seedDefaultSettings(sqlite);
  const seed = await seedDevUi(sqlite);
  for (const [topic, prefix] of [
    ["EFFECTIF", "effectif-"],
    ["MASSE_SALARIALE", "masse-"],
  ] as const) {
    const row = registerTopicModel(sqlite, topic, latestBundle(prefix));
    promoteTopicModel(sqlite, row.version);
  }
  sqlite.close();
  return { file, seed };
}

export function cleanupDb(file: string) {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

export const db = () => getDb().sqlite;
export const rhCtx = (seed: SeedResult): AccessContext => ({ userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
export const managerCtx = (seed: SeedResult): AccessContext => ({ userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId });
export const adminCtx = (seed: SeedResult): AccessContext => ({ userId: seed.rhUserId, login: "admin.demo", role: "ADMIN", employeeId: null });

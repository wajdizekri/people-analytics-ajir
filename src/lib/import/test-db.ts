import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite } from "@/db/client";
import { seedDefaultSettings } from "@/lib/settings";

export const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/ajir-mini");

// Base SQLite temporaire migrée, pour les tests Vitest
export function tempDb(): { sqlite: Database.Database; dir: string; close: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-import-"));
  const sqlite = openSqlite(path.join(dir, "test.db"));
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  seedDefaultSettings(sqlite);
  return {
    sqlite,
    dir,
    close: () => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Copie de la mini-fixture dans un dossier temporaire, avec remplacement éventuel de fichiers
export function fixtureCopy(root: string, name: string, overrides: Record<string, string | null> = {}): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(FIXTURE_DIR)) fs.copyFileSync(path.join(FIXTURE_DIR, f), path.join(dir, f));
  for (const [f, content] of Object.entries(overrides)) {
    if (content === null) fs.rmSync(path.join(dir, f), { force: true });
    else fs.writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

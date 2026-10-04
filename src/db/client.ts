import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

export function dbPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "app.db"));
}

export function openSqlite(file = dbPath(), opts: { readonly?: boolean } = {}): Database.Database {
  if (!opts.readonly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file, { readonly: opts.readonly ?? false });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

const g = globalThis as unknown as { __paDb?: { sqlite: Database.Database; db: DB } };

export function getDb(): { sqlite: Database.Database; db: DB } {
  if (!g.__paDb) {
    const sqlite = openSqlite();
    g.__paDb = { sqlite, db: drizzle(sqlite, { schema }) };
  }
  return g.__paDb;
}

export { schema };

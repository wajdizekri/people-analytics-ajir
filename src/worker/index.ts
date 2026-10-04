import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dbPath, openSqlite } from "../db/client";
import { logger } from "../lib/logger";
import { seedDefaultSettings } from "../lib/settings";
import { onStopSignals, startWorker } from "./run";

async function main() {
  const log = logger.child({ component: "worker" });
  const sqlite = openSqlite();
  try {
    migrate(drizzle(sqlite), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    seedDefaultSettings(sqlite);
  } catch (e) {
    sqlite.close();
    throw e;
  }
  log.info({ db: dbPath(), pid: process.pid }, "worker démarré");
  const worker = startWorker(sqlite, log);
  const off = onStopSignals(worker, log);
  try {
    await worker.done;
  } finally {
    off();
  }
}

main().catch((e) => {
  logger.error({ err: e }, "worker interrompu");
  process.exit(1);
});

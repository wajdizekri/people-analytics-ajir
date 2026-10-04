import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite, dbPath } from "../src/db/client";
import { seedDefaultSettings } from "../src/lib/settings";

const sqlite = openSqlite();
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
seedDefaultSettings(sqlite);
console.log(`Migrations appliquées sur ${dbPath()}`);
sqlite.close();

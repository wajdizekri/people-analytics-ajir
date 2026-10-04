import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqlite } from "@/db/client";
import { seedDefaultSettings } from "@/lib/settings";
import { applyRetention, databaseInUse, integrityCheck, listBackups, parseStamp, runBackup, stamp, DB_FILE, MANIFEST_FILE } from "../../scripts/backup";
import { RestoreRefused, pendingMigrations, runRestore } from "../../scripts/restore";

let work: string;
let dbFile: string;
let backups: string;

function seed(file: string) {
  const sqlite = openSqlite(file);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(sqlite);
  const dept = Number(sqlite.prepare("INSERT INTO department (code, name) VALUES ('PROD', 'Production')").run().lastInsertRowid);
  const ins = sqlite.prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id) VALUES (?, ?, 'Test', '2020-01-01', ?)");
  for (let i = 0; i < 200; i++) ins.run(`M${i}`, `Nom ${i}`, dept);
  const admin = Number(sqlite.prepare("INSERT INTO app_user (login, password_hash, role) VALUES ('admin', 'x', 'ADMIN')").run().lastInsertRowid);
  sqlite.prepare("INSERT INTO session (id, user_id, expires_at) VALUES ('s1', ?, '2099-01-01T00:00:00Z')").run(admin);
  sqlite.prepare("INSERT INTO audit_log (user_id, action, outcome) VALUES (?, 'test.seed', 'OK')").run(admin);
  return sqlite;
}

function dump(file: string, exclude: string[] = []): Record<string, unknown[]> {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all() as string[];
    const out: Record<string, unknown[]> = {};
    for (const t of tables.filter((t) => !exclude.includes(t))) out[t] = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
    return out;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "pa-ops-"));
  dbFile = path.join(work, "data", "app.db");
  backups = path.join(work, "backups");
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("sauvegarde à chaud", () => {
  it("copie cohérente, manifeste et contrôle d'intégrité ; une transaction non validée n'est pas copiée", () => {
    const sqlite = seed(dbFile);
    sqlite.prepare("BEGIN IMMEDIATE").run();
    sqlite.prepare("INSERT INTO department (code, name) VALUES ('NONVALIDE', 'x')").run();

    const r = runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 30, 1, 0, 0) });
    sqlite.prepare("COMMIT").run();

    expect(r.name).toBe("2026-09-30_010000");
    expect(fs.existsSync(path.join(r.dir, DB_FILE))).toBe(true);
    expect(integrityCheck(r.file)).toEqual(["ok"]);
    const manifest = JSON.parse(fs.readFileSync(path.join(r.dir, MANIFEST_FILE), "utf8"));
    expect(manifest).toMatchObject({ integrity: "ok", kind: "quotidienne", migrations: { applied: expect.any(Number) } });
    expect(manifest.tables.employee).toBe(200);
    expect(manifest.tables.department).toBe(1);
    expect(fs.readdirSync(backups).filter((n) => n.startsWith(".en-cours"))).toEqual([]);
    expect(fs.readFileSync(path.join(backups, "sauvegardes.log"), "utf8")).toMatch(/OK 2026-09-30_010000/);
    sqlite.close();
  });

  it("refuse une base absente sans laisser de dossier partiel", () => {
    expect(() => runBackup({ db: path.join(work, "absente.db"), dir: backups })).toThrow(/introuvable/);
    expect(listBackups(backups)).toEqual([]);
    expect(fs.readdirSync(backups)).toEqual(["sauvegardes.log"]);
    expect(fs.readFileSync(path.join(backups, "sauvegardes.log"), "utf8")).toMatch(/ECHEC .*introuvable/);
  });
});

describe("restauration", () => {
  it("sauvegarde puis restauration : données identiques, copie de sécurité, sessions invalidées, restauration auditée", async () => {
    const sqlite = seed(dbFile);
    sqlite.close();
    const before = dump(dbFile);
    const b = runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 30, 1, 0, 0) });

    const w = openSqlite(dbFile);
    w.prepare("UPDATE app_setting SET value = '0.5' WHERE key = 'capacity_rate'").run();
    w.prepare("DELETE FROM employee WHERE matricule LIKE 'M1%'").run();
    w.prepare("INSERT INTO department (code, name) VALUES ('NEW', 'Après sauvegarde')").run();
    w.close();
    expect(dump(dbFile)).not.toEqual(before);

    const r = await runRestore({ backup: b.name, db: dbFile, dir: backups, url: null, now: new Date(2026, 8, 30, 9, 15, 0) });

    const after = dump(dbFile);
    const { session: s0, audit_log: a0, ...restBefore } = before;
    const { session: s1, audit_log: a1, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(s0).toHaveLength(1);
    expect(s1).toEqual([]);
    expect(a1.slice(0, a0.length)).toEqual(a0);
    expect(a1.slice(a0.length)).toEqual([expect.objectContaining({ action: "backup.restore", outcome: "OK", target_id: b.name })]);
    expect(integrityCheck(dbFile)).toEqual(["ok"]);
    expect(r.pendingMigrations).toBe(0);
    expect(pendingMigrations(r.migrations)).toBe(0);

    expect(r.safetyCopy).toBe(path.join(backups, "2026-09-30_091500_avant-restauration"));
    const safety = dump(path.join(r.safetyCopy!, DB_FILE));
    expect(safety.department).toHaveLength(2);
    expect(safety.app_setting).toContainEqual(expect.objectContaining({ key: "capacity_rate", value: "0.5" }));
    expect(fs.existsSync(`${dbFile}-wal`) && fs.statSync(`${dbFile}-wal`).size > 0).toBe(false);
  });

  it("« derniere » choisit la sauvegarde quotidienne la plus récente ; restauration possible sans base existante", async () => {
    const sqlite = seed(dbFile);
    sqlite.close();
    runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 28, 1, 0, 0) });
    const w = openSqlite(dbFile);
    w.prepare("INSERT INTO department (code, name) VALUES ('J29', 'x')").run();
    w.close();
    runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 29, 1, 0, 0) });

    const fresh = path.join(work, "neuf", "app.db");
    const r = await runRestore({ backup: "derniere", db: fresh, dir: backups, url: null });
    expect(r.safetyCopy).toBeNull();
    expect(r.source).toContain("2026-09-29_010000");
    expect(dump(fresh).department).toHaveLength(2);
  });

  it("refuse si la base est ouverte par un autre processus (service web ou worker) et la laisse intacte", async () => {
    const sqlite = seed(dbFile);
    const b = runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 30, 1, 0, 0) });
    sqlite.prepare("INSERT INTO department (code, name) VALUES ('VIVANT', 'x')").run();
    expect(databaseInUse(dbFile)).toBe(true);

    await expect(runRestore({ backup: b.name, db: dbFile, dir: backups, url: null })).rejects.toThrow(RestoreRefused);
    expect((sqlite.prepare("SELECT count(*) FROM department").pluck().get() as number)).toBe(2);
    expect(listBackups(backups).map((x) => x.name)).toEqual([b.name]);
    sqlite.close();
    expect(databaseInUse(dbFile)).toBe(false);
  });

  it("refuse une sauvegarde altérée (sha256) ou corrompue (integrity_check) sans toucher la base courante", async () => {
    const sqlite = seed(dbFile);
    sqlite.close();
    const b = runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 30, 1, 0, 0) });
    const before = dump(dbFile);

    const size = fs.statSync(b.file).size;
    const fd = fs.openSync(b.file, "r+");
    fs.writeSync(fd, Buffer.alloc(8192, 0xab), 0, 8192, Math.floor(size / 2 / 4096) * 4096);
    fs.closeSync(fd);

    await expect(runRestore({ backup: b.name, db: dbFile, dir: backups, url: null })).rejects.toThrow(/sha256/);
    fs.rmSync(path.join(b.dir, MANIFEST_FILE));
    await expect(runRestore({ backup: b.name, db: dbFile, dir: backups, url: null })).rejects.toThrow(RestoreRefused);

    expect(dump(dbFile)).toEqual(before);
    expect(listBackups(backups).map((x) => x.name)).toEqual([b.name]);
  });

  it("refuse si le service web répond encore à l'adresse sondée", async () => {
    const sqlite = seed(dbFile);
    sqlite.close();
    const b = runBackup({ db: dbFile, dir: backups, now: new Date(2026, 8, 30, 1, 0, 0) });
    const http = await import("node:http");
    const server = http.createServer((_, res) => res.end("{}"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(runRestore({ backup: b.name, db: dbFile, dir: backups, url: `http://127.0.0.1:${port}` })).rejects.toThrow(/répond encore/);
      await expect(runRestore({ backup: b.name, db: dbFile, dir: backups, url: `http://127.0.0.1:${port}`, force: true })).resolves.toMatchObject({ target: dbFile });
    } finally {
      server.close();
    }
  });
});

describe("rétention", () => {
  const mk = (name: string) => {
    fs.mkdirSync(path.join(backups, name), { recursive: true });
    fs.writeFileSync(path.join(backups, name, DB_FILE), "x");
  };

  it("supprime les sauvegardes au-delà de N jours, garde les autres dossiers", () => {
    const now = new Date(2026, 8, 30, 2, 0, 0);
    const day = (n: number) => stamp(new Date(now.getTime() - n * 86_400_000));
    const names = [day(0), day(10), day(29), day(31), `${day(45)}_avant-restauration`, day(90)];
    names.forEach(mk);
    fs.mkdirSync(path.join(backups, "archives-manuelles"));
    fs.mkdirSync(path.join(backups, ".en-cours-ancien"));
    fs.utimesSync(path.join(backups, ".en-cours-ancien"), new Date(2026, 0, 1), new Date(2026, 0, 1));

    const removed = applyRetention(backups, 30, now);

    expect(removed.sort()).toEqual([day(31), `${day(45)}_avant-restauration`, day(90), ".en-cours-ancien"].sort());
    expect(fs.readdirSync(backups).sort()).toEqual([day(0), day(10), day(29), "archives-manuelles"].sort());
  });

  it("ne supprime jamais la sauvegarde la plus récente ; 0 jour = rétention désactivée", () => {
    const now = new Date(2026, 8, 30);
    mk("2026-01-01_010000");
    mk("2025-12-31_010000");
    expect(applyRetention(backups, 0, now)).toEqual([]);
    expect(applyRetention(backups, 30, now)).toEqual(["2025-12-31_010000"]);
    expect(listBackups(backups).map((b) => b.name)).toEqual(["2026-01-01_010000"]);
  });

  it("la sauvegarde applique la rétention après succès", () => {
    const sqlite = seed(dbFile);
    sqlite.close();
    mk("2026-07-01_010000");
    const r = runBackup({ db: dbFile, dir: backups, retentionDays: 30, now: new Date(2026, 8, 30, 1, 0, 0) });
    expect(r.removed).toEqual(["2026-07-01_010000"]);
    expect(listBackups(backups).map((b) => b.name)).toEqual(["2026-09-30_010000"]);
  });

  it("horodatage : aller-retour nom ↔ date locale", () => {
    const d = new Date(2026, 1, 3, 4, 5, 6);
    expect(stamp(d)).toBe("2026-02-03_040506");
    expect(parseStamp("2026-02-03_040506")?.getTime()).toBe(d.getTime());
    expect(parseStamp("2026-02-03_040506_avant-restauration")?.getTime()).toBe(d.getTime());
    expect(parseStamp("sauvegarde")).toBeNull();
  });
});

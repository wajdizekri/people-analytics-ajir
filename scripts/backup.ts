import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "../src/db/client";

const USAGE = `Usage : npx tsx scripts/backup.ts [--db <fichier>] [--dir <dossier>] [--retention <jours>]
  --db         base à sauvegarder (défaut : DATABASE_PATH, sinon data/app.db)
  --dir        dossier des sauvegardes (défaut : BACKUP_DIR, sinon <dossier de la base>/backups)
  --retention  supprime les sauvegardes de plus de N jours (défaut : BACKUP_RETENTION_DAYS, sinon 30 ; 0 = aucune suppression)
Copie à chaud cohérente (VACUUM INTO, lecture seule), contrôle PRAGMA integrity_check sur la copie, manifeste sha256,
journal ajouté à <dossier>/sauvegardes.log. Le fichier .env du dossier courant est lu s'il existe.`;

export const DB_FILE = "app.db";
export const MANIFEST_FILE = "manifest.json";
export const LOG_FILE = "sauvegardes.log";
export const DEFAULT_RETENTION_DAYS = 30;
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:_([a-z0-9-]+))?$/;
const PARTIAL_PREFIX = ".en-cours-";

export type Manifest = {
  name: string;
  kind: "quotidienne" | "avant-restauration";
  createdAt: string;
  source: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  integrity: string;
  sqliteVersion: string;
  migrations: { applied: number; lastCreatedAt: number | null } | null;
  tables: Record<string, number>;
  durationMs: number;
};

export type BackupInfo = { name: string; dir: string; date: Date; manifest: Manifest | null };

export function loadDotEnv(cwd = process.cwd()): boolean {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

export function backupRoot(db = dbPath()): string {
  return path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(db)), "backups"));
}

export function retentionDays(): number {
  const v = process.env.BACKUP_RETENTION_DAYS;
  if (v === undefined || v === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`BACKUP_RETENTION_DAYS invalide : ${v} (entier >= 0 attendu).`);
  return n;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Nom horodaté en heure locale du serveur : 2026-09-30_010000
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function parseStamp(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sha256File(file: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

// Renvoie ["ok"] si la base est saine, sinon la liste des anomalies (tronquée à 20).
export function integrityCheck(file: string, mode: "integrity_check" | "quick_check" = "integrity_check"): string[] {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare(`PRAGMA ${mode}(20)`).pluck().all() as string[]).map(String);
  } finally {
    db.close();
  }
}

export function tableCounts(db: Database.Database): Record<string, number> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .pluck()
    .all() as string[];
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = db.prepare(`SELECT count(*) FROM "${t.replace(/"/g, '""')}"`).pluck().get() as number;
  return out;
}

export function migrationsState(db: Database.Database): Manifest["migrations"] {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!exists) return null;
  const r = db.prepare("SELECT count(*) AS n, max(created_at) AS last FROM __drizzle_migrations").get() as { n: number; last: number | null };
  return { applied: r.n, lastCreatedAt: r.last == null ? null : Number(r.last) };
}

// Sonde de verrou : une connexion ouverte par un autre processus (web, worker, CLI) détient un verrou partagé
// sur une base WAL ; une demande de verrou exclusif sans attente échoue alors en SQLITE_BUSY.
export function databaseInUse(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 0");
    db.pragma("locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
    return false;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
    throw e;
  } finally {
    db.close();
  }
}

export function readManifest(dir: string): Manifest | null {
  const f = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

// Sauvegardes complètes (dossiers horodatés), de la plus récente à la plus ancienne.
export function listBackups(root: string): BackupInfo[] {
  if (!fs.existsSync(root)) return [];
  const out: BackupInfo[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const date = parseStamp(e.name);
    if (!date) continue;
    const dir = path.join(root, e.name);
    out.push({ name: e.name, dir, date, manifest: readManifest(dir) });
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime() || b.name.localeCompare(a.name));
}

// Supprime les sauvegardes plus anciennes que `days` jours (jamais la plus récente) et les copies interrompues de plus d'un jour.
export function applyRetention(root: string, days: number, now = new Date()): string[] {
  if (days <= 0 || !fs.existsSync(root)) return [];
  const cutoff = now.getTime() - days * 86_400_000;
  const removed: string[] = [];
  listBackups(root)
    .slice(1)
    .filter((b) => b.date.getTime() < cutoff)
    .forEach((b) => {
      fs.rmSync(b.dir, { recursive: true, force: true });
      removed.push(b.name);
    });
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith(PARTIAL_PREFIX)) continue;
    const dir = path.join(root, e.name);
    if (fs.statSync(dir).mtimeMs < now.getTime() - 86_400_000) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(e.name);
    }
  }
  return removed;
}

export function appendLog(root: string, line: string) {
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(path.join(root, LOG_FILE), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // le journal ne doit jamais faire échouer la sauvegarde
  }
}

export type BackupOptions = {
  db?: string;
  dir?: string;
  retentionDays?: number;
  now?: Date;
  suffix?: "avant-restauration";
  log?: (msg: string) => void;
};

export type BackupResult = { name: string; dir: string; file: string; manifest: Manifest; removed: string[]; timings: Record<string, number> };

export function runBackup(opts: BackupOptions = {}): BackupResult {
  const log = opts.log ?? (() => {});
  const source = path.resolve(opts.db ?? dbPath());
  const root = path.resolve(opts.dir ?? backupRoot(source));
  const now = opts.now ?? new Date();
  const name = opts.suffix ? `${stamp(now)}_${opts.suffix}` : stamp(now);
  const finalDir = path.join(root, name);
  const tmpDir = path.join(root, `${PARTIAL_PREFIX}${name}`);
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  const step = <T>(key: string, fn: () => T): T => {
    const t = performance.now();
    const r = fn();
    timings[key] = performance.now() - t;
    return r;
  };

  const tmpFile = path.join(tmpDir, DB_FILE);
  try {
    if (!fs.existsSync(source)) throw new Error(`Base introuvable : ${source}`);
    if (fs.existsSync(finalDir)) throw new Error(`La sauvegarde ${finalDir} existe déjà.`);
    fs.mkdirSync(tmpDir, { recursive: true });
    step("copie", () => {
      const src = new Database(source, { readonly: true, fileMustExist: true });
      try {
        src.pragma("busy_timeout = 30000");
        src.prepare("VACUUM INTO ?").run(tmpFile);
      } finally {
        src.close();
      }
    });

    const meta = step("contrôle", () => {
      const copy = new Database(tmpFile, { fileMustExist: true });
      try {
        copy.pragma("journal_mode = DELETE");
        const integrity = (copy.prepare("PRAGMA integrity_check(20)").pluck().all() as string[]).map(String);
        return {
          integrity,
          sqliteVersion: copy.prepare("SELECT sqlite_version()").pluck().get() as string,
          migrations: migrationsState(copy),
          tables: tableCounts(copy),
        };
      } finally {
        copy.close();
      }
    });
    if (meta.integrity.join() !== "ok") throw new Error(`Copie corrompue (integrity_check) : ${meta.integrity.join(" ; ")}`);

    const sha256 = step("empreinte", () => sha256File(tmpFile));
    const manifest: Manifest = {
      name,
      kind: opts.suffix ?? "quotidienne",
      createdAt: now.toISOString(),
      source,
      file: DB_FILE,
      sizeBytes: fs.statSync(tmpFile).size,
      sha256,
      integrity: "ok",
      sqliteVersion: meta.sqliteVersion,
      migrations: meta.migrations,
      tables: meta.tables,
      durationMs: Math.round(performance.now() - t0),
    };
    fs.writeFileSync(path.join(tmpDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");
    fs.renameSync(tmpDir, finalDir);

    const removed = step("rétention", () => (opts.suffix ? [] : applyRetention(root, opts.retentionDays ?? retentionDays(), now)));
    manifest.durationMs = Math.round(performance.now() - t0);
    fs.writeFileSync(path.join(finalDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");
    appendLog(
      root,
      `OK ${name} ${fmtBytes(manifest.sizeBytes)} ${fmtMs(manifest.durationMs)} integrity_check=ok sha256=${sha256.slice(0, 16)}` +
        (removed.length ? ` supprimées=${removed.join(",")}` : ""),
    );
    log(`Sauvegarde ${name} : ${source} → ${finalDir}`);
    return { name, dir: finalDir, file: path.join(finalDir, DB_FILE), manifest, removed, timings };
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    appendLog(root, `ECHEC ${name} ${(e as Error).message}`);
    throw e;
  }
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} Go`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} Mo`;
  return `${Math.max(1, Math.round(n / 1024))} Ko`;
}

export function fmtMs(ms: number): string {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1).replace(".", ",")} min` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function parseArgs(argv: string[]) {
  const out: { db?: string; dir?: string; retention?: number; help: boolean } = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--db" || a === "--dir" || a === "--retention") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} attend une valeur.\n${USAGE}`);
      if (a === "--retention") {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) throw new Error(`--retention attend un nombre de jours entier >= 0 (reçu : ${v}).`);
        out.retention = n;
      } else out[a === "--db" ? "db" : "dir"] = v;
    } else throw new Error(`Option inconnue : ${a}\n${USAGE}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);
  const envLoaded = loadDotEnv();
  const db = path.resolve(args.db ?? dbPath());
  const root = path.resolve(args.dir ?? backupRoot(db));
  const days = args.retention ?? retentionDays();
  try {
    const r = runBackup({ db, dir: root, retentionDays: days });
    const m = r.manifest;
    const t = (k: string) => fmtMs(r.timings[k] ?? 0);
    console.log(`Sauvegarde ${r.name}${envLoaded ? " (variables lues dans .env)" : ""}`);
    console.log(`  base        ${db}`);
    console.log(`  copie       ${r.file}`);
    console.log(`  taille      ${fmtBytes(m.sizeBytes)} — ${Object.keys(m.tables).length} tables, migrations appliquées : ${m.migrations?.applied ?? "?"}`);
    console.log(`  intégrité   ok (integrity_check)`);
    console.log(`  sha256      ${m.sha256}`);
    console.log(`  rétention   ${days ? `${days} jours` : "désactivée"} — ${r.removed.length ? `supprimées : ${r.removed.join(", ")}` : "aucune suppression"}`);
    console.log(`  durées      copie ${t("copie")} · contrôle ${t("contrôle")} · empreinte ${t("empreinte")} · total ${fmtMs(m.durationMs)}`);
    console.log(`  journal     ${path.join(root, LOG_FILE)}`);
  } catch (e) {
    console.error(`ÉCHEC de la sauvegarde : ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 2;
  }
}

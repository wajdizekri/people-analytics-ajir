import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "../src/db/client";
import {
  DB_FILE,
  MANIFEST_FILE,
  appendLog,
  backupRoot,
  databaseInUse,
  fmtBytes,
  fmtMs,
  integrityCheck,
  listBackups,
  loadDotEnv,
  migrationsState,
  readManifest,
  sha256File,
  stamp,
  tableCounts,
  type Manifest,
} from "./backup";

const USAGE = `Usage :
  npx tsx scripts/restore.ts --list [--dir <dossier>]
  npx tsx scripts/restore.ts <sauvegarde> [--db <fichier>] [--dir <dossier>] [--url <http://127.0.0.1:3000> | --url none] [--force]

  <sauvegarde>  nom d'une sauvegarde (2026-09-30_010000), « derniere », ou chemin d'un dossier de sauvegarde / d'un fichier .db
  --db          base à remplacer (défaut : DATABASE_PATH, sinon data/app.db)
  --dir         dossier des sauvegardes (défaut : BACKUP_DIR, sinon <dossier de la base>/backups)
  --url         adresse interne du service web, sondée avant restauration (défaut : http://127.0.0.1:\${PORT:-3000})
  --force       ne sonde pas le service web (la sonde de verrou SQLite reste obligatoire)

Arrêter d'abord les services (worker puis web). La base courante est copiée dans <dossier>/<horodatage>_avant-restauration/
avant d'être remplacée ; les sessions sont invalidées ; relancer ensuite npm run db:migrate puis les services.`;

export type RestoreOptions = {
  backup: string;
  db?: string;
  dir?: string;
  url?: string | null;
  force?: boolean;
  now?: Date;
  log?: (msg: string) => void;
};

export type RestoreResult = {
  source: string;
  target: string;
  safetyCopy: string | null;
  migrations: Manifest["migrations"];
  pendingMigrations: number | null;
  timings: Record<string, number>;
  totalMs: number;
};

export class RestoreRefused extends Error {}

export function resolveBackup(spec: string, root: string): { file: string; dir: string; manifest: Manifest | null } {
  if (spec === "derniere" || spec === "dernière" || spec === "latest") {
    const last = listBackups(root).find((b) => b.manifest?.kind !== "avant-restauration");
    if (!last) throw new RestoreRefused(`Aucune sauvegarde dans ${root}.`);
    return { file: path.join(last.dir, DB_FILE), dir: last.dir, manifest: last.manifest };
  }
  const candidates = [path.resolve(spec), path.join(root, spec)];
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    if (fs.statSync(c).isDirectory()) {
      const file = path.join(c, DB_FILE);
      if (!fs.existsSync(file)) throw new RestoreRefused(`Pas de ${DB_FILE} dans ${c}.`);
      return { file, dir: c, manifest: readManifest(c) };
    }
    return { file: c, dir: path.dirname(c), manifest: null };
  }
  throw new RestoreRefused(`Sauvegarde introuvable : ${spec} (ni chemin, ni dossier de ${root}).`);
}

// Nombre de migrations du code (drizzle/meta/_journal.json) plus récentes que la dernière appliquée à la base.
export function pendingMigrations(state: Manifest["migrations"], migrationsFolder = path.resolve(process.cwd(), "drizzle")): number | null {
  const journal = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journal)) return null;
  const entries = (JSON.parse(fs.readFileSync(journal, "utf8")) as { entries: { when: number }[] }).entries;
  const last = state?.lastCreatedAt ?? -1;
  return entries.filter((e) => e.when > last).length;
}

async function webAnswers(url: string): Promise<boolean> {
  try {
    await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function removeSidecars(file: string) {
  for (const ext of ["-wal", "-shm", "-journal"]) fs.rmSync(file + ext, { force: true });
}

// Copie brute de la base courante (+ WAL éventuel), puis consolidation en un seul fichier ; utilisable même si la base est abîmée.
function safetyCopy(target: string, root: string, now: Date): string {
  const name = `${stamp(now)}_avant-restauration`;
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DB_FILE);
  fs.copyFileSync(target, file);
  const wal = `${target}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${file}-wal`);
  let integrity: string;
  let tables: Record<string, number> = {};
  let migrations: Manifest["migrations"] = null;
  try {
    const db = new Database(file, { fileMustExist: true });
    try {
      db.pragma("journal_mode = DELETE");
      integrity = (db.prepare("PRAGMA quick_check(20)").pluck().all() as string[]).join(" ; ");
      tables = tableCounts(db);
      migrations = migrationsState(db);
    } finally {
      db.close();
    }
  } catch (e) {
    integrity = `illisible : ${(e as Error).message}`;
  }
  const manifest: Manifest = {
    name,
    kind: "avant-restauration",
    createdAt: now.toISOString(),
    source: target,
    file: DB_FILE,
    sizeBytes: fs.statSync(file).size,
    sha256: sha256File(file),
    integrity,
    sqliteVersion: "",
    migrations,
    tables,
    durationMs: 0,
  };
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

export async function runRestore(opts: RestoreOptions): Promise<RestoreResult> {
  const log = opts.log ?? (() => {});
  const target = path.resolve(opts.db ?? dbPath());
  const root = path.resolve(opts.dir ?? backupRoot(target));
  const now = opts.now ?? new Date();
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  const step = async <T>(key: string, fn: () => T | Promise<T>): Promise<T> => {
    const t = performance.now();
    const r = await fn();
    timings[key] = performance.now() - t;
    return r;
  };

  const src = resolveBackup(opts.backup, root);
  if (path.resolve(src.file) === target) throw new RestoreRefused("La sauvegarde et la base cible sont le même fichier.");
  log(`Sauvegarde choisie : ${src.file}${src.manifest ? ` (${src.manifest.createdAt}, ${fmtBytes(src.manifest.sizeBytes)})` : " (sans manifeste)"}`);

  const assertNotInUse = () => {
    let inUse = false;
    try {
      inUse = databaseInUse(target);
    } catch (e) {
      log(`Attention : base courante illisible (${(e as Error).message}) ; sonde de verrou impossible, vérifiez que les services sont arrêtés.`);
    }
    if (inUse)
      throw new RestoreRefused(
        `La base ${target} est ouverte par un autre processus (service web, worker, import ou script en cours). Arrêtez les services « worker » puis « web » et relancez.`,
      );
  };

  await step("services arrêtés", async () => {
    assertNotInUse();
    if (!opts.force && opts.url && (await webAnswers(opts.url)))
      throw new RestoreRefused(`Le service web répond encore sur ${opts.url}. Arrêtez-le (ou --force si cette adresse sert une autre application).`);
  });

  await step("contrôle sauvegarde", () => {
    if (src.manifest?.sha256) {
      const sha = sha256File(src.file);
      if (sha !== src.manifest.sha256) throw new RestoreRefused(`Empreinte sha256 différente du manifeste : sauvegarde altérée (${src.file}).`);
    }
    let res: string[];
    try {
      res = integrityCheck(src.file);
    } catch (e) {
      res = [(e as Error).message];
    }
    if (res.join() !== "ok") throw new RestoreRefused(`Sauvegarde corrompue (integrity_check) : ${res.join(" ; ")}`);
  });

  assertNotInUse();
  const safety = fs.existsSync(target) ? await step("copie de sécurité", () => safetyCopy(target, root, now)) : null;
  if (safety) log(`Base courante copiée dans ${safety}`);

  await step("remplacement", () => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.restauration`;
    try {
      fs.copyFileSync(src.file, tmp);
      if (src.manifest?.sha256 && sha256File(tmp) !== src.manifest.sha256) throw new Error("Copie altérée pendant l'écriture (sha256) : base courante inchangée.");
      removeSidecars(target);
      fs.renameSync(tmp, target);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  });

  const migrations = await step("contrôle final", () => {
    const res = integrityCheck(target, "quick_check");
    if (res.join() !== "ok") throw new Error(`Base restaurée incohérente (quick_check) : ${res.join(" ; ")}. Copie de sécurité : ${safety ?? "aucune"}.`);
    const db = new Database(target, { fileMustExist: true });
    try {
      if (src.manifest) {
        const counts = tableCounts(db);
        const diff = Object.entries(src.manifest.tables).filter(([t, n]) => counts[t] !== n);
        if (diff.length) throw new Error(`Comptages différents du manifeste : ${diff.map(([t]) => t).join(", ")}.`);
      }
      const state = migrationsState(db);
      db.transaction(() => {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session'").get()) db.prepare("DELETE FROM session").run();
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").get())
          db.prepare("INSERT INTO audit_log (user_id, action, target_type, target_id, outcome, detail_json) VALUES (NULL, 'backup.restore', 'database', ?, 'OK', ?)").run(
            path.basename(src.dir),
            JSON.stringify({ backup: src.file, sha256: src.manifest?.sha256 ?? null, safetyCopy: safety }),
          );
      })();
      db.pragma("journal_mode = WAL");
      return state;
    } finally {
      db.close();
    }
  });

  const totalMs = performance.now() - t0;
  appendLog(root, `RESTAURATION ${path.basename(src.dir)} -> ${target} ${fmtMs(totalMs)} copie_securite=${safety ? path.basename(safety) : "aucune"}`);
  return { source: src.file, target, safetyCopy: safety, migrations, pendingMigrations: pendingMigrations(migrations), timings, totalMs };
}

function parseArgs(argv: string[]) {
  const out: { backup?: string; db?: string; dir?: string; url?: string | null; force: boolean; list: boolean; help: boolean } = {
    force: false,
    list: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--list") out.list = true;
    else if (a === "--force") out.force = true;
    else if (a === "--db" || a === "--dir" || a === "--url") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} attend une valeur.\n${USAGE}`);
      if (a === "--url") out.url = v === "none" ? null : v;
      else out[a === "--db" ? "db" : "dir"] = v;
    } else if (!a.startsWith("--") && !out.backup) out.backup = a;
    else throw new Error(`Argument inattendu : ${a}\n${USAGE}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.list && !args.backup)) {
    console.log(USAGE);
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  loadDotEnv();
  const target = path.resolve(args.db ?? dbPath());
  const root = path.resolve(args.dir ?? backupRoot(target));

  if (args.list) {
    const all = listBackups(root);
    console.log(`Sauvegardes dans ${root} : ${all.length}`);
    for (const b of all) {
      const m = b.manifest;
      console.log(
        `  ${b.name.padEnd(38)} ${m ? fmtBytes(m.sizeBytes).padStart(9) : "?".padStart(9)}  intégrité ${m?.integrity ?? "?"}  migrations ${m?.migrations?.applied ?? "?"}`,
      );
    }
    return;
  }

  const url = args.url === undefined ? `http://127.0.0.1:${process.env.PORT || 3000}` : args.url;
  try {
    const r = await runRestore({ backup: args.backup!, db: target, dir: root, url, force: args.force, log: (m) => console.log(m) });
    console.log(`\nRestauration terminée : ${r.target}`);
    for (const [k, ms] of Object.entries(r.timings)) console.log(`  ${k.padEnd(20)} ${fmtMs(ms)}`);
    console.log(`  ${"total".padEnd(20)} ${fmtMs(r.totalMs)}`);
    console.log(`  copie de sécurité    ${r.safetyCopy ?? "aucune (pas de base existante)"}`);
    console.log("  sessions             invalidées (reconnexion obligatoire)");
    console.log(
      r.pendingMigrations
        ? `\nÀ FAIRE : ${r.pendingMigrations} migration(s) du code non appliquée(s) à cette sauvegarde → npm run db:migrate`
        : "\nÀ FAIRE : npm run db:migrate (sans effet si la base est à jour)",
    );
    console.log("Puis redémarrer les services (Start-Service PeopleAnalyticsWeb, PeopleAnalyticsWorker) et lancer npx tsx scripts/check-install.ts.");
  } catch (e) {
    const refused = e instanceof RestoreRefused;
    console.error(`${refused ? "RESTAURATION REFUSÉE" : "ÉCHEC DE LA RESTAURATION"} : ${(e as Error).message}`);
    appendLog(root, `${refused ? "REFUS" : "ECHEC"} restauration ${args.backup} : ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 2;
  });
}

import Database from "better-sqlite3";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { dbPath } from "../src/db/client";
import { backupRoot, fmtBytes, fmtMs, listBackups, loadDotEnv, migrationsState, retentionDays } from "./backup";
import { pendingMigrations } from "./restore";

const USAGE = `Usage : npx tsx scripts/check-install.ts [--full] [--json] [--url <http://127.0.0.1:3000> | --url none]
  --full  PRAGMA integrity_check complet (défaut : quick_check, plus rapide)
  --json  rapport JSON (supervision)
  --url   adresse interne du service web pour /api/health (défaut : http://127.0.0.1:\${PORT:-3000})
À lancer depuis le dossier de l'application, avec le compte des services. Code de sortie 1 si au moins un ÉCHEC.`;

type Level = "OK" | "ATTENTION" | "ECHEC" | "INFO";
type Check = { name: string; level: Level; detail: string; hint?: string };

const HEARTBEAT_ACTIVE_S = 120;
const HEARTBEAT_STALE_S = 600;
const BACKUP_MAX_AGE_H = 26;
const PINO_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

const checks: Check[] = [];
const add = (name: string, level: Level, detail: string, hint?: string) => checks.push({ name, level, detail, hint });

function age(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} j`;
}

function driveOf(p: string): string {
  return path.parse(path.resolve(p)).root.toUpperCase();
}

function checkNode() {
  const v = process.versions.node;
  const major = Number(v.split(".")[0]);
  if (major < 20) add("Node.js", "ECHEC", `v${v}`, "Installer Node.js 24 LTS (x64).");
  else if (major !== 24) add("Node.js", "ATTENTION", `v${v} (version validée : 24 LTS)`, "Après tout changement de version majeure : npm rebuild better-sqlite3 @node-rs/argon2.");
  else add("Node.js", "OK", `v${v} (${process.arch})`);
}

function checkNativeModules() {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const errors: string[] = [];
  let sqliteVersion = "?";
  try {
    const mem = new Database(":memory:");
    sqliteVersion = mem.prepare("SELECT sqlite_version()").pluck().get() as string;
    mem.close();
  } catch (e) {
    errors.push(`better-sqlite3 : ${(e as Error).message.split("\n")[0]}`);
  }
  try {
    req("@node-rs/argon2");
  } catch (e) {
    errors.push(`@node-rs/argon2 : ${(e as Error).message.split("\n")[0]}`);
  }
  if (errors.length) add("Modules natifs", "ECHEC", errors.join(" ; "), "Modules compilés pour une autre version de Node ou une autre plateforme : npm rebuild (ou archive refaite sur win-x64 avec la même version de Node).");
  else add("Modules natifs", "OK", `better-sqlite3 (SQLite ${sqliteVersion}), @node-rs/argon2`);
}

function checkBuild() {
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const buildId = path.resolve(distDir, "BUILD_ID");
  if (!fs.existsSync(buildId)) {
    add("Build Next.js", "ECHEC", `${path.join(distDir, "BUILD_ID")} absent`, "npm run build (avec le même NEXT_DIST_DIR que le service web).");
    return;
  }
  const at = fs.statSync(buildId).mtime.toISOString().slice(0, 16).replace("T", " ");
  add("Build Next.js", "OK", `${distDir}, build ${fs.readFileSync(buildId, "utf8").trim()} du ${at} UTC`);
}

function checkEnv(envLoaded: boolean, db: string, root: string) {
  add(".env", envLoaded ? "OK" : "ATTENTION", envLoaded ? "lu depuis le dossier courant" : "absent du dossier courant", envLoaded ? undefined : "copy deploy\\env.example .env, puis l'adapter.");

  const raw = process.env.DATABASE_PATH;
  if (!raw) add("DATABASE_PATH", "ATTENTION", `non défini → ${db}`, "En production, placer la base hors du dossier de l'application (remplacé à chaque mise à jour).");
  else if (!path.isAbsolute(raw)) add("DATABASE_PATH", "ATTENTION", `${raw} (relatif au dossier courant) → ${db}`, "Utiliser un chemin absolu.");
  else add("DATABASE_PATH", "OK", db);

  const appUrl = process.env.APP_URL;
  if (!appUrl) add("APP_URL", "ATTENTION", "non défini : liens d'activation construits à partir des en-têtes de la requête", "APP_URL=https://<nom DNS du module>");
  else if (!/^https:\/\//i.test(appUrl)) add("APP_URL", "ATTENTION", `${appUrl} n'est pas en https`, "Le module doit être servi en HTTPS via le reverse proxy.");
  else add("APP_URL", "OK", appUrl);

  if (process.env.INSECURE_COOKIES === "1")
    add("INSECURE_COOKIES", "ECHEC", "=1 : cookie de session sans attribut Secure", "Réservé aux démonstrations en HTTP ; retirer de .env en production.");

  const level = process.env.LOG_LEVEL;
  if (level && !PINO_LEVELS.includes(level)) add("LOG_LEVEL", "ECHEC", `« ${level} » inconnu : le worker et le serveur refuseront de démarrer`, `Valeurs : ${PINO_LEVELS.join(", ")}.`);
  else add("LOG_LEVEL", "OK", level ?? "info (défaut)");

  try {
    const days = retentionDays();
    if (!process.env.BACKUP_DIR) add("BACKUP_DIR", "ATTENTION", `non défini → ${root}`, "Placer les sauvegardes sur un autre volume (ou un partage réseau) que la base.");
    else if (driveOf(root) === driveOf(db)) add("BACKUP_DIR", "ATTENTION", `${root} (même volume que la base, rétention ${days} j)`, "Préférer un autre volume ou un partage réseau.");
    else add("BACKUP_DIR", "OK", `${root} (rétention ${days} j)`);
  } catch (e) {
    add("BACKUP_RETENTION_DAYS", "ECHEC", (e as Error).message);
  }
}

function checkWritable(label: string, dir: string, mustExist: boolean) {
  let probeDir = dir;
  if (!fs.existsSync(dir)) {
    if (mustExist) {
      add(label, "ECHEC", `${dir} absent`, "Créer le dossier et donner le droit Modification au compte des services.");
      return;
    }
    probeDir = path.dirname(dir);
  }
  const probe = path.join(probeDir, `.check-install-${process.pid}.tmp`);
  try {
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    add(label, "OK", fs.existsSync(dir) ? `${dir} accessible en écriture` : `${dir} sera créé (parent accessible en écriture)`);
  } catch (e) {
    add(label, "ECHEC", `${probeDir} non accessible en écriture (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`, "icacls <dossier> /grant <compte>:(OI)(CI)M");
  }
}

function checkDiskSpace(dir: string, dbSize: number) {
  try {
    const s = fs.statfsSync(fs.existsSync(dir) ? dir : path.dirname(dir));
    const free = s.bavail * s.bsize;
    const need = Math.max(2 * 1024 ** 3, 3 * dbSize);
    add("Espace disque", free < need ? "ATTENTION" : "OK", `${fmtBytes(free)} libres sur le volume de la base`, free < need ? `Prévoir au moins ${fmtBytes(need)} (base, WAL, VACUUM).` : undefined);
  } catch {
    add("Espace disque", "INFO", "non mesurable sur ce système");
  }
}

async function checkDatabase(file: string, full: boolean) {
  if (!fs.existsSync(file)) {
    add("Base SQLite", "ECHEC", `${file} absente`, "npm run db:migrate (création), ou restauration d'une sauvegarde.");
    return;
  }
  const size = fs.statSync(file).size;
  checkDiskSpace(path.dirname(file), size);
  let db: Database.Database;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
  } catch (e) {
    add("Base SQLite", "ECHEC", `ouverture impossible : ${(e as Error).message}`, "Vérifier les droits du compte, sinon restaurer une sauvegarde.");
    return;
  }
  try {
    const t = performance.now();
    const res = (db.prepare(`PRAGMA ${full ? "integrity_check" : "quick_check"}(20)`).pluck().all() as string[]).map(String);
    const ms = Math.round(performance.now() - t);
    const mode = db.pragma("journal_mode", { simple: true }) as string;
    if (res.join() !== "ok")
      add("Base SQLite", "ECHEC", `${full ? "integrity_check" : "quick_check"} : ${res.slice(0, 3).join(" ; ")}`, "Arrêter les services et restaurer la dernière sauvegarde saine (docs/EXPLOITATION.md).");
    else add("Base SQLite", "OK", `${fmtBytes(size)}, ${full ? "integrity_check" : "quick_check"} ok en ${fmtMs(ms)}, journal ${mode}`);

    const state = migrationsState(db);
    const pending = pendingMigrations(state);
    if (!state) add("Migrations", "ECHEC", "table __drizzle_migrations absente", "npm run db:migrate");
    else if (pending === null) add("Migrations", "ATTENTION", `${state.applied} appliquées ; drizzle/meta/_journal.json introuvable (lancer depuis le dossier de l'application)`);
    else if (pending > 0) add("Migrations", "ECHEC", `${state.applied} appliquées, ${pending} en attente`, "npm run db:migrate (services arrêtés), après une sauvegarde.");
    else add("Migrations", "OK", `${state.applied} appliquées, aucune en attente`);

    const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t);
    if (!has("app_user") || !has("app_setting")) return;

    const admins = db.prepare("SELECT count(*) FROM app_user WHERE role = 'ADMIN' AND active = 1").pluck().get() as number;
    if (admins === 0) add("Compte administrateur", "ECHEC", "aucun ADMIN actif", "npm run seed:admin -- <login>  (mot de passe généré affiché une fois)");
    else add("Compte administrateur", "OK", `${admins} ADMIN actif(s)`);

    await checkChampion(db);

    const hb = db.prepare("SELECT value FROM app_setting WHERE key = 'worker_heartbeat'").pluck().get() as string | undefined;
    const hbAt = hb ? Date.parse(hb) : NaN;
    if (!hb || Number.isNaN(hbAt)) add("Worker (heartbeat)", "ATTENTION", "aucun signal : worker jamais démarré sur cette base", "Démarrer le service PeopleAnalyticsWorker.");
    else {
      const s = Math.max(0, Math.round((Date.now() - hbAt) / 1000));
      if (s <= HEARTBEAT_ACTIVE_S) add("Worker (heartbeat)", "OK", `dernier signal il y a ${age(s)}`);
      else if (s <= HEARTBEAT_STALE_S) add("Worker (heartbeat)", "ATTENTION", `dernier signal il y a ${age(s)} (en retard)`, "Job long en cours, ou worker en redémarrage : surveiller.");
      else add("Worker (heartbeat)", "ECHEC", `dernier signal il y a ${age(s)}`, "Restart-Service PeopleAnalyticsWorker ; voir logs\\PeopleAnalyticsWorker.err.log.");
    }

    if (has("app_job")) {
      const failed = db.prepare("SELECT count(*) FROM app_job WHERE status = 'ECHEC' AND coalesce(finished_at, created_at) >= ?").pluck().get(new Date(Date.now() - 7 * 86_400_000).toISOString()) as number;
      const queued = db.prepare("SELECT count(*) FROM app_job WHERE status IN ('EN_FILE','EN_COURS')").pluck().get() as number;
      add("Jobs", failed ? "ATTENTION" : "OK", `${failed} en échec sur 7 jours, ${queued} en file ou en cours`, failed ? "Détail dans Santé des données > Travaux récents du worker." : undefined);
    }

    if (has("import_batch")) {
      const last = db.prepare("SELECT id, source, status, finished_at, quality_score FROM import_batch WHERE status <> 'EN_COURS' ORDER BY id DESC LIMIT 1").get() as
        | { id: number; source: string; status: string; finished_at: string | null; quality_score: number | null }
        | undefined;
      const end = db.prepare("SELECT value FROM app_setting WHERE key = 'data_end_date'").pluck().get() as string | undefined;
      const runId = db.prepare("SELECT value FROM app_setting WHERE key = 'current_run_id'").pluck().get() as string | undefined;
      const run = runId && has("scoring_run") ? (db.prepare("SELECT as_of FROM scoring_run WHERE id = ?").get(Number(runId)) as { as_of: string } | undefined) : undefined;
      if (!last) add("Données", "ATTENTION", "aucun import", "Importer l'export AJIR (docs/EXPLOITATION.md).");
      else {
        const q = last.quality_score == null ? "-" : `${(last.quality_score * 100).toFixed(1).replace(".", ",")} %`;
        const detail = `import n° ${last.id} « ${last.source} » ${last.status} (qualité ${q}), données jusqu'au ${end || "-"}, run publié au ${run?.as_of ?? "-"}`;
        add("Données", last.status === "OK" ? "OK" : "ATTENTION", detail, last.status === "OK" ? undefined : "Import BLOQUE/ECHEC : voir docs/EXPLOITATION.md § Import bloqué.");
      }
    }
  } finally {
    db.close();
  }
}

async function checkChampion(db: Database.Database) {
  const row = db.prepare("SELECT version, kind FROM model_version WHERE status = 'CHAMPION'").get() as { version: string; kind: string } | undefined;
  if (!row) {
    add("Modèle champion", "ATTENTION", "aucun champion enregistré", "Le score à règles B0 est enregistré au premier scoring (ou : npx tsx scripts/model.ts list).");
    return;
  }
  try {
    const { verifyModel } = await import("../src/lib/scoring");
    const r = verifyModel(db, row.version);
    if (r.ok) add("Modèle champion", "OK", `${row.version} (${row.kind}), golden ${r.goldenRows} lignes${r.maxDiff != null ? `, écart max ${r.maxDiff.toExponential(1)}` : ""}`);
    else {
      const onlyFiles = r.errors.every((e) => /sha256|bundle illisible/.test(e));
      add(
        "Modèle champion",
        onlyFiles ? "ATTENTION" : "ECHEC",
        `${row.version} : ${r.errors.join(" ; ")}`,
        onlyFiles ? "Les fichiers du bundle sur disque diffèrent de la version enregistrée : les restaurer depuis la livraison." : "Modèle refusé au chargement : npx tsx scripts/model.ts rollback (docs/EXPLOITATION.md).",
      );
    }
  } catch (e) {
    add("Modèle champion", "ECHEC", `vérification impossible : ${(e as Error).message}`);
  }
}

async function checkHttp(url: string | null) {
  if (!url) return;
  try {
    const res = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(3000) });
    const body = (await res.json().catch(() => null)) as { status?: string; worker?: { state?: string }; model?: { championLoaded?: boolean } } | null;
    const detail = `${url}/api/health → HTTP ${res.status}, statut ${body?.status ?? "?"}, worker ${body?.worker?.state ?? "?"}, champion ${body?.model?.championLoaded ? "chargé" : "non chargé"}`;
    add("Service web", body?.status === "ok" ? "OK" : body?.status === "degrade" ? "ATTENTION" : "ECHEC", detail);
  } catch (e) {
    add("Service web", "ATTENTION", `${url} injoignable (${(e as Error).name === "TimeoutError" ? "délai dépassé" : (e as Error).message})`, "Get-Service PeopleAnalyticsWeb ; logs\\PeopleAnalyticsWeb.err.log.");
  }
}

function checkBackups(root: string) {
  const last = listBackups(root).find((b) => b.manifest?.kind !== "avant-restauration");
  if (!last) {
    add("Sauvegardes", "ATTENTION", `aucune sauvegarde dans ${root}`, "Créer la tâche planifiée (docs/INSTALLATION.md) ; test : deploy\\windows\\backup.cmd");
    return;
  }
  const h = (Date.now() - last.date.getTime()) / 3_600_000;
  const integ = last.manifest?.integrity ?? "?";
  const detail = `dernière : ${last.name} (il y a ${age(Math.round(h * 3600))}, intégrité ${integ})`;
  if (integ !== "ok") add("Sauvegardes", "ECHEC", detail, "Relancer une sauvegarde et consulter sauvegardes.log.");
  else add("Sauvegardes", h > BACKUP_MAX_AGE_H ? "ATTENTION" : "OK", detail, h > BACKUP_MAX_AGE_H ? "Tâche planifiée « PeopleAnalytics\\Sauvegarde » : vérifier son dernier résultat." : undefined);
}

function parseArgs(argv: string[]) {
  const out: { full: boolean; json: boolean; url?: string | null; help: boolean } = { full: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full") out.full = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--url") {
      const v = argv[++i];
      if (!v) throw new Error(`--url attend une adresse ou none.\n${USAGE}`);
      out.url = v === "none" ? null : v.replace(/\/+$/, "");
    } else throw new Error(`Option inconnue : ${a}\n${USAGE}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);
  const envLoaded = loadDotEnv();
  const db = dbPath();
  let root = path.join(path.dirname(db), "backups");
  try {
    root = backupRoot(db);
  } catch {
    // BACKUP_DIR illisible : signalé par checkEnv
  }

  checkNode();
  checkNativeModules();
  checkBuild();
  checkEnv(envLoaded, db, root);
  checkWritable("Dossier de données", path.dirname(db), true);
  checkWritable("Dossier des sauvegardes", root, false);
  await checkDatabase(db, args.full);
  checkBackups(root);
  await checkHttp(args.url === undefined ? `http://127.0.0.1:${process.env.PORT || 3000}` : args.url);

  const fails = checks.filter((c) => c.level === "ECHEC").length;
  const warns = checks.filter((c) => c.level === "ATTENTION").length;
  if (args.json) {
    console.log(JSON.stringify({ at: new Date().toISOString(), cwd: process.cwd(), database: db, fails, warnings: warns, checks }, null, 2));
  } else {
    const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { name?: string; version?: string };
    console.log(`Vérification de l'installation — ${pkg.name ?? "?"} ${pkg.version ?? ""}`);
    console.log(`Dossier ${process.cwd()} · ${new Date().toLocaleString("fr-FR")}\n`);
    const tag: Record<Level, string> = { OK: "[OK]", ATTENTION: "[ATTENTION]", ECHEC: "[ÉCHEC]", INFO: "[INFO]" };
    for (const c of checks) {
      console.log(`${tag[c.level].padEnd(12)} ${c.name.padEnd(24)} ${c.detail}`);
      if (c.hint && c.level !== "OK") console.log(`${"".padEnd(37)}→ ${c.hint}`);
    }
    console.log(`\nRésultat : ${fails} échec(s), ${warns} avertissement(s) sur ${checks.length} contrôles.`);
  }
  process.exitCode = fails ? 1 : 0;
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 2;
  });
}

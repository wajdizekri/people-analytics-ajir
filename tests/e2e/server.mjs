// Serveur E2E isolé : copie de data/app.db vers data/e2e.db (API backup, source en lecture seule),
// jeu de données de test, build dans .next-e2e puis `next start` sur le port 3200.
// Usage : node tests/e2e/server.mjs [--prepare-only | --build-only]
// E2E_SKIP_BUILD=1 réutilise un build .next-e2e existant.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { hash, verify } = require("@node-rs/argon2");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DB = path.join(ROOT, "data", "app.db");
const E2E_DB = path.join(ROOT, "data", "e2e.db");
const DIST_DIR = ".next-e2e";
const PORT = process.env.E2E_PORT ?? "3200";
const NEXT_BIN = require.resolve("next/dist/bin/next");
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const DEMO_ACCOUNTS = [
  { login: "admin", password: "Admin2026pfe" },
  { login: "rh.demo", password: "RhDemo2026pfe" },
  { login: "mgr.M10451", password: "MgrDemo2026pfe" },
];
const LOCK_USER = { login: "e2e.verrou", password: "E2eVerrou2026x" };

const log = (...a) => console.log("[e2e]", ...a);

async function prepareDb() {
  if (!fs.existsSync(SRC_DB)) throw new Error(`Base source introuvable : ${SRC_DB}`);
  for (const f of [E2E_DB, `${E2E_DB}-wal`, `${E2E_DB}-shm`]) fs.rmSync(f, { force: true });
  const src = new Database(SRC_DB, { readonly: true, fileMustExist: true });
  try {
    await src.backup(E2E_DB);
  } finally {
    src.close();
  }
  log(`copie ${path.relative(ROOT, SRC_DB)} -> ${path.relative(ROOT, E2E_DB)} (backup API)`);

  const db = new Database(E2E_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  const notes = [];

  for (const acc of DEMO_ACCOUNTS) {
    const u = db.prepare("SELECT id, password_hash FROM app_user WHERE login = ?").get(acc.login);
    if (!u) throw new Error(`Compte de démonstration absent de app.db : ${acc.login}`);
    const ok = u.password_hash ? await verify(u.password_hash, acc.password).catch(() => false) : false;
    if (!ok) {
      notes.push(`mot de passe de ${acc.login} différent de docs/DEMO.md : réinitialisé dans e2e.db`);
      db.prepare("UPDATE app_user SET password_hash = ? WHERE id = ?").run(await hash(acc.password, ARGON), u.id);
    }
  }
  db.prepare("UPDATE app_user SET failed_attempts = 0, locked_until = NULL, active = 1 WHERE login IN ('admin','rh.demo','mgr.M10451')").run();
  db.prepare("DELETE FROM session").run();

  db.prepare("INSERT INTO app_user (login, password_hash, role, active) VALUES (?, ?, 'RH', 1)").run(LOCK_USER.login, await hash(LOCK_USER.password, ARGON));

  // Alertes de test dans le périmètre du manager de démonstration :
  // une alerte TURNOVER visible, et un signal individuel d'absentéisme saisi (à tort) avec l'audience MANAGER,
  // que la DAL doit filtrer quand même.
  const mgr = db.prepare("SELECT employee_id AS id FROM app_user WHERE login = 'mgr.M10451'").get();
  const team = db
    .prepare(
      `WITH RECURSIVE team(id) AS (SELECT id FROM employee WHERE manager_id = @root UNION SELECT e.id FROM employee e JOIN team t ON e.manager_id = t.id)
       SELECT e.id, e.first_name AS fn, e.last_name AS ln, e.department_id AS dep FROM employee e WHERE e.id IN (SELECT id FROM team) AND e.status = 'ACTIF' ORDER BY e.id LIMIT 2`,
    )
    .all({ root: mgr.id });
  if (team.length < 2) throw new Error("Le manager de démonstration n'a pas au moins 2 collaborateurs actifs.");
  const ins = db.prepare(
    `INSERT INTO alert (type, severity, status, audience, department_id, manager_id, employee_id, title, message, link, dedup_key)
     VALUES (@type, @severity, 'NOUVELLE', 'MANAGER', @dep, @mgr, @emp, @title, @message, @link, @dedup)`,
  );
  ins.run({
    type: "TURNOVER", severity: "ATTENTION", dep: team[0].dep, mgr: mgr.id, emp: team[0].id,
    title: `E2E Turnover équipe : ${team[0].fn} ${team[0].ln}`, message: "Alerte de test E2E (périmètre manager).",
    link: `/employees/${team[0].id}`, dedup: "e2e-turnover-mgr",
  });
  ins.run({
    type: "ABSENTEISME", severity: "ATTENTION", dep: team[1].dep, mgr: mgr.id, emp: team[1].id,
    title: `E2E Absences individuelles : ${team[1].fn} ${team[1].ln}`, message: "Signal individuel de test E2E : jamais visible du manager.",
    link: `/employees/${team[1].id}`, dedup: "e2e-absence-indiv-mgr",
  });
  // Recommandations de test sur un collaborateur du manager : la revue de rémunération est réservée à la RH
  const reco = db.prepare("INSERT INTO recommendation (employee_id, action_code, trigger_group, status) VALUES (?, ?, ?, 'PROPOSEE')");
  reco.run(team[0].id, "ENTRETIEN", "NIVEAU_ELEVE");
  reco.run(team[0].id, "REVISION_SALARIALE", "REMUNERATION");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  for (const n of notes) log(n);
  fs.mkdirSync(path.join(ROOT, "test-results"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "test-results", "e2e-seed.json"), JSON.stringify({ at: new Date().toISOString(), notes }, null, 2));
}

function buildOnce() {
  // next build réécrit tsconfig.json et next-env.d.ts pour le distDir : on restaure les fichiers partagés
  const guarded = ["tsconfig.json", "next-env.d.ts"].map((f) => {
    const p = path.join(ROOT, f);
    return { p, content: fs.existsSync(p) ? fs.readFileSync(p) : null };
  });
  try {
    const r = spawnSync(process.execPath, [NEXT_BIN, "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: DIST_DIR, DATABASE_PATH: E2E_DB, NEXT_TELEMETRY_DISABLED: "1" },
    });
    return r.status === 0;
  } finally {
    for (const g of guarded) {
      if (g.content && !fs.readFileSync(g.p).equals(g.content)) fs.writeFileSync(g.p, g.content);
    }
  }
}

async function build() {
  if (process.env.E2E_SKIP_BUILD === "1" && fs.existsSync(path.join(ROOT, DIST_DIR, "BUILD_ID"))) {
    log(`build réutilisé (${DIST_DIR})`);
    return;
  }
  const attempts = Number(process.env.E2E_BUILD_ATTEMPTS ?? 3);
  for (let i = 1; i <= attempts; i++) {
    log(`build ${i}/${attempts} dans ${DIST_DIR}`);
    if (buildOnce()) return;
    if (i < attempts) {
      log("échec du build (fichier peut-être en cours de modification par un autre contributeur) : nouvel essai dans 2 min");
      await new Promise((r) => setTimeout(r, 120_000));
    }
  }
  throw new Error("Build E2E impossible.");
}

function start() {
  log(`next start sur http://localhost:${PORT} (DATABASE_PATH=${path.relative(ROOT, E2E_DB)})`);
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", PORT, "-H", "localhost"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", NEXT_DIST_DIR: DIST_DIR, DATABASE_PATH: E2E_DB, NEXT_TELEMETRY_DISABLED: "1" },
  });
  const stop = () => child.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

const mode = process.argv[2];
try {
  if (mode !== "--build-only") await prepareDb();
  if (mode === "--prepare-only") process.exit(0);
  await build();
  if (mode === "--build-only") process.exit(0);
  start();
} catch (err) {
  console.error("[e2e]", err instanceof Error ? err.message : err);
  process.exit(1);
}

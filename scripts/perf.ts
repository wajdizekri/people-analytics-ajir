// Campagne de performance HTTP — fetch concurrent, sans dépendance externe.
// Cible : serveur de production isolé (NEXT_DIST_DIR=.next-sec, DATABASE_PATH=data/sec.db) sur http://127.0.0.1:3300.
// Mesure : p50/p95/p99 de GET /api/dashboard et /api/employees (20 VUs, 60 s), temps de chargement des pages,
// et durée d'un pipeline complet (sur une copie de sec.db pour ne pas perturber le serveur).
//
// Usage :
//   npx tsx scripts/perf.ts                 # complet (60 s/endpoint + pages + pipeline)
//   npx tsx scripts/perf.ts --quick         # rapide (8 s/endpoint), sans pipeline
//   npx tsx scripts/perf.ts --no-pipeline   # sans l'étape pipeline
// Variables : SEC_BASE_URL (défaut http://127.0.0.1:3300), DATABASE_PATH (défaut data/sec.db), VUS (défaut 20), DURATION (s, défaut 60).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const BASE = process.env.SEC_BASE_URL || "http://127.0.0.1:3300";
const DB_FILE = process.env.DATABASE_PATH || path.resolve(process.cwd(), "data/sec.db");
const quick = process.argv.includes("--quick");
const noPipeline = process.argv.includes("--no-pipeline") || quick;
const VUS = Number(process.env.VUS || 20);
const DURATION = Number(process.env.DURATION || (quick ? 8 : 60));

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function makeSession(login: string): string {
  const d = new Database(DB_FILE);
  d.pragma("busy_timeout = 5000");
  const u = d.prepare("SELECT id FROM app_user WHERE login = ?").get(login) as { id: number } | undefined;
  if (!u) throw new Error(`Utilisateur ${login} introuvable dans ${DB_FILE}`);
  const token = crypto.randomBytes(32).toString("base64url");
  d.prepare("INSERT INTO session (id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)").run(
    sha256(token),
    u.id,
    new Date(Date.now() + 3600_000 * 4).toISOString(),
    "perf",
    "perf",
  );
  d.close();
  return token;
}

type Stats = { n: number; errors: number; rps: number; min: number; mean: number; p50: number; p90: number; p95: number; p99: number; max: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function summarize(lat: number[], errors: number, seconds: number): Stats {
  const s = [...lat].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    errors,
    rps: +(s.length / seconds).toFixed(1),
    min: +(s[0] ?? 0).toFixed(1),
    mean: +(s.length ? sum / s.length : 0).toFixed(1),
    p50: +percentile(s, 50).toFixed(1),
    p90: +percentile(s, 90).toFixed(1),
    p95: +percentile(s, 95).toFixed(1),
    p99: +percentile(s, 99).toFixed(1),
    max: +(s[s.length - 1] ?? 0).toFixed(1),
  };
}

async function drain(res: Response): Promise<void> {
  await res.arrayBuffer();
}

async function loadTest(label: string, url: string, cookie: string): Promise<Stats> {
  // warmup
  for (let i = 0; i < 5; i++) await fetch(`${BASE}${url}`, { headers: { Cookie: `pa_session=${cookie}` } }).then(drain);
  const lat: number[] = [];
  let errors = 0;
  const deadline = Date.now() + DURATION * 1000;
  const worker = async () => {
    while (Date.now() < deadline) {
      const t = performance.now();
      try {
        const res = await fetch(`${BASE}${url}`, { headers: { Cookie: `pa_session=${cookie}` } });
        await drain(res);
        lat.push(performance.now() - t);
        if (res.status !== 200) errors++;
      } catch {
        errors++;
      }
    }
  };
  const start = Date.now();
  await Promise.all(Array.from({ length: VUS }, worker));
  const seconds = (Date.now() - start) / 1000;
  const st = summarize(lat, errors, seconds);
  console.log(`\n[${label}] ${url} — ${VUS} VUs × ${DURATION}s`);
  console.log(`  requêtes ${st.n} | erreurs ${st.errors} | débit ${st.rps} req/s`);
  console.log(`  min ${st.min} | moy ${st.mean} | p50 ${st.p50} | p90 ${st.p90} | p95 ${st.p95} | p99 ${st.p99} | max ${st.max}  (ms)`);
  return st;
}

async function pageTimings(pages: { path: string; cookie?: string }[]): Promise<Record<string, Stats>> {
  const out: Record<string, Stats> = {};
  const N = quick ? 5 : 15;
  for (const p of pages) {
    const lat: number[] = [];
    let errors = 0;
    for (let i = 0; i < 3; i++) await fetch(`${BASE}${p.path}`, { headers: p.cookie ? { Cookie: `pa_session=${p.cookie}` } : {} }).then(drain);
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      const res = await fetch(`${BASE}${p.path}`, { headers: p.cookie ? { Cookie: `pa_session=${p.cookie}` } : {}, redirect: "manual" });
      await drain(res);
      lat.push(performance.now() - t);
      if (res.status >= 400) errors++;
    }
    out[p.path] = summarize(lat, errors, 1);
  }
  console.log(`\n[Pages] temps de chargement (ms, ${N} échantillons)`);
  for (const [p, st] of Object.entries(out)) console.log(`  ${p.padEnd(20)} p50 ${st.p50}  p95 ${st.p95}  max ${st.max}  (err ${st.errors})`);
  return out;
}

function pipelineTiming(): { seconds: number; ok: boolean; output: string } | null {
  const copy = path.resolve(path.dirname(DB_FILE), "sec-pipeline.db");
  for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) try { fs.rmSync(f, { force: true }); } catch { /* noop */ }
  const src = new Database(DB_FILE, { readonly: true });
  src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  const end = src.prepare("SELECT value FROM app_setting WHERE key = 'data_end_date'").get() as { value: string } | undefined;
  src.close();
  const to = end?.value?.slice(0, 7);
  const t0 = performance.now();
  let output = "";
  let ok = true;
  try {
    output = execFileSync("npx", ["tsx", "scripts/pipeline.ts", ...(to ? ["--to", to] : [])], {
      env: { ...process.env, DATABASE_PATH: copy },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20 * 60_000,
      shell: process.platform === "win32",
    });
  } catch (e) {
    ok = false;
    output = String((e as { stdout?: string; message?: string }).stdout ?? "") + "\n" + String((e as Error).message ?? "");
  }
  const seconds = (performance.now() - t0) / 1000;
  for (const f of [copy, `${copy}-wal`, `${copy}-shm`]) try { fs.rmSync(f, { force: true }); } catch { /* noop */ }
  return { seconds, ok, output };
}

async function main() {
  console.log(`Cible ${BASE} — base ${DB_FILE} — ${VUS} VUs — ${DURATION}s/endpoint${quick ? " (quick)" : ""}`);
  const rh = makeSession("rh.demo");
  const admin = makeSession("admin");

  const results: Record<string, unknown> = { base: BASE, vus: VUS, durationSec: DURATION, at: new Date().toISOString() };
  results.dashboard = await loadTest("Charge", "/api/dashboard", rh);
  results.employees = await loadTest("Charge", "/api/employees", rh);
  results.pages = await pageTimings([
    { path: "/login" },
    { path: "/dashboard", cookie: rh },
    { path: "/employees", cookie: rh },
    { path: "/alerts", cookie: rh },
    { path: "/transparency", cookie: rh },
    { path: "/data-health", cookie: rh },
    { path: "/admin/users", cookie: admin },
  ]);

  if (!noPipeline) {
    console.log(`\n[Pipeline] exécution sur une copie isolée de sec.db…`);
    const pl = pipelineTiming();
    if (pl) {
      const line = pl.output.split(/\r?\n/).find((l) => /total\s/.test(l)) ?? "";
      console.log(`  durée mesurée : ${(pl.seconds / 60).toFixed(2)} min (${pl.seconds.toFixed(1)} s) — ${pl.ok ? "OK" : "ÉCHEC"} ${line.trim()}`);
      results.pipeline = { seconds: pl.seconds, minutes: +(pl.seconds / 60).toFixed(2), ok: pl.ok, under15min: pl.seconds < 900 };
    }
  }

  const dash = results.dashboard as Stats;
  console.log(`\n=== Critères ===`);
  console.log(`  /api/dashboard p95 = ${dash.p95} ms  (< 500 ms : ${dash.p95 < 500 ? "OK" : "ÉCHEC"})`);
  const emp = results.employees as Stats;
  console.log(`  /api/employees p95 = ${emp.p95} ms`);
  if (results.pipeline) {
    const p = results.pipeline as { minutes: number; under15min: boolean };
    console.log(`  pipeline = ${p.minutes} min  (< 15 min : ${p.under15min ? "OK" : "ÉCHEC"})`);
  }

  const outFile = path.resolve(process.cwd(), "docs/qa/perf-results.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nRésultats écrits dans ${outFile}`);
}

main().catch((e) => {
  console.error("Erreur perf :", (e as Error).message);
  process.exit(1);
});

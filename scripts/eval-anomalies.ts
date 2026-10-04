import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite } from "../src/db/client";
import { anomalyScores, bradfordScores, detectAnomalies, type DetectOptions } from "../src/lib/anomalies";
import { addMonthsToMonth, fromDay, mondayOf, monthEnd, monthRange, toDay } from "../src/lib/features/dates";
import { runImport } from "../src/lib/import";
import { DETAIL_CAP, IssueLog, RULES, type Rule } from "../src/lib/import/rules";
import { seedDefaultSettings } from "../src/lib/settings";

// Évaluation hors ligne (ml/eval) : ne travaille que sur des copies data/eval-*.db, jamais sur data/app.db.
const USAGE = `Usage : npx tsx scripts/eval-anomalies.ts <commande> [options]
  scores  --db <base> --out <dossier> [--from YYYY-MM] [--to YYYY-MM]
          z hebdomadaires de tous les groupes (avec et sans facteur calendrier), Bradford mensuel, salariés, table anomaly
  replay  --db <base> --out <fichier.csv> [--mode monthly|batch] [--from YYYY-MM] [--to YYYY-MM]
          [--z 3.5] [--k 2] [--no-calendar] [--bradford 250]
          rejoue detectAnomalies sur une copie jetable de <base> (sans alerte) et exporte la table anomaly
  import  --dir <export AJIR> --db <nouvelle base> --out <fichier.csv>
          import complet sur une base neuve, rejets détaillés sans plafond (DETAIL_CAP levé pour l'évaluation)`;

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): { cmd: string; args: Args } {
  const [cmd, ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`Argument inattendu : ${a}\n${USAGE}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) args[a.slice(2)] = true;
    else args[a.slice(2)] = rest[++i];
  }
  return { cmd: cmd ?? "", args };
}

const str = (a: Args, k: string, def?: string): string => {
  const v = a[k];
  if (typeof v === "string") return v;
  if (def !== undefined) return def;
  throw new Error(`--${k} obligatoire\n${USAGE}`);
};

function guardDb(file: string) {
  const base = path.basename(file);
  if (!/^eval-.*\.db$/.test(base)) throw new Error(`Base refusée (${base}) : seules les copies data/eval-*.db sont autorisées.`);
}

function weeksOfMonth(month: string): { fromWeek: string; toWeek: string } {
  return { fromWeek: fromDay(mondayOf(toDay(`${month}-01`)) - 7), toWeek: fromDay(mondayOf(toDay(monthEnd(month)))) };
}

const csvCell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toPrecision(10)) : String(v));
function writeCsv(file: string, rows: Record<string, unknown>[], columns?: string[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cols = columns ?? (rows.length ? Object.keys(rows[0]) : []);
  const out = [cols.join(";")];
  for (const r of rows) out.push(cols.map((c) => csvCell(r[c]).replace(/[;\r\n]/g, " ")).join(";"));
  fs.writeFileSync(file, out.join("\n") + "\n", "utf8");
}

function defaultPeriod(sqlite: ReturnType<typeof openSqlite>, a: Args): { from: string; to: string } {
  const first = (sqlite.prepare("SELECT substr(min(date), 1, 7) AS m FROM attendance_daily").get() as { m: string }).m;
  const last = (sqlite.prepare("SELECT value FROM app_setting WHERE key = 'data_end_date'").get() as { value: string } | undefined)?.value;
  const to = str(a, "to", last ? (last === monthEnd(last.slice(0, 7)) ? last.slice(0, 7) : addMonthsToMonth(last.slice(0, 7), -1)) : undefined);
  return { from: str(a, "from", addMonthsToMonth(first, 6)), to };
}

function cmdScores(a: Args) {
  const dbFile = str(a, "db");
  guardDb(dbFile);
  const out = str(a, "out");
  const sqlite = openSqlite(dbFile, { readonly: true });
  const { from, to } = defaultPeriod(sqlite, a);
  const fromWeek = weeksOfMonth(from).fromWeek;
  const toWeek = weeksOfMonth(to).toWeek;
  // 4 semaines de plus en tête : la règle des k semaines consécutives regarde les semaines précédant fromWeek
  const scoresFrom = fromDay(toDay(fromWeek) - 28);
  const meta: Record<string, unknown> = { db: dbFile, from, to, fromWeek, toWeek, scoresFrom };
  for (const [tag, calendarAdjust] of [
    ["cal", true],
    ["nocal", false],
  ] as const) {
    const t = performance.now();
    const { factor, groups } = anomalyScores(sqlite, scoresFrom, toWeek, { calendarAdjust });
    meta[`factor_${tag}`] = factor;
    const rows = groups.flatMap((g) =>
      g.points.map((p) => ({
        key: g.key,
        scope: g.scope,
        manager_id: g.managerId,
        department_id: g.departmentId,
        monitored_end: g.monitored ? 1 : 0,
        week_start: p.weekStart,
        week_class: p.weekClass,
        num: p.num,
        den: p.den,
        rate: p.rate,
        expected: p.expected,
        z: p.z,
      })),
    );
    writeCsv(path.join(out, `scores_${tag}.csv`), rows);
    console.log(`scores_${tag}.csv : ${groups.length} groupes, ${rows.length} lignes (${Math.round(performance.now() - t)} ms)`);
  }

  const t = performance.now();
  const brad: Record<string, unknown>[] = [];
  const runs: Record<string, unknown>[] = [];
  for (const m of monthRange(from, to)) {
    const { toWeek: w } = weeksOfMonth(m);
    const { end, rows } = bradfordScores(sqlite, w);
    runs.push({ month: m, to_week: w, end });
    for (const r of rows) brad.push({ month: m, end, employee_id: r.employeeId, spells: r.spells, days: r.days, bradford: r.bradford });
  }
  writeCsv(path.join(out, "bradford_monthly.csv"), brad, ["month", "end", "employee_id", "spells", "days", "bradford"]);
  writeCsv(path.join(out, "bradford_runs.csv"), runs);
  console.log(`bradford_monthly.csv : ${runs.length} mois, ${brad.length} lignes (${Math.round(performance.now() - t)} ms)`);

  const emps = sqlite
    .prepare(
      `SELECT e.id, e.matricule, e.manager_id, e.department_id, d.code AS department_code, e.hire_date,
              COALESCE((SELECT min(x.exit_date) FROM exit_event x WHERE x.employee_id = e.id), e.exit_date) AS exit_date
         FROM employee e LEFT JOIN department d ON d.id = e.department_id ORDER BY e.id`,
    )
    .all() as Record<string, unknown>[];
  writeCsv(path.join(out, "employees.csv"), emps);
  const anomalies = sqlite
    .prepare("SELECT id, scope, department_id, manager_id, employee_id, period_start, period_end, metric, observed, expected, score FROM anomaly ORDER BY id")
    .all() as Record<string, unknown>[];
  writeCsv(path.join(out, "anomaly_table.csv"), anomalies, ["id", "scope", "department_id", "manager_id", "employee_id", "period_start", "period_end", "metric", "observed", "expected", "score"]);
  const rejections = sqlite.prepare("SELECT batch_id, file, line, rule, severity, message FROM import_rejection ORDER BY id").all() as Record<string, unknown>[];
  writeCsv(path.join(out, "rejections_table.csv"), rejections, ["batch_id", "file", "line", "rule", "severity", "message"]);
  const batches = sqlite.prepare("SELECT id, source, status, rows_ok, rows_rejected, quality_score, report_json FROM import_batch ORDER BY id").all();
  fs.writeFileSync(path.join(out, "import_batches.json"), JSON.stringify(batches, null, 1), "utf8");
  fs.writeFileSync(path.join(out, "scores_meta.json"), JSON.stringify(meta, null, 1), "utf8");
  console.log(`employees.csv (${emps.length}), anomaly_table.csv (${anomalies.length}), rejections_table.csv (${rejections.length})`);
  sqlite.close();
}

function copyDb(src: string, dst: string) {
  for (const f of [dst, `${dst}-wal`, `${dst}-shm`]) fs.rmSync(f, { force: true });
  const s = openSqlite(src, { readonly: true });
  s.prepare("VACUUM INTO ?").run(dst);
  s.close();
}

function cmdReplay(a: Args) {
  const src = str(a, "db");
  guardDb(src);
  const out = str(a, "out");
  const mode = str(a, "mode", "monthly");
  const opts: DetectOptions = {
    zThreshold: Number(str(a, "z", "3.5")),
    consecutiveWeeks: Number(str(a, "k", "2")),
    calendarAdjust: !a["no-calendar"],
    alerts: false,
    ...(typeof a.bradford === "string" ? { bradfordThreshold: Number(a.bradford) } : {}),
  };
  const tmp = path.join(path.dirname(src), `eval-replay-${process.pid}.db`);
  copyDb(src, tmp);
  const sqlite = openSqlite(tmp);
  const t = performance.now();
  try {
    sqlite.exec("DELETE FROM anomaly; DELETE FROM alert;");
    const { from, to } = defaultPeriod(sqlite, a);
    let n = 0;
    if (mode === "batch") n = detectAnomalies(sqlite, weeksOfMonth(from).fromWeek, weeksOfMonth(to).toWeek, opts);
    else if (mode === "monthly")
      for (const m of monthRange(from, to)) {
        const { fromWeek, toWeek } = weeksOfMonth(m);
        n += detectAnomalies(sqlite, fromWeek, toWeek, opts);
      }
    else throw new Error(`--mode inconnu : ${mode}`);
    const rows = sqlite
      .prepare("SELECT id, scope, department_id, manager_id, employee_id, period_start, period_end, metric, observed, expected, score FROM anomaly ORDER BY id")
      .all() as Record<string, unknown>[];
    writeCsv(out, rows, ["id", "scope", "department_id", "manager_id", "employee_id", "period_start", "period_end", "metric", "observed", "expected", "score"]);
    console.log(`${mode} ${from} → ${to} ${JSON.stringify(opts)} : ${n} anomalies (${Math.round((performance.now() - t) / 1000)} s) → ${out}`);
  } finally {
    sqlite.close();
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
  }
}

// Lève le plafond de détail des rejets (DETAIL_CAP) pour l'évaluation ligne à ligne : au-delà du plafond, la ligne
// est enregistrée quand même (sans le texte brut) ; comptages et score qualité inchangés.
function uncapIssueLog() {
  type Pending = [number, string, number | null, Rule, string, string | null, string];
  type Log = { counts: Map<string, Map<Rule, number>>; pending: Pending[]; batchId: number };
  const proto = IssueLog.prototype as unknown as { add: (this: Log, file: string, line: number | null, rule: Rule, message: string, raw?: string | null) => void };
  const original = proto.add;
  proto.add = function (file, line, rule, message, raw) {
    original.call(this, file, line, rule, message, raw);
    if ((this.counts.get(file)?.get(rule) ?? 0) > DETAIL_CAP)
      this.pending.push([this.batchId, file, line, rule, message.slice(0, 500), null, RULES[rule].severity]);
  };
}

async function cmdImport(a: Args) {
  const dir = str(a, "dir");
  const dbFile = str(a, "db");
  guardDb(dbFile);
  const out = str(a, "out");
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  const sqlite = openSqlite(dbFile);
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  seedDefaultSettings(sqlite);
  uncapIssueLog();
  const t = performance.now();
  const res = await runImport(sqlite, dir, { source: path.basename(path.resolve(dir)) });
  const rows = sqlite.prepare("SELECT file, line, rule, severity, message FROM import_rejection WHERE batch_id = ? ORDER BY id").all(res.batchId) as Record<string, unknown>[];
  writeCsv(out, rows, ["file", "line", "rule", "severity", "message"]);
  fs.writeFileSync(out.replace(/\.csv$/, ".json"), JSON.stringify({ status: res.status, qualityScore: res.qualityScore, rowsOk: res.rowsOk, rowsRejected: res.rowsRejected, report: res.report }, null, 1), "utf8");
  console.log(`import ${dir} : ${res.status}, qualité ${res.qualityScore}, ${res.rowsRejected} rejets, ${rows.length} lignes détaillées (${Math.round((performance.now() - t) / 1000)} s) → ${out}`);
  sqlite.close();
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  if (cmd === "scores") cmdScores(args);
  else if (cmd === "replay") cmdReplay(args);
  else if (cmd === "import") await cmdImport(args);
  else {
    console.log(USAGE);
    process.exitCode = cmd ? 2 : 0;
  }
}

main().catch((e) => {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exit(1);
});

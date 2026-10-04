import { dbPath, openSqlite } from "../src/db/client";
import { detectAnomalies } from "../src/lib/anomalies";
import { backfillFeatures } from "../src/lib/features";
import { addMonthsToMonth, monthEnd, monthRange } from "../src/lib/features/dates";
import { runAiSteps } from "../src/lib/ai/steps";
import { ensureCalendar, lastCompleteMonth, refreshAggregatesSafe, weeksOfMonth } from "../src/lib/jobs/handlers";
import { coldStartState, scoreMonth, type ScoreResult } from "../src/lib/scoring";

const USAGE = `Usage : npm run pipeline -- [--from YYYY-MM] [--to YYYY-MM] [--backtest]
  --from      premier mois du backfill des variables (défaut : premier mois de données)
  --to        mois scoré et publié (défaut : dernier mois complet de données)
  --backtest  score chaque mois de la période ; seul le dernier est publié (pointeur courant)`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseArgs(argv: string[]) {
  const out: { from?: string; to?: string; backtest: boolean; help: boolean } = { backtest: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from" || a === "--to") {
      const v = argv[++i];
      if (!v || !MONTH_RE.test(v)) throw new Error(`${a} attend un mois YYYY-MM (reçu : ${v ?? "rien"}).`);
      out[a === "--from" ? "from" : "to"] = v;
    } else if (a === "--backtest") out.backtest = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Option inconnue : ${a}\n${USAGE}`);
  }
  return out;
}

const fmtMs = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);
  const sqlite = openSqlite();
  const timings: [string, number][] = [];
  const step = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    const t = performance.now();
    console.log(`→ ${name}…`);
    const r = await fn();
    timings.push([name, performance.now() - t]);
    return r;
  };
  const t0 = performance.now();
  try {
    const first = (
      sqlite.prepare("SELECT min(m) AS m FROM (SELECT substr(min(date), 1, 7) AS m FROM attendance_daily UNION ALL SELECT min(month) FROM payroll_monthly)").get() as {
        m: string | null;
      }
    ).m;
    const to = args.to ?? lastCompleteMonth(sqlite);
    if (!to || !first) throw new Error("Aucune donnée importée (pointages ou paie) : lancez d'abord npm run import.");
    const from = args.from ?? first;
    if (from > to) throw new Error(`Période vide : ${from} > ${to}.`);
    console.log(`Base ${dbPath()} — période ${from} → ${to}${args.backtest ? " (backtest)" : ""}`);

    const calDays = await step("calendrier", () => ensureCalendar(sqlite, Number(from.slice(0, 4)) - 1, Number(to.slice(0, 4))));
    const agg = await step("agrégats", () => refreshAggregatesSafe(sqlite));
    const snaps = await step("variables (backfill)", () =>
      backfillFeatures(sqlite, from, to, {
        onMonth: (m, n) => {
          if (m.endsWith("-12") || m === to) console.log(`   ${m} : ${n} salariés éligibles`);
        },
      }),
    );

    const months = args.backtest ? monthRange(from, to) : [to];
    const runs: ScoreResult[] = await step(`scoring (${months.length} mois)`, () =>
      months.map((m) => scoreMonth(sqlite, m, { publish: m === to, force: true })),
    );
    const published = runs[runs.length - 1];

    const anomalyFrom = args.backtest ? addMonthsToMonth(from, 6) : addMonthsToMonth(to, -11);
    const { fromWeek } = weeksOfMonth(anomalyFrom < from ? from : anomalyFrom);
    const { toWeek } = weeksOfMonth(to);
    const nAnomalies = await step("anomalies", () => detectAnomalies(sqlite, fromWeek, toWeek));
    const ai = await step("IA par sujet", () => runAiSteps(sqlite, monthEnd(to)));

    const levels = sqlite.prepare("SELECT level, count(*) AS n FROM prediction WHERE run_id = ? GROUP BY level").all(published.runId) as { level: string; n: number }[];
    const recos = sqlite.prepare("SELECT action_code AS a, count(*) AS n FROM recommendation WHERE status = 'PROPOSEE' GROUP BY action_code").all() as { a: string; n: number }[];
    const alerts = sqlite.prepare("SELECT type, count(*) AS n FROM alert WHERE status = 'NOUVELLE' GROUP BY type").all() as { type: string; n: number }[];
    const anomalies = sqlite.prepare("SELECT scope, count(*) AS n FROM anomaly GROUP BY scope").all() as { scope: string; n: number }[];
    const kv = (rows: { n: number }[], key: string) => rows.map((r) => `${(r as Record<string, unknown>)[key]}=${r.n}`).join(", ") || "aucune";

    console.log("\nRésumé");
    console.log(`  calendrier      : ${calDays ? `${calDays} jours (re)construits` : "déjà présent ou module indisponible"}`);
    console.log(`  agrégats        : ${agg == null ? "module indisponible" : `${agg} lignes`}`);
    console.log(`  snapshots       : ${snaps} (${monthRange(from, to).length} mois)`);
    console.log(`  modèle          : ${published.modelVersion} (${published.kind === "B0" ? "score à règles" : published.kind})`);
    const cold = published.coldStart ?? (published.kind === "B0" ? null : coldStartState(sqlite, monthEnd(to), published.kind, "v1"));
    if (cold) console.log(`  démarrage froid : ${cold.events} démissions observées (seuil ${cold.threshold}) — ${cold.message ?? "modèle utilisé, probabilité non indicative"}`);
    console.log(`  run publié      : ${published.runId} au ${to} — ${published.nScored} salariés scorés (${kv(levels, "level")})`);
    if (args.backtest) console.log(`  runs backtest   : ${runs.length - 1} runs complets non courants`);
    console.log(`  recommandations : ${published.recommendations} nouvelles ; ouvertes : ${kv(recos, "a")}`);
    console.log(`  alertes         : ${published.alerts} TURNOVER nouvelles ; ouvertes : ${kv(alerts, "type")}`);
    console.log(`  anomalies       : ${nAnomalies} nouvelles (${fromWeek} → ${toWeek}) ; total : ${kv(anomalies, "scope")}`);
    for (const line of ai) console.log(`  IA ${line}`);
    console.log("\nDurées");
    for (const [name, ms] of timings) console.log(`  ${name.padEnd(22)} ${fmtMs(ms)}`);
    console.log(`  ${"total".padEnd(22)} ${fmtMs(performance.now() - t0)}`);
  } finally {
    sqlite.close();
  }
}

main().catch((e) => {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exit(1);
});

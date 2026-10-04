// Validation semi-synthétique de la comparaison appariée sur les données du simulateur (ADR-010).
// Le simulateur ne modélise pas l'effet des interventions RH : on garde ses variables, ses niveaux de risque et ses démissions
// réels, on tire des « suivis » fictifs selon une règle connue, puis on injecte un effet connu (une part π des démissions
// des suivis est retirée). L'estimation appariée, calculée par le code de production (src/lib/matching), est comparée à
// l'effet injecté réalisé sur les suivis appariés. Scénario LATENT : le choix des suivis dépend de l'engagement latent du
// simulateur, absent des variables (confusion non observée) ; il mesure le biais qui reste malgré l'appariement.
// Lecture seule de la base (readonly) et de ground_truth/ ; rien n'est écrit en base.
//
//   npx tsx ml/matching/validate.ts --db data/app.db --sim ../../people-analytics/data/sim/mixte_medium_s1 --reps 40
//   options : --from 2024-03 --to 2026-02 (mois t, suivi de 6 mois complet) --out ml/matching/results/<nom>.json --seed 1

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { compareMatched, mulberry32, type ComparisonUnit } from "../../src/lib/matching";

type Args = { db: string; sim: string | null; reps: number; from: string; to: string; out: string | null; seed: number };

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    db: get("db") ?? "data/app.db",
    sim: get("sim") ?? null,
    reps: Number(get("reps") ?? 40),
    from: get("from") ?? "2024-03",
    to: get("to") ?? "2026-02",
    out: get("out") ?? null,
    seed: Number(get("seed") ?? 1),
  };
}

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthRange = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const LEVEL_RANK: Record<string, number> = { FAIBLE: 0, MOYEN: 1, ELEVE: 2 };

type Row = {
  id: number;
  t: string;
  x: number[];
  eleve: number;
  moyen: number;
  y6: number;
  levelDown: number | null;
  riskUntil: string | null;
  latent: number | null;
};

function loadPanel(a: Args) {
  const db = new Database(a.db, { readonly: true, fileMustExist: true });
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../shared/features.json"), "utf8")) as { fsv: string; features: { name: string }[] };
  const names = spec.features.map((f) => f.name);
  const months = monthRange(a.from, a.to).map(monthEnd);
  const inMonths = JSON.stringify(months);
  const snaps = db
    .prepare(
      `SELECT fs.employee_id AS id, fs.as_of AS t, fs.values_json AS v, e.matricule FROM feature_snapshot fs JOIN employee e ON e.id = fs.employee_id
       WHERE fs.fsv = ? AND fs.as_of IN (SELECT value FROM json_each(?)) AND fs.employee_id NOT IN (SELECT employee_id FROM employee_opposition)`,
    )
    .all(spec.fsv, inMonths) as { id: number; t: string; v: string; matricule: string }[];
  const labels = new Map(
    (
      db
        .prepare(
          `SELECT employee_id AS id, as_of AS t, MAX(y6) AS y6, MAX(followup_complete) AS fc FROM v_label_panel
           WHERE fsv = ? AND as_of IN (SELECT value FROM json_each(?)) GROUP BY employee_id, as_of`,
        )
        .all(spec.fsv, inMonths) as { id: number; t: string; y6: number; fc: number }[]
    ).map((r) => [`${r.id}|${r.t}`, r]),
  );
  // Un calcul publié par fin de mois (le plus récent), comme publishedRuns()
  const runByAsOf = new Map<string, number>();
  for (const r of db.prepare("SELECT id, as_of AS asOf FROM scoring_run WHERE status = 'PUBLIE' ORDER BY as_of, id").all() as { id: number; asOf: string }[])
    runByAsOf.set(r.asOf, r.id);
  const runAsOfs = [...runByAsOf.keys()].sort();
  const levels = new Map<string, string>();
  for (const r of db.prepare("SELECT run_id AS run, employee_id AS id, level FROM prediction WHERE run_id IN (SELECT value FROM json_each(?))").all(JSON.stringify([...runByAsOf.values()])) as {
    run: number;
    id: number;
    level: string;
  }[])
    levels.set(`${r.run}|${r.id}`, r.level);
  const exits = new Map<number, { exitDate: string; reason: string | null; eventDate: string | null }[]>();
  for (const r of db
    .prepare(
      `SELECT employee_id AS id, exit_date AS exitDate, reason, COALESCE(resignation_date, date(exit_date, '-1 month')) AS eventDate FROM exit_event
       UNION ALL SELECT id, exit_date, NULL, NULL FROM employee WHERE exit_date IS NOT NULL`,
    )
    .all() as { id: number; exitDate: string; reason: string | null; eventDate: string | null }[])
    exits.set(r.id, [...(exits.get(r.id) ?? []), r]);
  db.close();

  const latents = new Map<string, number>();
  if (a.sim) {
    const file = path.join(a.sim, "ground_truth", "latent_monthly.csv");
    const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    const cols = header.split(";");
    const [im, imo, ie] = ["matricule", "month", "engagement"].map((c) => cols.indexOf(c));
    for (const l of lines) {
      const c = l.split(";");
      latents.set(`${c[im]}|${c[imo]}`, Number(c[ie]));
    }
  }

  const riskUntil = (id: number, t: string) => {
    let until: string | null = null;
    for (const e of exits.get(id) ?? []) {
      if (e.exitDate <= t) continue;
      for (const d of [e.exitDate, e.reason === "DEMISSION" || e.reason === "ABANDON" ? e.eventDate : null]) if (d && (!until || d < until)) until = d;
    }
    return until;
  };
  const before = (t: string) => runAsOfs.filter((x) => x <= t).at(-1);
  const after = (t: string) => {
    const m = addMonths(t.slice(0, 7), 1);
    return runAsOfs.filter((x) => x > monthEnd(m) && x <= monthEnd(addMonths(m, 3))).at(-1);
  };

  const rows: Row[] = [];
  for (const s of snaps) {
    const lab = labels.get(`${s.id}|${s.t}`);
    if (!lab || lab.fc !== 1) continue;
    const b = before(s.t);
    const af = after(s.t);
    const lb = b ? levels.get(`${runByAsOf.get(b)}|${s.id}`) : undefined;
    const la = af ? levels.get(`${runByAsOf.get(af)}|${s.id}`) : undefined;
    rows.push({
      id: s.id,
      t: s.t,
      x: JSON.parse(s.v) as number[],
      eleve: lb === "ELEVE" ? 1 : 0,
      moyen: lb === "MOYEN" ? 1 : 0,
      y6: lab.y6 ? 1 : 0,
      levelDown: lb && la ? (LEVEL_RANK[la] < LEVEL_RANK[lb] ? 1 : 0) : null,
      riskUntil: riskUntil(s.id, s.t),
      latent: latents.get(`${s.matricule}|${s.t.slice(0, 7)}`) ?? null,
    });
  }
  return { rows, names };
}

type Scenario = { name: string; label: string; selection: "OBSERVEE" | "LATENTE"; pi: number; target: number };
type OutcomeRecord = { status: string; diff: number | null; low: number | null; high: number | null; naiveDiff: number | null; truth: number | null };
type RepResult = {
  rep: number;
  treated: number;
  status: string;
  matched: number;
  matchedShare: number | null;
  maxSmdBefore: number | null;
  maxSmdAfter: number | null;
  verdict: string | null;
  resign: OutcomeRecord;
  level: OutcomeRecord & { treatedDownShare: number | null };
};

const SCENARIOS: Scenario[] = [
  { name: "OBS_EFFET", label: "Sélection sur variables observées, effet injecté (π = 0,4), ≈ 150 suivis", selection: "OBSERVEE", pi: 0.4, target: 150 },
  { name: "OBS_NUL", label: "Sélection sur variables observées, aucun effet, ≈ 150 suivis", selection: "OBSERVEE", pi: 0, target: 150 },
  { name: "OBS_PETIT", label: "Sélection sur variables observées, effet injecté (π = 0,4), ≈ 40 suivis", selection: "OBSERVEE", pi: 0.4, target: 40 },
  { name: "LATENT", label: "Sélection sur l'engagement latent (non observé), effet injecté (π = 0,4), ≈ 150 suivis", selection: "LATENTE", pi: 0.4, target: 150 },
];

function zscores(values: number[]) {
  const m = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - m) * (v - m)))) || 1;
  return values.map((v) => (v - m) / sd);
}

function runScenario(sc: Scenario, rows: Row[], names: string[], reps: number, seed: number) {
  const iOt = names.indexOf("overtime_h_avg_3m");
  const iCompa = names.indexOf("compa_ratio");
  const zOt = zscores(rows.map((r) => r.x[iOt]));
  const zCompa = zscores(rows.map((r) => r.x[iCompa]));
  const zLat = zscores(rows.map((r) => r.latent ?? 0));
  const lin = rows.map((r, i) =>
    sc.selection === "OBSERVEE" ? 2 * r.eleve + 1.2 * r.moyen + 0.4 * zOt[i] - 0.4 * zCompa[i] : 2 * r.eleve + 1.2 * r.moyen - 1.2 * zLat[i],
  );
  // Intercept tel que le nombre attendu de lignes suivies vaille la cible (les suivis multiples d'un même salarié sont ensuite écartés)
  let lo = -25;
  let hi = 5;
  for (let k = 0; k < 80; k++) {
    const a = (lo + hi) / 2;
    if (lin.reduce((s, l) => s + sigmoid(a + l), 0) > sc.target) hi = a;
    else lo = a;
  }
  const intercept = (lo + hi) / 2;
  const order = rows.map((_, i) => i).sort((a, b) => rows[a].t.localeCompare(rows[b].t) || rows[a].id - rows[b].id);
  const results: RepResult[] = [];
  for (let rep = 0; rep < reps; rep++) {
    const rand = mulberry32(seed * 100003 + rep * 7919 + SCENARIOS.indexOf(sc) * 104729);
    const treatedAt = new Map<number, string>();
    const treatedRows: number[] = [];
    for (const i of order) {
      const r = rows[i];
      if (treatedAt.has(r.id)) continue;
      const date = `${addMonths(r.t.slice(0, 7), 1)}-15`;
      if (r.riskUntil && r.riskUntil <= date) continue;
      if (rand() < sigmoid(intercept + lin[i])) {
        treatedAt.set(r.id, r.t);
        treatedRows.push(i);
      }
    }
    const flipped = new Set<number>();
    for (const i of treatedRows) if (rows[i].y6 === 1 && rand() < sc.pi) flipped.add(i);
    const strata = new Set(treatedRows.map((i) => rows[i].t));
    const washout = (id: number, t: string) => {
      const d = treatedAt.get(id);
      if (!d) return false;
      const dt = `${addMonths(d.slice(0, 7), 1)}-15`;
      return dt > monthEnd(addMonths(t.slice(0, 7), -6)) && dt <= monthEnd(addMonths(t.slice(0, 7), 6));
    };
    const units: ComparisonUnit[] = [];
    const keyRow = new Map<string, number>();
    for (const i of treatedRows) {
      const r = rows[i];
      const key = `s${r.id}@${r.t}`;
      keyRow.set(key, i);
      units.push({ key, stratum: r.t, treated: true, x: [...r.x, r.eleve, r.moyen], date: `${addMonths(r.t.slice(0, 7), 1)}-15`, outcomes: [flipped.has(i) ? 0 : r.y6, r.levelDown] });
    }
    rows.forEach((r) => {
      if (!strata.has(r.t) || washout(r.id, r.t)) return;
      units.push({ key: `t${r.id}@${r.t}`, stratum: r.t, treated: false, x: [...r.x, r.eleve, r.moyen], atRiskUntil: r.riskUntil, outcomes: [r.y6, r.levelDown] });
    });
    const res = compareMatched(units, 2, { bootstrap: 1000, minTreated: 20, minPairs: 20 });
    const matchedTreated = res.pairs.map((p) => keyRow.get(p.treated)!);
    const truth = matchedTreated.length ? -matchedTreated.filter((i) => flipped.has(i)).length / matchedTreated.length : null;
    const levelMeasured = res.pairs.filter((p) => rows[keyRow.get(p.treated)!].levelDown != null);
    results.push({
      rep,
      treated: treatedRows.length,
      status: res.status,
      matched: res.matched,
      matchedShare: res.matchedShare,
      maxSmdBefore: res.maxSmdBefore,
      maxSmdAfter: res.maxSmdAfter,
      verdict: res.verdict,
      resign: { ...res.outcomes[0], truth },
      level: { ...res.outcomes[1], truth: 0, treatedDownShare: levelMeasured.length ? mean(levelMeasured.map((p) => rows[keyRow.get(p.treated)!].levelDown as number)) : null },
    });
  }
  return { intercept, results };
}

function summarize(results: RepResult[], pick: (r: RepResult) => OutcomeRecord) {
  const ok = results.map(pick).filter((o) => o.status === "OK" && o.diff != null && o.truth != null);
  const err = ok.map((o) => (o.diff as number) - (o.truth as number));
  return {
    estimated: ok.length,
    replicates: results.length,
    meanEstimate: mean(ok.map((o) => o.diff as number)),
    meanTruth: mean(ok.map((o) => o.truth as number)),
    bias: mean(err),
    rmse: Math.sqrt(mean(err.map((e) => e * e))),
    coverage: mean(ok.map((o) => ((o.low as number) <= (o.truth as number) && (o.truth as number) <= (o.high as number) ? 1 : 0))),
    meanWidth: mean(ok.map((o) => (o.high as number) - (o.low as number))),
    excludesZero: mean(ok.map((o) => ((o.low as number) > 0 || (o.high as number) < 0 ? 1 : 0))),
    naiveBias: mean(ok.filter((o) => o.naiveDiff != null).map((o) => (o.naiveDiff as number) - (o.truth as number))),
  };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const { rows, names } = loadPanel(a);
  const hasLatent = rows.some((r) => r.latent != null);
  const out: Record<string, unknown> = {
    db: a.db,
    sim: a.sim,
    months: `${a.from} → ${a.to}`,
    rows: rows.length,
    employees: new Set(rows.map((r) => r.id)).size,
    reps: a.reps,
    seed: a.seed,
    scenarios: {} as Record<string, unknown>,
  };
  const lines = [
    "| Scénario | Suivis (moy.) | Estimés | Effet réalisé | Estimation | Biais | RMSE | Couverture 95 % | Largeur | Exclut 0 | Biais sans appariement | Part appariée | DS max après |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const levelLines = ["| Scénario | Suivis en baisse (avant / après brut) | Écart apparié | Couverture de 0 | Exclut 0 |", "|---|---|---|---|---|"];
  const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  for (const sc of SCENARIOS) {
    if (sc.selection === "LATENTE" && !hasLatent) continue;
    const { intercept, results } = runScenario(sc, rows, names, a.reps, a.seed);
    const resign = summarize(results, (r) => r.resign);
    const level = summarize(results, (r) => r.level);
    const ok = results.filter((r) => r.status === "OK");
    const extra = {
      meanTreated: mean(results.map((r) => r.treated)),
      meanMatchedShare: mean(ok.map((r) => r.matchedShare as number)),
      meanMaxSmdAfter: mean(ok.map((r) => r.maxSmdAfter as number)),
      meanMaxSmdBefore: mean(ok.map((r) => r.maxSmdBefore as number)),
      comparableShare: mean(ok.map((r) => (r.verdict === "COMPARABLE" ? 1 : 0))),
      treatedDownShare: mean(ok.map((r) => r.level.treatedDownShare).filter((v): v is number => v != null)),
    };
    (out.scenarios as Record<string, unknown>)[sc.name] = { label: sc.label, intercept, resign, level, ...extra, results };
    lines.push(
      `| ${sc.name} | ${f(extra.meanTreated, 0)} | ${resign.estimated}/${resign.replicates} | ${f(resign.meanTruth)} | ${f(resign.meanEstimate)} | ${f(resign.bias)} | ${f(resign.rmse)} | ${f(resign.coverage, 2)} | ${f(resign.meanWidth)} | ${f(resign.excludesZero, 2)} | ${f(resign.naiveBias)} | ${f(extra.meanMatchedShare, 2)} | ${f(extra.meanMaxSmdAfter)} |`,
    );
    levelLines.push(`| ${sc.name} | ${f(extra.treatedDownShare)} | ${f(level.meanEstimate)} | ${f(level.coverage, 2)} | ${f(level.excludesZero, 2)} |`);
    console.error(`${sc.name} : ${results.length} réplications, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  out.durationSeconds = Math.round((Date.now() - started) / 1000);
  const file = a.out ?? path.resolve(__dirname, "results", `validation-${path.basename(a.sim ?? path.basename(a.db, ".db"))}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`Panel : ${rows.length} lignes (salarié × mois), ${out.employees as number} salariés, mois t ${a.from} → ${a.to}, ${a.reps} réplications.\n`);
  console.log("Démission dans les 6 mois (écart suivis − témoins appariés, en part) :\n");
  console.log(lines.join("\n"));
  console.log("\nNiveau de risque en baisse 3 mois après (aucun effet injecté, vérité = 0) :\n");
  console.log(levelLines.join("\n"));
  console.log(`\nRésultats détaillés : ${file}`);
}

main();

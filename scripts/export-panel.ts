import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "../src/db/client";
import { computeFeaturesForMonth, FEATURE_NAMES } from "../src/lib/features";
import { monthEnd, monthRange } from "../src/lib/features/dates";
import { excludeOpposed } from "../src/lib/privacy";

const USAGE = `Usage : npx tsx scripts/export-panel.ts --out <fichier.csv> [--mode naive|nominal] [--from YYYY-MM] [--to YYYY-MM]
  Recalcule les variables de chaque fin de mois sans rien écrire en base (ouverture en lecture seule).
  Les salariés opposés au traitement prédictif (employee_opposition) sont exclus du panel.
  --mode naive   ignore recorded_at (expérience de fuite Q1b, ml/train) ; population identique au mode nominal
  --from / --to  période (défaut : mois présents dans feature_snapshot)`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Variables d'une fin de mois pour le panel, salariés opposés exclus
export function panelRows(sqlite: Database.Database, asOf: string, mode: "naive" | "nominal") {
  return excludeOpposed(sqlite, computeFeaturesForMonth(sqlite, asOf, { naive: mode === "naive" }));
}

function parseArgs(argv: string[]) {
  const out: { out?: string; mode: "naive" | "nominal"; from?: string; to?: string } = { mode: "naive" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[++i];
    if (a === "--out") out.out = v;
    else if (a === "--mode" && (v === "naive" || v === "nominal")) out.mode = v;
    else if ((a === "--from" || a === "--to") && v && MONTH_RE.test(v)) out[a === "--from" ? "from" : "to"] = v;
    else throw new Error(`Option invalide : ${a} ${v ?? ""}\n${USAGE}`);
  }
  if (!out.out) throw new Error(USAGE);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqlite = new Database(dbPath(), { readonly: true, fileMustExist: true });
  sqlite.pragma("busy_timeout = 5000");
  try {
    const span = sqlite.prepare("SELECT substr(min(as_of), 1, 7) AS a, substr(max(as_of), 1, 7) AS b FROM feature_snapshot").get() as {
      a: string | null;
      b: string | null;
    };
    const from = args.from ?? span.a;
    const to = args.to ?? span.b;
    if (!from || !to) throw new Error("feature_snapshot vide : lancez d'abord npm run pipeline.");
    fs.mkdirSync(path.dirname(path.resolve(args.out!)), { recursive: true });
    const fd = fs.openSync(args.out!, "w");
    fs.writeSync(fd, `employee_id;as_of;partial_history;${FEATURE_NAMES.join(";")}\n`);
    const t0 = performance.now();
    let total = 0;
    for (const m of monthRange(from, to)) {
      const asOf = monthEnd(m);
      const rows = panelRows(sqlite, asOf, args.mode);
      fs.writeSync(fd, rows.map((r) => `${r.employeeId};${asOf};${r.partial ? 1 : 0};${r.values.join(";")}`).join("\n") + (rows.length ? "\n" : ""));
      total += rows.length;
    }
    fs.closeSync(fd);
    console.log(`${total} lignes (${args.mode}) ${from} → ${to} écrites dans ${args.out} en ${((performance.now() - t0) / 1000).toFixed(1)} s (base ${dbPath()}).`);
  } finally {
    sqlite.close();
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`Erreur : ${(e as Error).message}`);
    process.exit(1);
  }
}

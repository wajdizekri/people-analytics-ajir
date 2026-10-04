import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dbPath, openSqlite } from "../src/db/client";
import { getSetting } from "../src/lib/settings";
import { opposedEmployeeIds, purgePredictiveData, type PurgeCounts } from "../src/lib/privacy";
import { loadDotEnv } from "./backup";

const USAGE = `Usage : npx tsx scripts/retention.ts [--apply] [--db <fichier>] [--inbox <dossier>] [--inbox-days <n>] [--predictions-months <n>] [--audit-months <n>]
  (sans --apply)        simulation : affiche ce qui serait purgé, ne modifie rien
  --apply               applique la purge (trace retention.apply dans le journal d'audit)
  --db                  base (défaut : DATABASE_PATH, sinon data/app.db)
  --inbox               dossier des exports AJIR déposés (défaut : <dossier de la base>/inbox)
  --inbox-days          conservation des exports déposés, en jours (défaut : RETENTION_INBOX_DAYS, paramètre retention_inbox_days, sinon 90)
  --predictions-months  conservation des prédictions et facteurs, en mois (défaut : RETENTION_PREDICTION_MONTHS, paramètre retention_prediction_months, sinon 24)
  --audit-months        seuil d'archivage signalé pour le journal d'audit (défaut : 12) ; le journal n'est jamais supprimé
Purge : sessions expirées ; prédictions, facteurs et risques de formation plus anciens que la durée, hors calcul publié ;
exports déposés plus anciens que la durée (sauf import en file ou en cours) ; données prédictives résiduelles des salariés opposés.`;

export const DEFAULTS = { inboxDays: 90, predictionMonths: 24, auditMonths: 12 } as const;

export type RetentionOptions = {
  apply?: boolean;
  now?: Date;
  inboxDir: string;
  inboxDays: number;
  predictionMonths: number;
  auditMonths?: number;
};

export type RetentionReport = {
  apply: boolean;
  at: string;
  sessions: number;
  predictions: { cutoff: string; months: number; runs: { id: number; asOf: string }[]; predictions: number; factors: number; trainingRisks: number };
  inbox: { dir: string; days: number; cutoff: string; removed: string[]; kept: { name: string; reason: string }[] };
  oppositions: { employees: number; purged: PurgeCounts };
  audit: { months: number; cutoff: string; olderEntries: number; total: number };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
function monthsBefore(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return iso(d);
}

// Durée : option > variable d'environnement > paramètre de l'application > défaut
export function resolveDuration(sqlite: Database.Database, cli: number | undefined, env: string, setting: string, fallback: number): number {
  const candidates = [cli, process.env[env], getSetting(sqlite, setting)];
  for (const c of candidates) {
    if (c === undefined || c === "") continue;
    const n = Number(c);
    if (!Number.isInteger(n) || n < 1) throw new Error(`Durée de conservation invalide (${env} / ${setting}) : ${c} (entier >= 1 attendu).`);
    return n;
  }
  return fallback;
}

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-\d+)?$/;
function depositDate(dir: string, name: string): Date {
  const m = STAMP.exec(name);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return fs.statSync(path.join(dir, name)).mtime;
}

const ZERO: PurgeCounts = { predictions: 0, factors: 0, snapshots: 0, recommendations: 0, alerts: 0, trainingRisks: 0, insights: 0 };

// Simulation = mêmes requêtes dans une transaction annulée : les comptes affichés sont exactement ceux d'une application
export function runRetention(sqlite: Database.Database, opts: RetentionOptions): RetentionReport {
  const apply = opts.apply ?? false;
  const now = opts.now ?? new Date();
  const predCutoff = monthsBefore(now, opts.predictionMonths);
  const auditMonths = opts.auditMonths ?? DEFAULTS.auditMonths;
  const auditCutoff = monthsBefore(now, auditMonths);
  const current = Number(getSetting(sqlite, "current_run_id")) || -1;

  sqlite.exec("BEGIN IMMEDIATE");
  let db: Omit<RetentionReport, "apply" | "at" | "inbox" | "audit">;
  try {
    const sessions = sqlite.prepare("DELETE FROM session WHERE expires_at <= ?").run(now.toISOString()).changes;

    const runs = sqlite
      .prepare("SELECT id, as_of AS asOf FROM scoring_run WHERE as_of < ? AND id <> ? ORDER BY as_of, id")
      .all(predCutoff, current) as { id: number; asOf: string }[];
    let predictions = 0;
    let factors = 0;
    const inRun = "SELECT id FROM prediction WHERE run_id = ?";
    for (const r of runs) {
      sqlite.prepare(`UPDATE recommendation SET prediction_id = NULL WHERE prediction_id IN (${inRun})`).run(r.id);
      factors += sqlite.prepare(`DELETE FROM prediction_factor WHERE prediction_id IN (${inRun})`).run(r.id).changes;
      predictions += sqlite.prepare("DELETE FROM prediction WHERE run_id = ?").run(r.id).changes;
      sqlite.prepare("DELETE FROM scoring_run WHERE id = ?").run(r.id);
    }
    const trainingRisks = sqlite.prepare("DELETE FROM training_risk WHERE as_of < ?").run(predCutoff).changes;

    const opposed = [...opposedEmployeeIds(sqlite)];
    const purged = { ...ZERO };
    for (const id of opposed) {
      const p = purgePredictiveData(sqlite, id);
      for (const k of Object.keys(purged) as (keyof PurgeCounts)[]) purged[k] += p[k];
    }
    db = {
      sessions,
      predictions: { cutoff: predCutoff, months: opts.predictionMonths, runs, predictions, factors, trainingRisks },
      oppositions: { employees: opposed.length, purged },
    };
    sqlite.exec(apply ? "COMMIT" : "ROLLBACK");
  } catch (e) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw e;
  }

  const inboxCutoff = new Date(now.getTime() - opts.inboxDays * 86_400_000);
  const inbox: RetentionReport["inbox"] = { dir: opts.inboxDir, days: opts.inboxDays, cutoff: inboxCutoff.toISOString(), removed: [], kept: [] };
  if (fs.existsSync(opts.inboxDir)) {
    const active = new Set(
      (sqlite.prepare("SELECT target FROM app_job WHERE type = 'IMPORT' AND status IN ('EN_FILE','EN_COURS')").all() as { target: string | null }[]).map((j) => j.target),
    );
    for (const ent of fs.readdirSync(opts.inboxDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!ent.isDirectory()) {
        inbox.kept.push({ name: ent.name, reason: "fichier hors dépôt (ignoré)" });
        continue;
      }
      if (depositDate(opts.inboxDir, ent.name) >= inboxCutoff) continue;
      if (active.has(`inbox/${ent.name}`)) {
        inbox.kept.push({ name: ent.name, reason: "import en file ou en cours" });
        continue;
      }
      if (apply) fs.rmSync(path.join(opts.inboxDir, ent.name), { recursive: true, force: true });
      inbox.removed.push(ent.name);
    }
  }

  const a = sqlite.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(at < ?), 0) AS older FROM audit_log").get(auditCutoff) as { total: number; older: number };
  const report: RetentionReport = {
    apply,
    at: now.toISOString(),
    ...db,
    inbox,
    audit: { months: auditMonths, cutoff: auditCutoff, olderEntries: a.older, total: a.total },
  };
  if (apply) {
    sqlite
      .prepare("INSERT INTO audit_log (user_id, action, target_type, outcome, detail_json) VALUES (NULL, 'retention.apply', 'retention', 'OK', ?)")
      .run(
        JSON.stringify({
          sessions: report.sessions,
          predictionCutoff: predCutoff,
          runs: report.predictions.runs.map((r) => r.id),
          predictions: report.predictions.predictions,
          factors: report.predictions.factors,
          trainingRisks: report.predictions.trainingRisks,
          inboxRemoved: inbox.removed,
          oppositions: report.oppositions,
        }),
      );
  }
  return report;
}

function parseArgs(argv: string[]) {
  const out: { apply: boolean; help: boolean; db?: string; inbox?: string; inboxDays?: number; predictionMonths?: number; auditMonths?: number } = { apply: false, help: false };
  const num = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (!v || !Number.isInteger(n) || n < 1) throw new Error(`${flag} attend un entier >= 1 (reçu : ${v ?? "rien"}).`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--db" || a === "--inbox") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} attend une valeur.\n${USAGE}`);
      out[a === "--db" ? "db" : "inbox"] = v;
    } else if (a === "--inbox-days") out.inboxDays = num(a, argv[++i]);
    else if (a === "--predictions-months") out.predictionMonths = num(a, argv[++i]);
    else if (a === "--audit-months") out.auditMonths = num(a, argv[++i]);
    else throw new Error(`Option inconnue : ${a}\n${USAGE}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);
  const envLoaded = loadDotEnv();
  const file = path.resolve(args.db ?? dbPath());
  if (!fs.existsSync(file)) throw new Error(`Base introuvable : ${file}`);
  const sqlite = openSqlite(file);
  try {
    const r = runRetention(sqlite, {
      apply: args.apply,
      inboxDir: path.resolve(args.inbox ?? path.join(path.dirname(file), "inbox")),
      inboxDays: resolveDuration(sqlite, args.inboxDays, "RETENTION_INBOX_DAYS", "retention_inbox_days", DEFAULTS.inboxDays),
      predictionMonths: resolveDuration(sqlite, args.predictionMonths, "RETENTION_PREDICTION_MONTHS", "retention_prediction_months", DEFAULTS.predictionMonths),
      auditMonths: args.auditMonths,
    });
    const verb = r.apply ? "supprimé(s)" : "à supprimer";
    console.log(`Rétention des données — ${r.apply ? "APPLICATION" : "SIMULATION (aucune modification ; --apply pour appliquer)"}${envLoaded ? " (variables lues dans .env)" : ""}`);
    console.log(`  base              ${file}`);
    console.log(`  sessions          ${r.sessions} session(s) expirée(s) ${verb}`);
    console.log(
      `  prédictions       avant le ${r.predictions.cutoff} (${r.predictions.months} mois), hors calcul publié : ${r.predictions.runs.length} calcul(s), ` +
        `${r.predictions.predictions} prédiction(s), ${r.predictions.factors} facteur(s), ${r.predictions.trainingRisks} risque(s) formation ${verb}`,
    );
    const p = r.oppositions.purged;
    console.log(
      `  oppositions       ${r.oppositions.employees} salarié(s) opposé(s) : résidus ${verb} — ${p.predictions} prédiction(s), ${p.factors} facteur(s), ` +
        `${p.snapshots} variable(s) mensuelle(s), ${p.recommendations} recommandation(s) ouverte(s), ${p.alerts} alerte(s), ${p.trainingRisks + p.insights} élément(s) IA`,
    );
    console.log(`  exports déposés   ${r.inbox.dir} — plus de ${r.inbox.days} jours : ${r.inbox.removed.length ? r.inbox.removed.join(", ") : "aucun"} ${r.inbox.removed.length ? verb : ""}`.trimEnd());
    for (const k of r.inbox.kept) console.log(`                    conservé : ${k.name} (${k.reason})`);
    console.log(
      `  journal d'audit   ${r.audit.total} entrée(s), dont ${r.audit.olderEntries} de plus de ${r.audit.months} mois : jamais supprimées (ajout seul). ` +
        `Archivage : export chiffré hors ligne, voir docs/conformite/procedure-exercice-des-droits.md (section 6).`,
    );
  } finally {
    sqlite.close();
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

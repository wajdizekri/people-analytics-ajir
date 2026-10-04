import path from "node:path";
import type Database from "better-sqlite3";
import { auditSqlite, systemAlert } from "../engine/alerts";
import { setSetting } from "../settings";

export const JOB_TYPES = ["IMPORT", "AGGREGATE", "FEATURES", "SCORING", "ANOMALIES", "BATCH_MENSUEL"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type Job = {
  id: number;
  type: JobType;
  target: string | null;
  status: "EN_FILE" | "EN_COURS" | "TERMINE" | "ECHEC";
  payload: Record<string, unknown>;
  createdBy: number | null;
  error: string | null;
};

export const HEARTBEAT_MS = 15_000;
export const STALE_MS = 10 * 60_000;
const RESUMED = "Repris après arrêt du worker";

const nowIso = () => new Date().toISOString();

// Libellés des traitements dans les alertes et messages (mêmes mots que la console d'administration)
const JOB_LABEL: Record<JobType, string> = {
  IMPORT: "Import",
  AGGREGATE: "Agrégats",
  FEATURES: "Variables",
  SCORING: "Calcul des risques",
  ANOMALIES: "Anomalies",
  BATCH_MENSUEL: "Calcul mensuel",
};
const jobName = (type: JobType | undefined, target: string | null | undefined) => `« ${type ? (JOB_LABEL[type] ?? type) : "?"} »${target ? ` (${target})` : ""}`;
const frDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Tunis", dateStyle: "short", timeStyle: "short" });

type JobRow = { id: number; type: JobType; target: string | null; status: Job["status"]; payload: string | null; createdBy: number | null; error: string | null };
const SELECT_JOB = "SELECT id, type, target, status, payload_json AS payload, created_by AS createdBy, error FROM app_job";
const toJob = (r: JobRow): Job => ({ ...r, payload: r.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : {} });

// Un seul job actif par (type, cible) : renvoie l'id du job déjà en file ou en cours le cas échéant.
export function enqueueJob(
  sqlite: Database.Database,
  type: JobType,
  target?: string | null,
  payload?: Record<string, unknown> | null,
  userId?: number | null,
): number {
  if (!JOB_TYPES.includes(type)) throw new Error(`Type de job inconnu : ${type}`);
  return sqlite
    .transaction(() => {
      const existing = sqlite
        .prepare("SELECT id FROM app_job WHERE type = ? AND target IS ? AND status IN ('EN_FILE','EN_COURS') LIMIT 1")
        .get(type, target ?? null) as { id: number } | undefined;
      if (existing) return existing.id;
      return Number(
        sqlite
          .prepare("INSERT INTO app_job (type, target, payload_json, created_by) VALUES (?, ?, ?, ?)")
          .run(type, target ?? null, payload ? JSON.stringify(payload) : null, userId ?? null).lastInsertRowid,
      );
    })
    .immediate();
}

export function claimNextJob(sqlite: Database.Database): Job | null {
  return sqlite
    .transaction(() => {
      const row = sqlite.prepare(`${SELECT_JOB} WHERE status = 'EN_FILE' ORDER BY id LIMIT 1`).get() as JobRow | undefined;
      if (!row) return null;
      const now = nowIso();
      sqlite.prepare("UPDATE app_job SET status = 'EN_COURS', started_at = ?, heartbeat_at = ?, finished_at = NULL WHERE id = ?").run(now, now, row.id);
      return toJob({ ...row, status: "EN_COURS" });
    })
    .immediate();
}

export function getJob(sqlite: Database.Database, id: number): Job | null {
  const row = sqlite.prepare(`${SELECT_JOB} WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function heartbeat(sqlite: Database.Database, jobId?: number | null): void {
  const now = nowIso();
  if (jobId != null) sqlite.prepare("UPDATE app_job SET heartbeat_at = ? WHERE id = ? AND status = 'EN_COURS'").run(now, jobId);
  setSetting(sqlite, "worker_heartbeat", now);
}

export function completeJob(sqlite: Database.Database, id: number): void {
  sqlite.prepare("UPDATE app_job SET status = 'TERMINE', finished_at = ?, heartbeat_at = ?, error = NULL WHERE id = ?").run(nowIso(), nowIso(), id);
}

export function failJob(sqlite: Database.Database, id: number, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  sqlite.prepare("UPDATE app_job SET status = 'ECHEC', finished_at = ?, error = ? WHERE id = ?").run(nowIso(), msg.slice(0, 2000), id);
  const job = getJob(sqlite, id);
  systemAlert(
    sqlite,
    `job:${id}`,
    "Échec d'un traitement",
    `Le traitement ${jobName(job?.type, job?.target)} n° ${id} a échoué : ${msg}${/[.!?]$/.test(msg) ? "" : "."} ` +
      "Consultez la liste des traitements dans Santé des données, corrigez la cause, puis relancez-le.",
  );
}

// Lot d'import laissé EN_COURS par un job IMPORT interrompu (même source, démarré après le job) : passé ECHEC.
function failInterruptedImport(sqlite: Database.Database, j: JobRow): number {
  const started = (sqlite.prepare("SELECT started_at AS s FROM app_job WHERE id = ?").get(j.id) as { s: string | null } | undefined)?.s;
  if (j.type !== "IMPORT" || !started) return 0;
  const p = toJob(j).payload;
  const dir = typeof p.dir === "string" && p.dir ? p.dir : j.target;
  const source = typeof p.source === "string" && p.source ? p.source : dir ? path.basename(path.resolve(dir)) : null;
  if (!source) return 0;
  const batches = sqlite
    .prepare("SELECT id, user_id AS userId FROM import_batch WHERE status = 'EN_COURS' AND source = ? AND started_at >= ?")
    .all(source, started) as { id: number; userId: number | null }[];
  for (const b of batches) {
    sqlite.prepare("UPDATE import_batch SET status = 'ECHEC', finished_at = ? WHERE id = ? AND status = 'EN_COURS'").run(nowIso(), b.id);
    auditSqlite(sqlite, b.userId, "import.run", { type: "import_batch", id: b.id }, "ECHEC", { source, error: "Import interrompu (arrêt du service de calcul)", job: j.id });
  }
  return batches.length;
}

// Jobs EN_COURS sans heartbeat depuis STALE_MS : remis en file une fois, puis ECHEC (lot d'import interrompu : ECHEC).
// Runs STAGING plus anciens que STALE_MS : ECHEC (le pointeur publié n'a pas bougé).
export function recoverStale(sqlite: Database.Database, staleMs = STALE_MS): { requeued: number; failed: number; failedRuns: number } {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  let requeued = 0;
  let failed = 0;
  const stale = sqlite
    .prepare(`${SELECT_JOB} WHERE status = 'EN_COURS' AND coalesce(heartbeat_at, started_at, created_at) < ?`)
    .all(cutoff) as JobRow[];
  for (const j of stale) {
    failInterruptedImport(sqlite, j);
    if (j.error?.startsWith(RESUMED)) {
      failJob(sqlite, j.id, new Error(`${RESUMED} une première fois, puis de nouveau interrompu : traitement abandonné.`));
      failed++;
      continue;
    }
    sqlite
      .prepare("UPDATE app_job SET status = 'EN_FILE', started_at = NULL, heartbeat_at = NULL, error = ? WHERE id = ? AND status = 'EN_COURS'")
      .run(`${RESUMED} (service de calcul sans signal depuis le ${frDateTime(cutoff)}).`, j.id);
    systemAlert(
      sqlite,
      `job-repris:${j.id}`,
      "Traitement interrompu puis relancé",
      `Le traitement ${jobName(j.type, j.target)} n° ${j.id} ne donnait plus signe de vie : il a été relancé automatiquement. Aucune action n'est nécessaire s'il se termine ; sinon, vérifiez que le service de calcul fonctionne.`,
      "ATTENTION",
    );
    requeued++;
  }
  const runs = sqlite
    .prepare(
      "UPDATE scoring_run SET status = 'ECHEC', error = 'Calcul interrompu avant publication (service de calcul arrêté) : relancez-le depuis Santé des données', finished_at = ? WHERE status = 'STAGING' AND started_at < ?",
    )
    .run(nowIso(), cutoff);
  return { requeued, failed, failedRuns: runs.changes };
}

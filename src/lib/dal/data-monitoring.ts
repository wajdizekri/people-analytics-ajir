import "server-only";
import { getDb } from "@/db/client";
import type { RISK_LEVELS } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { RULES, type Severity } from "@/lib/import/rules";
import { ensureRole } from "./admin";
import type { AccessContext } from "./context";
import type { ImportDTO, JobDTO } from "./imports";

// Agrégats de suivi (ADMIN et RH) : aucun nom, matricule, salaire ni score individuel.

const DAY_MS = 86_400_000;
export const MONITORING = { imports: 20, rejectionDays: 90, topRules: 10, jobDays: 30, runs: 12 } as const;
// Export AJIR mensuel après la paie : jusqu'à 45 jours de décalage restent normaux
export const FRESHNESS_DAYS = { warn: 45, crit: 75 } as const;

type JobType = JobDTO["type"];
type JobStatus = JobDTO["status"];
type RiskLevel = (typeof RISK_LEVELS)[number];
type ModelKind = "B0" | "LOGREG" | "LGBM";

const JOB_TYPES: JobType[] = ["BATCH_MENSUEL", "IMPORT", "AGGREGATE", "FEATURES", "SCORING", "ANOMALIES"];
const JOB_STATUSES: JobStatus[] = ["TERMINE", "ECHEC", "EN_COURS", "EN_FILE"];

export type ImportPointDTO = {
  id: number;
  startedAt: string;
  status: ImportDTO["status"];
  rowsOk: number;
  rowsRejected: number;
  qualityScore: number | null;
};

export type RuleRejectionDTO = { rule: string; label: string; severity: Severity; n: number };

export type JobTypeStatsDTO = { type: JobType; byStatus: Record<JobStatus, number>; total: number; avgDurationSec: number | null };

export type DataMonitoringDTO = {
  qualityThreshold: number;
  dataEndDate: string | null;
  dataLagDays: number | null;
  imports: ImportPointDTO[];
  rejectionsByRule: RuleRejectionDTO[];
  /** Nombre d'imports terminés pris en compte dans rejectionsByRule (fenêtre MONITORING.rejectionDays). */
  rejectionImports: number;
  jobs: JobTypeStatsDTO[];
};

export type RunPointDTO = {
  id: number;
  asOf: string;
  modelVersion: string;
  modelKind: ModelKind;
  nScored: number;
  current: boolean;
  levels: Record<RiskLevel, number>;
};

export type EstimateBinDTO = { from: number; to: number | null; n: number };

export type ModelMonitoringDTO = {
  runs: RunPointDTO[];
  lastRun: { id: number; asOf: string; modelVersion: string; modelKind: ModelKind } | null;
  distribution: { n: number; mean: number; bins: EstimateBinDTO[] } | null;
};

const isSeverity = (s: string): s is Severity => s === "REJET" || s === "CORRECTION" || s === "AVERTISSEMENT";

function reportRuleCounts(json: string | null): [string, number][] {
  try {
    const rules = (json ? JSON.parse(json) : null)?.rules;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) return [];
    return Object.entries(rules as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0);
  } catch {
    return [];
  }
}

export function getDataMonitoring(ctx: AccessContext): DataMonitoringDTO {
  ensureRole(ctx, ["ADMIN", "RH"], "data_monitoring.view");
  const { sqlite } = getDb();
  const now = Date.now();

  const imports = (
    sqlite
      .prepare(
        `SELECT id, started_at, status, rows_ok, rows_rejected, quality_score FROM import_batch
         WHERE status <> 'EN_COURS' ORDER BY started_at DESC, id DESC LIMIT @limit`,
      )
      .all({ limit: MONITORING.imports }) as {
      id: number;
      started_at: string;
      status: ImportDTO["status"];
      rows_ok: number;
      rows_rejected: number;
      quality_score: number | null;
    }[]
  )
    .reverse()
    .map((r) => ({ id: r.id, startedAt: r.started_at, status: r.status, rowsOk: r.rows_ok, rowsRejected: r.rows_rejected, qualityScore: r.quality_score }));

  // report_json garde les comptages complets ; import_rejection est plafonné à 1 000 lignes par fichier et par règle
  const since = new Date(now - MONITORING.rejectionDays * DAY_MS).toISOString();
  const batches = sqlite
    .prepare("SELECT id, report_json FROM import_batch WHERE status <> 'EN_COURS' AND started_at >= @since")
    .all({ since }) as { id: number; report_json: string | null }[];
  const fromDetail = sqlite.prepare("SELECT rule, severity, COUNT(*) AS n FROM import_rejection WHERE batch_id = @id GROUP BY rule, severity");
  const byRule = new Map<string, RuleRejectionDTO>();
  for (const b of batches) {
    const counts = reportRuleCounts(b.report_json);
    const rows = counts.length
      ? counts.map(([rule, n]) => ({ rule, severity: "", n }))
      : (fromDetail.all({ id: b.id }) as { rule: string; severity: string; n: number }[]);
    for (const r of rows) {
      const known = r.rule in RULES ? RULES[r.rule as keyof typeof RULES] : null;
      const prev = byRule.get(r.rule);
      byRule.set(r.rule, {
        rule: r.rule,
        label: known?.label ?? r.rule,
        severity: known?.severity ?? (isSeverity(r.severity) ? r.severity : "REJET"),
        n: (prev?.n ?? 0) + r.n,
      });
    }
  }
  const rejectionsByRule = [...byRule.values()].sort((a, b) => b.n - a.n || a.rule.localeCompare(b.rule)).slice(0, MONITORING.topRules);

  const jobRows = sqlite
    .prepare(
      `SELECT type, status, COUNT(*) AS n,
              AVG(CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
                       THEN (julianday(finished_at) - julianday(started_at)) * 86400 END) AS avg_sec
       FROM app_job WHERE created_at >= @since GROUP BY type, status`,
    )
    .all({ since: new Date(now - MONITORING.jobDays * DAY_MS).toISOString() }) as { type: JobType; status: JobStatus; n: number; avg_sec: number | null }[];
  const jobs = JOB_TYPES.map((type) => {
    const rows = jobRows.filter((r) => r.type === type);
    const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.n ?? 0])) as Record<JobStatus, number>;
    const done = rows.find((r) => r.status === "TERMINE")?.avg_sec;
    return {
      type,
      byStatus,
      total: rows.reduce((a, r) => a + r.n, 0),
      avgDurationSec: done != null ? Math.max(0, Math.round(done * 10) / 10) : null,
    };
  }).filter((j) => j.total > 0);

  const end = getSetting(sqlite, "data_end_date");
  const dataEndDate = /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;
  const today = Date.parse(new Date(now).toISOString().slice(0, 10));

  return {
    qualityThreshold: Number(getSetting(sqlite, "quality_threshold")),
    dataEndDate,
    dataLagDays: dataEndDate ? Math.max(0, Math.round((today - Date.parse(dataEndDate)) / DAY_MS)) : null,
    imports,
    rejectionsByRule,
    rejectionImports: batches.length,
    jobs,
  };
}

const BIN_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05];
const MAX_BINS = 20;

export function getModelMonitoring(ctx: AccessContext): ModelMonitoringDTO {
  ensureRole(ctx, ["ADMIN", "RH"], "model_monitoring.view");
  const { sqlite } = getDb();
  const currentId = Number(getSetting(sqlite, "current_run_id")) || 0;

  // Un point par fin de mois : le run publié courant s'il porte sur ce mois, sinon le plus récent
  const runs = (
    sqlite
      .prepare(
        `SELECT r.id, r.as_of, r.n_scored, m.version, m.kind FROM scoring_run r
         JOIN model_version m ON m.id = r.model_version_id
         WHERE r.status = 'PUBLIE' AND r.id = (
           SELECT r2.id FROM scoring_run r2 WHERE r2.as_of = r.as_of AND r2.status = 'PUBLIE'
           ORDER BY (r2.id = @current) DESC, r2.id DESC LIMIT 1)
         ORDER BY r.as_of DESC LIMIT @limit`,
      )
      .all({ current: currentId, limit: MONITORING.runs }) as { id: number; as_of: string; n_scored: number; version: string; kind: ModelKind }[]
  ).reverse();

  const levelRows = runs.length
    ? (sqlite
        .prepare(`SELECT run_id, level, COUNT(*) AS n FROM prediction WHERE run_id IN (${runs.map(() => "?").join(",")}) GROUP BY run_id, level`)
        .all(...runs.map((r) => r.id)) as { run_id: number; level: RiskLevel; n: number }[])
    : [];
  const levelsOf = (id: number): Record<RiskLevel, number> => {
    const n = (l: RiskLevel) => levelRows.find((r) => r.run_id === id && r.level === l)?.n ?? 0;
    return { ELEVE: n("ELEVE"), MOYEN: n("MOYEN"), FAIBLE: n("FAIBLE") };
  };

  const last = currentId
    ? (sqlite
        .prepare(
          `SELECT r.id, r.as_of, m.version, m.kind FROM scoring_run r JOIN model_version m ON m.id = r.model_version_id
           WHERE r.id = @id AND r.status = 'PUBLIE'`,
        )
        .get({ id: currentId }) as { id: number; as_of: string; version: string; kind: ModelKind } | undefined)
    : undefined;

  return {
    runs: runs.map((r) => ({
      id: r.id,
      asOf: r.as_of,
      modelVersion: r.version,
      modelKind: r.kind,
      nScored: r.n_scored,
      current: r.id === currentId,
      levels: levelsOf(r.id),
    })),
    lastRun: last ? { id: last.id, asOf: last.as_of, modelVersion: last.version, modelKind: last.kind } : null,
    // Un score B0 est un nombre de points, jamais une probabilité : pas de distribution d'estimations
    distribution: last && last.kind !== "B0" ? estimateDistribution(last.id) : null,
  };
}

// Histogramme à pas régulier jusqu'au 99e centile ; le dernier centile est regroupé dans une classe ouverte
function estimateDistribution(runId: number): ModelMonitoringDTO["distribution"] {
  const { sqlite } = getDb();
  const { n, mean } = sqlite.prepare("SELECT COUNT(*) AS n, AVG(prob6) AS mean FROM prediction WHERE run_id = @runId").get({ runId }) as {
    n: number;
    mean: number | null;
  };
  if (!n || mean == null) return null;
  const offset = n >= 100 ? Math.floor(0.99 * (n - 1)) : n - 1;
  const { hi } = sqlite
    .prepare("SELECT prob6 AS hi FROM prediction WHERE run_id = @runId ORDER BY prob6 LIMIT 1 OFFSET @offset")
    .get({ runId, offset }) as { hi: number };
  const step = BIN_STEPS.find((s) => Math.floor(hi / s) + 1 <= MAX_BINS) ?? 0.05;
  const nBins = Math.floor(hi / step) + 1;
  const counts = sqlite
    .prepare(
      `SELECT MIN(CAST(prob6 / @step + 1e-9 AS INTEGER), @nBins) AS b, COUNT(*) AS n FROM prediction
       WHERE run_id = @runId GROUP BY b`,
    )
    .all({ runId, step, nBins }) as { b: number; n: number }[];
  const at = (b: number) => counts.find((c) => c.b === b)?.n ?? 0;
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  const bins: EstimateBinDTO[] = Array.from({ length: nBins }, (_, b) => ({ from: round(b * step), to: round((b + 1) * step), n: at(b) }));
  if (at(nBins)) bins.push({ from: round(nBins * step), to: null, n: at(nBins) });
  return { n, mean, bins };
}

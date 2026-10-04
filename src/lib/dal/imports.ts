import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import { dbPath, getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { dataEndDate, getSetting } from "@/lib/settings";
import { frDate } from "@/lib/features/dates";
import { systemAlert } from "@/lib/engine/alerts";
import { STALE_MS } from "@/lib/jobs";
import { getPublishedRun } from "./employees";
import { ensureRole } from "./admin";
import type { AccessContext } from "./context";
import { HttpError, notFound } from "./errors";
import { championStatus } from "./model";
import { RULES } from "@/lib/import/rules";
import { maskRejectionMessage } from "@/lib/privacy/mask";

export const EXPORT_FILES = [
  "departments.csv",
  "employees.csv",
  "contracts.csv",
  "exits.csv",
  "career_events.csv",
  "attendance.csv",
  "absences.csv",
  "payroll.csv",
  "trainings.csv",
  "evaluations.csv",
  "users.csv",
] as const;

// Le proxy ne met en mémoire que 10 Mo de corps de requête (proxyClientMaxBodySize) : on reste en dessous.
export const UPLOAD_MAX_TOTAL_BYTES = 9 * 1024 * 1024;

type ImportStatus = "EN_COURS" | "OK" | "BLOQUE" | "ECHEC";
type JobType = "IMPORT" | "AGGREGATE" | "FEATURES" | "SCORING" | "ANOMALIES" | "BATCH_MENSUEL";
type JobStatus = "EN_FILE" | "EN_COURS" | "TERMINE" | "ECHEC";

export type ImportDTO = {
  id: number;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: ImportStatus;
  rowsOk: number;
  rowsRejected: number;
  qualityScore: number | null;
  userLogin: string | null;
};

export type JobDTO = {
  id: number;
  type: JobType;
  target: string | null;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdBy: string | null;
};

export type WorkerState = "ACTIF" | "EN_RETARD" | "PERIME" | "ABSENT";
export type WorkerStatus = { heartbeatAt: string | null; ageSeconds: number | null; state: WorkerState };

export type DataHealthDTO = {
  dataEndDate: string | null;
  qualityThreshold: number;
  lastImport: ImportDTO | null;
  runningImport: ImportDTO | null;
  scoring: {
    blocked: boolean;
    reason: string | null;
    currentRun: { id: number; asOf: string; finishedAt: string | null; nScored: number; modelVersion: string } | null;
  };
  worker: WorkerStatus;
  jobs: JobDTO[];
};

export type ImportFileSummary = { file: string; present: boolean; rows: number; ok: number; rejected: number; headerError: string | null };

export type ImportReportSummary = {
  files: ImportFileSummary[];
  rowScore: number | null;
  payrollMonth: string | null;
  activeCount: number | null;
  activeWithoutPayroll: number | null;
  dataEndDate: string | null;
  durationMs: number | null;
  error: string | null;
  users: { created: number; reactivated: number; deactivated: number; updated: number } | null;
};

export type ImportDetailDTO = {
  batch: ImportDTO;
  countsSource: "rapport" | "detail";
  bySeverity: { severity: string; n: number }[];
  byRule: { rule: string; severity: string; n: number }[];
  byFile: { file: string; n: number; rules: { rule: string; severity: string; n: number }[] }[];
  samples: { file: string; line: number | null; rule: string; severity: string; message: string }[];
  summary: ImportReportSummary | null;
};

const IMPORT_SELECT = `
  SELECT b.id, b.source, b.started_at, b.finished_at, b.status, b.rows_ok, b.rows_rejected, b.quality_score,
         u.login AS user_login
  FROM import_batch b LEFT JOIN app_user u ON u.id = b.user_id`;

type ImportRow = {
  id: number;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: ImportStatus;
  rows_ok: number;
  rows_rejected: number;
  quality_score: number | null;
  user_login: string | null;
};

const toImportDTO = (r: ImportRow): ImportDTO => ({
  id: r.id,
  source: r.source,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  rowsOk: r.rows_ok,
  rowsRejected: r.rows_rejected,
  qualityScore: r.quality_score,
  userLogin: r.user_login,
});

export const importListSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

export function listImports(ctx: AccessContext, opts: z.input<typeof importListSchema> = {}): ImportDTO[] {
  ensureRole(ctx, ["ADMIN", "RH"], "import.list");
  const { limit } = importListSchema.parse(opts);
  const rows = getDb().sqlite.prepare(`${IMPORT_SELECT} ORDER BY b.started_at DESC, b.id DESC LIMIT ?`).all(limit) as ImportRow[];
  return rows.map(toImportDTO);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const SEVERITY_ORDER = ["REJET", "CORRECTION", "AVERTISSEMENT"];
const ruleSeverity = (rule: string): string => (rule in RULES ? RULES[rule as keyof typeof RULES].severity : "REJET");

// report_json (ImportReport de lib/import) : comptages complets ; import_rejection ne garde que 1000 lignes par fichier et par règle.
function parseReport(json: string | null): { summary: ImportReportSummary; counts: { file: string; rule: string; n: number }[] } | null {
  let r: Record<string, unknown> | null;
  try {
    r = rec(json ? JSON.parse(json) : null);
  } catch {
    return null;
  }
  const files = rec(r?.files);
  if (!r || !files) return null;
  const quality = rec(r.quality);
  const users = rec(r.users);
  const counts: { file: string; rule: string; n: number }[] = [];
  const summaries: ImportFileSummary[] = [];
  for (const [file, v] of Object.entries(files)) {
    const f = rec(v);
    if (!f) continue;
    summaries.push({
      file,
      present: f.present !== false,
      rows: num(f.rows) ?? 0,
      ok: num(f.ok) ?? 0,
      rejected: num(f.rejected) ?? 0,
      headerError: typeof f.headerError === "string" ? f.headerError : null,
    });
    for (const [rule, n] of Object.entries(rec(f.rules) ?? {})) if (num(n)) counts.push({ file, rule, n: n as number });
  }
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    counts,
    summary: {
      files: summaries.sort((a, b) => Number(b.present) - Number(a.present) || a.file.localeCompare(b.file)),
      rowScore: num(quality?.rowScore),
      payrollMonth: typeof quality?.payrollMonth === "string" ? quality.payrollMonth : null,
      activeCount: num(quality?.activeCount),
      activeWithoutPayroll: num(quality?.activeWithoutPayroll),
      dataEndDate: typeof r.dataEndDate === "string" ? r.dataEndDate : null,
      durationMs: num(r.durationMs),
      error: typeof r.error === "string" ? r.error.slice(0, 500) : null,
      users: users
        ? { created: len(users.created), reactivated: len(users.reactivated), deactivated: len(users.deactivated), updated: num(users.updated) ?? 0 }
        : null,
    },
  };
}

export function getImportDetail(ctx: AccessContext, id: number): ImportDetailDTO {
  ensureRole(ctx, ["ADMIN", "RH"], "import.view", { type: "import", id });
  const { sqlite } = getDb();
  const row = sqlite.prepare(`${IMPORT_SELECT} WHERE b.id = ?`).get(id) as ImportRow | undefined;
  if (!row) throw notFound("Import");
  const { report_json } = sqlite.prepare("SELECT report_json FROM import_batch WHERE id = ?").get(id) as { report_json: string | null };
  const report = parseReport(report_json);
  const grouped = report?.counts.length
    ? report.counts.map((c) => ({ ...c, severity: ruleSeverity(c.rule) }))
    : (sqlite
        .prepare("SELECT file, rule, severity, COUNT(*) AS n FROM import_rejection WHERE batch_id = ? GROUP BY file, rule, severity")
        .all(id) as { file: string; rule: string; severity: string; n: number }[]);

  const byRule = new Map<string, { rule: string; severity: string; n: number }>();
  const bySeverity = new Map<string, number>();
  const byFile = new Map<string, ImportDetailDTO["byFile"][number]>();
  for (const g of grouped) {
    const k = `${g.rule}|${g.severity}`;
    byRule.set(k, { rule: g.rule, severity: g.severity, n: (byRule.get(k)?.n ?? 0) + g.n });
    bySeverity.set(g.severity, (bySeverity.get(g.severity) ?? 0) + g.n);
    const f = byFile.get(g.file) ?? { file: g.file, n: 0, rules: [] };
    f.n += g.n;
    f.rules.push({ rule: g.rule, severity: g.severity, n: g.n });
    byFile.set(g.file, f);
  }
  for (const f of byFile.values()) f.rules.sort((a, b) => b.n - a.n);
  const samples = sqlite
    .prepare(
      `SELECT file, line, rule, severity, message FROM import_rejection WHERE batch_id = ?
       ORDER BY CASE severity WHEN 'REJET' THEN 0 WHEN 'CORRECTION' THEN 1 ELSE 2 END, file, line LIMIT 100`,
    )
    .all(id) as ImportDetailDTO["samples"];

  return {
    batch: toImportDTO(row),
    countsSource: report?.counts.length ? "rapport" : "detail",
    bySeverity: [...bySeverity]
      .map(([severity, n]) => ({ severity, n }))
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
    byRule: [...byRule.values()].sort((a, b) => b.n - a.n),
    byFile: [...byFile.values()].sort((a, b) => b.n - a.n),
    // ADMIN : montants, valeurs brutes sensibles et tout détail d'absence masqués, matricule conservé (séparation des tâches)
    samples: ctx.role === "RH" ? samples : samples.map((s) => ({ ...s, message: maskRejectionMessage(s.message, s.file) })),
    summary: report?.summary ?? null,
  };
}

export function workerStatus(sqlite: Database.Database): WorkerStatus {
  const hb = getSetting(sqlite, "worker_heartbeat") || null;
  const t = hb ? Date.parse(hb) : NaN;
  if (!hb || Number.isNaN(t)) return { heartbeatAt: null, ageSeconds: null, state: "ABSENT" };
  const age = Math.max(0, Math.round((Date.now() - t) / 1000));
  return { heartbeatAt: hb, ageSeconds: age, state: age <= 120 ? "ACTIF" : age <= STALE_MS / 1000 ? "EN_RETARD" : "PERIME" };
}

// Heartbeat de plus de 10 minutes : alerte SYSTEME pour l'administrateur, une seule par interruption (clé = dernier signal).
// Appelée par /api/health et /data-health, qui restent en lecture seule par ailleurs.
export function raiseWorkerStaleAlert(sqlite: Database.Database, w: WorkerStatus): boolean {
  if (w.state !== "PERIME" || !w.heartbeatAt) return false;
  const since = new Date(w.heartbeatAt).toLocaleString("fr-FR", { timeZone: "Africa/Tunis", dateStyle: "short", timeStyle: "short" });
  return systemAlert(
    sqlite,
    `worker-perime:${w.heartbeatAt}`,
    "Service de calcul arrêté",
    `Aucun signal du service de calcul (worker) depuis le ${since} : les imports, les recalculs et le calcul mensuel restent en attente. Redémarrez le service « worker » sur le serveur (procédure dans le guide d'exploitation).`,
    "CRITIQUE",
    "/data-health",
  );
}

function lastFinishedImport(sqlite: Database.Database): ImportRow | undefined {
  return sqlite
    .prepare(`${IMPORT_SELECT} WHERE b.status <> 'EN_COURS' ORDER BY b.started_at DESC, b.id DESC LIMIT 1`)
    .get() as ImportRow | undefined;
}

function scoringBlock(sqlite: Database.Database): string | null {
  const last = lastFinishedImport(sqlite);
  if (last?.status === "BLOQUE")
    return `Le dernier import (n° ${last.id}) est bloqué par les contrôles qualité : le calcul des risques reste suspendu. Faites corriger l'export dans AJIR, puis importez-le de nouveau.`;
  return null;
}

export function getDataHealth(ctx: AccessContext): DataHealthDTO {
  ensureRole(ctx, ["ADMIN", "RH"], "data_health.view");
  const { sqlite } = getDb();
  const last = lastFinishedImport(sqlite);
  const running = sqlite.prepare(`${IMPORT_SELECT} WHERE b.status = 'EN_COURS' ORDER BY b.id DESC LIMIT 1`).get() as ImportRow | undefined;
  const runId = Number(getSetting(sqlite, "current_run_id")) || null;
  const run = runId
    ? (sqlite
        .prepare(
          `SELECT r.id, r.as_of, r.finished_at, r.n_scored, m.version FROM scoring_run r
           JOIN model_version m ON m.id = r.model_version_id WHERE r.id = ?`,
        )
        .get(runId) as { id: number; as_of: string; finished_at: string | null; n_scored: number; version: string } | undefined)
    : undefined;
  const reason = scoringBlock(sqlite);
  const worker = workerStatus(sqlite);
  raiseWorkerStaleAlert(sqlite, worker);
  const jobs = sqlite
    .prepare(
      `SELECT j.id, j.type, j.target, j.status, j.created_at, j.started_at, j.finished_at, j.error, u.login
       FROM app_job j LEFT JOIN app_user u ON u.id = j.created_by ORDER BY j.id DESC LIMIT 10`,
    )
    .all() as {
    id: number;
    type: JobType;
    target: string | null;
    status: JobStatus;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    error: string | null;
    login: string | null;
  }[];
  return {
    dataEndDate: getSetting(sqlite, "data_end_date") || null,
    qualityThreshold: Number(getSetting(sqlite, "quality_threshold")),
    lastImport: last ? toImportDTO(last) : null,
    runningImport: running ? toImportDTO(running) : null,
    scoring: {
      blocked: !!reason,
      reason,
      currentRun: run ? { id: run.id, asOf: run.as_of, finishedAt: run.finished_at, nScored: run.n_scored, modelVersion: run.version } : null,
    },
    worker,
    jobs: jobs.map((j) => ({
      id: j.id,
      type: j.type,
      target: j.target,
      status: j.status,
      createdAt: j.created_at,
      startedAt: j.started_at,
      finishedAt: j.finished_at,
      error: j.error ? j.error.slice(0, 300) : null,
      createdBy: j.login,
    })),
  };
}

// ---------- File de jobs (INSERT direct dans app_job, un seul job actif par type) ----------

export type EnqueueResult = { jobId: number; alreadyQueued: boolean };

function enqueue(ctx: AccessContext, type: JobType, target: string | null, payload: Record<string, unknown> | null): EnqueueResult {
  const { sqlite } = getDb();
  const result = sqlite
    .transaction((): EnqueueResult => {
      const active = sqlite
        .prepare("SELECT id FROM app_job WHERE type = ? AND status IN ('EN_FILE','EN_COURS') ORDER BY id LIMIT 1")
        .get(type) as { id: number } | undefined;
      if (active) return { jobId: active.id, alreadyQueued: true };
      const r = sqlite
        .prepare("INSERT INTO app_job (type, target, payload_json, created_by) VALUES (?, ?, ?, ?)")
        .run(type, target, payload ? JSON.stringify(payload) : null, ctx.userId);
      return { jobId: Number(r.lastInsertRowid), alreadyQueued: false };
    })
    .immediate();
  audit(ctx.userId, "job.enqueue", { type: "job", id: result.jobId }, "OK", { jobType: type, target, alreadyQueued: result.alreadyQueued });
  return result;
}

export const scoringRequestSchema = z.object({
  asOf: z
    .iso.date("Date de calcul invalide (AAAA-MM-JJ).")
    .refine((d) => {
      const next = new Date(`${d}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return next.getUTCDate() === 1;
    }, "La date de calcul doit être une fin de mois.")
    .optional(),
});

export function requestScoring(ctx: AccessContext, input: z.input<typeof scoringRequestSchema> = {}): EnqueueResult {
  ensureRole(ctx, ["ADMIN", "RH"], "job.enqueue", { type: "job" });
  const { asOf } = scoringRequestSchema.parse(input);
  const { sqlite } = getDb();
  const reason = scoringBlock(sqlite);
  if (reason) {
    audit(ctx.userId, "job.enqueue", { type: "job" }, "REFUSE", { jobType: "SCORING", reason: "import_bloque" });
    throw new HttpError(409, "SCORING_BLOQUE", reason);
  }
  // Seul un mois couvert par les données et au moins aussi récent que le calcul courant peut être publié
  if (asOf) {
    const end = dataEndDate(sqlite);
    const current = getPublishedRun()?.asOf ?? null;
    const refusal =
      !end || asOf > end
        ? { code: "MOIS_NON_COUVERT", reason: "hors_donnees", message: `Les données importées s'arrêtent au ${end ? frDate(end) : "—"} : impossible de publier un calcul au ${frDate(asOf)}. Importez d'abord l'export AJIR qui couvre ce mois.` }
        : current && asOf < current
          ? { code: "MOIS_ANTERIEUR", reason: "anterieur_au_courant", message: `Le calcul publié porte déjà sur le ${frDate(current)} : un mois antérieur ne peut pas être republié. Choisissez ce mois ou un mois plus récent.` }
          : null;
    if (refusal) {
      audit(ctx.userId, "job.enqueue", { type: "job" }, "REFUSE", { jobType: "SCORING", reason: refusal.reason, asOf });
      throw new HttpError(409, refusal.code, refusal.message);
    }
  }
  return enqueue(ctx, "SCORING", asOf ?? null, asOf ? { asOf } : null);
}

export function requestRecompute(ctx: AccessContext): EnqueueResult {
  ensureRole(ctx, ["ADMIN"], "job.enqueue", { type: "job" });
  const reason = scoringBlock(getDb().sqlite);
  if (reason) {
    audit(ctx.userId, "job.enqueue", { type: "job" }, "REFUSE", { jobType: "BATCH_MENSUEL", reason: "import_bloque" });
    throw new HttpError(409, "SCORING_BLOQUE", reason);
  }
  return enqueue(ctx, "BATCH_MENSUEL", null, { trigger: "manuel" });
}

// ---------- Téléversement d'un export AJIR ----------

export type UploadFile = { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

const uploadNamesSchema = z
  .array(z.enum(EXPORT_FILES, { error: (i) => `Fichier non prévu par le contrat d'export : ${String(i.input).slice(0, 80)}.` }))
  .min(1, "Aucun fichier reçu : sélectionnez les fichiers CSV de l'export AJIR.")
  .max(EXPORT_FILES.length, `Trop de fichiers : l'export AJIR en compte ${EXPORT_FILES.length} au plus.`)
  .refine((names) => new Set(names).size === names.length, "Un même fichier est présent deux fois : retirez le doublon puis réessayez.");

export function inboxRoot(): string {
  return path.join(path.dirname(dbPath()), "inbox");
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export async function saveUploadedExport(
  ctx: AccessContext,
  files: UploadFile[],
): Promise<EnqueueResult & { dir: string; files: { name: string; size: number }[] }> {
  ensureRole(ctx, ["ADMIN"], "import.upload");
  const names = uploadNamesSchema.parse(files.map((f) => f.name.trim()));
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > UPLOAD_MAX_TOTAL_BYTES) {
    throw new HttpError(413, "TROP_VOLUMINEUX", `Export trop volumineux (${Math.ceil(total / 1048576)} Mo, maximum ${UPLOAD_MAX_TOTAL_BYTES / 1048576} Mo).`);
  }
  const contents = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  contents.forEach((buf, i) => {
    const header = buf.subarray(0, 4096).toString("utf8").split(/\r?\n/, 1)[0].replace(/^﻿/, "");
    if (buf.length === 0 || !header.includes(";")) {
      throw new HttpError(422, "EN_TETE_INVALIDE", `${names[i]} : en-tête absent ou séparateur « ; » manquant.`);
    }
  });
  const { sqlite } = getDb();
  if (sqlite.prepare("SELECT 1 FROM app_job WHERE type = 'IMPORT' AND status IN ('EN_FILE','EN_COURS')").get()) {
    throw new HttpError(409, "IMPORT_EN_COURS", "Un import est déjà en file ou en cours. Réessayez après sa fin.");
  }

  const root = inboxRoot();
  fs.mkdirSync(root, { recursive: true });
  let name = stamp();
  let dir = path.join(root, name);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, (name = `${stamp()}-${i}`));
  fs.mkdirSync(dir);
  try {
    names.forEach((n, i) => fs.writeFileSync(path.join(dir, n), contents[i], { flag: "wx" }));
    const res = enqueue(ctx, "IMPORT", `inbox/${name}`, { dir });
    if (res.alreadyQueued) throw new HttpError(409, "IMPORT_EN_COURS", "Un import est déjà en file ou en cours. Réessayez après sa fin.");
    const saved = names.map((n, i) => ({ name: n, size: contents[i].length }));
    audit(ctx.userId, "import.upload", { type: "job", id: res.jobId }, "OK", { dir: `inbox/${name}`, files: saved });
    return { ...res, dir: `inbox/${name}`, files: saved };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

// ---------- /api/health (public, sans donnée sensible) ----------

export type SystemHealth = {
  status: "ok" | "degrade" | "erreur";
  database: "ok" | "erreur";
  worker: { state: WorkerState; heartbeatAgeSeconds: number | null };
  model: { championLoaded: boolean };
};

export function getSystemHealth(): SystemHealth {
  try {
    const { sqlite } = getDb();
    sqlite.prepare("SELECT 1").get();
    const w = workerStatus(sqlite);
    raiseWorkerStaleAlert(sqlite, w);
    const champion = championStatus();
    const ok = w.state === "ACTIF" && champion.loaded;
    return {
      status: ok ? "ok" : "degrade",
      database: "ok",
      worker: { state: w.state, heartbeatAgeSeconds: w.ageSeconds },
      model: { championLoaded: champion.loaded },
    };
  } catch {
    return { status: "erreur", database: "erreur", worker: { state: "ABSENT", heartbeatAgeSeconds: null }, model: { championLoaded: false } };
  }
}

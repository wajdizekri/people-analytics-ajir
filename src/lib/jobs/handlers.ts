import type Database from "better-sqlite3";
import { runAiSteps } from "../ai/steps";
import { detectAnomalies } from "../anomalies";
import { backfillFeatures } from "../features";
import { addMonthsToMonth, frDate, fromDay, mondayOf, monthEnd, monthStart, toDay } from "../features/dates";
import { currentPublishedAsOf, scoreMonth } from "../scoring";
import { dataEndDate } from "../settings";
import { claimNextJob, completeJob, failJob, type Job } from "./index";

type ImportModule = {
  runImport(
    sqlite: Database.Database,
    dir: string,
    opts?: { userId?: number; source?: string },
  ): Promise<{
    batchId: number;
    status: string;
    rowsOk: number;
    rowsRejected: number;
    qualityScore: number | null;
    dataEndDate: string | null;
    report?: { error?: string };
  }>;
};
type AggregatesModule = { refreshAggregates(sqlite: Database.Database, months?: string[]): number };
type CalendarModule = { buildCalendar(sqlite: Database.Database, fromYear: number, toYear: number): number };

const MODULES = { import: "@/lib/import", aggregates: "@/lib/aggregates", calendar: "@/lib/calendar" } as const;

function isNotFound(e: unknown, spec: string): boolean {
  const err = e as { code?: string; message?: string } | null;
  const text = `${err?.code ?? ""} ${err?.message ?? ""}`;
  return /Cannot find module|Failed to load url|Failed to resolve import|MODULE_NOT_FOUND/.test(text) && (text.includes(spec) || text.includes(spec.slice(2)));
}

// Import dynamique protégé des modules écrits par d'autres contributeurs.
export async function optionalModule<T>(name: keyof typeof MODULES): Promise<T | null> {
  const spec: string = MODULES[name];
  try {
    return (await import(spec)) as T;
  } catch (e) {
    if (isNotFound(e, spec)) return null;
    throw e;
  }
}

export const loadImport = () => optionalModule<ImportModule>("import");
export const loadAggregates = () => optionalModule<AggregatesModule>("aggregates");
export const loadCalendar = () => optionalModule<CalendarModule>("calendar");

export type Beat = () => void;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export { dataEndDate };

// Dernier mois complet couvert par les données (fin de mois <= data_end_date).
export function lastCompleteMonth(sqlite: Database.Database): string | null {
  const end = dataEndDate(sqlite);
  if (!end) return null;
  const m = end.slice(0, 7);
  return monthEnd(m) === end ? m : addMonthsToMonth(m, -1);
}

// Mois du batch planifié : dernier mois complet des données, sauf s'il est déjà couvert par le calcul publié courant
// (données du mois pas encore importées, ou batch déjà passé). null = rien à faire.
export function scheduledBatchMonth(sqlite: Database.Database): string | null {
  const month = lastCompleteMonth(sqlite);
  if (!month) return null;
  const current = currentPublishedAsOf(sqlite);
  return current && current >= monthEnd(month) ? null : month;
}

export function assertMonthCovered(sqlite: Database.Database, month: string) {
  const end = dataEndDate(sqlite);
  if (!end || monthEnd(month) > end)
    throw new Error(`Mois ${month} non couvert par les données (importées jusqu'au ${end ? frDate(end) : "—"}) : importez l'export AJIR du mois puis relancez le traitement.`);
}

// Semaines (lundis) couvrant un mois, plus la semaine précédente pour le critère « deux semaines consécutives ».
export function weeksOfMonth(month: string): { fromWeek: string; toWeek: string } {
  return { fromWeek: fromDay(mondayOf(toDay(monthStart(month))) - 7), toWeek: fromDay(mondayOf(toDay(monthEnd(month)))) };
}

export async function ensureCalendar(sqlite: Database.Database, fromYear: number, toYear: number): Promise<number> {
  const r = sqlite.prepare("SELECT count(*) AS n FROM dim_date WHERE date BETWEEN ? AND ?").get(`${fromYear}-01-01`, `${toYear}-12-31`) as { n: number };
  const expected = Math.round((toYear - fromYear + 1) * 365.25);
  if (r.n >= expected - 1) return 0;
  const cal = await loadCalendar();
  return cal ? cal.buildCalendar(sqlite, fromYear, toYear) : 0;
}

export async function refreshAggregatesSafe(sqlite: Database.Database, months?: string[]): Promise<number | null> {
  const agg = await loadAggregates();
  return agg ? agg.refreshAggregates(sqlite, months) : null;
}

// Après un import (hors ECHEC), comme scripts/import.ts : calendrier sur la plage des faits importés prolongée d'un an,
// puis agrégats du tableau de bord.
export async function rebuildAfterImport(sqlite: Database.Database): Promise<{ calendarDays: number; aggregates: number | null }> {
  const span = sqlite
    .prepare(
      `SELECT MIN(d) AS first, MAX(d) AS last FROM (
         SELECT MIN(date) AS d FROM attendance_daily UNION ALL SELECT MAX(date) FROM attendance_daily
         UNION ALL SELECT MIN(month) || '-01' FROM payroll_monthly UNION ALL SELECT MAX(month) || '-01' FROM payroll_monthly
         UNION ALL SELECT MIN(start_date) FROM absence_episode UNION ALL SELECT MAX(end_date) FROM absence_episode
       ) WHERE d IS NOT NULL`,
    )
    .get() as { first: string | null; last: string | null };
  const thisYear = new Date().getFullYear();
  const fromYear = span.first ? Number(span.first.slice(0, 4)) : thisYear;
  const toYear = (span.last ? Number(span.last.slice(0, 4)) : thisYear) + 1;
  const cal = await loadCalendar();
  const calendarDays = cal ? cal.buildCalendar(sqlite, fromYear, toYear) : 0;
  return { calendarDays, aggregates: await refreshAggregatesSafe(sqlite) };
}

export type BatchSummary = { month: string; aggregates: number | null; snapshots: number; runId: number; nScored: number; recommendations: number; alerts: number; anomalies: number; ai: string[] };

// Batch mensuel : agrégats -> variables du mois -> scoring publié -> anomalies du mois.
export async function runMonthlyBatch(sqlite: Database.Database, month: string, opts: { beat?: Beat; userId?: number | null } = {}): Promise<BatchSummary> {
  if (!MONTH_RE.test(month)) throw new Error(`Mois invalide : ${month} (format attendu AAAA-MM, par exemple 2026-08).`);
  assertMonthCovered(sqlite, month);
  const beat = opts.beat ?? (() => {});
  const aggregates = await refreshAggregatesSafe(sqlite);
  beat();
  const snapshots = backfillFeatures(sqlite, month, month);
  beat();
  const score = scoreMonth(sqlite, monthEnd(month), { force: true, userId: opts.userId ?? null });
  beat();
  const { fromWeek, toWeek } = weeksOfMonth(month);
  const anomalies = detectAnomalies(sqlite, fromWeek, toWeek);
  beat();
  const ai = runAiSteps(sqlite, monthEnd(month));
  beat();
  return {
    month,
    aggregates,
    snapshots,
    runId: score.runId,
    nScored: score.nScored,
    recommendations: score.recommendations,
    alerts: score.alerts,
    anomalies,
    ai,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

export async function runJob(sqlite: Database.Database, job: Job, beat: Beat = () => {}): Promise<string> {
  const p = job.payload;
  const userId = job.createdBy ?? null;
  switch (job.type) {
    case "IMPORT": {
      const dir = str(p.dir) ?? job.target ?? undefined;
      if (!dir) throw new Error("Traitement d'import sans dossier d'export : relancez l'import depuis Santé des données.");
      const mod = await loadImport();
      if (!mod) throw new Error("Module d'import indisponible : vérifiez l'installation de l'application sur le serveur.");
      const r = await mod.runImport(sqlite, dir, { userId: userId ?? undefined, source: str(p.source) });
      if (r.status === "ECHEC") throw new Error(`Import n° ${r.batchId} en échec : ${r.report?.error ?? "voir le détail de l'import dans Santé des données."}`);
      beat();
      const post = await rebuildAfterImport(sqlite);
      return `import lot ${r.batchId} : ${r.status}, ${r.rowsOk} lignes, ${r.rowsRejected} rejets ; calendrier ${post.calendarDays} jours, ${post.aggregates ?? "—"} lignes d'agrégats`;
    }
    case "AGGREGATE": {
      const months = Array.isArray(p.months) ? (p.months as string[]) : job.target && MONTH_RE.test(job.target) ? [job.target] : undefined;
      const n = await refreshAggregatesSafe(sqlite, months);
      if (n == null) throw new Error("Module d'agrégats indisponible : vérifiez l'installation de l'application sur le serveur.");
      return `${n} lignes d'agrégats`;
    }
    case "FEATURES": {
      const to = str(p.to) ?? job.target ?? lastCompleteMonth(sqlite);
      const from = str(p.from) ?? to;
      if (!from || !to) throw new Error("Aucune donnée importée : mois à calculer inconnu. Importez d'abord un export AJIR.");
      const n = backfillFeatures(sqlite, from, to, { onMonth: beat });
      return `${n} snapshots de ${from} à ${to}`;
    }
    case "SCORING": {
      const month = str(p.asOf)?.slice(0, 7) ?? job.target ?? lastCompleteMonth(sqlite);
      if (!month) throw new Error("Aucune donnée importée : mois du calcul des risques inconnu. Importez d'abord un export AJIR.");
      if (!MONTH_RE.test(month)) throw new Error(`Mois invalide : ${month} (format attendu AAAA-MM, par exemple 2026-08).`);
      assertMonthCovered(sqlite, month);
      // un mois antérieur au calcul courant est calculé sans publication : ni pointeur, ni recommandations, ni alertes
      const current = currentPublishedAsOf(sqlite);
      const publish = !current || monthEnd(month) >= current;
      const r = scoreMonth(sqlite, month, { force: p.force === true, userId, publish });
      return `run ${r.runId} (${r.modelVersion}) : ${r.nScored} salariés, ${publish ? `${r.recommendations} recommandations, ${r.alerts} alertes` : "non publié (mois antérieur au calcul courant)"}`;
    }
    case "ANOMALIES": {
      const month = job.target && MONTH_RE.test(job.target) ? job.target : lastCompleteMonth(sqlite);
      const weeks = month ? weeksOfMonth(month) : null;
      const fromWeek = str(p.fromWeek) ?? weeks?.fromWeek;
      const toWeek = str(p.toWeek) ?? weeks?.toWeek;
      if (!fromWeek || !toWeek) throw new Error("Aucune donnée importée : semaines à analyser inconnues. Importez d'abord un export AJIR.");
      return `${detectAnomalies(sqlite, fromWeek, toWeek)} anomalies de ${fromWeek} à ${toWeek}`;
    }
    case "BATCH_MENSUEL": {
      const month = job.target ?? lastCompleteMonth(sqlite);
      if (!month) throw new Error("Aucune donnée importée : mois du calcul mensuel inconnu. Importez d'abord un export AJIR.");
      const s = await runMonthlyBatch(sqlite, month, { beat, userId });
      return `batch ${s.month} : ${s.snapshots} snapshots, run ${s.runId} (${s.nScored} scorés), ${s.recommendations} recommandations, ${s.alerts} alertes, ${s.anomalies} anomalies`;
    }
  }
}

export type ProcessedJob = { job: Job; ok: boolean; summary: string; ms: number };

// Prend le prochain job en file, l'exécute et le clôture (TERMINE, ou ECHEC + alerte SYSTEME).
export async function processNextJob(sqlite: Database.Database, beatFor: (jobId: number | null) => Beat = () => () => {}): Promise<ProcessedJob | null> {
  const job = claimNextJob(sqlite);
  if (!job) return null;
  const t0 = Date.now();
  try {
    const summary = await runJob(sqlite, job, beatFor(job.id));
    completeJob(sqlite, job.id);
    return { job, ok: true, summary, ms: Date.now() - t0 };
  } catch (e) {
    failJob(sqlite, job.id, e);
    return { job, ok: false, summary: (e as Error).message ?? String(e), ms: Date.now() - t0 };
  }
}

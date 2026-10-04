import "server-only";
import { getDb } from "@/db/client";
import { appJob } from "@/db/schema";
import type { AccessContext } from "./context";
import { ensureRole } from "./admin";

export const JOB_TYPES = appJob.type.enumValues;
export const JOB_STATUSES = appJob.status.enumValues;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

export type DailyActivity = { date: string; logins: number; failedLogins: number; refusals: number };
export type WeekComparison = { current: number; previous: number };
export type JobStats = { type: JobType; counts: Record<JobStatus, number>; total: number; avgDurationSeconds: number | null };

export type AdminMonitoringDTO = {
  days: number;
  from: string;
  to: string;
  daily: DailyActivity[];
  week: { logins: WeekComparison; failedLogins: WeekComparison; refusals: WeekComparison };
  refusalsByAction: { action: string; count: number }[];
  jobs: JobStats[];
};

const DAY_MS = 86_400_000;

// Journées UTC (audit_log.at et app_job.created_at sont des ISO UTC). Aucune donnée RH : audit, sessions et jobs uniquement.
export function getAdminMonitoring(ctx: AccessContext, days = 30): AdminMonitoringDTO {
  ensureRole(ctx, ["ADMIN"], "admin.monitoring");
  const n = Math.min(Math.max(Math.trunc(days) || 1, 1), 366);
  const { sqlite } = getDb();
  const now = Date.now();
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dates = Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  const from = dates[0];

  const byDay = new Map(
    (
      sqlite
        .prepare(
          `SELECT substr(at, 1, 10) AS day,
                  SUM(action = 'auth.login' AND outcome = 'OK') AS logins,
                  SUM(action = 'auth.login' AND outcome = 'REFUSE') AS failed,
                  SUM(action <> 'auth.login' AND outcome = 'REFUSE') AS refusals
           FROM audit_log WHERE at >= @from GROUP BY day`,
        )
        .all({ from }) as { day: string; logins: number; failed: number; refusals: number }[]
    ).map((r) => [r.day, r]),
  );
  const daily = dates.map((date) => {
    const r = byDay.get(date);
    return { date, logins: r?.logins ?? 0, failedLogins: r?.failed ?? 0, refusals: r?.refusals ?? 0 };
  });

  const w = sqlite
    .prepare(
      `SELECT SUM(at >= @d7 AND action = 'auth.login' AND outcome = 'OK') AS logins,
              SUM(at < @d7 AND action = 'auth.login' AND outcome = 'OK') AS prev_logins,
              SUM(at >= @d7 AND action = 'auth.login' AND outcome = 'REFUSE') AS failed,
              SUM(at < @d7 AND action = 'auth.login' AND outcome = 'REFUSE') AS prev_failed,
              SUM(at >= @d7 AND action <> 'auth.login' AND outcome = 'REFUSE') AS refusals,
              SUM(at < @d7 AND action <> 'auth.login' AND outcome = 'REFUSE') AS prev_refusals
       FROM audit_log WHERE at >= @d14`,
    )
    .get({ d7: new Date(now - 7 * DAY_MS).toISOString(), d14: new Date(now - 14 * DAY_MS).toISOString() }) as Record<string, number | null>;
  const cmp = (cur: string, prev: string): WeekComparison => ({ current: w[cur] ?? 0, previous: w[prev] ?? 0 });

  const refusalsByAction = sqlite
    .prepare(
      `SELECT action, COUNT(*) AS count FROM audit_log
       WHERE outcome = 'REFUSE' AND action <> 'auth.login' AND at >= @from
       GROUP BY action ORDER BY count DESC, action LIMIT 8`,
    )
    .all({ from }) as { action: string; count: number }[];

  const jobRows = sqlite
    .prepare(
      `SELECT type,
              SUM(status = 'EN_FILE') AS EN_FILE, SUM(status = 'EN_COURS') AS EN_COURS,
              SUM(status = 'TERMINE') AS TERMINE, SUM(status = 'ECHEC') AS ECHEC,
              AVG(CASE WHEN status = 'TERMINE' AND started_at IS NOT NULL AND finished_at IS NOT NULL
                       THEN (julianday(finished_at) - julianday(started_at)) * 86400.0 END) AS avg_s
       FROM app_job WHERE created_at >= @from GROUP BY type`,
    )
    .all({ from }) as ({ type: JobType; avg_s: number | null } & Record<JobStatus, number>)[];
  const jobs = JOB_TYPES.flatMap((type): JobStats[] => {
    const r = jobRows.find((j) => j.type === type);
    if (!r) return [];
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, r[s] ?? 0])) as Record<JobStatus, number>;
    const total = JOB_STATUSES.reduce((sum, s) => sum + counts[s], 0);
    return [{ type, counts, total, avgDurationSeconds: r.avg_s == null ? null : Math.round(r.avg_s * 10) / 10 }];
  });

  return {
    days: n,
    from,
    to: dates[n - 1],
    daily,
    week: { logins: cmp("logins", "prev_logins"), failedLogins: cmp("failed", "prev_failed"), refusals: cmp("refusals", "prev_refusals") },
    refusalsByAction,
    jobs,
  };
}

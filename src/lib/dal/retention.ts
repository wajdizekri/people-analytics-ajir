import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { workStartSql } from "@/lib/aggregates";
import { logRank, type Subject } from "@/lib/retention/km";
import { summarizeCurve, toMonths, type CurveSummary } from "@/lib/retention/summary";
import { ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import { referenceDate } from "./employees";
import { MIN_GROUP_SIZE, VOLUNTARY_EXIT_REASONS, smallGroupMask, toTime } from "./pilotage-metrics";

export const RETENTION_MODES = { toutes: "Toutes sorties", volontaires: "Départs volontaires" } as const;
export const RETENTION_SEGMENTS = { cohorte: "Cohorte d'embauche", departement: "Département", contrat: "Premier contrat", famille: "Famille de métier" } as const;
export type RetentionMode = keyof typeof RETENTION_MODES;
export type RetentionSegment = keyof typeof RETENTION_SEGMENTS;
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const retentionQuerySchema = z.object({
  mode: z.enum(keys(RETENTION_MODES)).default("toutes"),
  segment: z.enum(keys(RETENTION_SEGMENTS)).optional(),
});
export type RetentionQuery = z.output<typeof retentionQuerySchema>;

// Au plus 5 courbes de groupe sur le graphique (charte : 5 couleurs) ; tous les groupes restent dans le tableau
export const MAX_CHART_GROUPS = 5;
export const MAX_COHORTS = 5;

const FIRST_CONTRACT_LABEL: Record<string, string> = {
  CDI: "CDI",
  CDD: "CDD",
  SIVP: "SIVP puis CDI ou CDD",
  STAGE: "Stage puis CDI ou CDD",
};
const CONTRACT_ORDER = ["CDI", "CDD", "SIVP puis CDI ou CDD", "Stage puis CDI ou CDD", "Non renseigné"];

export type RetentionGroup = {
  key: string;
  label: string;
  // null : groupe masqué (vue manager, moins de 5 personnes ou déductible par différence)
  n: number | null;
  masked: boolean;
  inChart: boolean;
  curve: CurveSummary | null;
};

export type RetentionDto = {
  view: "RH" | "MANAGER";
  referenceDate: string;
  observationStart: string | null;
  mode: RetentionMode;
  segment: RetentionSegment | null;
  minAtRisk: number;
  horizonMonths: number;
  // Embauches suivies depuis leur arrivée ; courbe d'ensemble absente si aucune, ou si moins de 5 côté manager
  followed: number;
  overall: CurveSummary | null;
  groups: RetentionGroup[];
  maskedGroups: number;
  logRank: { chi2: number; df: number; pValue: number } | null;
  // Embauches antérieures au début de l'historique (présentes à cette date, non suivies depuis leur arrivée)
  notFollowed: number;
};

type Row = {
  origin: string | null;
  departmentName: string | null;
  jobFamily: string | null;
  firstContract: string | null;
  exitDate: string | null;
  reason: string | null;
  windowStart: string | null;
};

const DAY_MS = 86_400_000;
const dayOf = (s: string) => Math.round(toTime(s) / DAY_MS);

// Une seule requête : population du périmètre, origine (début du premier CDI/CDD), dernière sortie visible au
// référentiel (sortie et saisie <= référence) et début de l'historique importé (premier mois des agrégats, à défaut
// premier pointage ou première paie).
function loadRows(ctx: AccessContext, ref: string): Row[] {
  const scope = scopeFilter(ctx, "e.id");
  return getDb()
    .sqlite.prepare(
      `WITH win AS (
         SELECT COALESCE(
           (SELECT MIN(month) || '-01' FROM agg_kpi_monthly),
           (SELECT MIN(date) FROM attendance_daily),
           (SELECT MIN(month) || '-01' FROM payroll_monthly)) AS start
       )
       SELECT ${workStartSql("e")} AS origin, d.name AS departmentName, e.job_family AS jobFamily,
         (SELECT c.type FROM contract c WHERE c.employee_id = e.id ORDER BY c.start_date, c.id LIMIT 1) AS firstContract,
         x.exit_date AS exitDate, x.reason, win.start AS windowStart
       FROM employee e
       CROSS JOIN win
       LEFT JOIN department d ON d.id = e.department_id
       LEFT JOIN exit_event x ON x.id = (
         SELECT x2.id FROM exit_event x2
         WHERE x2.employee_id = e.id AND x2.exit_date <= @ref AND x2.recorded_at <= @ref
         ORDER BY x2.exit_date DESC, x2.id DESC LIMIT 1)
       WHERE ${scope.clause}`,
    )
    .all({ ...scope.params, ref }) as Row[];
}

type Followed = { subject: Subject; row: Row; year: string };

function followUp(rows: Row[], ref: string, mode: RetentionMode): { followed: Followed[]; notFollowed: number; windowStart: string | null } {
  const windowStart = rows[0]?.windowStart ?? null;
  const end = dayOf(ref);
  const followed: Followed[] = [];
  let notFollowed = 0;
  for (const row of rows) {
    if (!row.origin || row.origin > ref) continue;
    if (row.exitDate && row.exitDate < row.origin) continue;
    if (windowStart && row.origin < windowStart) {
      notFollowed++;
      continue;
    }
    const origin = dayOf(row.origin);
    const exit = row.exitDate ? dayOf(row.exitDate) : end;
    const event = !!row.exitDate && (mode === "toutes" || VOLUNTARY_EXIT_REASONS.includes(row.reason ?? ""));
    followed.push({ subject: { entry: 0, time: exit - origin + 1, event }, row, year: row.origin.slice(0, 4) });
  }
  return { followed, notFollowed, windowStart };
}

function groupKey(f: Followed, segment: RetentionSegment, cohortOf: (year: string) => string): string {
  if (segment === "cohorte") return cohortOf(f.year);
  if (segment === "departement") return f.row.departmentName ?? "Sans département";
  if (segment === "contrat") return (f.row.firstContract && FIRST_CONTRACT_LABEL[f.row.firstContract]) || "Non renseigné";
  return f.row.jobFamily?.trim() || "Non renseignée";
}

// Années d'embauche ; au-delà de MAX_COHORTS, les plus anciennes sont regroupées (« 2020 à 2022 »)
function cohortMapper(years: string[]): (year: string) => string {
  const list = [...new Set(years)].sort();
  if (list.length <= MAX_COHORTS) return (y) => y;
  const merged = list.slice(0, list.length - MAX_COHORTS + 1);
  const label = `${merged[0]} à ${merged[merged.length - 1]}`;
  return (y) => (y <= merged[merged.length - 1] ? label : y);
}

function orderGroups(segment: RetentionSegment, entries: [string, Followed[]][]): [string, Followed[]][] {
  if (segment === "cohorte") return entries.sort(([a], [b]) => a.localeCompare(b));
  if (segment === "contrat") return entries.sort(([a], [b]) => CONTRACT_ORDER.indexOf(a) - CONTRACT_ORDER.indexOf(b));
  return entries.sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b, "fr"));
}

const lastShown = (c: CurveSummary) => {
  for (let i = c.survival.length - 1; i >= 0; i--) if (c.survival[i] != null) return i;
  return -1;
};
const trim = (c: CurveSummary, len: number): CurveSummary => ({
  ...c,
  survival: c.survival.slice(0, len),
  lower: c.lower.slice(0, len),
  upper: c.upper.slice(0, len),
  atRisk: c.atRisk.slice(0, len),
});

// Côté RH comme manager, une courbe s'arrête dès que moins de MIN_GROUP_SIZE personnes restent suivies (robustesse
// statistique ; côté manager, aucune marche ne révèle une sortie individuelle). Manager : groupes de moins de 5 personnes,
// ou déductibles par différence avec l'ensemble, masqués (smallGroupMask).
export function getRetention(ctx: AccessContext, q: RetentionQuery): RetentionDto {
  ensurePilotage(ctx, "retention.view", { type: "page", id: "/retention" });
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const { followed, notFollowed, windowStart } = followUp(loadRows(ctx, ref), ref, q.mode);
  const maxTime = followed.reduce((m, f) => Math.max(m, f.subject.time), 0);
  const opts = { minAtRisk: MIN_GROUP_SIZE, horizonMonths: Math.ceil(toMonths(maxTime)) };
  const overall = summarizeCurve(
    followed.map((f) => f.subject),
    opts,
  );

  let groups: RetentionGroup[] = [];
  let test: RetentionDto["logRank"] = null;
  if (q.segment) {
    const segment = q.segment;
    const cohortOf = cohortMapper(followed.map((f) => f.year));
    const byKey = new Map<string, Followed[]>();
    for (const f of followed) {
      const k = groupKey(f, segment, cohortOf);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(f);
    }
    const entries = orderGroups(segment, [...byKey.entries()]);
    const masked = global ? entries.map(() => false) : smallGroupMask(entries.map(([, list]) => list.length));
    groups = entries.map(([key, list], i) =>
      masked[i]
        ? { key, label: key, n: null, masked: true, inChart: false, curve: null }
        : {
            key,
            label: key,
            n: list.length,
            masked: false,
            inChart: false,
            curve: summarizeCurve(
              list.map((f) => f.subject),
              opts,
            ),
          },
    );
    const charted = groups
      .filter((g) => g.curve && g.curve.stopMonths > 0)
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
      .slice(0, MAX_CHART_GROUPS);
    for (const g of charted) g.inChart = true;
    const lr = logRank(entries.filter((_, i) => !masked[i]).map(([, list]) => list.map((f) => f.subject)));
    test = lr && { chi2: lr.chi2, df: lr.df, pValue: lr.pValue };
  }

  const showOverall = followed.length > 0 && (global || followed.length >= MIN_GROUP_SIZE);
  const len = Math.max(showOverall ? lastShown(overall) : -1, ...groups.map((g) => (g.curve ? lastShown(g.curve) : -1))) + 1;
  return {
    view: global ? "RH" : "MANAGER",
    referenceDate: ref,
    observationStart: windowStart,
    mode: q.mode,
    segment: q.segment ?? null,
    minAtRisk: MIN_GROUP_SIZE,
    horizonMonths: Math.max(0, len - 1),
    followed: followed.length,
    overall: showOverall ? trim(overall, len) : null,
    groups: groups.map((g) => (g.curve ? { ...g, curve: trim(g.curve, len) } : g)),
    maskedGroups: groups.filter((g) => g.masked).length,
    logRank: test,
    notFollowed,
  };
}

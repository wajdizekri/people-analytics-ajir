import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getSetting } from "@/lib/settings";
import { workStartSql } from "@/lib/aggregates";
import { ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import {
  AGE_BANDS,
  TENURE_BANDS,
  departmentOptions,
  getPublishedRun,
  populationShape,
  populationWhere,
  referenceDate,
  type ModelKind,
  type PopulationFilters,
  type RiskLevel,
} from "./employees";
import {
  MIN_GROUP_SIZE,
  addMonths,
  computeMonthlyRows,
  countPresent,
  monthEnd,
  monthRange,
  ratio,
  rollingTurnover,
  workingDayFn,
  workforce,
  type AbsenceEp,
  type MonthRow,
  type PopEmployee,
  type PopMember,
} from "./pilotage-metrics";

export const PERIODS = {
  "3m": { months: 3, label: "3 derniers mois" },
  "6m": { months: 6, label: "6 derniers mois" },
  "12m": { months: 12, label: "12 derniers mois" },
  "18m": { months: 18, label: "18 derniers mois" },
  "24m": { months: 24, label: "24 derniers mois" },
} as const;
export type PeriodKey = keyof typeof PERIODS;
export const LEVEL_LABELS: Record<RiskLevel, string> = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible" };

export const dashboardQuerySchema = z.object({
  periode: z.enum(Object.keys(PERIODS) as [PeriodKey, ...PeriodKey[]]).default("12m"),
  ...populationShape,
  niveau: z.enum(["ELEVE", "MOYEN", "FAIBLE"]).optional(),
});
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

// Manager : pas de filtre contrat, âge ni ancienneté (recoupements sur de petits effectifs) ; ignorés et signalés s'ils sont fournis
export const MANAGER_IGNORED_FILTERS = ["contrat", "age", "anciennete"] as const;
export function restrictDashboardQuery(ctx: AccessContext, q: DashboardQuery): { query: DashboardQuery; dropped: string[] } {
  if (isGlobal(ctx)) return { query: q, dropped: [] };
  return { query: { ...q, contrat: undefined, age: undefined, anciennete: undefined }, dropped: MANAGER_IGNORED_FILTERS.filter((k) => q[k] != null) };
}

type RiskCounts = { ELEVE: number; MOYEN: number; FAIBLE: number; nonScored: number };
type RiskDeptRaw = RiskCounts & { departmentId: number | null; name: string | null; avgLift: number | null };

type DashboardCommon = {
  referenceDate: string;
  period: { key: PeriodKey; from: string; to: string; label: string };
  filters: { key: string; label: string; value: string }[];
  ignored: string[];
  source: "AGREGATS" | "DETAIL";
  // effectif, entrées, sorties et turnover hors stages et SIVP ; absentéisme sur tous les présents
  // manager : taux et sorties masqués (null) quand la population concernée compte moins de MIN_GROUP_SIZE personnes
  smallPopulation: boolean;
  kpis: {
    headcount: number;
    entries: number;
    exits: number | null;
    voluntaryExits: number | null;
    turnover12: number | null;
    turnover12Voluntary: number | null;
    absenteeismRate: number | null;
    mandatoryTraining: { done: number; due: number; rate: number | null };
  };
  series: { month: string; headcount: number; turnover12: number | null; turnover12Voluntary: number | null; absenteeismRate: number | null }[];
};
export type RiskManager = { asOf: string; totals: RiskCounts; byDepartment: (RiskCounts & { departmentId: number | null; name: string })[] };
export type RiskRh = { asOf: string; modelVersion: string; modelKind: ModelKind; totals: RiskCounts; byDepartment: (RiskCounts & { departmentId: number | null; name: string; avgLift: number | null })[] };
// RH uniquement : effectif fin de période et absentéisme mensuel (aligné sur `series`) par département
export type DepartmentStat = { departmentId: number | null; name: string; headcount: number; absenteeismRate: number | null; absenteeismRates: (number | null)[] };
type PayrollRh = { month: string; lastMonth: number; periodTotal: number; monthly: number[] };
export type DashboardRh = DashboardCommon & { view: "RH"; payroll: PayrollRh; departments: DepartmentStat[]; risk: RiskRh | null };
export type DashboardManager = DashboardCommon & { view: "MANAGER"; risk: RiskManager | null };
export type DashboardDto = DashboardRh | DashboardManager;

type DashboardRaw = DashboardCommon & {
  payroll: PayrollRh | null;
  departments: DepartmentStat[] | null;
  run: { asOf: string; modelVersion: string; modelKind: ModelKind } | null;
  riskRows: RiskDeptRaw[];
};

function lastDataMonth(): string {
  const { sqlite } = getDb();
  const end = getSetting(sqlite, "data_end_date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) return end.slice(0, 7);
  const max = (sqlite.prepare("SELECT MAX(month) AS m FROM agg_kpi_monthly").get() as { m: string | null }).m;
  return max ?? new Date().toISOString().slice(0, 7);
}

const EMPTY_ROW = (month: string): MonthRow => ({
  month,
  headcount: 0,
  entries: 0,
  exits: 0,
  voluntaryExits: 0,
  absenceDaysNonHealth: 0,
  absenceDaysHealth: 0,
  workableDays: 0,
  payrollMass: 0,
  trainingsDone: 0,
  trainingsDue: 0,
});

function monthlyFromAggregates(months: string[], departmentId?: number): MonthRow[] {
  const rows = getDb()
    .sqlite.prepare(
      `SELECT month, SUM(headcount) AS headcount, SUM(entries) AS entries, SUM(exits) AS exits, SUM(voluntary_exits) AS voluntaryExits,
        SUM(absence_days_non_health) AS absenceDaysNonHealth, SUM(absence_days_health) AS absenceDaysHealth, SUM(workable_days) AS workableDays,
        SUM(payroll_mass) AS payrollMass, SUM(trainings_done) AS trainingsDone, SUM(trainings_due) AS trainingsDue
       FROM agg_kpi_monthly WHERE month BETWEEN @from AND @to ${departmentId ? "AND department_id = @dept" : ""} GROUP BY month`,
    )
    .all({ from: months[0], to: months[months.length - 1], dept: departmentId }) as MonthRow[];
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => byMonth.get(m) ?? EMPTY_ROW(m));
}

type Member = PopMember & { departmentId: number | null };
type SourcesData = { rows: MonthRow[]; employees: Member[]; absences: AbsenceEp[]; isWorking: (d: string) => boolean };

const members = (clause: string, params: Record<string, unknown>) =>
  getDb()
    .sqlite.prepare(
      `SELECT e.id, e.hire_date AS hireDate, e.exit_date AS exitDate, ${workStartSql("e")} AS workStart, e.department_id AS departmentId FROM employee e WHERE ${clause}`,
    )
    .all(params) as Member[];

// Population filtrée (périmètre manager, contrat, âge, ancienneté) : calcul direct depuis les sources, mêmes définitions que les agrégats
function sourcesData(ctx: AccessContext, f: PopulationFilters, ref: string, months: string[], withPayroll: boolean): SourcesData {
  const { sqlite } = getDb();
  const pop = populationWhere(ctx, f, ref);
  const from = months[0] + "-01";
  const to = monthEnd(months[months.length - 1]);
  const base = { ...pop.params, from, to, fromMonth: months[0], toMonth: months[months.length - 1] };
  const employees = members(pop.clause, base);
  // Population résolue une fois : les requêtes suivantes filtrent par identifiant (index par salarié) au lieu de réévaluer
  // le filtre de population (sous-requêtes corrélées sur les contrats) sur chaque ligne de paie ou d'absence.
  const p = { ...base, ids: JSON.stringify(employees.map((e) => e.id)) };
  const join = (t: string) => `WHERE ${t}.employee_id IN (SELECT value FROM json_each(@ids))`;
  const exits = sqlite
    .prepare(`SELECT x.employee_id AS employeeId, x.exit_date AS exitDate, x.reason FROM exit_event x ${join("x")} AND x.exit_date BETWEEN @from AND @to`)
    .all(p) as { employeeId: number; exitDate: string; reason: string }[];
  const absences = (
    sqlite
      .prepare(
        `SELECT a.employee_id AS employeeId, a.start_date AS startDate, a.end_date AS endDate, a.days, a.is_health AS isHealth, a.category
         FROM absence_episode a ${join("a")} AND a.end_date >= @from AND a.start_date <= @to`,
      )
      .all(p) as { employeeId: number; startDate: string; endDate: string; days: number; isHealth: number; category: string }[]
  ).map((a) => ({ ...a, isHealth: !!a.isHealth }));
  const payroll = withPayroll
    ? (sqlite.prepare(`SELECT pm.month, pm.gross_salary AS gross FROM payroll_monthly pm ${join("pm")} AND pm.month BETWEEN @fromMonth AND @toMonth`).all(p) as {
        month: string;
        gross: number;
      }[])
    : [];
  const mandatoryTrainings = sqlite
    .prepare(`SELECT t.due_date AS dueDate, t.status FROM training t ${join("t")} AND t.mandatory = 1 AND t.due_date BETWEEN @from AND @to`)
    .all(p) as { dueDate: string | null; status: string }[];
  const isWorking = workingDays(from, to);
  return { rows: computeMonthlyRows({ months, employees, exits, absences, payroll, mandatoryTrainings, isWorking }), employees, absences, isWorking };
}

type DeptMonth = Pick<MonthRow, "headcount" | "absenceDaysNonHealth" | "workableDays">;

function departmentStat(departmentId: number | null, name: string, rows: DeptMonth[]): DepartmentStat {
  const absent = rows.reduce((s, r) => s + r.absenceDaysNonHealth, 0);
  const workable = rows.reduce((s, r) => s + r.workableDays, 0);
  return {
    departmentId,
    name,
    headcount: rows[rows.length - 1]?.headcount ?? 0,
    absenteeismRate: ratio(absent, workable),
    absenteeismRates: rows.map((r) => ratio(r.absenceDaysNonHealth, r.workableDays)),
  };
}

const activeDepartment = (d: { stat: DepartmentStat; rows: DeptMonth[] }) => d.rows.some((r) => r.headcount > 0 || r.workableDays > 0);
const byName = (a: DepartmentStat, b: DepartmentStat) => a.name.localeCompare(b.name, "fr");

// Département de rattachement du mois, comme les agrégats
function departmentsFromAggregates(months: string[], departmentId?: number): DepartmentStat[] {
  const rows = getDb()
    .sqlite.prepare(
      `SELECT a.department_id AS departmentId, d.name, a.month, a.headcount, a.absence_days_non_health AS absenceDaysNonHealth, a.workable_days AS workableDays
       FROM agg_kpi_monthly a LEFT JOIN department d ON d.id = a.department_id
       WHERE a.month BETWEEN @from AND @to ${departmentId ? "AND a.department_id = @dept" : ""}`,
    )
    .all({ from: months[0], to: months[months.length - 1], dept: departmentId }) as (DeptMonth & { departmentId: number; name: string | null; month: string })[];
  const groups = new Map<number, { name: string; byMonth: Map<string, DeptMonth> }>();
  for (const r of rows) {
    if (!groups.has(r.departmentId)) groups.set(r.departmentId, { name: r.name ?? "Sans département", byMonth: new Map() });
    groups.get(r.departmentId)!.byMonth.set(r.month, r);
  }
  return [...groups.entries()]
    .map(([id, g]) => {
      const monthly = months.map((m) => g.byMonth.get(m) ?? { headcount: 0, absenceDaysNonHealth: 0, workableDays: 0 });
      return { stat: departmentStat(id, g.name, monthly), rows: monthly };
    })
    .filter(activeDepartment)
    .map((d) => d.stat)
    .sort(byName);
}

// Calcul détaillé : département actuel du salarié (même règle que le filtre département de la population)
function departmentsFromSources(months: string[], src: SourcesData): DepartmentStat[] {
  const names = new Map(departmentOptions().map((d) => [d.id, d.label]));
  const groups = new Map<number | null, Member[]>();
  for (const e of src.employees) {
    if (!groups.has(e.departmentId)) groups.set(e.departmentId, []);
    groups.get(e.departmentId)!.push(e);
  }
  return [...groups.entries()]
    .map(([id, employees]) => {
      const ids = new Set(employees.map((e) => e.id));
      const rows = computeMonthlyRows({
        months,
        employees,
        exits: [],
        absences: src.absences.filter((a) => ids.has(a.employeeId)),
        mandatoryTrainings: [],
        isWorking: src.isWorking,
      });
      return { stat: departmentStat(id, (id != null && names.get(id)) || "Sans département", rows), rows };
    })
    .filter(activeDepartment)
    .map((d) => d.stat)
    .sort(byName);
}

function monthlyFromSources(ctx: AccessContext, f: PopulationFilters, ref: string, months: string[], withPayroll: boolean): MonthRow[] {
  return sourcesData(ctx, f, ref, months, withPayroll).rows;
}

const hasPopulationFilter = (f: PopulationFilters) => !!(f.departement || f.contrat || f.age || f.anciennete);

type GuardPopulation = "presents" | "contrats";

// Vrai si un taux ou des sorties peuvent être montrés sur [from, to] : pour un manager, population filtrée >= K et,
// avec un filtre, complément dans son périmètre nul ou >= K (sinon « périmètre − filtre » isolerait quelqu'un).
// Population comptée : tous les présents (absentéisme) ou les seuls contrats de travail (sorties, turnover).
function smallGroupGuard(ctx: AccessContext, f: PopulationFilters, filtered: PopMember[]): (from: string, to: string, population: GuardPopulation) => boolean {
  if (isGlobal(ctx)) return () => true;
  const scope = scopeFilter(ctx, "e.id");
  const perimeter = hasPopulationFilter(f) ? members(scope.clause, scope.params) : null;
  const pops: Record<GuardPopulation, [PopEmployee[], PopEmployee[] | null]> = {
    presents: [filtered, perimeter],
    contrats: [workforce(filtered), perimeter && workforce(perimeter)],
  };
  return (from, to, population) => {
    const [pop, per] = pops[population];
    const n = countPresent(pop, from, to);
    if (n < MIN_GROUP_SIZE) return false;
    const rest = per ? countPresent(per, from, to) - n : 0;
    return rest === 0 || rest >= MIN_GROUP_SIZE;
  };
}

export function workingDays(from: string, to: string): (d: string) => boolean {
  const rows = getDb()
    .sqlite.prepare("SELECT date, (is_weekend = 0 AND is_holiday = 0) AS w FROM dim_date WHERE date BETWEEN ? AND ?")
    .all(from, to) as { date: string; w: number }[];
  return workingDayFn(new Map(rows.map((r) => [r.date, !!r.w])));
}

function riskRows(ctx: AccessContext, f: PopulationFilters & { niveau?: RiskLevel }, ref: string, runId: number): RiskDeptRaw[] {
  const pop = populationWhere(ctx, f, ref);
  return getDb()
    .sqlite.prepare(
      `SELECT d.id AS departmentId, d.name,
        COALESCE(SUM(p.level = 'ELEVE'), 0) AS ELEVE, COALESCE(SUM(p.level = 'MOYEN'), 0) AS MOYEN, COALESCE(SUM(p.level = 'FAIBLE'), 0) AS FAIBLE,
        COALESCE(SUM(p.id IS NULL), 0) AS nonScored, AVG(p.lift) AS avgLift
       FROM employee e LEFT JOIN department d ON d.id = e.department_id
       LEFT JOIN prediction p ON p.run_id = @runId AND p.employee_id = e.id
       WHERE e.status = 'ACTIF' AND ${pop.clause} ${f.niveau ? "AND p.level = @niveau" : ""}
       GROUP BY d.id ORDER BY d.name`,
    )
    .all({ ...pop.params, runId, niveau: f.niveau }) as RiskDeptRaw[];
}

function describeFilters(q: DashboardQuery): DashboardCommon["filters"] {
  const out: DashboardCommon["filters"] = [];
  if (q.departement) out.push({ key: "departement", label: "Département", value: departmentOptions().find((d) => d.id === q.departement)?.label ?? `n° ${q.departement}` });
  if (q.contrat) out.push({ key: "contrat", label: "Contrat", value: q.contrat });
  if (q.age) out.push({ key: "age", label: "Âge", value: AGE_BANDS[q.age].label });
  if (q.anciennete) out.push({ key: "anciennete", label: "Ancienneté", value: TENURE_BANDS[q.anciennete].label });
  if (q.niveau) out.push({ key: "niveau", label: "Niveau de risque", value: LEVEL_LABELS[q.niveau] });
  return out;
}

function loadDashboard(ctx: AccessContext, q: DashboardQuery, ignored: string[]): DashboardRaw {
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const to = lastDataMonth();
  const n = PERIODS[q.periode].months;
  const from = addMonths(to, -(n - 1));
  const months = monthRange(addMonths(from, -11), to);
  const useAggregates = global && !q.contrat && !q.age && !q.anciennete;
  const src = useAggregates ? null : sourcesData(ctx, q, ref, months, global);
  const rows = src ? src.rows : monthlyFromAggregates(months, q.departement);
  const shown = smallGroupGuard(ctx, q, src?.employees ?? []);
  let small = false;
  const guard = <T>(value: T, fromMonth: string, toMonth: string, population: GuardPopulation = "contrats"): T | null => {
    if (shown(fromMonth + "-01", monthEnd(toMonth), population)) return value;
    small = true;
    return null;
  };
  const offset = months.indexOf(from);
  const period = rows.slice(offset);
  const sum = (k: keyof Omit<MonthRow, "month">) => period.reduce((s, r) => s + r[k], 0);
  const last = rows[rows.length - 1];
  const turnover = (i: number, voluntary: boolean) => {
    const value = rollingTurnover(rows, i, voluntary);
    return value == null ? null : guard(value, rows[i - 11].month, rows[i].month);
  };

  const kpis: DashboardCommon["kpis"] = {
    headcount: last.headcount,
    entries: sum("entries"),
    exits: guard(sum("exits"), from, to),
    voluntaryExits: guard(sum("voluntaryExits"), from, to),
    turnover12: turnover(rows.length - 1, false),
    turnover12Voluntary: turnover(rows.length - 1, true),
    absenteeismRate: guard(ratio(sum("absenceDaysNonHealth"), sum("workableDays")), from, to, "presents"),
    mandatoryTraining: { done: sum("trainingsDone"), due: sum("trainingsDue"), rate: ratio(sum("trainingsDone"), sum("trainingsDue")) },
  };
  const series = period.map((r, i) => ({
    month: r.month,
    headcount: r.headcount,
    turnover12: turnover(offset + i, false),
    turnover12Voluntary: turnover(offset + i, true),
    absenteeismRate: guard(ratio(r.absenceDaysNonHealth, r.workableDays), r.month, r.month, "presents"),
  }));

  const periodMonths = months.slice(offset);
  const run = getPublishedRun();
  return {
    referenceDate: ref,
    period: { key: q.periode, from, to, label: PERIODS[q.periode].label },
    filters: describeFilters(q),
    ignored,
    source: useAggregates ? "AGREGATS" : "DETAIL",
    smallPopulation: small,
    kpis,
    series,
    payroll: global ? { month: to, lastMonth: last.payrollMass, periodTotal: sum("payrollMass"), monthly: period.map((r) => r.payrollMass) } : null,
    departments: !global ? null : src ? departmentsFromSources(periodMonths, src) : departmentsFromAggregates(periodMonths, q.departement),
    run: run ? { asOf: run.asOf, modelVersion: run.modelVersion, modelKind: run.modelKind } : null,
    riskRows: run ? riskRows(ctx, q, ref, run.id) : [],
  };
}

const totals = (rows: RiskCounts[]): RiskCounts =>
  rows.reduce((t, r) => ({ ELEVE: t.ELEVE + r.ELEVE, MOYEN: t.MOYEN + r.MOYEN, FAIBLE: t.FAIBLE + r.FAIBLE, nonScored: t.nonScored + r.nonScored }), {
    ELEVE: 0,
    MOYEN: 0,
    FAIBLE: 0,
    nonScored: 0,
  });

function common(raw: DashboardRaw): DashboardCommon {
  return {
    referenceDate: raw.referenceDate,
    period: { ...raw.period },
    filters: raw.filters.map((f) => ({ ...f })),
    ignored: [...raw.ignored],
    source: raw.source,
    smallPopulation: raw.smallPopulation,
    kpis: { ...raw.kpis, mandatoryTraining: { ...raw.kpis.mandatoryTraining } },
    series: raw.series.map((s) => ({ ...s })),
  };
}

export function toRhDashboardDto(raw: DashboardRaw): DashboardRh {
  return {
    view: "RH",
    ...common(raw),
    payroll: raw.payroll ? { ...raw.payroll, monthly: [...raw.payroll.monthly] } : { month: raw.period.to, lastMonth: 0, periodTotal: 0, monthly: [] },
    departments: (raw.departments ?? []).map((d) => ({ ...d, absenteeismRates: [...d.absenteeismRates] })),
    risk: raw.run
      ? {
          asOf: raw.run.asOf,
          modelVersion: raw.run.modelVersion,
          modelKind: raw.run.modelKind,
          totals: totals(raw.riskRows),
          byDepartment: raw.riskRows.map((r) => ({
            departmentId: r.departmentId,
            name: r.name ?? "Sans département",
            ELEVE: r.ELEVE,
            MOYEN: r.MOYEN,
            FAIBLE: r.FAIBLE,
            nonScored: r.nonScored,
            avgLift: raw.run!.modelKind === "B0" ? null : r.avgLift,
          })),
        }
      : null,
  };
}

// Sans masse salariale, sans lift, sans version de modèle, sans ventilation par département hors niveaux de risque
export function toManagerDashboardDto(raw: DashboardRaw): DashboardManager {
  return {
    view: "MANAGER",
    ...common(raw),
    risk: raw.run
      ? {
          asOf: raw.run.asOf,
          totals: totals(raw.riskRows),
          byDepartment: raw.riskRows.map((r) => ({
            departmentId: r.departmentId,
            name: r.name ?? "Sans département",
            ELEVE: r.ELEVE,
            MOYEN: r.MOYEN,
            FAIBLE: r.FAIBLE,
            nonScored: r.nonScored,
          })),
        }
      : null,
  };
}

// ---------- Cache mémoire ----------
// Clé : vue (RH ou racine du manager), filtres, date du jour et version des données. La version change à la publication
// ou à la réécriture du run courant, à chaque import et à chaque recalcul des agrégats ; relue à chaque appel (une requête
// indexée), elle invalide aussi le cache quand l'écriture vient du worker ou d'un script. Durée de vie bornée par sécurité.
const CACHE_MAX = 200;
const CACHE_TTL_MS = 10 * 60_000;
const dashboardCache = new Map<string, { at: number; raw: DashboardRaw }>();

export function clearDashboardCache(): void {
  dashboardCache.clear();
}

function dataVersion(): string {
  const v = getDb()
    .sqlite.prepare(
      `SELECT (SELECT value FROM app_setting WHERE key = 'current_run_id') AS run,
         (SELECT r.status || ':' || IFNULL(r.finished_at, '') FROM scoring_run r
           WHERE r.id = (SELECT CAST(value AS INTEGER) FROM app_setting WHERE key = 'current_run_id')) AS runState,
         (SELECT id || ':' || status || ':' || IFNULL(finished_at, '') FROM import_batch ORDER BY id DESC LIMIT 1) AS lastImport,
         (SELECT value FROM app_setting WHERE key = 'aggregates_refreshed_at') AS aggregates,
         (SELECT value FROM app_setting WHERE key = 'data_end_date') AS dataEnd`,
    )
    .get();
  return JSON.stringify(v);
}

function cachedDashboard(ctx: AccessContext, q: DashboardQuery, ignored: string[]): DashboardRaw {
  const query = Object.fromEntries(Object.entries(q).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)));
  const period = [referenceDate(), lastDataMonth(), new Date().toISOString().slice(0, 10)];
  const key = JSON.stringify([isGlobal(ctx) ? "RH" : `M${ctx.employeeId}`, query, [...ignored].sort(), period, dataVersion()]);
  const now = Date.now();
  const hit = dashboardCache.get(key);
  dashboardCache.delete(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    dashboardCache.set(key, hit);
    return hit.raw;
  }
  const raw = loadDashboard(ctx, q, ignored);
  dashboardCache.set(key, { at: now, raw });
  if (dashboardCache.size > CACHE_MAX) dashboardCache.delete(dashboardCache.keys().next().value!);
  return raw;
}

export function getDashboard(ctx: AccessContext, q: DashboardQuery, ignored: string[] = []): DashboardDto {
  ensurePilotage(ctx, "dashboard.view");
  const { query, dropped } = restrictDashboardQuery(ctx, q);
  const raw = cachedDashboard(ctx, query, [...new Set([...ignored, ...dropped])]);
  return isGlobal(ctx) ? toRhDashboardDto(raw) : toManagerDashboardDto(raw);
}

export { monthlyFromAggregates as _monthlyFromAggregates, monthlyFromSources as _monthlyFromSources };

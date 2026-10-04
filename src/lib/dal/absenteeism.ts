import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ensurePilotage, isGlobal, SCOPE_SUBQUERY, scopeFilter, type AccessContext } from "./context";
import { workingDays } from "./dashboard";
import { referenceDate } from "./employees";
import {
  MIN_GROUP_SIZE,
  absenceByEmployee,
  addMonths,
  countPresent,
  isUnplannedNonHealth,
  monthBuckets,
  monthRange,
  ratio,
  smallGroupMask,
  sumByBucket,
  weekBuckets,
  workableCounter,
  type AbsenceEp,
  type Bucket,
} from "./pilotage-metrics";

export const absenteeismQuerySchema = z.object({
  granularite: z.enum(["semaine", "mois"]).default("semaine"),
  axe: z.enum(["departement", "equipe"]).default("departement"),
  departement: z.coerce.number().int().positive().optional(),
});
export type AbsenteeismQuery = z.output<typeof absenteeismQuerySchema>;

const WEEKS = 26;
const MONTHS = 12;
const MAX_SERIES = 8;

type Member = { id: number; hireDate: string; exitDate: string | null; departmentId: number | null; managerId: number | null; status: string };
// masked : groupe trop petit pour être montré à un manager (taux et jours à null)
export type AbsSeries = {
  key: string;
  label: string;
  activeMembers: number;
  masked: boolean;
  rates: (number | null)[];
  absenceDays: number | null;
  workableDays: number | null;
  rate: number | null;
};
export type CollectiveAnomaly = { id: number; scope: "EQUIPE" | "DEPARTEMENT"; groupLabel: string; periodStart: string; periodEnd: string; message: string };
export type IndividualSignal = { id: number; employeeId: number; employeeName: string; matricule: string; department: string | null; periodStart: string; periodEnd: string; message: string };

type Common = {
  referenceDate: string;
  granularity: "semaine" | "mois";
  axis: "departement" | "equipe";
  window: { from: string; to: string };
  buckets: { key: string; from: string; to: string }[];
  total: AbsSeries;
  series: AbsSeries[];
  hiddenSeries: number;
  collective: CollectiveAnomaly[];
};
export type AbsenteeismRh = Common & { view: "RH"; individual: IndividualSignal[] };
export type AbsenteeismManager = Common & { view: "MANAGER" };
export type AbsenteeismDto = AbsenteeismRh | AbsenteeismManager;

type SeriesCtx = { buckets: Bucket[]; absence: Map<number, number[]>; workable: (members: Member[]) => number[] };
type Group = { key: string; label: string; members: Member[] };

function series(key: string, label: string, members: Member[], c: SeriesCtx): AbsSeries {
  const workable = c.workable(members);
  const absent = sumByBucket(c.buckets.length, members.map((m) => c.absence.get(m.id)));
  const absenceDays = absent.reduce((s, x) => s + x, 0);
  const workableDays = workable.reduce((s, x) => s + x, 0);
  return {
    key,
    label,
    activeMembers: members.filter((m) => m.status === "ACTIF").length,
    masked: false,
    rates: c.buckets.map((_, i) => ratio(absent[i], workable[i])),
    absenceDays,
    workableDays,
    rate: ratio(absenceDays, workableDays),
  };
}

const maskSeries = (s: AbsSeries): AbsSeries => ({ ...s, masked: true, rates: s.rates.map(() => null), absenceDays: null, workableDays: null, rate: null });

// Vue manager : aucun groupe de moins de MIN_GROUP_SIZE personnes (présentes sur la fenêtre ou actives aujourd'hui,
// puis présentes dans chaque période), ni un groupe déductible par différence avec le total ; les groupes non tracés
// (au-delà de MAX_SERIES) comptent comme masqués.
function guardSeries(groups: Group[], all: AbsSeries[], total: AbsSeries, totalMembers: Member[], buckets: Bucket[]) {
  const n = groups.length;
  const tooSmall = (members: number, active: number) => members > 0 && (members < MIN_GROUP_SIZE || active < MIN_GROUP_SIZE);
  const counts = groups.map((g) => g.members.length);
  const primary = smallGroupMask(counts, all.map((s, i) => tooSmall(counts[i], s.activeMembers)));
  const order = [...Array(n).keys()].sort(
    (a, b) => Number(primary[a]) - Number(primary[b]) || (all[b].rate ?? -1) - (all[a].rate ?? -1) || all[a].label.localeCompare(all[b].label),
  );
  const hidden = new Array<boolean>(n).fill(false);
  order.slice(MAX_SERIES).forEach((i) => (hidden[i] = true));
  const masked = smallGroupMask(counts, primary.map((m, i) => m || hidden[i]));
  const guarded = all.map((s, i) => (masked[i] ? maskSeries(s) : { ...s, rates: [...s.rates] }));
  buckets.forEach((b, t) => {
    const inBucket = smallGroupMask(
      groups.map((g) => countPresent(g.members, b.from, b.to)),
      masked,
    );
    guarded.forEach((s, i) => {
      if (inBucket[i]) s.rates[t] = null;
    });
  });
  const totalOut = tooSmall(totalMembers.length, total.activeMembers)
    ? maskSeries(total)
    : { ...total, rates: total.rates.map((r, t) => (countPresent(totalMembers, buckets[t].from, buckets[t].to) < MIN_GROUP_SIZE ? null : r)) };
  return { series: order.filter((i) => !hidden[i]).map((i) => guarded[i]), hiddenSeries: n - Math.min(n, MAX_SERIES), total: totalOut };
}

export function getAbsenteeism(ctx: AccessContext, q: AbsenteeismQuery): AbsenteeismDto {
  ensurePilotage(ctx, "absenteeism.view");
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const axis = global ? q.axe : "equipe";
  const buckets = (
    q.granularite === "semaine" ? weekBuckets(ref, WEEKS) : monthBuckets(monthRange(addMonths(ref.slice(0, 7), -(MONTHS - 1)), ref.slice(0, 7)))
  ).map((b) => (b.to > ref ? { ...b, to: ref } : b));
  const from = buckets[0].from;
  const to = buckets[buckets.length - 1].to;

  const scope = scopeFilter(ctx, "e.id");
  const deptClause = global && q.departement ? "AND e.department_id = @dept" : "";
  const params = { ...scope.params, from, to, dept: q.departement };
  const members = sqlite
    .prepare(
      `SELECT e.id, e.hire_date AS hireDate, e.exit_date AS exitDate, e.department_id AS departmentId, e.manager_id AS managerId, e.status
       FROM employee e WHERE ${scope.clause} ${deptClause} AND e.hire_date <= @to AND (e.exit_date IS NULL OR e.exit_date >= @from)`,
    )
    .all(params) as Member[];
  const episodes = (
    sqlite
      .prepare(
        `SELECT a.employee_id AS employeeId, a.start_date AS startDate, a.end_date AS endDate, a.days, a.is_health AS isHealth, a.category
         FROM absence_episode a JOIN employee e ON e.id = a.employee_id
         WHERE ${scope.clause} ${deptClause} AND a.is_health = 0 AND a.category <> 'CONGE_ANNUEL' AND a.end_date >= @from AND a.start_date <= @to`,
      )
      .all(params) as (Omit<AbsenceEp, "isHealth"> & { isHealth: number })[]
  )
    .map((a) => ({ ...a, isHealth: !!a.isHealth }))
    .filter(isUnplannedNonHealth);
  const isWorking = workingDays(from, to);
  const sc: SeriesCtx = { buckets, absence: absenceByEmployee(buckets, episodes, isWorking), workable: workableCounter(buckets, isWorking) };

  const groups = new Map<string, Omit<Group, "key">>();
  if (axis === "departement") {
    const names = new Map((sqlite.prepare("SELECT id, name FROM department").all() as { id: number; name: string }[]).map((d) => [d.id, d.name]));
    for (const m of members) {
      const k = String(m.departmentId ?? 0);
      if (!groups.has(k)) groups.set(k, { label: names.get(m.departmentId ?? -1) ?? "Sans département", members: [] });
      groups.get(k)!.members.push(m);
    }
  } else {
    const managerIds = [...new Set(members.map((m) => m.managerId).filter((x): x is number => x != null))];
    const names = new Map<number, string>();
    const stmt = sqlite.prepare("SELECT last_name || ' ' || first_name AS n FROM employee WHERE id = ?");
    for (const id of managerIds) names.set(id, (stmt.get(id) as { n: string } | undefined)?.n ?? `n° ${id}`);
    for (const m of members) {
      if (m.managerId == null) continue;
      const k = String(m.managerId);
      if (!groups.has(k)) groups.set(k, { label: `Équipe de ${names.get(m.managerId)}`, members: [] });
      groups.get(k)!.members.push(m);
    }
  }

  const list: Group[] = [...groups.entries()].map(([key, g]) => ({ key, ...g }));
  const all = list.map((g) => series(g.key, g.label, g.members, sc));
  const total = series("total", global ? (q.departement ? "Ensemble du département" : "Ensemble de l'entreprise") : "Ensemble de mon périmètre", members, sc);
  let shown: { series: AbsSeries[]; hiddenSeries: number; total: AbsSeries };
  if (global) {
    const sorted = [...all].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.label.localeCompare(b.label));
    shown = { series: sorted.slice(0, MAX_SERIES), hiddenSeries: Math.max(0, sorted.length - MAX_SERIES), total };
  } else shown = guardSeries(list, all, total, members, buckets);

  const collectiveRows = sqlite
    .prepare(
      `SELECT a.id, a.scope, a.period_start AS periodStart, a.period_end AS periodEnd, a.message, d.name AS department,
        m.last_name || ' ' || m.first_name AS managerName
       FROM anomaly a LEFT JOIN department d ON d.id = a.department_id LEFT JOIN employee m ON m.id = a.manager_id
       WHERE a.period_end >= @from AND ${
         global
           ? `a.scope IN ('EQUIPE','DEPARTEMENT') ${q.departement ? "AND a.department_id = @dept" : ""}`
           : `a.scope = 'EQUIPE' AND (a.manager_id = @scopeRoot OR a.manager_id IN (${SCOPE_SUBQUERY}))`
       }
       ORDER BY a.period_start DESC, a.id DESC LIMIT 50`,
    )
    .all({ from, dept: q.departement, scopeRoot: ctx.employeeId ?? -1 }) as {
    id: number;
    scope: "EQUIPE" | "DEPARTEMENT";
    periodStart: string;
    periodEnd: string;
    message: string;
    department: string | null;
    managerName: string | null;
  }[];
  const collective: CollectiveAnomaly[] = collectiveRows.map((r) => ({
    id: r.id,
    scope: r.scope,
    groupLabel: r.scope === "EQUIPE" ? `Équipe de ${r.managerName ?? "—"}${r.department ? ` (${r.department})` : ""}` : (r.department ?? "—"),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    message: r.message,
  }));

  const common: Common = {
    referenceDate: ref,
    granularity: q.granularite,
    axis,
    window: { from, to },
    buckets: buckets.map((b) => ({ ...b })),
    total: shown.total,
    series: shown.series,
    hiddenSeries: shown.hiddenSeries,
    collective,
  };
  if (!global) return { view: "MANAGER", ...common };

  // Signaux individuels : réservés RH, formulés « à vérifier »
  const individual = sqlite
    .prepare(
      `SELECT a.id, a.employee_id AS employeeId, e.last_name || ' ' || e.first_name AS employeeName, e.matricule, d.name AS department,
        a.period_start AS periodStart, a.period_end AS periodEnd, a.message
       FROM anomaly a JOIN employee e ON e.id = a.employee_id LEFT JOIN department d ON d.id = e.department_id
       WHERE a.scope = 'SALARIE' AND a.period_end >= @from ${q.departement ? "AND e.department_id = @dept" : ""}
       ORDER BY a.period_start DESC, a.id DESC LIMIT 50`,
    )
    .all({ from, dept: q.departement }) as IndividualSignal[];
  return { view: "RH", ...common, individual };
}

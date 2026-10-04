import type Database from "better-sqlite3";
import spec from "./queries.json";
import { monthIndex, monthLabel, type EffectifBundle, type MasseBundle, type ResignSource, type StateDepartment, type StateMember, type WorkforceState } from "./engine";

// État de la projection à une fin de mois : même calcul que ml/workforce/state.py, requêtes partagées (queries.json).

type QueryName = keyof typeof spec.queries;
const RESIGN = new Set(["DEMISSION", "ABANDON"]);
const OTHER = new Set(["LICENCIEMENT", "DECES", "MUTATION", "AUTRE"]);

const cache = new Map<QueryName, string>();
export function workforceSql(name: QueryName): string {
  let text = cache.get(name);
  if (!text) {
    const ws = spec.fragments.ws.join("\n");
    const deptAt = spec.fragments.deptAt.join("\n");
    text = spec.queries[name]
      .join("\n")
      .replace("{{ws}}", ws)
      .replace(/\{\{deptAt:([^}]+)\}\}/g, (_, d: string) => deptAt.replaceAll("{d}", d));
    cache.set(name, text);
  }
  return text;
}

function all<T>(sqlite: Database.Database, name: QueryName, params: Record<string, unknown> = {}): T[] {
  return sqlite.prepare(workforceSql(name)).all(params) as T[];
}

export const shiftMonth = (ym: string, n: number) => monthLabel(monthIndex(ym) + n);
export const monthStartOf = (ym: string) => `${ym}-01`;
export function monthEndOf(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${ym}-${String(days).padStart(2, "0")}`;
}
const kOf = (date: string | null, m0: number) => (date ? monthIndex(date.slice(0, 7)) - m0 : null);

type AggRow = { month: string; department_id: number; headcount: number; entries: number; payroll_mass: number };
type MemberRow = {
  id: number;
  department_id: number | null;
  grade: string | null;
  job_title: string | null;
  work_start: string;
  base: number | null;
  contract_type: string | null;
  contract_end: string | null;
  known_exit: string | null;
  retire_date: string | null;
};
export type MemberInfo = MemberRow & { cddK: number | null; retK: number | null };

export function buildState(
  sqlite: Database.Database,
  asOf: string,
  be: EffectifBundle,
  bm: MasseBundle | null,
  prob6: Map<number, number> | null,
): { state: WorkforceState; members: MemberInfo[] } {
  const H = be.horizon;
  const w = be.windows;
  const m0s = asOf.slice(0, 7);
  const m0 = monthIndex(m0s);
  const retAge = `+${be.retirement.age} years`;
  const retLag = `+${be.retirement.lag_days} days`;

  const depts = all<{ id: number; code: string; name: string }>(sqlite, "departments");
  const index = new Map(depts.map((d, i) => [d.id, i]));
  const agg = all<AggRow>(sqlite, "aggregates", { from: shiftMonth(m0s, -w.rates_months), to: m0s });
  const aggMonths = [...new Set(agg.map((a) => a.month))].sort();
  const hcBy = new Map(agg.map((a) => [`${a.month}|${a.department_id}`, a.headcount]));

  let firstRate = shiftMonth(m0s, -w.rates_months + 1);
  if (aggMonths.length && shiftMonth(aggMonths[0], 1) > firstRate) firstRate = shiftMonth(aggMonths[0], 1);
  const rateMonths: string[] = [];
  if (firstRate <= m0s) for (let i = monthIndex(firstRate); i <= m0; i++) rateMonths.push(monthLabel(i));
  const denom = depts.map(() => 0);
  for (const m of rateMonths) {
    const prev = shiftMonth(m, -1);
    for (const d of depts) denom[index.get(d.id)!] += hcBy.get(`${prev}|${d.id}`) ?? 0;
  }
  const resign = depts.map(() => 0);
  const other = depts.map(() => 0);
  if (rateMonths.length) {
    for (const x of all<{ department_id: number | null; reason: string; n: number }>(sqlite, "exits", { fromDate: monthStartOf(rateMonths[0]), toDate: asOf })) {
      const i = x.department_id == null ? undefined : index.get(x.department_id);
      if (i === undefined) continue;
      if (RESIGN.has(x.reason)) resign[i] += x.n;
      else if (OTHER.has(x.reason)) other[i] += x.n;
    }
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const denAll = sum(denom);
  const resignAll = denAll > 0 ? sum(resign) / denAll : 0;
  const otherAll = denAll > 0 ? sum(other) / denAll : 0;

  const hireFrom = shiftMonth(m0s, -w.hires_months + 1);
  const hireMonths = aggMonths.filter((m) => hireFrom <= m && m <= m0s);
  const entries = depts.map(() => 0);
  for (const a of agg) {
    const i = index.get(a.department_id);
    if (hireFrom <= a.month && a.month <= m0s && i !== undefined) entries[i] += a.entries;
  }
  const mass0 = new Map(agg.filter((a) => a.month === m0s).map((a) => [a.department_id, a.payroll_mass]));

  const rawMembers = all<MemberRow>(sqlite, "members", { asOf, m0: m0s, retAge, retLag }).filter((mb) => mb.department_id != null && index.has(mb.department_id));
  const salFrom = monthStartOf(shiftMonth(m0s, -w.hire_salary_months + 1));
  const deptBase = depts.map(() => [0, 0]);
  const hireBase = depts.map(() => [0, 0]);
  for (const mb of rawMembers) {
    if (mb.base == null) continue;
    const i = index.get(mb.department_id!)!;
    deptBase[i][0] += mb.base;
    deptBase[i][1] += 1;
    if (mb.work_start >= salFrom) {
      hireBase[i][0] += mb.base;
      hireBase[i][1] += 1;
    }
  }
  const hireAllN = sum(hireBase.map((h) => h[1]));
  const hireAll = hireAllN ? sum(hireBase.map((h) => h[0])) / hireAllN : null;
  const baseAllN = sum(deptBase.map((b) => b[1]));
  const baseAll = baseAllN ? sum(deptBase.map((b) => b[0])) / baseAllN : 0;

  const departments: StateDepartment[] = depts.map((d, i) => {
    const avgBase = deptBase[i][1] ? deptBase[i][0] / deptBase[i][1] : baseAll;
    const hireSalary = hireBase[i][1] >= w.min_hires_salary ? hireBase[i][0] / hireBase[i][1] : hireAll ?? avgBase;
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      hc0: 0,
      mass0: mass0.get(d.id) ?? null,
      resignRate: denom[i] > 0 ? resign[i] / denom[i] : resignAll,
      otherRate: denom[i] > 0 ? other[i] / denom[i] : otherAll,
      hiresPerMonth: hireMonths.length ? entries[i] / hireMonths.length : 0,
      hireSalary,
      avgBase,
      level: null,
    };
  });

  const source: ResignSource = prob6 ? "LOGREG" : "TAUX";
  const members: StateMember[] = [];
  const infos: MemberInfo[] = [];
  for (const mb of rawMembers) {
    const i = index.get(mb.department_id!)!;
    departments[i].hc0 += 1;
    const cdd = mb.contract_type === "CDD" && mb.contract_end && mb.contract_end > asOf ? kOf(mb.contract_end, m0) : null;
    const rk = kOf(mb.retire_date, m0);
    const cddK = cdd != null && cdd >= 1 && cdd <= H ? cdd : null;
    const retK = rk != null && rk >= 1 && rk <= H ? rk : null;
    members.push({
      d: i,
      base: mb.base ?? departments[i].avgBase,
      p6: prob6 ? (prob6.get(mb.id) ?? null) : null,
      cdd: cddK,
      ret: retK,
      known: kOf(mb.known_exit, m0),
      grade: mb.grade,
    });
    infos.push({ ...mb, cddK, retK });
  }

  const cddRow = all<{ ends: number; exits: number }>(sqlite, "cdd", { fromDate: monthStartOf(shiftMonth(m0s, -w.cdd_months)), toDate: monthEndOf(shiftMonth(m0s, -1)) })[0];
  const qCdd = cddRow.ends >= be.cdd.min_cases ? cddRow.exits / cddRow.ends : be.cdd.q_prior;
  const dataStart = aggMonths.length ? monthStartOf(aggMonths[0]) : asOf;
  const retRow = all<{ reached: number; retired: number }>(sqlite, "retirement", { fromDate: dataStart, toDate: monthEndOf(shiftMonth(m0s, -1)), retAge })[0];
  const qRet = retRow.reached >= be.retirement.min_cases ? retRow.retired / retRow.reached : be.retirement.q_prior;

  let raise: number | null = null;
  const growth: number[] = [];
  for (const g of all<{ month: string; cur: number; prev: number }>(sqlite, "salaryGrowth", { from: shiftMonth(m0s, -11), to: m0s })) {
    if (!g.prev) continue;
    const rate = g.cur / g.prev - 1;
    if (g.month.endsWith("-01")) raise = rate;
    else growth.push(rate);
  }
  const state: WorkforceState = {
    asOf,
    month0: m0s,
    resignSource: source,
    qCdd,
    qRet,
    raise: raise ?? (bm ? bm.raise_fallback : 0),
    drift: growth.length ? sum(growth) / growth.length : 0,
    levelTotal: null,
    departments,
    members,
  };
  if (bm) levels(sqlite, state, bm, index, m0s);
  return { state, members: infos };
}

function levels(sqlite: Database.Database, state: WorkforceState, bm: MasseBundle, index: Map<number, number>, m0s: string) {
  const lo = shiftMonth(m0s, -bm.windows.level_months + 1);
  const base = new Map(all<{ month: string; department_id: number; base: number }>(sqlite, "baseMass", { from: lo, to: m0s }).map((b) => [`${b.month}|${b.department_id}`, b.base]));
  const agg = all<AggRow>(sqlite, "aggregates", { from: lo, to: m0s });
  const sums = state.departments.map(() => [0, 0]);
  const tot = new Map<string, [number, number]>();
  for (const a of agg) {
    const i = index.get(a.department_id);
    const b = base.get(`${a.month}|${a.department_id}`);
    if (i === undefined || b == null || !(b > 0) || !(a.payroll_mass > 0)) continue;
    const s = bm.season[monthIndex(a.month) % 12];
    sums[i][0] += Math.log(a.payroll_mass) - Math.log(b) - s;
    sums[i][1] += 1;
    const t = tot.get(a.month) ?? [0, 0];
    t[0] += a.payroll_mass;
    t[1] += b;
    tot.set(a.month, t);
  }
  state.departments.forEach((d, i) => (d.level = sums[i][1] ? sums[i][0] / sums[i][1] : null));
  const vals = [...tot.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .filter(([, [m, b]]) => m > 0 && b > 0)
    .map(([mo, [m, b]]) => Math.log(m) - Math.log(b) - bm.season[monthIndex(mo) % 12]);
  state.levelTotal = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

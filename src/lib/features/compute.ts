import type { CareerRow, ContractRow, Dataset, EmployeeRow } from "./dataset";
import { addMonths, monthOf, monthsBetween, toDay } from "./dates";
import { COUNTED_ABSENCE, FEATURES, FEATURE_INDEX } from "./spec";

export type FeatureVector = { employeeId: number; values: number[]; partial: boolean };
// naive : ignore recorded_at dans les variables (expérience de fuite hors ligne uniquement) ; population inchangée.
export type ComputeOptions = { naive?: boolean };

const STD_MONTH_DAYS = 21.67;
const LATE_THRESHOLD_MIN = 10;
const SHORT_EPISODE_MAX_DAYS = 3;
const MIN_ARRIVALS = 5;
const VOLUNTARY = new Set(["DEMISSION", "ABANDON"]);

const F = FEATURE_INDEX;
const nz = (s: string | null | undefined) => (s == null || s === "" ? null : s);
const isVisible = (date: string, rec: string, t: string, naive = false) => date <= t && (naive || rec <= t);

type MonthContext = {
  t: string;
  naive: boolean;
  active: Set<number>;
  managerAt: Map<number, number | null>;
  gradeAt: Map<number, string | null>;
  salaryAt: Map<number, number>;
  medianByKey: Map<string, number>;
  teamSize: Map<number, number>;
  teamExits: Map<number, number>;
};

// État à t d'un attribut porté par career_event (grade, manager) : valeur « nouvelle » du dernier
// événement visible ; sinon valeur « ancienne » du premier événement connu ; sinon valeur courante.
function stateAt(events: CareerRow[] | undefined, type: string, t: string, current: string | null, naive = false): string | null {
  let last: CareerRow | null = null;
  let first: CareerRow | null = null;
  for (const ev of events ?? []) {
    if (ev.type !== type) continue;
    if (!first) first = ev;
    if (isVisible(ev.date, ev.rec, t, naive) && (!last || ev.date >= last.date)) last = ev;
  }
  if (last) return nz(last.newValue);
  if (first) return nz(first.oldValue);
  return current;
}

function exitedBy(ds: Dataset, id: number, t: string): boolean {
  return (ds.exits.get(id) ?? []).some((x) => x.exitDate <= t && x.rec <= t);
}

export function isActiveAt(ds: Dataset, e: EmployeeRow, t: string): boolean {
  return e.hire <= t && !exitedBy(ds, e.id, t);
}

// Éligibilité à t (CONVENTIONS.md) ; renvoie le contrat en vigueur si éligible.
export function eligibleContract(ds: Dataset, e: EmployeeRow, t: string): ContractRow | null {
  if (e.hire > addMonths(t, -1)) return null;
  for (const x of ds.exits.get(e.id) ?? []) {
    if (x.rec > t) continue;
    if (x.exitDate <= t) return null;
    if (VOLUNTARY.has(x.reason) && (x.resignationDate ?? addMonths(x.exitDate, -1)) <= t) return null;
  }
  let contract: ContractRow | null = null;
  for (const c of ds.contracts.get(e.id) ?? []) if (c.start <= t) contract = c;
  if (!contract) return null;
  if (contract.type === "CDD") {
    if (contract.end && contract.end <= addMonths(t, 6)) return null;
  } else if (contract.type !== "CDI") return null;
  if (e.birth && addMonths(e.birth, 720) <= addMonths(t, 6)) return null;
  return contract;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const salaryKey = (e: EmployeeRow, grade: string | null) => `${e.jobFamily ?? ""}|${grade ?? ""}`;

function buildContext(ds: Dataset, t: string, naive = false): MonthContext {
  const month = monthOf(t);
  const minMonth = monthOf(addMonths(t, -24));
  const active = new Set<number>();
  const managerAt = new Map<number, number | null>();
  const gradeAt = new Map<number, string | null>();
  const salaryAt = new Map<number, number>();
  const salaries = new Map<string, number[]>();
  const teamSize = new Map<number, number>();
  const teamExits = new Map<number, number>();
  const t6 = addMonths(t, -6);

  for (const e of ds.employees) {
    if (e.hire > t) continue;
    const careers = ds.careers.get(e.id);
    const currentMgr = e.managerId != null ? (ds.byId.get(e.managerId)?.matricule ?? null) : null;
    const mgrMat = stateAt(careers, "CHANGEMENT_MANAGER", t, currentMgr, naive);
    const mgr = mgrMat != null ? (ds.idByMatricule.get(mgrMat) ?? null) : null;
    managerAt.set(e.id, mgr);
    const grade = stateAt(careers, "PROMOTION", t, nz(e.grade), naive);
    gradeAt.set(e.id, grade);

    const exited = exitedBy(ds, e.id, t);
    const exitedNaive = naive && !exited && (ds.exits.get(e.id) ?? []).some((x) => x.exitDate <= t);
    if (exited || exitedNaive) {
      const vol = (ds.exits.get(e.id) ?? []).some(
        (x) => VOLUNTARY.has(x.reason) && (naive || x.rec <= t) && x.exitDate > t6 && x.exitDate <= t,
      );
      if (vol && mgr != null) teamExits.set(mgr, (teamExits.get(mgr) ?? 0) + 1);
      if (exited) continue;
    }
    active.add(e.id);
    if (mgr != null && !exitedNaive) teamSize.set(mgr, (teamSize.get(mgr) ?? 0) + 1);

    let base: number | null = null;
    for (const p of ds.payroll.get(e.id) ?? []) if (p.month >= minMonth && p.month <= month && (naive || p.rec <= t) && p.base > 0) base = p.base;
    if (base != null) {
      salaryAt.set(e.id, base);
      const k = salaryKey(e, grade);
      let list = salaries.get(k);
      if (!list) salaries.set(k, (list = []));
      list.push(base);
    }
  }
  const medianByKey = new Map<string, number>();
  for (const [k, xs] of salaries) medianByKey.set(k, median(xs));
  return { t, naive, active, managerAt, gradeAt, salaryAt, medianByKey, teamSize, teamExits };
}

function parseGrade(g: string | null): number {
  const m = g ? /(\d+)/.exec(g) : null;
  return m ? Number(m[1]) : NaN;
}

function computeOne(ds: Dataset, ctx: MonthContext, e: EmployeeRow, contract: ContractRow): FeatureVector {
  const t = ctx.t;
  const tDay = toDay(t);
  const cal = ds.calendar;
  const v = new Array<number>(FEATURES.length).fill(NaN);

  const s3 = toDay(addMonths(t, -3)) + 1;
  const s6 = toDay(addMonths(t, -6)) + 1;
  const s12 = toDay(addMonths(t, -12)) + 1;
  const t12 = addMonths(t, -12);
  const hireDay = toDay(e.hire);
  const base = Math.max(hireDay, ds.dataStartDay ?? hireDay);
  const e3 = Math.max(s3, base);
  const e6 = Math.max(s6, base);
  const e12 = Math.max(s12, base);
  const partial = e12 > s12;

  // Carrière
  const tenure = monthsBetween(e.hire, t);
  const careers = (ds.careers.get(e.id) ?? []).filter((c) => isVisible(c.date, c.rec, t, ctx.naive));
  const lastOf = (type: string) => careers.filter((c) => c.type === type).at(-1)?.date ?? null;
  const inLast12 = (type: string) => careers.some((c) => c.type === type && c.date > t12);
  v[F.tenure_months] = tenure;
  v[F.contract_cdd] = contract.type === "CDD" ? 1 : 0;
  v[F.grade_level] = parseGrade(ctx.gradeAt.get(e.id) ?? null);
  const lastPromo = lastOf("PROMOTION");
  v[F.months_since_promotion] = lastPromo ? monthsBetween(lastPromo, t) : tenure;
  v[F.job_change_12m] = inLast12("CHANGEMENT_POSTE") ? 1 : 0;

  // Rémunération
  const salary = ctx.salaryAt.get(e.id);
  const med = ctx.medianByKey.get(salaryKey(e, ctx.gradeAt.get(e.id) ?? null));
  if (salary != null && med) v[F.compa_ratio] = salary / med;
  let raise = 1;
  for (const c of careers) {
    if (c.type !== "AUGMENTATION" || c.date <= t12) continue;
    const o = Number(c.oldValue);
    const n = Number(c.newValue);
    if (o > 0 && n > 0) raise *= n / o;
  }
  v[F.raise_pct_12m] = raise - 1;
  const lastRaise = lastOf("AUGMENTATION");
  v[F.months_since_raise] = lastRaise ? monthsBetween(lastRaise, t) : tenure;

  // Pointages et absences sur la fenêtre de 12 mois [e12, t], jours de santé masqués
  const L = Math.max(0, tDay - e12 + 1);
  const health = new Uint8Array(L);
  const justified = new Uint8Array(L);
  const attended = new Uint8Array(L);
  const absFrac = new Float64Array(L);
  let episodes12 = 0;
  let short12 = 0;
  const visibleEps = (ds.absences.get(e.id) ?? []).filter((ep) => ep.start <= tDay && (ctx.naive || ep.rec <= tDay) && ep.end >= e12);
  for (const ep of visibleEps) {
    if (!ep.health) continue;
    for (let d = Math.max(ep.start, e12); d <= Math.min(ep.end, tDay); d++) health[d - e12] = 1;
  }
  for (const ep of visibleEps) {
    if (ep.health) continue;
    const a = Math.max(ep.start, e12);
    const b = Math.min(ep.end, tDay);
    if (ep.category !== "ABSENCE_INJUSTIFIEE") for (let d = a; d <= b; d++) justified[d - e12] = 1;
    if (!COUNTED_ABSENCE.has(ep.category)) continue;
    const epWorking = cal.workingBetween(ep.start, ep.end);
    const scale = epWorking > 0 ? Math.min(1, ep.days / epWorking) : 0;
    let available = 0;
    for (let d = a; d <= b; d++) {
      absFrac[d - e12] += scale;
      if (cal.isWorking(d) && !health[d - e12]) available++;
    }
    if (!available) continue;
    episodes12++;
    if (ep.start >= e12 && ep.days <= SHORT_EPISODE_MAX_DAYS) short12++;
  }

  const bounds = Array.from({ length: 7 }, (_, m) => toDay(addMonths(t, -m)));
  const otByMonth = new Array<number>(6).fill(0);
  const availByMonth = new Array<number>(6).fill(0);
  let ot3 = 0;
  let late3 = 0;
  const arrivals: number[] = [];
  const att = ds.attendance.get(e.id);
  if (att) {
    let lo = 0;
    let hi = att.day.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (att.day[mid] < e6) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < att.day.length && att.day[k] <= tDay; k++) {
      const d = att.day[k];
      if (health[d - e12]) continue;
      attended[d - e12] = 1;
      let m = 0;
      while (m < 5 && d <= bounds[m + 1]) m++;
      otByMonth[m] += att.ot[k];
      if (d >= e3) {
        ot3 += att.ot[k];
        if (att.late[k] > LATE_THRESHOLD_MIN) late3++;
        if (att.cin[k] >= 0) arrivals.push(att.cin[k]);
      }
    }
  }

  let avail3 = 0;
  let avail12 = 0;
  let abs3 = 0;
  let abs12 = 0;
  let noBadge3 = 0;
  let absDays12 = 0;
  for (let d = e12; d <= tDay; d++) {
    const i = d - e12;
    if (!cal.isWorking(d) || health[i]) continue;
    const f = Math.min(1, absFrac[i]);
    avail12++;
    abs12 += f;
    absDays12 += f;
    if (d >= e6) {
      let m = 0;
      while (m < 5 && d <= bounds[m + 1]) m++;
      availByMonth[m]++;
    }
    if (d >= e3) {
      avail3++;
      abs3 += f;
      if (!attended[i] && !justified[i]) noBadge3++;
    }
  }

  const hasAttendance = ds.dataStartDay != null;
  if (hasAttendance && avail3 > 0) {
    v[F.overtime_h_avg_3m] = (ot3 / 60 / avail3) * STD_MONTH_DAYS;
    v[F.late_count_3m] = late3;
    v[F.no_badge_days_3m] = noBadge3;
  }
  if (arrivals.length >= MIN_ARRIVALS) {
    const mean = arrivals.reduce((s, x) => s + x, 0) / arrivals.length;
    v[F.arrival_std_min_3m] = Math.sqrt(arrivals.reduce((s, x) => s + (x - mean) ** 2, 0) / arrivals.length);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let m = 0; m < 6; m++) {
    const monthWorking = cal.workingBetween(bounds[m + 1] + 1, bounds[m]);
    if (!hasAttendance || availByMonth[m] === 0 || availByMonth[m] < 0.5 * monthWorking) continue;
    xs.push(-m);
    ys.push((otByMonth[m] / 60 / availByMonth[m]) * STD_MONTH_DAYS);
  }
  if (xs.length >= 3) {
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
    const my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    v[F.overtime_trend_6m] = den > 0 ? num / den : 0;
  }
  if (avail3 > 0) v[F.absence_rate_3m] = abs3 / avail3;
  if (avail12 > 0) v[F.absence_rate_12m] = abs12 / avail12;
  v[F.short_episodes_12m] = short12;
  v[F.bradford_12m] = episodes12 * episodes12 * absDays12;

  // Formation et évaluation
  let trainingHours = 0;
  let overdue = 0;
  for (const tr of ds.trainings.get(e.id) ?? []) {
    const done = tr.end ?? tr.start;
    if (tr.status === "TERMINEE" && done && done > t12 && done <= t) trainingHours += tr.hours;
    if (tr.mandatory && tr.due && tr.due < t && !(tr.status === "TERMINEE" && (!tr.end || tr.end <= t))) overdue = 1;
  }
  v[F.training_hours_12m] = trainingHours;
  v[F.mandatory_training_overdue] = overdue;
  const evals = (ds.evals.get(e.id) ?? []).filter((x) => isVisible(x.date, x.rec, t, ctx.naive));
  if (evals.length) {
    const last = evals[evals.length - 1];
    v[F.last_eval_score] = last.score;
    v[F.eval_delta] = evals.length >= 2 ? last.score - evals[evals.length - 2].score : 0;
    v[F.eval_missing] = 0;
  } else v[F.eval_missing] = 1;

  // Équipe (même manager à t)
  const mgr = ctx.managerAt.get(e.id);
  if (mgr != null) {
    const size = ctx.teamSize.get(mgr) ?? 1;
    const exits = ctx.teamExits.get(mgr) ?? 0;
    v[F.team_size] = size;
    v[F.team_exit_rate_6m] = exits / (size + exits);
  }
  v[F.manager_change_12m] = inLast12("CHANGEMENT_MANAGER") ? 1 : 0;

  for (let i = 0; i < FEATURES.length; i++) {
    const spec = FEATURES[i];
    let x = Number.isFinite(v[i]) ? v[i] : spec.impute;
    if (spec.cap != null) x = Math.min(x, spec.cap);
    v[i] = Math.round(x * 1e6) / 1e6 + 0;
  }
  return { employeeId: e.id, values: v, partial };
}

// Variables à la coupure t pour les salariés éligibles (tous, ou la liste donnée).
export function computeMonth(ds: Dataset, t: string, employeeIds?: number[], opts: ComputeOptions = {}): FeatureVector[] {
  const ctx = buildContext(ds, t, opts.naive ?? false);
  const targets = employeeIds ? employeeIds.map((id) => ds.byId.get(id)).filter((e): e is EmployeeRow => !!e) : ds.employees;
  const out: FeatureVector[] = [];
  for (const e of targets) {
    if (!ctx.active.has(e.id)) continue;
    const contract = eligibleContract(ds, e, t);
    if (contract) out.push(computeOne(ds, ctx, e, contract));
  }
  return out;
}

// Grade, salaire de base visible et médiane famille × grade à t, tels que les voient les variables (leviers du what-if).
export function payContext(ds: Dataset, t: string) {
  const ctx = buildContext(ds, t);
  return {
    grade: (id: number) => ctx.gradeAt.get(id) ?? null,
    salary: (id: number) => ctx.salaryAt.get(id) ?? null,
    median: (id: number, grade: string | null) => {
      const e = ds.byId.get(id);
      return e ? (ctx.medianByKey.get(salaryKey(e, grade)) ?? null) : null;
    },
  };
}

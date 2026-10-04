import type Database from "better-sqlite3";
import { addMonthsToMonth, fromDay, monthStart, monthsBetween, toDay } from "../../features/dates";

// Miroir exact de ml/training/panel.py (parité : golden-features.json du bundle).
export const FEATURE_PARAMS = { horizon_days: 120, team_window_days: 365, team_min_trainings: 5, margin_clip: 120, new_hire_months: 3 } as const;

export const TRAINING_FEATURES = [
  "days_to_due",
  "log_days_to_due",
  "started",
  "hours",
  "tenure_months",
  "log_tenure",
  "new_hire",
  "emp_past_n",
  "emp_late_rate",
  "emp_margin_days",
  "emp_overdue_other",
  "team_late_rate_12m",
  "overtime_h_3m",
  "open_mandatory_others",
  "due_summer",
] as const;
export type TrainingFeature = (typeof TRAINING_FEATURES)[number];
// null = manquante (imputée par le bundle)
export type TrainingFeatures = Record<TrainingFeature, number | null>;

export type MandatoryTraining = {
  id: number;
  employeeId: number;
  code: string;
  title: string;
  start: string | null;
  end: string | null;
  due: string;
  hours: number;
  status: string;
};

export type OpenTraining = MandatoryTraining & { managerId: number | null; lateCount: number; features: TrainingFeatures };

type Emp = { id: number; matricule: string; hire: string; managerId: number | null; departmentId: number | null };
type MgrEvent = { date: string; oldValue: string | null; newValue: string | null; rec: string };

const nz = (s: string | null | undefined) => (s == null || s === "" ? null : s);

export const completedBy = (tr: MandatoryTraining, d: string) => tr.status === "TERMINEE" && tr.end != null && tr.end <= d;
export const isLate = (tr: MandatoryTraining) => (completedBy(tr, tr.due) ? 0 : 1);

// Ouverte à t : échéance dans ]t, t + H], non abandonnée, pas terminée à t (TERMINEE sans date de fin : exclue).
export function isOpenAt(tr: MandatoryTraining, t: string): boolean {
  if (tr.status === "ABANDONNEE" || (tr.status === "TERMINEE" && tr.end == null)) return false;
  const d = toDay(tr.due) - toDay(t);
  return d > 0 && d <= FEATURE_PARAMS.horizon_days && !completedBy(tr, t);
}

export class TrainingSource {
  readonly employees = new Map<number, Emp>();
  readonly idByMatricule = new Map<string, number>();
  readonly exits = new Map<number, { date: string; rec: string }[]>();
  readonly mgrEvents = new Map<number, MgrEvent[]>();
  readonly byEmployee = new Map<number, MandatoryTraining[]>();
  readonly trainings: MandatoryTraining[];
  private overtime = new Map<number, number>();

  constructor(
    sqlite: Database.Database,
    readonly t: string,
  ) {
    for (const e of sqlite
      .prepare("SELECT id, matricule, hire_date AS hire, manager_id AS managerId, department_id AS departmentId FROM employee ORDER BY id")
      .all() as Emp[]) {
      this.employees.set(e.id, e);
      this.idByMatricule.set(e.matricule, e.id);
    }
    const push = <T>(m: Map<number, T[]>, k: number, v: T) => {
      const l = m.get(k);
      if (l) l.push(v);
      else m.set(k, [v]);
    };
    for (const x of sqlite
      .prepare("SELECT employee_id AS eid, exit_date AS date, substr(recorded_at, 1, 10) AS rec FROM exit_event ORDER BY employee_id, exit_date, id")
      .all() as { eid: number; date: string; rec: string }[])
      push(this.exits, x.eid, { date: x.date, rec: x.rec });
    for (const x of sqlite
      .prepare(
        `SELECT employee_id AS eid, date, old_value AS oldValue, new_value AS newValue, substr(recorded_at, 1, 10) AS rec
           FROM career_event WHERE type = 'CHANGEMENT_MANAGER' ORDER BY employee_id, date, id`,
      )
      .all() as (MgrEvent & { eid: number })[])
      push(this.mgrEvents, x.eid, x);
    this.trainings = sqlite
      .prepare(
        `SELECT id, employee_id AS employeeId, code, title, start_date AS start, end_date AS "end", due_date AS due, hours, status
           FROM training WHERE mandatory = 1 AND due_date IS NOT NULL ORDER BY employee_id, due_date, id`,
      )
      .all() as MandatoryTraining[];
    for (const tr of this.trainings) push(this.byEmployee, tr.employeeId, tr);
    const lo = monthStart(addMonthsToMonth(t.slice(0, 7), -2));
    for (const r of sqlite
      .prepare("SELECT employee_id AS eid, SUM(overtime_minutes) AS ot FROM attendance_daily WHERE overtime_minutes > 0 AND date >= ? AND date <= ? GROUP BY employee_id")
      .all(lo, t) as { eid: number; ot: number }[])
      this.overtime.set(r.eid, r.ot);
  }

  active(eid: number): boolean {
    const e = this.employees.get(eid);
    return !!e && e.hire <= this.t && !(this.exits.get(eid) ?? []).some((x) => x.date <= this.t && x.rec <= this.t);
  }

  // Même règle que stateAt (src/lib/features/compute.ts) pour CHANGEMENT_MANAGER
  managerAt(eid: number): number | null {
    let last: MgrEvent | null = null;
    let first: MgrEvent | null = null;
    for (const ev of this.mgrEvents.get(eid) ?? []) {
      if (!first) first = ev;
      if (ev.date <= this.t && ev.rec <= this.t && (!last || ev.date >= last.date)) last = ev;
    }
    let mat: string | null;
    if (last) mat = nz(last.newValue);
    else if (first) mat = nz(first.oldValue);
    else {
      const cur = this.employees.get(eid)?.managerId ?? null;
      return cur != null && this.employees.has(cur) ? cur : null;
    }
    return mat ? (this.idByMatricule.get(mat) ?? null) : null;
  }

  overtimeHours3m(eid: number): number {
    return (this.overtime.get(eid) ?? 0) / 60 / 3;
  }
}

// Par manager à t puis par membre actif : [formations obligatoires échues dans ]t - 365 j, t], dont en retard]
function teamMemberStats(src: TrainingSource): Map<number, Map<number, [number, number]>> {
  const lo = fromDay(toDay(src.t) - FEATURE_PARAMS.team_window_days);
  const out = new Map<number, Map<number, [number, number]>>();
  for (const [eid, trs] of src.byEmployee) {
    if (!src.active(eid)) continue;
    const mgr = src.managerAt(eid);
    if (mgr == null) continue;
    const sel = trs.filter((x) => lo < x.due && x.due <= src.t);
    if (!sel.length) continue;
    let m = out.get(mgr);
    if (!m) out.set(mgr, (m = new Map()));
    m.set(eid, [sel.length, sel.reduce((s, x) => s + isLate(x), 0)]);
  }
  return out;
}

function featuresFor(src: TrainingSource, tr: MandatoryTraining, teams: Map<number, [number, number]>, members: Map<number, Map<number, [number, number]>>) {
  const t = src.t;
  const eid = tr.employeeId;
  const e = src.employees.get(eid)!;
  const own = src.byEmployee.get(eid) ?? [];
  const past = own.filter((x) => x.due <= t);
  const nPast = past.length;
  let lates = 0;
  let marginSum = 0;
  const clip = FEATURE_PARAMS.margin_clip;
  for (const x of past) {
    lates += isLate(x);
    const ref = completedBy(x, t) ? x.end! : t;
    marginSum += Math.max(-clip, Math.min(clip, toDay(x.due) - toDay(ref)));
  }
  const overdueOther = own.some((x) => x.id !== tr.id && x.due <= t && !completedBy(x, t) && x.status !== "ABANDONNEE");
  const othersOpen = own.filter((x) => x.id !== tr.id && isOpenAt(x, t)).length;
  const mgr = src.managerAt(eid);
  let teamRate: number | null = null;
  const team = mgr != null ? teams.get(mgr) : undefined;
  if (team) {
    const mine = members.get(mgr!)?.get(eid) ?? [0, 0];
    const n = team[0] - mine[0];
    const lt = team[1] - mine[1];
    if (n >= FEATURE_PARAMS.team_min_trainings) teamRate = lt / n;
  }
  const tenure = monthsBetween(e.hire, t);
  const dtd = toDay(tr.due) - toDay(t);
  const features: TrainingFeatures = {
    days_to_due: dtd,
    log_days_to_due: Math.log(dtd),
    started: (tr.status === "EN_COURS" || tr.status === "TERMINEE") && tr.start != null && tr.start <= t ? 1 : 0,
    hours: tr.hours,
    tenure_months: tenure,
    log_tenure: Math.log1p(Math.max(tenure, 0)),
    new_hire: tenure < FEATURE_PARAMS.new_hire_months ? 1 : 0,
    emp_past_n: nPast,
    emp_late_rate: nPast ? lates / nPast : null,
    emp_margin_days: nPast ? marginSum / nPast : null,
    emp_overdue_other: overdueOther ? 1 : 0,
    team_late_rate_12m: teamRate,
    overtime_h_3m: src.overtimeHours3m(eid),
    open_mandatory_others: othersOpen,
    due_summer: [7, 8].includes(Number(tr.due.slice(5, 7))) ? 1 : 0,
  };
  return { managerId: mgr, lateCount: lates, features };
}

// Formations obligatoires ouvertes à t (salarié actif à t) et leurs variables visibles à t.
export function openTrainingsAt(sqlite: Database.Database, t: string, opts: { trainingIds?: Set<number> } = {}): OpenTraining[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error(`Date de coupure invalide : ${t}`);
  const src = new TrainingSource(sqlite, t);
  const members = teamMemberStats(src);
  const teams = new Map<number, [number, number]>();
  for (const [mgr, m] of members) {
    let n = 0;
    let lt = 0;
    for (const [a, b] of m.values()) {
      n += a;
      lt += b;
    }
    teams.set(mgr, [n, lt]);
  }
  const out: OpenTraining[] = [];
  for (const tr of src.trainings) {
    if (opts.trainingIds && !opts.trainingIds.has(tr.id)) continue;
    if (!isOpenAt(tr, t) || !src.active(tr.employeeId)) continue;
    out.push({ ...tr, ...featuresFor(src, tr, teams, members) });
  }
  return out;
}

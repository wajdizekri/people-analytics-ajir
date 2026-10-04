import type Database from "better-sqlite3";
import { WorkCalendar } from "./calendar";
import { toDay } from "./dates";
import { HEALTH_ABSENCE } from "./spec";

export type EmployeeRow = {
  id: number;
  matricule: string;
  hire: string;
  birth: string | null;
  grade: string | null;
  managerId: number | null;
  jobFamily: string | null;
  departmentId: number | null;
};
export type ContractRow = { start: string; end: string | null; type: string };
export type ExitRow = { exitDate: string; reason: string; resignationDate: string | null; rec: string };
export type CareerRow = { date: string; type: string; oldValue: string | null; newValue: string | null; rec: string };
export type PayrollRow = { month: string; base: number; rec: string };
export type AbsenceRow = { start: number; end: number; days: number; category: string; health: boolean; rec: number };
export type TrainingRow = { mandatory: boolean; start: string | null; end: string | null; due: string | null; hours: number; status: string };
export type EvalRow = { date: string; score: number; rec: string };
// check-in en minutes depuis minuit, -1 si absent
export type Attendance = { day: number[]; ot: number[]; late: number[]; cin: number[] };

export type Dataset = {
  from: string;
  to: string;
  employees: EmployeeRow[];
  byId: Map<number, EmployeeRow>;
  idByMatricule: Map<string, number>;
  contracts: Map<number, ContractRow[]>;
  exits: Map<number, ExitRow[]>;
  careers: Map<number, CareerRow[]>;
  payroll: Map<number, PayrollRow[]>;
  absences: Map<number, AbsenceRow[]>;
  trainings: Map<number, TrainingRow[]>;
  evals: Map<number, EvalRow[]>;
  attendance: Map<number, Attendance>;
  calendar: WorkCalendar;
  dataStartDay: number | null;
};

function group<T>(rows: (T & { eid: number })[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const { eid, ...rest } of rows) {
    let list = m.get(eid);
    if (!list) m.set(eid, (list = []));
    list.push(rest as unknown as T);
  }
  return m;
}

// Charge en mémoire les sources utiles aux coupures comprises dans [from, to].
// Sources de population (salariés, contrats, sorties, carrière, paie) : tous les salariés.
// Sources individuelles (pointages, absences, formations, évaluations) : filtrables par salarié.
export function loadDataset(
  sqlite: Database.Database,
  from: string,
  to: string,
  opts: { employeeId?: number; attendanceFrom?: string; payrollFrom?: string } = {},
): Dataset {
  const personal = opts.employeeId != null ? "AND employee_id = @eid" : "";
  const p = { from, to, eid: opts.employeeId ?? null, attFrom: opts.attendanceFrom ?? from };

  const employees = sqlite
    .prepare(
      `SELECT id, matricule, hire_date AS hire, birth_date AS birth, grade, manager_id AS managerId,
              job_family AS jobFamily, department_id AS departmentId FROM employee ORDER BY id`,
    )
    .all() as EmployeeRow[];

  const contracts = group<ContractRow>(
    sqlite
      .prepare("SELECT employee_id AS eid, start_date AS start, end_date AS \"end\", type FROM contract WHERE start_date <= @to ORDER BY employee_id, start_date, id")
      .all(p) as (ContractRow & { eid: number })[],
  );

  const exits = group<ExitRow>(
    sqlite
      .prepare(
        `SELECT employee_id AS eid, exit_date AS exitDate, reason, resignation_date AS resignationDate,
                substr(recorded_at, 1, 10) AS rec FROM exit_event ORDER BY employee_id, exit_date, id`,
      )
      .all() as (ExitRow & { eid: number })[],
  );

  const careers = group<CareerRow>(
    sqlite
      .prepare(
        `SELECT employee_id AS eid, date, type, old_value AS oldValue, new_value AS newValue,
                substr(recorded_at, 1, 10) AS rec FROM career_event ORDER BY employee_id, date, id`,
      )
      .all() as (CareerRow & { eid: number })[],
  );

  const payroll = group<PayrollRow>(
    sqlite
      .prepare(
        `SELECT employee_id AS eid, month, base_salary AS base, substr(recorded_at, 1, 10) AS rec
           FROM payroll_monthly WHERE month >= @pfrom AND month <= @pto ORDER BY employee_id, month`,
      )
      .all({ pfrom: (opts.payrollFrom ?? from).slice(0, 7), pto: to.slice(0, 7) }) as (PayrollRow & { eid: number })[],
  );

  const absRaw = sqlite
    .prepare(
      `SELECT employee_id AS eid, start_date AS s, end_date AS e, days, category, is_health AS h,
              substr(recorded_at, 1, 10) AS rec FROM absence_episode
        WHERE end_date >= @from AND start_date <= @to ${personal} ORDER BY employee_id, start_date, id`,
    )
    .all(p) as { eid: number; s: string; e: string; days: number; category: string; h: number; rec: string }[];
  const absences = group<AbsenceRow>(
    absRaw.map((r) => ({
      eid: r.eid,
      start: toDay(r.s),
      end: toDay(r.e),
      days: r.days,
      category: r.category,
      health: !!r.h || HEALTH_ABSENCE.has(r.category),
      rec: toDay(r.rec),
    })),
  );

  const trainings = group<TrainingRow>(
    (
      sqlite
        .prepare(
          `SELECT employee_id AS eid, mandatory, start_date AS start, end_date AS "end", due_date AS due, hours, status
             FROM training WHERE 1=1 ${personal} ORDER BY employee_id, id`,
        )
        .all(p) as (Omit<TrainingRow, "mandatory"> & { eid: number; mandatory: number })[]
    ).map((r) => ({ ...r, mandatory: !!r.mandatory })),
  );

  const evals = group<EvalRow>(
    sqlite
      .prepare(
        `SELECT employee_id AS eid, eval_date AS date, score, substr(recorded_at, 1, 10) AS rec
           FROM evaluation WHERE eval_date <= @to ${personal} ORDER BY employee_id, eval_date, id`,
      )
      .all(p) as (EvalRow & { eid: number })[],
  );

  // ordre de l'index sur la date : pas de tri, les jours restent croissants par salarié
  const attendance = new Map<number, Attendance>();
  const attStmt = sqlite
    .prepare(
      `SELECT employee_id, CAST(julianday(date) - 2440587.5 AS INTEGER), overtime_minutes, late_minutes,
              CASE WHEN check_in IS NULL OR check_in = '' THEN -1
                   ELSE CAST(substr(check_in, 1, 2) AS INTEGER) * 60 + CAST(substr(check_in, 4, 2) AS INTEGER) END
         FROM attendance_daily WHERE date >= @attFrom AND date <= @to ${personal} ORDER BY date`,
    )
    .raw(true);
  for (const row of attStmt.iterate(p) as Iterable<[number, number, number, number, number]>) {
    let cur = attendance.get(row[0]);
    if (!cur) attendance.set(row[0], (cur = { day: [], ot: [], late: [], cin: [] }));
    cur.day.push(row[1]);
    cur.ot.push(row[2] ?? 0);
    cur.late.push(row[3] ?? 0);
    cur.cin.push(row[4]);
  }

  const start = sqlite.prepare("SELECT min(date) AS d FROM attendance_daily").get() as { d: string | null };

  return {
    from,
    to,
    employees,
    byId: new Map(employees.map((e) => [e.id, e])),
    idByMatricule: new Map(employees.map((e) => [e.matricule, e.id])),
    contracts,
    exits,
    careers,
    payroll,
    absences,
    trainings,
    evals,
    attendance,
    calendar: WorkCalendar.load(sqlite, absRaw.reduce((m, r) => (r.s < m ? r.s : m), from), to),
    dataStartDay: start.d ? toDay(start.d) : null,
  };
}

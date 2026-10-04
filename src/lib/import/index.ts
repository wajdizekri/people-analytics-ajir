import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { EXIT_REASONS } from "@/db/schema";
import { getSetting, setSetting, smigResolver } from "@/lib/settings";
import { addDays, monthEnd, monthStart } from "@/lib/calendar";
import { employeeId, loadEmployees, processFile, type FileReport, type ImportCtx } from "./process";
import { IssueLog, RULES, isReject, reject, type Rule } from "./rules";
import * as S from "./schemas";
import { syncUsers, type ActivationLink, type UserSyncReport } from "./users";

export { RULES, type Rule } from "./rules";
export type { FileReport } from "./process";
export type { ActivationLink, UserSyncReport } from "./users";

export const IMPORT_FILES = [
  "departments.csv",
  "employees.csv",
  "contracts.csv",
  "exits.csv",
  "career_events.csv",
  "payroll.csv",
  "absences.csv",
  "trainings.csv",
  "evaluations.csv",
  "attendance.csv",
  "users.csv",
] as const;
const MANDATORY = ["departments.csv", "employees.csv"];
const BATCH_SIZE = 5000;
const VOLUME_TOLERANCE = 0.3;
const BULK_ATTENDANCE_BYTES = 16 * 1024 * 1024;
// au-delà (en jours), l'avancée de la fin des données par rapport à l'import précédent est signalée
const MAX_END_ADVANCE_DAYS = 45;

export type ImportStatus = "OK" | "BLOQUE" | "ECHEC";

export type ImportReport = {
  source: string;
  files: Record<string, FileReport>;
  rules: Partial<Record<Rule, number>>;
  quality: {
    score: number | null;
    threshold: number;
    rowScore: number;
    payrollMonth: string | null;
    activeCount: number;
    activeWithoutPayroll: number;
  };
  dataEndDate: string | null;
  users: UserSyncReport | null;
  durationMs: number;
  error?: string;
};

export type ImportResult = {
  batchId: number;
  status: ImportStatus;
  rowsOk: number;
  rowsRejected: number;
  qualityScore: number | null;
  dataEndDate: string | null;
  report: ImportReport;
  activationLinks: ActivationLink[];
};

type ContractSpan = { type: string; start: string; end: string | null };

async function importDepartments(ctx: ImportCtx): Promise<boolean> {
  const seen = new Set<string>();
  const up = ctx.sqlite.prepare("INSERT INTO department (code, name) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name");
  return processFile(
    ctx,
    "departments.csv",
    S.COLUMNS.departments,
    S.departmentRow,
    (r) => {
      if (seen.has(r.code)) return reject("DOUBLON", `Code département ${r.code} en double`);
      seen.add(r.code);
      return r;
    },
    (rows) => rows.forEach((r) => up.run(r.code, r.name)),
  );
}

type EmployeeLine = { matricule: string; manager: string | null; line: number; raw: string };

async function importEmployees(ctx: ImportCtx): Promise<EmployeeLine[] | null> {
  const file = "employees.csv";
  const deptIds = new Map(
    (ctx.sqlite.prepare("SELECT code, id FROM department").all() as { code: string; id: number }[]).map((d) => [d.code, d.id]),
  );
  const seen = new Set<string>();
  const accepted: EmployeeLine[] = [];
  const up = ctx.sqlite.prepare(
    `INSERT INTO employee (matricule, last_name, first_name, sex, birth_date, hire_date, department_id, job_family, job_title, grade, governorate, marital_status)
     VALUES (@matricule, @lastName, @firstName, @sex, @birthDate, @hireDate, @departmentId, @jobFamily, @jobTitle, @grade, @governorate, @maritalStatus)
     ON CONFLICT(matricule) DO UPDATE SET last_name = excluded.last_name, first_name = excluded.first_name, sex = excluded.sex,
       birth_date = excluded.birth_date, hire_date = excluded.hire_date, department_id = excluded.department_id,
       job_family = excluded.job_family, job_title = excluded.job_title, grade = excluded.grade,
       governorate = excluded.governorate, marital_status = excluded.marital_status`,
  );
  const ok = await processFile(
    ctx,
    file,
    S.COLUMNS.employees,
    S.employeeRow,
    (r, src) => {
      if (seen.has(r.matricule)) return reject("MATRICULE_DUPLIQUE", `Matricule ${r.matricule} déjà présent plus haut dans le fichier`);
      seen.add(r.matricule);
      const departmentId = deptIds.get(r.department_code);
      if (departmentId === undefined) return reject("DEPARTEMENT_INCONNU", `Département ${r.department_code} absent de departments.csv`);
      let grade = r.grade ?? null;
      if (grade !== null && !/^G[1-8]$/.test(grade)) {
        ctx.issues.add(file, src.line, "GRADE_INCONNU", `Grade « ${grade} » hors de G1 à G8 : grade laissé vide`, src.raw);
        grade = null;
      }
      accepted.push({ matricule: r.matricule, manager: r.manager_matricule ?? null, line: src.line, raw: src.raw });
      return {
        matricule: r.matricule,
        lastName: r.last_name,
        firstName: r.first_name,
        sex: r.sex ?? null,
        birthDate: r.birth_date ?? null,
        hireDate: r.hire_date,
        departmentId,
        jobFamily: r.job_family ?? null,
        jobTitle: r.job_title ?? null,
        grade,
        governorate: r.governorate ?? null,
        maritalStatus: r.marital_status ?? null,
      };
    },
    (rows) => rows.forEach((r) => up.run(r)),
  );
  return ok ? accepted : null;
}

// Seconde passe : rattachement au manager, puis rupture des cycles (le membre au plus petit matricule perd son manager).
function resolveManagers(ctx: ImportCtx, lines: EmployeeLine[]) {
  const file = "employees.csv";
  const { sqlite, issues, empIds } = ctx;
  const byMatricule = new Map(lines.map((l) => [l.matricule, l]));
  const setManager = sqlite.prepare("UPDATE employee SET manager_id = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const l of lines) {
      let managerId: number | null = null;
      if (l.manager === l.matricule) {
        issues.add(file, l.line, "CYCLE_HIERARCHIQUE", `${l.matricule} est déclaré comme son propre manager : rattachement supprimé`, l.raw);
      } else if (l.manager) {
        managerId = empIds.get(l.manager) ?? null;
        if (managerId === null) {
          issues.add(file, l.line, "MANAGER_INEXISTANT", `Manager ${l.manager} inexistant : ${l.matricule} importé sans manager`, l.raw);
        }
      }
      setManager.run(managerId, empIds.get(l.matricule));
    }

    const nodes = sqlite.prepare("SELECT id, matricule, manager_id FROM employee").all() as {
      id: number;
      matricule: string;
      manager_id: number | null;
    }[];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const done = new Set<number>();
    for (const start of nodes) {
      const path: number[] = [];
      const onPath = new Map<number, number>();
      let cur: number | null = start.id;
      while (cur !== null && !done.has(cur) && !onPath.has(cur)) {
        onPath.set(cur, path.length);
        path.push(cur);
        cur = byId.get(cur)?.manager_id ?? null;
      }
      if (cur !== null && onPath.has(cur)) {
        const cycle = path.slice(onPath.get(cur)).map((id) => byId.get(id)!);
        const victim = cycle.reduce((a, b) => (b.matricule < a.matricule ? b : a));
        victim.manager_id = null;
        setManager.run(null, victim.id);
        const src = byMatricule.get(victim.matricule);
        issues.add(
          file,
          src?.line ?? null,
          "CYCLE_HIERARCHIQUE",
          `Cycle hiérarchique ${cycle.map((n) => n.matricule).join(" → ")} → ${cycle[0].matricule} : ${victim.matricule} détaché de son manager`,
          src?.raw,
        );
      }
      path.forEach((id) => done.add(id));
    }
    issues.flush();
  })();
}

async function importContracts(ctx: ImportCtx) {
  const seen = new Set<string>();
  const upd = ctx.sqlite.prepare("UPDATE contract SET type = ?, end_date = ? WHERE employee_id = ? AND start_date = ?");
  const ins = ctx.sqlite.prepare("INSERT INTO contract (employee_id, type, start_date, end_date) VALUES (?, ?, ?, ?)");
  await processFile(
    ctx,
    "contracts.csv",
    S.COLUMNS.contracts,
    S.contractRow,
    (r) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      if (r.end_date && r.end_date < r.start_date)
        return reject("FIN_AVANT_DEBUT", `Fin de contrat ${r.end_date} antérieure au début ${r.start_date}`);
      const key = `${id}|${r.start_date}`;
      if (seen.has(key)) return reject("DOUBLON", `Contrat du ${r.start_date} en double pour ${r.matricule}`);
      seen.add(key);
      return { id, type: r.contract_type, start: r.start_date, end: r.end_date ?? null };
    },
    (rows) => {
      for (const r of rows) if (upd.run(r.type, r.end, r.id, r.start).changes === 0) ins.run(r.id, r.type, r.start, r.end);
    },
  );
}

async function importExits(ctx: ImportCtx) {
  const file = "exits.csv";
  const seen = new Set<number>();
  const upd = ctx.sqlite.prepare(
    "UPDATE exit_event SET exit_date = ?, reason = ?, resignation_date = ?, recorded_at = ? WHERE employee_id = ?",
  );
  const ins = ctx.sqlite.prepare(
    "INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, ?, ?, ?, ?)",
  );
  await processFile(
    ctx,
    file,
    S.COLUMNS.exits,
    S.exitRow,
    (r, src) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      const hire = ctx.employment.get(id)!.hire;
      if (r.exit_date < hire) return reject("SORTIE_AVANT_EMBAUCHE", `Sortie le ${r.exit_date} antérieure à l'embauche du ${hire}`);
      if (seen.has(id)) return reject("DOUBLON", `Sortie en double pour ${r.matricule}`);
      seen.add(id);
      let reason = r.exit_reason as (typeof EXIT_REASONS)[number] | undefined;
      if (!reason || !EXIT_REASONS.includes(reason)) {
        const what = reason ? `Motif de sortie « ${reason} » inconnu` : "Motif de sortie absent";
        ctx.issues.add(file, src.line, "SORTIE_SANS_MOTIF", `${what} : sortie importée avec le motif « Autre »`, src.raw);
        reason = "AUTRE";
      }
      const resignation = r.resignation_date ?? null;
      return { id, exitDate: r.exit_date, reason, resignation, recordedAt: r.recorded_at ?? resignation ?? r.exit_date };
    },
    (rows) => {
      for (const r of rows) {
        if (upd.run(r.exitDate, r.reason, r.resignation, r.recordedAt, r.id).changes === 0)
          ins.run(r.id, r.exitDate, r.reason, r.resignation, r.recordedAt);
      }
    },
  );
  if (ctx.files[file].present) {
    ctx.sqlite.exec("UPDATE employee SET exit_date = (SELECT MAX(x.exit_date) FROM exit_event x WHERE x.employee_id = employee.id)");
    loadEmployees(ctx);
  }
}

async function importCareer(ctx: ImportCtx) {
  const seen = new Set<string>();
  const upd = ctx.sqlite.prepare(
    "UPDATE career_event SET old_value = ?, new_value = ?, recorded_at = ? WHERE employee_id = ? AND date = ? AND type = ?",
  );
  const ins = ctx.sqlite.prepare(
    "INSERT INTO career_event (employee_id, date, type, old_value, new_value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  await processFile(
    ctx,
    "career_events.csv",
    S.COLUMNS.career_events,
    S.careerRow,
    (r) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      const key = `${id}|${r.date}|${r.event_type}`;
      if (seen.has(key)) return reject("DOUBLON", `Événement ${r.event_type} du ${r.date} en double pour ${r.matricule}`);
      seen.add(key);
      return { id, date: r.date, type: r.event_type, old: r.old_value ?? null, new: r.new_value ?? null, recordedAt: r.recorded_at ?? r.date };
    },
    (rows) => {
      for (const r of rows) {
        if (upd.run(r.old, r.new, r.recordedAt, r.id, r.date, r.type).changes === 0)
          ins.run(r.id, r.date, r.type, r.old, r.new, r.recordedAt);
      }
    },
  );
}

function contractAt(spans: ContractSpan[] | undefined, from: string, to: string): ContractSpan | null {
  let best: ContractSpan | null = null;
  for (const c of spans ?? []) if (c.start <= to && (c.end === null || c.end >= from) && (!best || c.start > best.start)) best = c;
  return best;
}

async function importPayroll(ctx: ImportCtx) {
  const smigAt = smigResolver(ctx.sqlite);
  const spans = new Map<number, ContractSpan[]>();
  for (const c of ctx.sqlite.prepare("SELECT employee_id AS id, type, start_date AS start, end_date AS end FROM contract").all() as (ContractSpan & {
    id: number;
  })[]) {
    const list = spans.get(c.id) ?? [];
    list.push(c);
    spans.set(c.id, list);
  }
  const seen = new Set<string>();
  const up = ctx.sqlite.prepare(
    `INSERT INTO payroll_monthly (employee_id, month, base_salary, gross_salary, overtime_hours, recorded_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, month) DO UPDATE SET base_salary = excluded.base_salary, gross_salary = excluded.gross_salary,
       overtime_hours = excluded.overtime_hours, recorded_at = excluded.recorded_at`,
  );
  await processFile(
    ctx,
    "payroll.csv",
    S.COLUMNS.payroll,
    S.payrollRow,
    (r, src) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      const key = `${id}|${r.month}`;
      if (seen.has(key)) return reject("DOUBLON", `Paie ${r.month} en double pour ${r.matricule}`);
      seen.add(key);
      const smig = smigAt(r.month);
      if (r.base_salary < smig) {
        const c = contractAt(spans.get(id), monthStart(r.month), monthEnd(r.month));
        if (!c || (c.type !== "SIVP" && c.type !== "STAGE"))
          return reject("SALAIRE_SOUS_SMIG", `Salaire de base ${r.base_salary} TND inférieur au SMIG (${smig} TND) en ${r.month}`);
      }
      if (r.gross_salary > 2 * r.base_salary)
        ctx.issues.add("payroll.csv", src.line, "PAIE_BRUT_INCOHERENT", `Salaire brut supérieur au double du salaire de base en ${r.month} : vérifiez le salaire de base dans AJIR`, src.raw);
      if (!ctx.payrollMonth || r.month > ctx.payrollMonth) ctx.payrollMonth = r.month;
      return [id, r.month, r.base_salary, r.gross_salary, r.overtime_hours ?? 0, r.recorded_at ?? monthEnd(r.month)] as const;
    },
    (rows) => rows.forEach((r) => up.run(...r)),
  );
}

async function importAbsences(ctx: ImportCtx) {
  const lag = Number(getSetting(ctx.sqlite, "lag_absence_days")) || 0;
  const seen = new Set<string>();
  const upd = ctx.sqlite.prepare(
    "UPDATE absence_episode SET end_date = ?, days = ?, category = ?, is_health = ?, recorded_at = ? WHERE employee_id = ? AND start_date = ?",
  );
  const ins = ctx.sqlite.prepare(
    "INSERT INTO absence_episode (end_date, days, category, is_health, recorded_at, employee_id, start_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  await processFile(
    ctx,
    "absences.csv",
    S.COLUMNS.absences,
    S.absenceRow,
    (r) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      if (r.end_date < r.start_date) return reject("FIN_AVANT_DEBUT", `Fin d'absence ${r.end_date} antérieure au début ${r.start_date}`);
      const e = ctx.employment.get(id)!;
      if (r.start_date < e.hire || (e.exit !== null && r.end_date > e.exit))
        return reject(
          "ABSENCE_HORS_EMPLOI",
          `Absence du ${r.start_date} au ${r.end_date} hors de la période d'emploi (${e.hire} - ${e.exit ?? "en poste"})`,
        );
      const key = `${id}|${r.start_date}`;
      if (seen.has(key)) return reject("DOUBLON", `Absence du ${r.start_date} en double pour ${r.matricule}`);
      seen.add(key);
      const isHealth = r.category === "MALADIE" || r.category === "MATERNITE" ? 1 : 0;
      return [r.end_date, r.days, r.category, isHealth, r.recorded_at ?? addDays(r.end_date, lag), id, r.start_date] as const;
    },
    (rows) => {
      for (const r of rows) if (upd.run(...r).changes === 0) ins.run(...r);
    },
  );
}

async function importTrainings(ctx: ImportCtx) {
  const seen = new Set<string>();
  const upd = ctx.sqlite.prepare(
    `UPDATE training SET title = ?, mandatory = ?, start_date = ?, end_date = ?, due_date = ?, hours = ?, status = ?
     WHERE employee_id = ? AND code = ? AND COALESCE(due_date, start_date, '') = ?`,
  );
  const ins = ctx.sqlite.prepare(
    `INSERT INTO training (title, mandatory, start_date, end_date, due_date, hours, status, employee_id, code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await processFile(
    ctx,
    "trainings.csv",
    S.COLUMNS.trainings,
    S.trainingRow,
    (r) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      if (r.start_date && r.end_date && r.end_date < r.start_date)
        return reject("FIN_AVANT_DEBUT", `Fin de formation ${r.end_date} antérieure au début ${r.start_date}`);
      const natural = r.due_date ?? r.start_date ?? "";
      const key = `${id}|${r.training_code}|${natural}`;
      if (seen.has(key)) return reject("DOUBLON", `Formation ${r.training_code} en double pour ${r.matricule}`);
      seen.add(key);
      const values = [
        r.title,
        r.mandatory ? 1 : 0,
        r.start_date ?? null,
        r.end_date ?? null,
        r.due_date ?? null,
        r.hours ?? 0,
        r.status,
        id,
        r.training_code,
      ] as const;
      return { values, natural };
    },
    (rows) => {
      for (const r of rows) if (upd.run(...r.values, r.natural).changes === 0) ins.run(...r.values);
    },
  );
}

async function importEvaluations(ctx: ImportCtx) {
  const lag = Number(getSetting(ctx.sqlite, "lag_evaluation_days")) || 0;
  const seen = new Set<string>();
  const upd = ctx.sqlite.prepare("UPDATE evaluation SET score = ?, recorded_at = ? WHERE employee_id = ? AND eval_date = ?");
  const ins = ctx.sqlite.prepare("INSERT INTO evaluation (score, recorded_at, employee_id, eval_date) VALUES (?, ?, ?, ?)");
  await processFile(
    ctx,
    "evaluations.csv",
    S.COLUMNS.evaluations,
    S.evaluationRow,
    (r) => {
      const id = employeeId(ctx, r.matricule);
      if (isReject(id)) return id;
      const key = `${id}|${r.eval_date}`;
      if (seen.has(key)) return reject("DOUBLON", `Évaluation du ${r.eval_date} en double pour ${r.matricule}`);
      seen.add(key);
      return [r.score, r.recorded_at ?? addDays(r.eval_date, lag), id, r.eval_date] as const;
    },
    (rows) => {
      for (const r of rows) if (upd.run(...r).changes === 0) ins.run(...r);
    },
  );
}

// Renvoie le dernier jour pointé accepté dans ce lot (null si aucun).
async function importAttendance(ctx: ImportCtx, today: string): Promise<string | null> {
  const file = "attendance.csv";
  const seen = new Map<number, Set<number>>();
  let last: string | null = null;
  const up = ctx.sqlite.prepare(
    `INSERT INTO attendance_daily (employee_id, date, check_in, check_out, worked_minutes, overtime_minutes, late_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, date) DO UPDATE SET check_in = excluded.check_in, check_out = excluded.check_out,
       worked_minutes = excluded.worked_minutes, overtime_minutes = excluded.overtime_minutes, late_minutes = excluded.late_minutes`,
  );
  // Gros export : l'index secondaire sur la date, mis à jour dans le désordre, multiplie les écritures par 5 ;
  // on le supprime pendant le chargement et on le reconstruit (tri unique) à la fin.
  const full = path.join(ctx.dir, file);
  const bulk = fs.existsSync(full) && fs.statSync(full).size >= BULK_ATTENDANCE_BYTES;
  if (bulk) ctx.sqlite.exec("DROP INDEX IF EXISTS attendance_date_idx");
  try {
    await processFile(
      ctx,
      file,
      S.COLUMNS.attendance,
      S.attendanceRow,
      (r, src) => {
        const id = employeeId(ctx, r.matricule);
        if (isReject(id)) return id;
        if (r.date > today) return reject("POINTAGE_FUTUR", `Pointage du ${r.date} postérieur à la date d'import (${today})`);
        const e = ctx.employment.get(id)!;
        if (r.date < e.hire || (e.exit !== null && r.date > e.exit))
          return reject("POINTAGE_HORS_EMPLOI", `Pointage du ${r.date} hors de la période d'emploi (${e.hire} - ${e.exit ?? "en poste"})`);
        const day = Number(r.date.slice(0, 4)) * 372 + Number(r.date.slice(5, 7)) * 31 + Number(r.date.slice(8, 10));
        let days = seen.get(id);
        if (!days) seen.set(id, (days = new Set()));
        if (days.has(day)) return reject("POINTAGE_DUPLIQUE", `Deuxième pointage le ${r.date} pour ${r.matricule}`);
        days.add(day);
        if (!r.check_out)
          ctx.issues.add(file, src.line, "POINTAGE_SANS_SORTIE", `Pointage du ${r.date} sans heure de sortie : importé sans sortie`, src.raw);
        if (!last || r.date > last) last = r.date;
        return [id, r.date, r.check_in, r.check_out ?? null, r.worked_minutes ?? 0, r.overtime_minutes ?? 0, r.late_minutes ?? 0] as const;
      },
      (rows) => rows.forEach((r) => up.run(...r)),
    );
  } finally {
    if (bulk) ctx.sqlite.exec("CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance_daily (date)");
  }
  return last;
}

// Fin des données = dernier pointage accepté de ce lot, sans jamais reculer (un lot correctif partiel ne la ramène pas
// en arrière) ; une valeur précédente postérieure à la date d'import est invalide et ignorée.
function nextDataEnd(ctx: ImportCtx, previous: string | null, batchLast: string | null, today: string): string | null {
  const prev = previous && /^\d{4}-\d{2}-\d{2}$/.test(previous) && previous <= today ? previous : null;
  if (prev && batchLast && batchLast > addDays(prev, MAX_END_ADVANCE_DAYS))
    ctx.issues.add(
      "attendance.csv",
      null,
      "FIN_DONNEES_AVANCE",
      `Fin des données portée du ${prev} au ${batchLast} (plus de ${MAX_END_ADVANCE_DAYS} jours) : vérifiez les dates de l'export`,
    );
  if (prev && (!batchLast || batchLast <= prev)) return prev;
  if (batchLast) return batchLast;
  const max = ctx.sqlite.prepare("SELECT MAX(date) AS d FROM attendance_daily WHERE date <= ?").get(today) as { d: string | null };
  return max.d;
}

function checkPayrollCompleteness(ctx: ImportCtx): { activeCount: number; missing: number } {
  const month = ctx.payrollMonth;
  if (!ctx.files["payroll.csv"]?.present || !month) return { activeCount: 0, missing: 0 };
  const params = { month, start: monthStart(month), end: monthEnd(month) };
  const employed = "e.hire_date <= @end AND (e.exit_date IS NULL OR e.exit_date >= @start)";
  const { n } = ctx.sqlite.prepare(`SELECT COUNT(*) AS n FROM employee e WHERE ${employed}`).get(params) as { n: number };
  const missing = ctx.sqlite
    .prepare(
      `SELECT e.matricule FROM employee e WHERE ${employed}
       AND NOT EXISTS (SELECT 1 FROM payroll_monthly p WHERE p.employee_id = e.id AND p.month = @month) ORDER BY e.matricule`,
    )
    .all(params) as { matricule: string }[];
  for (const m of missing) {
    ctx.issues.add("payroll.csv", null, "PAIE_INCOMPLETE", `Aucune paie en ${month} pour le collaborateur en poste ${m.matricule}`);
  }
  return { activeCount: n, missing: missing.length };
}

function checkVolumes(ctx: ImportCtx, batchId: number) {
  const prev = ctx.sqlite
    .prepare(
      "SELECT report_json FROM import_batch WHERE id < ? AND status IN ('OK','BLOQUE') AND report_json IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(batchId) as { report_json: string } | undefined;
  if (!prev) return;
  let prevFiles: Record<string, FileReport> = {};
  try {
    prevFiles = (JSON.parse(prev.report_json) as ImportReport).files ?? {};
  } catch {
    return;
  }
  for (const [file, cur] of Object.entries(ctx.files)) {
    const p = prevFiles[file];
    if (!cur.present || !p?.present || !p.rows) continue;
    const delta = (cur.rows - p.rows) / p.rows;
    if (Math.abs(delta) > VOLUME_TOLERANCE) {
      const pct = `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}\u00a0%`;
      ctx.issues.add(
        file,
        null,
        "VARIATION_VOLUME",
        `${cur.rows.toLocaleString("fr-FR")} lignes contre ${p.rows.toLocaleString("fr-FR")} au précédent import (${pct}) : vérifiez que l'export est complet`,
      );
    }
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}\u00a0%`;
const int = (n: number) => n.toLocaleString("fr-FR");
const rejectedLines = (n: number) => `${int(n)} ligne${n > 1 ? "s" : ""} rejetée${n > 1 ? "s" : ""}`;

function raiseAlert(sqlite: Database.Database, batchId: number, status: ImportStatus, res: ImportReport, rowsRejected: number) {
  if (status === "OK" && rowsRejected === 0) return;
  const top = (Object.entries(res.rules) as [Rule, number][])
    .filter(([r]) => RULES[r].severity === "REJET")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r, n]) => `${RULES[r].label} : ${int(n)}`)
    .join(" ; ");
  const title =
    status === "ECHEC"
      ? `Import AJIR ${res.source} en échec : aucune donnée importée`
      : status === "BLOQUE"
        ? `Import AJIR ${res.source} bloqué : qualité ${pct(res.quality.score ?? 0)} pour un seuil de ${pct(res.quality.threshold)}`
        : `Import AJIR ${res.source} : ${rejectedLines(rowsRejected)}`;
  const message =
    status === "ECHEC"
      ? `${res.error ?? "Cause non précisée."} Corrigez l'export AJIR puis relancez l'import depuis Santé des données ; les écrans gardent les données précédentes.`
      : `${rejectedLines(rowsRejected)}${top ? ` (${top})` : ""}.` +
        (status === "BLOQUE"
          ? " Le calcul des risques est suspendu et les écrans gardent le dernier calcul publié. Faites corriger l'export dans AJIR, puis importez-le de nouveau."
          : " Les autres lignes sont importées. Consultez le détail des rejets dans Santé des données et faites corriger les données dans AJIR.");
  sqlite
    .prepare(
      `INSERT INTO alert (type, severity, audience, title, message, link, dedup_key)
       VALUES ('DONNEES', ?, 'RH', ?, ?, '/data-health', ?) ON CONFLICT(dedup_key) DO NOTHING`,
    )
    .run(status === "OK" ? "ATTENTION" : "CRITIQUE", title, message, `import:${batchId}`);
}

export async function runImport(
  sqlite: Database.Database,
  dir: string,
  opts: { userId?: number; source?: string } = {},
): Promise<ImportResult> {
  const t0 = performance.now();
  const source = opts.source ?? path.basename(path.resolve(dir));
  const userId = opts.userId ?? null;
  const batchId = Number(sqlite.prepare("INSERT INTO import_batch (source, user_id) VALUES (?, ?)").run(source, userId).lastInsertRowid);
  const ctx: ImportCtx = {
    sqlite,
    dir,
    issues: new IssueLog(sqlite, batchId),
    files: {},
    empIds: new Map(),
    employment: new Map(),
    payrollMonth: null,
    batchSize: BATCH_SIZE,
  };
  const threshold = Number(getSetting(sqlite, "quality_threshold")) || 0;
  let error: string | undefined;
  let users: UserSyncReport | null = null;
  let links: ActivationLink[] = [];
  let payroll = { activeCount: 0, missing: 0 };
  let dataEndDate: string | null = getSetting(sqlite, "data_end_date") || null;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const missing = MANDATORY.filter((f) => !fs.existsSync(path.join(dir, f)));
    if (missing.length) throw new Error(`Fichier obligatoire absent : ${missing.join(", ")}. Ajoutez-le à l'export AJIR puis relancez l'import.`);
    if (!(await importDepartments(ctx))) throw new Error("departments.csv : en-tête invalide (colonne attendue absente ou séparateur « ; » manquant). Corrigez l'export puis relancez l'import.");
    const lines = await importEmployees(ctx);
    if (!lines) throw new Error("employees.csv : en-tête invalide (colonne attendue absente ou séparateur « ; » manquant). Corrigez l'export puis relancez l'import.");
    loadEmployees(ctx);
    resolveManagers(ctx, lines);
    await importContracts(ctx);
    await importExits(ctx);
    await importCareer(ctx);
    await importPayroll(ctx);
    await importAbsences(ctx);
    await importTrainings(ctx);
    await importEvaluations(ctx);
    const batchLast = await importAttendance(ctx, today);

    const end = nextDataEnd(ctx, dataEndDate, batchLast, today);
    if (end) {
      if (end !== dataEndDate) setSetting(sqlite, "data_end_date", end, opts.userId);
      dataEndDate = end;
    }
    sqlite
      .prepare("UPDATE employee SET status = CASE WHEN exit_date IS NOT NULL AND exit_date <= ? THEN 'SORTI' ELSE 'ACTIF' END")
      .run(dataEndDate ?? new Date().toISOString().slice(0, 10));
    payroll = checkPayrollCompleteness(ctx);
    checkVolumes(ctx, batchId);
    const synced = await syncUsers(ctx);
    if (synced) {
      users = synced.report;
      links = synced.links;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  ctx.issues.flushInTransaction();

  const rules: Partial<Record<Rule, number>> = {};
  for (const [file, byRule] of ctx.issues.counts) {
    const f = ctx.files[file];
    for (const [rule, n] of byRule) {
      rules[rule] = (rules[rule] ?? 0) + n;
      if (f) f.rules[rule] = n;
    }
  }
  const dataFiles = Object.entries(ctx.files).filter(([f, s]) => f !== "users.csv" && s.present);
  const fileScores = dataFiles.map(([, s]) => (s.headerError ? 0 : s.rows ? s.ok / s.rows : 1));
  const rowScore = fileScores.length ? fileScores.reduce((a, b) => a + b, 0) / fileScores.length : 0;
  const completeness = payroll.activeCount ? 1 - payroll.missing / payroll.activeCount : 1;
  const qualityScore = error ? null : Math.round(rowScore * completeness * 10000) / 10000;
  const status: ImportStatus = error ? "ECHEC" : qualityScore! < threshold ? "BLOQUE" : "OK";
  const rowsOk = Object.values(ctx.files).reduce((a, f) => a + f.ok, 0);
  const rowsRejected = Object.values(ctx.files).reduce((a, f) => a + f.rejected, 0);

  const report: ImportReport = {
    source,
    files: ctx.files,
    rules,
    quality: {
      score: qualityScore,
      threshold,
      rowScore: Math.round(rowScore * 10000) / 10000,
      payrollMonth: ctx.payrollMonth,
      activeCount: payroll.activeCount,
      activeWithoutPayroll: payroll.missing,
    },
    dataEndDate,
    users,
    durationMs: Math.round(performance.now() - t0),
    ...(error ? { error } : {}),
  };

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE import_batch SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), status = ?, rows_ok = ?, rows_rejected = ?,
         quality_score = ?, report_json = ? WHERE id = ?`,
      )
      .run(status, rowsOk, rowsRejected, qualityScore, JSON.stringify(report), batchId);
    raiseAlert(sqlite, batchId, status, report, rowsRejected);
    sqlite
      .prepare(
        "INSERT INTO audit_log (user_id, action, target_type, target_id, outcome, detail_json) VALUES (?, 'import.run', 'import_batch', ?, ?, ?)",
      )
      .run(
        userId,
        String(batchId),
        status === "ECHEC" ? "ECHEC" : "OK",
        JSON.stringify({
          source,
          status,
          rowsOk,
          rowsRejected,
          qualityScore,
          dataEndDate,
          users: users && {
            created: users.created,
            reactivated: users.reactivated,
            deactivated: users.deactivated,
            protectedAdmins: users.protectedAdmins,
          },
          error,
        }),
      );
  })();

  return { batchId, status, rowsOk, rowsRejected, qualityScore, dataEndDate, report, activationLinks: links };
}

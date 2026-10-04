import { z } from "zod";
import { ABSENCE_CATEGORIES, ROLES } from "@/db/schema";

const req = z.string().min(1);
const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const int0 = z.coerce.number().int().min(0);
const num0 = z.coerce.number().min(0);
const flag = z.enum(["0", "1"]).transform((v) => v === "1");
const recordedAt = z
  .string()
  .transform((s) => s.slice(0, 10))
  .pipe(date);

export const COLUMNS = {
  departments: ["code", "name"],
  employees: [
    "matricule",
    "last_name",
    "first_name",
    "sex",
    "birth_date",
    "hire_date",
    "department_code",
    "job_family",
    "job_title",
    "grade",
    "manager_matricule",
    "governorate",
    "marital_status",
  ],
  contracts: ["matricule", "contract_type", "start_date", "end_date"],
  exits: ["matricule", "exit_date", "exit_reason", "resignation_date", "recorded_at"],
  career_events: ["matricule", "date", "event_type", "old_value", "new_value", "recorded_at"],
  attendance: ["matricule", "date", "check_in", "check_out", "worked_minutes", "overtime_minutes", "late_minutes"],
  absences: ["matricule", "start_date", "end_date", "days", "category", "recorded_at"],
  payroll: ["matricule", "month", "base_salary", "gross_salary", "overtime_hours", "recorded_at"],
  trainings: ["matricule", "training_code", "title", "mandatory", "start_date", "end_date", "due_date", "hours", "status"],
  evaluations: ["matricule", "eval_date", "score", "recorded_at"],
  users: ["login", "matricule", "role", "email", "active"],
} as const;

export const DATE_FIELDS = new Set([
  "birth_date",
  "hire_date",
  "start_date",
  "end_date",
  "exit_date",
  "resignation_date",
  "recorded_at",
  "date",
  "due_date",
  "eval_date",
  "month",
]);

export const departmentRow = z.object({ code: req, name: req });

export const employeeRow = z.object({
  matricule: req,
  last_name: req,
  first_name: req,
  sex: z.enum(["F", "M"]).optional(),
  birth_date: date.optional(),
  hire_date: date,
  department_code: req,
  job_family: z.string().optional(),
  job_title: z.string().optional(),
  grade: z.string().optional(),
  manager_matricule: z.string().optional(),
  governorate: z.string().optional(),
  marital_status: z.string().optional(),
});

export const contractRow = z.object({
  matricule: req,
  contract_type: z.enum(["CDI", "CDD", "SIVP", "STAGE"]),
  start_date: date,
  end_date: date.optional(),
});

export const exitRow = z.object({
  matricule: req,
  exit_date: date,
  exit_reason: z.string().optional(),
  resignation_date: date.optional(),
  recorded_at: recordedAt.optional(),
});

export const careerRow = z.object({
  matricule: req,
  date,
  event_type: z.enum(["PROMOTION", "AUGMENTATION", "MUTATION", "CHANGEMENT_MANAGER", "CHANGEMENT_POSTE"]),
  old_value: z.string().optional(),
  new_value: z.string().optional(),
  recorded_at: recordedAt.optional(),
});

export const attendanceRow = z.object({
  matricule: req,
  date,
  check_in: time,
  check_out: time.optional(),
  worked_minutes: int0.optional(),
  overtime_minutes: int0.optional(),
  late_minutes: int0.optional(),
});

export const absenceRow = z.object({
  matricule: req,
  start_date: date,
  end_date: date,
  days: z.coerce.number().positive(),
  category: z.enum(ABSENCE_CATEGORIES),
  recorded_at: recordedAt.optional(),
});

export const payrollRow = z.object({
  matricule: req,
  month,
  base_salary: num0,
  gross_salary: num0,
  overtime_hours: num0.optional(),
  recorded_at: recordedAt.optional(),
});

export const trainingRow = z.object({
  matricule: req,
  training_code: req,
  title: req,
  mandatory: flag.optional(),
  start_date: date.optional(),
  end_date: date.optional(),
  due_date: date.optional(),
  hours: num0.optional(),
  status: z.enum(["PLANIFIEE", "EN_COURS", "TERMINEE", "ABANDONNEE"]),
});

export const evaluationRow = z.object({
  matricule: req,
  eval_date: date,
  score: z.coerce.number().min(1).max(5),
  recorded_at: recordedAt.optional(),
});

export const userRow = z.object({
  login: z.string().regex(/^[A-Za-z0-9._@-]{2,64}$/),
  matricule: z.string().optional(),
  role: z.enum(ROLES),
  email: z.email().optional(),
  active: flag.optional(),
});

import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";
import featuresContract from "../../../shared/features.json";
import { RH_ONLY_ACTIONS, managerVisibleGroup } from "@/lib/features/spec";
import { canSeeEmployee, ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import { forbidden, notFound } from "./errors";

export type RiskLevel = "FAIBLE" | "MOYEN" | "ELEVE";
export type ModelKind = "B0" | "LOGREG" | "LGBM";
export const CONTRACT_TYPES = ["CDI", "CDD", "SIVP", "STAGE"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const LEVEL_FILTERS = ["ELEVE", "MOYEN", "FAIBLE", "NON_EVALUE"] as const;

export const AGE_BANDS = {
  "moins-30": { label: "Moins de 30 ans", min: 0, max: 30 },
  "30-39": { label: "30 à 39 ans", min: 30, max: 40 },
  "40-49": { label: "40 à 49 ans", min: 40, max: 50 },
  "50-plus": { label: "50 ans et plus", min: 50, max: 150 },
} as const;
export const TENURE_BANDS = {
  "moins-1": { label: "Moins d'un an", min: 0, max: 1 },
  "1-3": { label: "1 à 3 ans", min: 1, max: 3 },
  "3-5": { label: "3 à 5 ans", min: 3, max: 5 },
  "5-10": { label: "5 à 10 ans", min: 5, max: 10 },
  "10-plus": { label: "10 ans et plus", min: 10, max: 100 },
} as const;
export type AgeBand = keyof typeof AGE_BANDS;
export type TenureBand = keyof typeof TENURE_BANDS;
const keysOf = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

type Contract = { groups: Record<string, { label_rh: string; label_manager: string; actionable: boolean }> };
const GROUPS = (featuresContract as Contract).groups;
export const groupLabel = (code: string, view: "RH" | "MANAGER") => GROUPS[code]?.[view === "RH" ? "label_rh" : "label_manager"] ?? code;

// ---------- Paramètres de requête ----------

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

// strict : une valeur invalide lève une ZodError (400 via withApi) ; lenient (pages) : la clé fautive est ignorée et signalée
export function parseQuery<S extends z.ZodType>(schema: S, params: RawParams, mode: "strict" | "lenient"): { data: z.output<S>; ignored: string[] } {
  const raw: Record<string, string> = {};
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params);
  for (const [k, v] of entries) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value != null && value.trim() !== "" && !(k in raw)) raw[k] = value;
  }
  if (mode === "strict") return { data: schema.parse(raw), ignored: [] };
  const ignored: string[] = [];
  for (let i = 0; i < 20; i++) {
    const res = schema.safeParse(raw);
    if (res.success) return { data: res.data, ignored };
    const keys = [...new Set(res.error.issues.map((iss) => String(iss.path[0] ?? "")))].filter((k) => k in raw);
    if (!keys.length) break;
    for (const k of keys) {
      delete raw[k];
      ignored.push(k);
    }
  }
  return { data: schema.parse({}), ignored };
}

export const populationShape = {
  departement: z.coerce.number().int().positive().optional(),
  contrat: z.enum(CONTRACT_TYPES).optional(),
  age: z.enum(keysOf(AGE_BANDS)).optional(),
  anciennete: z.enum(keysOf(TENURE_BANDS)).optional(),
};
export type PopulationFilters = { departement?: number; contrat?: ContractType; age?: AgeBand; anciennete?: TenureBand };

export const currentContractSql = (a: string) => `(SELECT c.type FROM contract c WHERE c.employee_id = ${a}.id ORDER BY c.start_date DESC, c.id DESC LIMIT 1)`;

// Filtre de population : périmètre (toujours) + filtres métier. Âge à la date de référence, ancienneté à la sortie si sorti.
export function populationWhere(ctx: AccessContext, f: PopulationFilters, ref: string, a = "e"): { clause: string; params: Record<string, unknown> } {
  const scope = scopeFilter(ctx, `${a}.id`);
  const parts = [scope.clause];
  const params: Record<string, unknown> = { ...scope.params, popRef: ref };
  if (f.departement) {
    parts.push(`${a}.department_id = @popDept`);
    params.popDept = f.departement;
  }
  if (f.contrat) {
    parts.push(`${currentContractSql(a)} = @popContract`);
    params.popContract = f.contrat;
  }
  if (f.age) {
    const age = `(julianday(@popRef) - julianday(${a}.birth_date)) / 365.25`;
    parts.push(`${a}.birth_date IS NOT NULL AND ${age} >= @popAgeMin AND ${age} < @popAgeMax`);
    params.popAgeMin = AGE_BANDS[f.age].min;
    params.popAgeMax = AGE_BANDS[f.age].max;
  }
  if (f.anciennete) {
    const ten = `(julianday(MIN(@popRef, COALESCE(${a}.exit_date, @popRef))) - julianday(${a}.hire_date)) / 365.25`;
    parts.push(`${ten} >= @popTenMin AND ${ten} < @popTenMax`);
    params.popTenMin = TENURE_BANDS[f.anciennete].min;
    params.popTenMax = TENURE_BANDS[f.anciennete].max;
  }
  return { clause: parts.map((p) => `(${p})`).join(" AND "), params };
}

// ---------- Référentiels ----------

export type PublishedRun = { id: number; asOf: string; modelVersion: string; modelKind: ModelKind; finishedAt: string | null };

// Seul le run pointé par current_run_id, et seulement s'il est PUBLIE
export function getPublishedRun(): PublishedRun | null {
  const { sqlite } = getDb();
  const id = Number(getSetting(sqlite, "current_run_id"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = sqlite
    .prepare(
      `SELECT r.id, r.as_of AS asOf, r.finished_at AS finishedAt, m.version AS modelVersion, m.kind AS modelKind
       FROM scoring_run r JOIN model_version m ON m.id = r.model_version_id WHERE r.id = ? AND r.status = 'PUBLIE'`,
    )
    .get(id) as PublishedRun | undefined;
  return row ?? null;
}

export function referenceDate(): string {
  const v = getSetting(getDb().sqlite, "data_end_date");
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
}

export type Option = { id: number; label: string };

// Manager : seulement les départements présents dans son périmètre
export function departmentOptions(ctx?: AccessContext): Option[] {
  if (!ctx || isGlobal(ctx)) return getDb().sqlite.prepare("SELECT id, name AS label FROM department ORDER BY name").all() as Option[];
  const scope = scopeFilter(ctx, "e.id");
  return getDb()
    .sqlite.prepare(`SELECT DISTINCT d.id, d.name AS label FROM department d JOIN employee e ON e.department_id = d.id WHERE ${scope.clause} ORDER BY d.name`)
    .all(scope.params) as Option[];
}

// Managers ayant au moins un collaborateur actif dans le périmètre
export function managerOptions(ctx: AccessContext): Option[] {
  const scope = scopeFilter(ctx, "m.id");
  const selfClause = ctx.role === "MANAGER" && ctx.employeeId != null ? " OR m.id = @self" : "";
  return getDb()
    .sqlite.prepare(
      `SELECT DISTINCT m.id, m.last_name || ' ' || m.first_name || ' (' || m.matricule || ')' AS label
       FROM employee e JOIN employee m ON m.id = e.manager_id
       WHERE e.status = 'ACTIF' AND (${scope.clause}${selfClause})
       ORDER BY label`,
    )
    .all({ ...scope.params, self: ctx.employeeId }) as Option[];
}

export function tenureMonths(hire: string, ref: string): number {
  const [hy, hm, hd] = hire.split("-").map(Number);
  const [ry, rm, rd] = ref.split("-").map(Number);
  return Math.max(0, (ry - hy) * 12 + (rm - hm) - (rd < hd ? 1 : 0));
}

export type Estimate = { type: "PROBABILITE"; prob6: number; lift: number } | { type: "SCORE_REGLES"; points: number };
// Un modèle B0 produit un nombre de points (stocké dans prob6), jamais une probabilité
export const toEstimate = (kind: ModelKind, prob6: number, lift: number): Estimate =>
  kind === "B0" ? { type: "SCORE_REGLES", points: prob6 } : { type: "PROBABILITE", prob6, lift };

// ---------- Liste ----------

export const employeeListSchema = z.object({
  ...populationShape,
  q: z.string().trim().max(100).optional(),
  niveau: z.enum(LEVEL_FILTERS).optional(),
  manager: z.coerce.number().int().positive().optional(),
  tri: z.enum(["risque", "probabilite", "nom", "matricule", "departement", "anciennete"]).default("risque"),
  ordre: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type EmployeeListQuery = z.output<typeof employeeListSchema>;
export const PAGE_SIZE = 25;

type ListRaw = {
  id: number;
  matricule: string;
  lastName: string;
  firstName: string;
  jobTitle: string | null;
  department: string | null;
  contractType: string | null;
  hireDate: string;
  level: RiskLevel | null;
  prob6: number | null;
  lift: number | null;
};

export type EmployeeRowManager = {
  id: number;
  matricule: string;
  lastName: string;
  firstName: string;
  jobTitle: string | null;
  department: string | null;
  contractType: string | null;
  tenureMonths: number;
  level: RiskLevel | null;
};
export type EmployeeRowRh = EmployeeRowManager & { estimate: Estimate | null };

type ListMeta = { total: number; page: number; pageSize: number; pageCount: number; referenceDate: string };
export type EmployeeListDto =
  | ({ view: "RH"; rows: EmployeeRowRh[]; run: { asOf: string; modelVersion: string; modelKind: ModelKind } | null } & ListMeta)
  | ({ view: "MANAGER"; rows: EmployeeRowManager[]; run: { asOf: string } | null } & ListMeta);

export function toManagerRow(r: ListRaw, ref: string): EmployeeRowManager {
  return {
    id: r.id,
    matricule: r.matricule,
    lastName: r.lastName,
    firstName: r.firstName,
    jobTitle: r.jobTitle,
    department: r.department,
    contractType: r.contractType,
    tenureMonths: tenureMonths(r.hireDate, ref),
    level: r.level,
  };
}

export function toRhRow(r: ListRaw, ref: string, kind: ModelKind | null): EmployeeRowRh {
  return {
    ...toManagerRow(r, ref),
    estimate: kind && r.prob6 != null && r.lift != null ? toEstimate(kind, r.prob6, r.lift) : null,
  };
}

const LEVEL_ORDER = "CASE p.level WHEN 'ELEVE' THEN 3 WHEN 'MOYEN' THEN 2 WHEN 'FAIBLE' THEN 1 ELSE 0 END";

export function listEmployees(ctx: AccessContext, q: EmployeeListQuery): EmployeeListDto {
  ensurePilotage(ctx, "employee.list");
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const run = getPublishedRun();
  const pop = populationWhere(ctx, q, ref);
  const where = [`e.status = 'ACTIF'`, pop.clause];
  const params: Record<string, unknown> = { ...pop.params, runId: run?.id ?? -1 };
  if (q.q) {
    where.push(`(e.last_name || ' ' || e.first_name LIKE @q ESCAPE '\\' OR e.first_name || ' ' || e.last_name LIKE @q ESCAPE '\\' OR e.matricule LIKE @q ESCAPE '\\')`);
    params.q = `%${q.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  }
  if (q.manager) {
    where.push("e.manager_id = @managerId");
    params.managerId = q.manager;
  }
  if (q.niveau === "NON_EVALUE") where.push("p.id IS NULL");
  else if (q.niveau) {
    where.push("p.level = @niveau");
    params.niveau = q.niveau;
  }

  const tri = !global && q.tri === "probabilite" ? "risque" : q.tri;
  const dir = (q.ordre ?? (tri === "risque" || tri === "probabilite" ? "desc" : "asc")) === "desc" ? "DESC" : "ASC";
  const inv = dir === "DESC" ? "ASC" : "DESC";
  const byName = "e.last_name COLLATE NOCASE ASC, e.first_name COLLATE NOCASE ASC";
  const orderBy = {
    risque: global ? `${LEVEL_ORDER} ${dir}, p.prob6 ${dir} NULLS LAST, ${byName}` : `${LEVEL_ORDER} ${dir}, ${byName}`,
    probabilite: `p.prob6 ${dir} NULLS LAST, ${byName}`,
    nom: `e.last_name COLLATE NOCASE ${dir}, e.first_name COLLATE NOCASE ${dir}`,
    matricule: `e.matricule ${dir}`,
    departement: `d.name ${dir}, ${byName}`,
    anciennete: `e.hire_date ${inv}, ${byName}`,
  }[tri];

  const from = `FROM employee e LEFT JOIN department d ON d.id = e.department_id
    LEFT JOIN prediction p ON p.run_id = @runId AND p.employee_id = e.id
    WHERE ${where.join(" AND ")}`;
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n ${from}`).get(params) as { n: number }).n;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(q.page, pageCount);
  const rows = sqlite
    .prepare(
      `SELECT e.id, e.matricule, e.last_name AS lastName, e.first_name AS firstName, e.job_title AS jobTitle, d.name AS department,
        ${currentContractSql("e")} AS contractType, e.hire_date AS hireDate, p.level, p.prob6, p.lift
       ${from} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as ListRaw[];

  const meta: ListMeta = { total, page, pageSize: PAGE_SIZE, pageCount, referenceDate: ref };
  if (global)
    return {
      view: "RH",
      rows: rows.map((r) => toRhRow(r, ref, run?.modelKind ?? null)),
      run: run ? { asOf: run.asOf, modelVersion: run.modelVersion, modelKind: run.modelKind } : null,
      ...meta,
    };
  return { view: "MANAGER", rows: rows.map((r) => toManagerRow(r, ref)), run: run ? { asOf: run.asOf } : null, ...meta };
}

// ---------- Fiche ----------

type Identity = {
  id: number;
  matricule: string;
  lastName: string;
  firstName: string;
  jobTitle: string | null;
  jobFamily: string | null;
  grade: string | null;
  department: string | null;
  manager: { id: number; name: string } | null;
  status: "ACTIF" | "SORTI";
  hireDate: string;
  exitDate: string | null;
  tenureMonths: number;
  contract: { type: string; startDate: string; endDate: string | null } | null;
  cddEndPlanned: string | null;
};
type Training = { title: string; mandatory: boolean; status: string; dueDate: string | null; endDate: string | null; hours: number };
type Evaluation = { date: string; score: number };
type CareerEvent = { date: string; type: string; oldValue: string | null; newValue: string | null };
type Factor = { group: string; contribution: number; rank: number; direction: "HAUSSE" | "BAISSE"; phraseRh: string | null; phraseManager: string | null };
type HistoryPoint = { asOf: string; level: RiskLevel; prob6: number; lift: number; kind: ModelKind };
type Reco = {
  id: number;
  actionCode: string;
  triggerGroup: string;
  status: "PROPOSEE" | "REALISEE" | "REJETEE";
  feedback: "PERTINENTE" | "NON_PERTINENTE" | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  interventionDate: string | null;
};

type DetailRaw = {
  referenceDate: string;
  identity: Identity;
  payroll: { month: string; baseSalary: number; grossSalary: number; overtimeHours: number }[];
  absencesByCategory: { category: string; days: number; episodes: number }[];
  healthDays: number;
  trainings: Training[];
  evaluations: Evaluation[];
  careerEvents: CareerEvent[];
  run: PublishedRun | null;
  prediction: { level: RiskLevel; prob6: number; lift: number } | null;
  factors: Factor[];
  history: HistoryPoint[];
  recommendations: Reco[];
};

type EstimationBase = { status: "AUCUN_RUN" } | { status: "NON_EVALUE"; asOf: string };
export type EstimationRh =
  | EstimationBase
  | {
      status: "OK";
      asOf: string;
      level: RiskLevel;
      modelVersion: string;
      modelKind: ModelKind;
      computedAt: string | null;
      estimate: Estimate;
      factors: { group: string; label: string; phrase: string; direction: "HAUSSE" | "BAISSE"; contribution: number }[];
      history: { asOf: string; level: RiskLevel; estimate: Estimate }[];
    };
export type EstimationManager =
  | EstimationBase
  | { status: "OK"; asOf: string; level: RiskLevel; factors: { phrase: string }[]; history: { asOf: string; level: RiskLevel }[] };

export type EmployeeDetailManager = {
  view: "MANAGER";
  referenceDate: string;
  employee: Identity;
  trainings: Training[];
  evaluations: Evaluation[];
  careerEvents: CareerEvent[];
  estimation: EstimationManager;
  recommendations: { id: number; actionCode: string; triggerGroup: string; triggerLabel: string; status: Reco["status"]; createdAt: string }[];
};
export type EmployeeDetailRh = {
  view: "RH";
  referenceDate: string;
  employee: Identity;
  compensation: { current: { month: string; baseSalary: number; grossSalary: number } | null; payroll: DetailRaw["payroll"] };
  absences: { byCategory: DetailRaw["absencesByCategory"]; healthDays: number };
  trainings: Training[];
  evaluations: Evaluation[];
  careerEvents: CareerEvent[];
  estimation: EstimationRh;
  recommendations: (Reco & { triggerLabel: string })[];
};
export type EmployeeDetailDto = EmployeeDetailRh | EmployeeDetailManager;

function loadDetail(employeeId: number): DetailRaw {
  const { sqlite } = getDb();
  const ref = referenceDate();
  const e = sqlite
    .prepare(
      `SELECT e.id, e.matricule, e.last_name AS lastName, e.first_name AS firstName, e.job_title AS jobTitle, e.job_family AS jobFamily,
        e.grade, d.name AS department, e.status, e.hire_date AS hireDate, e.exit_date AS exitDate,
        m.id AS managerId, m.last_name || ' ' || m.first_name AS managerName
       FROM employee e LEFT JOIN department d ON d.id = e.department_id LEFT JOIN employee m ON m.id = e.manager_id WHERE e.id = ?`,
    )
    .get(employeeId) as Omit<Identity, "manager" | "tenureMonths" | "contract" | "cddEndPlanned"> & { managerId: number | null; managerName: string | null };
  const contract = sqlite
    .prepare("SELECT type, start_date AS startDate, end_date AS endDate FROM contract WHERE employee_id = ? ORDER BY start_date DESC, id DESC LIMIT 1")
    .get(employeeId) as Identity["contract"] | undefined;
  const { managerId, managerName, ...base } = e;
  const until = e.exitDate && e.exitDate < ref ? e.exitDate : ref;
  const identity: Identity = {
    ...base,
    manager: managerId != null ? { id: managerId, name: managerName ?? "" } : null,
    tenureMonths: tenureMonths(e.hireDate, until),
    contract: contract ?? null,
    cddEndPlanned: contract?.type === "CDD" && contract.endDate && contract.endDate >= ref ? contract.endDate : null,
  };

  const window = { id: employeeId, ref };
  const payroll = sqlite
    .prepare(
      `SELECT month, base_salary AS baseSalary, gross_salary AS grossSalary, overtime_hours AS overtimeHours FROM payroll_monthly
       WHERE employee_id = @id AND month <= substr(@ref, 1, 7) ORDER BY month DESC LIMIT 12`,
    )
    .all(window) as DetailRaw["payroll"];
  const absencesByCategory = sqlite
    .prepare(
      `SELECT category, SUM(days) AS days, COUNT(*) AS episodes FROM absence_episode
       WHERE employee_id = @id AND is_health = 0 AND start_date > date(@ref, '-12 months') AND start_date <= @ref
       GROUP BY category ORDER BY days DESC`,
    )
    .all(window) as DetailRaw["absencesByCategory"];
  const healthDays =
    (
      sqlite
        .prepare("SELECT SUM(days) AS d FROM absence_episode WHERE employee_id = @id AND is_health = 1 AND start_date > date(@ref, '-12 months') AND start_date <= @ref")
        .get(window) as { d: number | null }
    ).d ?? 0;
  const trainings = (
    sqlite
      .prepare(
        `SELECT title, mandatory, status, due_date AS dueDate, end_date AS endDate, hours FROM training WHERE employee_id = ?
         ORDER BY COALESCE(end_date, due_date, start_date) DESC LIMIT 20`,
      )
      .all(employeeId) as (Omit<Training, "mandatory"> & { mandatory: number })[]
  ).map((t) => ({ ...t, mandatory: !!t.mandatory }));
  const evaluations = sqlite
    .prepare("SELECT eval_date AS date, score FROM evaluation WHERE employee_id = ? ORDER BY eval_date DESC LIMIT 10")
    .all(employeeId) as Evaluation[];
  const careerEvents = sqlite
    .prepare("SELECT date, type, old_value AS oldValue, new_value AS newValue FROM career_event WHERE employee_id = ? ORDER BY date DESC LIMIT 20")
    .all(employeeId) as CareerEvent[];

  const run = getPublishedRun();
  let prediction: DetailRaw["prediction"] = null;
  let factors: Factor[] = [];
  let history: HistoryPoint[] = [];
  if (run) {
    const p = sqlite.prepare("SELECT id, level, prob6, lift FROM prediction WHERE run_id = ? AND employee_id = ? ORDER BY id LIMIT 1").get(run.id, employeeId) as
      | { id: number; level: RiskLevel; prob6: number; lift: number }
      | undefined;
    if (p) {
      prediction = { level: p.level, prob6: p.prob6, lift: p.lift };
      factors = sqlite
        .prepare(
          `SELECT group_code AS "group", contribution, rank, direction, phrase_rh AS phraseRh, phrase_manager AS phraseManager
           FROM prediction_factor WHERE prediction_id = ? ORDER BY rank LIMIT 5`,
        )
        .all(p.id) as Factor[];
    }
    const points = sqlite
      .prepare(
        `SELECT p.as_of AS asOf, p.level, p.prob6, p.lift, m.kind, r.id AS runId FROM prediction p
         JOIN scoring_run r ON r.id = p.run_id AND r.status = 'PUBLIE' JOIN model_version m ON m.id = r.model_version_id
         WHERE p.employee_id = @id AND p.as_of > date(@asOf, '-12 months') AND p.as_of <= @asOf ORDER BY p.as_of, r.id`,
      )
      .all({ id: employeeId, asOf: run.asOf }) as (HistoryPoint & { runId: number })[];
    const byAsOf = new Map<string, HistoryPoint & { runId: number }>();
    for (const pt of points) {
      const prev = byAsOf.get(pt.asOf);
      if (!prev || prev.runId !== run.id) byAsOf.set(pt.asOf, pt);
    }
    history = [...byAsOf.values()].map(({ asOf, level, prob6, lift, kind }) => ({ asOf, level, prob6, lift, kind }));
  }

  const recommendations = sqlite
    .prepare(
      `SELECT r.id, r.action_code AS actionCode, r.trigger_group AS triggerGroup, r.status, r.feedback, r.comment, r.created_at AS createdAt,
        r.updated_at AS updatedAt, (SELECT MAX(i.date) FROM intervention i WHERE i.recommendation_id = r.id) AS interventionDate
       FROM recommendation r WHERE r.employee_id = ? ORDER BY r.created_at DESC, r.id DESC`,
    )
    .all(employeeId) as Reco[];

  return {
    referenceDate: ref,
    identity,
    payroll,
    absencesByCategory,
    healthDays,
    trainings,
    evaluations,
    careerEvents,
    run,
    prediction,
    factors,
    history,
    recommendations,
  };
}

export function toRhDetailDto(raw: DetailRaw): EmployeeDetailRh {
  const { run, prediction } = raw;
  let estimation: EstimationRh;
  if (!run) estimation = { status: "AUCUN_RUN" };
  else if (!prediction) estimation = { status: "NON_EVALUE", asOf: run.asOf };
  else
    estimation = {
      status: "OK",
      asOf: run.asOf,
      level: prediction.level,
      modelVersion: run.modelVersion,
      modelKind: run.modelKind,
      computedAt: run.finishedAt,
      estimate: toEstimate(run.modelKind, prediction.prob6, prediction.lift),
      factors: raw.factors.map((f) => ({
        group: f.group,
        label: groupLabel(f.group, "RH"),
        phrase: f.phraseRh ?? groupLabel(f.group, "RH"),
        direction: f.direction,
        contribution: f.contribution,
      })),
      history: raw.history.map((h) => ({ asOf: h.asOf, level: h.level, estimate: toEstimate(h.kind, h.prob6, h.lift) })),
    };
  const last = raw.payroll[0];
  return {
    view: "RH",
    referenceDate: raw.referenceDate,
    employee: raw.identity,
    compensation: { current: last ? { month: last.month, baseSalary: last.baseSalary, grossSalary: last.grossSalary } : null, payroll: raw.payroll },
    absences: { byCategory: raw.absencesByCategory, healthDays: raw.healthDays },
    trainings: raw.trainings,
    evaluations: raw.evaluations,
    careerEvents: raw.careerEvents,
    estimation,
    recommendations: raw.recommendations.map((r) => ({ ...r, triggerLabel: groupLabel(r.triggerGroup, "RH") })),
  };
}

// Liste blanche explicite : ni rémunération, ni probabilité, ni lift, ni phrase chiffrée, ni détail d'absences,
// ni catégorie de facteur ou action qui révèle un signal individuel (absences, salaire)
export function toManagerDetailDto(raw: DetailRaw): EmployeeDetailManager {
  const { run, prediction } = raw;
  const i = raw.identity;
  let estimation: EstimationManager;
  if (!run) estimation = { status: "AUCUN_RUN" };
  else if (!prediction) estimation = { status: "NON_EVALUE", asOf: run.asOf };
  else
    estimation = {
      status: "OK",
      asOf: run.asOf,
      level: prediction.level,
      factors: raw.factors
        .filter((f) => managerVisibleGroup(f.group, run.modelKind))
        .map((f) => ({ phrase: f.phraseManager ?? groupLabel(f.group, "MANAGER") })),
      history: raw.history.map((h) => ({ asOf: h.asOf, level: h.level })),
    };
  return {
    view: "MANAGER",
    referenceDate: raw.referenceDate,
    employee: {
      id: i.id,
      matricule: i.matricule,
      lastName: i.lastName,
      firstName: i.firstName,
      jobTitle: i.jobTitle,
      jobFamily: i.jobFamily,
      grade: i.grade,
      department: i.department,
      manager: i.manager ? { id: i.manager.id, name: i.manager.name } : null,
      status: i.status,
      hireDate: i.hireDate,
      exitDate: i.exitDate,
      tenureMonths: i.tenureMonths,
      contract: i.contract ? { type: i.contract.type, startDate: i.contract.startDate, endDate: i.contract.endDate } : null,
      cddEndPlanned: i.cddEndPlanned,
    },
    trainings: raw.trainings.map((t) => ({ ...t })),
    evaluations: raw.evaluations.map((e) => ({ ...e })),
    careerEvents: raw.careerEvents.filter((c) => c.type !== "AUGMENTATION").map((c) => ({ ...c })),
    estimation,
    recommendations: raw.recommendations
      .filter((r) => !RH_ONLY_ACTIONS.has(r.actionCode))
      .map((r) => ({
        id: r.id,
        actionCode: r.actionCode,
        triggerGroup: r.triggerGroup,
        triggerLabel: groupLabel(r.triggerGroup, "MANAGER"),
        status: r.status,
        createdAt: r.createdAt,
      })),
  };
}

export type AuditMeta = { source: "page" | "api"; ip?: string };

// 404 si inexistant, 403 (audité REFUSE) si hors périmètre ; chaque ouverture est auditée
export function getEmployeeDetail(ctx: AccessContext, employeeId: number, meta: AuditMeta): EmployeeDetailDto {
  const exists = getDb().sqlite.prepare("SELECT 1 AS ok FROM employee WHERE id = ?").get(employeeId);
  if (!exists) throw notFound("Collaborateur");
  const target = { type: "employee", id: employeeId };
  if (!canSeeEmployee(ctx, employeeId)) {
    audit(ctx.userId, "employee.view", target, "REFUSE", { source: meta.source }, meta.ip);
    throw forbidden();
  }
  const raw = loadDetail(employeeId);
  const global = isGlobal(ctx);
  audit(
    ctx.userId,
    "employee.view",
    target,
    "OK",
    { source: meta.source, view: global ? "RH" : "MANAGER", salary: global && raw.payroll.length > 0, score: raw.prediction != null },
    meta.ip,
  );
  return global ? toRhDetailDto(raw) : toManagerDetailDto(raw);
}

export type MeDto = {
  login: string;
  role: AccessContext["role"];
  employee: { id: number; matricule: string; name: string } | null;
  permissions: { compensation: boolean; probability: boolean; individualSignals: boolean; recommendations: boolean };
};

export function getMe(ctx: AccessContext): MeDto {
  const emp =
    ctx.employeeId != null
      ? (getDb().sqlite.prepare("SELECT id, matricule, last_name || ' ' || first_name AS name FROM employee WHERE id = ?").get(ctx.employeeId) as MeDto["employee"] | undefined)
      : undefined;
  const global = isGlobal(ctx);
  return {
    login: ctx.login,
    role: ctx.role,
    employee: emp ?? null,
    permissions: { compensation: global, probability: global, individualSignals: global, recommendations: global },
  };
}

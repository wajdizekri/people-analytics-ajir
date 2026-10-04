import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { dataEndDate } from "@/lib/settings";
import { TRAINING_GROUP_LABEL, type TrainingFactor, type TrainingLevel } from "@/lib/ai/training/model";
import { canSeeEmployee, ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";
import { MIN_GROUP_SIZE } from "./pilotage-metrics";

export const TRAINING_RECO_STATUSES = ["PROPOSEE", "REALISEE", "REJETEE"] as const;
export type TrainingRecoStatus = (typeof TRAINING_RECO_STATUSES)[number];

type Person = { id: number; matricule: string; name: string };
export type TrainingKpis = {
  dueLast12: number;
  onTimeRate: number | null; // formations obligatoires échues sur 12 mois terminées à l'échéance
  doneRate: number | null; // terminées, même en retard
  overdue: number;
  upcoming: number;
  high: number;
  medium: number;
  masked: boolean; // taux non affichés (périmètre manager < MIN_GROUP_SIZE)
};
export type UpcomingMonth = { month: string; total: number; atRisk: number };
export type OverdueRow = { trainingId: number; employee: Person; title: string; dueDate: string; daysLate: number };
export type RiskRowRh = {
  trainingId: number;
  employee: Person;
  department: string | null;
  title: string;
  code: string;
  dueDate: string;
  daysToDue: number;
  level: TrainingLevel;
  prob: number;
  factors: { label: string; phrase: string }[];
};
export type RiskRowManager = Omit<RiskRowRh, "prob" | "factors" | "department" | "code"> & { factors: string[] };
export type TrainingRecoRow = {
  id: number;
  scope: string;
  audience: "RH" | "MANAGER";
  title: string;
  rationale: string;
  priority: number;
  status: TrainingRecoStatus;
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  target: string | null;
};
type Common = { asOf: string | null; dataEnd: string | null; horizonDays: number; kpis: TrainingKpis; upcoming: UpcomingMonth[]; overdue: OverdueRow[]; recommendations: TrainingRecoRow[] };
export type TrainingOverviewRh = Common & { view: "RH"; modelVersion: string | null; atRisk: RiskRowRh[] };
export type TrainingOverviewManager = Common & { view: "MANAGER"; teamSize: number; atRisk: RiskRowManager[] };
export type TrainingOverview = TrainingOverviewRh | TrainingOverviewManager;

const HORIZON_DAYS = 120;
const LIST_LIMIT = 200;
const OPEN = "t.mandatory = 1 AND t.due_date IS NOT NULL AND t.status IN ('PLANIFIEE', 'EN_COURS') AND e.status = 'ACTIF'";

// Recommandations visibles et modifiables : RH toutes ; manager celles de son équipe ou de sa hiérarchie (audience MANAGER)
function recoScope(ctx: AccessContext): { clause: string; params: Record<string, unknown> } {
  if (isGlobal(ctx)) return { clause: "1=1", params: {} };
  const s = scopeFilter(ctx, "r.manager_id");
  if (ctx.role !== "MANAGER" || ctx.employeeId == null) return { clause: "1=0", params: {} };
  return { clause: `r.audience = 'MANAGER' AND (r.manager_id = @self OR ${s.clause})`, params: { ...s.params, self: ctx.employeeId } };
}

export function getTrainingOverview(ctx: AccessContext): TrainingOverview {
  ensurePilotage(ctx, "training.view");
  const { sqlite } = getDb();
  const rh = isGlobal(ctx);
  const scope = scopeFilter(ctx, "e.id");
  const dataEnd = dataEndDate(sqlite);
  const asOf = (sqlite.prepare("SELECT MAX(as_of) AS d FROM training_risk").get() as { d: string | null }).d;
  const ref = dataEnd ?? asOf ?? new Date().toISOString().slice(0, 10);
  const p = { ...scope.params, ref, asOf: asOf ?? "", horizon: HORIZON_DAYS };
  const name = "e.first_name || ' ' || e.last_name";

  const teamSize = (sqlite.prepare(`SELECT COUNT(*) AS n FROM employee e WHERE e.status = 'ACTIF' AND ${scope.clause}`).get(p) as { n: number }).n;
  const done = sqlite
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(t.status = 'TERMINEE' AND t.end_date <= t.due_date), 0) AS onTime, COALESCE(SUM(t.status = 'TERMINEE'), 0) AS done
         FROM training t JOIN employee e ON e.id = t.employee_id
        WHERE t.mandatory = 1 AND t.due_date > date(@ref, '-12 months') AND t.due_date <= @ref AND ${scope.clause}`,
    )
    .get(p) as { n: number; onTime: number; done: number };
  const masked = !rh && teamSize < MIN_GROUP_SIZE;
  const risk = sqlite
    .prepare(
      `SELECT COALESCE(SUM(r.level = 'ELEVE'), 0) AS high, COALESCE(SUM(r.level = 'MOYEN'), 0) AS medium
         FROM training_risk r JOIN employee e ON e.id = r.employee_id WHERE r.as_of = @asOf AND ${scope.clause}`,
    )
    .get(p) as { high: number; medium: number };

  const upcoming = sqlite
    .prepare(
      `SELECT substr(t.due_date, 1, 7) AS month, COUNT(*) AS total,
              COALESCE(SUM(EXISTS (SELECT 1 FROM training_risk r WHERE r.training_id = t.id AND r.as_of = @asOf AND r.level <> 'FAIBLE')), 0) AS atRisk
         FROM training t JOIN employee e ON e.id = t.employee_id
        WHERE ${OPEN} AND t.due_date > @ref AND t.due_date <= date(@ref, '+' || @horizon || ' days') AND ${scope.clause}
        GROUP BY month ORDER BY month`,
    )
    .all(p) as UpcomingMonth[];

  const overdue = (
    sqlite
      .prepare(
        `SELECT t.id AS trainingId, e.id, e.matricule, ${name} AS name, t.title, t.due_date AS dueDate,
                CAST(julianday(@ref) - julianday(t.due_date) AS INTEGER) AS daysLate
           FROM training t JOIN employee e ON e.id = t.employee_id
          WHERE ${OPEN} AND t.due_date <= @ref AND ${scope.clause}
          ORDER BY t.due_date, e.last_name LIMIT ${LIST_LIMIT}`,
      )
      .all(p) as (Person & { trainingId: number; title: string; dueDate: string; daysLate: number })[]
  ).map(({ id, matricule, name: n, ...r }) => ({ ...r, employee: { id, matricule, name: n } }));
  const overdueCount = (sqlite.prepare(`SELECT COUNT(*) AS n FROM training t JOIN employee e ON e.id = t.employee_id WHERE ${OPEN} AND t.due_date <= @ref AND ${scope.clause}`).get(p) as { n: number }).n;
  const upcomingCount = upcoming.reduce((s, u) => s + u.total, 0);

  const riskRows = sqlite
    .prepare(
      `SELECT t.id AS trainingId, e.id, e.matricule, ${name} AS name, d.name AS department, t.title, t.code, t.due_date AS dueDate,
              CAST(julianday(t.due_date) - julianday(r.as_of) AS INTEGER) AS daysToDue, r.level, r.prob, r.factors_json AS factorsJson
         FROM training_risk r JOIN training t ON t.id = r.training_id JOIN employee e ON e.id = r.employee_id
         LEFT JOIN department d ON d.id = e.department_id
        WHERE r.as_of = @asOf AND r.level <> 'FAIBLE' AND ${scope.clause}
        ORDER BY r.prob DESC, t.due_date, t.id LIMIT ${LIST_LIMIT}`,
    )
    .all(p) as (Person & { trainingId: number; department: string | null; title: string; code: string; dueDate: string; daysToDue: number; level: TrainingLevel; prob: number; factorsJson: string | null })[];
  const parseFactors = (s: string | null): TrainingFactor[] => (s ? (JSON.parse(s) as TrainingFactor[]) : []);

  const rs = recoScope(ctx);
  const recommendations = sqlite
      .prepare(
        `SELECT r.id, r.scope, r.audience, r.title, r.rationale, r.priority, r.status, r.comment, r.created_at AS createdAt, r.updated_at AS updatedAt,
                CASE WHEN r.scope = 'SALARIE' THEN (SELECT first_name || ' ' || last_name FROM employee WHERE id = r.employee_id)
                     WHEN r.scope = 'EQUIPE' THEN (SELECT 'Équipe de ' || first_name || ' ' || last_name FROM employee WHERE id = r.manager_id) END AS target
           FROM insight_recommendation r
          WHERE r.topic = 'FORMATION' AND ${rs.clause}
          ORDER BY CASE r.status WHEN 'PROPOSEE' THEN 0 ELSE 1 END, r.priority, r.created_at DESC, r.id DESC LIMIT ${LIST_LIMIT}`,
      )
      .all(rs.params) as TrainingRecoRow[];

  const kpis: TrainingKpis = {
    dueLast12: done.n,
    onTimeRate: masked || !done.n ? null : done.onTime / done.n,
    doneRate: masked || !done.n ? null : done.done / done.n,
    overdue: overdueCount,
    upcoming: upcomingCount,
    high: risk.high,
    medium: risk.medium,
    masked,
  };
  audit(ctx.userId, "training.view", { type: "training_risk", id: asOf }, "OK", { view: ctx.role, rows: riskRows.length });

  const common = { asOf, dataEnd, horizonDays: HORIZON_DAYS, kpis, upcoming, overdue, recommendations };
  if (rh) {
    const model = sqlite.prepare("SELECT version FROM topic_model WHERE topic = 'FORMATION' AND status = 'CHAMPION'").get() as { version: string } | undefined;
    return {
      view: "RH",
      ...common,
      modelVersion: model?.version ?? null,
      atRisk: riskRows.map(({ id, matricule, name: n, factorsJson, ...r }) => ({
        ...r,
        employee: { id, matricule, name: n },
        factors: parseFactors(factorsJson).map((f) => ({ label: TRAINING_GROUP_LABEL[f.group] ?? f.group, phrase: f.phraseRh })),
      })),
    };
  }
  // DTO manager : niveau et catégories de facteurs seulement (ni probabilité, ni contribution, ni phrase chiffrée)
  return {
    view: "MANAGER",
    ...common,
    teamSize,
    atRisk: riskRows.map((r) => ({
      trainingId: r.trainingId,
      employee: { id: r.id, matricule: r.matricule, name: r.name },
      title: r.title,
      dueDate: r.dueDate,
      daysToDue: r.daysToDue,
      level: r.level,
      factors: parseFactors(r.factorsJson).map((f) => TRAINING_GROUP_LABEL[f.group] ?? f.group),
    })),
  };
}

export const trainingRecoUpdateSchema = z
  .object({
    id: z.coerce.number({ error: "Recommandation non précisée : rechargez la page puis réessayez." }).int().positive("Recommandation non précisée : rechargez la page puis réessayez."),
    status: z.enum(TRAINING_RECO_STATUSES, { error: "Choisissez le nouveau statut de la recommandation." }),
    comment: z.string().trim().max(1000, "Commentaire trop long : 1\u00a0000 caractères au plus.").optional(),
  })
  .superRefine((v, c) => {
    if (v.status === "REJETEE" && (!v.comment || v.comment.length < 3))
      c.addIssue({ code: "custom", path: ["comment"], message: "Un commentaire est obligatoire pour rejeter une recommandation : expliquez la décision en quelques mots (3 caractères au moins)." });
  });
export type TrainingRecoUpdate = z.output<typeof trainingRecoUpdateSchema>;

export function updateTrainingRecommendation(ctx: AccessContext, input: TrainingRecoUpdate): { id: number; status: TrainingRecoStatus } {
  const action = "training.recommendation.update";
  const target = { type: "insight_recommendation", id: input.id };
  ensurePilotage(ctx, action, target);
  const { sqlite } = getDb();
  const reco = sqlite
    .prepare("SELECT id, audience, manager_id AS managerId, status FROM insight_recommendation WHERE id = ? AND topic = 'FORMATION'")
    .get(input.id) as { id: number; audience: string; managerId: number | null; status: TrainingRecoStatus } | undefined;
  if (!reco) throw notFound("Recommandation");
  const allowed =
    isGlobal(ctx) ||
    (ctx.role === "MANAGER" && reco.audience === "MANAGER" && reco.managerId != null && (reco.managerId === ctx.employeeId || canSeeEmployee(ctx, reco.managerId)));
  if (!allowed) {
    audit(ctx.userId, action, target, "REFUSE", { role: ctx.role });
    throw forbidden();
  }
  if (reco.status === input.status && !input.comment) throw new HttpError(409, "INCHANGE", "Le statut est déjà celui demandé.");
  sqlite
    .prepare(
      `UPDATE insight_recommendation SET status = @status, comment = COALESCE(@comment, comment),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = @userId WHERE id = @id`,
    )
    .run({ id: reco.id, status: input.status, comment: input.comment || null, userId: ctx.userId });
  audit(ctx.userId, action, target, "OK", { from: reco.status, to: input.status, comment: !!input.comment });
  return { id: reco.id, status: input.status };
}

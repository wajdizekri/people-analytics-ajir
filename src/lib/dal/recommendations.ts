import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { canSeeEmployee, isGlobal, type AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";
import { getPublishedRun, groupLabel, type RiskLevel } from "./employees";

export const RECO_STATUSES = ["PROPOSEE", "REALISEE", "REJETEE"] as const;
export type RecoStatus = (typeof RECO_STATUSES)[number];
export const RECO_FEEDBACKS = ["PERTINENTE", "NON_PERTINENTE"] as const;

export const recommendationListSchema = z.object({
  statut: z.enum(RECO_STATUSES).optional(),
  action: z
    .string()
    .regex(/^[A-Z0-9_]{2,40}$/)
    .optional(),
  departement: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type RecommendationListQuery = z.output<typeof recommendationListSchema>;

export type RecommendationRow = {
  id: number;
  employee: { id: number; matricule: string; name: string };
  department: string | null;
  level: RiskLevel | null;
  actionCode: string;
  triggerGroup: string;
  triggerLabel: string;
  status: RecoStatus;
  feedback: "PERTINENTE" | "NON_PERTINENTE" | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  interventionDate: string | null;
};
export type AdoptionKpis = {
  total: number;
  proposed: number;
  done: number;
  rejected: number;
  adoptionRate: number | null;
  feedbackCount: number;
  relevantRate: number | null;
  interventions: number;
};
export type RecommendationListDto = { rows: RecommendationRow[]; total: number; page: number; pageSize: number; pageCount: number; kpis: AdoptionKpis; actions: string[] };

const PAGE_SIZE = 25;

function requireGlobal(ctx: AccessContext, action: string, target?: { type: string; id?: number }) {
  if (isGlobal(ctx)) return;
  audit(ctx.userId, action, target, "REFUSE");
  throw forbidden();
}

export function listRecommendations(ctx: AccessContext, q: RecommendationListQuery): RecommendationListDto {
  requireGlobal(ctx, "recommendation.list");
  const { sqlite } = getDb();
  const run = getPublishedRun();
  const base: string[] = [];
  const params: Record<string, unknown> = { runId: run?.id ?? -1 };
  if (q.action) {
    base.push("r.action_code = @action");
    params.action = q.action;
  }
  if (q.departement) {
    base.push("e.department_id = @dept");
    params.dept = q.departement;
  }
  const from = "FROM recommendation r JOIN employee e ON e.id = r.employee_id";
  const whereKpi = base.length ? `WHERE ${base.join(" AND ")}` : "";
  const k = sqlite
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(r.status = 'PROPOSEE'), 0) AS proposed, COALESCE(SUM(r.status = 'REALISEE'), 0) AS done,
        COALESCE(SUM(r.status = 'REJETEE'), 0) AS rejected, COALESCE(SUM(r.feedback IS NOT NULL), 0) AS feedbackCount,
        COALESCE(SUM(r.feedback = 'PERTINENTE'), 0) AS relevant
       ${from} ${whereKpi}`,
    )
    .get(params) as { total: number; proposed: number; done: number; rejected: number; feedbackCount: number; relevant: number };
  const interventions = (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM intervention i JOIN recommendation r ON r.id = i.recommendation_id JOIN employee e ON e.id = r.employee_id ${whereKpi}`).get(params) as {
      n: number;
    }
  ).n;
  const kpis: AdoptionKpis = {
    total: k.total,
    proposed: k.proposed,
    done: k.done,
    rejected: k.rejected,
    adoptionRate: k.done + k.rejected > 0 ? k.done / (k.done + k.rejected) : null,
    feedbackCount: k.feedbackCount,
    relevantRate: k.feedbackCount > 0 ? k.relevant / k.feedbackCount : null,
    interventions,
  };

  const where = [...base];
  if (q.statut) {
    where.push("r.status = @statut");
    params.statut = q.statut;
  }
  const whereList = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n ${from} ${whereList}`).get(params) as { n: number }).n;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(q.page, pageCount);
  const rows = (
    sqlite
      .prepare(
        `SELECT r.id, e.id AS employeeId, e.matricule, e.last_name || ' ' || e.first_name AS name, d.name AS department, p.level,
          r.action_code AS actionCode, r.trigger_group AS triggerGroup, r.status, r.feedback, r.comment, r.created_at AS createdAt, r.updated_at AS updatedAt,
          (SELECT MAX(i.date) FROM intervention i WHERE i.recommendation_id = r.id) AS interventionDate
         ${from} LEFT JOIN department d ON d.id = e.department_id LEFT JOIN prediction p ON p.run_id = @runId AND p.employee_id = e.id
         ${whereList}
         ORDER BY CASE r.status WHEN 'PROPOSEE' THEN 0 ELSE 1 END,
           CASE p.level WHEN 'ELEVE' THEN 0 WHEN 'MOYEN' THEN 1 ELSE 2 END,
           CASE r.action_code WHEN 'ENTRETIEN' THEN 0 ELSE 1 END,
           r.created_at DESC, r.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as (Omit<RecommendationRow, "employee" | "triggerLabel"> & {
      employeeId: number;
      matricule: string;
      name: string;
    })[]
  ).map(({ employeeId, matricule, name, ...r }) => ({ ...r, employee: { id: employeeId, matricule, name }, triggerLabel: groupLabel(r.triggerGroup, "RH") }));
  const actions = (sqlite.prepare("SELECT DISTINCT action_code AS a FROM recommendation ORDER BY a").all() as { a: string }[]).map((r) => r.a);
  return { rows, total, page, pageSize: PAGE_SIZE, pageCount, kpis, actions };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de réalisation invalide : choisissez une date dans le calendrier.");

export const decideSchema = z
  .object({
    recommendationId: z.coerce.number().int().positive(),
    decision: z.enum(["REALISEE", "REJETEE"]),
    date: isoDate.optional(),
    comment: z.string().trim().max(1000, "Commentaire trop long : 1\u00a0000 caractères au plus.").optional(),
    feedback: z.enum(RECO_FEEDBACKS).optional(),
  })
  .superRefine((v, c) => {
    if (v.decision === "REJETEE" && (!v.comment || v.comment.length < 3))
      c.addIssue({ code: "custom", path: ["comment"], message: "Un commentaire est obligatoire pour rejeter une recommandation : expliquez la décision en quelques mots (3 caractères au moins)." });
    if (v.decision === "REALISEE") {
      if (!v.date) c.addIssue({ code: "custom", path: ["date"], message: "Indiquez la date de réalisation de l'action." });
      else if (v.date > new Date().toISOString().slice(0, 10)) c.addIssue({ code: "custom", path: ["date"], message: "La date de réalisation ne peut pas être dans le futur : indiquez la date à laquelle l'action a eu lieu." });
    }
  });
export type DecideInput = z.output<typeof decideSchema>;

export const feedbackSchema = z.object({
  recommendationId: z.coerce.number().int().positive(),
  feedback: z.enum(RECO_FEEDBACKS),
});
export type FeedbackInput = z.output<typeof feedbackSchema>;

type RecoRow = { id: number; employeeId: number; actionCode: string; status: RecoStatus };

function loadReco(ctx: AccessContext, id: number, action: string): RecoRow {
  const target = { type: "recommendation", id };
  requireGlobal(ctx, action, target);
  const reco = getDb()
    .sqlite.prepare("SELECT id, employee_id AS employeeId, action_code AS actionCode, status FROM recommendation WHERE id = ?")
    .get(id) as RecoRow | undefined;
  if (!reco) throw notFound("Recommandation");
  if (!canSeeEmployee(ctx, reco.employeeId)) {
    audit(ctx.userId, action, target, "REFUSE");
    throw forbidden();
  }
  return reco;
}

// Réalisée : crée une intervention datée (prise en compte au réentraînement). Rejetée : commentaire obligatoire.
export function decideRecommendation(ctx: AccessContext, input: DecideInput): { employeeId: number; interventionId: number | null } {
  const reco = loadReco(ctx, input.recommendationId, "recommendation.decide");
  if (reco.status !== "PROPOSEE") throw new HttpError(409, "DEJA_TRAITEE", "Cette recommandation a déjà été traitée.");
  const { sqlite } = getDb();
  const interventionId = sqlite.transaction(() => {
    const res = sqlite
      .prepare(
        `UPDATE recommendation SET status = @status, comment = @comment, feedback = COALESCE(@feedback, feedback),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = @userId WHERE id = @id AND status = 'PROPOSEE'`,
      )
      .run({ id: reco.id, status: input.decision, comment: input.comment ?? null, feedback: input.feedback ?? null, userId: ctx.userId });
    if (res.changes !== 1) throw new HttpError(409, "DEJA_TRAITEE", "Cette recommandation a déjà été traitée.");
    if (input.decision !== "REALISEE") return null;
    return Number(
      sqlite
        .prepare("INSERT INTO intervention (employee_id, recommendation_id, date, action_code, created_by) VALUES (?, ?, ?, ?, ?)")
        .run(reco.employeeId, reco.id, input.date, reco.actionCode, ctx.userId).lastInsertRowid,
    );
  })();
  audit(ctx.userId, "recommendation.decide", { type: "recommendation", id: reco.id }, "OK", {
    employeeId: reco.employeeId,
    decision: input.decision,
    date: input.date ?? null,
    feedback: input.feedback ?? null,
    interventionId,
  });
  return { employeeId: reco.employeeId, interventionId };
}

export function setRecommendationFeedback(ctx: AccessContext, input: FeedbackInput): { employeeId: number } {
  const reco = loadReco(ctx, input.recommendationId, "recommendation.feedback");
  getDb()
    .sqlite.prepare("UPDATE recommendation SET feedback = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ? WHERE id = ?")
    .run(input.feedback, ctx.userId, reco.id);
  audit(ctx.userId, "recommendation.feedback", { type: "recommendation", id: reco.id }, "OK", { employeeId: reco.employeeId, feedback: input.feedback });
  return { employeeId: reco.employeeId };
}

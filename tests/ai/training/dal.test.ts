import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { relanceKey, runStep, teamKey } from "@/lib/ai/training/step";
import { getTrainingOverview, trainingRecoUpdateSchema, updateTrainingRecommendation, type TrainingOverviewManager, type TrainingOverviewRh } from "@/lib/dal/ai-training";
import { auditOf, expectHttp, REF } from "../../fixtures/unit/dal-world";
import { promoteBundle, trainingWorld } from "./world";

let world: ReturnType<typeof trainingWorld>;
const sql = () => world.db.sqlite;
const recoId = (key: string) => (sql().prepare("SELECT id FROM insight_recommendation WHERE dedup_key = ?").get(key) as { id: number }).id;
const trainingId = (code: string) => (sql().prepare("SELECT id FROM training WHERE code = ?").get(code) as { id: number }).id;

// Aucune clé ni valeur sensible dans un DTO manager : probabilité, contribution, phrase chiffrée
function leaks(value: unknown, probs: number[], at = "$"): string[] {
  if (typeof value === "number") return probs.some((p) => Math.abs(p - value) < 1e-12) ? [`${at} = ${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, probs, `${at}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [...(/prob|contribution|phrase|modelVersion/i.test(k) ? [`${at}.${k}`] : []), ...leaks(v, probs, `${at}.${k}`)]);
  return [];
}

beforeAll(() => {
  world = trainingWorld("ai-training-dal");
  promoteBundle(sql());
  runStep(sql(), REF);
});
afterAll(() => world.db.close());

describe("DAL formations : vues par rôle", () => {
  it("RH : KPI, retards, échéances, risques avec probabilité et phrases chiffrées, toutes les recommandations", () => {
    const o = getTrainingOverview(world.w.ctx.rh) as TrainingOverviewRh;
    expect(o.view).toBe("RH");
    expect(o).toMatchObject({ asOf: REF, dataEnd: REF, modelVersion: "formation-logreg-v1-20260930" });
    expect(o.kpis).toMatchObject({ dueLast12: 2, onTimeRate: 0.5, doneRate: 0.5, overdue: 1, masked: false });
    expect(o.overdue.map((r) => [r.employee.id, r.daysLate])).toEqual([[world.w.e.T3, 46]]);
    expect(o.upcoming).toEqual([
      { month: "2025-07", total: 6, atRisk: 6 },
      { month: "2025-10", total: 1, atRisk: o.atRisk.some((r) => r.trainingId === trainingId("SST-T5")) ? 1 : 0 },
    ]);
    const s1 = o.atRisk.find((r) => r.trainingId === trainingId("SST-S1"))!;
    expect(s1).toMatchObject({ level: "ELEVE", daysToDue: 2, dueDate: "2025-07-02" });
    expect(s1.prob).toBeGreaterThan(0.5);
    expect(s1.factors[0]).toEqual({ label: "Échéance proche", phrase: "Échéance dans 2 jours, formation non commencée" });
    expect(o.recommendations.map((r) => r.scope).sort()).toEqual([...Array(6).fill("SALARIE"), "EQUIPE"].sort());
    expect(auditOf(sql(), "training.view").at(-1)).toMatchObject({ userId: world.w.users.rh, outcome: "OK" });
  });

  it("manager : sa hiérarchie seulement, niveau et catégories de facteurs, sans probabilité ni phrase chiffrée", () => {
    const { e, ctx } = world.w;
    const probs = (sql().prepare("SELECT prob FROM training_risk").all() as { prob: number }[]).map((r) => r.prob);
    const o = getTrainingOverview(ctx.mgr) as TrainingOverviewManager;
    expect(o.view).toBe("MANAGER");
    expect(new Set(o.atRisk.map((r) => r.employee.id))).toEqual(new Set([e.T1, e.T2, e.T3, e.SUB, e.S1]));
    expect(o.atRisk[0].factors).toContain("Échéance proche");
    expect(o.atRisk.flatMap((r) => r.factors).every((f) => !/\d/.test(f))).toBe(true);
    expect(leaks(o, probs)).toEqual([]);
    expect(o.kpis.masked).toBe(false);
    expect(o.recommendations.map((r) => r.audience)).toEqual(["MANAGER"]);
    expect(o.recommendations[0].title).toMatch(/^4 formations obligatoires de votre équipe/);

    const sub = getTrainingOverview(ctx.sub) as TrainingOverviewManager;
    expect(sub.atRisk.map((r) => r.employee.id)).toEqual([e.S1]);
    expect(sub.kpis).toMatchObject({ masked: true, onTimeRate: null, doneRate: null });
    expect(sub.recommendations).toEqual([]);
    expect(leaks(sub, probs)).toEqual([]);
    expect((getTrainingOverview(ctx.mgr2) as TrainingOverviewManager).atRisk.map((r) => r.employee.id)).toEqual([e.X1]);
    expect(getTrainingOverview(ctx.orphan).atRisk).toEqual([]);
  });

  it("ADMIN : 403 audité (séparation des tâches)", () => {
    expectHttp(() => getTrainingOverview(world.w.ctx.admin), 403);
    expect(auditOf(sql(), "training.view").at(-1)).toMatchObject({ userId: world.w.users.admin, outcome: "REFUSE" });
  });
});

describe("DAL formations : statut des recommandations (écriture auditée)", () => {
  it("RH : modifie une relance ; audit OK avec l'ancien et le nouveau statut", () => {
    const id = recoId(relanceKey(trainingId("SST-T1")));
    const input = trainingRecoUpdateSchema.parse({ id: String(id), status: "REALISEE", comment: "Relance faite par mail" });
    expect(updateTrainingRecommendation(world.w.ctx.rh, input)).toEqual({ id, status: "REALISEE" });
    expect(sql().prepare("SELECT status, comment, updated_by AS by FROM insight_recommendation WHERE id = ?").get(id)).toEqual({
      status: "REALISEE",
      comment: "Relance faite par mail",
      by: world.w.users.rh,
    });
    const a = auditOf(sql(), "training.recommendation.update").at(-1)!;
    expect(a).toMatchObject({ userId: world.w.users.rh, targetType: "insight_recommendation", targetId: String(id), outcome: "OK" });
    expect(JSON.parse(a.detail!)).toMatchObject({ from: "PROPOSEE", to: "REALISEE" });
    expectHttp(() => updateTrainingRecommendation(world.w.ctx.rh, { id, status: "REALISEE" }), 409);
  });

  it("validation : rejet sans commentaire refusé, statut inconnu refusé", () => {
    expect(trainingRecoUpdateSchema.safeParse({ id: 1, status: "REJETEE" }).success).toBe(false);
    expect(trainingRecoUpdateSchema.safeParse({ id: 1, status: "SUPPRIMEE" }).success).toBe(false);
    expect(trainingRecoUpdateSchema.safeParse({ id: "abc", status: "REALISEE" }).success).toBe(false);
  });

  it("manager : sa recommandation d'équipe oui ; relance RH ou équipe hors périmètre : 403 audité ; ADMIN 403 ; inconnue 404", () => {
    const { ctx, e, users } = world.w;
    const team = recoId(teamKey(e.MGR, REF));
    expect(updateTrainingRecommendation(ctx.mgr, { id: team, status: "REJETEE", comment: "Créneaux déjà planifiés" }).status).toBe("REJETEE");
    expectHttp(() => updateTrainingRecommendation(ctx.sub, { id: team, status: "PROPOSEE" }), 403);
    expectHttp(() => updateTrainingRecommendation(ctx.mgr2, { id: team, status: "PROPOSEE" }), 403);
    expectHttp(() => updateTrainingRecommendation(ctx.mgr, { id: recoId(relanceKey(trainingId("SST-T2"))), status: "REALISEE" }), 403);
    expectHttp(() => updateTrainingRecommendation(ctx.admin, { id: team, status: "PROPOSEE" }), 403);
    expectHttp(() => updateTrainingRecommendation(ctx.rh, { id: 999999, status: "PROPOSEE" }), 404);
    const refused = auditOf(sql(), "training.recommendation.update").filter((a) => a.outcome === "REFUSE").map((a) => a.userId);
    expect(refused).toEqual([users.sub, users.mgr2, users.mgr, users.admin]);
  });
});

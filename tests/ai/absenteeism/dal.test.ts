import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStep } from "@/lib/ai/absenteeism/step";
import { absRecoUpdateSchema, getAbsenteeismForecast, listAbsenteeismRecommendations, updateAbsenteeismRecommendation } from "@/lib/dal/ai-absenteeism";
import { HttpError } from "@/lib/dal/errors";
import { openDalDb } from "../../fixtures/unit/dal-world";
import { AS_OF, buildAbsWorld, installModel } from "./world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildAbsWorld>;
beforeAll(() => {
  db = openDalDb("ai-abs-dal");
  w = buildAbsWorld(db.sqlite);
  installModel(db.sqlite);
  runStep(db.sqlite, AS_OF);
});
afterAll(() => db.close());

const expectHttp = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
    return;
  }
  throw new Error(`HttpError ${status} attendue`);
};
const lastAudit = () =>
  db.sqlite.prepare("SELECT user_id AS userId, action, target_id AS targetId, outcome, detail_json AS detail FROM audit_log ORDER BY id DESC LIMIT 1").get() as {
    userId: number;
    action: string;
    targetId: string | null;
    outcome: string;
    detail: string | null;
  };
const recoId = (managerId: number, action: string) =>
  (db.sqlite.prepare("SELECT id FROM insight_recommendation WHERE manager_id = ? AND action_code = ?").get(managerId, action) as { id: number }).id;

describe("prévision : périmètre par rôle", () => {
  it("ADMIN refusé et tracé", () => {
    expectHttp(() => getAbsenteeismForecast(w.ctx.admin), 403);
    expect(lastAudit()).toMatchObject({ action: "absenteeism.forecast.view", outcome: "REFUSE" });
    expectHttp(() => listAbsenteeismRecommendations(w.ctx.admin), 403);
  });

  it("RH : entreprise et tous les départements, jamais d'équipe", () => {
    const d = getAbsenteeismForecast(w.ctx.rh);
    expect(d.view).toBe("RH");
    expect(d.asOf).toBe(AS_OF);
    expect(d.units.map((u) => u.key)).toEqual(["E", `D${w.com}`, `D${w.prod}`]);
    const e = d.units[0];
    expect(e.observed).toHaveLength(24);
    expect(e.observed[23].month).toBe("2025-08");
    expect(e.forecast.map((f) => f.horizon)).toEqual([1, 2, 3]);
    expect(d.recommendations.length).toBeGreaterThan(0);
  });

  it("MANAGER : sa seule équipe (au moins 5 personnes), mois de moins de 5 présents masqués", () => {
    const d = getAbsenteeismForecast(w.ctx.ma);
    expect(d.view).toBe("MANAGER");
    expect(d.units.map((u) => u.key)).toEqual([`T${w.e.MA}`]);
    expect(d.units[0].label).toBe("Équipe de NomMA PrenomMA");
    // l'équipe n'existe qu'à partir de juin 2023 : tous les mois de la fenêtre (sept. 2023 -> août 2025) ont 6 présents
    expect(d.units[0].observed.every((p) => p.rate != null)).toBe(true);
    expect(d.recommendations.every((r) => r.label === "Équipe de NomMA PrenomMA")).toBe(true);
  });

  it("MANAGER : un mois où l'équipe comptait moins de 5 présents n'a pas de taux", () => {
    const setHire = db.sqlite.prepare("UPDATE employee SET hire_date = ? WHERE id = ?");
    for (const k of ["A4", "A5", "A6"]) setHire.run("2024-06-01", w.e[k]);
    try {
      const obs = getAbsenteeismForecast(w.ctx.ma).units[0].observed;
      expect(obs.filter((p) => p.month < "2024-06").every((p) => p.rate == null)).toBe(true);
      expect(obs.filter((p) => p.month >= "2024-06").every((p) => p.rate != null)).toBe(true);
    } finally {
      for (const k of ["A4", "A5", "A6"]) setHire.run("2023-06-01", w.e[k]);
    }
  });

  it("MANAGER d'une équipe de moins de 5 personnes : aucune prévision", () => {
    const d = getAbsenteeismForecast(w.ctx.mb);
    expect(d.teamTooSmall).toBe(true);
    expect(d.units).toEqual([]);
    expect(d.recommendations).toEqual([]);
  });

  it("responsable de département : pas de prévision d'équipe (2 personnes) mais la recommandation de son département", () => {
    const d = getAbsenteeismForecast(w.ctx.dir);
    expect(d.teamTooSmall).toBe(true);
    expect(d.units).toEqual([]);
    expect(d.recommendations.map((r) => r.scope)).toContain("DEPARTEMENT");
    expect(d.recommendations.every((r) => r.scope === "DEPARTEMENT" && r.label === "Production")).toBe(true);
  });
});

describe("statut des recommandations (Server Action auditée)", () => {
  it("MANAGER : seulement « réalisée », seulement sur son périmètre", () => {
    const own = recoId(w.e.MA, "ANTICIPER_REMPLACEMENTS");
    const other = recoId(w.e.MC, "ECHANGER_ORGANISATION");
    expect(listAbsenteeismRecommendations(w.ctx.ma).find((r) => r.id === own)?.allowed).toEqual(["REALISEE"]);
    expectHttp(() => updateAbsenteeismRecommendation(w.ctx.ma, other, { status: "REALISEE" }), 403);
    expect(lastAudit()).toMatchObject({ action: "insight.recommendation.update", targetId: String(other), outcome: "REFUSE" });
    expectHttp(() => updateAbsenteeismRecommendation(w.ctx.ma, own, { status: "REJETEE" }), 409);
    updateAbsenteeismRecommendation(w.ctx.ma, own, { status: "REALISEE" });
    expect(lastAudit()).toMatchObject({ userId: w.ctx.ma.userId, targetId: String(own), outcome: "OK" });
    expect(JSON.parse(lastAudit().detail!)).toMatchObject({ from: "PROPOSEE", to: "REALISEE" });
    expect(listAbsenteeismRecommendations(w.ctx.ma).find((r) => r.id === own)).toMatchObject({ status: "REALISEE", allowed: [] });
    expectHttp(() => updateAbsenteeismRecommendation(w.ctx.ma, own, { status: "REALISEE" }), 409);
  });

  it("RH : tout statut, commentaire enregistré ; ressource inexistante 404 ; ADMIN refusé", () => {
    const id = recoId(w.e.MC, "ECHANGER_ORGANISATION");
    updateAbsenteeismRecommendation(w.ctx.rh, id, absRecoUpdateSchema.parse({ status: "REJETEE", comment: "  Déjà traité en réunion d'équipe " }));
    const row = db.sqlite.prepare("SELECT status, comment, updated_by AS by FROM insight_recommendation WHERE id = ?").get(id);
    expect(row).toEqual({ status: "REJETEE", comment: "Déjà traité en réunion d'équipe", by: w.ctx.rh.userId });
    updateAbsenteeismRecommendation(w.ctx.rh, id, { status: "PROPOSEE" });
    expectHttp(() => updateAbsenteeismRecommendation(w.ctx.rh, 999999, { status: "REALISEE" }), 404);
    expectHttp(() => updateAbsenteeismRecommendation(w.ctx.admin, id, { status: "REALISEE" }), 403);
    expect(() => absRecoUpdateSchema.parse({ status: "SUPPRIMEE" })).toThrow();
  });
});

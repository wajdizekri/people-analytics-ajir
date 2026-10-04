import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStep } from "@/lib/ai/workforce/step";
import { getWorkforceForecast, updateWorkforceRecommendation, workforceRecoUpdateSchema, workforceScenarioSchema } from "@/lib/dal/ai-workforce";
import { HttpError } from "@/lib/dal/errors";
import { parseQuery } from "@/lib/dal/employees";
import { setSetting } from "@/lib/settings";
import type { SeedResult } from "../../../scripts/seed-dev-ui";
import { adminCtx, cleanupDb, db, managerCtx, rhCtx, setupWorkforceDb } from "./setup";

let file = "";
let seed: SeedResult;

beforeAll(async () => {
  ({ file, seed } = await setupWorkforceDb("roles"));
  setSetting(db(), "budget_masse_salariale_2026", "100000");
  runStep(db(), "2026-08-31");
});
afterAll(() => cleanupDb(file));

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
  db().prepare("SELECT action, target_id AS targetId, outcome, detail_json AS detail FROM audit_log ORDER BY id DESC LIMIT 1").get() as {
    action: string;
    targetId: string | null;
    outcome: string;
    detail: string | null;
  };
const scenario = (raw: Record<string, string>) => parseQuery(workforceScenarioSchema, raw, "lenient");
const counts = () => db().prepare("SELECT (SELECT COUNT(*) FROM forecast) AS f, (SELECT COUNT(*) FROM insight_recommendation) AS r").get();

describe("prévisions d'effectifs : accès réservé à la RH", () => {
  it("ADMIN et MANAGER sont refusés (403) et le refus est audité", () => {
    for (const ctx of [adminCtx(seed), managerCtx(seed)]) {
      expectHttp(() => getWorkforceForecast(ctx, {}), 403);
      expect(lastAudit()).toMatchObject({ action: "workforce.view", outcome: "REFUSE" });
    }
  });

  it("la RH voit la projection de référence, la masse salariale et les recommandations ; la consultation est auditée", () => {
    const v = getWorkforceForecast(rhCtx(seed), {});
    expect(v.status).toBe("OK");
    if (v.status !== "OK") return;
    expect(v.asOf).toBe("2026-08-31");
    expect(v.months).toHaveLength(12);
    expect(v.scenario.isReference).toBe(true);
    expect(v.total.mass12).not.toBeNull();
    expect(v.focus.series.hc).toHaveLength(12);
    expect(v.focus.series.referenceHc.map((p) => p.value)).toEqual(v.focus.series.hc.map((p) => p.value));
    expect(v.recommendations.length).toBeGreaterThan(0);
    expect(v.budget?.year).toBe(2026);
    expect(lastAudit()).toMatchObject({ action: "workforce.view", outcome: "OK", targetId: "2026-08-31" });
  });

  it("un scénario est recalculé côté serveur sans rien écrire en base (hors journal d'audit)", () => {
    const before = counts();
    const ref = getWorkforceForecast(rhCtx(seed), {});
    const { data } = scenario({ embauches: "0", hausse: "10,5" });
    const sim = getWorkforceForecast(rhCtx(seed), data);
    expect(counts()).toEqual(before);
    if (ref.status !== "OK" || sim.status !== "OK") throw new Error("projection attendue");
    expect(sim.scenario.isReference).toBe(false);
    expect(sim.scenario.raisePct).toBeCloseTo(10.5, 9);
    expect(sim.total.hires12).toBe(0);
    expect(sim.total.hc12).toBeLessThan(ref.total.hc12);
    expect(sim.total.mass12!).toBeGreaterThan(0);
    expect(sim.focus.series.referenceHc.map((p) => p.value)).toEqual(ref.focus.series.hc.map((p) => p.value));
    const a = lastAudit();
    expect(a.action).toBe("workforce.view");
    expect(JSON.parse(a.detail!)).toMatchObject({ hiringPct: 0, raisePct: 10.5 });
  });

  it("les paramètres de scénario invalides sont ignorés, pas appliqués", () => {
    const { data, ignored } = scenario({ embauches: "900", hausse: "abc", departement: "-3" });
    expect(data).toEqual({});
    expect(ignored.sort()).toEqual(["departement", "embauches", "hausse"]);
  });
});

describe("statut des recommandations (Server Action → DAL auditée)", () => {
  const firstReco = () => db().prepare("SELECT id FROM insight_recommendation WHERE topic IN ('EFFECTIF','MASSE_SALARIALE') ORDER BY id LIMIT 1").get() as { id: number };

  it("MANAGER et ADMIN ne peuvent pas modifier un statut", () => {
    const { id } = firstReco();
    for (const ctx of [managerCtx(seed), adminCtx(seed)]) {
      expectHttp(() => updateWorkforceRecommendation(ctx, id, { status: "REALISEE" }), 403);
      expect(lastAudit()).toMatchObject({ action: "insight.update", outcome: "REFUSE", targetId: String(id) });
    }
    expect((db().prepare("SELECT status FROM insight_recommendation WHERE id = ?").get(id) as { status: string }).status).toBe("PROPOSEE");
  });

  it("la RH change le statut ; l'écriture est auditée avec l'ancien et le nouveau statut", () => {
    const { id } = firstReco();
    updateWorkforceRecommendation(rhCtx(seed), id, workforceRecoUpdateSchema.parse({ status: "REALISEE", comment: "Recrutement lancé" }));
    const row = db().prepare("SELECT status, comment, updated_by AS by FROM insight_recommendation WHERE id = ?").get(id) as { status: string; comment: string; by: number };
    expect(row).toEqual({ status: "REALISEE", comment: "Recrutement lancé", by: seed.rhUserId });
    const a = lastAudit();
    expect(a).toMatchObject({ action: "insight.update", outcome: "OK", targetId: String(id) });
    expect(JSON.parse(a.detail!)).toMatchObject({ from: "PROPOSEE", to: "REALISEE" });
  });

  it("un rejet exige un commentaire ; une recommandation d'un autre sujet ou inexistante renvoie 404", () => {
    expect(workforceRecoUpdateSchema.safeParse({ status: "REJETEE" }).success).toBe(false);
    expect(workforceRecoUpdateSchema.safeParse({ status: "REJETEE", comment: "ok" }).success).toBe(false);
    const other = Number(
      db()
        .prepare(
          `INSERT INTO insight_recommendation (topic, scope, audience, action_code, title, rationale, dedup_key) VALUES ('ABSENTEISME', 'ENTREPRISE', 'RH', 'X', 't', 'r', 'test:autre-sujet')`,
        )
        .run().lastInsertRowid,
    );
    expectHttp(() => updateWorkforceRecommendation(rhCtx(seed), other, { status: "REALISEE" }), 404);
    expectHttp(() => updateWorkforceRecommendation(rhCtx(seed), 999999, { status: "REALISEE" }), 404);
  });
});

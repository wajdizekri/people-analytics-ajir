import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStep } from "@/lib/ai/workforce/step";
import { setSetting } from "@/lib/settings";
import { cleanupDb, db, setupWorkforceDb } from "./setup";

const AS_OF = "2026-08-31";
let file = "";

beforeAll(async () => {
  ({ file } = await setupWorkforceDb("step"));
});
afterAll(() => cleanupDb(file));

type Reco = { id: number; topic: string; status: string; comment: string | null; dedup_key: string; priority: number };
const recos = () => db().prepare("SELECT id, topic, status, comment, dedup_key, priority FROM insight_recommendation ORDER BY dedup_key").all() as Reco[];
const forecasts = () =>
  db().prepare("SELECT topic, scope, department_id AS d, month, horizon, value, lower, upper, model_version AS v FROM forecast WHERE as_of = ? ORDER BY topic, scope, d, horizon").all(AS_OF) as {
    topic: string;
    scope: string;
    d: number | null;
    horizon: number;
    value: number;
    lower: number;
    upper: number;
    v: string;
  }[];

describe("étape IA effectifs et masse salariale", () => {
  it("écrit les prévisions EFFECTIF et MASSE_SALARIALE (entreprise + départements, horizons 1 à 12, bornes encadrant la valeur)", () => {
    setSetting(db(), "budget_masse_salariale_2026", "100000");
    const r = runStep(db(), AS_OF);
    expect(r.summary).toMatch(/probabilités publiées/);
    const f = forecasts();
    const depts = (db().prepare("SELECT COUNT(*) AS n FROM department").get() as { n: number }).n;
    expect(f).toHaveLength(2 * 12 * (1 + depts));
    for (const topic of ["EFFECTIF", "MASSE_SALARIALE"]) {
      const ent = f.filter((x) => x.topic === topic && x.scope === "ENTREPRISE");
      expect(ent.map((x) => x.horizon)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(ent.every((x) => x.lower <= x.value && x.value <= x.upper && x.v.length > 0)).toBe(true);
      const sumDept = f.filter((x) => x.topic === topic && x.scope === "DEPARTEMENT" && x.horizon === 12).reduce((s, x) => s + x.value, 0);
      expect(sumDept).toBeCloseTo(ent[11].value, 6);
    }
  });

  it("crée une recommandation d'écart au budget quand un budget est paramétré, avec une justification chiffrée", () => {
    const budget = recos().find((r) => r.dedup_key === `masse:budget:2026:${AS_OF}`);
    expect(budget).toBeDefined();
    expect(budget!.topic).toBe("MASSE_SALARIALE");
    const row = db().prepare("SELECT title, rationale, audience FROM insight_recommendation WHERE id = ?").get(budget!.id) as { title: string; rationale: string; audience: string };
    expect(row.audience).toBe("RH");
    expect(row.title).toMatch(/^Écart de masse salariale prévu de \+\d/);
    expect(row.rationale).toMatch(/TND/);
  });

  it("est idempotente : relancée, elle ne duplique rien et conserve le statut des recommandations traitées", () => {
    const before = recos();
    const f1 = forecasts();
    expect(before.length).toBeGreaterThan(0);
    const treated = before[0];
    db().prepare("UPDATE insight_recommendation SET status = 'REALISEE', comment = 'fait' WHERE id = ?").run(treated.id);
    runStep(db(), AS_OF);
    const after = recos();
    expect(after.map((r) => r.dedup_key)).toEqual(before.map((r) => r.dedup_key));
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    const t = after.find((r) => r.id === treated.id)!;
    expect(t.status).toBe("REALISEE");
    expect(t.comment).toBe("fait");
    expect(forecasts()).toEqual(f1);
  });

  it("retire une recommandation encore proposée qui ne s'applique plus, mais garde celles déjà traitées", () => {
    const key = `masse:budget:2026:${AS_OF}`;
    const b = recos().find((r) => r.dedup_key === key)!;
    db().prepare("UPDATE insight_recommendation SET status = 'PROPOSEE', comment = NULL WHERE id = ?").run(b.id);
    setSetting(db(), "budget_masse_salariale_2026", "");
    runStep(db(), AS_OF);
    expect(recos().some((r) => r.dedup_key === key)).toBe(false);

    setSetting(db(), "budget_masse_salariale_2026", "100000");
    runStep(db(), AS_OF);
    const again = recos().find((r) => r.dedup_key === key)!;
    db().prepare("UPDATE insight_recommendation SET status = 'REJETEE', comment = 'budget révisé' WHERE id = ?").run(again.id);
    setSetting(db(), "budget_masse_salariale_2026", "");
    runStep(db(), AS_OF);
    expect(recos().find((r) => r.dedup_key === key)?.status).toBe("REJETEE");
  });

  it("se désactive proprement sans modèle champion", () => {
    db().prepare("UPDATE topic_model SET status = 'RETIRE' WHERE topic = 'EFFECTIF'").run();
    try {
      expect(runStep(db(), AS_OF).summary).toMatch(/aucun modèle champion/);
    } finally {
      db().prepare("UPDATE topic_model SET status = 'CHAMPION' WHERE topic = 'EFFECTIF'").run();
    }
  });
});

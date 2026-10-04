import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../../../tests/fixtures/engine/db";
import { buildTeamScenario, T } from "../../../tests/fixtures/engine/scenario";
import { computeFeaturesForMonth, FEATURE_INDEX as F, type FeatureVector } from "./index";

let db: TestDb;
let ids: ReturnType<typeof buildTeamScenario>;

beforeAll(() => {
  db = createTestDb();
  ids = buildTeamScenario(new Fixture(db.sqlite));
});
afterAll(() => db.close());

const valuesOf = (rows: FeatureVector[], id: number) => rows.find((r) => r.employeeId === id)!.values;

describe("variables : mode naïf (expérience de fuite hors ligne)", () => {
  it("désactivé par défaut", () => {
    expect(computeFeaturesForMonth(db.sqlite, T, { naive: false })).toEqual(computeFeaturesForMonth(db.sqlite, T));
  });

  it("voit les lignes saisies après t, sur la même population", () => {
    const nominal = computeFeaturesForMonth(db.sqlite, T);
    const naive = computeFeaturesForMonth(db.sqlite, T, { naive: true });
    expect(naive.map((r) => r.employeeId)).toEqual(nominal.map((r) => r.employeeId));
    expect(valuesOf(nominal, ids.a)[F.last_eval_score]).toBe(3.5);
    expect(valuesOf(naive, ids.a)[F.last_eval_score]).toBe(3);
    expect(valuesOf(naive, ids.a)[F.eval_delta]).toBe(-0.5);
    expect(valuesOf(nominal, ids.a)[F.months_since_raise]).toBe(6);
    expect(valuesOf(naive, ids.a)[F.months_since_raise]).toBe(0);
  });
});

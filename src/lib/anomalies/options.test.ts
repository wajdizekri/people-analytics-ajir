import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../../../tests/fixtures/engine/db";
import { buildAbsenceScenario } from "../../../tests/fixtures/engine/absences";
import { anomalyScores, bradfordScores, detectAnomalies, weeklySeries } from "./index";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

type Row = { scope: string; periodStart: string; periodEnd: string; score: number; message: string };
const collective = (d: TestDb) =>
  d.sqlite
    .prepare("SELECT scope, period_start AS periodStart, period_end AS periodEnd, score, message FROM anomaly WHERE scope <> 'SALARIE' ORDER BY id")
    .all() as Row[];

describe("options d'évaluation de detectAnomalies", () => {
  it("options explicites aux valeurs par défaut = comportement nominal", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: true });
    detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23");
    const nominal = collective(db);
    db.sqlite.exec("DELETE FROM anomaly; DELETE FROM alert;");
    detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23", { zThreshold: 3.5, consecutiveWeeks: 2, calendarAdjust: true, alerts: true });
    expect(collective(db)).toEqual(nominal);
  });

  it("calendarAdjust: false reproduit l'ablation (Ramadan signalé)", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: false });
    detectAnomalies(db.sqlite, "2024-09-02", "2025-06-23");
    expect(collective(db)).toEqual([]);
    detectAnomalies(db.sqlite, "2024-09-02", "2025-06-23", { calendarAdjust: false, alerts: false });
    const march = collective(db).filter((r) => r.periodStart >= "2025-02-24" && r.periodStart <= "2025-03-31");
    expect(march.length).toBeGreaterThan(0);
  });

  it("règle des semaines consécutives et alertes désactivées", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: true });
    detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23", { consecutiveWeeks: 1, alerts: false });
    const one = collective(db).filter((r) => r.scope === "EQUIPE");
    expect(one.map((r) => [r.periodStart, r.periodEnd])).toEqual([["2025-05-05", "2025-05-11"]]);
    expect(one[0].message).toMatch(/la semaine du/);
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM alert").get()).toEqual({ n: 0 });
    db.sqlite.exec("DELETE FROM anomaly");
    detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23", { consecutiveWeeks: 3, alerts: false });
    expect(collective(db).filter((r) => r.scope === "EQUIPE")).toEqual([]);
  });

  it("seuil z plus bas : plus de signalements, jamais moins", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: true });
    detectAnomalies(db.sqlite, "2024-09-02", "2025-06-23", { alerts: false });
    const strict = collective(db).length;
    db.sqlite.exec("DELETE FROM anomaly");
    detectAnomalies(db.sqlite, "2024-09-02", "2025-06-23", { zThreshold: 2, consecutiveWeeks: 1, alerts: false });
    expect(collective(db).length).toBeGreaterThanOrEqual(strict);
  });
});

describe("exports de scores (sans écriture)", () => {
  it("anomalyScores reprend les z de weeklySeries et signale les groupes non suivis", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: true });
    const { factor, groups } = anomalyScores(db.sqlite, "2025-03-03", "2025-06-23");
    expect(factor.NORMALE).toBe(1);
    const d1 = groups.find((g) => g.key === "D1")!;
    expect(d1.monitored).toBe(true);
    const ref = weeklySeries(db.sqlite, "D1", "2025-03-03", "2025-06-23");
    expect(d1.points.map((p) => p.z)).toEqual(ref.map((p) => p.z));
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM anomaly").get()).toEqual({ n: 0 });
    const flat = anomalyScores(db.sqlite, "2025-03-03", "2025-06-23", { calendarAdjust: false });
    expect(Object.values(flat.factor).every((f) => f === 1)).toBe(true);
  });

  it("bradfordScores renvoie tous les salariés ayant une absence comptée", () => {
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    const a = fx.emp({ matricule: "A", hire: "2020-01-01" });
    const b = fx.emp({ matricule: "B", hire: "2020-01-01" });
    for (const d of ["2025-01-06", "2025-02-03", "2025-03-03"]) fx.absence(a, d, d, "AUTRE");
    fx.absence(b, "2025-03-03", "2025-03-04", "MALADIE");
    const { rows } = bradfordScores(db.sqlite, "2025-06-23");
    expect(rows).toEqual([{ employeeId: a, spells: 3, days: 3, bradford: 27 }]);
    detectAnomalies(db.sqlite, "2025-06-23", "2025-06-23", { bradfordThreshold: 20, alerts: false });
    expect(db.sqlite.prepare("SELECT employee_id AS e FROM anomaly WHERE scope = 'SALARIE'").all()).toEqual([{ e: a }]);
  });
});

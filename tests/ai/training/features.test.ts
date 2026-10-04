import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTrainingsAt, type OpenTraining } from "@/lib/ai/training/features";
import { createTestDb, Fixture, weekdaysBetween, type TestDb } from "../../fixtures/engine/db";

const T = "2025-06-30";
let db: TestDb;
const e: Record<string, number> = {};
let rows: Map<string, OpenTraining>;

beforeAll(() => {
  db = createTestDb();
  const fx = new Fixture(db.sqlite);
  const d = fx.dept("PROD");
  e.M = fx.emp({ matricule: "M", hire: "2010-01-01", dept: d });
  e.M2 = fx.emp({ matricule: "M2", hire: "2010-01-01", dept: d });
  e.E1 = fx.emp({ matricule: "E1", hire: "2020-01-15", dept: d, managerId: e.M });
  e.E2 = fx.emp({ matricule: "E2", hire: "2019-01-01", dept: d, managerId: e.M });
  e.E3 = fx.emp({ matricule: "E3", hire: "2019-01-01", dept: d, managerId: e.M });
  e.E4 = fx.emp({ matricule: "E4", hire: "2019-01-01", dept: d, managerId: e.M2 });
  e.E5 = fx.emp({ matricule: "E5", hire: "2019-01-01", dept: d, managerId: e.M });
  e.N = fx.emp({ matricule: "N", hire: "2025-05-10", dept: d, managerId: e.M });

  const tr = (id: number, code: string, o: { start?: string | null; end?: string | null; due: string; status: string; hours?: number }) =>
    fx.training(id, { code, mandatory: true, hours: o.hours ?? 4, ...o });
  tr(e.E1, "OPEN", { start: "2025-07-08", due: "2025-07-10", status: "PLANIFIEE" });
  tr(e.E1, "DONE_LATER", { start: "2025-07-20", end: "2025-07-20", due: "2025-08-15", status: "TERMINEE", hours: 7 });
  tr(e.E1, "FAR", { start: "2025-12-01", due: "2025-12-31", status: "PLANIFIEE" });
  tr(e.E1, "ABANDON", { due: "2025-07-05", status: "ABANDONNEE" });
  tr(e.E1, "DONE_BEFORE_T", { start: "2025-06-20", end: "2025-06-20", due: "2025-07-20", status: "TERMINEE" });
  tr(e.E1, "PAST_OK", { start: "2025-02-20", end: "2025-02-20", due: "2025-03-01", status: "TERMINEE" });
  tr(e.E1, "PAST_LATE", { start: "2024-06-11", end: "2024-06-11", due: "2024-06-01", status: "TERMINEE" });
  fx.training(e.E1, { code: "FACULTATIVE", mandatory: false, due: "2025-07-10", status: "PLANIFIEE" });
  // Formations échues sur ]t - 365 j, t] (1 = en retard)
  for (const [emp, due, late] of [
    [e.E2, "2024-09-01", 1],
    [e.E2, "2024-12-01", 0],
    [e.E2, "2025-03-01", 1],
    [e.E3, "2024-10-01", 0],
    [e.E3, "2025-01-15", 1],
    [e.E4, "2025-02-01", 0],
    [e.E5, "2024-08-01", 0],
    [e.E5, "2024-11-01", 1],
    [e.E5, "2025-04-01", 0],
  ] as const)
    tr(emp, `TEAM-${due}`, late ? { due, status: "PLANIFIEE", start: "2025-12-01" } : { start: due, end: due, due, status: "TERMINEE" });
  tr(e.E2, "E2_OPEN", { start: "2025-08-01", due: "2025-08-20", status: "PLANIFIEE" });
  tr(e.E3, "E3_OPEN", { start: "2025-08-01", due: "2025-08-20", status: "PLANIFIEE" });
  tr(e.E4, "E4_OPEN", { start: "2025-08-01", due: "2025-08-20", status: "PLANIFIEE" });
  tr(e.N, "ACC", { start: "2025-07-02", due: "2025-07-09", status: "PLANIFIEE" });
  // E2 : sortie saisie après t (encore active à t) ; E3 : sortie visible à t
  fx.exit(e.E2, "2025-06-15", "DEMISSION", { recordedAt: "2025-07-05" });
  fx.exit(e.E3, "2025-06-15", "DEMISSION", { recordedAt: "2025-06-16" });
  // E4 : changement de manager M -> M2 saisi après t : à t, son manager est M
  fx.career(e.E4, "2025-06-01", "CHANGEMENT_MANAGER", "M", "M2", "2025-07-10");
  fx.attendance(e.E1, "2025-03-25", "2025-07-05", { overtime: () => 60 });
  rows = new Map(openTrainingsAt(db.sqlite, T).map((r) => [r.code, r]));
});
afterAll(() => db.close());

describe("formations obligatoires ouvertes à t (visibilité as-of)", () => {
  it("population : échéance dans ]t, t + 120 j], non terminée à t, non abandonnée, obligatoire, salarié actif à t", () => {
    expect([...rows.keys()].sort()).toEqual(["ACC", "DONE_LATER", "E2_OPEN", "E4_OPEN", "OPEN"]);
  });

  it("une formation terminée après t est ouverte à t et non commencée ; la date de début future n'est jamais lue", () => {
    const f = rows.get("DONE_LATER")!.features;
    expect(f).toMatchObject({ days_to_due: 46, started: 0, hours: 7, due_summer: 1 });
    expect(rows.get("OPEN")!.features.days_to_due).toBe(10);
  });

  it("historique du salarié : formations échues à t (retard = non terminée à l'échéance), marge bornée", () => {
    const f = rows.get("OPEN")!.features;
    expect(f.emp_past_n).toBe(2);
    expect(f.emp_late_rate).toBe(0.5);
    expect(f.emp_margin_days).toBe((9 + -10) / 2);
    expect(f.emp_overdue_other).toBe(0);
    expect(f.open_mandatory_others).toBe(1);
    expect(rows.get("OPEN")!.lateCount).toBe(1);
  });

  it("équipe = manager à t (changement saisi après t ignoré), sans le salarié lui-même, seuil de 5 formations", () => {
    expect(rows.get("E4_OPEN")!.managerId).toBe(e.M);
    // Équipe de M à t : E1 (1 formation, 0 retard), E2 (3, 2), E4 (1, 0), E5 (3, 1) ; E3 sorti à t ne compte pas
    expect(rows.get("OPEN")!.features.team_late_rate_12m).toBe(3 / 7);
    expect(rows.get("E4_OPEN")!.features.team_late_rate_12m).toBe(3 / 7);
    expect(rows.get("E2_OPEN")!.features.team_late_rate_12m).toBe(1 / 5);
    expect(rows.get("E2_OPEN")!.features.emp_overdue_other).toBe(1);
    // N : 8 formations dans l'équipe hors N, mais aucun historique personnel
    expect(rows.get("ACC")!.features.team_late_rate_12m).toBe(3 / 8);
  });

  it("charge : heures supplémentaires des 3 mois civils jusqu'à t, par mois", () => {
    expect(rows.get("OPEN")!.features.overtime_h_3m).toBeCloseTo(weekdaysBetween("2025-04-01", "2025-06-30") / 3, 12);
  });

  it("ancienneté et nouvel arrivant", () => {
    expect(rows.get("ACC")!.features).toMatchObject({ tenure_months: 1, new_hire: 1, emp_past_n: 0, emp_late_rate: null, emp_margin_days: null });
    expect(rows.get("OPEN")!.features).toMatchObject({ tenure_months: 65, new_hire: 0 });
    expect(rows.get("OPEN")!.features.log_tenure).toBeCloseTo(Math.log(66), 12);
  });

  it("refuse une date invalide", () => {
    expect(() => openTrainingsAt(db.sqlite, "2025-06")).toThrow();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { createAlert, systemAlert } from "@/lib/engine/alerts";
import { SUPERSEDED_COMMENT, applyPublicationEffects, supersedeSameMonthEffects } from "@/lib/engine/recommendations";
import { addMonths, addMonthsToMonth, frDate, isMonthEnd, mondayOf, monthRange, monthsBetween, normalizeAsOf, toDay, fromDay } from "@/lib/features/dates";
import {
  absenceByEmployee,
  countPresent,
  monthBuckets,
  rollingTurnover,
  smallGroupMask,
  sumRows,
  weekBuckets,
  workableCounter,
  workingDayFn,
  workforce,
  type MonthRow,
} from "@/lib/dal/pilotage-metrics";

describe("dates", () => {
  it("mois entiers entre deux dates : jour non atteint retranché sauf en fin de mois", () => {
    expect(monthsBetween("2024-01-31", "2024-02-29")).toBe(1);
    expect(monthsBetween("2024-01-15", "2024-02-14")).toBe(0);
    expect(monthsBetween("2024-01-15", "2024-02-15")).toBe(1);
    expect(monthsBetween("2023-03-31", "2025-06-30")).toBe(27);
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2025-02-28", 1)).toBe("2025-03-31");
    expect(addMonths("2025-01-15", -13)).toBe("2023-12-15");
    expect(addMonthsToMonth("2025-01", -1)).toBe("2024-12");
    expect(isMonthEnd("2024-02-29")).toBe(true);
    expect(isMonthEnd("2025-02-28")).toBe(true);
    expect(isMonthEnd("2024-02-28")).toBe(false);
  });

  it("coupure normalisée à la fin du mois ; formats refusés", () => {
    expect(normalizeAsOf("2025-02")).toBe("2025-02-28");
    expect(normalizeAsOf("2024-02-10")).toBe("2024-02-29");
    for (const bad of ["2025", "2025-2", "25-02-2025", "2025-02-10T00:00"]) expect(() => normalizeAsOf(bad), bad).toThrow(/Date de coupure invalide/);
    expect(monthRange("2024-11-30", "2025-02-01")).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
    expect(monthRange("2025-03", "2025-01")).toEqual([]);
    expect(fromDay(mondayOf(toDay("2025-06-01")))).toBe("2025-05-26");
    expect(fromDay(mondayOf(toDay("2025-06-02")))).toBe("2025-06-02");
    expect(fromDay(toDay("1969-12-31"))).toBe("1969-12-31");
    expect(frDate("2025-06-30")).toBe("30/06/2025");
  });
});

describe("indicateurs de pilotage (calculs purs)", () => {
  const weekday = workingDayFn(null);

  it("jours ouvrés : dim_date prioritaire, repli lundi-vendredi pour les dates absentes", () => {
    const f = workingDayFn(new Map([["2025-05-01", false], ["2025-05-03", true]]));
    expect([f("2025-05-01"), f("2025-05-02"), f("2025-05-03"), f("2025-05-04")]).toEqual([false, true, true, false]);
    expect(workingDayFn(new Map())("2025-05-01")).toBe(true);
  });

  it("population de l'effectif : hors stage et SIVP, entrée au premier contrat de travail, contrat démarré après la sortie ignoré", () => {
    expect(
      workforce([
        { id: 1, hireDate: "2020-01-01", exitDate: null, workStart: "2020-06-01" },
        { id: 2, hireDate: "2020-01-01", exitDate: null, workStart: null },
        { id: 3, hireDate: "2020-01-01", exitDate: "2021-01-01", workStart: "2022-01-01" },
      ]),
    ).toEqual([{ id: 1, hireDate: "2020-06-01", exitDate: null }]);
  });

  it("jours ouvrés « employé » par seau : bornés à l'embauche et à la sortie ; aucun seau", () => {
    const buckets = monthBuckets(["2025-05", "2025-06"]);
    const count = workableCounter(buckets, weekday);
    expect(count([{ id: 1, hireDate: "2025-05-15", exitDate: "2025-06-10" }])).toEqual([12, 7]);
    expect(count([{ id: 1, hireDate: "2024-01-01", exitDate: null }])).toEqual([22, 21]);
    expect(count([{ id: 1, hireDate: "2025-07-01", exitDate: null }])).toEqual([0, 0]);
    expect(workableCounter([], weekday)([{ id: 1, hireDate: "2025-01-01", exitDate: null }])).toEqual([]);
  });

  it("absences réparties au prorata des jours ouvrés ; épisode sans jour ouvré compté au jour de début ; hors fenêtre ignoré", () => {
    const buckets = weekBuckets("2025-06-11", 2);
    expect(buckets).toEqual([
      { key: "2025-06-02", from: "2025-06-02", to: "2025-06-08" },
      { key: "2025-06-09", from: "2025-06-09", to: "2025-06-15" },
    ]);
    const ep = (employeeId: number, startDate: string, endDate: string, days: number) => ({ employeeId, startDate, endDate, days, isHealth: false, category: "AUTRE" });
    const out = absenceByEmployee(buckets, [ep(1, "2025-06-05", "2025-06-10", 4), ep(2, "2025-06-07", "2025-06-08", 2), ep(3, "2025-05-01", "2025-05-02", 2), ep(4, "2025-05-30", "2025-06-03", 3)], weekday);
    expect(out.get(1)).toEqual([2, 2]);
    expect(out.get(2)).toEqual([2, 0]);
    expect(out.has(3)).toBe(false);
    expect(out.get(4)).toEqual([2, 0]);
    expect(absenceByEmployee([], [ep(1, "2025-06-05", "2025-06-05", 1)], weekday).size).toBe(0);
  });

  it("somme de séries mensuelles par mois, triées ; turnover glissant indéfini sans 12 mois ou sans effectif", () => {
    const row = (month: string, headcount: number, exits: number): MonthRow => ({
      month,
      headcount,
      entries: 0,
      exits,
      voluntaryExits: exits,
      absenceDaysNonHealth: 1,
      absenceDaysHealth: 0,
      workableDays: 20,
      payrollMass: 100,
      trainingsDone: 0,
      trainingsDue: 0,
    });
    const s = sumRows([[row("2025-02", 5, 1), row("2025-01", 4, 0)], [row("2025-01", 6, 2)]]);
    expect(s.map((r) => [r.month, r.headcount, r.exits, r.payrollMass])).toEqual([
      ["2025-01", 10, 2, 200],
      ["2025-02", 5, 1, 100],
    ]);
    const year = Array.from({ length: 12 }, (_, i) => row(`2025-${String(i + 1).padStart(2, "0")}`, 10, i === 11 ? 3 : 0));
    expect(rollingTurnover(year, 10, false)).toBeNull();
    expect(rollingTurnover(year, 11, true)).toBeCloseTo(0.3, 12);
    expect(rollingTurnover(year.map((r) => ({ ...r, headcount: 0 })), 11, false)).toBeNull();
  });

  it("masquage des petits groupes : masquage secondaire jusqu'à K personnes masquées, groupes vides jamais masqués", () => {
    expect(smallGroupMask([6, 7, 0])).toEqual([false, false, false]);
    expect(smallGroupMask([2, 9, 6])).toEqual([true, false, true]);
    expect(smallGroupMask([4, 1, 20])).toEqual([true, true, false]);
    expect(smallGroupMask([2, 1, 20])).toEqual([true, true, true]);
    expect(smallGroupMask([3])).toEqual([true]);
    expect(smallGroupMask([8, 9], [true, false])).toEqual([true, false]);
    expect(smallGroupMask([3, 3], [], 2)).toEqual([false, false]);
    expect(countPresent([{ id: 1, hireDate: "2025-01-01", exitDate: "2025-03-01" }], "2025-03-01", "2025-03-31")).toBe(1);
    expect(countPresent([{ id: 1, hireDate: "2025-01-01", exitDate: "2025-02-28" }], "2025-03-01", "2025-03-31")).toBe(0);
  });
});

describe("effets de publication d'un run", () => {
  let db: TestDb;
  const e: Record<string, number> = {};
  const run = (asOf: string, kind: string | null, preds: [number, string, [string, string][]][]) => {
    const modelId = kind ? Number(db.sqlite.prepare("INSERT INTO model_version (version, kind, fsv) VALUES (?, ?, 'v1')").run(`${kind}-${asOf}-${Math.random()}`, kind).lastInsertRowid) : 9999;
    const runId = Number(db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status) VALUES (?, ?, 'PUBLIE')").run(asOf, modelId).lastInsertRowid);
    preds.forEach(([emp, level, factors], i) => {
      const pid = Number(db.sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, 1, ?, ?, 1, ?)").run(runId, emp, asOf, level, i + 1, modelId).lastInsertRowid);
      factors.forEach(([g, dir], j) => db.sqlite.prepare("INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction) VALUES (?, ?, 1, ?, ?)").run(pid, g, j + 1, dir));
    });
    return runId;
  };
  const recos = () => db.sqlite.prepare("SELECT employee_id AS e, action_code AS a FROM recommendation ORDER BY id").all();
  beforeAll(() => {
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    for (const m of ["A", "B", "C"]) e[m] = fx.emp({ matricule: m, hire: "2020-01-01" });
  });
  afterAll(() => db.close());

  it("run inconnu refusé", () => {
    expect(() => applyPublicationEffects(db.sqlite, 424242)).toThrow(/Run inconnu/);
  });

  it("actions des 3 premiers facteurs à la hausse et actionnables ; entretien pour ÉLEVÉ ; FAIBLE ignoré", () => {
    const r = run("2025-05-31", "LOGREG", [
      [e.A, "ELEVE", [["ABSENCES", "HAUSSE"], ["TEMPS_TRAVAIL", "HAUSSE"], ["REMUNERATION", "BAISSE"], ["FORMATION_EVAL", "HAUSSE"]]],
      [e.B, "MOYEN", [["CARRIERE", "HAUSSE"], ["FORMATION_EVAL", "HAUSSE"]]],
      [e.C, "FAIBLE", [["TEMPS_TRAVAIL", "HAUSSE"]]],
    ]);
    expect(applyPublicationEffects(db.sqlite, r)).toEqual({ recommendations: 3, alerts: 1 });
    expect(recos()).toEqual([
      { e: e.A, a: "CHARGE_TRAVAIL" },
      { e: e.A, a: "ENTRETIEN" },
      { e: e.B, a: "PLAN_FORMATION" },
    ]);
    const msg = (db.sqlite.prepare("SELECT message FROM alert WHERE dedup_key = ?").get(`turnover:${e.A}:2025-05-31`) as { message: string }).message;
    expect(msg).toContain("au 31/05/2025");
    expect(msg).toContain("Facteurs associés : Charge de travail.");
  });

  it("déjà ÉLEVÉ au run publié précédent : pas de nouvelle alerte ; action encore ouverte non dupliquée ; modèle inconnu traité comme B0", () => {
    const r = run("2025-06-30", null, [[e.A, "ELEVE", [["REMUNERATION", "HAUSSE"], ["TEMPS_TRAVAIL", "HAUSSE"]]], [e.B, "ELEVE", [["ABSENCES", "HAUSSE"], ["REMUNERATION", "HAUSSE"]]]]);
    const res = applyPublicationEffects(db.sqlite, r);
    expect(res.alerts).toBe(1);
    expect(recos().slice(3)).toEqual([
      { e: e.A, a: "REVISION_SALARIALE" },
      { e: e.B, a: "REVISION_SALARIALE" },
      { e: e.B, a: "ENTRETIEN" },
    ]);
    const msg = (db.sqlite.prepare("SELECT message FROM alert WHERE dedup_key = ?").get(`turnover:${e.B}:2025-06-30`) as { message: string }).message;
    expect(msg).not.toContain("Facteurs associés");
    expect(applyPublicationEffects(db.sqlite, r)).toEqual({ recommendations: 0, alerts: 0 });
  });
});

describe("mois recalculé avec un autre modèle : effets du calcul remplacé", () => {
  let db: TestDb;
  const e: Record<string, number> = {};
  const run = (asOf: string, kind: string, preds: [number, string, [string, string][]][]) => {
    const modelId = Number(db.sqlite.prepare("INSERT INTO model_version (version, kind, fsv) VALUES (?, ?, 'v1')").run(`${kind}-${asOf}`, kind).lastInsertRowid);
    const runId = Number(db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status) VALUES (?, ?, 'PUBLIE')").run(asOf, modelId).lastInsertRowid);
    preds.forEach(([emp, level, factors], i) => {
      const pid = Number(db.sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, 1, ?, ?, 1, ?)").run(runId, emp, asOf, level, i + 1, modelId).lastInsertRowid);
      factors.forEach(([g, dir], j) => db.sqlite.prepare("INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction) VALUES (?, ?, 1, ?, ?)").run(pid, g, j + 1, dir));
    });
    return runId;
  };
  const state = () =>
    db.sqlite
      .prepare("SELECT r.employee_id AS e, r.action_code AS a, r.status AS s, r.comment AS c, p.run_id AS run FROM recommendation r LEFT JOIN prediction p ON p.id = r.prediction_id ORDER BY r.id")
      .all();
  beforeAll(() => {
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    for (const m of ["A", "B", "C", "D"]) e[m] = fx.emp({ matricule: m, hire: "2020-01-01" });
  });
  afterAll(() => db.close());

  it("non reproposées → REJETEE commentée, reproposées rattachées au run courant ; alerte sans objet rejetée ; audité ; idempotent", () => {
    const b0 = run("2026-08-31", "B0", [
      [e.A, "ELEVE", [["TEMPS_TRAVAIL", "HAUSSE"]]],
      [e.B, "ELEVE", []],
      [e.D, "MOYEN", [["FORMATION_EVAL", "HAUSSE"]]],
    ]);
    applyPublicationEffects(db.sqlite, b0);
    db.sqlite.prepare("UPDATE recommendation SET status = 'REALISEE' WHERE employee_id = ? AND action_code = 'PLAN_FORMATION'").run(e.D);
    const lr = run("2026-08-31", "LOGREG", [
      [e.A, "ELEVE", [["REMUNERATION", "HAUSSE"]]],
      [e.C, "ELEVE", []],
    ]);
    expect(applyPublicationEffects(db.sqlite, lr)).toEqual({ recommendations: 2, alerts: 1 });
    db.sqlite.prepare("UPDATE scoring_run SET finished_at = '9999-12-31T00:00:00Z' WHERE id = ?").run(lr);

    const dry = supersedeSameMonthEffects(db.sqlite, lr);
    expect(dry).toMatchObject({ applied: false, rejected: [1, 3], relinked: [2], alerts: [2], refreshed: [1] });
    expect(state()).toContainEqual({ e: e.B, a: "ENTRETIEN", s: "PROPOSEE", c: null, run: b0 });

    const before = (db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'scoring.supersede'").get() as { n: number }).n;
    expect(supersedeSameMonthEffects(db.sqlite, lr, { apply: true, userId: null })).toMatchObject({ applied: true, rejected: [1, 3], relinked: [2] });
    expect(state()).toEqual([
      { e: e.A, a: "CHARGE_TRAVAIL", s: "REJETEE", c: SUPERSEDED_COMMENT, run: b0 },
      { e: e.A, a: "ENTRETIEN", s: "PROPOSEE", c: null, run: lr },
      { e: e.B, a: "ENTRETIEN", s: "REJETEE", c: SUPERSEDED_COMMENT, run: b0 },
      { e: e.D, a: "PLAN_FORMATION", s: "REALISEE", c: null, run: b0 },
      { e: e.A, a: "REVISION_SALARIALE", s: "PROPOSEE", c: null, run: lr },
      { e: e.C, a: "ENTRETIEN", s: "PROPOSEE", c: null, run: lr },
    ]);
    const alerts = db.sqlite.prepare("SELECT employee_id AS e, status AS s, comment AS c, message AS m FROM alert WHERE type = 'TURNOVER' ORDER BY id").all();
    expect(alerts).toEqual([
      { e: e.A, s: "NOUVELLE", c: null, m: expect.stringContaining("Facteurs associés : Rémunération.") },
      { e: e.B, s: "REJETEE", c: SUPERSEDED_COMMENT, m: expect.any(String) },
      { e: e.C, s: "NOUVELLE", c: null, m: expect.not.stringContaining("Facteurs associés") },
    ]);
    const audit = db.sqlite.prepare("SELECT target_id AS t, outcome, detail_json AS d FROM audit_log WHERE action = 'scoring.supersede'").all() as { t: string; outcome: string; d: string }[];
    expect(audit).toHaveLength(before + 1);
    expect(audit.at(-1)).toMatchObject({ t: String(lr), outcome: "OK" });
    expect(JSON.parse(audit.at(-1)!.d)).toEqual({ asOf: "2026-08-31", rejected: [1, 3], relinked: [2], alerts: [2], refreshed: [1] });

    expect(supersedeSameMonthEffects(db.sqlite, lr)).toMatchObject({ rejected: [], relinked: [], alerts: [], refreshed: [] });
    expect(applyPublicationEffects(db.sqlite, lr)).toEqual({ recommendations: 0, alerts: 0 });
  });
});

describe("alertes : déduplication", () => {
  it("clé de déduplication unique ; alerte système résistante à une base défaillante", () => {
    const db = createTestDb();
    try {
      const a = { type: "DONNEES" as const, severity: "INFO" as const, audience: "RH" as const, title: "t", message: "m", dedupKey: "k" };
      expect(createAlert(db.sqlite, a)).toBe(true);
      expect(createAlert(db.sqlite, { ...a, message: "autre" })).toBe(false);
      expect(db.sqlite.prepare("SELECT message, department_id AS d, link FROM alert").all()).toEqual([{ message: "m", d: null, link: null }]);
      expect(systemAlert(db.sqlite, "x", "t", "m", "INFO", "/data-health")).toBe(true);
      expect(db.sqlite.prepare("SELECT type, audience, severity, link FROM alert WHERE dedup_key = 'systeme:x'").get()).toEqual({
        type: "SYSTEME",
        audience: "ADMIN",
        severity: "INFO",
        link: "/data-health",
      });
      db.sqlite.exec("DROP TABLE alert");
      expect(systemAlert(db.sqlite, "y", "t", "m")).toBe(false);
    } finally {
      db.close();
    }
  });
});

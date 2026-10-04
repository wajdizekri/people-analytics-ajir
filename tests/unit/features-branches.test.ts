import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import {
  backfillFeatures,
  computeFeatures,
  computeFeaturesForMonth,
  FEATURE_INDEX as F,
  FEATURE_NAMES,
  loadEmployeeDataset,
  readSnapshots,
} from "@/lib/features";
import { CAL_BRIDGE, CAL_HOLIDAY, CAL_RAMADAN, CAL_SEANCE_UNIQUE, CAL_WORKING, WorkCalendar } from "@/lib/features/calendar";
import { featureSpec, managerVisibleGroup } from "@/lib/features/spec";
import { toDay } from "@/lib/features/dates";
import { eligibleContract, isActiveAt } from "@/lib/features/compute";

const T = "2025-06-30";
const byName = (values: number[]) => Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, values[i]]));
const feat = (db: TestDb, id: number, t = T) => {
  const r = computeFeatures(db.sqlite, id, t);
  return r ? byName(r.values) : null;
};

describe("éligibilité : cas limites", () => {
  let db: TestDb;
  let fx: Fixture;
  beforeAll(() => {
    db = createTestDb();
    fx = new Fixture(db.sqlite);
  });
  afterAll(() => db.close());

  it("contrat : CDD sans terme éligible, STAGE exclu, contrat futur ignoré, dernier contrat en vigueur à t", () => {
    const cddOpen = fx.emp({ matricule: "C1", hire: "2023-01-01", contract: { type: "CDD", end: null } });
    const stage = fx.emp({ matricule: "C2", hire: "2023-01-01", contract: { type: "STAGE" } });
    const future = fx.emp({ matricule: "C3", hire: "2023-01-01", contract: { type: "CDI", start: "2025-07-01" } });
    const switched = fx.emp({ matricule: "C4", hire: "2023-01-01", contract: { type: "CDD", end: "2025-03-31" } });
    db.sqlite.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, 'CDI', '2025-04-01'), (?, 'STAGE', '2025-08-01')").run(switched, switched);
    const noContract = fx.emp({ matricule: "C5", hire: "2023-01-01", contract: null });
    expect(feat(db, cddOpen)?.contract_cdd).toBe(1);
    expect(feat(db, stage)).toBeNull();
    expect(feat(db, future)).toBeNull();
    expect(feat(db, switched)?.contract_cdd).toBe(0);
    expect(feat(db, switched, "2025-02-28")).toBeNull();
    expect(feat(db, noContract)).toBeNull();
  });

  it("âge : exclu à 60 ans pile à t + 6 mois, inclus la veille ; date de naissance inconnue = pas de contrôle", () => {
    const sixty = fx.emp({ matricule: "A1", hire: "2000-01-01", birth: "1965-12-31" });
    const younger = fx.emp({ matricule: "A2", hire: "2000-01-01", birth: "1966-01-01" });
    const unknown = fx.emp({ matricule: "A3", hire: "2000-01-01" });
    db.sqlite.prepare("UPDATE employee SET birth_date = NULL WHERE id = ?").run(unknown);
    expect(feat(db, sixty)).toBeNull();
    expect(feat(db, younger)).not.toBeNull();
    expect(feat(db, unknown)).not.toBeNull();
  });

  it("sorties : démission sans date posée = sortie - 1 mois ; licenciement futur connu reste éligible ; sortie saisie après t ignorée", () => {
    const soon = fx.emp({ matricule: "S1", hire: "2020-01-01" });
    db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, '2025-07-20', 'DEMISSION', '2025-06-25')").run(soon);
    const later = fx.emp({ matricule: "S2", hire: "2020-01-01" });
    db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, '2025-08-15', 'ABANDON', '2025-06-25')").run(later);
    const fired = fx.emp({ matricule: "S3", hire: "2020-01-01" });
    db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, '2025-07-10', 'LICENCIEMENT', '2025-06-01')").run(fired);
    const unseen = fx.emp({ matricule: "S4", hire: "2020-01-01" });
    db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, '2025-06-15', 'MUTATION', '2025-07-03')").run(unseen);
    expect(feat(db, soon)).toBeNull();
    expect(feat(db, later)).not.toBeNull();
    expect(feat(db, fired)).not.toBeNull();
    expect(feat(db, unseen)).not.toBeNull();
    expect(feat(db, unseen, "2025-07-31")).toBeNull();
  });

  it("salarié inexistant : non éligible", () => {
    expect(computeFeatures(db.sqlite, 999_999, T)).toBeNull();
  });

  it("présence et contrat à t, appelés directement : sortie saisie avant t exclut, saisie après t n'exclut pas", () => {
    const gone = fx.emp({ matricule: "G1", hire: "2020-01-01" });
    db.sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, '2025-05-31', 'LICENCIEMENT', '2025-05-31')").run(gone);
    const ds = loadEmployeeDataset(db.sqlite, gone, T);
    const e = ds.byId.get(gone)!;
    expect(isActiveAt(ds, e, T)).toBe(false);
    expect(isActiveAt(ds, e, "2025-05-30")).toBe(true);
    expect(isActiveAt(ds, e, "2019-12-31")).toBe(false);
    expect(eligibleContract(ds, e, T)).toBeNull();
    expect(eligibleContract(ds, e, "2025-04-30")).toMatchObject({ type: "CDI" });
    const unseen = ds.byId.get(ds.idByMatricule.get("S4")!)!;
    expect(isActiveAt(ds, unseen, T)).toBe(true);
  });
});

describe("carrière et équipe à la date t (as-of)", () => {
  let db: TestDb;
  let fx: Fixture;
  const ids: Record<string, number> = {};
  beforeAll(() => {
    db = createTestDb();
    fx = new Fixture(db.sqlite);
    ids.mOld = fx.emp({ matricule: "MOLD", hire: "2010-01-01" });
    ids.mNew = fx.emp({ matricule: "MNEW", hire: "2010-01-01" });
    ids.w1 = fx.emp({ matricule: "W1", hire: "2020-01-01", managerId: ids.mNew, grade: "G3" });
    ids.w2 = fx.emp({ matricule: "W2", hire: "2020-01-01", managerId: ids.mOld, grade: "Cadre" });
    fx.career(ids.w1, "2025-08-01", "CHANGEMENT_MANAGER", "MOLD", "MNEW");
    fx.career(ids.w1, "2025-08-01", "PROMOTION", "G2", "G3");
    fx.career(ids.w2, "2025-06-10", "PROMOTION", "G1", "G2", "2025-07-05");
    fx.career(ids.w2, "2025-03-01", "AUGMENTATION", "n/a", "1900");
    fx.career(ids.w2, "2025-04-01", "AUGMENTATION", "1000", "1100");
  });
  afterAll(() => db.close());

  it("manager et grade avant un changement futur : valeurs « anciennes » du premier événement", () => {
    const w1 = feat(db, ids.w1)!;
    expect(w1.grade_level).toBe(2);
    expect(w1.team_size).toBe(2);
    expect(w1.manager_change_12m).toBe(0);
    expect(w1.months_since_promotion).toBe(65);
    const after = feat(db, ids.w1, "2025-09-30")!;
    expect(after.grade_level).toBe(3);
    expect(after.team_size).toBe(1);
    expect(after.manager_change_12m).toBe(1);
    expect(after.months_since_promotion).toBe(1);
    expect(feat(db, ids.w2, "2025-09-30")!.team_size).toBe(1);
  });

  it("promotion saisie après t : invisible à t ; grade non numérique imputé", () => {
    const w2 = feat(db, ids.w2)!;
    expect(w2.grade_level).toBe(1);
    expect(w2.months_since_promotion).toBe(65);
    expect(feat(db, ids.w2, "2025-07-31")!.grade_level).toBe(2);
    db.sqlite.prepare("DELETE FROM career_event WHERE employee_id = ? AND type = 'PROMOTION'").run(ids.w2);
    expect(feat(db, ids.w2)!.grade_level).toBe(1);
  });

  it("augmentation aux montants illisibles ignorée ; les autres composées", () => {
    const w2 = feat(db, ids.w2)!;
    expect(w2.raise_pct_12m).toBeCloseTo(0.1, 6);
    expect(w2.months_since_raise).toBe(2);
  });
});

describe("rémunération, formation, pointages", () => {
  let db: TestDb;
  let fx: Fixture;
  const ids: Record<string, number> = {};
  beforeAll(() => {
    db = createTestDb();
    fx = new Fixture(db.sqlite);
    const emp = (m: string, family = "FIN", grade = "G4") => (ids[m] = fx.emp({ matricule: m, hire: "2020-01-01", family, grade }));
    emp("P1");
    emp("P2");
    emp("P3");
    emp("Q1", "RH", "G1");
    emp("Q2", "RH", "G1");
    emp("NOPAY", "RH", "G9");
    fx.payroll(ids.P1, "2024-01", "2025-06", 1000);
    fx.payroll(ids.P2, "2024-01", "2025-06", (m) => (m === "2025-06" ? 9999 : 2000));
    fx.payroll(ids.P3, "2024-01", "2025-06", 3000);
    fx.payroll(ids.Q1, "2024-01", "2025-06", 1000);
    fx.payroll(ids.Q2, "2024-01", "2025-06", 3000);
    for (const id of Object.values(ids)) fx.attendance(id, "2025-01-01", T);

    fx.training(ids.P1, { mandatory: true, due: "2025-05-31", status: "TERMINEE", start: "2025-06-20", end: "2025-07-10", hours: 7 });
    fx.training(ids.P2, { mandatory: true, due: "2025-05-31", status: "TERMINEE", start: "2025-05-20", end: "2025-05-25", hours: 7 });
    fx.training(ids.P3, { mandatory: false, due: "2025-05-31", status: "PLANIFIEE" });
    fx.training(ids.P3, { status: "TERMINEE", start: "2025-03-03", end: null, hours: 4 });
    fx.training(ids.P3, { status: "TERMINEE", start: "2024-03-03", end: "2024-03-04", hours: 50 });
    fx.training(ids.P3, { status: "ABANDONNEE", start: "2025-03-03", end: "2025-03-04", hours: 30 });
    fx.training(ids.Q1, { mandatory: true, due: "2025-06-30", status: "EN_COURS" });
    fx.evaluation(ids.Q1, "2025-01-15", 4);
  });
  afterAll(() => db.close());

  it("compa-ratio : médiane famille × grade (impaire et paire), paie saisie après t ignorée, sans paie = imputé", () => {
    expect([ids.P1, ids.P2, ids.P3].map((id) => feat(db, id)!.compa_ratio)).toEqual([0.5, 1, 1.5]);
    expect([ids.Q1, ids.Q2].map((id) => feat(db, id)!.compa_ratio)).toEqual([0.5, 1.5]);
    expect(feat(db, ids.P2, "2025-07-31")!.compa_ratio).toBeCloseTo(9999 / 3000, 6);
    expect(feat(db, ids.NOPAY)!.compa_ratio).toBe(1);
  });

  it("formation obligatoire en retard jugée à t ; heures = formations terminées dans les 12 mois (date de début à défaut de fin)", () => {
    expect(feat(db, ids.P1)!.mandatory_training_overdue).toBe(1);
    expect(feat(db, ids.P1, "2025-07-31")!.mandatory_training_overdue).toBe(0);
    expect(feat(db, ids.P1)!.training_hours_12m).toBe(0);
    expect(feat(db, ids.P2)!.mandatory_training_overdue).toBe(0);
    expect(feat(db, ids.P2)!.training_hours_12m).toBe(7);
    expect(feat(db, ids.P3)!.mandatory_training_overdue).toBe(0);
    expect(feat(db, ids.P3)!.training_hours_12m).toBe(4);
    expect(feat(db, ids.Q1)!.mandatory_training_overdue).toBe(0);
    expect(feat(db, ids.Q1, "2025-07-31")!.mandatory_training_overdue).toBe(1);
  });

  it("une seule évaluation : écart nul", () => {
    expect(feat(db, ids.Q1)).toMatchObject({ last_eval_score: 4, eval_delta: 0, eval_missing: 0 });
  });

  it("absence posée uniquement sur un week-end : ni épisode, ni Bradford, ni taux", () => {
    db.sqlite.exec("SAVEPOINT we");
    try {
      fx.absence(ids.Q2, "2025-06-14", "2025-06-15", "ABSENCE_INJUSTIFIEE", "2025-06-16", 2);
      expect(feat(db, ids.Q2)).toMatchObject({ short_episodes_12m: 0, bradford_12m: 0, absence_rate_3m: 0, absence_rate_12m: 0 });
    } finally {
      db.sqlite.exec("ROLLBACK TO we; RELEASE we");
    }
  });

  it("pointages d'un jour d'arrêt maladie ignorés (heures sup, présence)", () => {
    db.sqlite.exec("SAVEPOINT sick");
    try {
      db.sqlite.prepare("UPDATE attendance_daily SET overtime_minutes = 60 WHERE employee_id = ?").run(ids.Q2);
      db.sqlite.prepare("UPDATE attendance_daily SET overtime_minutes = 900 WHERE employee_id = ? AND date BETWEEN '2025-06-02' AND '2025-06-06'").run(ids.Q2);
      fx.absence(ids.Q2, "2025-06-02", "2025-06-06", "MALADIE", "2025-06-09");
      const v = feat(db, ids.Q2)!;
      expect(v.overtime_h_avg_3m).toBeCloseTo(21.67, 6);
      expect(v.no_badge_days_3m).toBe(0);
    } finally {
      db.sqlite.exec("ROLLBACK TO sick; RELEASE sick");
    }
  });

  it("moins de 5 arrivées sur 3 mois : écart-type des arrivées imputé", () => {
    db.sqlite.exec("SAVEPOINT few");
    try {
      db.sqlite.prepare("DELETE FROM attendance_daily WHERE employee_id = ? AND date > '2025-03-31' AND date NOT IN ('2025-06-02','2025-06-03','2025-06-04')").run(ids.Q2);
      db.sqlite.prepare("UPDATE attendance_daily SET check_in = '09:30' WHERE employee_id = ? AND date = '2025-06-03'").run(ids.Q2);
      const v = feat(db, ids.Q2)!;
      expect(v.arrival_std_min_3m).toBe(0);
      expect(v.no_badge_days_3m).toBeGreaterThan(50);
    } finally {
      db.sqlite.exec("ROLLBACK TO few; RELEASE few");
    }
  });
});

describe("sans aucun pointage importé", () => {
  it("variables de temps de travail imputées, taux d'absence calculés sur le calendrier", () => {
    const db = createTestDb();
    try {
      const fx = new Fixture(db.sqlite);
      const id = fx.emp({ matricule: "N1", hire: "2020-01-01" });
      fx.absence(id, "2025-06-02", "2025-06-02", "ABSENCE_INJUSTIFIEE", "2025-06-03");
      const v = feat(db, id)!;
      expect(v).toMatchObject({ overtime_h_avg_3m: 0, late_count_3m: 0, no_badge_days_3m: 0, overtime_trend_6m: 0, arrival_std_min_3m: 0 });
      expect(v.absence_rate_3m).toBeGreaterThan(0);
      expect(v.short_episodes_12m).toBe(1);
      expect(computeFeatures(db.sqlite, id, T)!.partial).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("points d'entrée du module", () => {
  let db: TestDb;
  beforeAll(() => {
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    fx.emp({ matricule: "B1", hire: "2022-01-01" });
    fx.emp({ matricule: "B2", hire: "2024-06-15" });
  });
  afterAll(() => db.close());

  it("date de coupure au mauvais format refusée partout", () => {
    expect(() => computeFeatures(db.sqlite, 1, "2025-06")).toThrow(/Date de coupure invalide/);
    expect(() => computeFeaturesForMonth(db.sqlite, "30/06/2025")).toThrow(/Date de coupure invalide/);
    expect(() => loadEmployeeDataset(db.sqlite, 1, "")).toThrow(/Date de coupure invalide/);
  });

  it("backfill sur plus de 24 mois : découpé par blocs, une écriture par mois, rappel par mois", () => {
    const seen: [string, number][] = [];
    const total = backfillFeatures(db.sqlite, "2023-01", "2025-03", { onMonth: (m, n) => seen.push([m, n]) });
    expect(seen).toHaveLength(27);
    expect(seen[0]).toEqual(["2023-01", 1]);
    expect(seen.find(([m]) => m === "2024-06")).toEqual(["2024-06", 1]);
    expect(seen.find(([m]) => m === "2024-07")).toEqual(["2024-07", 2]);
    expect(total).toBe(seen.reduce((s, [, n]) => s + n, 0));
    expect(readSnapshots(db.sqlite, "2025-03-31").map((r) => r.employeeId)).toEqual([1, 2]);
    expect(readSnapshots(db.sqlite, "2025-03-31", "v0")).toEqual([]);
    const again = backfillFeatures(db.sqlite, "2025-03", "2025-03");
    expect(again).toBe(2);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM feature_snapshot WHERE as_of = '2025-03-31'").get()).toEqual({ n: 2 });
  });

  it("le jeu de données individuel ne charge que les sources du salarié", () => {
    const ds = loadEmployeeDataset(db.sqlite, 2, T);
    expect(ds.employees).toHaveLength(2);
    expect([...ds.absences.keys(), ...ds.trainings.keys(), ...ds.evals.keys(), ...ds.attendance.keys()].every((k) => k === 2)).toBe(true);
  });
});

describe("calendrier de travail", () => {
  it("jours fériés, ponts et week-ends de dim_date ; hors plage : lundi-vendredi", () => {
    const db = createTestDb();
    try {
      const fx = new Fixture(db.sqlite);
      fx.calendarDay("2025-05-01", { holiday: true });
      fx.calendarDay("2025-05-02", { bridge: true, ramadan: true });
      fx.calendarDay("2025-05-05", { ramadan: true, seanceUnique: true });
      fx.calendarDay("2025-05-03", {});
      const cal = WorkCalendar.load(db.sqlite, "2025-05-01", "2025-05-31");
      const d = (s: string) => toDay(s);
      expect(cal.flag(d("2025-05-01"))).toBe(CAL_HOLIDAY);
      expect(cal.flag(d("2025-05-02"))).toBe(CAL_BRIDGE | CAL_RAMADAN);
      expect(cal.flag(d("2025-05-05"))).toBe(CAL_WORKING | CAL_RAMADAN | CAL_SEANCE_UNIQUE);
      expect(cal.isWorking(d("2025-05-03"))).toBe(false);
      expect(cal.workingBetween(d("2025-05-01"), d("2025-05-09"))).toBe(5);
      expect(cal.workingBetween(d("2025-05-09"), d("2025-05-01"))).toBe(0);
      expect(cal.isWorking(d("2025-06-02"))).toBe(true);
      expect(cal.isWorking(d("2025-06-07"))).toBe(false);
      expect(cal.workingBetween(d("2025-04-28"), d("2025-05-06"))).toBe(3 + 2);
      const empty = WorkCalendar.load(db.sqlite, "2025-06-10", "2025-06-01");
      expect(empty.workingBetween(d("2025-06-02"), d("2025-06-06"))).toBe(5);
    } finally {
      db.close();
    }
  });
});

describe("contrat des variables", () => {
  it("variable inconnue refusée ; catégories visibles du manager selon le type de modèle", () => {
    expect(() => featureSpec("salaire_brut")).toThrow(/Variable inconnue : salaire_brut/);
    expect(featureSpec("compa_ratio").group).toBe("REMUNERATION");
    expect(managerVisibleGroup("ABSENCES", "LOGREG")).toBe(false);
    expect(managerVisibleGroup("ABSENCES", "B0")).toBe(false);
    expect(managerVisibleGroup("REMUNERATION", "B0")).toBe(false);
    expect(managerVisibleGroup("REMUNERATION", "LOGREG")).toBe(true);
    expect(managerVisibleGroup("TEMPS_TRAVAIL", "B0")).toBe(true);
    expect(F.team_size).toBe(FEATURE_NAMES.length - 1);
  });
});

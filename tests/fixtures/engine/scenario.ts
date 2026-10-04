import { Fixture } from "./db";

export const T = "2025-06-30";

// Équipe de référence : manager M, salariés A (cas détaillé), B, C, D (démission en mars 2025), E (arrivé en mars 2025).
export function buildTeamScenario(fx: Fixture) {
  const dept = fx.dept("D1", "Production");
  const m = fx.emp({ matricule: "M1", hire: "2015-01-01", dept, family: "ENC", grade: "G5" });
  const a = fx.emp({ matricule: "A1", hire: "2024-02-15", birth: "1990-05-01", dept, grade: "G2", managerId: m });
  const b = fx.emp({ matricule: "B1", hire: "2020-01-01", dept, grade: "G2", managerId: m });
  const c = fx.emp({ matricule: "C1", hire: "2020-01-01", dept, grade: "G2", managerId: m });
  const d = fx.emp({ matricule: "D1", hire: "2019-01-01", dept, grade: "G2", managerId: m });
  const e = fx.emp({ matricule: "E1", hire: "2025-03-10", dept, grade: "G1", managerId: m });

  for (const id of [m, b, c, d]) fx.attendance(id, "2024-01-01", id === d ? "2025-03-31" : T);
  fx.exit(d, "2025-03-31", "DEMISSION", { resignation: "2025-03-01", recordedAt: "2025-04-02" });

  const skipA = new Set(["2025-05-12", "2025-05-13", "2025-06-02", "2025-06-03", "2025-04-14", "2025-04-15", "2025-05-19", "2025-05-20", "2025-05-21", "2024-09-02", "2024-09-03", "2024-09-04", "2024-09-05", "2024-09-06"]);
  const lateA = new Set(["2025-04-07", "2025-04-22", "2025-05-06", "2025-06-10"]);
  fx.attendance(a, "2024-02-15", T, {
    skip: (dt) => skipA.has(dt),
    overtime: () => 60,
    late: (dt) => (lateA.has(dt) ? 15 : dt.endsWith("-09") ? 5 : 0),
    checkIn: (dt) => (lateA.has(dt) ? "08:15" : "08:00"),
  });
  fx.absence(a, "2025-06-02", "2025-06-02", "ABSENCE_INJUSTIFIEE", "2025-06-03");
  fx.absence(a, "2025-06-03", "2025-06-03", "CONGE_ANNUEL", "2025-05-20");
  fx.absence(a, "2025-04-14", "2025-04-15", "CONGE_SANS_SOLDE", "2025-04-01");
  fx.absence(a, "2025-05-19", "2025-05-21", "MALADIE", "2025-05-22");
  fx.absence(a, "2024-09-02", "2024-09-06", "AUTRE", "2024-09-10");
  fx.absence(a, "2025-06-20", "2025-06-20", "ABSENCE_INJUSTIFIEE", "2025-07-02");

  fx.payroll(a, "2024-02", "2025-06", 1800);
  fx.payroll(b, "2020-01", "2025-06", 2000);
  fx.payroll(c, "2020-01", "2025-06", 2200);
  fx.payroll(m, "2020-01", "2025-06", 4000);
  fx.payroll(e, "2025-03", "2025-06", 1500);

  fx.career(a, "2025-03-10", "CHANGEMENT_POSTE", "Technicien", "Technicien senior", "2025-03-12");
  fx.career(a, "2024-12-01", "AUGMENTATION", "1700", "1800", "2024-12-05");
  fx.career(a, "2025-06-25", "AUGMENTATION", "1800", "1900", "2025-07-03");

  fx.training(a, { status: "TERMINEE", start: "2025-01-15", end: "2025-01-20", hours: 14 });
  fx.training(a, { status: "TERMINEE", start: "2024-04-29", end: "2024-05-01", hours: 7 });
  fx.training(a, { status: "EN_COURS", mandatory: true, start: "2025-05-01", due: "2025-05-31", hours: 10 });

  fx.evaluation(a, "2024-12-15", 3.5, "2025-01-10");
  fx.evaluation(a, "2025-06-20", 3, "2025-07-15");

  fx.attendance(e, "2025-03-10", T, { skip: (dt) => dt === "2025-05-05" });
  fx.absence(e, "2025-05-05", "2025-05-05", "ABSENCE_INJUSTIFIEE", "2025-05-06");

  return { dept, m, a, b, c, d, e };
}

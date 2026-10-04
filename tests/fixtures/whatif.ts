import { Fixture } from "./engine/db";
import { buildTeamScenario, T } from "./engine/scenario";

export { T };
export const ORIGIN = "2024-11-30";

// Équipe de référence + F (G2 sous-payé, heures sup élevées, jamais promu : 4 points B0 au 30/06/2025) et deux G3 servant
// de référence salariale à la promotion. D (démission posée le 01/03/2025) : paie basse et heures sup, 4 points au 30/11/2024.
export function buildWhatIfScenario(fx: Fixture) {
  const ids = buildTeamScenario(fx);
  const f = fx.emp({ matricule: "F1", hire: "2015-01-01", dept: ids.dept, grade: "G2", managerId: ids.m });
  const g = fx.emp({ matricule: "G1", hire: "2018-01-01", dept: ids.dept, grade: "G3", managerId: ids.m });
  const h = fx.emp({ matricule: "H1", hire: "2018-01-01", dept: ids.dept, grade: "G3", managerId: ids.m });
  fx.payroll(f, "2023-06", "2025-06", 1500);
  fx.payroll(g, "2023-06", "2025-06", 2600);
  fx.payroll(h, "2023-06", "2025-06", 2800);
  fx.payroll(ids.d, "2023-06", "2025-03", 1500);
  fx.attendance(f, "2024-06-01", T, { overtime: () => 90 });
  fx.attendance(g, "2024-06-01", T);
  fx.attendance(h, "2024-06-01", T);
  fx.sqlite.prepare("UPDATE attendance_daily SET overtime_minutes = 90 WHERE employee_id = ?").run(ids.d);
  return { ...ids, f, g, h };
}

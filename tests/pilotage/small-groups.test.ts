import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccessContext } from "@/lib/dal/context";
import { dashboardQuerySchema, getDashboard } from "@/lib/dal/dashboard";
import { absenteeismQuerySchema, getAbsenteeism } from "@/lib/dal/absenteeism";
import { getEmployeeDetail, type EmployeeDetailRh } from "@/lib/dal/employees";
import { smallGroupMask } from "@/lib/dal/pilotage-metrics";
import { setSetting } from "@/lib/settings";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, managerCtx, rhCtx, setupSeededDb } from "./setup";

let file = "";
let seed: SeedResult;
let solo: AccessContext;
let split: AccessContext;
let seq = 0;
let deptA = 0;
let deptB = 0;

// Salarié avec un contrat courant et une absence non planifiée récente (hors santé)
function emp(managerId: number | null, contract: "CDI" | "CDD", department?: number): number {
  const s = db();
  const dept = department ?? (s.prepare("SELECT id FROM department ORDER BY id LIMIT 1").get() as { id: number }).id;
  const id = Number(
    s
      .prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id, birth_date) VALUES (?, ?, 'Test', '2019-01-07', ?, ?, '1985-01-01')")
      .run(`PG${++seq}`, `Petit${seq}`, dept, managerId).lastInsertRowid,
  );
  s.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, ?, '2019-01-07')").run(id, contract);
  s.prepare("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, recorded_at) VALUES (?, '2026-07-07', '2026-07-08', 2, 'ABSENCE_INJUSTIFIEE', '2026-07-09')").run(id);
  return id;
}
const mgr = (employeeId: number): AccessContext => ({ userId: seed.managerUserId, login: "mgr.test", role: "MANAGER", employeeId });

beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("small"));
  const m1 = emp(null, "CDI");
  emp(m1, "CDI");
  solo = mgr(m1);
  // M2 > L1 (6 CDD), L2 (2 CDI) : équipes de 2 (M2), 6 (L1) et 2 (L2), périmètre de 10 ; département A = L1 et son
  // équipe (7), département B = L2 et son équipe (3)
  deptA = Number(db().prepare("INSERT INTO department (code, name) VALUES ('PGA', 'Petit groupe A')").run().lastInsertRowid);
  deptB = Number(db().prepare("INSERT INTO department (code, name) VALUES ('PGB', 'Petit groupe B')").run().lastInsertRowid);
  const m2 = emp(null, "CDI");
  const l1 = emp(m2, "CDI", deptA);
  const l2 = emp(m2, "CDI", deptB);
  for (let i = 0; i < 6; i++) emp(l1, "CDD", deptA);
  for (let i = 0; i < 2; i++) emp(l2, "CDI", deptB);
  split = mgr(m2);
});
afterAll(() => cleanupDb(file));

describe("garde des petits groupes (vue manager)", () => {
  it("masquage secondaire : les groupes masqués totalisent toujours au moins K personnes", () => {
    expect(smallGroupMask([10, 10])).toEqual([false, false]);
    expect(smallGroupMask([6, 5, 2])).toEqual([false, true, true]);
    expect(smallGroupMask([6, 2, 2])).toEqual([true, true, true]);
    expect(smallGroupMask([8, 0, 7], [false, false, true])).toEqual([false, false, true]);
    expect(smallGroupMask([8, 6], [false, false], 5)).toEqual([false, false]);
  });

  it("tableau de bord : population d'un seul salarié -> ni taux d'absence, ni turnover, ni sorties", () => {
    const d = getDashboard(solo, dashboardQuerySchema.parse({ periode: "24m" }));
    expect(d.view).toBe("MANAGER");
    expect(d.kpis.headcount).toBe(1);
    expect(d.smallPopulation).toBe(true);
    expect(d.kpis).toMatchObject({ absenteeismRate: null, exits: null, voluntaryExits: null, turnover12: null, turnover12Voluntary: null });
    expect(d.series.length).toBe(24);
    expect(d.series.every((s) => s.absenteeismRate === null && s.turnover12 === null && s.turnover12Voluntary === null)).toBe(true);
  });

  it("tableau de bord : un filtre qui isole un petit groupe, ou son complément, est masqué", () => {
    const all = getDashboard(split, dashboardQuerySchema.parse({}));
    expect(all.smallPopulation).toBe(false);
    expect(all.kpis.absenteeismRate).not.toBeNull();
    for (const departement of [deptA, deptB]) {
      const d = getDashboard(split, dashboardQuerySchema.parse({ departement }));
      expect(d.smallPopulation).toBe(true);
      expect(d.kpis.absenteeismRate).toBeNull();
      expect(d.series.every((s) => s.absenteeismRate === null)).toBe(true);
    }
  });

  it("tableau de bord manager : filtres contrat, âge et ancienneté ignorés (pas de recoupement), signalés ; conservés pour la RH", () => {
    const all = getDashboard(split, dashboardQuerySchema.parse({}));
    const d = getDashboard(split, dashboardQuerySchema.parse({ contrat: "CDD", age: "30-39", anciennete: "5-10" }), ["periode"]);
    expect(d.ignored).toEqual(["periode", "contrat", "age", "anciennete"]);
    expect(d.filters).toEqual([]);
    expect(d.smallPopulation).toBe(false);
    expect(d.kpis).toEqual(all.kpis);
    expect(d.series).toEqual(all.series);
    const rh = getDashboard(rhCtx(seed), dashboardQuerySchema.parse({ contrat: "CDD" }));
    expect(rh.ignored).toEqual([]);
    expect(rh.filters.map((f) => f.key)).toEqual(["contrat"]);
  });

  it("le seed de démo (périmètre large) et la RH ne sont pas masqués", () => {
    expect(getDashboard(managerCtx(seed), dashboardQuerySchema.parse({})).smallPopulation).toBe(false);
    const rh = getDashboard(rhCtx(seed), dashboardQuerySchema.parse({ contrat: "CDD" }));
    expect(rh.smallPopulation).toBe(false);
    expect(rh.kpis.absenteeismRate).not.toBeNull();
  });

  it("absentéisme : total masqué sous K ; une petite équipe et celle qui la révélerait par différence sont masquées", () => {
    const a = getAbsenteeism(solo, absenteeismQuerySchema.parse({}));
    expect(a.total).toMatchObject({ masked: true, rate: null, absenceDays: null, workableDays: null });
    expect(a.total.rates.every((r) => r === null)).toBe(true);
    expect(a.series.every((s) => s.masked)).toBe(true);

    const b = getAbsenteeism(split, absenteeismQuerySchema.parse({ granularite: "mois" }));
    expect(b.total.masked).toBe(false);
    expect(b.total.absenceDays).toBeGreaterThan(0);
    expect(b.series).toHaveLength(3);
    expect(b.series.every((s) => s.masked && s.rate === null && s.absenceDays === null && s.rates.every((r) => r === null))).toBe(true);

    const demo = getAbsenteeism(managerCtx(seed), absenteeismQuerySchema.parse({}));
    expect(demo.series.some((s) => !s.masked)).toBe(true);
    for (const s of demo.series.filter((x) => !x.masked)) expect(s.activeMembers).toBeGreaterThanOrEqual(5);
  });
});

describe("catégories de facteurs et actions montrées au manager", () => {
  it("jamais « Assiduité » ; « Rémunération » ni la revue salariale avec un score à règles", () => {
    const s = db();
    const id = (s.prepare(`SELECT id FROM employee WHERE manager_id = ? AND status = 'ACTIF' LIMIT 1`).get(seed.managerEmployeeId) as { id: number }).id;
    const model = Number(s.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('b0-factors', 'B0', 'CANDIDAT', 'v1')").run().lastInsertRowid);
    const run = Number(s.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored) VALUES ('2026-08-31', ?, 'PUBLIE', 1)").run(model).lastInsertRowid);
    const pred = Number(
      s.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, '2026-08-31', 4, 'ELEVE', 1, 3, ?)").run(run, id, model)
        .lastInsertRowid,
    );
    const f = s.prepare("INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction, phrase_rh, phrase_manager) VALUES (?, ?, ?, ?, 'HAUSSE', ?, ?)");
    f.run(pred, "REMUNERATION", 2, 1, "Salaire à 85 % de la médiane du poste", "Rémunération");
    f.run(pred, "ABSENCES", 1, 2, "Taux d'absence hors santé de 5 % sur 3 mois", "Assiduité");
    f.run(pred, "TEMPS_TRAVAIL", 1, 3, "22 h supplémentaires par mois en moyenne", "Charge de travail");
    s.prepare("INSERT INTO recommendation (employee_id, prediction_id, action_code, trigger_group) VALUES (?, ?, 'REVISION_SALARIALE', 'REMUNERATION')").run(id, pred);
    s.prepare("INSERT INTO recommendation (employee_id, prediction_id, action_code, trigger_group) VALUES (?, ?, 'CHARGE_TRAVAIL', 'TEMPS_TRAVAIL')").run(id, pred);
    try {
      setSetting(s, "current_run_id", String(run));
      const m = getEmployeeDetail(managerCtx(seed), id, { source: "page" });
      expect(m.view === "MANAGER" && m.estimation.status === "OK" && m.estimation.factors).toEqual([{ phrase: "Charge de travail" }]);
      expect(m.recommendations.some((r) => r.actionCode === "REVISION_SALARIALE")).toBe(false);
      expect(m.recommendations.some((r) => r.actionCode === "CHARGE_TRAVAIL")).toBe(true);
      expect(JSON.stringify(m)).not.toMatch(/Assiduit|Rémunération|REVISION_SALARIALE/);

      const rh = getEmployeeDetail(rhCtx(seed), id, { source: "page" }) as EmployeeDetailRh;
      expect(rh.estimation.status === "OK" && rh.estimation.factors.map((x) => x.group)).toEqual(["REMUNERATION", "ABSENCES", "TEMPS_TRAVAIL"]);
      expect(rh.recommendations.some((r) => r.actionCode === "REVISION_SALARIALE")).toBe(true);

      s.prepare("UPDATE model_version SET kind = 'LOGREG' WHERE id = ?").run(model);
      const logreg = getEmployeeDetail(managerCtx(seed), id, { source: "page" });
      expect(logreg.estimation.status === "OK" && logreg.estimation.factors).toEqual([{ phrase: "Rémunération" }, { phrase: "Charge de travail" }]);
    } finally {
      setSetting(s, "current_run_id", String(seed.currentRunId));
    }
  });
});

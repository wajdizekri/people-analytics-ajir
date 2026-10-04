import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { absenteeismQuerySchema, getAbsenteeism } from "@/lib/dal/absenteeism";
import { dashboardQuerySchema, getDashboard, restrictDashboardQuery, type DashboardRh } from "@/lib/dal/dashboard";
import { parseQuery } from "@/lib/dal/employees";
import { setSetting } from "@/lib/settings";
import { buildWorld, openDalDb, publishRun, REF } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
const extraDepts: number[] = [];
let noDept = 0;

beforeAll(() => {
  db = openDalDb("dal-pilotage");
  w = buildWorld(db.sqlite);
  const { fx, e } = w;
  for (const id of [e.T1, e.T2, e.T3, e.T5, e.S1, e.S2]) fx.absence(id, "2025-06-02", "2025-06-03", "ABSENCE_INJUSTIFIEE");
  fx.absence(e.T1, "2025-05-12", "2025-05-16", "MALADIE");
  fx.absence(e.T2, "2025-05-12", "2025-05-16", "CONGE_ANNUEL");
  for (let i = 0; i < 7; i++) {
    const d = fx.dept(`D${i}`, `Service ${String.fromCharCode(65 + i)}`);
    extraDepts.push(d);
    fx.emp({ matricule: `Z${i}`, hire: "2020-01-01", dept: d, managerId: e.MGR2 });
  }
  noDept = fx.emp({ matricule: "ND", hire: "2020-01-01", dept: null });
  const anomaly = getDb().sqlite.prepare(
    "INSERT INTO anomaly (scope, department_id, manager_id, employee_id, period_start, period_end, metric, observed, score, message) VALUES (?, ?, ?, ?, ?, ?, 'absence_rate', 0.1, 3, ?)",
  );
  anomaly.run("EQUIPE", w.dept.prod, e.MGR, null, "2025-06-02", "2025-06-08", "équipe MGR");
  anomaly.run("EQUIPE", null, e.SUB, null, "2025-06-09", "2025-06-15", "équipe SUB");
  anomaly.run("EQUIPE", w.dept.com, e.MGR2, null, "2025-06-09", "2025-06-15", "équipe MGR2");
  anomaly.run("DEPARTEMENT", w.dept.prod, null, null, "2025-06-02", "2025-06-08", "département PROD");
  anomaly.run("EQUIPE", w.dept.prod, e.MGR, null, "2024-01-01", "2024-01-07", "trop ancien");
  anomaly.run("SALARIE", null, null, e.T1, "2025-06-02", "2025-06-15", "signal T1");
  anomaly.run("SALARIE", null, null, e.MGR2, "2025-06-02", "2025-06-15", "signal MGR2");
});
afterAll(() => db.close());

const abs = (ctx: keyof typeof w.ctx, raw: Record<string, string> = {}) => getAbsenteeism(w.ctx[ctx], parseQuery(absenteeismQuerySchema, raw, "strict").data);
const dash = (ctx: keyof typeof w.ctx, raw: Record<string, string> = {}) => getDashboard(w.ctx[ctx], parseQuery(dashboardQuerySchema, raw, "strict").data);

describe("absentéisme", () => {
  it("RH par département : 8 séries au plus (les autres comptées), « Sans département », signaux individuels et anomalies collectives", () => {
    const r = abs("rh");
    if (r.view !== "RH") throw new Error(r.view);
    expect(r.axis).toBe("departement");
    expect(r.buckets).toHaveLength(26);
    expect(r.window.to).toBe(REF);
    expect(r.series).toHaveLength(8);
    expect(r.hiddenSeries).toBe(10 - 8);
    expect(r.series[0].label).toBe("Production");
    expect(r.series[0].rate).toBeGreaterThan(0);
    const labels = [...r.series.map((s) => s.label)];
    expect(labels.slice(1)).toEqual([...labels.slice(1)].sort((a, b) => a.localeCompare(b)));
    expect(r.total.label).toBe("Ensemble de l'entreprise");
    expect(r.total.absenceDays).toBe(12);
    expect(r.individual.map((s) => s.message).sort()).toEqual(["signal MGR2", "signal T1"]);
    expect(r.collective.map((c) => [c.scope, c.groupLabel])).toEqual([
      ["EQUIPE", "Équipe de NomMGR2 PrenomMGR2 (Commercial)"],
      ["EQUIPE", "Équipe de NomSUB PrenomSUB"],
      ["DEPARTEMENT", "Production"],
      ["EQUIPE", "Équipe de NomMGR PrenomMGR (Production)"],
    ]);
    expect(r.series.find((s) => s.label === "Sans département")).toMatchObject({ key: "0", activeMembers: 1, rate: 0 });
    expect(labels).not.toContain("Service F");
    expect(labels).not.toContain("Service G");
    expect(noDept).toBeGreaterThan(0);
  });

  it("RH filtré sur un département ; axe équipe ; granularité mensuelle", () => {
    const r = abs("rh", { departement: String(w.dept.com), granularite: "mois" });
    if (r.view !== "RH") throw new Error();
    expect(r.buckets).toHaveLength(12);
    expect(r.buckets.at(-1)).toEqual({ key: "2025-06", from: "2025-06-01", to: REF });
    expect(r.total.label).toBe("Ensemble du département");
    expect(r.series.map((s) => s.label)).toEqual(["Commercial"]);
    expect(r.individual.map((s) => s.message)).toEqual(["signal MGR2"]);
    expect(r.collective.map((c) => c.message)).toEqual(["équipe MGR2"]);
    const teams = abs("rh", { axe: "equipe" });
    expect(teams.axis).toBe("equipe");
    expect(teams.series.map((s) => s.label)).toEqual(expect.arrayContaining(["Équipe de NomMGR PrenomMGR", "Équipe de NomSUB PrenomSUB"]));
  });

  it("manager : axe équipe imposé, petites équipes masquées (et celle qui les révélerait), anomalies de son équipe et de ses sous-équipes seulement", () => {
    const r = abs("mgr", { axe: "departement", departement: String(w.dept.com) });
    expect(r.view).toBe("MANAGER");
    expect(r.axis).toBe("equipe");
    expect(r.total).toMatchObject({ label: "Ensemble de mon périmètre", masked: false });
    expect(r.total.rate).toBeGreaterThan(0);
    expect(r.series.map((s) => [s.label, s.masked]).sort()).toEqual([
      ["Équipe de NomMGR PrenomMGR", true],
      ["Équipe de NomSUB PrenomSUB", true],
    ]);
    for (const s of r.series) expect([s.rate, s.absenceDays, s.workableDays, ...s.rates].every((x) => x === null)).toBe(true);
    expect(r.collective.map((c) => c.message).sort()).toEqual(["équipe MGR", "équipe SUB"]);
    expect("individual" in r).toBe(false);
  });

  it("manager d'une équipe de moins de 5 : total masqué ; manager sans salarié : périmètre vide", () => {
    const r = abs("sub");
    expect(r.total).toMatchObject({ masked: true, rate: null, absenceDays: null });
    expect(r.collective.map((c) => c.message)).toEqual(["équipe SUB"]);
    const o = abs("orphan");
    expect(o.series).toEqual([]);
    expect(o.total).toMatchObject({ activeMembers: 0, rate: null });
    expect(o.collective).toEqual([]);
  });
});

describe("tableau de bord", () => {
  beforeAll(() => {
    publishRun(getDb().sqlite, "B0", REF, [
      { employeeId: w.e.T1, level: "ELEVE", prob6: 3, lift: 3 },
      { employeeId: w.e.T2, level: "MOYEN", prob6: 2, lift: 2 },
      { employeeId: noDept, level: "FAIBLE", prob6: 0, lift: 0 },
    ]);
    const ins = getDb().sqlite.prepare(
      `INSERT INTO agg_kpi_monthly (month, department_id, headcount, entries, exits, voluntary_exits, absence_days_non_health, absence_days_health, workable_days,
        late_count, overtime_hours, payroll_mass, training_hours, trainings_done, trainings_due) VALUES (?, ?, 10, 1, 0, 0, 2, 1, 200, 0, 0, 30000, 0, 1, 2)`,
    );
    ins.run("2025-05", w.dept.prod);
    ins.run("2025-06", w.dept.prod);
    ins.run("2025-06", w.dept.com);
  });

  it("RH sans filtre de population : agrégats, masse salariale, risque par département (score à règles : pas de lift)", () => {
    const d = dash("rh", { periode: "3m" }) as DashboardRh;
    expect(d).toMatchObject({ view: "RH", source: "AGREGATS", smallPopulation: false, period: { key: "3m", from: "2025-04", to: "2025-06" } });
    expect(d.kpis).toMatchObject({ headcount: 20, entries: 3, absenteeismRate: 6 / 600, mandatoryTraining: { done: 3, due: 6, rate: 0.5 } });
    expect(d.payroll).toMatchObject({ month: "2025-06", lastMonth: 60000, periodTotal: 90000 });
    expect(d.series.map((s) => s.month)).toEqual(["2025-04", "2025-05", "2025-06"]);
    expect(d.series[0]).toMatchObject({ headcount: 0, absenteeismRate: null, turnover12: null });
    expect(d.risk).toMatchObject({ modelKind: "B0", totals: { ELEVE: 1, MOYEN: 1, FAIBLE: 1 } });
    expect(d.risk!.byDepartment.find((r) => r.departmentId === null)).toMatchObject({ name: "Sans département", FAIBLE: 1, avgLift: null });
    const prod = dash("rh", { departement: String(w.dept.prod) }) as DashboardRh;
    expect(prod.source).toBe("AGREGATS");
    expect(prod.kpis.headcount).toBe(10);
    expect(prod.filters).toEqual([{ key: "departement", label: "Département", value: "Production" }]);
  });

  it("RH filtré par contrat, âge, ancienneté : calcul détaillé depuis les sources ; filtres décrits ; niveau de risque", () => {
    const d = dash("rh", { contrat: "CDI", age: "30-39", anciennete: "5-10", niveau: "MOYEN", departement: "999" }) as DashboardRh;
    expect(d.source).toBe("DETAIL");
    expect(d.filters).toEqual([
      { key: "departement", label: "Département", value: "n° 999" },
      { key: "contrat", label: "Contrat", value: "CDI" },
      { key: "age", label: "Âge", value: "30 à 39 ans" },
      { key: "anciennete", label: "Ancienneté", value: "5 à 10 ans" },
      { key: "niveau", label: "Niveau de risque", value: "Moyen" },
    ]);
    expect(d.risk!.totals).toEqual({ ELEVE: 0, MOYEN: 0, FAIBLE: 0, nonScored: 0 });
    const t2 = dash("rh", { contrat: "CDI", age: "30-39", anciennete: "5-10", niveau: "MOYEN" }) as DashboardRh;
    expect(t2.risk!.totals.MOYEN).toBe(1);
    expect(t2.kpis.headcount).toBeGreaterThan(0);
  });

  it("modèle LOGREG : lift moyen par département pour la RH", () => {
    const run = publishRun(getDb().sqlite, "LOGREG", REF, [
      { employeeId: w.e.T1, level: "ELEVE", prob6: 0.3, lift: 6 },
      { employeeId: w.e.T3, level: "FAIBLE", prob6: 0.01, lift: 0.2 },
    ]);
    const d = dash("rh") as DashboardRh;
    expect(d.risk!.byDepartment.find((r) => r.name === "Production")!.avgLift).toBeCloseTo(3.1, 12);
    expect(run).toBeGreaterThan(0);
  });

  it("manager : filtres contrat/âge/ancienneté retirés et signalés, périmètre seul, sans masse salariale ni version de modèle", () => {
    expect(restrictDashboardQuery(w.ctx.rh, dashboardQuerySchema.parse({ contrat: "CDD" })).dropped).toEqual([]);
    const d = getDashboard(w.ctx.mgr, dashboardQuerySchema.parse({ contrat: "CDD", age: "moins-30" }), ["periode"]);
    expect(d.view).toBe("MANAGER");
    expect(d.ignored.sort()).toEqual(["age", "contrat", "periode"]);
    expect(d.filters).toEqual([]);
    expect(d.source).toBe("DETAIL");
    expect(Object.keys(d)).not.toContain("payroll");
    expect(Object.keys(d.risk!)).toEqual(["asOf", "totals", "byDepartment"]);
    expect(d.risk!.byDepartment.map((r) => r.name)).toEqual(["Production"]);
    expect(Object.keys(d.risk!.byDepartment[0])).not.toContain("avgLift");
  });

  it("fin des données absente : dernier mois des agrégats, sinon le mois courant", () => {
    setSetting(getDb().sqlite, "data_end_date", "");
    try {
      expect(dash("rh").period.to).toBe("2025-06");
      getDb().sqlite.prepare("DELETE FROM agg_kpi_monthly").run();
      expect(dash("rh").period.to).toBe(new Date().toISOString().slice(0, 7));
    } finally {
      setSetting(getDb().sqlite, "data_end_date", REF);
    }
  });
});

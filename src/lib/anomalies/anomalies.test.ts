import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../../../tests/fixtures/engine/db";
import { buildAbsenceScenario } from "../../../tests/fixtures/engine/absences";
import { MIN_GROUP_SIZE as DASHBOARD_MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { detectAnomalies, isoWeek, MIN_GROUP_SIZE, parseWeek, weeklySeries } from "./index";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

type Row = { scope: string; managerId: number | null; departmentId: number | null; employeeId: number | null; periodStart: string; message: string };
const anomalies = (d: TestDb) =>
  d.sqlite
    .prepare("SELECT scope, manager_id AS managerId, department_id AS departmentId, employee_id AS employeeId, period_start AS periodStart, message FROM anomaly ORDER BY id")
    .all() as Row[];

describe("semaines", () => {
  it("ISO et dates", () => {
    expect(isoWeek(parseWeek("2025-W19"))).toBe("2025-W19");
    expect(isoWeek(parseWeek("2025-05-08"))).toBe("2025-W19");
    expect(isoWeek(parseWeek("2024-12-30"))).toBe("2025-W01");
  });
});

describe("anomalies collectives", () => {
  it("pic de deux semaines détecté dans l'équipe, alerte MANAGER dédupliquée", () => {
    db = createTestDb();
    const s = buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: true });
    const n = detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23");
    const rows = anomalies(db);
    expect(n).toBe(rows.length);
    const team = rows.filter((r) => r.scope === "EQUIPE");
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ managerId: s.m1, departmentId: s.dept, periodStart: "2025-05-05" });
    expect(team[0].message).toMatch(/équipe de PrenomM1 NomM1/);
    const alert = db.sqlite.prepare("SELECT audience, manager_id AS m, dedup_key AS k FROM alert WHERE type = 'ABSENTEISME' AND manager_id = ?").get(s.m1);
    expect(alert).toEqual({ audience: "MANAGER", m: s.m1, k: `absenteisme:T${s.m1}:2025-05-05` });
    expect(detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23")).toBe(0);
  });

  it("Ramadan non signalé grâce au facteur calendrier", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: true, spike: false });
    detectAnomalies(db.sqlite, "2024-09-02", "2025-06-23");
    expect(anomalies(db).filter((r) => r.scope !== "SALARIE")).toEqual([]);
    const ramadanWeeks = weeklySeries(db.sqlite, "D1", "2025-03-03", "2025-03-24");
    expect(ramadanWeeks.every((w) => w.weekClass === "RAMADAN" && w.z! < 3.5)).toBe(true);
  });

  it("ablation : sans calendrier, la hausse du Ramadan serait signalée", () => {
    db = createTestDb();
    buildAbsenceScenario(new Fixture(db.sqlite), { ramadanFlag: false, spike: false });
    detectAnomalies(db.sqlite, "2024-09-02", "2025-06-23");
    const march = anomalies(db).filter((r) => r.scope !== "SALARIE" && r.periodStart >= "2025-02-24" && r.periodStart <= "2025-03-31");
    expect(march.length).toBeGreaterThan(0);
  });

  it("équipes de moins de 5 personnes (seuil des petites populations) non suivies séparément", () => {
    expect(MIN_GROUP_SIZE).toBe(5);
    expect(MIN_GROUP_SIZE).toBe(DASHBOARD_MIN_GROUP_SIZE);
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    const dept = fx.dept("X");
    const m = fx.emp({ matricule: "MX", hire: "2020-01-01", dept });
    const small = [0, 1, 2, 3].map((i) => fx.emp({ matricule: `S${i}`, hire: "2020-01-01", dept, managerId: m }));
    for (const id of small) fx.absence(id, "2025-05-05", "2025-05-16", "ABSENCE_INJUSTIFIEE", "2025-05-17");
    fx.absence(m, "2024-01-08", "2024-01-08", "AUTRE");
    detectAnomalies(db.sqlite, "2025-01-06", "2025-06-23");
    expect(anomalies(db).filter((r) => r.scope === "EQUIPE")).toEqual([]);
    expect(anomalies(db).filter((r) => r.scope === "DEPARTEMENT").map((r) => r.periodStart)).toEqual(["2025-05-05"]);
  });
});

describe("signal individuel Bradford", () => {
  it("au-dessus du seuil : anomalie SALARIE, alerte RH « à vérifier » ; santé exclue", () => {
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    const dept = fx.dept("Y");
    const m = fx.emp({ matricule: "MY", hire: "2020-01-01", dept });
    const a = fx.emp({ matricule: "A", hire: "2020-01-01", dept, managerId: m });
    const b = fx.emp({ matricule: "B", hire: "2020-01-01", dept, managerId: m });
    const starts = ["2024-08-05", "2024-10-07", "2024-12-02", "2025-02-03", "2025-04-07", "2025-06-02"];
    for (const d of starts) {
      const end = d.slice(0, 8) + String(Number(d.slice(8)) + 1).padStart(2, "0");
      fx.absence(a, d, end, "ABSENCE_INJUSTIFIEE");
      fx.absence(b, d, end, "MALADIE");
    }
    fx.absence(b, "2025-03-03", "2025-03-03", "CONGE_ANNUEL");
    detectAnomalies(db.sqlite, "2025-06-16", "2025-06-23");
    const rows = anomalies(db).filter((r) => r.scope === "SALARIE");
    expect(rows.map((r) => r.employeeId)).toEqual([a]);
    expect(rows[0].message).toMatch(/Bradford de 432/);
    expect(rows[0].message).toMatch(/vérifier/);
    const alert = db.sqlite.prepare("SELECT audience, employee_id AS e FROM alert WHERE dedup_key LIKE 'bradford:%'").all();
    expect(alert).toEqual([{ audience: "RH", e: a }]);
    detectAnomalies(db.sqlite, "2025-06-16", "2025-06-23");
    expect(anomalies(db).filter((r) => r.scope === "SALARIE")).toHaveLength(1);
  });

  it("seuil réglable", () => {
    db = createTestDb();
    const fx = new Fixture(db.sqlite);
    const a = fx.emp({ matricule: "A", hire: "2020-01-01" });
    for (const d of ["2025-01-06", "2025-02-03", "2025-03-03"]) fx.absence(a, d, d, "AUTRE");
    detectAnomalies(db.sqlite, "2025-06-23", "2025-06-23");
    expect(anomalies(db)).toHaveLength(0);
    db.sqlite.prepare("UPDATE app_setting SET value = '20' WHERE key = 'bradford_threshold'").run();
    detectAnomalies(db.sqlite, "2025-06-23", "2025-06-23");
    expect(anomalies(db).map((r) => r.scope)).toEqual(["SALARIE"]);
  });
});

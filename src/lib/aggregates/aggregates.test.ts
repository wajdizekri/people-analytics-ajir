import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCalendar } from "@/lib/calendar";
import { runImport } from "@/lib/import";
import { FIXTURE_DIR, tempDb } from "@/lib/import/test-db";
import { dataMonths, refreshAggregates } from "./index";

type Row = Record<string, number | string>;

describe("refreshAggregates sur la mini-fixture", () => {
  const db = tempDb();
  const { sqlite } = db;
  const kpi = (month: string, code: string) =>
    sqlite
      .prepare("SELECT a.* FROM agg_kpi_monthly a JOIN department d ON d.id = a.department_id WHERE a.month = ? AND d.code = ?")
      .get(month, code) as Row | undefined;

  beforeAll(async () => {
    await runImport(sqlite, FIXTURE_DIR);
    buildCalendar(sqlite, 2023, 2026);
  });
  afterAll(() => db.close());

  it("couvre les mois des données", () => {
    const months = dataMonths(sqlite);
    expect(months[0]).toBe("2023-06");
    expect(months[months.length - 1]).toBe("2026-02");
    expect(refreshAggregates(sqlite)).toBe(months.length * 3);
  });

  // Jours ouvrables proratisés par salarié (embauche <= jour <= sortie) : E004, sorti le 31/01, compte ses 21 jours.
  it("INF janvier 2026 : effectif, sorties, absences, jours ouvrables, temps, paie, formation", () => {
    expect(kpi("2026-01", "INF")).toMatchObject({
      headcount: 5,
      entries: 0,
      exits: 1,
      voluntary_exits: 1,
      absence_days_non_health: 3,
      absence_days_health: 2,
      workable_days: 126,
      late_count: 2,
      overtime_hours: 1.5,
      payroll_mass: 15650,
      training_hours: 21,
      trainings_done: 1,
      trainings_due: 2,
    });
  });

  it("formations obligatoires : réalisées = échéances du mois terminées (hors formations facultatives)", () => {
    const over = sqlite.prepare("SELECT COUNT(*) AS n FROM agg_kpi_monthly WHERE trainings_done > trainings_due").get() as { n: number };
    expect(over.n).toBe(0);
    expect(kpi("2026-02", "COM")).toMatchObject({ trainings_done: 0, trainings_due: 0 });
  });

  it("département reconstitué depuis les mutations et absence ventilée sur deux mois", () => {
    expect(kpi("2025-11", "INF")).toMatchObject({ headcount: 6, entries: 1 });
    expect(kpi("2026-02", "COM")).toMatchObject({
      headcount: 3,
      exits: 1,
      voluntary_exits: 0,
      absence_days_health: 5,
      absence_days_non_health: 0,
      workable_days: 80,
      late_count: 1,
      payroll_mass: 7050,
    });
    expect(kpi("2026-02", "INF")).toMatchObject({ headcount: 4, absence_days_non_health: 2 });
    expect(kpi("2026-02", "DIR")).toMatchObject({ headcount: 1, overtime_hours: 0.5, payroll_mass: 9500 });
  });

  it("recalcule un mois ciblé sans doublon", () => {
    const before = sqlite.prepare("SELECT COUNT(*) AS n FROM agg_kpi_monthly").get() as { n: number };
    expect(refreshAggregates(sqlite, ["2026-01"])).toBe(3);
    const after = sqlite.prepare("SELECT COUNT(*) AS n FROM agg_kpi_monthly").get() as { n: number };
    expect(after.n).toBe(before.n);
    expect(kpi("2026-01", "INF")?.headcount).toBe(5);
    expect(() => refreshAggregates(sqlite, ["2026-13"])).toThrow();
  });

  it("effectif, entrées et sorties hors stages et SIVP ; l'absentéisme garde tous les présents", () => {
    // E007 : SIVP puis CDI au 10/01/2024, compté à partir du CDI (entrée) mais présent pour l'absentéisme avant
    expect(kpi("2023-12", "COM")).toMatchObject({ headcount: 2, entries: 0, workable_days: 63 });
    expect(kpi("2024-01", "COM")).toMatchObject({ headcount: 3, entries: 1 });

    const inf = (sqlite.prepare("SELECT id FROM department WHERE code = 'INF'").get() as { id: number }).id;
    const add = (matricule: string, type: "STAGE" | "SIVP", hire: string, exit: string | null) => {
      const id = Number(
        sqlite
          .prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, status, exit_date) VALUES (?, 'Test', 'Test', ?, ?, ?, ?)")
          .run(matricule, hire, inf, exit ? "SORTI" : "ACTIF", exit).lastInsertRowid,
      );
      sqlite.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, ?, ?)").run(id, type, hire);
      if (exit) sqlite.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, ?, 'DEMISSION', ?)").run(id, exit, exit);
    };
    add("STG1", "STAGE", "2026-01-05", null);
    add("SIVP1", "SIVP", "2025-06-02", "2026-01-15");
    refreshAggregates(sqlite, ["2026-01"]);
    // 5 présents fin de mois (105) + E004 (21) + STG1 du 05/01 (20) + SIVP1 jusqu'au 15/01 (10)
    expect(kpi("2026-01", "INF")).toMatchObject({ headcount: 5, entries: 0, exits: 1, voluntary_exits: 1, workable_days: 156 });
  });
});

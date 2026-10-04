import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openSqlite } from "@/db/client";
import { runStep } from "@/lib/ai/workload/step";
import { collectiveRecommendation, individualRecommendation } from "@/lib/ai/workload/step";
import { streakOf, sustainedOverloads } from "@/lib/ai/workload/rule";
import { AS_OF, cleanupWorkloadDb, setupWorkloadDb, type Fixture } from "./setup";

let fx: Fixture;
let sqlite: Database.Database;

beforeAll(() => {
  fx = setupWorkloadDb("step");
  sqlite = openSqlite(fx.file);
});
afterAll(() => {
  sqlite.close();
  cleanupWorkloadDb(fx.file);
});

type Reco = { id: number; scope: string; audience: string; manager_id: number | null; employee_id: number | null; dedup_key: string; title: string; rationale: string; status: string; priority: number };
const forecasts = () =>
  sqlite.prepare("SELECT scope, department_id, manager_id, month, horizon, value, lower, upper FROM forecast WHERE topic = 'CHARGE_TRAVAIL' AND as_of = ? ORDER BY scope, department_id, manager_id, month, horizon").all(AS_OF);
const recos = () => sqlite.prepare("SELECT * FROM insight_recommendation WHERE topic = 'CHARGE_TRAVAIL' ORDER BY id").all() as Reco[];

describe("règle de surcharge soutenue", () => {
  it("compte les mois consécutifs au-delà du seuil, rompus par un mois sans pointage", () => {
    expect(streakOf([25, 25, 25], [20, 20, 20], 20)).toBe(3);
    expect(streakOf([25, 0, 25, 25], [20, 0, 20, 20], 20)).toBe(2);
    expect(streakOf([25, 25, 20], [20, 20, 20], 20)).toBe(0);
    const o = sustainedOverloads({ months: ["2026-06", "2026-07", "2026-08"], rows: [{ employeeId: 7, hours: [21, 22, 23], days: [20, 20, 20] }] }, { thresholdH: 20, months: 3 });
    expect(o).toEqual([{ employeeId: 7, months: 3, start: "2026-06", hours: [{ month: "2026-06", hours: 21 }, { month: "2026-07", hours: 22 }, { month: "2026-08", hours: 23 }] }]);
  });

  it("rédige des recommandations chiffrées avec une clé stable", () => {
    const o = { employeeId: 7, months: 4, start: "2026-05", hours: ["05", "06", "07", "08"].map((m) => ({ month: `2026-${m}`, hours: 24 })) };
    const r = individualRecommendation(o, { thresholdH: 20, months: 3 }, { name: "Ali Ben Salah", departmentId: 1, managerId: 2, level: "MOYEN" });
    expect(r).toMatchObject({ scope: "SALARIE", audience: "RH", priority: 1, dedupKey: "CHARGE_TRAVAIL:SALARIE:7:2026-05" });
    expect(r.title).toBe("Ali Ben Salah cumule 4 mois d'heures supplémentaires au-delà de 20,0 h par mois : proposez un entretien sur la charge");
    expect(r.rationale).toContain("mai 2026 : 24,0 h");
    expect(r.rationale).toContain("risque de départ publié ce mois : moyen");
    const row = { scope: "EQUIPE" as const, key: 9, home: 1, n: 6, x: [], zbar12: 0, s: 0.2, I12: 10, last: 12 };
    const c = collectiveRecommendation(
      [
        { ...row, h: 1, month: "2026-09", value: 13, lower: 9, upper: 18 },
        { ...row, h: 2, month: "2026-10", value: 15, lower: 13.5, upper: 20 },
      ],
      12.8,
      { scope: "EQUIPE", name: "" },
    );
    expect(c).toMatchObject({ audience: "MANAGER", managerId: 9, priority: 1, dedupKey: "CHARGE_TRAVAIL:EQUIPE:9:2026-T4" });
    expect(c!.title).toBe("Charge prévue élevée pour votre équipe en octobre 2026 : répartissez les tâches ou prévoyez un renfort temporaire");
    expect(collectiveRecommendation([{ ...row, h: 1, month: "2026-09", value: 12, lower: 9, upper: 18 }], 12.8, { scope: "EQUIPE", name: "" })).toBeNull();
  });
});

describe("étape IA charge de travail", () => {
  it("écrit observé et prévisions pour les groupes éligibles seulement", () => {
    const { summary } = runStep(sqlite, AS_OF);
    expect(summary).toContain("prévisions");
    const rows = forecasts() as { scope: string; manager_id: number | null; horizon: number; value: number; lower: number | null; upper: number | null }[];
    const teams = new Set(rows.filter((r) => r.scope === "EQUIPE").map((r) => r.manager_id));
    expect([...teams].sort()).toEqual([fx.mgrA1, fx.mgrB].sort());
    expect(rows.filter((r) => r.scope === "EQUIPE" && r.manager_id === fx.mgrA1 && r.horizon > 0)).toHaveLength(3);
    expect(rows.filter((r) => r.scope === "EQUIPE" && r.manager_id === fx.mgrA1 && r.horizon === 0)).toHaveLength(12);
    expect(rows.filter((r) => r.scope === "DEPARTEMENT" && r.horizon > 0)).toHaveLength(6);
    expect(rows.filter((r) => r.scope === "ENTREPRISE" && r.horizon > 0)).toHaveLength(3);
    for (const r of rows.filter((x) => x.horizon > 0 && x.scope !== "ENTREPRISE")) {
      expect(r.lower!).toBeLessThanOrEqual(r.value);
      expect(r.value).toBeLessThanOrEqual(r.upper!);
    }
  });

  it("crée les recommandations collectives (manager) et individuelles (RH), sans les salariés opposés", () => {
    const rs = recos();
    const team = rs.filter((r) => r.scope === "EQUIPE");
    expect(team.map((r) => r.manager_id)).toEqual([fx.mgrA1]);
    expect(team[0].audience).toBe("MANAGER");
    expect(team[0].title).toMatch(/^Charge prévue élevée pour votre équipe en .+ 2026 : répartissez les tâches ou prévoyez un renfort temporaire$/);
    expect(team[0].rationale).toMatch(/h supplémentaires par ETP/);
    const indiv = rs.filter((r) => r.scope === "SALARIE");
    expect(indiv.map((r) => r.employee_id)).toEqual([fx.overloaded]);
    expect(indiv[0]).toMatchObject({ audience: "RH", dedup_key: `CHARGE_TRAVAIL:SALARIE:${fx.overloaded}:2026-04`, priority: 1 });
    expect(indiv[0].title).toContain("cumule 5 mois d'heures supplémentaires au-delà de 20,0 h par mois");
    expect(rs.some((r) => r.employee_id === fx.opposed)).toBe(false);
    expect(rs.some((r) => r.rationale.match(/maladie|maternit/i))).toBe(false);
  });

  it("est idempotente et respecte les décisions déjà prises", () => {
    const f1 = forecasts();
    const r1 = recos();
    runStep(sqlite, AS_OF);
    expect(forecasts()).toEqual(f1);
    expect(recos()).toEqual(r1);
    const target = r1.find((r) => r.scope === "SALARIE")!;
    sqlite.prepare("UPDATE insight_recommendation SET status = 'REALISEE', rationale = 'décision RH' WHERE id = ?").run(target.id);
    runStep(sqlite, AS_OF);
    const after = recos().find((r) => r.id === target.id)!;
    expect(after.status).toBe("REALISEE");
    expect(after.rationale).toBe("décision RH");
    expect(recos()).toHaveLength(r1.length);
  });

  it("sans modèle champion, garde la règle individuelle et ne prévoit rien", () => {
    sqlite.prepare("UPDATE topic_model SET status = 'RETIRE' WHERE topic = 'CHARGE_TRAVAIL'").run();
    try {
      const { summary } = runStep(sqlite, "2026-07-31");
      expect(summary).toContain("aucun modèle CHARGE_TRAVAIL champion");
      expect(sqlite.prepare("SELECT count(*) AS n FROM forecast WHERE as_of = '2026-07-31'").get()).toEqual({ n: 0 });
    } finally {
      sqlite.prepare("UPDATE topic_model SET status = 'CHAMPION' WHERE version = ?").run(fx.version);
    }
  });
});

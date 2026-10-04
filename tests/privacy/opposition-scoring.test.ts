import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildTeamScenario, T } from "../fixtures/engine/scenario";
import { scoreMonth } from "@/lib/scoring/score";
import { applyPublicationEffects } from "@/lib/engine/recommendations";
import { excludeOpposed, isOpposed, liftOpposition, opposedEmployeeIds, recordOpposition } from "@/lib/privacy";
import { setSetting } from "@/lib/settings";
import { backfillFeatures } from "@/lib/features";
import { panelRows } from "../../scripts/export-panel";

// Exclusion effective, sans passer par la DAL : moteur de scoring, effets de publication, helper des étapes IA
describe("opposition : exclusion du scoring, des recommandations et des alertes TURNOVER", () => {
  let db: TestDb;
  let ids: ReturnType<typeof buildTeamScenario>;
  beforeAll(() => {
    db = createTestDb();
    ids = buildTeamScenario(new Fixture(db.sqlite));
    setSetting(db.sqlite, "data_end_date", T);
  });
  afterAll(() => db.close());

  const n = (sql: string, ...p: unknown[]) => (db.sqlite.prepare(sql).get(...p) as { n: number }).n;
  const predsOf = (runId: number, emp: number) => n("SELECT COUNT(*) AS n FROM prediction WHERE run_id = ? AND employee_id = ?", runId, emp);

  it("un salarié opposé n'a plus de prédiction ni de facteur au run suivant ; les autres restent scorés", () => {
    const first = scoreMonth(db.sqlite, T);
    expect(predsOf(first.runId, ids.a)).toBe(1);

    const { created, purged } = recordOpposition(db.sqlite, { employeeId: ids.a, userId: 7 });
    expect(created).toBe(true);
    expect(purged.predictions).toBeGreaterThanOrEqual(1);
    expect(isOpposed(db.sqlite, ids.a)).toBe(true);
    expect(recordOpposition(db.sqlite, { employeeId: ids.a }).created).toBe(false);

    const next = scoreMonth(db.sqlite, T, { force: true });
    expect(next.nScored).toBe(first.nScored - 1);
    expect(predsOf(next.runId, ids.a)).toBe(0);
    expect(predsOf(next.runId, ids.b)).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM prediction_factor f JOIN prediction p ON p.id = f.prediction_id WHERE p.employee_id = ?", ids.a)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM feature_snapshot WHERE employee_id = ?", ids.a)).toBe(0);

    // Mois jamais calculé : variables calculées à la volée, jamais écrites pour le salarié opposé
    const other = scoreMonth(db.sqlite, "2025-05-31", { publish: false });
    expect(predsOf(other.runId, ids.a)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM feature_snapshot WHERE employee_id = ? AND as_of = '2025-05-31'", ids.a)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM feature_snapshot WHERE employee_id = ? AND as_of = '2025-05-31'", ids.b)).toBe(1);
  });

  it("run contenant encore une prédiction ÉLEVÉ d'un salarié opposé : ni recommandation ni alerte TURNOVER pour lui", () => {
    const model = (db.sqlite.prepare("SELECT model_version_id AS m FROM scoring_run LIMIT 1").get() as { m: number }).m;
    const runId = Number(db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored) VALUES ('2025-07-31', ?, 'PUBLIE', 2)").run(model).lastInsertRowid);
    const insP = db.sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, '2025-07-31', 0.5, 'ELEVE', ?, 5, ?)");
    const insF = db.sqlite.prepare("INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction) VALUES (?, 'TEMPS_TRAVAIL', 0.8, 1, 'HAUSSE')");
    for (const [emp, rank] of [[ids.a, 1], [ids.b, 2]]) insF.run(Number(insP.run(runId, emp, rank, model).lastInsertRowid));

    const effects = applyPublicationEffects(db.sqlite, runId);
    expect(effects.alerts).toBe(1);
    const recoOf = (emp: number) => n("SELECT COUNT(*) AS n FROM recommendation WHERE employee_id = ? AND prediction_id IN (SELECT id FROM prediction WHERE run_id = ?)", emp, runId);
    expect(recoOf(ids.b)).toBeGreaterThanOrEqual(1);
    expect(recoOf(ids.a)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM alert WHERE type = 'TURNOVER' AND employee_id = ?", ids.a)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM alert WHERE type = 'TURNOVER' AND employee_id = ?", ids.b)).toBe(1);
    db.sqlite.prepare("DELETE FROM recommendation WHERE prediction_id IN (SELECT id FROM prediction WHERE run_id = ?)").run(runId);
    db.sqlite.prepare("DELETE FROM prediction_factor WHERE prediction_id IN (SELECT id FROM prediction WHERE run_id = ?)").run(runId);
    db.sqlite.prepare("DELETE FROM prediction WHERE run_id = ?").run(runId);
    db.sqlite.prepare("DELETE FROM scoring_run WHERE id = ?").run(runId);
  });

  it("réentraînement : ni variables écrites par le backfill ni lignes du panel exporté pour un salarié opposé", () => {
    const has = (rows: { employeeId: number }[]) => rows.some((r) => r.employeeId === ids.a);
    expect(backfillFeatures(db.sqlite, "2025-06", "2025-06")).toBeGreaterThan(0);
    expect(n("SELECT COUNT(*) AS n FROM feature_snapshot WHERE employee_id = ?", ids.a)).toBe(0);
    expect(has(panelRows(db.sqlite, T, "naive"))).toBe(false);
    expect(has(panelRows(db.sqlite, T, "nominal"))).toBe(false);
    expect(panelRows(db.sqlite, T, "nominal").length).toBeGreaterThan(0);
  });

  it("helper des étapes IA : excludeOpposed et opposedEmployeeIds", () => {
    expect([...opposedEmployeeIds(db.sqlite)]).toEqual([ids.a]);
    const rows = [ids.a, ids.b, ids.c].map((employeeId) => ({ employeeId, prob: 0.1 }));
    expect(excludeOpposed(db.sqlite, rows).map((r) => r.employeeId)).toEqual([ids.b, ids.c]);
  });

  it("levée : le salarié est de nouveau scoré au recalcul suivant, même mois compris", () => {
    const before = scoreMonth(db.sqlite, T, { force: true }).nScored;
    expect(liftOpposition(db.sqlite, ids.a)).toBe(true);
    expect(liftOpposition(db.sqlite, ids.a)).toBe(false);
    const after = scoreMonth(db.sqlite, T, { force: true });
    expect(after.nScored).toBe(before + 1);
    expect(predsOf(after.runId, ids.a)).toBe(1);
  });
});

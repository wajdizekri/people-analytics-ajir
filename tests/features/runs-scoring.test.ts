import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildTeamScenario, T } from "../fixtures/engine/scenario";
import { FEATURES, FEATURE_NAMES } from "@/lib/features/spec";
import { enqueueJob, claimNextJob } from "@/lib/jobs";
import { listRuns, rollbackRun } from "@/lib/jobs/runs";
import { readBundleDir, toLoadedModel } from "@/lib/scoring";
import { rankAndLevel, scoreMonth } from "@/lib/scoring/score";
import { getSetting, setSetting } from "@/lib/settings";

const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");
const neutral = () => FEATURES.map((f) => f.impute);
const rows = (feature: string, xs: number[]) =>
  xs.map((x, i) => {
    const values = neutral();
    values[FEATURE_NAMES.indexOf(feature)] = x;
    return { employeeId: i + 1, values };
  });

describe("niveaux de risque : capacité en plafond (B1)", () => {
  const lr = toLoadedModel(readBundleDir(TOY).bundle, null);
  const eleves = (n: number, rate: number) => rankAndLevel(lr, rows("compa_ratio", Array.from({ length: n }, (_, i) => 0.3 + i / (2 * n))), rate, 2).filter((r) => r.level === "ELEVE").length;

  it("k = partie entière de n × taux, jamais plus ; au moins 1 quand la capacité est < 1", () => {
    expect(eleves(75, 0.02)).toBe(1);
    expect(eleves(99, 0.02)).toBe(1);
    expect(eleves(100, 0.02)).toBe(2);
    expect(eleves(149, 0.02)).toBe(2);
    expect(eleves(300, 0.07)).toBe(21);
    expect(eleves(20, 0.02)).toBe(1);
    for (const [n, rate] of [[57, 0.03], [250, 0.015], [1001, 0.02]] as const) expect(eleves(n, rate)).toBeLessThanOrEqual(Math.max(1, n * rate));
  });

  it("contribution de groupe nulle : jamais retenue comme facteur (ni hausse ni baisse)", () => {
    const b = lr.bundle as { features: string[]; standardization: { mean: number[] } };
    const meanProfile = (patch: Record<string, number> = {}) => {
      const values = neutral();
      lr.idx.forEach((snapIdx, j) => (values[snapIdx] = b.standardization.mean[j]));
      for (const [f, v] of Object.entries(patch)) values[FEATURE_NAMES.indexOf(f)] = v;
      return [{ employeeId: 1, values }];
    };
    const [avg] = rankAndLevel(lr, meanProfile(), 0.02, 2);
    expect(avg.factors).toEqual([]);
    const j = b.features.indexOf("compa_ratio");
    const [low] = rankAndLevel(lr, meanProfile({ compa_ratio: b.standardization.mean[j] - 0.2 }), 0.02, 2);
    expect(low.factors).toHaveLength(1);
    expect(low.factors[0]).toMatchObject({ group: "REMUNERATION" });
    expect(low.factors[0].contribution).not.toBe(0);
  });
});

describe("retour arrière du calcul publié (scripts/run.ts)", () => {
  let db: TestDb;
  let july: number;
  let june: number;
  let backtest: number;
  beforeAll(() => {
    db = createTestDb();
    buildTeamScenario(new Fixture(db.sqlite));
    setSetting(db.sqlite, "data_end_date", "2025-07-31");
    backtest = scoreMonth(db.sqlite, "2025-05", { publish: false }).runId;
    june = scoreMonth(db.sqlite, T, { userId: 7 }).runId;
    july = scoreMonth(db.sqlite, "2025-07", { userId: 7 }).runId;
  });
  afterAll(() => db.close());

  const refused = (id: number, pattern: RegExp, opts = {}) => expect(() => rollbackRun(db.sqlite, id, opts)).toThrow(pattern);

  it("list : ordre décroissant, calcul courant et runs déjà publiés comme courants", () => {
    const list = listRuns(db.sqlite);
    expect(list.map((r) => r.id)).toEqual([july, june, backtest]);
    expect(list.map((r) => [r.current, r.everCurrent])).toEqual([
      [true, true],
      [false, true],
      [false, false],
    ]);
  });

  it("refus audités : inconnu, déjà courant, run de backtest sans --force, calcul en cours", () => {
    refused(99999, /introuvable/);
    refused(july, /déjà le calcul publié courant/);
    refused(backtest, /jamais été le calcul courant/);
    const job = enqueueJob(db.sqlite, "SCORING", "2025-08");
    claimNextJob(db.sqlite);
    refused(june, /Calcul en cours/);
    db.sqlite.prepare("UPDATE app_job SET status = 'TERMINE' WHERE id = ?").run(job);
    expect(getSetting(db.sqlite, "current_run_id")).toBe(String(july));
    const audits = db.sqlite.prepare("SELECT outcome FROM audit_log WHERE action = 'scoring.rollback'").all() as { outcome: string }[];
    expect(audits.map((a) => a.outcome)).toEqual(["REFUSE", "REFUSE", "REFUSE", "REFUSE"]);
  });

  it("rollback : pointeur repointé et audité ; un run postérieur n'est pas un retour arrière", () => {
    expect(rollbackRun(db.sqlite, june, { userId: 3 })).toMatchObject({ from: july, to: june, asOf: T });
    expect(getSetting(db.sqlite, "current_run_id")).toBe(String(june));
    expect(db.sqlite.prepare("SELECT user_id AS u, outcome FROM audit_log WHERE action = 'scoring.rollback' ORDER BY id DESC LIMIT 1").get()).toEqual({ u: 3, outcome: "OK" });
    refused(july, /postérieur au calcul courant/);
    expect(rollbackRun(db.sqlite, backtest, { force: true })).toMatchObject({ from: june, to: backtest });
    expect(listRuns(db.sqlite).find((r) => r.id === backtest)).toMatchObject({ current: true, everCurrent: true });
  });

  it("run non PUBLIE refusé", () => {
    db.sqlite.prepare("UPDATE scoring_run SET status = 'ECHEC' WHERE id = ?").run(june);
    setSetting(db.sqlite, "current_run_id", String(july));
    refused(june, /statut ECHEC/);
  });
});

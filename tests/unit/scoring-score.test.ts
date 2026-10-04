import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildTeamScenario, T } from "../fixtures/engine/scenario";
import { FEATURES, FEATURE_NAMES, FSV } from "@/lib/features/spec";
import { readSnapshots, writeSnapshots } from "@/lib/features";
import { getSetting, setSetting } from "@/lib/settings";
import { readBundleDir, toLoadedModel } from "@/lib/scoring";
import { currentPublishedAsOf, rankAndLevel, scoreMonth } from "@/lib/scoring/score";
import { promoteModel, registerBundle } from "@/lib/scoring/registry";

const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");
const B0_DIR = path.resolve(__dirname, "../../models/turnover/b0-v1");
const neutral = () => FEATURES.map((f) => f.impute);
const rowsWith = (feature: string, xs: number[]) =>
  xs.map((x, i) => {
    const values = neutral();
    values[FEATURE_NAMES.indexOf(feature)] = x;
    return { employeeId: i + 1, values };
  });

describe("rankAndLevel : bornes", () => {
  const b0 = toLoadedModel(readBundleDir(B0_DIR).bundle, null);
  const lr = toLoadedModel(readBundleDir(TOY).bundle, null);

  it("population vide", () => {
    expect(rankAndLevel(lr, [], 0.02, 2)).toEqual([]);
  });

  it("B0 sans aucun point : lift nul, tout le monde FAIBLE, rangs stables par id", () => {
    const out = rankAndLevel(b0, rowsWith("compa_ratio", [1, 1, 1]), 0.5, 2);
    expect(out.map((r) => [r.employeeId, r.rank, r.lift, r.level])).toEqual([
      [1, 1, 0, "FAIBLE"],
      [2, 2, 0, "FAIBLE"],
      [3, 3, 0, "FAIBLE"],
    ]);
  });

  it("LOGREG : population entièrement ex-æquo = aucun ÉLEVÉ (plafond), lift 1", () => {
    const out = rankAndLevel(lr, rowsWith("compa_ratio", [0.8, 0.8, 0.8, 0.8]), 0.25, 2);
    expect(out.every((r) => r.level === "FAIBLE" && Math.abs(r.lift - 1) < 1e-12)).toBe(true);
  });

  it("au moins un ÉLEVÉ même quand la capacité est < 1 (arbitrage B1) ; ex-æquo derrière le seuil exclus", () => {
    const xs = [0.5, 0.9, 0.9, 1, 1, 1, 1, 1, 1, 1];
    const out = rankAndLevel(b0, rowsWith("compa_ratio", xs), 0.01, 2);
    expect(out.filter((r) => r.level === "ELEVE").map((r) => r.employeeId)).toEqual([1]);
    const tie = rankAndLevel(b0, rowsWith("compa_ratio", [0.5, 0.5, 1, 1]), 0.25, 1.5);
    expect(tie.map((r) => r.level)).toEqual(["MOYEN", "MOYEN", "FAIBLE", "FAIBLE"]);
  });

  // B1 corrigé (docs/qa/COUVERTURE.md) : k = partie entière de n × capacity_rate (75 × 2 % = 1,5 → 1 ÉLEVÉ).
  it("la capacité est un plafond : jamais plus de n × capacity_rate salariés ÉLEVÉ (dès que n × taux ≥ 1)", () => {
    const xs = Array.from({ length: 75 }, (_, i) => 0.5 + i / 100);
    const out = rankAndLevel(lr, rowsWith("compa_ratio", xs), 0.02, 2);
    expect(new Set(out.map((r) => r.score)).size).toBe(75);
    expect(out.filter((r) => r.level === "ELEVE").length).toBeLessThanOrEqual(Math.floor(75 * 0.02));
  });

  it("facteurs limités à 6 groupes, triés par contribution absolue", () => {
    const values = neutral();
    const lrb = lr.bundle as { features: string[]; standardization: { mean: number[]; std: number[] } };
    lr.idx.forEach((snapIdx, j) => (values[snapIdx] = lrb.standardization.mean[j] + 2 * lrb.standardization.std[j]));
    const [r] = rankAndLevel(lr, [{ employeeId: 1, values }], 0.02, 2);
    expect(r.factors.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < r.factors.length; i++) expect(Math.abs(r.factors[i - 1].contribution)).toBeGreaterThanOrEqual(Math.abs(r.factors[i].contribution));
  });
});

describe("scoreMonth : garde-fous, réutilisation et paramètres", () => {
  let db: TestDb;
  let ids: ReturnType<typeof buildTeamScenario>;
  beforeAll(() => {
    db = createTestDb();
    ids = buildTeamScenario(new Fixture(db.sqlite));
    setSetting(db.sqlite, "data_end_date", T);
  });
  afterAll(() => db.close());

  const run = (id: number) => db.sqlite.prepare("SELECT id, status, as_of AS asOf, n_scored AS n FROM scoring_run WHERE id = ?").get(id);
  const levels = (runId: number) =>
    Object.fromEntries((db.sqlite.prepare("SELECT employee_id AS e, level FROM prediction WHERE run_id = ?").all(runId) as { e: number; level: string }[]).map((r) => [r.e, r.level]));

  it("date de coupure invalide refusée ; un mois AAAA-MM est ramené à sa fin de mois", () => {
    expect(() => scoreMonth(db.sqlite, "juin 2025")).toThrow(/Date de coupure invalide/);
    const r = scoreMonth(db.sqlite, "2025-05", { publish: false });
    expect(run(r.runId)).toMatchObject({ asOf: "2025-05-31", status: "PUBLIE" });
    expect(r.published).toBe(false);
    expect(getSetting(db.sqlite, "current_run_id")).toBe("");
    expect(currentPublishedAsOf(db.sqlite)).toBeNull();
  });

  it("aucun salarié éligible : erreur explicite, aucun run créé", () => {
    const before = db.sqlite.prepare("SELECT COUNT(*) AS n FROM scoring_run").get();
    expect(() => scoreMonth(db.sqlite, "2014-12-31", { publish: false })).toThrow(/Aucun collaborateur à évaluer au 31\/12\/2014/);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM scoring_run").get()).toEqual(before);
  });

  it("un run calculé sans publication est repris tel quel puis publié par un appel publiant (pointeur, effets)", () => {
    const hidden = scoreMonth(db.sqlite, T, { publish: false });
    expect(hidden).toMatchObject({ published: false, reused: false, recommendations: 0, alerts: 0 });
    const again = scoreMonth(db.sqlite, T, { publish: false });
    expect(again).toMatchObject({ runId: hidden.runId, published: false, reused: true });
    const pub = scoreMonth(db.sqlite, T, { userId: 12 });
    expect(pub).toMatchObject({ runId: hidden.runId, published: true, reused: true });
    expect(pub.recommendations).toBeGreaterThan(0);
    expect(getSetting(db.sqlite, "current_run_id")).toBe(String(hidden.runId));
    expect(currentPublishedAsOf(db.sqlite)).toBe(T);
    expect(db.sqlite.prepare("SELECT updated_by AS u FROM app_setting WHERE key = 'current_run_id'").get()).toEqual({ u: 12 });
  });

  it("le pointeur vers un run non PUBLIE n'est pas un calcul publié", () => {
    const current = getSetting(db.sqlite, "current_run_id");
    const staging = Number(db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status) VALUES ('2025-04-30', 1, 'STAGING')").run().lastInsertRowid);
    setSetting(db.sqlite, "current_run_id", String(staging));
    expect(currentPublishedAsOf(db.sqlite)).toBeNull();
    setSetting(db.sqlite, "current_run_id", "abc");
    expect(currentPublishedAsOf(db.sqlite)).toBeNull();
    db.sqlite.prepare("DELETE FROM scoring_run WHERE id = ?").run(staging);
    setSetting(db.sqlite, "current_run_id", current);
  });

  it("un run ECHEC du même mois et du même modèle est remplacé par un nouveau run", () => {
    const failed = Number(
      db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, error) VALUES ('2025-03-31', 1, 'ECHEC', 'panne')").run().lastInsertRowid,
    );
    const r = scoreMonth(db.sqlite, "2025-03-31", { publish: false });
    expect(r.runId).not.toBe(failed);
    expect(run(failed)).toBeUndefined();
    expect(run(r.runId)).toMatchObject({ status: "PUBLIE", n: r.nScored });
  });

  it("les variables déjà calculées du mois (feature_snapshot) sont réutilisées telles quelles", () => {
    const asOf = "2025-02-28";
    const first = scoreMonth(db.sqlite, asOf, { publish: false });
    const scoreOf = (runId: number) => (db.sqlite.prepare("SELECT prob6 AS p FROM prediction WHERE run_id = ? AND employee_id = ?").get(runId, ids.b) as { p: number }).p;
    const before = scoreOf(first.runId);
    const snaps = readSnapshots(db.sqlite, asOf, FSV);
    const target = snaps.find((s) => s.employeeId === ids.b)!;
    target.values[FEATURE_NAMES.indexOf("compa_ratio")] = 0.5;
    target.values[FEATURE_NAMES.indexOf("overtime_h_avg_3m")] = 40;
    writeSnapshots(db.sqlite, asOf, snaps);
    const r = scoreMonth(db.sqlite, asOf, { publish: false, force: true });
    expect(r.runId).toBe(first.runId);
    expect(scoreOf(r.runId)).toBe(before + 2 + 1);
    expect(db.sqlite.prepare("SELECT employee_id AS e FROM prediction WHERE run_id = ? AND rank = 1").get(r.runId)).toEqual({ e: ids.b });
  });

  it("run déclaré orphelin (reprise du worker) pendant l'écriture : publication refusée, ECHEC, pointeur inchangé", () => {
    const current = getSetting(db.sqlite, "current_run_id");
    db.sqlite.exec(`CREATE TRIGGER orphan_run AFTER INSERT ON prediction
      BEGIN UPDATE scoring_run SET status = 'ECHEC', error = 'Run orphelin' WHERE id = NEW.run_id AND status = 'STAGING'; END;`);
    try {
      expect(() => scoreMonth(db.sqlite, "2025-01-31", { userId: 8 })).toThrow("Calcul interrompu : il a été publié ou annulé entre-temps par un autre traitement.");
    } finally {
      db.sqlite.exec("DROP TRIGGER orphan_run");
    }
    const run = db.sqlite.prepare("SELECT id, status, error FROM scoring_run WHERE as_of = '2025-01-31'").get() as { id: number; status: string; error: string };
    expect(run).toMatchObject({ status: "ECHEC", error: "Calcul interrompu : il a été publié ou annulé entre-temps par un autre traitement." });
    expect(getSetting(db.sqlite, "current_run_id")).toBe(current);
    expect(db.sqlite.prepare("SELECT outcome, user_id AS u FROM audit_log WHERE action = 'scoring.publish' AND target_id = ?").get(String(run.id))).toEqual({ outcome: "ECHEC", u: 8 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM alert WHERE dedup_key = ?").get(`systeme:scoring:2025-01-31:run${run.id}`)).toEqual({ n: 1 });
    const retry = scoreMonth(db.sqlite, "2025-01-31", { publish: false });
    expect(retry.runId).not.toBe(run.id);
  });

  it("capacité et seuil MOYEN lus dans les paramètres ; valeur invalide ou nulle = valeur par défaut", () => {
    registerBundle(db.sqlite, TOY);
    promoteModel(db.sqlite, "logreg-toy-v1");
    setSetting(db.sqlite, "min_events_for_model", "0");
    setSetting(db.sqlite, "capacity_rate", "0.5");
    const wide = scoreMonth(db.sqlite, T, { force: true });
    const scored = Object.values(levels(wide.runId));
    expect(scored.filter((l) => l === "ELEVE").length).toBe(Math.floor(scored.length * 0.5));
    for (const bad of ["abc", "0", "-1"]) {
      setSetting(db.sqlite, "capacity_rate", bad);
      const r = scoreMonth(db.sqlite, T, { force: true });
      expect(Object.values(levels(r.runId)).filter((l) => l === "ELEVE"), bad).toHaveLength(1);
    }
    setSetting(db.sqlite, "capacity_rate", "0.02");
    setSetting(db.sqlite, "medium_lift", "1e-9");
    const all = scoreMonth(db.sqlite, T, { force: true });
    expect(Object.values(levels(all.runId)).filter((l) => l === "FAIBLE")).toHaveLength(0);
    setSetting(db.sqlite, "medium_lift", "2");
  });
});

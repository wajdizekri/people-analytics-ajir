import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb, Fixture, type TestDb } from "../../../tests/fixtures/engine/db";
import { buildTeamScenario, T } from "../../../tests/fixtures/engine/scenario";
import { FEATURES, FEATURE_NAMES, GROUP_CODES } from "../features/spec";
import { getSetting, setSetting } from "../settings";
import {
  calibratedLogit,
  ensureChampion,
  explain,
  listModels,
  loadChampion,
  meanProfileLogit,
  parseBundle,
  predict,
  promoteModel,
  rankAndLevel,
  readBundleDir,
  registerBundle,
  rollbackModel,
  scoreMonth,
  toLoadedModel,
  verifyModel,
} from "./index";

const TOY = path.resolve(__dirname, "../../../tests/fixtures/engine/logreg-toy");
const toyModel = () => toLoadedModel(readBundleDir(TOY).bundle, null);
const randomValues = fc.array(fc.double({ min: -50, max: 500, noNaN: true }), { minLength: FEATURES.length, maxLength: FEATURES.length });

describe("scorer LOGREG : parité et explication", () => {
  it("rejoue le golden du bundle jouet à 1e-9", () => {
    const m = readBundleDir(TOY);
    const model = toyModel();
    let max = 0;
    for (const row of m.golden!) max = Math.max(max, Math.abs(predict(model, mapToSnapshot(model, row.x)) - row.p));
    expect(m.golden!.length).toBe(200);
    expect(max).toBeLessThanOrEqual(1e-9);
  });

  it("somme des contributions = logit - logit du profil moyen", () => {
    const model = toyModel();
    fc.assert(
      fc.property(randomValues, (values) => {
        const groups = explain(model, values);
        const sum = groups.reduce((s, g) => s + g.contribution, 0);
        const expected = calibratedLogit(model, values) - meanProfileLogit(model);
        expect(Math.abs(sum - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
        for (const g of groups) expect(Math.abs(g.features.reduce((s, f) => s + f.contribution, 0) - g.contribution)).toBeLessThan(1e-9);
      }),
      { numRuns: 200 },
    );
  });

  it("groupes triés, sens, variable principale et phrases ; aucun chiffre côté manager", () => {
    const model = toyModel();
    fc.assert(
      fc.property(randomValues, (values) => {
        const groups = explain(model, values);
        for (let i = 1; i < groups.length; i++) expect(Math.abs(groups[i - 1].contribution)).toBeGreaterThanOrEqual(Math.abs(groups[i].contribution));
        for (const g of groups) {
          expect(GROUP_CODES).toContain(g.group);
          expect(g.direction).toBe(g.contribution > 0 ? "HAUSSE" : "BAISSE");
          expect(g.phraseManager).not.toMatch(/\d/);
          expect(g.phraseRh.length).toBeGreaterThan(0);
          if (g.topFeature) {
            const f = g.features.find((x) => x.feature === g.topFeature)!;
            expect(Math.sign(f.contribution)).toBe(g.contribution > 0 ? 1 : -1);
            expect(g.topFeatureValue).toBe(values[FEATURE_NAMES.indexOf(g.topFeature)]);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("gabarits : {pct} en pourcentage, {v} arrondi, binaire à 0", async () => {
    const { featurePhrase } = await import("./model");
    expect(featurePhrase("compa_ratio", 0.874)).toBe("Salaire à 87 % de la médiane du poste");
    expect(featurePhrase("raise_pct_12m", 0.0345)).toBe("Augmentation de 3,5 % sur 12 mois");
    expect(featurePhrase("overtime_h_avg_3m", 21.666)).toBe("22 h supplémentaires par mois en moyenne");
    expect(featurePhrase("eval_delta", -0.5)).toBe("Évaluation en évolution de -0,5 point(s)");
    expect(featurePhrase("eval_delta", 1)).toBe("Évaluation en évolution de +1 point(s)");
    expect(featurePhrase("contract_cdd", 0)).toBe("Pas de contrat à durée déterminée");
    expect(featurePhrase("eval_missing", 0)).toBe("Évaluation disponible");
  });
});

describe("niveaux de risque", () => {
  it("LOGREG : ÉLEVÉ = top capacité, MOYEN = lift >= seuil", () => {
    const model = toyModel();
    const b = model.bundle as { standardization: { mean: number[]; std: number[] } };
    const rows = Array.from({ length: 200 }, (_, i) => {
      const values = FEATURES.map((f) => f.impute);
      model.idx.forEach((snap, j) => (values[snap] = b.standardization.mean[j] + b.standardization.std[j] * ((((i * 7 + j * 13) % 17) - 8) / 8 + i / 1000)));
      return { employeeId: i + 1, values };
    });
    const out = rankAndLevel(model, rows, 0.02, 2);
    const mean = out.reduce((s, r) => s + r.score, 0) / out.length;
    expect(out.filter((r) => r.level === "ELEVE").map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (const r of out) {
      expect(r.lift).toBeCloseTo(r.score / mean, 12);
      if (r.rank > 4) expect(r.level).toBe(r.lift >= 2 ? "MOYEN" : "FAIBLE");
    }
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  it("B0 : ÉLEVÉ seulement parmi les scores > 0", () => {
    const b0 = toLoadedModel(readBundleDir(path.resolve(__dirname, "../../../models/turnover/b0-v1")).bundle, null);
    const neutral = FEATURES.map((f) => f.impute);
    const rows = Array.from({ length: 100 }, (_, i) => ({ employeeId: i + 1, values: [...neutral] }));
    rows[10].values[FEATURE_NAMES.indexOf("compa_ratio")] = 0.8;
    const out = rankAndLevel(b0, rows, 0.05, 2);
    expect(out.filter((r) => r.level === "ELEVE").map((r) => r.employeeId)).toEqual([11]);
    expect(out.filter((r) => r.level !== "FAIBLE")).toHaveLength(1);
    const g = explain(b0, rows[10].values);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ group: "REMUNERATION", contribution: 2, direction: "HAUSSE", topFeature: "compa_ratio" });
    expect(g[0].rules).toHaveLength(1);
  });

  it("ex-æquo au seuil de capacité : tous hors ÉLEVÉ (plafond), quel que soit l'id", () => {
    const b0 = toLoadedModel(readBundleDir(path.resolve(__dirname, "../../../models/turnover/b0-v1")).bundle, null);
    const neutral = FEATURES.map((f) => f.impute);
    const build = (idOf: (i: number) => number) => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ employeeId: idOf(i), values: [...neutral] }));
      for (const i of [0, 1, 2, 50, 51, 52, 53, 54]) rows[i].values[FEATURE_NAMES.indexOf("compa_ratio")] = 0.8;
      for (const i of [0, 1, 2]) rows[i].values[FEATURE_NAMES.indexOf("absence_rate_3m")] = 0.05;
      return rankAndLevel(b0, rows, 0.05, 2);
    };
    for (const idOf of [(i: number) => i + 1, (i: number) => 1000 - i]) {
      const out = build(idOf);
      const high = out.filter((r) => r.level === "ELEVE");
      expect(high.map((r) => r.score)).toEqual([3, 3, 3]);
      expect(new Set(out.filter((r) => r.score === 2).map((r) => r.level))).toEqual(new Set(["MOYEN"]));
    }
  });
});

describe("registre des modèles", () => {
  let db: TestDb;
  beforeAll(() => (db = createTestDb()));
  afterAll(() => db.close());

  it("sans champion, B0 est enregistré et promu", () => {
    expect(loadChampion(db.sqlite)).toBeNull();
    const m = ensureChampion(db.sqlite);
    expect(m.kind).toBe("B0");
    expect(listModels(db.sqlite).map((r) => [r.version, r.status])).toEqual([["b0-v1", "CHAMPION"]]);
  });

  it("register / verify / promote / rollback, un seul CHAMPION, audit", () => {
    registerBundle(db.sqlite, TOY);
    expect(verifyModel(db.sqlite, "logreg-toy-v1")).toMatchObject({ ok: true, goldenRows: 200 });
    promoteModel(db.sqlite, "logreg-toy-v1", 7);
    const champions = listModels(db.sqlite).filter((r) => r.status === "CHAMPION");
    expect(champions.map((r) => r.version)).toEqual(["logreg-toy-v1"]);
    expect(loadChampion(db.sqlite)?.version).toBe("logreg-toy-v1");
    const audit = db.sqlite.prepare("SELECT user_id AS u, target_id AS t, outcome FROM audit_log WHERE action = 'model.promote' ORDER BY id").all();
    expect(audit).toContainEqual({ u: 7, t: "logreg-toy-v1", outcome: "OK" });
    expect(rollbackModel(db.sqlite)).toBe("b0-v1");
    expect(loadChampion(db.sqlite)?.version).toBe("b0-v1");
  });

  it("golden altéré ou fsv différente : vérification en échec, alerte SYSTEME et refus", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-bundle-"));
    const bundle = JSON.parse(fs.readFileSync(path.join(TOY, "model.json"), "utf8"));
    const golden = JSON.parse(fs.readFileSync(path.join(TOY, "golden.json"), "utf8"));
    golden[3].p += 1e-6;
    fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify({ ...bundle, version: "logreg-bad" }));
    fs.writeFileSync(path.join(dir, "golden.json"), JSON.stringify(golden));
    expect(() => registerBundle(db.sqlite, dir)).toThrow(/golden/);

    fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify({ ...bundle, version: "logreg-v0" }));
    fs.copyFileSync(path.join(TOY, "golden.json"), path.join(dir, "golden.json"));
    registerBundle(db.sqlite, dir);
    promoteModel(db.sqlite, "logreg-v0");
    const row = db.sqlite.prepare("SELECT manifest_json AS m FROM model_version WHERE version = 'logreg-v0'").get() as { m: string };
    const manifest = JSON.parse(row.m);
    manifest.bundle.fsv = "v0";
    db.sqlite.prepare("UPDATE model_version SET manifest_json = ? WHERE version = 'logreg-v0'").run(JSON.stringify(manifest));
    expect(loadChampion(db.sqlite)).toBeNull();
    expect(() => ensureChampion(db.sqlite)).toThrow(/fsv/);
    const alert = db.sqlite.prepare("SELECT audience, severity FROM alert WHERE type = 'SYSTEME' AND dedup_key LIKE 'systeme:modele-invalide:logreg-v0:%'").get();
    expect(alert).toEqual({ audience: "ADMIN", severity: "CRITIQUE" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("bundle invalide refusé par le schéma", () => {
    expect(() => parseBundle({ version: "x", kind: "LOGREG", fsv: "v1" })).toThrow(/Bundle invalide/);
  });
});

describe("scoreMonth : publication atomique, recommandations, alertes", () => {
  let db: TestDb;
  let ids: ReturnType<typeof buildTeamScenario>;
  beforeAll(() => {
    db = createTestDb();
    ids = buildTeamScenario(new Fixture(db.sqlite));
  });
  afterAll(() => db.close());

  it("refuse si le dernier import est BLOQUE", () => {
    db.sqlite.prepare("INSERT INTO import_batch (source, status) VALUES ('test', 'BLOQUE')").run();
    expect(() => scoreMonth(db.sqlite, T)).toThrow(/bloqué/);
    db.sqlite.prepare("INSERT INTO import_batch (source, status) VALUES ('test', 'OK')").run();
  });

  it("échec de publication : run ECHEC, pointeur inchangé, alerte SYSTEME", () => {
    setSetting(db.sqlite, "current_run_id", "");
    db.sqlite.exec(`CREATE TRIGGER fail_publish BEFORE UPDATE ON app_setting WHEN NEW.key = 'current_run_id'
      BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;`);
    db.sqlite.exec(`CREATE TRIGGER fail_publish_ins BEFORE INSERT ON app_setting WHEN NEW.key = 'current_run_id'
      BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;`);
    expect(() => scoreMonth(db.sqlite, T)).toThrow(/panne simulée/);
    db.sqlite.exec("DROP TRIGGER fail_publish; DROP TRIGGER fail_publish_ins;");
    expect(getSetting(db.sqlite, "current_run_id")).toBe("");
    const run = db.sqlite.prepare("SELECT status, error FROM scoring_run ORDER BY id DESC LIMIT 1").get() as { status: string; error: string };
    expect(run.status).toBe("ECHEC");
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM alert WHERE type = 'SYSTEME' AND dedup_key LIKE 'systeme:scoring:%'").get()).toEqual({ n: 1 });
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM recommendation").get()).toEqual({ n: 0 });
  });

  it("publie (B0 par défaut), niveaux, facteurs, recommandations et alerte TURNOVER", () => {
    const r = scoreMonth(db.sqlite, T);
    expect(r).toMatchObject({ kind: "B0", nScored: 5, published: true, reused: false });
    expect(getSetting(db.sqlite, "current_run_id")).toBe(String(r.runId));
    const preds = db.sqlite.prepare("SELECT employee_id AS e, prob6 AS p, level, rank FROM prediction WHERE run_id = ? ORDER BY rank").all(r.runId) as {
      e: number;
      p: number;
      level: string;
    }[];
    expect(preds[0]).toMatchObject({ e: ids.a, p: 2, level: "ELEVE" });
    expect(preds.filter((p) => p.level === "ELEVE")).toHaveLength(1);
    const factors = db.sqlite
      .prepare("SELECT group_code AS g, direction AS d, phrase_rh AS rh, phrase_manager AS pm FROM prediction_factor f JOIN prediction p ON p.id = f.prediction_id WHERE p.run_id = ? AND p.employee_id = ? ORDER BY f.rank")
      .all(r.runId, ids.a) as { g: string; d: string; rh: string; pm: string }[];
    expect(factors.map((f) => f.g).sort()).toEqual(["ABSENCES", "FORMATION_EVAL"]);
    for (const f of factors) expect(f.pm).not.toMatch(/\d/);
    const recos = db.sqlite.prepare("SELECT employee_id AS e, action_code AS a, trigger_group AS g, status FROM recommendation ORDER BY id").all();
    expect(recos).toEqual([
      { e: ids.a, a: "PLAN_FORMATION", g: "FORMATION_EVAL", status: "PROPOSEE" },
      { e: ids.a, a: "ENTRETIEN", g: "NIVEAU_ELEVE", status: "PROPOSEE" },
    ]);
    const alerts = db.sqlite.prepare("SELECT audience, manager_id AS m, department_id AS d, employee_id AS e, link, dedup_key AS k, message FROM alert WHERE type = 'TURNOVER'").all() as Record<string, unknown>[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ audience: "MANAGER", m: ids.m, d: ids.dept, e: ids.a, link: `/employees/${ids.a}`, k: `turnover:${ids.a}:${T}` });
    expect(String(alerts[0].message)).not.toMatch(/%|0,\d|probabilit/);
    expect(String(alerts[0].message)).toContain("Facteurs associés : Développement des compétences.");
    expect(String(alerts[0].message)).not.toMatch(/Assiduité/);
  });

  it("idempotent : relance sans doublon ; force remplace atomiquement", () => {
    const first = Number(getSetting(db.sqlite, "current_run_id"));
    const again = scoreMonth(db.sqlite, T);
    expect(again).toMatchObject({ runId: first, reused: true, recommendations: 0, alerts: 0 });
    const forced = scoreMonth(db.sqlite, T, { force: true });
    expect(forced).toMatchObject({ runId: first, reused: false, recommendations: 0, alerts: 0 });
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM prediction WHERE run_id = ?").get(first)).toEqual({ n: 5 });
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM recommendation").get()).toEqual({ n: 2 });
    const orphan = db.sqlite.prepare("SELECT count(*) AS n FROM recommendation r WHERE NOT EXISTS (SELECT 1 FROM prediction p WHERE p.id = r.prediction_id)").get();
    expect(orphan).toEqual({ n: 0 });
  });

  it("une recommandation rejetée ou réalisée n'est pas reproposée pour le même mois (relance, force)", () => {
    db.sqlite.prepare("UPDATE recommendation SET status = 'REJETEE' WHERE action_code = 'ENTRETIEN'").run();
    db.sqlite.prepare("UPDATE recommendation SET status = 'REALISEE' WHERE action_code = 'PLAN_FORMATION'").run();
    expect(scoreMonth(db.sqlite, T).recommendations).toBe(0);
    expect(scoreMonth(db.sqlite, T, { force: true }).recommendations).toBe(0);
    expect(db.sqlite.prepare("SELECT action_code AS a, status FROM recommendation ORDER BY id").all()).toEqual([
      { a: "PLAN_FORMATION", status: "REALISEE" },
      { a: "ENTRETIEN", status: "REJETEE" },
    ]);
  });

  it("publication refusée pour un mois au-delà de la fin des données", () => {
    expect(() => scoreMonth(db.sqlite, "2025-07-31")).toThrow(/fin des données/);
    expect(scoreMonth(db.sqlite, "2025-05-31", { publish: false }).published).toBe(false);
  });

  it("modèle LOGREG promu : nouveau run et bascule du pointeur", () => {
    registerBundle(db.sqlite, TOY);
    promoteModel(db.sqlite, "logreg-toy-v1");
    // petite base (1 démission) : règle de démarrage à froid désactivée pour tester LOGREG (voir scoring-cold-start.test.ts)
    setSetting(db.sqlite, "min_events_for_model", "0");
    const r = scoreMonth(db.sqlite, T);
    expect(r.kind).toBe("LOGREG");
    expect(getSetting(db.sqlite, "current_run_id")).toBe(String(r.runId));
    const rows = db.sqlite.prepare("SELECT prob6 AS p, lift FROM prediction WHERE run_id = ?").all(r.runId) as { p: number; lift: number }[];
    const mean = rows.reduce((s, x) => s + x.p, 0) / rows.length;
    for (const x of rows) {
      expect(x.p).toBeGreaterThan(0);
      expect(x.p).toBeLessThan(1);
      expect(x.lift).toBeCloseTo(x.p / mean, 12);
    }
  });
});

function mapToSnapshot(model: ReturnType<typeof toyModel>, x: number[]): number[] {
  const values = FEATURES.map((f) => f.impute);
  model.idx.forEach((snapIdx, j) => (values[snapIdx] = x[j]));
  return values;
}

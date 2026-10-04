import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { championStatus, getTransparency, parseMetrics, readBundle } from "@/lib/dal/model";
import { setSetting } from "@/lib/settings";
import { auditOf, buildWorld, expectHttp, openDalDb } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
beforeAll(() => {
  db = openDalDb("dal-model");
  w = buildWorld(db.sqlite);
});
afterAll(() => db.close());

const insertModel = (version: string, kind: string, status: string, bundlePath: string | null, metrics: unknown = null, manifest: unknown = null) =>
  getDb()
    .sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path, metrics_json, manifest_json, promoted_by) VALUES (?, ?, ?, 'v1', ?, ?, ?, ?)")
    .run(version, kind, status, bundlePath, metrics == null ? null : typeof metrics === "string" ? metrics : JSON.stringify(metrics), manifest == null ? null : typeof manifest === "string" ? manifest : JSON.stringify(manifest), w.users.admin);
const setChampion = (version: string) => {
  getDb().sqlite.prepare("UPDATE model_version SET status = 'RETIRE' WHERE status = 'CHAMPION'").run();
  getDb().sqlite.prepare("UPDATE model_version SET status = 'CHAMPION' WHERE version = ?").run(version);
};

describe("lecture des bundles", () => {
  it("dossier ou model.json direct, sous la racine du projet seulement", () => {
    expect(readBundle(null)).toEqual({ ok: false, error: "Fichiers du modèle non référencés : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation)." });
    expect(readBundle("tests/fixtures/engine/logreg-toy")).toMatchObject({ ok: true, bundle: { version: "logreg-toy-v1", kind: "LOGREG" } });
    expect(readBundle("tests/fixtures/engine/logreg-toy/model.json")).toMatchObject({ ok: true });
    expect(readBundle("tests/fixtures/unit/nexiste-pas")).toEqual({ ok: false, error: "Fichiers du modèle introuvables ou illisibles : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation)." });
    expect(readBundle("tests/fixtures/unit/bundle-format-inattendu")).toEqual({ ok: false, error: "Fichiers du modèle au format inattendu : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation)." });
    expect(readBundle("tests/../../model.json")).toEqual({ ok: false, error: "Fichiers du modèle placés hors de l'application : ils ne sont pas lus. Le modèle doit être réenregistré (procédure du guide d'exploitation)." });
    expect(readBundle("C:/Windows")).toEqual({ ok: false, error: "Fichiers du modèle placés hors de l'application : ils ne sont pas lus. Le modèle doit être réenregistré (procédure du guide d'exploitation)." });
  });
});

describe("lecture tolérante des métriques", () => {
  it("clés alternatives, blocs imbriqués, filtres des points invalides", () => {
    const m = parseMetrics(
      JSON.stringify({
        horizon_months: 6,
        auc_6m: 0.7,
        auc_ci: [0.65, 0.75],
        average_precision: 0.12,
        brier: 0.03,
        eval: { n: 5000, positives: 150, base_rate: 0.03, period: "2025-01..2025-06" },
        calibration: {
          observed_expected: 1.1,
          slope: 0.9,
          by_horizon: [{ horizon: 3, oe: 1.2, brier: 0.02 }, { oe: 5 }, { horizon: 0, oe: 1 }],
          bins: [{ predicted: 0.01, obs_rate: 0.012, n: 400 }, { p_mean: 0.2 }, { p_mean: "x", observed: 0.1 }],
        },
        lift: { k_rate: 0.02, lift_at_k: 4, precision_at_k: 0.2, recall_at_k: 0.3, curve: [{ top_pct: 1, lift: 5 }, { lift: 2 }] },
        net_benefit: [{ threshold: 0.05, net_benefit: 0.01, treat_all: -0.02 }, { net_benefit: 1 }],
        fairness: { age_band: [{ label: "<30", n: 10, observed_rate: 0.05, predicted_rate: 0.04, oe: 1.25, tpr: 0.5, fpr: 0.1 }, { n: 100 }], note: "indicatif", other: 3 },
        golden: { max_abs_diff: 1e-12 },
        seed: 42,
        commentaire: "ok",
        drapeau: true,
        objet: { a: 1 },
      }),
    )!;
    expect(m).toMatchObject({ horizonMonths: 6, auc: 0.7, aucCi: [0.65, 0.75], prAuc: 0.12, brier: 0.03, evalN: 5000, evalPositives: 150, evalBaseRate: 0.03, evalPeriod: "2025-01..2025-06" });
    expect(m.calibration).toEqual({
      oe: 1.1,
      slope: 0.9,
      byHorizon: [{ horizon: 3, oe: 1.2, slope: null, brier: 0.02 }],
      bins: [{ predicted: 0.01, observed: 0.012, n: 400 }],
    });
    expect(m.lift).toEqual({ kRate: 0.02, liftAtK: 4, precisionAtK: 0.2, recallAtK: 0.3, curve: [{ topPct: 1, lift: 5, precision: null }] });
    expect(m.decisionCurve).toEqual([{ threshold: 0.05, netBenefit: 0.01, treatAll: -0.02 }]);
    expect(m.fairness).toEqual({
      minGroupSize: 30,
      note: "indicatif",
      dimensions: [
        {
          key: "age_band",
          label: "Tranche d'âge",
          rows: [
            { group: "<30", n: 10, baseRate: 0.05, meanPred: 0.04, oe: 1.25, selectionRate: null, tpr: 0.5, fpr: 0.1, masked: true },
            { group: "?", n: 100, baseRate: null, meanPred: null, oe: null, selectionRate: null, tpr: null, fpr: null, masked: false },
          ],
        },
      ],
    });
    expect(m.golden).toEqual({ status: "?", maxAbsDiff: 1e-12 });
    expect(m.other).toEqual([
      { key: "seed", value: "42" },
      { key: "commentaire", value: "ok" },
      { key: "drapeau", value: "true" },
    ]);
  });

  it("valeurs de repli : lift numérique à la racine, intervalle incomplet, JSON non objet", () => {
    const m = parseMetrics(JSON.stringify({ roc_auc: 0.8, lift: 2.5, k_rate: 0.05, auc_ci: [0.7], decision_curve: [] }))!;
    expect(m).toMatchObject({ auc: 0.8, aucCi: null, lift: { liftAtK: 2.5, kRate: 0.05, curve: [] }, fairness: { dimensions: [], note: null }, golden: null });
    expect(parseMetrics(JSON.stringify({ auc_ci: [0.7, "x"] }))!.aucCi).toBeNull();
    expect(parseMetrics(null)).toBeNull();
    expect(parseMetrics("[1,2]")).toBeNull();
    expect(parseMetrics("42")).toBeNull();
  });
});

describe("transparence du modèle", () => {
  it("sans champion : fiche vide, versions listées ; décision lue dans les paramètres", () => {
    insertModel("b0-ancien", "B0", "RETIRE", null, { auc: 0.6, lift_at_k: 2 });
    setSetting(getDb().sqlite, "capacity_rate", "0.03");
    const t = getTransparency(w.ctx.admin);
    expect(t.champion).toBeNull();
    expect(t.versions).toEqual([expect.objectContaining({ version: "b0-ancien", auc: 0.6, liftAtK: 2, promotedBy: "admin" })]);
    expect(t).toMatchObject({ decision: { capacityRate: 0.03, mediumLift: 2 }, contractFsv: "v1" });
    setSetting(getDb().sqlite, "capacity_rate", "0.02");
  });

  it("champion LGBM : variables hors contrat ignorées, métriques du bundle à défaut de metrics_json, sans règles", () => {
    insertModel("lgbm-test", "LGBM", "CANDIDAT", "tests/fixtures/unit/bundle-lgbm");
    setChampion("lgbm-test");
    const c = getTransparency(w.ctx.rh).champion!;
    expect(c).toMatchObject({ kind: "LGBM", trainedAt: "2026-01-15T00:00:00Z", dataHash: "sha256:abc", bundleError: null, intercept: null, calibration: null, rules: null });
    expect(c.groups.map((g) => [g.code, g.features.map((f) => f.name)])).toEqual([
      ["REMUNERATION", ["raise_pct_12m", "compa_ratio"]],
      ["TEMPS_TRAVAIL", ["overtime_h_avg_3m"]],
    ]);
    expect(c.groups[0].weight).toBeCloseTo(0.9, 12);
    expect(c.groups[0].features[1]).toMatchObject({ coef: 0.3, effect: 0.3, mean: null, std: null, unit: "ratio", label: "salaire à x % de la médiane du poste" });
    expect(c.metrics).toMatchObject({ auc: 0.71, lift: { liftAtK: 3.2 } });
  });

  it("bundle introuvable : erreur affichée, métadonnées du manifeste en repli ; manifeste illisible ignoré", () => {
    insertModel("lr-perdu", "LOGREG", "CANDIDAT", "models/turnover/nexiste-pas", "pas du json", { trained_at: "2026-02-01", train_rows: 999, data_hash: "sha256:def" });
    setChampion("lr-perdu");
    const c = getTransparency(w.ctx.admin).champion!;
    expect(c).toMatchObject({ bundleError: "Fichiers du modèle introuvables ou illisibles : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation).", trainedAt: "2026-02-01", trainRows: 999, dataHash: "sha256:def", groups: [], metrics: null });
    getDb().sqlite.prepare("UPDATE model_version SET manifest_json = '{cassé' WHERE version = 'lr-perdu'").run();
    expect(getTransparency(w.ctx.admin).champion).toMatchObject({ trainedAt: null, trainRows: null, dataHash: null });
  });

  it("champion B0 sans chemin : règles de features.json, aucune erreur de bundle ; B0 avec chemin invalide : erreur", () => {
    insertModel("b0-v1", "B0", "CANDIDAT", null);
    setChampion("b0-v1");
    const c = getTransparency(w.ctx.rh).champion!;
    expect(c.bundleError).toBeNull();
    expect(c.rules!.map((r) => r.feature)).toContain("compa_ratio");
    expect(c.rules!.find((r) => r.feature === "overtime_h_avg_3m")!.label).toBe("x h supplémentaires par mois en moyenne");
    getDb().sqlite.prepare("UPDATE model_version SET bundle_path = 'models/turnover/absent' WHERE version = 'b0-v1'").run();
    expect(getTransparency(w.ctx.rh).champion!.bundleError).toBe("Fichiers du modèle introuvables ou illisibles : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation).");
  });

  it("manager : 403 audité", () => {
    expectHttp(() => getTransparency(w.ctx.mgr), 403);
    expect(auditOf(db.sqlite, "model.view").at(-1)).toMatchObject({ outcome: "REFUSE", userId: w.users.mgr });
  });
});

describe("démarrage à froid exposé à la page Transparence", () => {
  it("LOGREG sous le seuil : actif avec message ; seuil atteint : probabilité indicative ; B0 : rien à signaler", () => {
    const sqlite = getDb().sqlite;
    // T4 : démission le 01/03/2025 (saisie le 02/03), éligible fin octobre 2024
    sqlite.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, '2024-10-31', 'v1', '[]')").run(w.e.T4);
    setChampion("lr-perdu");
    const cold = getTransparency(w.ctx.rh).coldStart!;
    expect(cold).toMatchObject({ asOf: "2025-06-30", events: 1, threshold: 30, indicativeUntil: 150, active: true, indicative: false, champion: "lr-perdu" });
    expect(cold.message).toMatch(/^Démarrage à froid : 1 démission observée \(seuil 30\)\. .*score à règles B0/);
    setSetting(sqlite, "min_events_for_model", "1");
    expect(getTransparency(w.ctx.admin).coldStart).toMatchObject({ active: false, indicative: true, message: expect.stringMatching(/^Probabilité indicative/) });
    setSetting(sqlite, "min_events_for_model", "30");
    setChampion("b0-v1");
    expect(getTransparency(w.ctx.rh).coldStart).toMatchObject({ active: false, indicative: false, message: null, champion: "b0-v1" });
    expect(getTransparency(w.ctx.rh).publishedRun).toBeNull();
  });
});

describe("état du champion pour /api/health", () => {
  it("absent, B0 sans chemin, bundle lisible ou non", () => {
    getDb().sqlite.prepare("UPDATE model_version SET status = 'RETIRE'").run();
    expect(championStatus()).toEqual({ loaded: false, kind: null });
    getDb().sqlite.prepare("UPDATE model_version SET bundle_path = NULL WHERE version = 'b0-v1'").run();
    setChampion("b0-v1");
    expect(championStatus()).toEqual({ loaded: true, kind: "B0" });
    setChampion("lr-perdu");
    expect(championStatus()).toEqual({ loaded: false, kind: "LOGREG" });
    setChampion("lgbm-test");
    expect(championStatus()).toEqual({ loaded: true, kind: "LGBM" });
  });
});

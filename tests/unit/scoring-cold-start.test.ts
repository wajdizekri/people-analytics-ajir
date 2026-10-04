import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backfillFeatures } from "@/lib/features";
import { coldStartState, observedResignations, promoteModel, registerBundle, scoreMonth } from "@/lib/scoring";
import { setSetting } from "@/lib/settings";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildTeamScenario, T } from "../fixtures/engine/scenario";

const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");
const LOGREG = path.resolve(__dirname, "../../models/turnover/logreg-v1-20260930");

describe("démarrage à froid du modèle turnover", () => {
  let db: TestDb;
  let ids: ReturnType<typeof buildTeamScenario>;
  const runModel = (runId: number) =>
    db.sqlite.prepare("SELECT m.version, m.kind FROM scoring_run r JOIN model_version m ON m.id = r.model_version_id WHERE r.id = ?").get(runId);

  beforeAll(() => {
    db = createTestDb();
    ids = buildTeamScenario(new Fixture(db.sqlite));
    setSetting(db.sqlite, "data_end_date", T);
    backfillFeatures(db.sqlite, "2024-06", "2025-06");
    registerBundle(db.sqlite, TOY);
    promoteModel(db.sqlite, "logreg-toy-v1");
  });
  afterAll(() => db.close());

  it("démissions observées : horizon de 6 mois clos et sortie saisie à la date de calcul", () => {
    // D : démission le 01/03/2025, saisie le 02/04/2025
    expect(observedResignations(db.sqlite, T, "v1")).toBe(1);
    expect(observedResignations(db.sqlite, "2025-03-31", "v1")).toBe(0);
    expect(observedResignations(db.sqlite, "2025-04-30", "v1")).toBe(1);
    expect(observedResignations(db.sqlite, T, "v0")).toBe(0);
  });

  it("sous le seuil (30 par défaut) : le champion LOGREG est écarté, le run publié utilise B0, raison exposée et auditée", () => {
    const r = scoreMonth(db.sqlite, T);
    expect(r).toMatchObject({ kind: "B0", modelVersion: "b0-v1", published: true });
    expect(r.coldStart).toMatchObject({ active: true, events: 1, threshold: 30, champion: "logreg-toy-v1" });
    expect(r.coldStart!.message).toMatch(/Démarrage à froid : 1 démission observée \(seuil 30\)/);
    expect(runModel(r.runId)).toEqual({ version: "b0-v1", kind: "B0" });
    const champion = db.sqlite.prepare("SELECT version FROM model_version WHERE status = 'CHAMPION'").get();
    expect(champion).toEqual({ version: "logreg-toy-v1" });
    const audit = db.sqlite.prepare("SELECT detail_json AS d FROM audit_log WHERE action = 'scoring.publish' ORDER BY id DESC LIMIT 1").get() as { d: string };
    expect(JSON.parse(audit.d)).toMatchObject({ model: "b0-v1", coldStart: { champion: "logreg-toy-v1", events: 1, threshold: 30 } });
  });

  it("seuil atteint : LOGREG utilisé, probabilité indicative sous indicative_until_events", () => {
    setSetting(db.sqlite, "min_events_for_model", "1");
    const r = scoreMonth(db.sqlite, T, { force: true });
    expect(r).toMatchObject({ kind: "LOGREG", modelVersion: "logreg-toy-v1", coldStart: null });
    expect(runModel(r.runId)).toEqual({ version: "logreg-toy-v1", kind: "LOGREG" });
    const s = coldStartState(db.sqlite, T, "LOGREG", "v1");
    expect(s).toMatchObject({ active: false, indicative: true, events: 1, threshold: 1, indicativeUntil: 150 });
    expect(s.message).toMatch(/Probabilité indicative/);
    setSetting(db.sqlite, "indicative_until_events", "1");
    expect(coldStartState(db.sqlite, T, "LOGREG", "v1")).toMatchObject({ active: false, indicative: false, message: null });
  });

  it("0 désactive la règle ; valeur invalide = défaut ; un champion B0 n'est jamais concerné", () => {
    setSetting(db.sqlite, "min_events_for_model", "0");
    expect(coldStartState(db.sqlite, "2025-01-31", "LOGREG", "v1")).toMatchObject({ active: false, events: 0, threshold: 0 });
    setSetting(db.sqlite, "min_events_for_model", "trente");
    expect(coldStartState(db.sqlite, T, "LOGREG", "v1")).toMatchObject({ active: true, threshold: 30 });
    expect(coldStartState(db.sqlite, T, "B0", "v1")).toMatchObject({ active: false, indicative: false, message: null });
  });

  it("salarié opposé : exclu des variables écrites par le backfill", () => {
    db.sqlite.prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, '2025-07-01')").run(ids.a);
    const count = () => (db.sqlite.prepare("SELECT count(*) AS n FROM feature_snapshot WHERE employee_id = ?").get(ids.a) as { n: number }).n;
    expect(count()).toBeGreaterThan(0);
    backfillFeatures(db.sqlite, "2025-05", "2025-06");
    expect(db.sqlite.prepare("SELECT as_of FROM feature_snapshot WHERE employee_id = ? AND as_of >= '2025-05-31'").all(ids.a)).toEqual([]);
    const others = db.sqlite.prepare("SELECT count(DISTINCT employee_id) AS n FROM feature_snapshot WHERE as_of = ?").get(T) as { n: number };
    expect(others.n).toBeGreaterThan(0);
    db.sqlite.prepare("DELETE FROM employee_opposition WHERE employee_id = ?").run(ids.a);
  });
});

describe("manifeste enregistré : période d'entraînement conservée (Backtesting, Dérive)", () => {
  it("train_from / train_to gardés à l'enregistrement, complétés au réenregistrement d'un manifeste ancien", () => {
    const db = createTestDb();
    try {
      const bundleOf = () =>
        JSON.parse((db.sqlite.prepare("SELECT manifest_json AS m FROM model_version WHERE version = 'logreg-v1-20260930'").get() as { m: string }).m).bundle;
      const id = registerBundle(db.sqlite, LOGREG);
      expect(bundleOf()).toMatchObject({ train_from: "2020-09-30", train_to: "2026-02-28" });
      const old = JSON.parse((db.sqlite.prepare("SELECT manifest_json AS m FROM model_version WHERE id = ?").get(id) as { m: string }).m);
      delete old.bundle.train_from;
      delete old.bundle.train_to;
      db.sqlite.prepare("UPDATE model_version SET manifest_json = ? WHERE id = ?").run(JSON.stringify(old), id);
      expect(registerBundle(db.sqlite, LOGREG)).toBe(id);
      expect(bundleOf()).toMatchObject({ train_from: "2020-09-30", train_to: "2026-02-28" });
    } finally {
      db.close();
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { getTransparency, parseMetrics, readBundle } from "@/lib/dal/model";
import { getDataHealth, getImportDetail, requestRecompute } from "@/lib/dal/imports";
import { setSetting } from "@/lib/settings";
import { setupDb, teardownDb } from "./helpers";

let fx: ReturnType<typeof setupDb>;
const bundleDir = path.join("data", `test-ui-admin-${process.pid}`, "logreg-test");

beforeAll(() => {
  fx = setupDb("model");
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "model.json"),
    JSON.stringify({
      version: "logreg-test",
      kind: "LOGREG",
      fsv: "v1",
      features: ["compa_ratio", "overtime_h_avg_3m", "tenure_months"],
      standardization: { mean: [1, 10, 60], std: [0.1, 8, 50] },
      coef: [-0.4, 0.2, -0.3],
      intercept: -3.4,
      calibration: { method: "platt", a: 0.5, b: 0 },
      base_rate: 0.035,
      train_rows: 1234,
    }),
  );
  const ins = getDb().sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path, metrics_json) VALUES (?, ?, ?, 'v1', ?, ?)");
  ins.run("b0", "B0", "RETIRE", null, null);
  ins.run(
    "logreg-test",
    "LOGREG",
    "CHAMPION",
    bundleDir,
    JSON.stringify({
      auc: 0.74,
      calibration: { oe_ratio: 0.96, slope: 1.07 },
      lift: { k_rate: 0.02, lift_at_k: 4.3 },
      fairness: { min_group_size: 50, sex: [{ group: "F", n: 900, oe_ratio: 1.01 }, { group: "X", n: 12, oe_ratio: 2 }] },
      custom_metric: 0.5,
    }),
  );
});

afterAll(() => {
  fs.rmSync(path.dirname(bundleDir), { recursive: true, force: true });
  teardownDb(fx.file);
});

describe("transparence", () => {
  it("fiche du champion : coefficients par groupe (effet calibré), métriques et équité masquée sous l'effectif minimal", () => {
    const t = getTransparency(fx.ctx.rh);
    const c = t.champion!;
    expect(c.version).toBe("logreg-test");
    expect(c.trainRows).toBe(1234);
    expect(c.rules).toBeNull();
    expect(c.groups.map((g) => g.code)).toEqual(["REMUNERATION", "CARRIERE", "TEMPS_TRAVAIL"]);
    const compa = c.groups.find((g) => g.code === "REMUNERATION")!.features[0];
    expect(compa.effect).toBeCloseTo(-0.2, 12);
    expect(c.metrics?.auc).toBe(0.74);
    expect(c.metrics?.lift.liftAtK).toBe(4.3);
    expect(c.metrics?.fairness.dimensions[0].rows.map((r) => r.masked)).toEqual([false, true]);
    expect(c.metrics?.other).toEqual([{ key: "custom_metric", value: "0.5" }]);
    expect(t.versions).toHaveLength(2);
    expect(t.decision).toEqual({ capacityRate: 0.02, mediumLift: 2 });
  });

  it("champion B0 : règles de features.json affichées", () => {
    const { sqlite } = getDb();
    sqlite.prepare("UPDATE model_version SET status = 'RETIRE' WHERE version = 'logreg-test'").run();
    sqlite.prepare("UPDATE model_version SET status = 'CHAMPION' WHERE version = 'b0'").run();
    const c = getTransparency(fx.ctx.admin).champion!;
    expect(c.kind).toBe("B0");
    expect(c.rules?.length).toBeGreaterThan(0);
    expect(c.rules?.[0]).toMatchObject({ feature: "compa_ratio", op: "<", points: 2 });
    expect(c.bundleError).toBeNull();
    sqlite.prepare("UPDATE model_version SET status = 'RETIRE' WHERE version = 'b0'").run();
    sqlite.prepare("UPDATE model_version SET status = 'CHAMPION' WHERE version = 'logreg-test'").run();
  });

  it("manager refusé ; bundle hors du projet refusé ; métriques illisibles ignorées", () => {
    expect(() => getTransparency(fx.ctx.mgr)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(readBundle("../../Windows/model.json")).toEqual({ ok: false, error: "Fichiers du modèle placés hors de l'application : ils ne sont pas lus. Le modèle doit être réenregistré (procédure du guide d'exploitation)." });
    expect(parseMetrics("pas du json")).toBeNull();
  });
});

describe("santé des données", () => {
  it("scoring bloqué si le dernier import est BLOQUE, détail des rejets par règle et par fichier", () => {
    const { sqlite } = getDb();
    const ok = Number(sqlite.prepare("INSERT INTO import_batch (source, status, started_at, quality_score) VALUES ('a', 'OK', '2026-08-05', 0.99)").run().lastInsertRowid);
    expect(getDataHealth(fx.ctx.rh).scoring.blocked).toBe(false);
    const bad = Number(sqlite.prepare("INSERT INTO import_batch (source, status, started_at, quality_score) VALUES ('b', 'BLOQUE', '2026-09-05', 0.9)").run().lastInsertRowid);
    const rej = sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, severity) VALUES (?, ?, ?, ?, 'x', ?)");
    rej.run(bad, "payroll.csv", 2, "SALAIRE_SOUS_SMIG", "REJET");
    rej.run(bad, "payroll.csv", 3, "SALAIRE_SOUS_SMIG", "REJET");
    rej.run(bad, "attendance.csv", 9, "MATRICULE_INCONNU", "REJET");
    rej.run(bad, "payroll.csv", 5, "PAIE_INCOMPLETE", "AVERTISSEMENT");
    setSetting(sqlite, "worker_heartbeat", new Date(Date.now() - 30_000).toISOString());

    const h = getDataHealth(fx.ctx.admin);
    expect(h.scoring.blocked).toBe(true);
    expect(h.lastImport?.id).toBe(bad);
    expect(h.worker.state).toBe("ACTIF");
    const d = getImportDetail(fx.ctx.rh, bad);
    expect(d.byRule[0]).toEqual({ rule: "SALAIRE_SOUS_SMIG", severity: "REJET", n: 2 });
    expect(d.byFile.map((f) => [f.file, f.n])).toEqual([["payroll.csv", 3], ["attendance.csv", 1]]);
    expect(d.samples[0]).not.toHaveProperty("raw");
    expect(() => getImportDetail(fx.ctx.rh, ok + 1000)).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => requestRecompute(fx.ctx.admin)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(() => getDataHealth(fx.ctx.mgr)).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("recalcul : un seul job BATCH_MENSUEL actif", () => {
    getDb().sqlite.prepare("INSERT INTO import_batch (source, status, started_at) VALUES ('c', 'OK', '2026-09-20')").run();
    const first = requestRecompute(fx.ctx.admin);
    expect(first.alreadyQueued).toBe(false);
    expect(requestRecompute(fx.ctx.admin)).toEqual({ jobId: first.jobId, alreadyQueued: true });
    expect(() => requestRecompute(fx.ctx.rh)).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

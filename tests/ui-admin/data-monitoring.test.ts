import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { getDataMonitoring, getModelMonitoring } from "@/lib/dal/data-monitoring";
import { setSetting } from "@/lib/settings";
import { auditRows, setupDb, teardownDb } from "./helpers";

let fx: ReturnType<typeof setupDb>;
const DAY = 86_400_000;
const ago = (days: number, time = "10:00:00.000") => `${new Date(Date.now() - days * DAY).toISOString().slice(0, 10)}T${time}Z`;
const FORBIDDEN_KEY = /matricule|employee|name|login|user|salaire|salary|prob|rank|lift/i;

function flatten(v: unknown, keys: string[] = [], strings: string[] = []): { keys: string[]; strings: string[] } {
  if (typeof v === "string") strings.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flatten(x, keys, strings));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      keys.push(k);
      flatten(x, keys, strings);
    }
  return { keys, strings };
}

let ids: { recent: number; fallback: number; runs: number[] };

beforeAll(() => {
  fx = setupDb("monitoring");
  const { sqlite } = getDb();
  const batch = sqlite.prepare(
    "INSERT INTO import_batch (source, status, started_at, rows_ok, rows_rejected, quality_score, report_json, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const rej = sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, severity) VALUES (?, 'attendance.csv', ?, ?, 'x', ?)");
  const old = Number(batch.run("ancien", "OK", ago(120), 900, 50, 0.97, null, fx.users.admin).lastInsertRowid);
  for (let i = 0; i < 5; i++) rej.run(old, i, "DOUBLON", "REJET");
  const fallback = Number(batch.run("sans-rapport", "BLOQUE", ago(40), 800, 200, 0.9, null, fx.users.admin).lastInsertRowid);
  rej.run(fallback, 1, "MATRICULE_INCONNU", "REJET");
  rej.run(fallback, 2, "MATRICULE_INCONNU", "REJET");
  rej.run(fallback, 3, "GRADE_INCONNU", "CORRECTION");
  const report = JSON.stringify({ rules: { MATRICULE_INCONNU: 1500, PAIE_INCOMPLETE: 3, POINTAGE_DUPLIQUE: 0 } });
  const recent = Number(batch.run("recent", "OK", ago(5), 1000, 12, 0.985, report, fx.users.admin).lastInsertRowid);
  batch.run("en-cours", "EN_COURS", ago(0), 0, 0, null, null, fx.users.admin);
  setSetting(sqlite, "data_end_date", ago(10).slice(0, 10));

  const job = sqlite.prepare("INSERT INTO app_job (type, target, status, created_at, started_at, finished_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
  job.run("IMPORT", "a", "TERMINE", ago(3), ago(3, "10:00:00.000"), ago(3, "10:02:00.000"), fx.users.admin);
  job.run("IMPORT", "b", "TERMINE", ago(2), ago(2, "10:00:00.000"), ago(2, "10:04:00.000"), fx.users.admin);
  job.run("IMPORT", "c", "ECHEC", ago(1), ago(1, "10:00:00.000"), ago(1, "10:00:30.000"), fx.users.admin);
  job.run("SCORING", null, "EN_FILE", ago(0), null, null, fx.users.rh);
  job.run("AGGREGATE", null, "TERMINE", ago(45), ago(45), ago(45), fx.users.admin);

  const model = sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES (?, ?, ?, 'v1')");
  const logreg = Number(model.run("logreg-mon", "LOGREG", "CHAMPION").lastInsertRowid);
  const b0Model = Number(model.run("b0-mon", "B0", "RETIRE").lastInsertRowid);
  const run = sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored) VALUES (?, ?, ?, ?)");
  const pred = sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)");
  const emps = Object.values(fx.emp);
  const runs: number[] = [];
  for (const [asOf, modelId, status] of [
    ["2026-06-30", b0Model, "PUBLIE"],
    ["2026-07-31", b0Model, "PUBLIE"],
    ["2026-07-31", logreg, "PUBLIE"],
    ["2026-08-31", logreg, "PUBLIE"],
    ["2026-09-30", logreg, "ECHEC"],
  ] as const) {
    const id = Number(run.run(asOf, modelId, status, emps.length).lastInsertRowid);
    runs.push(id);
    emps.forEach((e, k) => pred.run(id, e, asOf, 0.004 + k * 0.011, k === emps.length - 1 ? "ELEVE" : k >= emps.length - 3 ? "MOYEN" : "FAIBLE", emps.length - k, modelId));
  }
  setSetting(sqlite, "current_run_id", String(runs[3]));
  ids = { recent, fallback, runs };
});

afterAll(() => teardownDb(fx.file));

describe("suivi des données et du modèle", () => {
  it("manager : 403 audité sur les deux agrégats", () => {
    expect(() => getDataMonitoring(fx.ctx.mgr)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => getModelMonitoring(fx.ctx.mgr)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(auditRows("data_monitoring.view")).toEqual([expect.objectContaining({ user_id: fx.users.mgr, outcome: "REFUSE" })]);
    expect(auditRows("model_monitoring.view")).toEqual([expect.objectContaining({ user_id: fx.users.mgr, outcome: "REFUSE" })]);
  });

  it("santé des données : imports terminés, rejets par règle sur 90 jours, jobs sur 30 jours, fraîcheur", () => {
    const m = getDataMonitoring(fx.ctx.admin);
    expect(getDataMonitoring(fx.ctx.rh)).toEqual(m);
    expect(m.qualityThreshold).toBe(0.95);
    expect(m.imports.map((i) => i.id)).toEqual([ids.recent - 2, ids.fallback, ids.recent]);
    expect(m.imports.at(-1)).toEqual({ id: ids.recent, startedAt: expect.any(String), status: "OK", rowsOk: 1000, rowsRejected: 12, qualityScore: 0.985 });
    expect(m.rejectionsByRule).toEqual([
      { rule: "MATRICULE_INCONNU", label: "Matricule inconnu", severity: "REJET", n: 1502 },
      { rule: "PAIE_INCOMPLETE", label: "Collaborateur actif sans paie du mois", severity: "AVERTISSEMENT", n: 3 },
      { rule: "GRADE_INCONNU", label: "Grade inconnu (grade ignoré)", severity: "CORRECTION", n: 1 },
    ]);
    // imports terminés dans la fenêtre des rejets (l'import ancien et l'import en cours n'y sont pas)
    expect(m.rejectionImports).toBe(2);
    const imp = m.jobs.find((j) => j.type === "IMPORT")!;
    expect(imp).toMatchObject({ total: 3, byStatus: { TERMINE: 2, ECHEC: 1, EN_COURS: 0, EN_FILE: 0 } });
    expect(imp.avgDurationSec).toBeCloseTo(180, 0);
    expect(m.jobs.find((j) => j.type === "SCORING")).toMatchObject({ total: 1, avgDurationSec: null });
    expect(m.jobs.map((j) => j.type)).not.toContain("AGGREGATE");
    expect(m.dataLagDays).toBe(10);
  });

  it("suivi du modèle : un calcul par mois, niveaux agrégés, histogramme par classes", () => {
    const m = getModelMonitoring(fx.ctx.rh);
    expect(getModelMonitoring(fx.ctx.admin)).toEqual(m);
    expect(m.runs.map((r) => [r.asOf, r.modelKind, r.current])).toEqual([
      ["2026-06-30", "B0", false],
      ["2026-07-31", "LOGREG", false],
      ["2026-08-31", "LOGREG", true],
    ]);
    expect(m.runs[2]).toMatchObject({ nScored: 8, levels: { ELEVE: 1, MOYEN: 2, FAIBLE: 5 } });
    expect(m.lastRun).toMatchObject({ id: ids.runs[3], modelKind: "LOGREG" });
    const d = m.distribution!;
    expect(d.n).toBe(8);
    expect(d.bins.reduce((a, b) => a + b.n, 0)).toBe(8);
    expect(d.bins.length).toBeLessThanOrEqual(21);
    expect(d.bins[0].from).toBe(0);
    for (const b of d.bins) expect(Object.keys(b).sort()).toEqual(["from", "n", "to"]);
  });

  it("calcul publié à règles B0 : aucune distribution d'estimations", () => {
    const { sqlite } = getDb();
    setSetting(sqlite, "current_run_id", String(ids.runs[0]));
    const m = getModelMonitoring(fx.ctx.admin);
    expect(m.lastRun?.modelKind).toBe("B0");
    expect(m.distribution).toBeNull();
    setSetting(sqlite, "current_run_id", String(ids.runs[3]));
  });

  it("aucun champ nominatif ni score individuel dans les agrégats", () => {
    const identities = new Set([...Object.keys(fx.emp), ...Object.keys(fx.users)]);
    for (const ctx of [fx.ctx.admin, fx.ctx.rh]) {
      for (const dto of [getDataMonitoring(ctx), getModelMonitoring(ctx)]) {
        const { keys, strings } = flatten(dto);
        expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
        expect(strings.filter((s) => identities.has(s) || s.includes("Nom "))).toEqual([]);
      }
    }
  });
});

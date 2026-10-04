import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../fixtures/engine/db";
import { setSetting } from "@/lib/settings";
import { recordOpposition } from "@/lib/privacy";
import { DEFAULTS, resolveDuration, runRetention } from "../../scripts/retention";

const NOW = new Date("2026-09-30T10:00:00Z");

describe("scripts/retention.ts", () => {
  let db: TestDb;
  let inbox: string;
  let oldRun: number;
  let currentOld: number;
  let recent: number;
  let emp: number;
  const n = (sql: string, ...p: unknown[]) => (db.sqlite.prepare(sql).get(...p) as { n: number }).n;
  const snapshot = () =>
    ["session", "scoring_run", "prediction", "prediction_factor", "training_risk", "feature_snapshot", "audit_log"].map((t) => n(`SELECT COUNT(*) AS n FROM ${t}`));

  beforeAll(() => {
    db = createTestDb();
    const s = db.sqlite;
    emp = Number(s.prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date) VALUES ('E1', 'Nom', 'Prénom', '2020-01-01')").run().lastInsertRowid);
    const opp = Number(s.prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date) VALUES ('E2', 'Nom', 'Prénom', '2020-01-01')").run().lastInsertRowid);
    const user = Number(s.prepare("INSERT INTO app_user (login, role) VALUES ('rh', 'RH')").run().lastInsertRowid);
    const sess = s.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)");
    sess.run("expiree", user, "2026-09-29T00:00:00.000Z");
    sess.run("valide", user, "2026-10-01T00:00:00.000Z");
    const model = Number(s.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('m', 'LOGREG', 'CHAMPION', 'v1')").run().lastInsertRowid);
    const run = (asOf: string) => {
      const id = Number(s.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored) VALUES (?, ?, 'PUBLIE', 1)").run(asOf, model).lastInsertRowid);
      const pid = Number(s.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, 0.1, 'FAIBLE', 1, 1, ?)").run(id, emp, asOf, model).lastInsertRowid);
      s.prepare("INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction) VALUES (?, 'EQUIPE', 0.1, 1, 'HAUSSE')").run(pid);
      return { id, pid };
    };
    const o = run("2024-01-31");
    oldRun = o.id;
    currentOld = run("2024-02-29").id;
    recent = run("2026-08-31").id;
    setSetting(s, "current_run_id", String(currentOld));
    s.prepare("INSERT INTO recommendation (employee_id, prediction_id, action_code, trigger_group, status) VALUES (?, ?, 'ENTRETIEN', 'NIVEAU_ELEVE', 'REALISEE')").run(emp, o.pid);
    const risk = s.prepare("INSERT INTO training_risk (training_id, employee_id, as_of, prob, level, model_version) VALUES (1, ?, ?, 0.2, 'FAIBLE', 'x')");
    risk.run(emp, "2024-01-31");
    risk.run(emp, "2026-08-31");
    s.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, '2026-08-31', 'v1', '[]')").run(opp);
    recordOpposition(s, { employeeId: opp });
    s.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, '2026-08-31', 'v1', '[]')").run(opp);
    s.prepare("INSERT INTO audit_log (at, action) VALUES ('2024-01-01T00:00:00.000Z', 'test.ancien')").run();

    inbox = fs.mkdtempSync(path.join(os.tmpdir(), "pa-retention-inbox-"));
    for (const d of ["20250101T080000Z", "20250102T080000Z", "20260925T080000Z"]) fs.mkdirSync(path.join(inbox, d));
    fs.writeFileSync(path.join(inbox, "20250101T080000Z", "payroll.csv"), "matricule;month\n");
    fs.writeFileSync(path.join(inbox, "notes.txt"), "x");
    s.prepare("INSERT INTO app_job (type, target, status) VALUES ('IMPORT', 'inbox/20250102T080000Z', 'EN_FILE')").run();
  });
  afterAll(() => {
    db.close();
    fs.rmSync(inbox, { recursive: true, force: true });
  });

  const opts = () => ({ now: NOW, inboxDir: inbox, inboxDays: 90, predictionMonths: 24 });

  it("simulation par défaut : comptes exacts, aucune modification, aucun fichier supprimé", () => {
    const before = snapshot();
    const r = runRetention(db.sqlite, opts());
    expect(r.apply).toBe(false);
    expect(r.sessions).toBe(1);
    expect(r.predictions).toMatchObject({ cutoff: "2024-09-30", runs: [{ id: oldRun, asOf: "2024-01-31" }], predictions: 1, factors: 1, trainingRisks: 1 });
    expect(r.oppositions).toMatchObject({ employees: 1, purged: { snapshots: 1 } });
    expect(r.inbox.removed).toEqual(["20250101T080000Z"]);
    expect(r.inbox.kept).toEqual([
      { name: "20250102T080000Z", reason: "import en file ou en cours" },
      { name: "notes.txt", reason: "fichier hors dépôt (ignoré)" },
    ]);
    expect(r.audit).toMatchObject({ months: 12, cutoff: "2025-09-30", olderEntries: 1 });
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(path.join(inbox, "20250101T080000Z"))).toBe(true);
  });

  it("--apply : purge ciblée, calcul publié conservé même ancien, journal d'audit intact et complété", () => {
    const auditBefore = n("SELECT COUNT(*) AS n FROM audit_log");
    const r = runRetention(db.sqlite, { ...opts(), apply: true });
    expect(r.apply).toBe(true);
    expect(n("SELECT COUNT(*) AS n FROM session")).toBe(1);
    expect((db.sqlite.prepare("SELECT id FROM scoring_run ORDER BY id").all() as { id: number }[]).map((x) => x.id)).toEqual([currentOld, recent]);
    expect(n("SELECT COUNT(*) AS n FROM prediction WHERE run_id = ?", oldRun)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM prediction WHERE run_id IN (?, ?)", currentOld, recent)).toBe(2);
    expect(n("SELECT COUNT(*) AS n FROM prediction_factor")).toBe(2);
    expect(db.sqlite.prepare("SELECT status, prediction_id AS p FROM recommendation").all()).toEqual([{ status: "REALISEE", p: null }]);
    expect(n("SELECT COUNT(*) AS n FROM training_risk")).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM feature_snapshot")).toBe(0);
    expect(fs.readdirSync(inbox).sort()).toEqual(["20250102T080000Z", "20260925T080000Z", "notes.txt"]);
    expect(n("SELECT COUNT(*) AS n FROM audit_log")).toBe(auditBefore + 1);
    expect(n("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'test.ancien'")).toBe(1);
    const trace = db.sqlite.prepare("SELECT detail_json AS d FROM audit_log WHERE action = 'retention.apply'").get() as { d: string };
    expect(JSON.parse(trace.d)).toMatchObject({ sessions: 1, runs: [oldRun], predictions: 1, inboxRemoved: ["20250101T080000Z"] });
    expect(() => db.sqlite.prepare("DELETE FROM audit_log").run()).toThrow(/ajout seul/);
    expect(runRetention(db.sqlite, { ...opts(), apply: true })).toMatchObject({ sessions: 0, predictions: { predictions: 0 }, inbox: { removed: [] } });
    expect(n("SELECT COUNT(*) AS n FROM employee WHERE id = ?", emp)).toBe(1);
  });

  it("durées : option > variable d'environnement > paramètre > défaut ; valeur invalide refusée", () => {
    const s = db.sqlite;
    expect(resolveDuration(s, undefined, "PA_TEST_RET", "retention_test", DEFAULTS.inboxDays)).toBe(90);
    setSetting(s, "retention_test", "60");
    expect(resolveDuration(s, undefined, "PA_TEST_RET", "retention_test", 90)).toBe(60);
    process.env.PA_TEST_RET = "45";
    expect(resolveDuration(s, undefined, "PA_TEST_RET", "retention_test", 90)).toBe(45);
    expect(resolveDuration(s, 30, "PA_TEST_RET", "retention_test", 90)).toBe(30);
    process.env.PA_TEST_RET = "0";
    expect(() => resolveDuration(s, undefined, "PA_TEST_RET", "retention_test", 90)).toThrow(/invalide/);
    delete process.env.PA_TEST_RET;
  });
});

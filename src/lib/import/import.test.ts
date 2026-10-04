import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setSetting } from "@/lib/settings";
import { runImport, type ImportResult } from "./index";
import { FIXTURE_DIR, fixtureCopy, tempDb } from "./test-db";

const TABLES = [
  "department",
  "employee",
  "contract",
  "exit_event",
  "career_event",
  "attendance_daily",
  "absence_episode",
  "payroll_monthly",
  "training",
  "evaluation",
  "app_user",
];

const EXPECTED_RULES = {
  DOUBLON: 5,
  CHAMP_OBLIGATOIRE: 4,
  DATE_INVALIDE: 1,
  VALEUR_INVALIDE: 6,
  MATRICULE_DUPLIQUE: 1,
  DEPARTEMENT_INCONNU: 1,
  FORMAT_LIGNE: 1,
  MATRICULE_INCONNU: 5,
  SORTIE_AVANT_EMBAUCHE: 1,
  FIN_AVANT_DEBUT: 3,
  ABSENCE_HORS_EMPLOI: 1,
  SALAIRE_SOUS_SMIG: 1,
  POINTAGE_DUPLIQUE: 1,
  GRADE_INCONNU: 1,
  MANAGER_INEXISTANT: 1,
  CYCLE_HIERARCHIQUE: 1,
  SORTIE_SANS_MOTIF: 1,
  POINTAGE_SANS_SORTIE: 1,
  PAIE_INCOMPLETE: 2,
};

describe("runImport sur la mini-fixture AJIR", () => {
  const db = tempDb();
  const { sqlite } = db;
  let first: ImportResult;
  const get = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).get(...p) as T;
  const all = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];
  const empId = (m: string) => get<{ id: number }>("SELECT id FROM employee WHERE matricule = ?", m).id;
  const ruleCounts = (batchId: number) =>
    Object.fromEntries(
      all<{ rule: string; n: number }>("SELECT rule, COUNT(*) AS n FROM import_rejection WHERE batch_id = ? GROUP BY rule", batchId).map(
        (r) => [r.rule, r.n],
      ),
    );
  const snapshot = () =>
    Object.fromEntries(TABLES.map((t) => [t, JSON.stringify(all(`SELECT * FROM ${t} ORDER BY 1, 2`))]));

  beforeAll(async () => {
    sqlite.prepare("INSERT INTO app_user (login, password_hash, role) VALUES ('admin', 'hash-existant', 'ADMIN')").run();
    first = await runImport(sqlite, FIXTURE_DIR, { userId: 1 });
  });
  afterAll(() => db.close());

  it("motive chaque contrôle avec sa règle et sa sévérité", () => {
    expect(ruleCounts(first.batchId)).toEqual(EXPECTED_RULES);
    const dup = get<{ file: string; line: number; severity: string; raw: string }>(
      "SELECT file, line, severity, raw FROM import_rejection WHERE batch_id = ? AND rule = 'MATRICULE_DUPLIQUE'",
      first.batchId,
    );
    expect(dup).toMatchObject({ file: "employees.csv", line: 12, severity: "REJET" });
    expect(dup.raw.startsWith("E003;Jaziri")).toBe(true);
    const sev = all<{ rule: string; severity: string }>(
      "SELECT DISTINCT rule, severity FROM import_rejection WHERE severity <> 'REJET' ORDER BY rule",
    );
    expect(sev).toEqual([
      { rule: "CYCLE_HIERARCHIQUE", severity: "CORRECTION" },
      { rule: "GRADE_INCONNU", severity: "CORRECTION" },
      { rule: "MANAGER_INEXISTANT", severity: "CORRECTION" },
      { rule: "PAIE_INCOMPLETE", severity: "AVERTISSEMENT" },
      { rule: "POINTAGE_SANS_SORTIE", severity: "AVERTISSEMENT" },
      { rule: "SORTIE_SANS_MOTIF", severity: "CORRECTION" },
    ]);
  });

  it("calcule le score qualité et bloque sous le seuil", () => {
    expect(first).toMatchObject({ status: "BLOQUE", rowsOk: 68, rowsRejected: 31, dataEndDate: "2026-02-27" });
    expect(first.qualityScore).toBeCloseTo(0.4985, 4);
    expect(first.report.quality).toMatchObject({ payrollMonth: "2026-02", activeCount: 9, activeWithoutPayroll: 2 });
    expect(first.report.files["employees.csv"]).toMatchObject({ rows: 16, ok: 10, rejected: 6 });
    const batch = get<{ status: string; rows_ok: number; report_json: string; user_id: number }>(
      "SELECT * FROM import_batch WHERE id = ?",
      first.batchId,
    );
    expect(batch).toMatchObject({ status: "BLOQUE", rows_ok: 68, user_id: 1 });
    expect(JSON.parse(batch.report_json).files["attendance.csv"].rules).toMatchObject({ POINTAGE_DUPLIQUE: 1, POINTAGE_SANS_SORTIE: 1 });
    expect(get<{ value: string }>("SELECT value FROM app_setting WHERE key = 'data_end_date'").value).toBe("2026-02-27");
  });

  it("applique corrections, statuts et clés résolues", () => {
    const e = (m: string) =>
      get<{ status: string; exit_date: string | null; manager_id: number | null; grade: string | null }>(
        "SELECT status, exit_date, manager_id, grade FROM employee WHERE matricule = ?",
        m,
      );
    expect(e("E004")).toMatchObject({ status: "SORTI", exit_date: "2026-01-31" });
    expect(e("E008")).toMatchObject({ status: "SORTI", manager_id: null });
    expect(e("E007").grade).toBeNull();
    expect(e("E009").manager_id).toBeNull();
    expect(e("E010").manager_id).toBe(empId("E009"));
    expect(e("E003")).toMatchObject({ status: "ACTIF", manager_id: empId("E002") });
    expect(get<{ reason: string }>("SELECT reason FROM exit_event WHERE employee_id = ?", empId("E008")).reason).toBe("AUTRE");
    const health = all<{ category: string; is_health: number }>("SELECT category, is_health FROM absence_episode ORDER BY start_date");
    expect(health.filter((a) => a.is_health).map((a) => a.category).sort()).toEqual(["MALADIE", "MATERNITE"]);
    expect(
      get<{ recorded_at: string }>("SELECT recorded_at FROM absence_episode WHERE category = 'ABSENCE_INJUSTIFIEE'").recorded_at,
    ).toBe("2026-02-05");
    expect(get<{ recorded_at: string }>("SELECT recorded_at FROM evaluation WHERE employee_id = ?", empId("E004")).recorded_at).toBe(
      "2026-03-15",
    );
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM payroll_monthly WHERE month = '2023-06'").n).toBe(1);
    expect(get<{ check_out: string | null }>("SELECT check_out FROM attendance_daily WHERE employee_id = ?", empId("E004")).check_out).toBeNull();
  });

  it("crée une alerte DONNEES et trace l'import", () => {
    const alert = get<Record<string, unknown>>("SELECT * FROM alert WHERE dedup_key = ?", `import:${first.batchId}`);
    expect(alert).toMatchObject({ type: "DONNEES", severity: "CRITIQUE", audience: "RH", link: "/data-health" });
    const audit = get<{ user_id: number; outcome: string; detail_json: string }>(
      "SELECT * FROM audit_log WHERE action = 'import.run' AND target_id = ?",
      String(first.batchId),
    );
    expect(audit).toMatchObject({ user_id: 1, outcome: "OK" });
    expect(JSON.parse(audit.detail_json)).toMatchObject({ status: "BLOQUE", rowsRejected: 31 });
  });

  it("synchronise les comptes sans jamais stocker le jeton en clair", () => {
    const admin = get<{ password_hash: string; activation_token_hash: string | null }>("SELECT * FROM app_user WHERE login = 'admin'");
    expect(admin).toMatchObject({ password_hash: "hash-existant", activation_token_hash: null });
    expect(first.report.users).toMatchObject({ created: ["rh.sonia", "mgr.sami"], protectedAdmins: ["admin"], ignoredInactive: 1 });
    expect(first.activationLinks.map((l) => l.login)).toEqual(["rh.sonia", "mgr.sami"]);
    for (const l of first.activationLinks) {
      const token = new URL(l.link, "http://x").searchParams.get("token")!;
      const u = get<{ activation_token_hash: string; activation_expires_at: string; password_hash: string | null }>(
        "SELECT * FROM app_user WHERE login = ?",
        l.login,
      );
      expect(u.activation_token_hash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
      expect(u.password_hash).toBeNull();
      const days = (Date.parse(u.activation_expires_at) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      const stored = JSON.stringify(all("SELECT * FROM import_batch")) + JSON.stringify(all("SELECT * FROM audit_log"));
      expect(stored.includes(token)).toBe(false);
    }
    expect(get<{ employee_id: number }>("SELECT employee_id FROM app_user WHERE login = 'mgr.sami'").employee_id).toBe(empId("E002"));
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM app_user WHERE login = 'mgr.leila'").n).toBe(0);
  });

  it("est idempotent au réimport", async () => {
    const before = snapshot();
    const second = await runImport(sqlite, FIXTURE_DIR);
    expect(snapshot()).toEqual(before);
    expect(ruleCounts(second.batchId)).toEqual(EXPECTED_RULES);
    expect(second).toMatchObject({ status: "BLOQUE", rowsOk: 68, rowsRejected: 31 });
    expect(second.activationLinks).toEqual([]);
  });

  it("passe OK quand le score atteint le seuil (alerte ATTENTION si rejets)", async () => {
    setSetting(sqlite, "quality_threshold", "0.4");
    const res = await runImport(sqlite, FIXTURE_DIR);
    setSetting(sqlite, "quality_threshold", "0.95");
    expect(res.status).toBe("OK");
    expect(get<{ severity: string }>("SELECT severity FROM alert WHERE dedup_key = ?", `import:${res.batchId}`).severity).toBe("ATTENTION");
  });

  it("signale une variation de volume > 30 % et désactive les comptes", async () => {
    const session = sqlite
      .prepare("INSERT INTO session (id, user_id, expires_at) VALUES ('s1', (SELECT id FROM app_user WHERE login = 'rh.sonia'), '2999-01-01')")
      .run();
    expect(session.changes).toBe(1);
    const att = fs.readFileSync(path.join(FIXTURE_DIR, "attendance.csv"), "utf8").trim().split(/\r?\n/);
    const users = fs.readFileSync(path.join(FIXTURE_DIR, "users.csv"), "utf8").replace("rh.sonia;;RH;sonia@atlas.tn;1", "rh.sonia;;RH;sonia@atlas.tn;0");
    const dir = fixtureCopy(db.dir, "volume", { "attendance.csv": att.slice(0, 4).join("\n") + "\n", "users.csv": users });
    const res = await runImport(sqlite, dir);
    const v = all<{ file: string; severity: string }>(
      "SELECT file, severity FROM import_rejection WHERE batch_id = ? AND rule = 'VARIATION_VOLUME'",
      res.batchId,
    );
    expect(v).toEqual([{ file: "attendance.csv", severity: "AVERTISSEMENT" }]);
    expect(res.report.users?.deactivated).toEqual(["rh.sonia"]);
    expect(get<{ active: number }>("SELECT active FROM app_user WHERE login = 'rh.sonia'").active).toBe(0);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM session WHERE id = 's1'").n).toBe(0);
  });

  it("rejette un fichier optionnel à l'en-tête invalide", async () => {
    const dir = fixtureCopy(db.dir, "entete", { "evaluations.csv": "matricule;date_eval;note\nE003;2025-12-15;4\n" });
    const res = await runImport(sqlite, dir);
    expect(res.report.files["evaluations.csv"].headerError).toContain("eval_date");
    expect(ruleCounts(res.batchId).EN_TETE_INVALIDE).toBe(1);
    expect(res.status).toBe("BLOQUE");
  });

  it("échoue sans fichier obligatoire", async () => {
    const dir = fixtureCopy(db.dir, "echec", { "employees.csv": null });
    const res = await runImport(sqlite, dir);
    expect(res).toMatchObject({ status: "ECHEC", qualityScore: null });
    expect(res.report.error).toContain("employees.csv");
    expect(get<{ severity: string }>("SELECT severity FROM alert WHERE dedup_key = ?", `import:${res.batchId}`).severity).toBe("CRITIQUE");
    expect(
      get<{ outcome: string }>("SELECT outcome FROM audit_log WHERE action = 'import.run' AND target_id = ?", String(res.batchId)).outcome,
    ).toBe("ECHEC");
  });
});

describe("bornes des pointages et fin des données", () => {
  const db = tempDb();
  const { sqlite } = db;
  afterAll(() => db.close());
  const rules = (batchId: number) =>
    Object.fromEntries(
      (sqlite.prepare("SELECT rule, COUNT(*) AS n FROM import_rejection WHERE batch_id = ? GROUP BY rule").all(batchId) as { rule: string; n: number }[]).map((r) => [r.rule, r.n]),
    );
  const attendance = () => fs.readFileSync(path.join(FIXTURE_DIR, "attendance.csv"), "utf8").trimEnd();

  it("rejette un pointage futur ou hors période d'emploi ; la fin des données reste celle des pointages valides", async () => {
    const dir = fixtureCopy(db.dir, "bornes", {
      "attendance.csv": `${attendance()}\nE003;2062-08-14;08:00;17:00;480;0;0\nE006;2025-10-01;08:00;17:00;480;0;0\n`,
    });
    const res = await runImport(sqlite, dir);
    expect(res.dataEndDate).toBe("2026-02-27");
    expect(rules(res.batchId)).toMatchObject({ POINTAGE_FUTUR: 1, POINTAGE_HORS_EMPLOI: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM attendance_daily WHERE date IN ('2062-08-14', '2025-10-01')").get()).toEqual({ n: 0 });
  });

  it("un lot partiel ne fait pas reculer la fin des données ; une valeur future est ignorée ; une avancée anormale est signalée", async () => {
    const partial = fixtureCopy(db.dir, "partiel", { "attendance.csv": attendance().split(/\r?\n/).slice(0, 4).join("\n") + "\n" });
    expect((await runImport(sqlite, partial)).dataEndDate).toBe("2026-02-27");

    setSetting(sqlite, "data_end_date", "2062-08-14");
    expect((await runImport(sqlite, FIXTURE_DIR)).dataEndDate).toBe("2026-02-27");

    setSetting(sqlite, "data_end_date", "2025-11-30");
    const jump = await runImport(sqlite, FIXTURE_DIR);
    expect(jump.dataEndDate).toBe("2026-02-27");
    expect(rules(jump.batchId).FIN_DONNEES_AVANCE).toBe(1);
  });
});

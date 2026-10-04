import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runImport } from "@/lib/import";
import { describeIssues } from "@/lib/import/process";
import { DETAIL_CAP, IssueLog, isReject, reject, RULES } from "@/lib/import/rules";
import { tempDb } from "@/lib/import/test-db";
import { getSetting } from "@/lib/settings";

let db: ReturnType<typeof tempDb>;
beforeEach(() => (db = tempDb()));
afterEach(() => db.close());

const EMP_HEADER = "matricule;last_name;first_name;sex;birth_date;hire_date;department_code;job_family;job_title;grade;manager_matricule;governorate;marital_status";
function exportDir(name: string, files: Record<string, string>): string {
  const dir = path.join(db.dir, name);
  fs.mkdirSync(dir, { recursive: true });
  const base: Record<string, string> = {
    "departments.csv": "code;name\nPROD;Production\n",
    "employees.csv": [
      EMP_HEADER,
      "E1;Un;Alpha;F;1990-01-01;2020-01-01;PROD;TECH;Tech;G2;E3;Tunis;",
      "E2;Deux;Beta;M;1991-01-01;2021-01-01;PROD;TECH;Tech;G2;E2;Tunis;",
      "E3;Trois;Gamma;M;1980-01-01;2015-01-01;PROD;TECH;Chef;G5;;Tunis;",
    ].join("\n"),
  };
  for (const [f, c] of Object.entries({ ...base, ...files })) fs.writeFileSync(path.join(dir, f), c.endsWith("\n") ? c : c + "\n");
  return dir;
}
const rules = (batchId: number) =>
  Object.fromEntries(
    (db.sqlite.prepare("SELECT rule, COUNT(*) AS n FROM import_rejection WHERE batch_id = ? GROUP BY rule").all(batchId) as { rule: string; n: number }[]).map((r) => [r.rule, r.n]),
  );

describe("journal des contrôles", () => {
  it("détail plafonné par fichier et par règle, comptage complet ; ligne brute nettoyée et tronquée ; sévérité de la règle", () => {
    const batch = Number(db.sqlite.prepare("INSERT INTO import_batch (source) VALUES ('t')").run().lastInsertRowid);
    const log = new IssueLog(db.sqlite, batch);
    for (let i = 0; i < DETAIL_CAP + 2; i++) log.add("attendance.csv", i + 2, "POINTAGE_DUPLIQUE", "doublon", "E1;2025-01-01\r\n");
    log.add("employees.csv", 3, "GRADE_INCONNU", "m".repeat(800), "x".repeat(400) + "\n");
    log.add("payroll.csv", null, "PAIE_INCOMPLETE", "sans paie");
    log.flushInTransaction();
    log.flushInTransaction();
    expect(log.count("attendance.csv", "POINTAGE_DUPLIQUE")).toBe(DETAIL_CAP + 2);
    expect(log.count("attendance.csv", "GRADE_INCONNU")).toBe(0);
    expect(log.count("absent.csv", "DOUBLON")).toBe(0);
    expect(rules(batch)).toEqual({ POINTAGE_DUPLIQUE: DETAIL_CAP, GRADE_INCONNU: 1, PAIE_INCOMPLETE: 1 });
    const rows = db.sqlite.prepare("SELECT file, line, raw, length(message) AS m, severity FROM import_rejection WHERE batch_id = ? AND rule <> 'POINTAGE_DUPLIQUE' ORDER BY id").all(batch);
    expect(rows).toEqual([
      { file: "employees.csv", line: 3, raw: "x".repeat(300), m: 500, severity: "CORRECTION" },
      { file: "payroll.csv", line: null, raw: null, m: 9, severity: "AVERTISSEMENT" },
    ]);
    expect(db.sqlite.prepare("SELECT DISTINCT raw FROM import_rejection WHERE rule = 'POINTAGE_DUPLIQUE'").all()).toEqual([{ raw: "E1;2025-01-01" }]);
  });

  it("chaque règle a une sévérité connue ; rejet typé", () => {
    for (const r of Object.values(RULES)) expect(["REJET", "CORRECTION", "AVERTISSEMENT"]).toContain(r.severity);
    expect(isReject(reject("DOUBLON", "x"))).toBe(true);
    expect(isReject({ id: 1 })).toBe(false);
    expect(isReject(null)).toBe(false);
  });

  it("motif d'un rejet de schéma : champ manquant, date invalide, valeur invalide ; première règle retenue", () => {
    const schema = z.object({ hire_date: z.iso.date(), score: z.coerce.number().max(5), name: z.string() });
    const res = schema.safeParse({ hire_date: "2025-02-30", score: "9" });
    if (res.success) throw new Error();
    const r = describeIssues(res.error, { hire_date: "2025-02-30", score: "9" });
    expect(r.reject).toBe("DATE_INVALIDE");
    expect(r.message).toBe("Date invalide pour hire_date : « 2025-02-30 » (format attendu AAAA-MM-JJ) ; valeur invalide pour score : « 9 » ; champ obligatoire manquant : name");
    const only = schema.safeParse({ hire_date: "2025-01-01", score: "1" });
    if (only.success) throw new Error();
    expect(describeIssues(only.error, { hire_date: "2025-01-01", score: "1" })).toEqual({ reject: "CHAMP_OBLIGATOIRE", message: "Champ obligatoire manquant : name" });
  });
});

describe("import : règles des fichiers optionnels", () => {
  it("auto-rattachement hiérarchique rompu ; doublons et matricules inconnus dans carrière, formations, évaluations, absences", async () => {
    const dir = exportDir("regles", {
      "career_events.csv": "matricule;date;event_type;old_value;new_value;recorded_at\nE1;2025-01-01;PROMOTION;G1;G2;\nE1;2025-01-01;PROMOTION;G1;G2;\nE9;2025-01-01;PROMOTION;G1;G2;",
      "trainings.csv": "matricule;training_code;title;mandatory;start_date;end_date;due_date;hours;status\nE1;F1;Sécurité;1;;;2025-03-31;7;PLANIFIEE\nE1;F1;Sécurité;1;;;2025-03-31;7;TERMINEE\nE9;F1;Sécurité;1;;;2025-03-31;7;PLANIFIEE\nE1;F2;Excel;0;2025-02-10;2025-02-01;;7;TERMINEE",
      "evaluations.csv": "matricule;eval_date;score;recorded_at\nE1;2025-01-15;4;\nE1;2025-01-15;3;\nE9;2025-01-15;3;\nE2;2025-01-15;0;",
      "absences.csv": "matricule;start_date;end_date;days;category;recorded_at\nE9;2025-02-03;2025-02-03;1;AUTRE;\nE1;2019-02-03;2019-02-03;1;AUTRE;",
    });
    const r = await runImport(db.sqlite, dir, { source: "unit" });
    expect(rules(r.batchId)).toEqual({ CYCLE_HIERARCHIQUE: 1, DOUBLON: 3, MATRICULE_INCONNU: 4, FIN_AVANT_DEBUT: 1, VALEUR_INVALIDE: 1, ABSENCE_HORS_EMPLOI: 1 });
    const mgr = db.sqlite.prepare("SELECT matricule, manager_id AS m FROM employee ORDER BY matricule").all();
    const e3 = (db.sqlite.prepare("SELECT id FROM employee WHERE matricule = 'E3'").get() as { id: number }).id;
    expect(mgr).toEqual([
      { matricule: "E1", m: e3 },
      { matricule: "E2", m: null },
      { matricule: "E3", m: null },
    ]);
    expect(db.sqlite.prepare("SELECT status FROM training").all()).toEqual([{ status: "PLANIFIEE" }]);
    expect(db.sqlite.prepare("SELECT score, recorded_at AS r FROM evaluation").all()).toEqual([{ score: 4, r: "2025-04-15" }]);
    expect(r.report.files["attendance.csv"]).toMatchObject({ present: false });
    expect(r.dataEndDate).toBeNull();
    expect(getSetting(db.sqlite, "data_end_date")).toBe("");
    expect(r.report.source).toBe("unit");
  });

  it("en-tête invalide de departments.csv ou employees.csv : import en échec, rien d'importé", async () => {
    const bad = await runImport(db.sqlite, exportDir("dep", { "departments.csv": "code,name\nPROD,Production" }));
    expect(bad).toMatchObject({ status: "ECHEC", qualityScore: null });
    expect(bad.report.error).toMatch(/^departments\.csv : en-tête invalide/);
    const bad2 = await runImport(db.sqlite, exportDir("emp", { "employees.csv": "matricule;nom\nE1;Un" }));
    expect(bad2.report.error).toMatch(/^employees\.csv : en-tête invalide/);
    expect(rules(bad2.batchId)).toEqual({ EN_TETE_INVALIDE: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM employee").get()).toEqual({ n: 0 });
  });
});

describe("import : synchronisation des comptes", () => {
  it("réactivation avec nouveau lien, jeton encore valide conservé, jeton expiré renouvelé, ADMIN avec mot de passe protégé, rejets", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const ins = db.sqlite.prepare("INSERT INTO app_user (login, role, active, password_hash, activation_token_hash, activation_expires_at) VALUES (?, ?, ?, ?, ?, ?)");
    ins.run("rh.sonia", "RH", 0, null, null, null);
    ins.run("mgr.valide", "MANAGER", 1, null, "jeton-valide", future);
    ins.run("mgr.expire", "MANAGER", 1, null, "jeton-expire", past);
    ins.run("admin", "ADMIN", 1, "hash", null, null);
    ins.run("admin.sans.mdp", "ADMIN", 1, null, "a", future);
    ins.run("ancien", "RH", 1, "hash", null, null);
    const dir = exportDir("users", {
      "users.csv": [
        "login;matricule;role;email;active",
        "rh.sonia;;RH;sonia@atlas.tn;1",
        "rh.sonia;;RH;sonia@atlas.tn;1",
        "mgr.valide;E3;MANAGER;;1",
        "mgr.expire;E3;MANAGER;;1",
        "admin;;RH;;0",
        "admin.sans.mdp;;ADMIN;nouveau@atlas.tn;1",
        "ancien;;RH;;0",
        "inactif.nouveau;;RH;;0",
        "mgr.sans;;MANAGER;;1",
        "mgr.fantome;E9;MANAGER;;1",
        "x;;RH;;1",
        "mail;;RH;pas-un-mail;1",
      ].join("\n"),
    });
    const r = await runImport(db.sqlite, dir);
    expect(r.report.users).toEqual({
      created: [],
      reactivated: ["rh.sonia"],
      deactivated: ["ancien"],
      updated: 3,
      protectedAdmins: ["admin"],
      ignoredInactive: 1,
    });
    expect(r.activationLinks.map((l) => l.login).sort()).toEqual(["mgr.expire", "rh.sonia"]);
    const hash = (login: string) => (db.sqlite.prepare("SELECT activation_token_hash AS h FROM app_user WHERE login = ?").get(login) as { h: string }).h;
    expect(hash("mgr.valide")).toBe("jeton-valide");
    const link = r.activationLinks.find((l) => l.login === "mgr.expire")!;
    expect(hash("mgr.expire")).toBe(crypto.createHash("sha256").update(new URL(link.link, "http://x").searchParams.get("token")!).digest("hex"));
    expect(db.sqlite.prepare("SELECT role, active, email FROM app_user WHERE login = 'admin'").get()).toEqual({ role: "ADMIN", active: 1, email: null });
    expect(db.sqlite.prepare("SELECT email FROM app_user WHERE login = 'admin.sans.mdp'").get()).toEqual({ email: "nouveau@atlas.tn" });
    const e3 = (db.sqlite.prepare("SELECT id FROM employee WHERE matricule = 'E3'").get() as { id: number }).id;
    expect(db.sqlite.prepare("SELECT employee_id AS e FROM app_user WHERE login = 'mgr.valide'").get()).toEqual({ e: e3 });
    const userRules = db.sqlite.prepare("SELECT rule, COUNT(*) AS n FROM import_rejection WHERE batch_id = ? AND file = 'users.csv' GROUP BY rule ORDER BY rule").all(r.batchId);
    expect(userRules).toEqual([
      { rule: "CHAMP_OBLIGATOIRE", n: 1 },
      { rule: "DOUBLON", n: 1 },
      { rule: "MATRICULE_INCONNU", n: 1 },
      { rule: "VALEUR_INVALIDE", n: 2 },
    ]);
    expect(r.report.files["users.csv"]).toMatchObject({ rows: 12, ok: 7, rejected: 5 });
  });

  it("users.csv absent ou à l'en-tête invalide : aucune synchronisation, et le score qualité l'ignore", async () => {
    const none = await runImport(db.sqlite, exportDir("sans-users", {}));
    expect(none.report.users).toBeNull();
    const bad = await runImport(db.sqlite, exportDir("users-entete", { "users.csv": "identifiant;role\nrh;RH" }));
    expect(bad.report.users).toBeNull();
    expect(bad.report.files["users.csv"].headerError).toMatch(/login/);
    expect(bad.qualityScore).toBe(none.qualityScore);
  });
});

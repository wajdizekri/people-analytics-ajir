import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openSqlite } from "../src/db/client";
import { hashPassword } from "../src/lib/auth/password";
import { seedDefaultSettings, setSetting } from "../src/lib/settings";

// Données de démonstration des écrans Alertes, Santé des données, Transparence et Administration.
// Usage : DATABASE_PATH=data/dev-ui-admin.db npx tsx scripts/seed-dev-admin.ts [motDePasseDemo]
const DB_FILE = process.env.DATABASE_PATH ?? "data/dev-ui-admin.db";
const PASSWORD = process.argv[2] ?? "DemoAjir2026";
const CHAMPION = "logreg-v1-20260915";
const BUNDLE_DIR = path.join("data", "dev-ui-admin", "models", "turnover", CHAMPION);

type Features = { fsv: string; features: { name: string; group: string }[] };

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const DEPARTMENTS = [
  ["DG", "Direction générale"],
  ["PROD", "Production"],
  ["COM", "Commercial"],
  ["FIN", "Finance et comptabilité"],
  ["SI", "Systèmes d'information"],
] as const;

// matricule, nom, prénom, sexe, naissance, embauche, département, famille, poste, grade, manager, gouvernorat, statut
const EMPLOYEES: [string, string, string, "F" | "M", string, string, string, string, string, string, string | null, string, "ACTIF" | "SORTI"][] = [
  ["E0001", "Ben Salah", "Karim", "M", "1968-04-12", "2004-09-01", "DG", "Direction", "Directeur général", "G8", null, "Tunis", "ACTIF"],
  ["E0002", "Trabelsi", "Leila", "F", "1981-11-03", "2010-02-15", "PROD", "Production", "Responsable de production", "G6", "E0001", "Ben Arous", "ACTIF"],
  ["E0003", "Gharbi", "Sami", "M", "1986-06-21", "2013-05-02", "PROD", "Production", "Chef d'atelier", "G5", "E0002", "Ben Arous", "ACTIF"],
  ["E0004", "Ayari", "Mohamed", "M", "1994-01-30", "2019-03-11", "PROD", "Production", "Technicien de maintenance", "G3", "E0002", "Ariana", "ACTIF"],
  ["E0005", "Mejri", "Amira", "F", "1996-09-14", "2021-06-01", "PROD", "Production", "Contrôleuse qualité", "G3", "E0002", "Tunis", "ACTIF"],
  ["E0006", "Hammami", "Walid", "M", "1990-12-08", "2016-10-17", "PROD", "Production", "Opérateur", "G2", "E0003", "Ben Arous", "ACTIF"],
  ["E0007", "Bouazizi", "Rim", "F", "1998-02-25", "2022-01-10", "PROD", "Production", "Opératrice", "G2", "E0003", "Manouba", "ACTIF"],
  ["E0008", "Khelifi", "Anis", "M", "1992-07-19", "2018-04-23", "PROD", "Production", "Opérateur", "G2", "E0003", "Ben Arous", "ACTIF"],
  ["E0009", "Sassi", "Ines", "F", "1999-05-05", "2023-02-06", "PROD", "Production", "Opératrice", "G1", "E0003", "Ariana", "ACTIF"],
  ["E0010", "Dridi", "Yassine", "M", "1995-03-02", "2020-09-14", "PROD", "Production", "Opérateur", "G2", "E0003", "Ben Arous", "SORTI"],
  ["E0011", "Jaziri", "Nadia", "F", "1983-08-17", "2011-01-03", "COM", "Commercial", "Responsable commerciale", "G6", "E0001", "Tunis", "ACTIF"],
  ["E0012", "Mansouri", "Hatem", "M", "1989-10-11", "2015-07-01", "COM", "Commercial", "Chargé de clientèle", "G4", "E0011", "Sousse", "ACTIF"],
  ["E0013", "Chaabane", "Salma", "F", "1997-04-28", "2021-11-15", "COM", "Commercial", "Chargée de clientèle", "G3", "E0011", "Tunis", "ACTIF"],
  ["E0014", "Ferchichi", "Oussama", "M", "1993-12-01", "2019-08-26", "COM", "Commercial", "Commercial terrain", "G3", "E0011", "Sfax", "ACTIF"],
  ["E0015", "Baccouche", "Mariem", "F", "1991-06-09", "2017-03-20", "COM", "Commercial", "Assistante commerciale", "G2", "E0011", "Nabeul", "ACTIF"],
  ["E0016", "Mansour", "Hichem", "M", "1979-02-14", "2008-06-02", "FIN", "Finance", "Directeur administratif et financier", "G7", "E0001", "Tunis", "ACTIF"],
  ["E0017", "Zouari", "Olfa", "F", "1988-09-23", "2014-09-15", "FIN", "Finance", "Comptable", "G4", "E0016", "Sfax", "ACTIF"],
  ["E0018", "Kacem", "Bilel", "M", "1996-11-30", "2022-04-04", "FIN", "Finance", "Contrôleur de gestion", "G4", "E0016", "Monastir", "ACTIF"],
  ["E0019", "Hadded", "Sonia", "F", "1985-01-16", "2012-10-08", "SI", "Informatique", "Responsable SI", "G6", "E0001", "Ariana", "ACTIF"],
  ["E0020", "Rekik", "Fares", "M", "1997-07-07", "2023-05-15", "SI", "Informatique", "Développeur", "G4", "E0019", "Sfax", "ACTIF"],
];

function championMetrics() {
  return {
    horizon_months: 6,
    eval: { period: "2025-03 → 2026-02 (origines mensuelles, suivi complet)", n: 14_820, n_pos: 512, base_rate: 0.0345 },
    auc: 0.742,
    auc_ci: [0.721, 0.763],
    pr_auc: 0.112,
    brier: 0.0318,
    calibration: {
      oe_ratio: 0.96,
      slope: 1.07,
      by_horizon: [
        { horizon: 3, oe_ratio: 0.93, slope: 1.04, brier: 0.0171 },
        { horizon: 6, oe_ratio: 0.96, slope: 1.07, brier: 0.0318 },
        { horizon: 12, oe_ratio: 1.18, slope: 0.91, brier: 0.0587 },
      ],
      bins: [
        [0.0061, 0.0054, 1482], [0.0094, 0.0081, 1482], [0.0122, 0.0128, 1482], [0.0151, 0.0142, 1482], [0.0187, 0.0196, 1482],
        [0.0229, 0.0243, 1482], [0.0284, 0.0270, 1482], [0.0362, 0.0385, 1482], [0.0497, 0.0520, 1482], [0.0921, 0.0985, 1482],
      ].map(([p, o, n]) => ({ p_mean: p, observed: o, n })),
    },
    lift: {
      k_rate: 0.02,
      lift_at_k: 4.3,
      precision_at_k: 0.148,
      recall_at_k: 0.086,
      curve: [
        { top_pct: 0.01, lift: 5.1, precision: 0.176 },
        { top_pct: 0.02, lift: 4.3, precision: 0.148 },
        { top_pct: 0.05, lift: 3.2, precision: 0.11 },
        { top_pct: 0.1, lift: 2.5, precision: 0.086 },
        { top_pct: 0.2, lift: 1.9, precision: 0.066 },
      ],
    },
    decision_curve: [
      { threshold: 0.01, net_benefit: 0.0251, treat_all: 0.0247 },
      { threshold: 0.03, net_benefit: 0.0112, treat_all: 0.0045 },
      { threshold: 0.05, net_benefit: 0.0063, treat_all: -0.0163 },
      { threshold: 0.1, net_benefit: 0.0021, treat_all: -0.0728 },
    ],
    fairness: {
      min_group_size: 50,
      note: "Démonstration de l'outil sur données simulées : l'interprétation est réservée aux données client.",
      sex: [
        { group: "Femmes", n: 5_930, base_rate: 0.0321, mean_pred: 0.0318, oe_ratio: 1.01, selection_rate: 0.018, tpr_at_k: 0.081, fpr_at_k: 0.0158 },
        { group: "Hommes", n: 8_890, base_rate: 0.0361, mean_pred: 0.0379, oe_ratio: 0.95, selection_rate: 0.021, tpr_at_k: 0.089, fpr_at_k: 0.0186 },
      ],
      age_band: [
        { group: "Moins de 30 ans", n: 3_410, base_rate: 0.0572, mean_pred: 0.0541, oe_ratio: 1.06, selection_rate: 0.041, tpr_at_k: 0.112, fpr_at_k: 0.0351 },
        { group: "30 à 44 ans", n: 7_760, base_rate: 0.0301, mean_pred: 0.0318, oe_ratio: 0.95, selection_rate: 0.015, tpr_at_k: 0.071, fpr_at_k: 0.0131 },
        { group: "45 ans et plus", n: 3_610, base_rate: 0.0214, mean_pred: 0.0226, oe_ratio: 0.95, selection_rate: 0.006, tpr_at_k: 0.044, fpr_at_k: 0.0052 },
        { group: "Non renseigné", n: 40, base_rate: 0.05, mean_pred: 0.03, oe_ratio: 1.6, selection_rate: 0.05, tpr_at_k: 0.5, fpr_at_k: 0.03 },
      ],
    },
    golden: { status: "OK", max_abs_diff: 3.1e-12 },
  };
}

const COEF: Record<string, [number, number, number]> = {
  // coef (standardisé), moyenne, écart-type
  tenure_months: [-0.31, 74, 61],
  contract_cdd: [0.22, 0.18, 0.38],
  grade_level: [-0.12, 3.1, 1.4],
  months_since_promotion: [0.27, 38, 26],
  job_change_12m: [-0.05, 0.08, 0.27],
  compa_ratio: [-0.41, 1.0, 0.12],
  raise_pct_12m: [-0.18, 0.031, 0.034],
  months_since_raise: [0.16, 13, 9],
  overtime_h_avg_3m: [0.19, 9.5, 8.1],
  overtime_trend_6m: [0.08, 0.1, 1.9],
  late_count_3m: [0.11, 2.4, 3.1],
  arrival_std_min_3m: [0.09, 11, 7],
  no_badge_days_3m: [0.14, 0.9, 1.6],
  absence_rate_3m: [0.17, 0.021, 0.028],
  absence_rate_12m: [0.06, 0.019, 0.021],
  short_episodes_12m: [0.13, 1.2, 1.5],
  bradford_12m: [0.04, 38, 70],
  training_hours_12m: [-0.15, 16, 14],
  mandatory_training_overdue: [0.1, 0.07, 0.26],
  last_eval_score: [-0.12, 3.4, 0.7],
  eval_delta: [-0.07, 0, 0.6],
  eval_missing: [0.05, 0.12, 0.32],
  team_exit_rate_6m: [0.21, 0.035, 0.05],
  manager_change_12m: [0.12, 0.09, 0.29],
  team_size: [0.02, 9, 5],
};

function writeBundle(contract: Features) {
  const names = contract.features.map((f) => f.name);
  const bundle = {
    version: CHAMPION,
    kind: "LOGREG",
    fsv: contract.fsv,
    features: names,
    standardization: { mean: names.map((n) => COEF[n]?.[1] ?? 0), std: names.map((n) => COEF[n]?.[2] ?? 1) },
    coef: names.map((n) => COEF[n]?.[0] ?? 0),
    intercept: -3.42,
    calibration: { method: "platt", a: 0.93, b: -0.05 },
    base_rate: 0.0345,
    trained_at: "2026-09-14T22:10:00Z",
    data_hash: "sha256:" + sha256("dev-ui-admin-seed"),
    train_rows: 41_280,
    metrics: {},
  };
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUNDLE_DIR, "model.json"), JSON.stringify(bundle, null, 2));
}

async function main() {
  const t0 = Date.now();
  const sqlite = openSqlite(path.resolve(DB_FILE));
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  seedDefaultSettings(sqlite);
  const contract = JSON.parse(fs.readFileSync("shared/features.json", "utf8")) as Features;
  writeBundle(contract);

  const heartbeat = () => setSetting(sqlite, "worker_heartbeat", daysAgo(40 / 86_400));
  if (sqlite.prepare("SELECT 1 FROM app_user WHERE login = 'mgr.demo'").get()) {
    heartbeat();
    console.log(`Base déjà initialisée (${DB_FILE}) : heartbeat du worker rafraîchi, bundle réécrit.`);
    sqlite.close();
    return;
  }
  const pwd = await hashPassword(PASSWORD);

  const pendingToken = crypto.randomBytes(32).toString("base64url");
  sqlite.transaction(() => {
    const dept = sqlite.prepare("INSERT OR IGNORE INTO department (code, name) VALUES (?, ?)");
    for (const [c, n] of DEPARTMENTS) dept.run(c, n);
    const deptId = (code: string) => (sqlite.prepare("SELECT id FROM department WHERE code = ?").get(code) as { id: number }).id;

    const emp = sqlite.prepare(
      `INSERT OR IGNORE INTO employee (matricule, last_name, first_name, sex, birth_date, hire_date, department_id, job_family, job_title,
         grade, governorate, marital_status, status, exit_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const contractStmt = sqlite.prepare("INSERT INTO contract (employee_id, type, start_date, end_date) VALUES (?, ?, ?, ?)");
    for (const e of EMPLOYEES) {
      const res = emp.run(e[0], e[1], e[2], e[3], e[4], e[5], deptId(e[6]), e[7], e[8], e[9], e[11], "M", e[12], e[12] === "SORTI" ? "2026-06-30" : null);
      if (res.changes) {
        const cdd = ["E0009", "E0020"].includes(e[0]);
        contractStmt.run(Number(res.lastInsertRowid), cdd ? "CDD" : "CDI", e[5], cdd ? "2027-06-30" : null);
      }
    }
    const empId = (m: string) => (sqlite.prepare("SELECT id FROM employee WHERE matricule = ?").get(m) as { id: number }).id;
    const setMgr = sqlite.prepare("UPDATE employee SET manager_id = ? WHERE matricule = ?");
    for (const e of EMPLOYEES) if (e[10]) setMgr.run(empId(e[10]), e[0]);
    sqlite
      .prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, '2026-06-30', 'DEMISSION', '2026-05-31', '2026-06-02')")
      .run(empId("E0010"));

    const user = sqlite.prepare(
      "INSERT INTO app_user (login, password_hash, role, employee_id, email, activation_token_hash, activation_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const admin2 = Number(user.run("admin2", pwd, "ADMIN", null, "admin2@ajir.local", null, null, daysAgo(120)).lastInsertRowid);
    const rh = Number(user.run("rh.demo", pwd, "RH", null, "rh.demo@ajir.local", null, null, daysAgo(90)).lastInsertRowid);
    const mgr = Number(user.run("mgr.demo", pwd, "MANAGER", empId("E0002"), "leila.trabelsi@ajir.local", null, null, daysAgo(60)).lastInsertRowid);
    user.run("mgr.attente", null, "MANAGER", empId("E0011"), "nadia.jaziri@ajir.local", sha256(pendingToken), daysAgo(-6), daysAgo(1));

    // ---------- Imports (report_json au format ImportReport de lib/import ; détail limité à 1000 lignes par fichier et règle) ----------
    type FileSpec = { rows: number; rejected: number; rules?: Record<string, number> };
    const rej = sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, raw, severity) VALUES (?, ?, ?, ?, ?, NULL, ?)");
    const importBatch = (
      source: string,
      started: string,
      finished: string,
      files: Record<string, FileSpec>,
      payroll: { month: string; missing: number },
      dataEndDate: string,
      messages: Record<string, (i: number) => string>,
    ) => {
      const present = Object.entries(files);
      const rowScore = present.reduce((s, [, f]) => s + (f.rows ? (f.rows - f.rejected) / f.rows : 1), 0) / present.length;
      const score = Math.round(rowScore * (1 - payroll.missing / 19) * 10000) / 10000;
      const status = score < 0.95 ? "BLOQUE" : "OK";
      const rules: Record<string, number> = {};
      const reportFiles = Object.fromEntries(
        ["departments.csv", "employees.csv", "contracts.csv", "exits.csv", "career_events.csv", "attendance.csv", "absences.csv", "payroll.csv", "trainings.csv", "evaluations.csv", "users.csv"].map((name) => {
          const f = files[name];
          for (const [r, n] of Object.entries(f?.rules ?? {})) rules[r] = (rules[r] ?? 0) + n;
          return [name, f ? { present: true, rows: f.rows, ok: f.rows - f.rejected, rejected: f.rejected, durationMs: 40 + f.rows / 50, rules: f.rules ?? {} } : { present: false, rows: 0, ok: 0, rejected: 0, durationMs: 0, rules: {} }];
        }),
      );
      const report = {
        source,
        files: reportFiles,
        rules,
        quality: { score, threshold: 0.95, rowScore: Math.round(rowScore * 10000) / 10000, payrollMonth: payroll.month, activeCount: 19, activeWithoutPayroll: payroll.missing },
        dataEndDate,
        users: null,
        durationMs: Date.parse(finished) - Date.parse(started),
      };
      const rowsOk = present.reduce((s, [, f]) => s + f.rows - f.rejected, 0);
      const rowsRejected = present.reduce((s, [, f]) => s + f.rejected, 0);
      const id = Number(
        sqlite
          .prepare(
            `INSERT INTO import_batch (source, started_at, finished_at, status, rows_ok, rows_rejected, quality_score, report_json, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(source, started, finished, status, rowsOk, rowsRejected, score, JSON.stringify(report), admin2).lastInsertRowid,
      );
      const SEVERITY: Record<string, string> = { MANAGER_INEXISTANT: "CORRECTION", PAIE_INCOMPLETE: "AVERTISSEMENT", VARIATION_VOLUME: "AVERTISSEMENT" };
      for (const [file, f] of present)
        for (const [rule, n] of Object.entries(f.rules ?? {}))
          for (let i = 0; i < Math.min(n, 1000); i++) rej.run(id, file, rule === "VARIATION_VOLUME" ? null : 2 + i * 7, rule, messages[rule](i), SEVERITY[rule] ?? "REJET");
      return id;
    };
    const base = { "departments.csv": { rows: 5, rejected: 0 }, "contracts.csv": { rows: 22, rejected: 0 }, "exits.csv": { rows: 1, rejected: 0 } };
    const msg: Record<string, (i: number) => string> = {
      POINTAGE_DUPLIQUE: (i) => `Pointage déjà présent pour E00${String(4 + (i % 16)).padStart(2, "0")} le même jour.`,
      DATE_INVALIDE: (i) => `start_date « 2026-02-${29 + (i % 2)} » invalide.`,
      MATRICULE_INCONNU: (i) => `Matricule « T${7000 + (i % 45)} » absent de employees.csv (badges d'un site non rattaché ?).`,
      SALAIRE_SOUS_SMIG: (i) => `Salaire de base ${(210 + (i % 30)).toFixed(3)} TND inférieur au SMIG (528,320 TND) : montant saisi à la quinzaine ?`,
      MANAGER_INEXISTANT: (i) => `manager_matricule « E09${i}1 » inconnu : rattachement ignoré.`,
      PAIE_INCOMPLETE: (i) => `E001${i + 3} actif sans ligne de paie pour le dernier mois.`,
      VARIATION_VOLUME: () => "Volume de attendance.csv en hausse de 34 % par rapport à l'export précédent.",
    };
    importBatch("inbox/20260705T081500Z", "2026-07-05T08:15:00Z", "2026-07-05T08:21:40Z", {
      ...base,
      "employees.csv": { rows: 21, rejected: 0 },
      "attendance.csv": { rows: 15_840, rejected: 14, rules: { POINTAGE_DUPLIQUE: 14 } },
      "absences.csv": { rows: 392, rejected: 7, rules: { DATE_INVALIDE: 7 } },
      "payroll.csv": { rows: 680, rejected: 0 },
    }, { month: "2026-06", missing: 0 }, "2026-06-30", msg);
    const b2 = importBatch("inbox/20260805T081200Z", "2026-08-05T08:12:00Z", "2026-08-05T08:19:05Z", {
      ...base,
      "employees.csv": { rows: 21, rejected: 0 },
      "attendance.csv": { rows: 16_280, rejected: 5, rules: { POINTAGE_DUPLIQUE: 5 } },
      "absences.csv": { rows: 401, rejected: 3, rules: { DATE_INVALIDE: 3 } },
      "payroll.csv": { rows: 700, rejected: 0 },
    }, { month: "2026-07", missing: 0 }, "2026-07-31", msg);
    const b3 = importBatch("inbox/20260905T080900Z", "2026-09-05T08:09:00Z", "2026-09-05T08:16:31Z", {
      ...base,
      "employees.csv": { rows: 21, rejected: 0, rules: { MANAGER_INEXISTANT: 2 } },
      "attendance.csv": { rows: 19_120, rejected: 2_400, rules: { MATRICULE_INCONNU: 2_400, VARIATION_VOLUME: 1 } },
      "absences.csv": { rows: 410, rejected: 30, rules: { DATE_INVALIDE: 30 } },
      "payroll.csv": { rows: 720, rejected: 120, rules: { SALAIRE_SOUS_SMIG: 120, PAIE_INCOMPLETE: 1 } },
    }, { month: "2026-08", missing: 1 }, "2026-08-31", msg);

    // ---------- Modèles ----------
    const mv = sqlite.prepare(
      `INSERT INTO model_version (version, kind, status, fsv, bundle_path, metrics_json, created_at, promoted_at, promoted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const m = championMetrics();
    mv.run("b0-rules-v1", "B0", "RETIRE", contract.fsv, null, JSON.stringify({ auc: 0.64, lift: { k_rate: 0.02, lift_at_k: 2.4 } }), "2026-03-01T09:00:00Z", "2026-03-02T10:00:00Z", admin2);
    mv.run("logreg-v1-20260615", "LOGREG", "RETIRE", contract.fsv, null,
      JSON.stringify({ ...m, auc: 0.731, auc_ci: [0.708, 0.754], lift: { ...m.lift, lift_at_k: 3.9 } }), "2026-06-15T21:00:00Z", "2026-06-17T09:30:00Z", admin2);
    const champion = Number(
      mv.run(CHAMPION, "LOGREG", "CHAMPION", contract.fsv, BUNDLE_DIR.replaceAll("\\", "/"), JSON.stringify(m), "2026-09-14T22:15:00Z", "2026-09-16T09:05:00Z", admin2).lastInsertRowid,
    );
    mv.run("logreg-v1-20260925", "LOGREG", "CANDIDAT", contract.fsv, null,
      JSON.stringify({ ...m, auc: 0.745, auc_ci: [0.722, 0.766], lift: { ...m.lift, lift_at_k: 4.2 } }), "2026-09-25T21:40:00Z", null, null);

    const run = Number(
      sqlite
        .prepare("INSERT INTO scoring_run (as_of, model_version_id, status, started_at, finished_at, n_scored) VALUES ('2026-08-31', ?, 'PUBLIE', ?, ?, 18)")
        .run(champion, "2026-09-16T09:20:00Z", "2026-09-16T09:21:12Z").lastInsertRowid,
    );
    setSetting(sqlite, "current_run_id", String(run));
    setSetting(sqlite, "data_end_date", "2026-08-31");

    // ---------- Jobs ----------
    const job = sqlite.prepare(
      "INSERT INTO app_job (type, target, status, payload_json, created_at, started_at, finished_at, error, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    job.run("IMPORT", "inbox/20260805T081200Z", "TERMINE", null, "2026-08-05T08:11:58Z", "2026-08-05T08:12:00Z", "2026-08-05T08:19:05Z", null, admin2);
    job.run("BATCH_MENSUEL", "2026-08", "TERMINE", null, "2026-09-16T09:00:00Z", "2026-09-16T09:00:03Z", "2026-09-16T09:21:40Z", null, null);
    job.run("IMPORT", "inbox/20260905T080900Z", "TERMINE", null, "2026-09-05T08:08:57Z", "2026-09-05T08:09:00Z", "2026-09-05T08:16:31Z", null, admin2);
    job.run("SCORING", "2026-09-30", "ECHEC", null, "2026-09-06T02:00:00Z", "2026-09-06T02:00:02Z", "2026-09-06T02:00:02Z",
      "Scoring suspendu : le dernier import est bloqué par les contrôles qualité.", null);

    // ---------- Alertes ----------
    const al = sqlite.prepare(
      `INSERT INTO alert (type, severity, status, audience, department_id, manager_id, employee_id, title, message, link, dedup_key, comment,
         created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const P = deptId("PROD");
    const C = deptId("COM");
    al.run("TURNOVER", "ATTENTION", "NOUVELLE", "MANAGER", P, empId("E0002"), empId("E0005"), "Amira Mejri : risque de départ élevé",
      "Entrée en niveau de risque élevé au calcul du 31/08/2026. Catégories associées : Rémunération, Évolution de carrière. Un entretien est recommandé.",
      `/employees/${empId("E0005")}`, "TURNOVER:MANAGER:E0005:2026-08", null, daysAgo(12), null, null);
    al.run("TURNOVER", "ATTENTION", "EN_COURS", "RH", P, empId("E0002"), empId("E0005"), "Amira Mejri : entrée en risque élevé",
      "Estimation à 6 mois de 16,8 % (lift × 4,9), rang 1 sur 18. Facteurs : salaire à 84 % de la médiane du poste, 41 mois sans promotion.",
      `/employees/${empId("E0005")}`, "TURNOVER:RH:E0005:2026-08", "Entretien planifié avec la responsable de production.", daysAgo(12), daysAgo(9), rh);
    al.run("ABSENTEISME", "ATTENTION", "NOUVELLE", "MANAGER", P, empId("E0003"), null, "Absentéisme inhabituel à l'atelier",
      "Taux d'absence hors santé de l'équipe de Sami Gharbi au-dessus du niveau attendu deux semaines de suite (+2,1 points hors Ramadan).",
      "/absenteeism", "ABSENTEISME:EQUIPE:E0003:2026-W35", null, daysAgo(8), null, null);
    al.run("ABSENTEISME", "INFO", "NOUVELLE", "RH", P, empId("E0003"), empId("E0006"), "Walid Hammami : facteur de Bradford élevé (à vérifier)",
      "Facteur de Bradford hors santé de 288 sur 12 mois (6 épisodes, 8 jours). Signal individuel à vérifier, réservé à la RH.",
      `/employees/${empId("E0006")}`, "ABSENTEISME:SALARIE:E0006:2026-08", null, daysAgo(8), null, null);
    al.run("TURNOVER", "ATTENTION", "NOUVELLE", "MANAGER", C, empId("E0011"), empId("E0013"), "Salma Chaabane : risque de départ élevé",
      "Entrée en niveau de risque élevé au calcul du 31/08/2026. Catégories associées : Charge de travail, Contexte d'équipe.",
      `/employees/${empId("E0013")}`, "TURNOVER:MANAGER:E0013:2026-08", null, daysAgo(12), null, null);
    al.run("ABSENTEISME", "ATTENTION", "TRAITEE", "MANAGER", C, empId("E0011"), null, "Absentéisme inhabituel au service commercial",
      "Hausse des absences courtes hors santé sur trois semaines consécutives.", "/absenteeism", "ABSENTEISME:EQUIPE:E0011:2026-W31",
      "Pic lié aux congés scolaires, point fait en réunion d'équipe.", daysAgo(35), daysAgo(30), rh);
    al.run("DONNEES", "CRITIQUE", "NOUVELLE", "RH", null, null, null, "Import du 05/09/2026 bloqué",
      "Score qualité de 89,8 % sous le seuil de 95 % : 2 400 pointages avec matricule inconnu et 120 salaires sous le SMIG. Le scoring est suspendu.",
      `/data-health?batch=${b3}`, `DONNEES:IMPORT:${b3}`, null, "2026-09-05T08:16:32Z", null, null);
    al.run("DONNEES", "INFO", "TRAITEE", "RH", null, null, null, "Pointages en double dans l'export d'août",
      "5 pointages en double rejetés dans attendance.csv.", `/data-health?batch=${b2}`, `DONNEES:DOUBLONS:${b2}`,
      "Double synchronisation des badgeuses, corrigée côté AJIR.", "2026-08-05T08:19:06Z", "2026-08-06T10:00:00Z", rh);
    al.run("SYSTEME", "CRITIQUE", "NOUVELLE", "ADMIN", null, null, null, "Échec du job de scoring",
      "Le job SCORING du 06/09/2026 a échoué : dernier import bloqué. Relancer après un import conforme.", "/data-health",
      "SYSTEME:JOB:SCORING:2026-09-06", null, "2026-09-06T02:00:03Z", null, null);
    al.run("SYSTEME", "ATTENTION", "REJETEE", "ADMIN", null, null, null, "Worker sans signal depuis 14 minutes",
      "Aucun heartbeat du worker depuis 14 minutes.", "/data-health", "SYSTEME:HEARTBEAT:2026-09-20",
      "Redémarrage planifié du serveur pendant la maintenance.", "2026-09-20T22:14:00Z", "2026-09-21T07:45:00Z", admin2);

    // ---------- Journal ----------
    const au = sqlite.prepare("INSERT INTO audit_log (at, user_id, action, target_type, target_id, outcome, detail_json, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    au.run(daysAgo(3), admin2, "auth.login", "user", String(admin2), "OK", null, "10.0.0.12");
    au.run(daysAgo(2), rh, "auth.login", "user", String(rh), "OK", null, "10.0.0.31");
    au.run(daysAgo(2), rh, "employee.view", "employee", String(empId("E0005")), "OK", null, "10.0.0.31");
    au.run(daysAgo(1), mgr, "auth.login", "user", String(mgr), "OK", null, "10.0.0.44");
    au.run(daysAgo(1), mgr, "employee.view", "employee", String(empId("E0013")), "REFUSE", JSON.stringify({ reason: "hors_perimetre" }), "10.0.0.44");
    au.run(daysAgo(1), null, "auth.login", "user", "inconnu", "REFUSE", JSON.stringify({ reason: "inconnu_ou_inactif" }), "10.0.0.87");
  })();
  heartbeat();
  sqlite.close();
  console.log(`Base ${DB_FILE} alimentée en ${Date.now() - t0} ms.`);
  console.log(`Comptes : admin2 (ADMIN), rh.demo (RH), mgr.demo (MANAGER, Production) — mot de passe : ${PASSWORD}`);
  console.log(`Compte en attente d'activation mgr.attente : /activation?token=${pendingToken}`);
  console.log(`Bundle du champion : ${BUNDLE_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "@/db/client";
import { FEATURE_INDEX, FEATURE_NAMES } from "@/lib/features/spec";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import type { AccessContext } from "@/lib/dal/context";

// Petite base calculable à la main (jours ouvrés = lundi-vendredi, dim_date vide) :
// R (manager racine, Production) > équipe R = A1..A7 + S ; S > équipe S = B1, B2 (Commercial) ; Q (hors périmètre de R) > C1..C5.
// A6 démissionne le 14/08/2026, A7 arrive le 03/08/2026, C5 est opposé au traitement prédictif.
// Calculs publiés de janvier à août 2026 ; B1 : entretien réalisé le 15/04/2026.

export const DATA_END = "2026-08-31";
export const RUN_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
export const SNAPSHOT_MONTHS = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
export const CONSTANT_P = 0.04;
export const INTERCEPT = Math.log(CONSTANT_P / (1 - CONSTANT_P));

export type Fixture = {
  file: string;
  ids: Record<string, number>;
  users: { rh: number; admin: number; manager: number; other: number };
  runs: Record<string, number>;
  modelId: number;
};

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function logregManifest(extra: Record<string, unknown> = {}) {
  const n = FEATURE_NAMES.length;
  const bundle = {
    version: "logreg-test",
    kind: "LOGREG",
    fsv: "v1",
    features: FEATURE_NAMES,
    standardization: { mean: new Array(n).fill(0), std: new Array(n).fill(1) },
    coef: new Array(n).fill(0),
    intercept: INTERCEPT,
    calibration: { method: "platt", a: 1, b: 0 },
    base_rate: CONSTANT_P,
    ...extra,
  };
  const e = Math.exp(INTERCEPT);
  return { sha256: `test-${JSON.stringify(extra)}`, bundle, golden: [{ x: new Array(n).fill(0), p: e / (1 + e) }] };
}

export function createFixture(name: string): Fixture {
  const file = path.join(os.tmpdir(), `pa-insights-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const s = getDb().sqlite;
  migrate(drizzle(s), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(s);
  setSetting(s, "data_end_date", DATA_END);

  const prod = Number(s.prepare("INSERT INTO department (code, name) VALUES ('PROD', 'Production')").run().lastInsertRowid);
  const com = Number(s.prepare("INSERT INTO department (code, name) VALUES ('COM', 'Commercial')").run().lastInsertRowid);
  const ids: Record<string, number> = {};
  const emp = (key: string, dept: number, manager: string | null, hire = "2020-01-06") => {
    ids[key] = Number(
      s
        .prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id, birth_date, grade, job_title) VALUES (?, ?, ?, ?, ?, ?, '1985-01-01', 'G3', 'Technicien')")
        .run(`M-${key}`, `Nom${key}`, `Prenom${key}`, hire, dept, manager ? ids[manager] : null).lastInsertRowid,
    );
    s.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, 'CDI', ?)").run(ids[key], hire);
  };
  emp("R", prod, null);
  for (const k of ["A1", "A2", "A3", "A4", "A5", "A6"]) emp(k, prod, "R");
  emp("A7", prod, "R", "2026-08-03");
  emp("S", prod, "R");
  emp("B1", com, "S");
  emp("B2", com, "S");
  emp("Q", com, null);
  for (const k of ["C1", "C2", "C3", "C4", "C5"]) emp(k, com, "Q");

  s.prepare("UPDATE employee SET status = 'SORTI', exit_date = '2026-08-14' WHERE id = ?").run(ids.A6);
  s.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, '2026-08-14', 'DEMISSION', '2026-07-14', '2026-07-14')").run(ids.A6);
  s.prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, '2026-07-01')").run(ids.C5);

  const abs = s.prepare("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  abs.run(ids.A1, "2026-08-10", "2026-08-11", 2, "ABSENCE_INJUSTIFIEE", 0, "2026-08-12");
  abs.run(ids.A2, "2026-07-06", "2026-07-08", 3, "ABSENCE_INJUSTIFIEE", 0, "2026-07-09");
  abs.run(ids.B1, "2026-08-17", "2026-08-17", 1, "AUTRE", 0, "2026-08-18");
  abs.run(ids.B1, "2026-02-02", "2026-02-03", 2, "ABSENCE_INJUSTIFIEE", 0, "2026-02-04");
  abs.run(ids.A3, "2026-08-03", "2026-08-07", 5, "MALADIE", 1, "2026-08-08");
  abs.run(ids.A4, "2026-08-17", "2026-08-21", 5, "CONGE_ANNUEL", 0, "2026-08-01");
  abs.run(ids.A1, "2026-03-02", "2026-03-13", 10, "CONGE_SANS_SOLDE", 0, "2026-03-14");
  abs.run(ids.A1, "2025-11-03", "2025-11-28", 20, "MALADIE", 1, "2025-11-29");

  const att = s.prepare("INSERT INTO attendance_daily (employee_id, date, check_in, check_out, worked_minutes, overtime_minutes, late_minutes) VALUES (?, ?, '08:00', '17:00', 480, ?, 0)");
  att.run(ids.A1, "2026-08-05", 180);
  att.run(ids.C1, "2026-08-05", 240);
  for (const d of ["2026-01-12", "2026-02-10", "2026-03-10"]) att.run(ids.B1, d, 600);
  for (const d of ["2026-05-12", "2026-06-10", "2026-07-10"]) att.run(ids.B1, d, 120);

  const tr = s.prepare("INSERT INTO training (employee_id, code, title, mandatory, start_date, end_date, due_date, hours, status) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)");
  tr.run(ids.A1, "SEC", "Sécurité", 1, null, "2026-08-20", 7, "PLANIFIEE");
  tr.run(ids.B2, "QUA", "Qualité", 1, null, "2026-05-15", 7, "EN_COURS");
  tr.run(ids.C1, "SEC", "Sécurité", 1, "2026-08-05", "2026-08-10", 7, "TERMINEE");

  const career = s.prepare("INSERT INTO career_event (employee_id, date, type, old_value, new_value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)");
  career.run(ids.A1, "2026-08-01", "PROMOTION", "G3", "G4", "2026-08-01");
  career.run(ids.A1, "2026-08-01", "AUGMENTATION", "1234.5", "1357.25", "2026-08-01");
  career.run(ids.A1, "2025-05-01", "CHANGEMENT_MANAGER", "M-Q", "M-R", "2025-05-01");
  s.prepare("INSERT INTO evaluation (employee_id, eval_date, score, recorded_at) VALUES (?, ?, ?, ?)").run(ids.A1, "2025-08-20", 4, "2025-08-20");
  s.prepare("INSERT INTO evaluation (employee_id, eval_date, score, recorded_at) VALUES (?, ?, ?, ?)").run(ids.A1, "2026-08-20", 3, "2026-08-20");

  // Modèle champion : régression logistique à coefficients nuls (probabilité constante CONSTANT_P)
  const modelId = Number(
    s
      .prepare("INSERT INTO model_version (version, kind, status, fsv, manifest_json, metrics_json, promoted_at) VALUES ('logreg-test', 'LOGREG', 'CHAMPION', 'v1', ?, '{}', '2026-01-01T00:00:00Z')")
      .run(JSON.stringify(logregManifest())).lastInsertRowid,
  );

  // Calculs publiés : FAIBLE par défaut, niveaux particuliers par mois
  const scored = (ym: string) => {
    const base = ["R", "A1", "A2", "A3", "A4", "A5", "S", "B1", "B2", "Q", "C1", "C2", "C3", "C4"];
    if (ym <= "2026-07") base.push("A6");
    if (ym === "2026-07") base.push("C5");
    return base;
  };
  const special: Record<string, Record<string, "ELEVE" | "MOYEN" | "FAIBLE">> = {
    "2026-03": { B1: "ELEVE" },
    "2026-07": { A2: "MOYEN", A3: "ELEVE", A6: "ELEVE", C1: "ELEVE", C5: "ELEVE" },
    "2026-08": { A1: "ELEVE", A2: "ELEVE", A3: "MOYEN", C1: "ELEVE" },
  };
  const PROB = { FAIBLE: 0.031, MOYEN: 0.083, ELEVE: 0.217 };
  const runs: Record<string, number> = {};
  const insRun = s.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, started_at, finished_at, n_scored) VALUES (?, ?, 'PUBLIE', ?, ?, ?)");
  const insPred = s.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insFactor = s.prepare(
    "INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction, top_feature, top_feature_value, phrase_rh, phrase_manager) VALUES (?, ?, ?, ?, 'HAUSSE', NULL, NULL, ?, ?)",
  );
  for (const ym of RUN_MONTHS) {
    const asOf = monthEnd(ym);
    const list = scored(ym);
    const fin = `${ym === "2026-12" ? "2027-01" : `${ym.slice(0, 5)}${String(Number(ym.slice(5)) + 1).padStart(2, "0")}`}-10T02:00:00Z`;
    runs[ym] = Number(insRun.run(asOf, modelId, fin, fin, list.length).lastInsertRowid);
    list.forEach((k, i) => {
      const level = special[ym]?.[k] ?? "FAIBLE";
      const pid = Number(insPred.run(runs[ym], ids[k], asOf, PROB[level] + i / 10000, level, i + 1, 1 + i / 100, modelId).lastInsertRowid);
      if (k === "A1" && ym === "2026-08") {
        insFactor.run(pid, "ABSENCES", 0.9, 1, "taux d'absence hors santé de 9,5 % sur 3 mois", "Assiduité");
        insFactor.run(pid, "TEMPS_TRAVAIL", 0.4, 2, "3 h supplémentaires par mois en moyenne", "Charge de travail");
      }
      if (k === "A1" && ym === "2026-07") insFactor.run(pid, "TEMPS_TRAVAIL", 0.3, 1, "2 h supplémentaires par mois en moyenne", "Charge de travail");
    });
  }
  setSetting(s, "current_run_id", String(runs["2026-08"]));

  // Recommandations et interventions
  const reco = s.prepare("INSERT INTO recommendation (employee_id, action_code, trigger_group, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  reco.run(ids.A1, "ENTRETIEN", "NIVEAU_ELEVE", "PROPOSEE", "2026-09-10T08:00:00Z", null);
  reco.run(ids.A2, "REVISION_SALARIALE", "REMUNERATION", "PROPOSEE", "2026-09-10T08:00:00Z", null);
  const b1Reco = Number(reco.run(ids.B1, "ENTRETIEN", "NIVEAU_ELEVE", "REALISEE", "2026-04-01T08:00:00Z", "2026-04-15T09:00:00Z").lastInsertRowid);
  reco.run(ids.C1, "CHARGE_TRAVAIL", "TEMPS_TRAVAIL", "REJETEE", "2026-08-12T08:00:00Z", "2026-08-15T08:00:00Z");
  reco.run(ids.C2, "PLAN_FORMATION", "FORMATION_EVAL", "REALISEE", "2026-08-12T08:00:00Z", "2026-08-20T08:00:00Z");
  s.prepare("INSERT INTO intervention (employee_id, recommendation_id, date, action_code) VALUES (?, ?, '2026-04-15', 'ENTRETIEN')").run(ids.B1, b1Reco);

  const alert = s.prepare("INSERT INTO alert (type, severity, audience, manager_id, employee_id, title, message, dedup_key) VALUES ('TURNOVER', ?, ?, ?, ?, ?, 'message', ?)");
  alert.run("CRITIQUE", "RH", null, ids.A1, "Risque élevé", "t1");
  alert.run("ATTENTION", "MANAGER", ids.R, ids.A2, "Risque élevé", "t2");

  // Variables mensuelles pour la dérive : 16 salariés (C5, opposé, exclu) ; contract_cdd à 25 % puis 75 % le dernier mois
  const snapKeys = ["R", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "S", "B1", "B2", "Q", "C1", "C2", "C3", "C4"];
  const insSnap = s.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json, partial_history) VALUES (?, ?, 'v1', ?, 0)");
  for (const ym of SNAPSHOT_MONTHS) {
    const last = ym === SNAPSHOT_MONTHS[SNAPSHOT_MONTHS.length - 1];
    snapKeys.forEach((k, i) => {
      const v = new Array(FEATURE_NAMES.length).fill(0);
      v[FEATURE_INDEX.tenure_months] = 10 + i * 7;
      v[FEATURE_INDEX.contract_cdd] = (last ? i < 12 : i < 4) ? 1 : 0;
      insSnap.run(ids[k], monthEnd(ym), JSON.stringify(v));
    });
  }

  const user = (login: string, role: string, employeeId: number | null) =>
    Number(s.prepare("INSERT INTO app_user (login, role, employee_id, active) VALUES (?, ?, ?, 1)").run(login, role, employeeId).lastInsertRowid);
  return {
    file,
    ids,
    users: { rh: user("rh.test", "RH", null), admin: user("admin.test", "ADMIN", null), manager: user("mgr.r", "MANAGER", ids.R), other: user("mgr.q", "MANAGER", ids.Q) },
    runs,
    modelId,
  };
}

export function destroyFixture(f: Fixture) {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const x of [f.file, `${f.file}-wal`, `${f.file}-shm`]) fs.rmSync(x, { force: true });
}

export const ctxOf = (f: Fixture) => ({
  rh: { userId: f.users.rh, login: "rh.test", role: "RH", employeeId: null } as AccessContext,
  admin: { userId: f.users.admin, login: "admin.test", role: "ADMIN", employeeId: null } as AccessContext,
  manager: { userId: f.users.manager, login: "mgr.r", role: "MANAGER", employeeId: f.ids.R } as AccessContext,
  other: { userId: f.users.other, login: "mgr.q", role: "MANAGER", employeeId: f.ids.Q } as AccessContext,
});

export const meta = { source: "page" as const, ip: "test" };

export const auditRows = (action: string) =>
  getDb().sqlite.prepare("SELECT user_id AS userId, outcome, target_id AS targetId, detail_json AS detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as {
    userId: number;
    outcome: string;
    targetId: string | null;
    detail: string | null;
  }[];

// Aucune clé ni valeur sensible dans un DTO manager ou administrateur
const FORBIDDEN_KEY = /salar|payroll|gross|compensation|masse|prob|lift|contribution|phrase_?rh|estimate|healthDays|absenteeismBefore|absenteeismAfter|overtimeBefore|overtimeAfter/i;
export function leaks(value: unknown, numbers: number[], strings: string[], at = "$"): string[] {
  const out: string[] = [];
  if (typeof value === "number") {
    if (numbers.some((n) => Math.abs(n - value) < 1e-12)) out.push(`${at} = ${value}`);
  } else if (typeof value === "string") {
    if (strings.some((s) => value.includes(s))) out.push(`${at} = "${value}"`);
  } else if (Array.isArray(value)) value.forEach((v, i) => out.push(...leaks(v, numbers, strings, `${at}[${i}]`)));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(k)) out.push(`${at}.${k} (clé interdite)`);
      out.push(...leaks(v, numbers, strings, `${at}.${k}`));
    }
  return out;
}

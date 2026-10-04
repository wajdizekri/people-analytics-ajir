import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { buildCalendar } from "@/lib/calendar";
import { FEATURES } from "@/lib/ai/absenteeism/model";
import { promoteTopicModel, registerTopicModel } from "@/lib/ai/registry";
import type { AccessContext } from "@/lib/dal/context";
import { Fixture } from "../../fixtures/engine/db";

export const AS_OF = "2025-08-31";

// Bundle jouet : coefficients nuls, prévision = moyenne 12 mois de l'unité ; bornes = ±1 écart normalisé.
export function toyBundle(version = "abs-toy-v1"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-abs-bundle-"));
  const zeros = FEATURES.map(() => 0);
  const hm = { mean: zeros, std: FEATURES.map(() => 1), coef: zeros, intercept: 0, offset: "ma12" };
  const q = { "1": [-1, 1], "2": [-1, 1], "3": [-1, 1] };
  const bundle = {
    version,
    kind: "RIDGE_DIRECT",
    features: [...FEATURES],
    horizons: [1, 2, 3],
    models: { "1": { ALL: hm }, "2": { ALL: hm }, "3": { ALL: hm } },
    intervals: { level: 0.8, rate_floor: 0.002, quantiles: { EQUIPE: q, AGREGE: q } },
    visibility_lag_days: 10,
    min_group: 5,
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(bundle));
  return dir;
}

export function installModel(sqlite: Database.Database, version = "abs-toy-v1") {
  registerTopicModel(sqlite, "ABSENTEISME", toyBundle(version));
  promoteTopicModel(sqlite, version);
}

const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((y += 1), (m = 1)) : (m += 1))
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};

// PROD : DIR > MA (équipe A, 6 personnes, très absente sur les 12 derniers mois) et MB (équipe B, 3 personnes : petit groupe).
// COM : DIR2 > MC (équipe C, 6 personnes, deux anomalies collectives récentes).
export function buildAbsWorld(sqlite: Database.Database) {
  buildCalendar(sqlite, 2023, 2026);
  const fx = new Fixture(sqlite);
  const prod = fx.dept("PROD", "Production");
  const com = fx.dept("COM", "Commercial");
  const e: Record<string, number> = {};
  const add = (m: string, dept: number, managerId: number | null) => (e[m] = fx.emp({ matricule: m, hire: "2023-06-01", dept, managerId }));
  add("DIR", prod, null);
  add("MA", prod, e.DIR);
  add("MB", prod, e.DIR);
  for (let i = 1; i <= 6; i++) add(`A${i}`, prod, e.MA);
  for (let i = 1; i <= 3; i++) add(`B${i}`, prod, e.MB);
  add("DIR2", com, null);
  add("MC", com, e.DIR2);
  for (let i = 1; i <= 6; i++) add(`C${i}`, com, e.MC);

  for (const month of monthsBetween("2024-01", "2025-08")) {
    const d = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const recent = month >= "2024-09";
    for (let i = 1; i <= 6; i++) {
      if (recent) fx.absence(e[`A${i}`], d(9 + (i % 3)), d(9 + (i % 3)), "ABSENCE_INJUSTIFIEE", d(20), 1);
      if (recent && i <= 3) fx.absence(e[`A${i}`], d(16), d(17), "CONGE_SANS_SOLDE", d(20), 2);
      if (month.endsWith("3") || month.endsWith("9")) fx.absence(e[`C${i}`], d(14), d(14), "AUTRE", d(20), 1);
    }
    for (let i = 1; i <= 3; i++) fx.absence(e[`B${i}`], d(15), d(15), "ABSENCE_INJUSTIFIEE", d(20), 1);
  }
  const anomaly = sqlite.prepare(
    `INSERT INTO anomaly (scope, department_id, manager_id, period_start, period_end, metric, observed, expected, score, message)
     VALUES ('EQUIPE', ?, ?, ?, ?, 'taux_absence_hebdo', 0.1, 0, 5, 'pic')`,
  );
  anomaly.run(com, e.MC, "2025-06-09", "2025-06-22");
  anomaly.run(com, e.MC, "2025-07-21", "2025-08-03");

  const ctx = (role: AccessContext["role"], employeeId: number | null, userId: number): AccessContext => ({ userId, login: `${role}-${userId}`, role, employeeId });
  return {
    e,
    prod,
    com,
    ctx: { admin: ctx("ADMIN", null, 1), rh: ctx("RH", null, 2), ma: ctx("MANAGER", e.MA, 3), mb: ctx("MANAGER", e.MB, 4), mc: ctx("MANAGER", e.MC, 5), dir: ctx("MANAGER", e.DIR, 6) },
  };
}

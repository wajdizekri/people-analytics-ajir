import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "@/db/client";
import { FEATURE_INDEX, FEATURE_NAMES } from "@/lib/features/spec";
import { mulberry32 } from "@/lib/matching";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import type { AccessContext } from "@/lib/dal/context";
import { gaussian } from "./synthetic";

// Base de 300 salariés sur 24 mois (sept. 2024 – août 2026) pour la comparaison appariée côté DAL :
// variables mensuelles (compa-ratio, heures sup), calculs publiés B0 avec niveaux, démissions dont le risque dépend
// d'un facteur latent, entretiens réalisés de préférence chez les niveaux Élevé et Moyen (nov. 2024 – déc. 2025),
// trois plans de formation (effectif insuffisant). Matricules « MATCAUS- », noms « NomCausal » : jamais dans un DTO.

export const DATA_END = "2026-08-31";
export const N_EMPLOYEES = 300;

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
export const MONTHS = Array.from({ length: 24 }, (_, i) => addMonths("2024-09", i));

export type CausalFixture = { file: string; users: { rh: number; admin: number; manager: number }; entretien: number[]; formation: number[]; ids: number[] };

export function createCausalFixture(name: string): CausalFixture {
  const file = path.join(os.tmpdir(), `pa-causal-${name}-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const s = getDb().sqlite;
  migrate(drizzle(s), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  seedDefaultSettings(s);
  setSetting(s, "data_end_date", DATA_END);
  const rand = mulberry32(42);

  const dept = Number(s.prepare("INSERT INTO department (code, name) VALUES ('CAU', 'Causal')").run().lastInsertRowid);
  const insEmp = s.prepare(
    "INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id, birth_date, grade, job_title) VALUES (?, ?, ?, '2018-01-08', ?, ?, '1988-01-01', 'G3', 'Technicien')",
  );
  const insContract = s.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, 'CDI', '2018-01-08')");
  const ids: number[] = [];
  const latent = new Map<number, { risk: number; compa: number; ot: number }>();
  s.transaction(() => {
    for (let i = 0; i < N_EMPLOYEES; i++) {
      const id = Number(insEmp.run(`MATCAUS-${i}`, `NomCausal${i}`, `PrenomCausal${i}`, dept, i === 0 ? null : ids[0]).lastInsertRowid);
      insContract.run(id);
      ids.push(id);
      const risk = gaussian(rand);
      latent.set(id, { risk, compa: 1 - 0.08 * risk + 0.04 * gaussian(rand), ot: Math.max(0, 6 + 3 * risk + 2 * gaussian(rand)) });
    }
  })();

  const modelId = Number(
    s.prepare("INSERT INTO model_version (version, kind, status, fsv, manifest_json, metrics_json, promoted_at) VALUES ('b0-causal', 'B0', 'CHAMPION', 'v1', '{}', '{}', '2024-01-01T00:00:00Z')").run()
      .lastInsertRowid,
  );
  const insSnap = s.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json, partial_history) VALUES (?, ?, 'v1', ?, 0)");
  const insRun = s.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, started_at, finished_at, n_scored) VALUES (?, ?, 'PUBLIE', ?, ?, ?)");
  const insPred = s.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insInterv = s.prepare("INSERT INTO intervention (employee_id, recommendation_id, date, action_code) VALUES (?, NULL, ?, ?)");
  const insExit = s.prepare("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) VALUES (?, ?, 'DEMISSION', ?, ?)");
  const setExit = s.prepare("UPDATE employee SET status = 'SORTI', exit_date = ? WHERE id = ?");

  const resignedOn = new Map<number, string>();
  const treatedOn = new Map<number, string>();
  let lastRun = 0;
  s.transaction(() => {
    MONTHS.forEach((m, k) => {
      const asOf = monthEnd(m);
      const actives = ids.filter((id) => !resignedOn.has(id) || resignedOn.get(id)! > asOf);
      const scored = actives.map((id) => {
        const l = latent.get(id)!;
        const v = new Array<number>(FEATURE_NAMES.length).fill(0);
        v[FEATURE_INDEX.tenure_months] = 80 + k;
        v[FEATURE_INDEX.grade_level] = 3;
        v[FEATURE_INDEX.compa_ratio] = l.compa + 0.01 * gaussian(rand);
        v[FEATURE_INDEX.overtime_h_avg_3m] = Math.max(0, l.ot + 0.5 * gaussian(rand));
        v[FEATURE_INDEX.months_since_raise] = 6 + Math.floor(rand() * 18);
        v[FEATURE_INDEX.team_size] = 12;
        v[FEATURE_INDEX.last_eval_score] = l.risk > 1 ? 2 : 3;
        insSnap.run(id, asOf, JSON.stringify(v));
        return { id, score: l.risk + 0.3 * gaussian(rand) };
      });
      scored.sort((a, b) => b.score - a.score);
      const nHigh = Math.floor(scored.length * 0.03);
      const nMid = Math.floor(scored.length * 0.15);
      lastRun = Number(insRun.run(asOf, modelId, `${asOf}T23:00:00Z`, `${asOf}T23:00:00Z`, scored.length).lastInsertRowid);
      const levelOf = new Map<number, string>();
      scored.forEach((e, rank) => {
        const level = rank < nHigh ? "ELEVE" : rank < nHigh + nMid ? "MOYEN" : "FAIBLE";
        levelOf.set(e.id, level);
        insPred.run(lastRun, e.id, asOf, 2 + e.score, level, rank + 1, 1, modelId);
      });
      // Mois suivant : entretiens (si dans la fenêtre), puis démissions
      const next = addMonths(m, 1);
      if (next >= "2024-11" && next <= "2025-12")
        for (const id of actives) {
          if (treatedOn.has(id)) continue;
          const level = levelOf.get(id);
          if (rand() < (level === "ELEVE" || level === "MOYEN" ? 0.09 : 0.006)) {
            const date = `${next}-15`;
            treatedOn.set(id, date);
            insInterv.run(id, date, "ENTRETIEN");
          }
        }
      if (next <= DATA_END.slice(0, 7))
        for (const id of actives) {
          const l = latent.get(id)!;
          const treated = treatedOn.has(id) && treatedOn.get(id)! < `${next}-28`;
          if (rand() < 0.006 * Math.exp(0.9 * l.risk) * (treated ? 0.6 : 1)) {
            const day = String(1 + Math.floor(rand() * 27)).padStart(2, "0");
            const resignation = `${next}-${day}`;
            const exit = `${addMonths(next, 1)}-${day}`;
            resignedOn.set(id, resignation);
            insExit.run(id, exit, resignation, resignation);
            if (exit <= DATA_END) setExit.run(exit, id);
          }
        }
    });
  })();
  setSetting(s, "current_run_id", String(lastRun));

  const formation = ids.filter((id) => !resignedOn.has(id)).slice(10, 13);
  for (const id of formation) insInterv.run(id, "2025-06-10", "PLAN_FORMATION");

  const user = (login: string, role: string, employeeId: number | null) =>
    Number(s.prepare("INSERT INTO app_user (login, role, employee_id, active) VALUES (?, ?, ?, 1)").run(login, role, employeeId).lastInsertRowid);
  return {
    file,
    ids,
    entretien: [...treatedOn.keys()],
    formation,
    users: { rh: user("rh.causal", "RH", null), admin: user("admin.causal", "ADMIN", null), manager: user("mgr.causal", "MANAGER", ids[0]) },
  };
}

export function destroyCausalFixture(f: CausalFixture) {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const x of [f.file, `${f.file}-wal`, `${f.file}-shm`]) fs.rmSync(x, { force: true });
}

export const causalCtx = (f: CausalFixture) => ({
  rh: { userId: f.users.rh, login: "rh.causal", role: "RH", employeeId: null } as AccessContext,
  admin: { userId: f.users.admin, login: "admin.causal", role: "ADMIN", employeeId: null } as AccessContext,
  manager: { userId: f.users.manager, login: "mgr.causal", role: "MANAGER", employeeId: f.ids[0] } as AccessContext,
});

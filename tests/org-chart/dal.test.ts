import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { visibleEmployeeIds, type AccessContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { getOrgChart, type OrgChartDto, type OrgMetrics, type OrgNode } from "@/lib/dal/org-chart";
import { seedDefaultSettings, setSetting } from "@/lib/settings";
import { findLeaks, sensitiveValues } from "../pilotage/setup";

// D (direction) > R (manager connecté) et Q ; R > A1, A2, S, X (sorti) ; X > Y (rattaché à R) ; S > B1..B6 ; Q > C1..C5.
// Équipe directe de R : A1, A2, S, Y (4 personnes) ; équipe de S : 6 personnes. Fenêtre d'absentéisme : juin à août 2026.
let file = "";
const ids: Record<string, number> = {};
const users = { rh: 0, admin: 0, manager: 0 };
const META = { source: "page" as const };

function walk(n: OrgNode, f: (n: OrgNode) => void) {
  f(n);
  n.children.forEach((c) => walk(c, f));
}
const find = (dto: OrgChartDto, key: string) => {
  let out: OrgNode | undefined;
  walk(dto.root, (n) => {
    if (n.key === key) out = n;
  });
  return out!;
};

beforeAll(() => {
  file = path.join(os.tmpdir(), `pa-org-chart-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  (globalThis as { __paDb?: unknown }).__paDb = undefined;
  const s = getDb().sqlite;
  migrate(drizzle(s), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  seedDefaultSettings(s);
  setSetting(s, "data_end_date", "2026-08-31");
  const dept = Number(s.prepare("INSERT INTO department (code, name) VALUES ('PROD', 'Production')").run().lastInsertRowid);
  const emp = (key: string, manager: string | null) => {
    ids[key] = Number(
      s
        .prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, manager_id, birth_date, job_title) VALUES (?, ?, ?, '2020-01-06', ?, ?, '1985-01-01', 'Technicien')")
        .run(`M-${key}`, `Nom${key}`, `Prenom${key}`, dept, manager ? ids[manager] : null).lastInsertRowid,
    );
    s.prepare("INSERT INTO contract (employee_id, type, start_date) VALUES (?, 'CDI', '2020-01-06')").run(ids[key]);
    s.prepare("INSERT INTO payroll_monthly (employee_id, month, base_salary, gross_salary, overtime_hours, recorded_at) VALUES (?, '2026-08', ?, ?, 0, '2026-08-31')").run(
      ids[key],
      1234.56 + Object.keys(ids).length,
      1456.78 + Object.keys(ids).length,
    );
  };
  emp("D", null);
  emp("R", "D");
  emp("Q", "D");
  for (const k of ["A1", "A2", "S", "X"]) emp(k, "R");
  emp("Y", "X");
  for (let i = 1; i <= 6; i++) emp(`B${i}`, "S");
  for (let i = 1; i <= 5; i++) emp(`C${i}`, "Q");
  s.prepare("UPDATE employee SET status = 'SORTI', exit_date = '2026-06-30' WHERE id = ?").run(ids.X);

  const abs = s.prepare("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  abs.run(ids.B1, "2026-07-06", "2026-07-07", 2, "ABSENCE_INJUSTIFIEE", 0, "2026-07-08");
  abs.run(ids.B2, "2026-07-13", "2026-07-17", 5, "MALADIE", 1, "2026-07-18");
  abs.run(ids.B3, "2026-08-03", "2026-08-07", 5, "CONGE_ANNUEL", 0, "2026-07-01");
  abs.run(ids.A1, "2026-08-10", "2026-08-10", 1, "ABSENCE_INJUSTIFIEE", 0, "2026-08-11");

  const model = Number(
    s.prepare("INSERT INTO model_version (version, kind, status, fsv, manifest_json, metrics_json, promoted_at) VALUES ('logreg-test', 'LOGREG', 'CHAMPION', 'v1', '{}', '{}', '2026-01-01T00:00:00Z')").run()
      .lastInsertRowid,
  );
  const run = Number(
    s.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, started_at, finished_at, n_scored) VALUES ('2026-08-31', ?, 'PUBLIE', '2026-09-10T02:00:00Z', '2026-09-10T02:00:00Z', 0)").run(model)
      .lastInsertRowid,
  );
  const levels: Record<string, "ELEVE" | "MOYEN" | "FAIBLE"> = { A1: "ELEVE", B1: "MOYEN", B2: "ELEVE", C1: "ELEVE" };
  const insPred = s.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, '2026-08-31', ?, ?, ?, ?, ?)");
  const insFactor = s.prepare(
    "INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction, top_feature, top_feature_value, phrase_rh, phrase_manager) VALUES (?, 'TEMPS_TRAVAIL', 0.4, 1, 'HAUSSE', NULL, NULL, ?, 'Charge de travail')",
  );
  Object.keys(ids)
    .filter((k) => k !== "X")
    .forEach((k, i) => {
      const pid = Number(insPred.run(run, ids[k], 0.0313 + i / 1000, levels[k] ?? "FAIBLE", i + 1, 1.0071 + i / 100, model).lastInsertRowid);
      insFactor.run(pid, `${3 + i} h supplémentaires par mois en moyenne`);
    });
  setSetting(s, "current_run_id", String(run));
  const user = (login: string, role: string, employeeId: number | null) =>
    Number(s.prepare("INSERT INTO app_user (login, role, employee_id, active) VALUES (?, ?, ?, 1)").run(login, role, employeeId).lastInsertRowid);
  users.rh = user("rh.org", "RH", null);
  users.admin = user("admin.org", "ADMIN", null);
  users.manager = user("mgr.org", "MANAGER", ids.R);
});

afterAll(() => {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
});

const rh = (): AccessContext => ({ userId: users.rh, login: "rh.org", role: "RH", employeeId: null });
const manager = (): AccessContext => ({ userId: users.manager, login: "mgr.org", role: "MANAGER", employeeId: ids.R });
const admin = (): AccessContext => ({ userId: users.admin, login: "admin.org", role: "ADMIN", employeeId: null });

describe("organigramme : DAL", () => {
  it("ADMIN refusé (403) et refus audité", () => {
    let err: unknown;
    try {
      getOrgChart(admin(), META);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
    const row = getDb().sqlite.prepare("SELECT outcome FROM audit_log WHERE user_id = ? AND action = 'org_chart.view' ORDER BY id DESC LIMIT 1").get(users.admin) as { outcome: string };
    expect(row.outcome).toBe("REFUSE");
  });

  it("RH : toute l'entreprise sous la racine virtuelle, salariés sortis exclus, petits effectifs signalés mais affichés", () => {
    const dto = getOrgChart(rh(), META);
    expect(dto.view).toBe("RH");
    expect(dto.root.key).toBe("root");
    expect(dto.root.members.map((m) => m.id)).toEqual([ids.D]);
    expect(dto.stats).toMatchObject({ people: 18, reattached: 1 });
    expect(JSON.stringify(dto)).not.toContain("NomX");
    const r = find(dto, `e${ids.R}`);
    expect(r.members.map((m) => m.id).sort((a, b) => a - b)).toEqual([ids.A1, ids.A2, ids.S, ids.Y].sort((a, b) => a - b));
    expect(r.team).toMatchObject({ headcount: 4, small: true, riskMask: null, absenteeismMask: null, scored: 4, atRisk: 1, riskShare: 0.25 });
    expect(r.team.absenteeism).toBeCloseTo(1 / (4 * 66), 10);
    expect(r.subtree.headcount).toBe(10);
  });

  it("absentéisme hors santé : maladie et congé annuel exclus", () => {
    const s = find(getOrgChart(rh(), META), `e${ids.S}`);
    expect(s.team.headcount).toBe(6);
    expect(s.team.absenteeism).toBeCloseTo(2 / (6 * 66), 10);
  });

  it("MANAGER : limité à son sous-arbre, enraciné sur lui, sans sa propre fiche", () => {
    const dto = getOrgChart(manager(), META);
    expect(dto.view).toBe("MANAGER");
    expect(dto.root).toMatchObject({ key: `e${ids.R}`, employeeId: ids.R, openable: false, level: null });
    const allowed = new Set([...(visibleEmployeeIds(manager()) ?? []), ids.R]);
    const seen: number[] = [];
    walk(dto.root, (n) => {
      if (n.employeeId != null) seen.push(n.employeeId);
      seen.push(...n.members.map((m) => m.id));
    });
    expect(seen.every((id) => allowed.has(id))).toBe(true);
    for (const k of ["D", "Q", "C1", "X"]) expect(seen).not.toContain(ids[k]);
    expect(dto.stats.people).toBe(10);
  });

  it("MANAGER : aucun taux sur un groupe de moins de 5 personnes, ni déductible par différence", () => {
    const dto = getOrgChart(manager(), META);
    const groups: OrgMetrics[] = [];
    walk(dto.root, (n) => groups.push(n.team, n.subtree));
    for (const g of groups.filter((x) => x.headcount < 5)) expect(g).toMatchObject({ riskShare: null, scored: null, atRisk: null, absenteeism: null });
    expect(dto.root.team).toMatchObject({ headcount: 4, riskMask: "PETIT_GROUPE", absenteeismMask: "PETIT_GROUPE" });
    const s = find(dto, `e${ids.S}`);
    expect(s.team).toMatchObject({ headcount: 6, absenteeism: null, absenteeismMask: "PROTECTION" });
    expect(s.team.riskShare).not.toBeNull();
    expect(dto.root.subtree.absenteeism).not.toBeNull();
  });

  it("MANAGER : aucun salaire, probabilité, lift ni phrase RH dans le DTO", () => {
    const dto = getOrgChart(manager(), META);
    const { numbers, strings } = sensitiveValues(Object.values(ids));
    expect(numbers.length).toBeGreaterThan(0);
    expect(strings.length).toBeGreaterThan(0);
    expect(findLeaks(dto, numbers, strings)).toEqual([]);
    expect(JSON.stringify(dto)).not.toMatch(/prob|lift|salar|gross|phrase/i);
  });

  it("consultation auditée", () => {
    getOrgChart(manager(), META);
    const row = getDb().sqlite.prepare("SELECT outcome, detail_json AS d FROM audit_log WHERE user_id = ? AND action = 'org_chart.view' ORDER BY id DESC LIMIT 1").get(users.manager) as {
      outcome: string;
      d: string;
    };
    expect(row.outcome).toBe("OK");
    expect(JSON.parse(row.d)).toMatchObject({ view: "MANAGER", source: "page" });
  });
});

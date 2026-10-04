import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { visibleEmployeeIds } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import {
  employeeListSchema,
  getEmployeeDetail,
  listEmployees,
  parseQuery,
  type EmployeeDetailRh,
} from "@/lib/dal/employees";
import { _monthlyFromAggregates, _monthlyFromSources, dashboardQuerySchema, getDashboard } from "@/lib/dal/dashboard";
import { absenteeismQuerySchema, getAbsenteeism } from "@/lib/dal/absenteeism";
import { decideRecommendation, decideSchema, listRecommendations, recommendationListSchema, setRecommendationFeedback } from "@/lib/dal/recommendations";
import { monthRange } from "@/lib/dal/pilotage-metrics";
import { setSetting } from "@/lib/settings";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, findLeaks, managerCtx, rhCtx, sensitiveValues, setupSeededDb } from "./setup";

let file = "";
let seed: SeedResult;

beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("dal"));
});
afterAll(() => cleanupDb(file));

const listQuery = (raw: Record<string, string> = {}) => parseQuery(employeeListSchema, raw, "strict").data;
const allPages = (ctx: ReturnType<typeof rhCtx>, raw: Record<string, string> = {}) => {
  const first = listEmployees(ctx, listQuery(raw));
  const rows = [...first.rows];
  for (let p = 2; p <= first.pageCount; p++) rows.push(...listEmployees(ctx, listQuery({ ...raw, page: String(p) })).rows);
  return { first, rows };
};
const expectHttp = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
    return;
  }
  throw new Error(`HttpError ${status} attendue`);
};
const lastAudit = () =>
  db().prepare("SELECT action, target_id AS targetId, outcome, user_id AS userId FROM audit_log ORDER BY id DESC LIMIT 1").get() as {
    action: string;
    targetId: string;
    outcome: string;
    userId: number;
  };
const scopeIds = () => visibleEmployeeIds(managerCtx(seed))!;
const WORK_CONTRACT = "EXISTS (SELECT 1 FROM contract c WHERE c.employee_id = e.id AND c.type IN ('CDI','CDD'))";
const outOfScopeId = () =>
  (db().prepare(`SELECT id FROM employee WHERE status = 'ACTIF' AND manager_id IS NOT NULL AND id NOT IN (SELECT value FROM json_each(?)) AND id <> ?`).get(JSON.stringify(scopeIds()), seed.managerEmployeeId) as { id: number }).id;
const scoredInScopeId = () =>
  (
    db()
      .prepare(`SELECT p.employee_id AS id FROM prediction p WHERE p.run_id = ? AND p.employee_id IN (SELECT value FROM json_each(?)) ORDER BY p.rank LIMIT 1`)
      .get(seed.currentRunId, JSON.stringify(scopeIds())) as { id: number }
  ).id;

describe("périmètre manager", () => {
  it("la liste manager ne contient que sa hiérarchie (récursive), la RH voit tout l'effectif actif", () => {
    const ids = new Set(scopeIds());
    const { first, rows } = allPages(managerCtx(seed));
    expect(first.view).toBe("MANAGER");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => ids.has(r.id))).toBe(true);
    const activeInScope = db().prepare(`SELECT COUNT(*) AS n FROM employee WHERE status = 'ACTIF' AND id IN (SELECT value FROM json_each(?))`).get(JSON.stringify([...ids])) as { n: number };
    expect(first.total).toBe(activeInScope.n);
    const indirect = db().prepare(`SELECT e.id FROM employee e JOIN employee m ON m.id = e.manager_id WHERE m.manager_id = ? AND e.status = 'ACTIF' LIMIT 1`).get(seed.managerEmployeeId) as { id: number };
    expect(rows.some((r) => r.id === indirect.id)).toBe(true);
    expect(rows.some((r) => r.id === seed.managerEmployeeId)).toBe(false);

    const rh = listEmployees(rhCtx(seed), listQuery());
    const active = db().prepare("SELECT COUNT(*) AS n FROM employee WHERE status = 'ACTIF'").get() as { n: number };
    expect(rh.total).toBe(active.n);
  });

  it("un filtre manager ou département ne permet pas de sortir du périmètre", () => {
    const other = db().prepare("SELECT department_id AS d, manager_id AS m FROM employee WHERE id = ?").get(outOfScopeId()) as { d: number; m: number };
    expect(listEmployees(managerCtx(seed), listQuery({ departement: String(other.d), manager: String(other.m) })).total).toBe(0);
  });

  it("fiche hors périmètre : 403 audité REFUSE ; inexistante : 404 ; sa propre fiche : 403", () => {
    const id = outOfScopeId();
    expectHttp(() => getEmployeeDetail(managerCtx(seed), id, { source: "page" }), 403);
    expect(lastAudit()).toMatchObject({ action: "employee.view", targetId: String(id), outcome: "REFUSE", userId: seed.managerUserId });
    expectHttp(() => getEmployeeDetail(rhCtx(seed), 999_999, { source: "page" }), 404);
    expectHttp(() => getEmployeeDetail(managerCtx(seed), seed.managerEmployeeId, { source: "page" }), 403);
  });

  it("chaque ouverture de fiche autorisée est auditée", () => {
    const id = scoredInScopeId();
    getEmployeeDetail(managerCtx(seed), id, { source: "api", ip: "10.0.0.1" });
    expect(lastAudit()).toMatchObject({ action: "employee.view", targetId: String(id), outcome: "OK" });
  });

  it("dashboard et absentéisme manager restreints à son périmètre", () => {
    const d = getDashboard(managerCtx(seed), dashboardQuerySchema.parse({}));
    const activeInScope = db().prepare(`SELECT COUNT(*) AS n FROM employee WHERE status = 'ACTIF' AND id IN (SELECT value FROM json_each(?))`).get(JSON.stringify(scopeIds())) as { n: number };
    const staffInScope = db()
      .prepare(`SELECT COUNT(*) AS n FROM employee e WHERE e.status = 'ACTIF' AND e.id IN (SELECT value FROM json_each(?)) AND ${WORK_CONTRACT}`)
      .get(JSON.stringify(scopeIds())) as { n: number };
    expect(d.kpis.headcount).toBe(staffInScope.n);
    const a = getAbsenteeism(managerCtx(seed), absenteeismQuerySchema.parse({ axe: "departement" }));
    expect(a.axis).toBe("equipe");
    expect(a.total.activeMembers).toBe(activeInScope.n);
    expect(a.collective.every((c) => c.scope === "EQUIPE")).toBe(true);
    expect(a.collective.length).toBe(1);
  });
});

describe("DTO manager", () => {
  it("fiche : aucune clé ni valeur de rémunération ou de probabilité (vérification récursive)", () => {
    const id = scoredInScopeId();
    const dto = getEmployeeDetail(managerCtx(seed), id, { source: "page" });
    expect(dto.view).toBe("MANAGER");
    const s = sensitiveValues([id]);
    expect(s.numbers.length).toBeGreaterThan(0);
    expect(findLeaks(dto, s.numbers, s.strings)).toEqual([]);
    if (dto.view === "MANAGER" && dto.estimation.status === "OK") expect(dto.estimation.factors.length).toBeGreaterThan(0);

    const rh = getEmployeeDetail(rhCtx(seed), id, { source: "page" }) as EmployeeDetailRh;
    expect(rh.view).toBe("RH");
    expect(rh.compensation.payroll.length).toBeGreaterThan(0);
    expect(findLeaks(rh, s.numbers, s.strings).length).toBeGreaterThan(0);
  });

  it("liste, dashboard et absentéisme : aucune fuite", () => {
    const s = sensitiveValues(scopeIds());
    const { rows } = allPages(managerCtx(seed), { tri: "probabilite" });
    expect(findLeaks(rows, s.numbers, s.strings)).toEqual([]);
    const d = getDashboard(managerCtx(seed), dashboardQuerySchema.parse({ periode: "18m" }));
    expect(findLeaks(d, s.numbers, s.strings)).toEqual([]);
    expect("payroll" in d).toBe(false);
    const a = getAbsenteeism(managerCtx(seed), absenteeismQuerySchema.parse({}));
    expect(findLeaks(a, s.numbers, s.strings)).toEqual([]);
  });

  it("la RH reçoit bien la masse salariale, la probabilité et le lift", () => {
    const d = getDashboard(rhCtx(seed), dashboardQuerySchema.parse({}));
    expect(d.view === "RH" && d.payroll.lastMonth > 0).toBe(true);
    expect(d.view === "RH" && d.risk?.byDepartment.some((r) => r.avgLift != null)).toBe(true);
    const l = listEmployees(rhCtx(seed), listQuery({ niveau: "ELEVE" }));
    expect(l.view === "RH" && l.rows.every((r) => r.estimate?.type === "PROBABILITE")).toBe(true);
  });
});

describe("run publié", () => {
  it("les niveaux affichés sont ceux du run pointé par current_run_id, et seulement s'il est PUBLIE", () => {
    const sqlite = db();
    const older = (sqlite.prepare("SELECT id FROM scoring_run WHERE id <> ? ORDER BY as_of LIMIT 1").get(seed.currentRunId) as { id: number }).id;
    try {
      setSetting(sqlite, "current_run_id", String(older));
      const high = sqlite
        .prepare("SELECT p.employee_id AS id FROM prediction p JOIN employee e ON e.id = p.employee_id WHERE p.run_id = ? AND p.level = 'ELEVE' AND e.status = 'ACTIF'")
        .all(older) as { id: number }[];
      const l = listEmployees(rhCtx(seed), listQuery({ niveau: "ELEVE" }));
      expect(high.length).toBeGreaterThan(0);
      expect(new Set(l.rows.map((r) => r.id))).toEqual(new Set(high.map((r) => r.id)));
      expect(l.run?.asOf).toBe((sqlite.prepare("SELECT as_of AS a FROM scoring_run WHERE id = ?").get(older) as { a: string }).a);

      setSetting(sqlite, "current_run_id", "");
      expect(getDashboard(rhCtx(seed), dashboardQuerySchema.parse({})).risk).toBeNull();
      const d = getEmployeeDetail(rhCtx(seed), scoredInScopeId(), { source: "page" });
      expect(d.estimation.status).toBe("AUCUN_RUN");
      expect(listEmployees(rhCtx(seed), listQuery()).rows.every((r) => r.level === null)).toBe(true);

      sqlite.prepare("UPDATE scoring_run SET status = 'STAGING' WHERE id = ?").run(older);
      setSetting(sqlite, "current_run_id", String(older));
      expect(getDashboard(rhCtx(seed), dashboardQuerySchema.parse({})).risk).toBeNull();
    } finally {
      sqlite.prepare("UPDATE scoring_run SET status = 'PUBLIE' WHERE id = ?").run(older);
      setSetting(sqlite, "current_run_id", String(seed.currentRunId));
    }
  });

  it("modèle B0 : score à règles en points, jamais une probabilité ni un lift", () => {
    const sqlite = db();
    const id = scoredInScopeId();
    const m = Number(sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('b0-test', 'B0', 'CANDIDAT', 'v1')").run().lastInsertRowid);
    const r = Number(sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, n_scored) VALUES ('2026-08-31', ?, 'PUBLIE', 1)").run(m).lastInsertRowid);
    sqlite.prepare("INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, '2026-08-31', 4, 'ELEVE', 1, 2.5, ?)").run(r, id, m);
    try {
      setSetting(sqlite, "current_run_id", String(r));
      const d = getEmployeeDetail(rhCtx(seed), id, { source: "page" }) as EmployeeDetailRh;
      expect(d.estimation.status === "OK" && d.estimation.estimate).toEqual({ type: "SCORE_REGLES", points: 4 });
      const dash = getDashboard(rhCtx(seed), dashboardQuerySchema.parse({}));
      expect(dash.view === "RH" && dash.risk?.byDepartment.every((x) => x.avgLift === null)).toBe(true);
    } finally {
      setSetting(sqlite, "current_run_id", String(seed.currentRunId));
    }
  });
});

describe("dashboard", () => {
  it("agrégats et calcul détaillé donnent les mêmes séries sur la population complète", () => {
    const months = monthRange("2025-03", "2026-08");
    const agg = _monthlyFromAggregates(months);
    const src = _monthlyFromSources(rhCtx(seed), {}, "2026-08-31", months, true);
    for (let i = 0; i < months.length; i++)
      for (const k of ["headcount", "entries", "exits", "voluntaryExits", "absenceDaysNonHealth", "workableDays", "payrollMass", "trainingsDone", "trainingsDue"] as const)
        expect(src[i][k]).toBeCloseTo(agg[i][k], 6);
  });

  it("effectif, entrées et sorties hors stages et SIVP ; absentéisme sur tous les présents", () => {
    const count = (sql: string, ...args: unknown[]) => (db().prepare(sql).get(...args) as { n: number }).n;
    const d = getDashboard(rhCtx(seed), dashboardQuerySchema.parse({ periode: "18m" }));
    const staff = count(`SELECT COUNT(*) AS n FROM employee e WHERE e.status = 'ACTIF' AND ${WORK_CONTRACT}`);
    expect(count("SELECT COUNT(*) AS n FROM employee e WHERE e.status = 'ACTIF'")).toBeGreaterThan(staff);
    expect(d.kpis.headcount).toBe(staff);

    const leaver = Number(
      db()
        .prepare("INSERT INTO employee (matricule, last_name, first_name, hire_date, department_id, status, exit_date) VALUES ('SIVPX', 'Sivp', 'Test', '2025-01-06', (SELECT MIN(id) FROM department), 'SORTI', '2026-03-13')")
        .run().lastInsertRowid,
    );
    db().prepare("INSERT INTO contract (employee_id, type, start_date, end_date) VALUES (?, 'SIVP', '2025-01-06', '2027-01-05')").run(leaver);
    db().prepare("INSERT INTO exit_event (employee_id, exit_date, reason, recorded_at) VALUES (?, '2026-03-13', 'DEMISSION', '2026-03-13')").run(leaver);
    const months = monthRange("2025-03", "2026-08");
    const rows = _monthlyFromSources(rhCtx(seed), {}, "2026-08-31", months, false);
    const exits = (work: boolean) =>
      count(`SELECT COUNT(*) AS n FROM exit_event x JOIN employee e ON e.id = x.employee_id WHERE x.exit_date BETWEEN '2025-03-01' AND '2026-08-31' AND ${work ? "" : "NOT"} ${WORK_CONTRACT}`);
    expect(exits(false)).toBeGreaterThan(0);
    expect(rows.reduce((n, r) => n + r.exits, 0)).toBe(exits(true));
    expect(rows.find((r) => r.month === "2026-03")!.workableDays).toBeGreaterThan(_monthlyFromAggregates(["2026-03"])[0].workableDays);

    const sivp = getDashboard(rhCtx(seed), dashboardQuerySchema.parse({ contrat: "SIVP" }));
    expect(sivp.kpis).toMatchObject({ headcount: 0, entries: 0, exits: 0, turnover12: null });
    expect(sivp.kpis.absenteeismRate).not.toBeNull();
  });

  it("filtres invalides ignorés et signalés côté page, rejetés côté API", () => {
    const { data, ignored } = parseQuery(dashboardQuerySchema, { periode: "99m", contrat: "CDD", age: "<script>" }, "lenient");
    expect(data).toMatchObject({ periode: "12m", contrat: "CDD" });
    expect(ignored.sort()).toEqual(["age", "periode"]);
    expect(() => parseQuery(dashboardQuerySchema, { periode: "99m" }, "strict")).toThrow();
    const d = getDashboard(rhCtx(seed), data, ignored);
    expect(d.source).toBe("DETAIL");
    expect(d.filters.map((f) => f.key)).toEqual(["contrat"]);
    expect(d.series.length).toBe(12);
  });
});

describe("recommandations", () => {
  const proposed = () =>
    db().prepare("SELECT id, employee_id AS employeeId FROM recommendation WHERE status = 'PROPOSEE' ORDER BY id").all() as { id: number; employeeId: number }[];

  it("RH : réalisée crée une intervention datée, auditée ; double traitement refusé (409)", () => {
    const [reco] = proposed();
    const input = decideSchema.parse({ recommendationId: String(reco.id), decision: "REALISEE", date: "2026-09-15", feedback: "PERTINENTE" });
    const res = decideRecommendation(rhCtx(seed), input);
    expect(res.interventionId).not.toBeNull();
    const i = db().prepare("SELECT date, employee_id AS e FROM intervention WHERE id = ?").get(res.interventionId) as { date: string; e: number };
    expect(i).toEqual({ date: "2026-09-15", e: reco.employeeId });
    expect(lastAudit()).toMatchObject({ action: "recommendation.decide", targetId: String(reco.id), outcome: "OK" });
    expectHttp(() => decideRecommendation(rhCtx(seed), input), 409);
  });

  it("rejet : commentaire obligatoire ; retour pertinente/non pertinente", () => {
    const [reco] = proposed();
    expect(decideSchema.safeParse({ recommendationId: reco.id, decision: "REJETEE" }).success).toBe(false);
    expect(decideSchema.safeParse({ recommendationId: reco.id, decision: "REALISEE", date: "2999-01-01" }).success).toBe(false);
    decideRecommendation(rhCtx(seed), decideSchema.parse({ recommendationId: reco.id, decision: "REJETEE", comment: "Déjà traité en entretien." }));
    setRecommendationFeedback(rhCtx(seed), { recommendationId: reco.id, feedback: "NON_PERTINENTE" });
    const r = db().prepare("SELECT status, comment, feedback FROM recommendation WHERE id = ?").get(reco.id);
    expect(r).toEqual({ status: "REJETEE", comment: "Déjà traité en entretien.", feedback: "NON_PERTINENTE" });
  });

  it("manager : 403 audité sur la liste et les mutations ; 404 si inexistante", () => {
    const [reco] = proposed();
    expectHttp(() => listRecommendations(managerCtx(seed), recommendationListSchema.parse({})), 403);
    expectHttp(() => decideRecommendation(managerCtx(seed), decideSchema.parse({ recommendationId: reco.id, decision: "REALISEE", date: "2026-09-01" })), 403);
    expect(lastAudit()).toMatchObject({ action: "recommendation.decide", outcome: "REFUSE" });
    expectHttp(() => setRecommendationFeedback(rhCtx(seed), { recommendationId: 999_999, feedback: "PERTINENTE" }), 404);
  });

  it("KPI d'adoption cohérents avec les statuts", () => {
    const l = listRecommendations(rhCtx(seed), recommendationListSchema.parse({}));
    expect(l.kpis.total).toBe(l.kpis.proposed + l.kpis.done + l.kpis.rejected);
    expect(l.kpis.adoptionRate).toBeCloseTo(l.kpis.done / (l.kpis.done + l.kpis.rejected), 9);
    expect(l.kpis.interventions).toBe(l.kpis.done);
    const filtered = listRecommendations(rhCtx(seed), recommendationListSchema.parse({ statut: "PROPOSEE" }));
    expect(filtered.rows.every((r) => r.status === "PROPOSEE")).toBe(true);
  });
});

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actionLabel, describeAudit, AUDIT_CATEGORIES } from "@/components/admin/audit-labels";
import type { SessionUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/dal/errors";
import type { LeverSearchDto, WhatIfDto } from "@/lib/dal/whatif";
import { backfillFeatures } from "@/lib/features";
import { scoreMonth } from "@/lib/scoring";
import { setSetting } from "@/lib/settings";
import { NON_CAUSAL_NOTICE } from "@/lib/whatif";
import { ALREADY_LOW_MESSAGE, LEVER_STEPS, NO_COMBINATION_MESSAGE } from "@/lib/whatif/search";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildWhatIfScenario, ORIGIN, T } from "../fixtures/whatif";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const MGR_USER = 900;
let db: TestDb;
let ids: ReturnType<typeof buildWhatIfScenario>;

beforeAll(() => {
  db = createTestDb();
  ids = buildWhatIfScenario(new Fixture(db.sqlite));
  setSetting(db.sqlite, "capacity_rate", "0.25");
  setSetting(db.sqlite, "data_end_date", T);
  backfillFeatures(db.sqlite, ORIGIN.slice(0, 7), ORIGIN.slice(0, 7));
  scoreMonth(db.sqlite, T);
  process.env.DATABASE_PATH = db.file;
});
afterAll(() => {
  const g = globalThis as unknown as { __paDb?: { sqlite: { close(): void } } };
  g.__paDb?.sqlite.close();
  delete g.__paDb;
  db.close();
});

const asRh = () => (session.current = { userId: 1, login: "rh.test", role: "RH", employeeId: null });
const asAdmin = () => (session.current = { userId: 2, login: "admin.test", role: "ADMIN", employeeId: null });
const asManager = () => (session.current = { userId: MGR_USER, login: "mgr.test", role: "MANAGER", employeeId: ids.m });

const request = (url: string, body: unknown) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
  });
const search = async (id: string | number, body: unknown = {}) => {
  const { POST } = await import("@/app/api/employees/[id]/what-if/search/route");
  return POST(request(`/api/employees/${id}/what-if/search`, body), { params: Promise.resolve({ id: String(id) }) });
};
const whatIf = async (id: number, body: unknown) => {
  const { POST } = await import("@/app/api/employees/[id]/what-if/route");
  return POST(request(`/api/employees/${id}/what-if`, body), { params: Promise.resolve({ id: String(id) }) });
};
const lastAudit = (action: string) =>
  db.sqlite.prepare("SELECT outcome, user_id AS userId, target_id AS targetId, detail_json AS d FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1").get(action) as
    | { outcome: string; userId: number; targetId: string; d: string }
    | undefined;
const auditCount = (action: string) => (db.sqlite.prepare("SELECT count(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
const sourceFingerprint = () =>
  db.sqlite
    .prepare(
      `SELECT (SELECT count(*) FROM prediction) AS p, (SELECT count(*) FROM prediction_factor) AS f, (SELECT count(*) FROM career_event) AS c,
        (SELECT count(*) || ':' || sum(base_salary) FROM payroll_monthly) AS pay, (SELECT count(*) FROM training) AS t,
        (SELECT sum(overtime_minutes) FROM attendance_daily) AS ot, (SELECT count(*) FROM feature_snapshot) AS s, (SELECT count(*) FROM scoring_run) AS r,
        (SELECT count(*) FROM recommendation) AS reco, (SELECT count(*) FROM alert) AS al`,
    )
    .get();

describe("POST /api/employees/[id]/what-if/search — RH", () => {
  it("pistes du modèle publié, rien n'est enregistré hormis l'audit whatif.search", async () => {
    asRh();
    const fp = sourceFingerprint();
    const res = await search(ids.f, { chargeRatePct: 16.57 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as LeverSearchDto;
    const stored = db.sqlite.prepare("SELECT prob6 AS score, level FROM prediction WHERE employee_id = ? ORDER BY id DESC LIMIT 1").get(ids.f) as { score: number; level: string };
    expect(body).toMatchObject({ employeeId: ids.f, asOf: T, model: { kind: "B0" }, notice: NON_CAUSAL_NOTICE, stored, status: "TROUVE" });
    expect(body.before).toMatchObject({ score: stored.score, level: "ELEVE" });
    expect(body.proposals.map((p) => p.levers)).toEqual([
      { salaryPct: 0, overtimeCutH: 0, trainingHours: 0, promotion: true },
      { salaryPct: 15, overtimeCutH: 20, trainingHours: 0, promotion: false },
    ]);
    expect(body.proposals.every((p) => p.after.level === "FAIBLE")).toBe(true);
    expect(body.proposals[0].applied.grade).toEqual({ before: "G2", after: "G3" });
    expect(body.message).toMatch(/^2 pistes pour passer sous le niveau Élevé/);
    expect(body.method).toMatchObject({ steps: LEVER_STEPS, limits: { salaryPct: 30, overtimeCutH: 40, trainingHours: 200 }, promotionEffort: 1, combos: 1429 });
    expect(body.method.engineRuns).toBeLessThanOrEqual(46);
    expect(body.notes).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/départs? évités?/i);
    expect(sourceFingerprint()).toEqual(fp);
    const a = lastAudit("whatif.search")!;
    expect(a).toMatchObject({ outcome: "OK", userId: 1, targetId: String(ids.f) });
    expect(JSON.parse(a.d)).toMatchObject({ source: "api", asOf: T, status: "TROUVE", proposals: 2 });
  });

  it("« Appliquer à la simulation » : le what-if avec les leviers d'une piste donne le même résultat que la carte", async () => {
    asRh();
    const body = (await (await search(ids.f, { chargeRatePct: 20 })).json()) as LeverSearchDto;
    for (const p of body.proposals) {
      const res = await whatIf(ids.f, { ...p.levers, chargeRatePct: 20 });
      expect(res.status).toBe(200);
      const sim = (await res.json()) as WhatIfDto;
      expect(sim.before).toEqual(body.before);
      expect(sim.after).toEqual(p.after);
      expect(sim.applied).toEqual(p.applied);
      expect(sim.cost).toEqual(p.cost);
    }
  });

  it("aucune combinaison suffisante : message explicite ; niveau déjà Faible : rien à chercher", async () => {
    asRh();
    const none = (await (await search(ids.a)).json()) as LeverSearchDto;
    expect(none.status).toBe("AUCUNE");
    expect(none.proposals).toEqual([]);
    expect(none.message).toBe("Aucune combinaison dans les limites de la simulation ne fait baisser le niveau ; voir les facteurs associés.");
    expect(none.message).toBe(NO_COMBINATION_MESSAGE);
    expect(JSON.parse(lastAudit("whatif.search")!.d)).toMatchObject({ status: "AUCUNE", proposals: 0 });
    const low = (await (await search(ids.b)).json()) as LeverSearchDto;
    expect(low).toMatchObject({ status: "DEJA_FAIBLE", message: ALREADY_LOW_MESSAGE, proposals: [] });
    expect(low.before.level).toBe("FAIBLE");
  });
});

describe("mêmes règles que le what-if", () => {
  it("manager (même dans son périmètre) et admin : 403 audité REFUSE", async () => {
    asManager();
    expect((await search(ids.f)).status).toBe(403);
    expect(lastAudit("whatif.search")).toMatchObject({ outcome: "REFUSE", userId: MGR_USER });
    asAdmin();
    expect((await search(ids.f, { chargeRatePct: 999 })).status).toBe(403);
    expect(lastAudit("whatif.search")).toMatchObject({ outcome: "REFUSE", userId: 2 });
    const { searchWhatIfLevers } = await import("@/lib/dal/whatif");
    expect(() => searchWhatIfLevers({ userId: MGR_USER, login: "m", role: "MANAGER", employeeId: ids.m }, ids.f, {}, { source: "api" })).toThrow(HttpError);
  });

  it("anonyme : 401", async () => {
    session.current = null;
    expect((await search(ids.f)).status).toBe(401);
  });

  it("400 corps invalide (zod strict, JSON illisible), 404 inexistant, 409 non évalué", async () => {
    asRh();
    expect((await search(ids.f, { salaryPct: 5 })).status).toBe(400);
    expect((await search(ids.f, { chargeRatePct: 101 })).status).toBe(400);
    expect((await search(ids.f, { chargeRatePct: "10" })).status).toBe(400);
    expect((await search(ids.f, "{")).status).toBe(400);
    expect((await search(999999)).status).toBe(404);
    expect((await search("abc")).status).toBe(404);
    const res = await search(ids.d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "NON_EVALUE", message: "Collaborateur non évalué dans le calcul publié : simulation impossible." });
  });

  it("opposition au traitement : 409 OPPOSITION, audité REFUSE (motif opposition), aucun calcul", async () => {
    asRh();
    db.sqlite.prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, ?)").run(ids.h, "2025-06-01T00:00:00Z");
    try {
      const res = await search(ids.h);
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("OPPOSITION");
      const a = lastAudit("whatif.search")!;
      expect(a).toMatchObject({ outcome: "REFUSE", targetId: String(ids.h) });
      expect(JSON.parse(a.d)).toMatchObject({ reason: "opposition" });
    } finally {
      db.sqlite.prepare("DELETE FROM employee_opposition WHERE employee_id = ?").run(ids.h);
    }
  });

  it("variables du mois indisponibles : 422 SIMULATION_IMPOSSIBLE audité ECHEC", async () => {
    asRh();
    const rows = db.sqlite.prepare("SELECT employee_id AS e, as_of AS a, fsv AS f, values_json AS v, partial_history AS p FROM feature_snapshot WHERE as_of = ?").all(T) as {
      e: number;
      a: string;
      f: string;
      v: string;
      p: number;
    }[];
    db.sqlite.prepare("DELETE FROM feature_snapshot WHERE as_of = ?").run(T);
    try {
      const before = auditCount("whatif.search");
      const res = await search(ids.f);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatchObject({ code: "SIMULATION_IMPOSSIBLE", message: "Variables du mois indisponibles : simulation impossible." });
      expect(auditCount("whatif.search")).toBe(before + 1);
      expect(lastAudit("whatif.search")!.outcome).toBe("ECHEC");
    } finally {
      const ins = db.sqlite.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json, partial_history) VALUES (?, ?, ?, ?, ?)");
      db.sqlite.transaction(() => rows.forEach((r) => ins.run(r.e, r.a, r.f, r.v, r.p)))();
    }
  });

  it("what-if inchangé après la mise en commun des gardes : 200 RH, audit whatif.run", async () => {
    asRh();
    const res = await whatIf(ids.f, { salaryPct: 10 });
    expect(res.status).toBe(200);
    expect(lastAudit("whatif.run")).toMatchObject({ outcome: "OK", userId: 1 });
  });
});

describe("journal d'audit", () => {
  it("phrases lisibles pour whatif.search, rangées dans « Simulations « et si ? » »", () => {
    const e = { action: "whatif.search", login: "rh.demo", targetType: "employee", targetId: "24", detail: null };
    expect(describeAudit({ ...e, outcome: "OK" })).toBe("rh.demo a recherché les leviers les plus efficaces pour le collaborateur n° 24.");
    expect(describeAudit({ ...e, outcome: "REFUSE", login: "mgr.demo" })).toBe(
      "mgr.demo a tenté de rechercher les leviers les plus efficaces pour le collaborateur n° 24 : accès refusé.",
    );
    expect(describeAudit({ ...e, outcome: "ECHEC" })).toBe("rh.demo n'a pas pu rechercher les leviers les plus efficaces pour le collaborateur n° 24.");
    expect(describeAudit({ ...e, outcome: "OK" }, new Map(), true)).toBe("Vous avez recherché les leviers les plus efficaces pour le collaborateur n° 24.");
    expect(actionLabel("whatif.search")).toBe("Rechercher les leviers les plus efficaces pour le collaborateur");
    expect(AUDIT_CATEGORIES.find((c) => "whatif.search".startsWith(c.prefix))?.label).toBe("Simulations « et si ? »");
  });
});

import path from "node:path";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/dal/errors";
import { backfillFeatures } from "@/lib/features";
import { loadChampion, promoteModel, registerBundle, scoreMonth, type LoadedModel } from "@/lib/scoring";
import { getSetting, setSetting } from "@/lib/settings";
import { NO_LEVERS, NON_CAUSAL_NOTICE, simulate, type Levers } from "@/lib/whatif";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildWhatIfScenario, ORIGIN, T } from "../fixtures/whatif";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");
const CHARGE = 0.1657;
const MGR_USER = 900;

let db: TestDb;
let ids: ReturnType<typeof buildWhatIfScenario>;
let runId: number;
let b0: LoadedModel;
const opts = (sqlite: TestDb["sqlite"]) => ({ capacityRate: Number(getSetting(sqlite, "capacity_rate")), mediumLift: Number(getSetting(sqlite, "medium_lift")), chargeRate: CHARGE });

beforeAll(() => {
  db = createTestDb();
  ids = buildWhatIfScenario(new Fixture(db.sqlite));
  setSetting(db.sqlite, "capacity_rate", "0.25");
  setSetting(db.sqlite, "data_end_date", T);
  backfillFeatures(db.sqlite, ORIGIN.slice(0, 7), ORIGIN.slice(0, 7));
  runId = scoreMonth(db.sqlite, T).runId;
  b0 = loadChampion(db.sqlite)!;
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
const post = async (id: string | number, body: unknown) => {
  const { POST } = await import("@/app/api/employees/[id]/what-if/route");
  const req = new NextRequest(new URL(`/api/employees/${id}/what-if`, "http://localhost"), {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
  });
  return POST(req, { params: Promise.resolve({ id: String(id) }) });
};
const lastAudit = (action: string) =>
  db.sqlite.prepare("SELECT outcome, user_id AS userId, detail_json AS d FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1").get(action) as {
    outcome: string;
    userId: number;
    d: string;
  };
const sourceFingerprint = () =>
  db.sqlite
    .prepare(
      `SELECT (SELECT count(*) FROM prediction) AS p, (SELECT count(*) FROM prediction_factor) AS f, (SELECT count(*) FROM career_event) AS c,
        (SELECT count(*) || ':' || sum(base_salary) FROM payroll_monthly) AS pay, (SELECT count(*) FROM training) AS t,
        (SELECT sum(overtime_minutes) FROM attendance_daily) AS ot, (SELECT count(*) FROM feature_snapshot) AS s, (SELECT count(*) FROM scoring_run) AS r`,
    )
    .get();

describe("what-if : noyau (mêmes fonctions que le batch)", () => {
  it("sans levier : score, niveau, rang et contributions identiques au calcul publié, pour chaque salarié scoré", () => {
    const preds = db.sqlite.prepare("SELECT id, employee_id AS e, prob6 AS p, level, rank FROM prediction WHERE run_id = ?").all(runId) as {
      id: number;
      e: number;
      p: number;
      level: string;
      rank: number;
    }[];
    expect(preds.length).toBeGreaterThanOrEqual(8);
    for (const pr of preds) {
      const r = simulate(db.sqlite, b0, pr.e, T, NO_LEVERS, opts(db.sqlite));
      expect(r.before).toMatchObject({ score: pr.p, level: pr.level, rank: pr.rank, population: preds.length });
      expect(r.after).toEqual(r.before);
      expect(r.changes).toEqual([]);
      expect(r.cost.annual).toBe(0);
      const stored = db.sqlite.prepare("SELECT group_code AS g, contribution AS c FROM prediction_factor WHERE prediction_id = ?").all(pr.id) as { g: string; c: number }[];
      expect(Object.fromEntries(r.groups.map((g) => [g.group, g.before]))).toEqual(Object.fromEntries(stored.map((s) => [s.g, s.c])));
    }
  });

  it("leviers appliqués aux sources : salaire, promotion à la médiane du grade, heures sup, formation, coût chargé", () => {
    const o = opts(db.sqlite);
    const before = simulate(db.sqlite, b0, ids.f, T, NO_LEVERS, o).before;
    expect(before.score).toBe(4);

    const raise = simulate(db.sqlite, b0, ids.f, T, { ...NO_LEVERS, salaryPct: 10 }, o);
    expect(raise.applied.salary).toEqual({ before: 1500, after: 1650 });
    expect(raise.cost.annual).toBeCloseTo(150 * 12 * (1 + CHARGE), 9);
    expect(raise.changes.map((c) => c.feature).sort()).toEqual(["compa_ratio", "months_since_raise", "raise_pct_12m"]);
    expect(raise.after.score).toBe(4);

    const promo = simulate(db.sqlite, b0, ids.f, T, { ...NO_LEVERS, promotion: true }, o);
    expect(promo.applied.grade).toEqual({ before: "G2", after: "G3" });
    expect(promo.applied.salary).toEqual({ before: 1500, after: 2700 });
    const after = Object.fromEntries(promo.changes.map((c) => [c.feature, c.after]));
    expect(after).toMatchObject({ grade_level: 3, months_since_promotion: 0, compa_ratio: 1, months_since_raise: 0 });
    expect(promo.after.score).toBe(1);
    expect(promo.groups.find((g) => g.group === "REMUNERATION")).toEqual({ group: "REMUNERATION", before: 2, after: 0 });

    const ot = simulate(db.sqlite, b0, ids.f, T, { ...NO_LEVERS, overtimeCutH: 40 }, o);
    expect(ot.changes.find((c) => c.feature === "overtime_h_avg_3m")?.after).toBe(0);
    expect(ot.applied.overtimeRemovedH).toBeGreaterThan(90);
    expect(ot.after.score).toBe(3);

    const tr = simulate(db.sqlite, b0, ids.f, T, { ...NO_LEVERS, trainingHours: 20 }, o);
    expect(tr.changes).toEqual([{ feature: "training_hours_12m", before: 0, after: 20 }]);
    expect(tr.after.score).toBe(4);
    expect(tr.cost.annual).toBe(0);
  });

  it("B0 garantit la monotonie : règles à seuil (compa_ratio <, heures sup >, mois sans promotion >), leviers qui ne font que les desserrer", () => {
    const lever = fc.record({
      salaryPct: fc.integer({ min: 0, max: 30 }),
      overtimeCutH: fc.integer({ min: 0, max: 40 }),
      trainingHours: fc.integer({ min: 0, max: 200 }),
      promotion: fc.boolean(),
    });
    const o = opts(db.sqlite);
    fc.assert(
      fc.property(fc.constantFrom(ids.f, ids.a, ids.b, ids.c, ids.g), lever, lever, (id, x, y) => {
        const lo: Levers = { salaryPct: Math.min(x.salaryPct, y.salaryPct), overtimeCutH: Math.min(x.overtimeCutH, y.overtimeCutH), trainingHours: Math.min(x.trainingHours, y.trainingHours), promotion: x.promotion && y.promotion };
        const hi: Levers = { salaryPct: Math.max(x.salaryPct, y.salaryPct), overtimeCutH: Math.max(x.overtimeCutH, y.overtimeCutH), trainingHours: Math.max(x.trainingHours, y.trainingHours), promotion: x.promotion || y.promotion };
        const a = simulate(db.sqlite, b0, id, T, lo, o);
        const b = simulate(db.sqlite, b0, id, T, hi, o);
        expect(b.after.score).toBeLessThanOrEqual(a.after.score);
        expect(a.after.score).toBeLessThanOrEqual(a.before.score);
        expect(b.cost.annual).toBeGreaterThanOrEqual(a.cost.annual);
      }),
      { numRuns: 40 },
    );
  });
});

describe("what-if : API et DAL", () => {
  it("RH : 200, avant = score publié, bandeau non causal, rien n'est stocké, audit whatif.run", async () => {
    asRh();
    const fp = sourceFingerprint();
    const res = await post(ids.f, { salaryPct: 10, overtimeCutH: 40, trainingHours: 10, promotion: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    const stored = db.sqlite.prepare("SELECT prob6 AS p, level FROM prediction WHERE run_id = ? AND employee_id = ?").get(runId, ids.f) as { p: number; level: string };
    expect(body).toMatchObject({ employeeId: ids.f, asOf: T, model: { kind: "B0" }, notice: NON_CAUSAL_NOTICE, stored: { score: stored.p, level: stored.level } });
    expect(body.before).toMatchObject({ score: stored.p, level: stored.level });
    expect(body.after.score).toBe(0);
    expect(body.levers.chargeRatePct).toBe(16.57);
    expect(body.groups.map((g: { label: string }) => g.label)).toContain("Rémunération");
    expect(body.changes.find((c: { feature: string }) => c.feature === "compa_ratio")).toMatchObject({ after: "Salaire à 100 % de la médiane du poste" });
    expect(sourceFingerprint()).toEqual(fp);
    const a = lastAudit("whatif.run");
    expect(a.outcome).toBe("OK");
    expect(JSON.parse(a.d)).toMatchObject({ source: "api", asOf: T, levers: { salaryPct: 10, promotion: true } });
  });

  it("manager (même dans son périmètre) et admin : 403 audité REFUSE", async () => {
    asManager();
    expect((await post(ids.f, {})).status).toBe(403);
    expect(lastAudit("whatif.run")).toMatchObject({ outcome: "REFUSE", userId: MGR_USER });
    expect((await post(ids.f, { salaryPct: 999 })).status).toBe(403);
    asAdmin();
    expect((await post(ids.f, {})).status).toBe(403);
    const { runWhatIf } = await import("@/lib/dal/whatif");
    expect(() => runWhatIf({ userId: MGR_USER, login: "m", role: "MANAGER", employeeId: ids.m }, ids.f, {}, { source: "api" })).toThrow(HttpError);
  });

  it("400 sur levier hors bornes ou inconnu, 404 inexistant, 409 non évalué, 422 promotion impossible", async () => {
    asRh();
    expect((await post(ids.f, { salaryPct: 31 })).status).toBe(400);
    expect((await post(ids.f, { overtimeCutH: -1 })).status).toBe(400);
    expect((await post(ids.f, { bonus: 1 })).status).toBe(400);
    expect((await post(ids.f, "{")).status).toBe(400);
    expect((await post(999999, {})).status).toBe(404);
    expect((await post("abc", {})).status).toBe(404);
    expect((await post(ids.d, {})).status).toBe(409);
    db.sqlite.prepare("UPDATE employee SET grade = 'G8' WHERE id = ?").run(ids.m);
    try {
      const res = await post(ids.m, { promotion: true });
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toMatch(/Grade maximal/);
    } finally {
      db.sqlite.prepare("UPDATE employee SET grade = 'G5' WHERE id = ?").run(ids.m);
    }
  });
});

describe("backtesting", () => {
  it("petite base : exposition au risque, démissions à 6 mois, précision, rappel, lift, délai ; calcul à la volée = run enregistré", async () => {
    const { getBacktest } = await import("@/lib/dal/backtest");
    const rh = { userId: 1, login: "rh.test", role: "RH" as const, employeeId: null };
    const fly = getBacktest(rh, {}, { source: "api" });
    expect(fly.model).toMatchObject({ kind: "B0", trainFrom: null, trainTo: null });
    expect(fly.months).toEqual([{ month: "2024-11", asOf: ORIGIN, source: "CALCUL" }]);
    const r = fly.result!;
    expect(r).toMatchObject({ asOf: ORIGIN, source: "CALCUL", n: 8, positives: 1, baseRate: 1 / 8, seenInTraining: null, missedPositives: 0 });
    expect(r.groups[0]).toEqual({ key: "ELEVE", flagged: 2, hits: 1, precision: 0.5, recall: 1, lift: 4, meanDelayDays: 91 });
    expect(r.groups[1]).toMatchObject({ key: "MOYEN", flagged: 0, hits: 0, precision: null });
    expect(r.groups[2]).toMatchObject({ key: "ELEVE_MOYEN", flagged: 2, hits: 1, precision: 0.5, recall: 1, lift: 4 });
    expect(r.people.map((p) => [p.id, p.level, p.resigned, p.eventDate, p.delayDays])).toEqual([
      [ids.d, "ELEVE", true, "2025-03-01", 91],
      [ids.f, "ELEVE", false, null, null],
    ]);

    const current = getSetting(db.sqlite, "current_run_id");
    scoreMonth(db.sqlite, ORIGIN, { publish: false });
    expect(getSetting(db.sqlite, "current_run_id")).toBe(current);
    const stored = getBacktest(rh, { mois: "2024-11" }, { source: "api" });
    expect(stored.result!.source).toBe("RUN");
    expect({ ...stored.result!, source: "CALCUL" }).toEqual(r);
    expect(getBacktest(rh, { mois: "2025-06" }, { source: "api" }).requestedUnavailable).toBe(true);
    expect(lastAudit("backtest.view").outcome).toBe("OK");
  });

  it("manager et admin : 403 audité, page redirigée vers /interdit", async () => {
    const { getBacktest } = await import("@/lib/dal/backtest");
    expect(() => getBacktest({ userId: MGR_USER, login: "m", role: "MANAGER", employeeId: ids.m }, {}, { source: "page" })).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(lastAudit("backtest.view")).toMatchObject({ outcome: "REFUSE", userId: MGR_USER });
    expect(() => getBacktest({ userId: 2, login: "a", role: "ADMIN", employeeId: null }, {}, { source: "page" })).toThrow(expect.objectContaining({ status: 403 }));
    const page = (await import("@/app/(app)/backtesting/page")).default;
    asManager();
    await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/interdit");
  });
});

describe("pages", () => {
  const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);

  it("fiche : panneau what-if pour la RH seulement ; backtesting : exposition au risque, B0 score à règles", async () => {
    const detail = (await import("@/app/(app)/employees/[id]/page")).default;
    const backtesting = (await import("@/app/(app)/backtesting/page")).default;
    asRh();
    const rhHtml = html(await detail({ params: Promise.resolve({ id: String(ids.f) }) }));
    expect(rhHtml).toContain("Simulation « et si ? »");
    expect(rhHtml).toContain("Estimation non causale");
    expect(rhHtml).toContain("Charges patronales (%)");
    const bt = html(await backtesting({ searchParams: Promise.resolve({ mois: "2024-11" }) }));
    for (const s of ["Exposition au risque, hors effet des actions", "Score à règles (B0) : points", "Précision", "Rappel", "Délai moyen avant démission", "Classés Élevé"]) expect(bt).toContain(s);
    expect(bt).not.toMatch(/départs? évités?/i);
    asManager();
    const mgrHtml = html(await detail({ params: Promise.resolve({ id: String(ids.f) }) }));
    expect(mgrHtml).not.toContain("Simulation");
    expect(mgrHtml).not.toContain("Estimation non causale");
  });
});

describe("what-if avec un modèle LOGREG", () => {
  let db2: TestDb;
  let ids2: ReturnType<typeof buildWhatIfScenario>;
  let run2: number;
  let toy: LoadedModel;
  beforeAll(() => {
    db2 = createTestDb();
    ids2 = buildWhatIfScenario(new Fixture(db2.sqlite));
    registerBundle(db2.sqlite, TOY);
    promoteModel(db2.sqlite, "logreg-toy-v1");
    // petite base : règle de démarrage à froid désactivée, sinon le run publié serait calculé par B0
    setSetting(db2.sqlite, "min_events_for_model", "0");
    run2 = scoreMonth(db2.sqlite, T).runId;
    toy = loadChampion(db2.sqlite)!;
  });
  afterAll(() => db2.close());

  it("sans levier : probabilité, niveau et rang identiques au calcul publié", () => {
    const preds = db2.sqlite.prepare("SELECT employee_id AS e, prob6 AS p, level, rank FROM prediction WHERE run_id = ?").all(run2) as { e: number; p: number; level: string; rank: number }[];
    expect(toy.kind).toBe("LOGREG");
    for (const pr of preds) {
      const r = simulate(db2.sqlite, toy, pr.e, T, NO_LEVERS, opts(db2.sqlite));
      expect(r.before).toMatchObject({ score: pr.p, level: pr.level, rank: pr.rank });
      expect(r.after).toEqual(r.before);
    }
  });

  // Monotonie non garantie en général : elle dépend du signe des coefficients des variables que chaque levier modifie.
  it("monotonie du levier salaire quand les coefficients la garantissent ; heures sup : sens dicté par le modèle", () => {
    const b = toy.bundle as { features: string[]; coef: number[] };
    const coef = (f: string) => (b.features.includes(f) ? b.coef[b.features.indexOf(f)] : 0);
    expect(coef("compa_ratio")).toBeLessThan(0);
    expect(coef("raise_pct_12m")).toBeLessThan(0);
    expect(coef("months_since_raise")).toBeGreaterThanOrEqual(0);
    const o = opts(db2.sqlite);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }), (x, y) => {
        const lo = simulate(db2.sqlite, toy, ids2.f, T, { ...NO_LEVERS, salaryPct: Math.min(x, y) }, o).after.score;
        const hi = simulate(db2.sqlite, toy, ids2.f, T, { ...NO_LEVERS, salaryPct: Math.max(x, y) }, o).after.score;
        expect(hi).toBeLessThanOrEqual(lo);
      }),
      { numRuns: 25 },
    );
    expect(coef("overtime_h_avg_3m")).toBe(0);
    expect(coef("overtime_trend_6m")).toBeLessThan(0);
    const ot = simulate(db2.sqlite, toy, ids2.f, T, { ...NO_LEVERS, overtimeCutH: 20 }, o);
    expect(ot.changes.find((c) => c.feature === "overtime_trend_6m")!.after).toBeLessThan(ot.changes.find((c) => c.feature === "overtime_trend_6m")!.before);
    expect(ot.after.score).toBeGreaterThan(ot.before.score);
  });
});

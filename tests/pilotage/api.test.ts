import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/session";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, findLeaks, sensitiveValues, setupSeededDb } from "./setup";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({
  readSession: async () => session.current,
  clientIp: (h: Headers) => h.get("x-forwarded-for") ?? "local",
}));

let file = "";
let seed: SeedResult;
beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("api"));
});
afterAll(() => cleanupDb(file));

const asRh = () => (session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
const asManager = () => (session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId });
const req = (url: string) => new NextRequest(new URL(url, "http://localhost"));
const detail = async (id: string | number) => {
  const { GET } = await import("@/app/api/employees/[id]/route");
  return GET(req(`/api/employees/${id}`), { params: Promise.resolve({ id: String(id) }) });
};

describe("API pilotage", () => {
  it("401 sans session", async () => {
    session.current = null;
    const { GET } = await import("@/app/api/me/route");
    const res = await GET(req("/api/me"), undefined);
    expect(res.status).toBe(401);
    expect((await detail(1)).status).toBe(401);
  });

  it("GET /api/me décrit le rôle et les droits", async () => {
    asManager();
    const { GET } = await import("@/app/api/me/route");
    const body = await (await GET(req("/api/me"), undefined)).json();
    expect(body).toMatchObject({ login: "mgr.demo", role: "MANAGER", employee: { id: seed.managerEmployeeId }, permissions: { compensation: false, probability: false } });
  });

  it("GET /api/employees/[id] : 403 hors périmètre, 404 inexistant ou identifiant invalide, 200 audité", async () => {
    asManager();
    const out = db().prepare("SELECT id FROM employee WHERE department_id <> (SELECT department_id FROM employee WHERE id = ?) LIMIT 1").get(seed.managerEmployeeId) as { id: number };
    expect((await detail(out.id)).status).toBe(403);
    expect((await detail(999999)).status).toBe(404);
    expect((await detail("abc")).status).toBe(404);
    const inScope = db().prepare("SELECT id FROM employee WHERE manager_id = ? AND status = 'ACTIF' LIMIT 1").get(seed.managerEmployeeId) as { id: number };
    const res = await detail(inScope.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    const s = sensitiveValues([inScope.id]);
    expect(findLeaks(body, s.numbers, s.strings)).toEqual([]);
    const a = db().prepare("SELECT outcome, detail_json AS d FROM audit_log WHERE action = 'employee.view' ORDER BY id DESC LIMIT 1").get() as { outcome: string; d: string };
    expect(a.outcome).toBe("OK");
    expect(JSON.parse(a.d)).toMatchObject({ source: "api", view: "MANAGER" });
  });

  it("GET /api/dashboard et /api/employees : DTO par rôle, 400 sur paramètre invalide", async () => {
    const dash = await import("@/app/api/dashboard/route");
    const list = await import("@/app/api/employees/route");
    asManager();
    const m = await (await dash.GET(req("/api/dashboard?periode=6m"), undefined)).json();
    expect(m.view).toBe("MANAGER");
    expect(m.payroll).toBeUndefined();
    expect((await dash.GET(req("/api/dashboard?periode=abc"), undefined)).status).toBe(400);
    const ml = await (await list.GET(req("/api/employees?tri=probabilite"), undefined)).json();
    expect(ml.rows.every((r: Record<string, unknown>) => !("estimate" in r))).toBe(true);
    asRh();
    const r = await (await dash.GET(req("/api/dashboard"), undefined)).json();
    expect(r.view).toBe("RH");
    expect(r.payroll.lastMonth).toBeGreaterThan(0);
    const rl = await (await list.GET(req("/api/employees?niveau=ELEVE"), undefined)).json();
    expect(rl.rows.length).toBeGreaterThan(0);
    expect(rl.rows[0].estimate.type).toBe("PROBABILITE");
  });
});

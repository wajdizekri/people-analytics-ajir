import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/session";

const state = vi.hoisted(() => ({ session: null as SessionUser | null, headers: new Headers() as Headers | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  readSession: async () => state.session,
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!state.headers) throw new Error("hors requête");
    return state.headers;
  },
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { PILOTAGE_ROLES, ROUTE_HEADER, pageContext, requireContext } from "@/lib/dal/context";
import * as dashboardRoute from "@/app/api/dashboard/route";
import * as usersRoute from "@/app/api/admin/users/route";
import { proxy } from "@/proxy";
import { buildWorld, openDalDb } from "../fixtures/unit/dal-world";

// Point 3 : refus de rôle audités dans pageContext / requireContext, une seule ligne par refus.
let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
beforeAll(() => {
  db = openDalDb("sh-access");
  w = buildWorld(db.sqlite);
});
afterAll(() => db.close());
beforeEach(() => {
  state.headers = new Headers({ [ROUTE_HEADER]: "/dashboard", "x-forwarded-for": "10.9.8.7" });
});

const as = (who: "admin" | "rh" | "mgr" | null) => {
  state.session = who ? { ...w.ctx[who] } : null;
};
type Row = { id: number; user_id: number | null; action: string; target_type: string | null; target_id: string | null; outcome: string; detail_json: string | null; ip: string | null };
const lastId = () => (db.sqlite.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM audit_log").get() as { m: number }).m;
const since = (id: number) => db.sqlite.prepare("SELECT * FROM audit_log WHERE id > ? ORDER BY id").all(id) as Row[];

describe("refus de rôle audités", () => {
  it("page : ADMIN sur une page de pilotage -> /interdit, refus audité avec route, rôle et IP", async () => {
    as("admin");
    const before = lastId();
    await expect(pageContext(PILOTAGE_ROLES)).rejects.toThrow("REDIRECT /interdit");
    const rows = since(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: w.users.admin, action: "access.page", target_type: "route", target_id: "/dashboard", outcome: "REFUSE", ip: "10.9.8.7" });
    expect(JSON.parse(rows[0].detail_json!)).toEqual({ role: "ADMIN", required: ["RH", "MANAGER"] });
  });

  it("API : RH sur une route ADMIN -> 403 et refus audité (access.api)", async () => {
    as("rh");
    state.headers = new Headers({ [ROUTE_HEADER]: "/api/admin/users" });
    const before = lastId();
    const res = await usersRoute.GET(new NextRequest("http://localhost/api/admin/users"), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    const rows = since(before);
    expect(rows.map((r) => [r.action, r.outcome, r.target_id])).toEqual([["access.api", "REFUSE", "/api/admin/users"]]);
    expect(JSON.parse(rows[0].detail_json!)).toEqual({ role: "RH", required: ["ADMIN"] });
  });

  it("aucun audit si le rôle est autorisé, sans exigence de rôle, ou sans session (401 / /login)", async () => {
    const before = lastId();
    as("mgr");
    await expect(pageContext(PILOTAGE_ROLES)).resolves.toMatchObject({ role: "MANAGER" });
    await expect(requireContext()).resolves.toMatchObject({ role: "MANAGER" });
    as(null);
    await expect(pageContext(["RH"])).rejects.toThrow("REDIRECT /login");
    await expect(requireContext(["RH"])).rejects.toMatchObject({ status: 401 });
    expect(since(before)).toEqual([]);
  });

  it("pas de double audit : un refus de la DAL (ensurePilotage) n'est pas doublé par requireContext", async () => {
    as("admin");
    state.headers = new Headers({ [ROUTE_HEADER]: "/api/dashboard" });
    const before = lastId();
    const res = await dashboardRoute.GET(new NextRequest("http://localhost/api/dashboard"), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(since(before).map((r) => [r.action, r.outcome])).toEqual([["dashboard.view", "REFUSE"]]);
  });

  it("hors contexte de requête : le refus reste audité, sans route", async () => {
    as("mgr");
    state.headers = null;
    const before = lastId();
    await expect(requireContext(["ADMIN"])).rejects.toMatchObject({ status: 403, code: "INTERDIT" });
    expect(since(before).map((r) => [r.action, r.target_type, r.target_id, r.ip])).toEqual([["access.api", "route", null, null]]);
  });
});

describe("proxy : en-tête de route", () => {
  it("écrase une valeur fournie par le client et ne transmet pas les paramètres", () => {
    const req = new NextRequest("http://localhost/admin/users?token=secret", { headers: { cookie: "pa_session=x", [ROUTE_HEADER]: "/faux" } });
    const res = proxy(req);
    expect(res.headers.get(`x-middleware-request-${ROUTE_HEADER}`)).toBe("/admin/users");
  });

  it("sans cookie : 401 JSON sur l'API, redirection /login sur les pages", async () => {
    const api = proxy(new NextRequest("http://localhost/api/me"));
    expect(api.status).toBe(401);
    const page = proxy(new NextRequest("http://localhost/dashboard"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost/login?next=%2Fdashboard");
    expect(proxy(new NextRequest("http://localhost/")).headers.get("location")).toBe("http://localhost/login");
    const deep = proxy(new NextRequest("http://localhost/employees?niveau=ELEVE"));
    expect(deep.headers.get("location")).toBe("http://localhost/login?next=%2Femployees%3Fniveau%3DELEVE");
  });
});

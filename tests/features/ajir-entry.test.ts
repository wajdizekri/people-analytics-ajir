import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => jar.cookies.set(name, value),
    delete: (name: string) => jar.cookies.delete(name),
  }),
  headers: async () => jar.headers,
}));

import { NextRequest } from "next/server";
import { createSession, hashToken, SESSION_COOKIE } from "@/lib/auth/session";
import { LAUNCH_MAX_AGE_S, signLaunch, verifyLaunch } from "@/lib/dal/ajir";
import { GET as goEmployee } from "@/app/go/collaborateur/[matricule]/route";
import { GET as goDashboard } from "@/app/go/tableau-de-bord/route";
import { GET as launch } from "@/app/api/ajir/launch/route";
import { auditOf, buildWorld, openDalDb } from "../fixtures/unit/dal-world";

const SECRET = "s".repeat(40);
let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;

beforeAll(() => {
  db = openDalDb("ajir-entry");
  w = buildWorld(db.sqlite);
});
afterAll(() => db.close());
beforeEach(() => {
  jar.cookies.clear();
  jar.headers = new Headers();
  delete process.env.AJIR_LAUNCH_SECRET;
});

const req = (url: string) => new NextRequest(new URL(url, "http://localhost"));
const loginAs = async (userId: number) => {
  await createSession(userId);
};
const employee = (matricule: string) => goEmployee(req(`/go/collaborateur/${matricule}`), { params: Promise.resolve({ matricule }) });

describe("lien profond /go/collaborateur/<matricule>", () => {
  it("sans session : redirection vers la connexion, retour au lien profond après connexion", async () => {
    const res = await employee("T1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?next=%2Fgo%2Fcollaborateur%2FT1");
  });

  it("RH : redirection relative vers la fiche ; matricule inconnu ou invalide : 404", async () => {
    await loginAs(w.users.rh);
    const res = await employee("T1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/employees/${w.e.T1}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await employee("INCONNU")).status).toBe(404);
    const bad = await employee("<script>");
    expect(bad.status).toBe(404);
    expect(await bad.text()).not.toContain("<script>");
  });

  it("manager : sa hiérarchie oui (sous-équipe comprise), hors périmètre 403 audité", async () => {
    await loginAs(w.users.mgr);
    expect((await employee("S1")).headers.get("location")).toBe(`/employees/${w.e.S1}`);
    const out = await employee("X1");
    expect(out.status).toBe(403);
    expect(await out.text()).toContain("Accès refusé");
    expect(auditOf(db.sqlite, "employee.deeplink").at(-1)).toMatchObject({ userId: w.users.mgr, targetId: String(w.e.X1), outcome: "REFUSE" });
  });

  it("ADMIN (aucune donnée RH) : 403 audité ; inconnu reste 404", async () => {
    await loginAs(w.users.admin);
    expect((await employee("T1")).status).toBe(403);
    expect((await employee("ZZZ")).status).toBe(404);
    expect(auditOf(db.sqlite, "employee.deeplink").at(-1)).toMatchObject({ userId: w.users.admin, outcome: "REFUSE" });
  });

  it("/go/tableau-de-bord : accueil du rôle", async () => {
    expect((await goDashboard(req("/go/tableau-de-bord"), undefined)).headers.get("location")).toBe("/login");
    await loginAs(w.users.mgr);
    expect((await goDashboard(req("/go/tableau-de-bord"), undefined)).headers.get("location")).toBe("/dashboard");
    await loginAs(w.users.admin);
    expect((await goDashboard(req("/go/tableau-de-bord"), undefined)).headers.get("location")).toBe("/admin");
  });
});

describe("jeton de lancement AJIR /api/ajir/launch", () => {
  const url = (p: Record<string, string>) => `/api/ajir/launch?${new URLSearchParams(p)}`;
  const signed = (login: string, opts: { ts?: number; cible?: string; secret?: string } = {}) => {
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const cible = opts.cible ?? "/go/tableau-de-bord";
    const p: Record<string, string> = { login, ts, sig: signLaunch(opts.secret ?? SECRET, login, ts, cible) };
    if (opts.cible) p.cible = opts.cible;
    return p;
  };
  const reasons = () => auditOf(db.sqlite, "auth.ajir_launch").map((a) => (a.outcome === "OK" ? "OK" : JSON.parse(a.detail!).reason));

  it("désactivé sans secret (ou secret trop court) : 404, aucune session", async () => {
    expect((await launch(req(url(signed("rh"))), undefined)).status).toBe(404);
    process.env.AJIR_LAUNCH_SECRET = "court";
    expect(verifyLaunch(signed("rh"))).toMatchObject({ ok: false, status: 404 });
    expect(jar.cookies.size).toBe(0);
  });

  it("jeton valide : session créée, redirection vers la cible signée, usage unique", async () => {
    process.env.AJIR_LAUNCH_SECRET = SECRET;
    const p = signed("mgr", { cible: "/go/collaborateur/T2" });
    const res = await launch(req(url(p)), undefined);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/go/collaborateur/T2");
    const token = jar.cookies.get(SESSION_COOKIE)!;
    expect(db.sqlite.prepare("SELECT user_id AS u FROM session WHERE id = ?").get(hashToken(token))).toEqual({ u: w.users.mgr });

    const replay = await launch(req(url(p)), undefined);
    expect(replay.status).toBe(401);
    expect(reasons().slice(-2)).toEqual(["OK", "rejeu"]);
  });

  it("refus 401 audités : signature, cible modifiée, expiré, futur, format, compte inactif ou inconnu", async () => {
    process.env.AJIR_LAUNCH_SECRET = SECRET;
    const now = Math.floor(Date.now() / 1000);
    const before = auditOf(db.sqlite, "auth.ajir_launch").length;
    const cases: Record<string, string>[] = [
      signed("rh", { secret: "x".repeat(40) }),
      { ...signed("rh"), cible: "/go/collaborateur/T1" },
      signed("rh", { ts: now - LAUNCH_MAX_AGE_S - 5 }),
      signed("rh", { ts: now + LAUNCH_MAX_AGE_S + 5 }),
      signed("rh", { cible: "https://evil.example/" }),
      { ...signed("rh"), sig: "zz" },
      signed("inconnu"),
    ];
    db.sqlite.prepare("UPDATE app_user SET active = 0 WHERE id = ?").run(w.users.sub);
    cases.push(signed("sub"));
    for (const p of cases) {
      const res = await launch(req(url(p)), undefined);
      expect(res.status).toBe(401);
      expect(await res.text()).toContain("Lien AJIR invalide ou expiré");
    }
    db.sqlite.prepare("UPDATE app_user SET active = 1 WHERE id = ?").run(w.users.sub);
    expect(reasons().slice(before)).toEqual(["signature", "signature", "expire", "expire", "format", "format", "compte_inactif", "compte_inactif"]);
    expect(jar.cookies.size).toBe(0);
  });

  it("remplace la session d'un autre utilisateur ouverte dans le navigateur", async () => {
    process.env.AJIR_LAUNCH_SECRET = SECRET;
    await loginAs(w.users.mgr);
    const old = hashToken(jar.cookies.get(SESSION_COOKIE)!);
    expect((await launch(req(url(signed("rh"))), undefined)).status).toBe(303);
    expect(db.sqlite.prepare("SELECT 1 FROM session WHERE id = ?").get(old)).toBeUndefined();
    expect(db.sqlite.prepare("SELECT user_id AS u FROM session WHERE id = ?").get(hashToken(jar.cookies.get(SESSION_COOKIE)!))).toEqual({ u: w.users.rh });
  });
});

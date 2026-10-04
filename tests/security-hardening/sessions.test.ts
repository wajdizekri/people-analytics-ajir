import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type CookieOpts = { expires?: Date };
const jar = vi.hoisted(() => ({ cookies: new Map<string, { value: string; opts?: CookieOpts }>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)!.value } : undefined),
    set: (name: string, value: string, opts?: CookieOpts) => jar.cookies.set(name, { value, opts }),
    delete: (name: string) => jar.cookies.delete(name),
  }),
  headers: async () => jar.headers,
}));

import { getDb } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, SESSION_IDLE_MINUTES, createSession, hashToken, purgeExpiredSessions, readSession } from "@/lib/auth/session";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { changeOwnPassword } from "@/lib/dal/account";
import { buildWorld, openDalDb } from "../fixtures/unit/dal-world";

// Point 4 : expiration glissante (inactivité) avec plafond absolu, purge des sessions expirées, révocation.
let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
beforeAll(() => {
  db = openDalDb("sh-sessions");
  w = buildWorld(db.sqlite);
});
afterAll(() => db.close());
beforeEach(() => {
  jar.cookies.clear();
  jar.headers = new Headers();
});
afterEach(() => vi.useRealTimers());

const sqlite = () => getDb().sqlite;
const current = () => hashToken(jar.cookies.get(SESSION_COOKIE)!.value);
const row = (id: string) => sqlite().prepare("SELECT created_at AS c, expires_at AS e FROM session WHERE id = ?").get(id) as { c: string; e: string } | undefined;
const minutesLeft = (iso: string) => (Date.parse(iso) - Date.now()) / 60_000;
const setSession = (id: string, fields: { created?: number; expires?: number }) => {
  if (fields.created !== undefined) sqlite().prepare("UPDATE session SET created_at = ? WHERE id = ?").run(new Date(fields.created).toISOString(), id);
  if (fields.expires !== undefined) sqlite().prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(new Date(fields.expires).toISOString(), id);
};
const insertSession = (id: string, userId: number, created: number, expires: number) =>
  sqlite().prepare("INSERT INTO session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(id, userId, new Date(created).toISOString(), new Date(expires).toISOString());

describe("expiration glissante", () => {
  it("à l'usage, l'échéance devient « maintenant + inactivité » ; le cookie garde le plafond de 10 h", async () => {
    await createSession(w.users.rh);
    const id = current();
    expect(minutesLeft(row(id)!.e)).toBeGreaterThan(599);
    const cookieExpiry = jar.cookies.get(SESSION_COOKIE)!.opts!.expires!.getTime();
    expect(await readSession()).toMatchObject({ userId: w.users.rh });
    expect(minutesLeft(row(id)!.e)).toBeCloseTo(SESSION_IDLE_MINUTES, 0);
    expect(jar.cookies.get(SESSION_COOKIE)!.opts!.expires!.getTime()).toBe(cookieExpiry);
  });

  it("chaque usage prolonge la session (au plus une écriture par minute)", async () => {
    await createSession(w.users.rh);
    const id = current();
    await readSession();
    const first = row(id)!.e;
    await readSession();
    expect(row(id)!.e).toBe(first);
    setSession(id, { expires: Date.now() + 10 * 60_000 });
    expect(await readSession()).not.toBeNull();
    expect(minutesLeft(row(id)!.e)).toBeCloseTo(SESSION_IDLE_MINUTES, 0);
  });

  it("inactivité dépassée : session refusée et supprimée", async () => {
    await createSession(w.users.mgr);
    const id = current();
    setSession(id, { expires: Date.now() - 1000 });
    expect(await readSession()).toBeNull();
    expect(row(id)).toBeUndefined();
  });

  it("plafond absolu : jamais au-delà de 10 h après la connexion, même en activité continue", async () => {
    await createSession(w.users.mgr);
    const id = current();
    setSession(id, { created: Date.now() - 9.5 * 3600_000, expires: Date.now() + 3600_000 });
    expect(await readSession()).not.toBeNull();
    expect(minutesLeft(row(id)!.e)).toBeCloseTo(30, 0);
    setSession(id, { created: Date.now() - 10 * 3600_000 - 1000, expires: Date.now() + 3600_000 });
    expect(await readSession()).toBeNull();
    expect(row(id)).toBeUndefined();
  });
});

describe("purge des sessions expirées", () => {
  it("à la connexion : sessions inactives et hors plafond supprimées, sessions valides conservées", async () => {
    const now = Date.now();
    insertSession("expiree", w.users.sub, now - 3 * 3600_000, now - 60_000);
    insertSession("hors-plafond", w.users.sub, now - 11 * 3600_000, now + 3600_000);
    insertSession("valide", w.users.sub, now - 3600_000, now + 3600_000);
    await createSession(w.users.admin);
    const ids = (sqlite().prepare("SELECT id FROM session WHERE user_id = ?").all(w.users.sub) as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["valide"]);
  });

  it("périodique : au plus tous les 1/4 h, déclenchée par une lecture de session", async () => {
    purgeExpiredSessions();
    await createSession(w.users.rh);
    const t0 = Date.now();
    insertSession("vieille", w.users.sub, t0 - 3 * 3600_000, t0 - 60_000);
    await readSession();
    expect(row("vieille")).toBeDefined();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + 16 * 60_000);
    expect(await readSession()).not.toBeNull();
    expect(row("vieille")).toBeUndefined();
  });

  it("coût : une requête DELETE unique, sans balayage applicatif", () => {
    const now = Date.now();
    for (let i = 0; i < 200; i++) insertSession(`vrac-${i}`, w.users.sub, now - 5 * 3600_000, now - 1000);
    const t = performance.now();
    expect(purgeExpiredSessions()).toBeGreaterThanOrEqual(200);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("changement de mot de passe : essais du mot de passe actuel limités", () => {
  it("5 échecs en 15 min : 6e essai refusé sans vérification, même avec le bon mot de passe ; refus audité", async () => {
    resetRateLimits();
    sqlite().prepare("UPDATE app_user SET password_hash = ? WHERE id = ?").run(await hashPassword("Ancien2026pass"), w.users.mgr);
    const input = (current: string) => ({ current, password: "Nouveau2026pass", confirm: "Nouveau2026pass" });
    for (let i = 0; i < 5; i++) expect(await changeOwnPassword(w.ctx.mgr, input("faux"))).toEqual({ ok: false, error: "Mot de passe actuel incorrect." });
    const res = await changeOwnPassword(w.ctx.mgr, input("Ancien2026pass"));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/^Trop de tentatives/) });
    const last = sqlite().prepare("SELECT outcome, detail_json AS d FROM audit_log WHERE action = 'user.password_change' ORDER BY id DESC LIMIT 1").get() as { outcome: string; d: string };
    expect(last).toEqual({ outcome: "REFUSE", d: JSON.stringify({ reason: "limite" }) });
    resetRateLimits();
    expect(await changeOwnPassword(w.ctx.mgr, input("Ancien2026pass"))).toMatchObject({ ok: true });
  });
});

describe("révocation au changement de mot de passe", () => {
  it("les autres sessions du compte sont fermées, la session courante reste ouverte", async () => {
    sqlite().prepare("UPDATE app_user SET password_hash = ? WHERE id = ?").run(await hashPassword("Ancien2026pass"), w.users.rh);
    sqlite().prepare("DELETE FROM session WHERE user_id = ?").run(w.users.rh);
    await createSession(w.users.rh);
    await createSession(w.users.rh);
    const keep = current();
    const res = await changeOwnPassword(w.ctx.rh, { current: "Ancien2026pass", password: "Nouveau2026pass", confirm: "Nouveau2026pass" });
    expect(res).toEqual({ ok: true, revoked: 1 });
    expect((sqlite().prepare("SELECT id FROM session WHERE user_id = ?").all(w.users.rh) as { id: string }[]).map((r) => r.id)).toEqual([keep]);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => jar.cookies.set(name, value),
    delete: (name: string) => jar.cookies.delete(name),
  }),
  headers: async () => jar.headers,
}));
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...m, verifyPassword: vi.fn(m.verifyPassword) };
});

import { getDb } from "@/db/client";
import { activateWithRateLimit } from "@/lib/auth/activation";
import { login, MAX_ATTEMPTS } from "@/lib/auth/login";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { RATE_RULES, recordFailure, resetRateLimits, retryAfter, trustedClientIp, trustedProxyHops } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/session";
import { createActivationToken } from "@/lib/dal/admin";
import { auditOf, buildWorld, openDalDb } from "../fixtures/unit/dal-world";

// Point 7 : limitation en mémoire par IP (si fiable) et par compte, sur la connexion et l'activation.
let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
const PASSWORD = "BonMotDePasse2026";
const GENERIC = "Identifiant ou mot de passe incorrect. Vérifiez votre saisie, majuscules comprises, puis réessayez.";
const LOCKED = "Compte temporairement verrouillé après plusieurs essais infructueux. Réessayez dans quelques minutes ou demandez à l'administrateur de le déverrouiller.";

beforeAll(async () => {
  db = openDalDb("sh-rate");
  w = buildWorld(db.sqlite);
  db.sqlite.prepare("UPDATE app_user SET password_hash = ? WHERE login = 'rh'").run(await hashPassword(PASSWORD));
});
afterAll(() => db.close());
beforeEach(() => {
  resetRateLimits();
  (globalThis as { __paLoginGhosts?: Map<string, unknown> }).__paLoginGhosts?.clear();
  jar.cookies.clear();
  jar.headers = new Headers();
  getDb().sqlite.prepare("UPDATE app_user SET failed_attempts = 0, locked_until = NULL").run();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const fromIp = (ip: string) => {
  jar.headers = new Headers({ "x-forwarded-for": ip });
};
const reasons = () => auditOf(db.sqlite, "auth.login").map((a) => (a.detail ? JSON.parse(a.detail).reason : a.outcome));
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const isTooMany = (r: { ok: boolean; message?: string; error?: string }) => /^Trop de tentatives/.test(r.message ?? r.error ?? "");

describe("confiance accordée à X-Forwarded-For (TRUST_PROXY)", () => {
  it("sans TRUST_PROXY : aucune adresse fiable, l'en-tête est ignoré pour la limitation", () => {
    expect(trustedProxyHops()).toBe(0);
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("TRUST_PROXY=N : N-ième maillon depuis la droite, adresse IP valide exigée", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(trustedClientIp(h)).toBe("203.0.113.9");
    expect(clientIp(h)).toBe("203.0.113.9");
    vi.stubEnv("TRUST_PROXY", "2");
    expect(trustedClientIp(h)).toBe("6.6.6.6");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBeNull();
    vi.stubEnv("TRUST_PROXY", "true");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(trustedClientIp(new Headers({ "x-forwarded-for": "pas-une-ip" }))).toBeNull();
    expect(trustedClientIp(new Headers())).toBeNull();
    for (const v of ["abc", "-1", "0", "99", ""]) {
      vi.stubEnv("TRUST_PROXY", v);
      expect(trustedProxyHops()).toBe(0);
    }
  });
});

describe("connexion", () => {
  it("par IP fiable : 30 échecs puis refus, même avec le bon mot de passe ; une autre IP n'est pas bloquée", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    fromIp("203.0.113.5");
    for (let i = 0; i < RATE_RULES.loginIp.limit; i++) expect((await login("mgr2", "faux")).ok).toBe(false);
    const blocked = await login("rh", PASSWORD);
    expect(blocked).toEqual({ ok: false, message: expect.stringMatching(/^Trop de tentatives\. Réessayez dans 1[45] minutes\.$/) });
    expect(reasons().at(-1)).toBe("limite_ip");
    expect(jar.cookies.size).toBe(0);
    fromIp("203.0.113.6");
    expect(await login("rh", PASSWORD)).toEqual({ ok: true });
  });

  it("IP non fiable (pas de TRUST_PROXY) : X-Forwarded-For falsifié sans effet, personne n'est bloqué par IP", async () => {
    fromIp("198.51.100.1");
    const before = reasons().length;
    for (let i = 0; i < RATE_RULES.loginIp.limit + 5; i++) expect(isTooMany(await login("mgr2", "faux"))).toBe(false);
    expect(reasons().slice(before)).not.toContain("limite_ip");
    expect(await login("rh", PASSWORD)).toEqual({ ok: true });
  });

  it("par compte : un identifiant inconnu se verrouille comme un compte réel (mêmes messages, même coût argon2)", async () => {
    const run = async (name: string) => {
      const out: string[] = [];
      for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
        const r = await login(name, "faux-mot-de-passe-1");
        out.push(r.ok ? "OK" : r.message);
      }
      return out;
    };
    const known = await run("mgr");
    const unknown = await run("fantome.inexistant");
    expect(unknown).toEqual(known);
    expect(unknown).toEqual([...Array(MAX_ATTEMPTS).fill(GENERIC), LOCKED]);
    vi.mocked(verifyPassword).mockClear();
    await login("autre.inconnu", "x");
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyPassword).mock.calls[0][0]).toMatch(/^\$argon2id\$/);
  });

  it("verrou d'un identifiant inconnu : levé après le délai puis progressif, comme en base", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) await login("fantome.b", "x");
    expect(await login("fantome.b", "x")).toEqual({ ok: false, message: LOCKED });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    expect(await login("fantome.b", "x")).toEqual({ ok: false, message: GENERIC });
    expect(await login("fantome.b", "x")).toEqual({ ok: false, message: LOCKED });
  });
});

describe("activation", () => {
  it("par compte (jeton) : 10 échecs puis refus audité, sans toucher à la base ; un autre compte n'est pas affecté", async () => {
    const token = randomToken();
    for (let i = 0; i < RATE_RULES.activationAccount.limit; i++) {
      expect(await activateWithRateLimit(token, "MotDePasse2026")).toMatchObject({ ok: false, error: expect.stringMatching(/invalide/) });
    }
    expect(isTooMany(await activateWithRateLimit(token, "MotDePasse2026"))).toBe(true);
    const last = auditOf(db.sqlite, "user.activate").at(-1)!;
    expect([last.outcome, JSON.parse(last.detail!).reason]).toEqual(["REFUSE", "limite"]);
    const { token: good } = createActivationToken(w.ctx.admin, w.users.orphan);
    expect(await activateWithRateLimit(good, "MotDePasse2026")).toEqual({ ok: true, login: "orphan" });
  });

  it("par IP fiable : 20 jetons invalides puis refus, y compris d'un jeton valide ; une autre IP active normalement", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    fromIp("203.0.113.7");
    for (let i = 0; i < RATE_RULES.activationIp.limit; i++) expect((await activateWithRateLimit(randomToken(), "MotDePasse2026")).ok).toBe(false);
    const { token } = createActivationToken(w.ctx.admin, w.users.sub);
    expect(isTooMany(await activateWithRateLimit(token, "MotDePasse2026"))).toBe(true);
    fromIp("203.0.113.8");
    expect(await activateWithRateLimit(token, "MotDePasse2026")).toEqual({ ok: true, login: "sub" });
  });
});

describe("mémoire bornée", () => {
  it("saturation par des clés inventées : taille plafonnée, limitation toujours appliquée aux nouvelles clés", () => {
    const rule = { limit: 2, windowMs: 60_000 };
    for (let i = 0; i < 10_050; i++) recordFailure(`flood:${i}`, rule);
    const store = (globalThis as { __paRateLimit?: Map<string, unknown> }).__paRateLimit!;
    expect(store.size).toBeLessThanOrEqual(10_000);
    recordFailure("cible", rule);
    expect(retryAfter("cible", rule)).toBe(0);
    recordFailure("cible", rule);
    expect(retryAfter("cible", rule)).toBeGreaterThan(0);
  });
});

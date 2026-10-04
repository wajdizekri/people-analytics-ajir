import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type CookieOpts = { httpOnly?: boolean; sameSite?: string; secure?: boolean; path?: string; expires?: Date };
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
import { login, MAX_ATTEMPTS } from "@/lib/auth/login";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import {
  clientIp,
  createSession,
  destroySession,
  hashToken,
  readSession,
  revokeOtherSessions,
  revokeUserSessions,
  SESSION_COOKIE,
} from "@/lib/auth/session";
import { auditOf, buildWorld, openDalDb } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
const PASSWORD = "BonMotDePasse2026";

beforeAll(async () => {
  db = openDalDb("auth-session");
  w = buildWorld(db.sqlite);
  getDb().sqlite.prepare("UPDATE app_user SET password_hash = ?").run(await hashPassword(PASSWORD));
});
afterAll(() => db.close());
beforeEach(() => {
  jar.cookies.clear();
  jar.headers = new Headers();
});

const sqlite = () => getDb().sqlite;
const sessions = (userId: number) => sqlite().prepare("SELECT id, ip, user_agent AS ua, expires_at AS exp FROM session WHERE user_id = ? ORDER BY created_at").all(userId) as { id: string; ip: string; ua: string; exp: string }[];
const reasons = () => auditOf(db.sqlite, "auth.login").map((a) => (a.detail ? JSON.parse(a.detail).reason : a.outcome));

describe("sessions opaques", () => {
  it("création : seul le SHA-256 du jeton est stocké ; cookie httpOnly, sameSite lax, expiration à 10 h ; IP et agent tronqué", async () => {
    jar.headers = new Headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1", "user-agent": "A".repeat(300) });
    await createSession(w.users.rh);
    const c = jar.cookies.get(SESSION_COOKIE)!;
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.opts).toMatchObject({ httpOnly: true, sameSite: "lax", secure: false, path: "/" });
    const [s] = sessions(w.users.rh);
    expect(s.id).toBe(hashToken(c.value));
    expect(s.id).not.toContain(c.value);
    expect(s.ip).toBe("203.0.113.9");
    expect(s.ua).toHaveLength(200);
    const hours = (Date.parse(s.exp) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(9.9);
    expect(hours).toBeLessThanOrEqual(10);
    expect(c.opts!.expires!.toISOString()).toBe(s.exp);
    expect(await readSession()).toEqual({ userId: w.users.rh, login: "rh", role: "RH", employeeId: null });
  });

  it("cookie sécurisé en production, sauf dérogation explicite", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await createSession(w.users.mgr);
      expect(jar.cookies.get(SESSION_COOKIE)!.opts!.secure).toBe(true);
      vi.stubEnv("INSECURE_COOKIES", "1");
      await createSession(w.users.mgr);
      expect(jar.cookies.get(SESSION_COOKIE)!.opts!.secure).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lecture refusée : sans cookie, jeton inconnu, session expirée, compte désactivé", async () => {
    expect(await readSession()).toBeNull();
    jar.cookies.set(SESSION_COOKIE, { value: "jeton-forge" });
    expect(await readSession()).toBeNull();

    await createSession(w.users.mgr2);
    const token = jar.cookies.get(SESSION_COOKIE)!.value;
    expect((await readSession())?.userId).toBe(w.users.mgr2);
    sqlite().prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), hashToken(token));
    expect(await readSession()).toBeNull();

    await createSession(w.users.sub);
    expect((await readSession())?.employeeId).toBe(w.e.SUB);
    sqlite().prepare("UPDATE app_user SET active = 0 WHERE id = ?").run(w.users.sub);
    expect(await readSession()).toBeNull();
    sqlite().prepare("UPDATE app_user SET active = 1 WHERE id = ?").run(w.users.sub);
  });

  it("déconnexion : ligne supprimée et cookie effacé ; sans cookie : rien à supprimer", async () => {
    await createSession(w.users.admin);
    const token = jar.cookies.get(SESSION_COOKIE)!.value;
    await destroySession();
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(sqlite().prepare("SELECT 1 FROM session WHERE id = ?").get(hashToken(token))).toBeUndefined();
    const before = sqlite().prepare("SELECT COUNT(*) AS n FROM session").get();
    await destroySession();
    expect(sqlite().prepare("SELECT COUNT(*) AS n FROM session").get()).toEqual(before);
  });

  it("révocation : toutes les sessions d'un compte, ou toutes sauf la courante", async () => {
    await createSession(w.users.mgr);
    await createSession(w.users.mgr);
    await createSession(w.users.mgr);
    const current = hashToken(jar.cookies.get(SESSION_COOKIE)!.value);
    const n = sessions(w.users.mgr).length;
    expect(await revokeOtherSessions(w.users.mgr)).toBe(n - 1);
    expect(sessions(w.users.mgr).map((s) => s.id)).toEqual([current]);
    expect((await readSession())?.userId).toBe(w.users.mgr);
    jar.cookies.clear();
    await createSession(w.users.rh);
    jar.cookies.clear();
    const nRh = sessions(w.users.rh).length;
    expect(nRh).toBeGreaterThan(0);
    expect(await revokeOtherSessions(w.users.rh)).toBe(nRh);
    expect(sessions(w.users.rh)).toEqual([]);
    revokeUserSessions(w.users.mgr);
    expect(sessions(w.users.mgr)).toEqual([]);
  });

  it("adresse IP : premier maillon de x-forwarded-for, sinon x-real-ip, sinon « local »", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": " ", "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("connexion", () => {
  it("compte inconnu, inactif ou sans mot de passe : message générique identique, refus audité sans identifiant utilisateur", async () => {
    const generic = { ok: false, message: "Identifiant ou mot de passe incorrect. Vérifiez votre saisie, majuscules comprises, puis réessayez." };
    expect(await login("personne", PASSWORD)).toEqual(generic);
    sqlite().prepare("UPDATE app_user SET active = 0 WHERE id = ?").run(w.users.mgr2);
    expect(await login("mgr2", PASSWORD)).toEqual(generic);
    sqlite().prepare("UPDATE app_user SET active = 1, password_hash = NULL WHERE id = ?").run(w.users.orphan);
    expect(await login("orphan", PASSWORD)).toEqual(generic);
    expect(await login("mgr", "mauvais")).toEqual(generic);
    const refusals = auditOf(db.sqlite, "auth.login").slice(-4);
    expect(refusals.map((a) => [a.userId, JSON.parse(a.detail!).reason])).toEqual([
      [null, "inconnu_ou_inactif"],
      [null, "inconnu_ou_inactif"],
      [null, "inconnu_ou_inactif"],
      [w.users.mgr, "mot_de_passe"],
    ]);
    expect(refusals[0].targetId).toBe("personne");
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("succès : session ouverte (cookie lisible), compteur remis à zéro, audit OK", async () => {
    sqlite().prepare("UPDATE app_user SET failed_attempts = 3 WHERE id = ?").run(w.users.rh);
    expect(await login("rh", PASSWORD)).toEqual({ ok: true });
    expect(await readSession()).toMatchObject({ userId: w.users.rh, role: "RH" });
    expect(sqlite().prepare("SELECT failed_attempts AS n FROM app_user WHERE id = ?").get(w.users.rh)).toEqual({ n: 0 });
    expect(reasons().at(-1)).toBe("OK");
  });

  it("verrouillage progressif : 1 min au seuil, doublé à chaque échec suivant, plafonné à 64 min", async () => {
    const lockMinutes = () => {
      const r = sqlite().prepare("SELECT locked_until AS l FROM app_user WHERE id = ?").get(w.users.sub) as { l: string | null };
      return r.l ? Math.round((Date.parse(r.l) - Date.now()) / 60_000) : null;
    };
    const setAttempts = (n: number) => sqlite().prepare("UPDATE app_user SET failed_attempts = ?, locked_until = NULL WHERE id = ?").run(n, w.users.sub);
    setAttempts(MAX_ATTEMPTS - 2);
    await login("sub", "faux");
    expect(lockMinutes()).toBeNull();
    await login("sub", "faux");
    expect(lockMinutes()).toBe(1);
    setAttempts(MAX_ATTEMPTS + 1);
    await login("sub", "faux");
    expect(lockMinutes()).toBe(4);
    setAttempts(40);
    await login("sub", "faux");
    expect(lockMinutes()).toBe(64);
    expect(await login("sub", PASSWORD)).toEqual({ ok: false, message: "Compte temporairement verrouillé après plusieurs essais infructueux. Réessayez dans quelques minutes ou demandez à l'administrateur de le déverrouiller." });
    expect(reasons().at(-1)).toBe("verrouille");
  });
});

describe("mots de passe", () => {
  it("argon2id : vérification, empreinte malformée = refus sans exception ; politique de complexité", async () => {
    const h = await hashPassword("Abcdefghij1");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, "Abcdefghij1")).toBe(true);
    expect(await verifyPassword(h, "abcdefghij1")).toBe(false);
    expect(await verifyPassword("pas-une-empreinte", "x")).toBe(false);
    expect(passwordPolicyError("Court1")).toMatch(/10 caractères/);
    expect(passwordPolicyError("abcdefghijk")).toMatch(/lettres et des chiffres/);
    expect(passwordPolicyError("12345678901")).toMatch(/lettres et des chiffres/);
    expect(passwordPolicyError("abcdefghij1")).toBeNull();
  });
});

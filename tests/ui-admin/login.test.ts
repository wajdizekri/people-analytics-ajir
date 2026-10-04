import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { auditRows, setupDb, teardownDb } from "./helpers";

const sessions = vi.hoisted(() => ({ created: [] as number[] }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  createSession: async (userId: number) => {
    sessions.created.push(userId);
  },
}));

import { login, MAX_ATTEMPTS } from "@/lib/auth/login";

let fx: ReturnType<typeof setupDb>;
beforeAll(async () => {
  fx = setupDb("login");
  getDb().sqlite.prepare("UPDATE app_user SET password_hash = ? WHERE id = ?").run(await hashPassword("BonMotDePasse2026"), fx.users.rh);
});
afterAll(() => teardownDb(fx.file));

const state = () =>
  getDb().sqlite.prepare("SELECT failed_attempts AS n, locked_until AS lock FROM app_user WHERE id = ?").get(fx.users.rh) as { n: number; lock: string | null };
const reasons = () => auditRows("auth.login").map((r) => (r.detail_json ? (JSON.parse(r.detail_json) as { reason?: string }).reason : r.outcome));

describe("verrouillage anti force brute", () => {
  it("des tentatives parallèles ne dépassent pas le seuil avant verrouillage", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => login("rh", "mauvais-mot-de-passe")));
    expect(results.every((r) => !r.ok)).toBe(true);
    const r = reasons();
    expect(r.filter((x) => x === "mot_de_passe")).toHaveLength(MAX_ATTEMPTS);
    expect(r.filter((x) => x === "verrouille")).toHaveLength(20 - MAX_ATTEMPTS);
    const s = state();
    expect(s.n).toBe(MAX_ATTEMPTS);
    expect(s.lock! > new Date().toISOString()).toBe(true);
    expect(await login("rh", "BonMotDePasse2026")).toEqual({ ok: false, message: "Compte temporairement verrouillé après plusieurs essais infructueux. Réessayez dans quelques minutes ou demandez à l'administrateur de le déverrouiller." });
    expect(sessions.created).toEqual([]);
  });

  it("verrou expiré : un bon mot de passe ouvre la session et remet le compteur à zéro", async () => {
    getDb().sqlite.prepare("UPDATE app_user SET locked_until = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), fx.users.rh);
    expect(await login("rh", "BonMotDePasse2026")).toEqual({ ok: true });
    expect(sessions.created).toEqual([fx.users.rh]);
    expect(state()).toEqual({ n: 0, lock: null });
  });
});

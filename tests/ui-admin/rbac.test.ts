import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";
import { homePath } from "@/lib/dal/context";
import { employeeListSchema, getEmployeeDetail, listEmployees } from "@/lib/dal/employees";
import { dashboardQuerySchema, getDashboard } from "@/lib/dal/dashboard";
import { absenteeismQuerySchema, getAbsenteeism } from "@/lib/dal/absenteeism";
import { listRecommendations, recommendationListSchema } from "@/lib/dal/recommendations";
import { runWhatIf } from "@/lib/dal/whatif";
import { getBacktest } from "@/lib/dal/backtest";
import { getAdminOverview } from "@/lib/dal/admin";
import { changeOwnPassword, getAccount } from "@/lib/dal/account";
import { auditRows, setupDb, teardownDb } from "./helpers";

const TOKEN = "jeton-session-courante";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "pa_session" ? { value: TOKEN } : undefined) }),
  headers: async () => new Headers(),
}));

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("rbac");
});
afterAll(() => teardownDb(fx.file));

const refusedBy = (action: string, userId: number) => auditRows(action).filter((r) => r.outcome === "REFUSE" && r.user_id === userId).length;

describe("séparation des tâches : l'ADMIN ne voit aucune donnée RH", () => {
  it("pilotage, fiches, recommandations, what-if et backtesting : 403 audité", () => {
    const a = fx.ctx.admin;
    const cases: [string, () => unknown][] = [
      ["employee.list", () => listEmployees(a, employeeListSchema.parse({}))],
      ["dashboard.view", () => getDashboard(a, dashboardQuerySchema.parse({}))],
      ["absenteeism.view", () => getAbsenteeism(a, absenteeismQuerySchema.parse({}))],
      ["employee.view", () => getEmployeeDetail(a, fx.emp.E1, { source: "page" })],
      ["recommendation.list", () => listRecommendations(a, recommendationListSchema.parse({}))],
      ["whatif.run", () => runWhatIf(a, fx.emp.E1, {}, { source: "api" })],
      ["backtest.view", () => getBacktest(a, {}, { source: "page" })],
    ];
    for (const [action, call] of cases) {
      expect(call, action).toThrowError(expect.objectContaining({ status: 403 }));
      expect(refusedBy(action, fx.users.admin), action).toBe(1);
    }
  });

  it("RH et MANAGER gardent le pilotage", () => {
    expect(() => listEmployees(fx.ctx.rh, employeeListSchema.parse({}))).not.toThrow();
    expect(() => listEmployees(fx.ctx.mgr, employeeListSchema.parse({}))).not.toThrow();
    expect(() => getEmployeeDetail(fx.ctx.rh, fx.emp.E1, { source: "page" })).not.toThrow();
  });

  it("console d'administration réservée à l'ADMIN", () => {
    const o = getAdminOverview(fx.ctx.admin);
    expect(o.accounts.active).toEqual({ ADMIN: 1, RH: 1, MANAGER: 2 });
    expect(o.recentRefusals.length).toBeGreaterThan(0);
    expect(() => getAdminOverview(fx.ctx.rh)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(refusedBy("admin.overview", fx.users.rh)).toBe(1);
  });

  it("page d'accueil par rôle", () => {
    expect(homePath("ADMIN")).toBe("/admin");
    expect(homePath("RH")).toBe("/dashboard");
    expect(homePath("MANAGER")).toBe("/dashboard");
  });
});

describe("Mon compte (commun aux trois rôles)", () => {
  it("profil et périmètre selon le rôle", () => {
    expect(getAccount(fx.ctx.mgr)).toMatchObject({ login: "mgr", role: "MANAGER", teamSize: 4, employee: { matricule: "MGR" } });
    expect(getAccount(fx.ctx.admin)).toMatchObject({ role: "ADMIN", teamSize: null, employee: null });
  });

  it("changement de mot de passe : contrôle de l'actuel, politique, autres sessions fermées", async () => {
    const { sqlite } = getDb();
    const id = fx.users.rh;
    sqlite.prepare("UPDATE app_user SET password_hash = ? WHERE id = ?").run(await hashPassword("Ancien2026pass"), id);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const addSession = sqlite.prepare("INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)");
    addSession.run(hashToken(TOKEN), id, future);
    addSession.run(hashToken("autre-poste"), id, future);

    expect(await changeOwnPassword(fx.ctx.rh, { current: "faux", password: "Nouveau2026pass", confirm: "Nouveau2026pass" })).toEqual({
      ok: false,
      error: "Mot de passe actuel incorrect.",
    });
    expect(auditRows("user.password_change").at(-1)?.outcome).toBe("ECHEC");
    expect(await changeOwnPassword(fx.ctx.rh, { current: "Ancien2026pass", password: "court", confirm: "court" })).toMatchObject({ ok: false });
    expect(await changeOwnPassword(fx.ctx.rh, { current: "Ancien2026pass", password: "Nouveau2026pass", confirm: "autre" })).toMatchObject({ ok: false });

    expect(await changeOwnPassword(fx.ctx.rh, { current: "Ancien2026pass", password: "Nouveau2026pass", confirm: "Nouveau2026pass" })).toEqual({ ok: true, revoked: 1 });
    const { password_hash } = sqlite.prepare("SELECT password_hash FROM app_user WHERE id = ?").get(id) as { password_hash: string };
    expect(await verifyPassword(password_hash, "Nouveau2026pass")).toBe(true);
    const sessions = sqlite.prepare("SELECT id FROM session WHERE user_id = ?").all(id) as { id: string }[];
    expect(sessions.map((s) => s.id)).toEqual([hashToken(TOKEN)]);
    expect(auditRows("user.password_change").at(-1)?.outcome).toBe("OK");
  });
});

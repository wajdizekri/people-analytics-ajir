import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import {
  activateAccount,
  checkActivationToken,
  createActivationToken,
  createUser,
  getAdminSettingsExtras,
  listAudit,
  setUserActive,
  settingsSchema,
  updateSettings,
} from "@/lib/dal/admin";
import { hashToken } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getSetting } from "@/lib/settings";
import { auditRows, setupDb, teardownDb } from "./helpers";

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("admin");
});
afterAll(() => teardownDb(fx.file));

const valid = {
  capacity_rate: "0,02",
  medium_lift: "2",
  quality_threshold: "0.95",
  smig_monthly: "528.320",
  bradford_threshold: "250",
  min_events_for_model: "30",
  indicative_until_events: "150",
  abs_reco_seuil_niveau: "0.5",
  abs_reco_seuil_hausse: "0.25",
  abs_reco_ecart_min: "0.002",
  abs_reco_anomalies_min: "2",
  workload_ot_threshold_h: "20",
  workload_ot_months: "3",
  retention_inbox_days: "90",
  retention_prediction_months: "24",
};

describe("validation des paramètres", () => {
  it("accepte des valeurs dans les bornes (virgule décimale comprise)", () => {
    const r = settingsSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data?.capacity_rate).toBe(0.02);
  });

  it.each([
    ["capacity_rate", "0.5"],
    ["capacity_rate", "0"],
    ["medium_lift", "0.5"],
    ["quality_threshold", "1.2"],
    ["smig_monthly", "abc"],
    ["bradford_threshold", "12.5"],
    ["bradford_threshold", ""],
    ["workload_ot_months", "13"],
    ["retention_inbox_days", "2.5"],
    ["abs_reco_ecart_min", "0.2"],
  ])("refuse %s = %j", (key, value) => {
    const r = settingsSchema.safeParse({ ...valid, [key]: value });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path[0]).toBe(key);
  });

  it("seul l'ADMIN modifie ; la modification est enregistrée et auditée", () => {
    expect(() => updateSettings(fx.ctx.rh, { ...valid, capacity_rate: "0.03" })).toThrowError(expect.objectContaining({ status: 403 }));
    expect(auditRows("settings.update").at(-1)?.outcome).toBe("REFUSE");
    expect(() => updateSettings(fx.ctx.admin, { ...valid, capacity_rate: "0.9" })).toThrowError(ZodError);
    const { changed } = updateSettings(fx.ctx.admin, { ...valid, capacity_rate: "0.03", bradford_threshold: "300" });
    expect(changed.sort()).toEqual(["bradford_threshold", "capacity_rate"]);
    expect(getSetting(getDb().sqlite, "capacity_rate")).toBe("0.03");
    const detail = JSON.parse(auditRows("settings.update").at(-1)?.detail_json ?? "{}");
    expect(detail.changes.capacity_rate).toEqual({ from: "0.02", to: "0.03" });
  });

  it("seuil « indicative » au moins égal au seuil du modèle statistique", () => {
    const r = settingsSchema.safeParse({ ...valid, min_events_for_model: "50", indicative_until_events: "40" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toEqual(["indicative_until_events"]);
  });

  it("barème SMIG daté : validé, trié, enregistré et audité ; erreurs rattachées au bloc", () => {
    const base = { ...valid, capacity_rate: "0.03", bradford_threshold: "300" };
    const bad = () => updateSettings(fx.ctx.admin, { ...base, smig_schedule: JSON.stringify([{ from: null, value: 528.32 }, { from: null, value: 600 }]) });
    expect(bad).toThrowError(ZodError);
    try {
      bad();
    } catch (e) {
      expect((e as ZodError).issues[0].path[0]).toBe("smig_schedule");
    }
    expect(() => updateSettings(fx.ctx.admin, { ...base, smig_schedule: "pas du JSON" })).toThrowError(ZodError);
    const schedule = [
      { from: "2027-01-01", value: 580 },
      { from: "", value: 528.32 },
    ];
    const { changed } = updateSettings(fx.ctx.admin, { ...base, smig_schedule: JSON.stringify(schedule) });
    expect(changed).toEqual(["smig_schedule"]);
    expect(JSON.parse(getSetting(getDb().sqlite, "smig_schedule"))).toEqual([
      { from: null, value: 528.32 },
      { from: "2027-01-01", value: 580 },
    ]);
    expect(getAdminSettingsExtras(fx.ctx.admin).smig).toMatchObject({ valid: true, periods: [{ from: null, value: 528.32 }, { from: "2027-01-01", value: 580 }] });
    expect(updateSettings(fx.ctx.admin, { ...base, smig_schedule: JSON.stringify(schedule) }).changed).toEqual([]);
  });

  it("budgets de masse salariale : ajout, modification, suppression ; années uniques ; RH refusée", () => {
    const base = { ...valid, capacity_rate: "0.03", bradford_threshold: "300" };
    expect(() => getAdminSettingsExtras(fx.ctx.rh)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => updateSettings(fx.ctx.admin, { ...base, budgets: JSON.stringify([{ year: 2027, amount: 1e6 }, { year: 2027, amount: 2e6 }]) })).toThrowError(ZodError);
    expect(() => updateSettings(fx.ctx.admin, { ...base, budgets: JSON.stringify([{ year: 1999, amount: 1e6 }]) })).toThrowError(ZodError);
    let r = updateSettings(fx.ctx.admin, { ...base, budgets: JSON.stringify([{ year: 2027, amount: 1_200_000 }, { year: 2026, amount: 1_100_000 }]) });
    expect(r.changed.sort()).toEqual(["budget_masse_salariale_2026", "budget_masse_salariale_2027"]);
    expect(getAdminSettingsExtras(fx.ctx.admin).budgets.rows).toEqual([
      { year: 2026, amount: 1_100_000 },
      { year: 2027, amount: 1_200_000 },
    ]);
    r = updateSettings(fx.ctx.admin, { ...base, budgets: JSON.stringify([{ year: 2027, amount: 1_250_000 }]) });
    expect(r.changed.sort()).toEqual(["budget_masse_salariale_2026", "budget_masse_salariale_2027"]);
    expect(getAdminSettingsExtras(fx.ctx.admin).budgets.rows).toEqual([{ year: 2027, amount: 1_250_000 }]);
    const detail = JSON.parse(auditRows("settings.update").at(-1)?.detail_json ?? "{}");
    expect(detail.changes.budget_masse_salariale_2026).toEqual({ from: "1100000", to: null });
  });
});

describe("lien d'activation", () => {
  it("jeton aléatoire stocké en SHA-256, usage unique", async () => {
    const u = createUser(fx.ctx.admin, { login: "Nouveau.Manager", role: "MANAGER", matricule: "SUB" });
    expect(u.login).toBe("nouveau.manager");
    expect(u.hasPassword).toBe(false);
    const { token, expiresAt } = createActivationToken(fx.ctx.admin, u.id);
    const stored = getDb().sqlite.prepare("SELECT activation_token_hash FROM app_user WHERE id = ?").get(u.id) as { activation_token_hash: string };
    expect(stored.activation_token_hash).toBe(hashToken(token));
    expect(stored.activation_token_hash).not.toContain(token);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    expect(await activateAccount(token, "court1")).toEqual({ ok: false, error: expect.stringContaining("10 caractères") });
    expect(checkActivationToken(token)).toEqual({ login: "nouveau.manager" });

    expect(await activateAccount(token, "MotDePasse2026")).toEqual({ ok: true, login: "nouveau.manager" });
    const row = getDb().sqlite.prepare("SELECT password_hash, activation_token_hash FROM app_user WHERE id = ?").get(u.id) as {
      password_hash: string;
      activation_token_hash: string | null;
    };
    expect(row.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(row.password_hash, "MotDePasse2026")).toBe(true);
    expect(row.activation_token_hash).toBeNull();

    expect((await activateAccount(token, "AutreMotDePasse99")).ok).toBe(false);
    expect(checkActivationToken(token)).toBeNull();
    expect(auditRows("user.activate").map((r) => r.outcome)).toEqual(["OK", "REFUSE"]);
  });

  it("jeton expiré refusé", async () => {
    const u = createUser(fx.ctx.admin, { login: "expire", role: "RH" });
    const { token } = createActivationToken(fx.ctx.admin, u.id);
    getDb().sqlite.prepare("UPDATE app_user SET activation_expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), u.id);
    expect(checkActivationToken(token)).toBeNull();
    expect((await activateAccount(token, "MotDePasse2026")).ok).toBe(false);
  });

  it("un nouveau lien invalide le précédent ; jeton malformé refusé", async () => {
    const u = createUser(fx.ctx.admin, { login: "double", role: "RH", email: "double@ajir.tn" });
    const first = createActivationToken(fx.ctx.admin, u.id).token;
    const second = createActivationToken(fx.ctx.admin, u.id).token;
    expect(checkActivationToken(first)).toBeNull();
    expect(checkActivationToken(second)).toEqual({ login: "double" });
    expect((await activateAccount("../../etc", "MotDePasse2026")).ok).toBe(false);
  });

  it("RH ne peut pas générer de lien", () => {
    expect(() => createActivationToken(fx.ctx.rh, fx.users.mgr)).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

describe("gestion des comptes", () => {
  it("un manager doit être lié à un salarié existant", () => {
    expect(() => createUser(fx.ctx.admin, { login: "sanslien", role: "MANAGER" })).toThrowError(ZodError);
    expect(() => createUser(fx.ctx.admin, { login: "inconnu", role: "MANAGER", matricule: "X999" })).toThrowError(
      expect.objectContaining({ status: 422 }),
    );
    expect(() => createUser(fx.ctx.admin, { login: "admin", role: "RH" })).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("la désactivation révoque les sessions et le lien ; pas d'auto-désactivation", () => {
    const { sqlite } = getDb();
    sqlite.prepare("INSERT INTO session (id, user_id, expires_at) VALUES ('s1', ?, '2999-01-01')").run(fx.users.mgr2);
    createActivationToken(fx.ctx.admin, fx.users.mgr2);
    const u = setUserActive(fx.ctx.admin, fx.users.mgr2, false);
    expect(u.active).toBe(false);
    expect(u.activationExpiresAt).toBeNull();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE user_id = ?").get(fx.users.mgr2)).toEqual({ n: 0 });
    expect(() => setUserActive(fx.ctx.admin, fx.users.admin, false)).toThrowError(expect.objectContaining({ status: 409 }));
    expect(setUserActive(fx.ctx.admin, fx.users.mgr2, true).active).toBe(true);
  });

  it("journal filtrable et paginé, réservé à l'ADMIN", () => {
    const refused = listAudit(fx.ctx.admin, { outcome: "REFUSE" });
    expect(refused.rows.every((r) => r.outcome === "REFUSE")).toBe(true);
    expect(listAudit(fx.ctx.admin, { action: "user." }).rows.every((r) => r.action.startsWith("user."))).toBe(true);
    expect(listAudit(fx.ctx.admin, { user: "rh" }).rows.every((r) => r.login === "rh")).toBe(true);
    expect(listAudit(fx.ctx.admin, { from: "2999-01-01" }).total).toBe(0);
    expect(() => listAudit(fx.ctx.rh, {})).toThrowError(expect.objectContaining({ status: 403 }));
  });
});

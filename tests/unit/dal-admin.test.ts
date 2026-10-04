import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/auth/session";
import {
  activateAccount,
  AUDIT_PAGE_SIZE,
  checkActivationToken,
  createActivationToken,
  createUser,
  getAdminOverview,
  getAdminSettings,
  listAudit,
  listUsers,
  setUserActive,
  unlockUser,
  updateSettings,
} from "@/lib/dal/admin";
import { auditOf, buildWorld, expectHttp, openDalDb } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
beforeAll(() => {
  db = openDalDb("dal-admin");
  w = buildWorld(db.sqlite);
});
afterAll(() => db.close());

const sqlite = () => getDb().sqlite;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("création de comptes", () => {
  it("identifiant normalisé, e-mail vide ignoré, salarié lié ; audit user.create", () => {
    const u = createUser(w.ctx.admin, { login: "  Nouveau.RH ", role: "RH", matricule: "T4", email: "  " });
    expect(u).toMatchObject({ login: "nouveau.rh", role: "RH", email: null, active: true, hasPassword: false, employee: { id: w.e.T4, matricule: "T4", name: "PrenomT4 NomT4" } });
    expect(JSON.parse(auditOf(db.sqlite, "user.create").at(-1)!.detail!)).toEqual({ login: "nouveau.rh", role: "RH", employeeId: w.e.T4 });
  });

  it("refus : identifiant pris (409), matricule inconnu (422), manager lié à un salarié sorti (422), manager sans matricule, rôle inconnu", () => {
    expectHttp(() => createUser(w.ctx.admin, { login: " MGR2 ", role: "RH" }), 409, "LOGIN_EXISTANT");
    expectHttp(() => createUser(w.ctx.admin, { login: "fantome", role: "RH", matricule: "ZZZ" }), 422, "MATRICULE_INCONNU");
    expectHttp(() => createUser(w.ctx.admin, { login: "chef.sorti", role: "MANAGER", matricule: "T4" }), 422, "SALARIE_SORTI");
    expect(() => createUser(w.ctx.admin, { login: "chef", role: "MANAGER" })).toThrow(ZodError);
    expect(() => createUser(w.ctx.admin, { login: "x", role: "RH" })).toThrow(ZodError);
    expect(() => createUser(w.ctx.admin, { login: "root", role: "SUPERADMIN" as never })).toThrow(ZodError);
    expect(() => createUser(w.ctx.admin, { login: "mail", role: "RH", email: "pas-un-mail" })).toThrow(ZodError);
    expectHttp(() => createUser(w.ctx.rh, { login: "pirate", role: "ADMIN" }), 403);
    expect(auditOf(db.sqlite, "user.create").filter((a) => a.outcome === "REFUSE")).toHaveLength(1);
  });

  it("liste : verrou et lien d'activation expirés masqués, dernière connexion issue du journal", () => {
    sqlite().prepare("UPDATE app_user SET locked_until = ?, activation_expires_at = ?, activation_token_hash = 'h' WHERE login = 'mgr'").run(iso(-60_000), iso(-60_000));
    sqlite().prepare("UPDATE app_user SET locked_until = ?, failed_attempts = 6 WHERE login = 'mgr2'").run(iso(600_000));
    audit(w.users.mgr, "auth.login", { type: "user", id: w.users.mgr }, "OK");
    const users = listUsers(w.ctx.admin);
    const mgr = users.find((u) => u.login === "mgr")!;
    expect(mgr).toMatchObject({ lockedUntil: null, activationExpiresAt: null, employee: { matricule: "MGR" } });
    expect(mgr.lastLoginAt).toMatch(/^\d{4}-/);
    expect(users.find((u) => u.login === "mgr2")).toMatchObject({ failedAttempts: 6, lockedUntil: expect.any(String) });
    expect(users.find((u) => u.login === "orphan")!.employee).toBeNull();
    expectHttp(() => listUsers(w.ctx.mgr), 403);
  });
});

describe("activation, verrouillage, désactivation", () => {
  it("déverrouillage : compteur remis à zéro, audité ; 404 si inconnu ; RH refusé", () => {
    const u = unlockUser(w.ctx.admin, w.users.mgr2);
    expect(u).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    expect(sqlite().prepare("SELECT failed_attempts AS n, locked_until AS l FROM app_user WHERE id = ?").get(w.users.mgr2)).toEqual({ n: 0, l: null });
    expect(auditOf(db.sqlite, "user.unlock").at(-1)).toMatchObject({ outcome: "OK", targetId: String(w.users.mgr2) });
    expectHttp(() => unlockUser(w.ctx.admin, 999_999), 404);
    expectHttp(() => unlockUser(w.ctx.rh, w.users.mgr2), 403);
  });

  it("dernier administrateur actif protégé ; un administrateur déjà inactif peut être (re)désactivé ; réactivation", () => {
    const admin2 = Number(sqlite().prepare("INSERT INTO app_user (login, role, active) VALUES ('admin2', 'ADMIN', 1)").run().lastInsertRowid);
    sqlite().prepare("UPDATE app_user SET active = 0 WHERE id = ?").run(w.users.admin);
    try {
      expectHttp(() => setUserActive(w.ctx.admin, admin2, false), 409, "DERNIER_ADMIN");
    } finally {
      sqlite().prepare("UPDATE app_user SET active = 1 WHERE id = ?").run(w.users.admin);
    }
    expect(setUserActive(w.ctx.admin, admin2, false).active).toBe(false);
    expect(setUserActive(w.ctx.admin, admin2, false).active).toBe(false);
    expect(setUserActive(w.ctx.admin, admin2, true).active).toBe(true);
    expect(auditOf(db.sqlite, "user.reactivate").at(-1)).toMatchObject({ outcome: "OK", targetId: String(admin2) });
    expectHttp(() => setUserActive(w.ctx.admin, 999_999, false), 404);
    expectHttp(() => setUserActive(w.ctx.admin, w.users.admin, false), 409, "AUTO_DESACTIVATION");
  });

  it("lien d'activation : refusé pour un compte inactif ; mot de passe hors politique sans consommer le jeton", async () => {
    sqlite().prepare("UPDATE app_user SET active = 0 WHERE id = ?").run(w.users.sub);
    expectHttp(() => createActivationToken(w.ctx.admin, w.users.sub), 409, "COMPTE_INACTIF");
    sqlite().prepare("UPDATE app_user SET active = 1 WHERE id = ?").run(w.users.sub);
    const { token, login } = createActivationToken(w.ctx.admin, w.users.sub);
    expect(login).toBe("sub");
    expect(await activateAccount(token, "court")).toEqual({ ok: false, error: expect.stringMatching(/10 caractères/) });
    expect(await activateAccount(token, "seulementdeslettres")).toEqual({ ok: false, error: expect.stringMatching(/lettres et des chiffres/) });
    expect(checkActivationToken(token)).toEqual({ login: "sub" });
    sqlite().prepare("INSERT INTO session (id, user_id, expires_at) VALUES ('s-sub', ?, ?)").run(w.users.sub, iso(3600_000));
    expect(await activateAccount(token, "MotDePasse2026")).toEqual({ ok: true, login: "sub" });
    expect(sqlite().prepare("SELECT COUNT(*) AS n FROM session WHERE user_id = ?").get(w.users.sub)).toEqual({ n: 0 });
    expect(checkActivationToken(token)).toBeNull();
    expect(await activateAccount(token, "MotDePasse2026")).toMatchObject({ ok: false });
  });

  it("jeton consommé une seule fois même sur deux activations simultanées ; jeton mal formé refusé sans requête", async () => {
    const { token } = createActivationToken(w.ctx.admin, w.users.orphan);
    const results = await Promise.all([activateAccount(token, "PremierMdp2026"), activateAccount(token, "SecondMdp2026")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    const reasons = auditOf(db.sqlite, "user.activate").slice(-2).map((a) => (a.detail ? JSON.parse(a.detail).reason : a.outcome));
    expect(reasons.sort()).toEqual(["OK", "jeton_consomme"]);
    expect(checkActivationToken("trop-court")).toBeNull();
    expect(checkActivationToken(token.replace(/.$/, "!"))).toBeNull();
    expect(await activateAccount("", "MotDePasse2026")).toMatchObject({ ok: false });
    expect(JSON.parse(auditOf(db.sqlite, "user.activate").at(-1)!.detail!)).toEqual({ reason: "jeton_invalide" });
  });

  it("jeton valide mais compte désactivé entre-temps : refusé", async () => {
    const { token } = createActivationToken(w.ctx.admin, w.users.mgr2);
    sqlite().prepare("UPDATE app_user SET active = 0 WHERE id = ?").run(w.users.mgr2);
    expect(checkActivationToken(token)).toBeNull();
    expect(await activateAccount(token, "MotDePasse2026")).toMatchObject({ ok: false });
    sqlite().prepare("UPDATE app_user SET active = 1, activation_token_hash = ? WHERE id = ?").run(hashToken(token), w.users.mgr2);
    expect(checkActivationToken(token)).toEqual({ login: "mgr2" });
  });
});

describe("paramètres", () => {
  it("lecture : valeurs par défaut, bornes et auteur de la dernière modification ; RH refusé", () => {
    const s = getAdminSettings(w.ctx.admin);
    expect(s.map((x) => x.key)).toEqual(expect.arrayContaining(["capacity_rate", "medium_lift", "quality_threshold", "smig_monthly", "bradford_threshold", "min_events_for_model", "workload_ot_months", "retention_inbox_days"]));
    expect(s[0]).toMatchObject({ value: "0.02", min: 0.005, max: 0.2, updatedBy: null });
    expectHttp(() => getAdminSettings(w.ctx.rh), 403);
  });

  it("écriture : seules les valeurs changées sont enregistrées et auditées ; valeur manquante ou non entière refusée", () => {
    const base = {
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
    expect(updateSettings(w.ctx.admin, base)).toEqual({ changed: [] });
    expect(auditOf(db.sqlite, "settings.update")).toHaveLength(0);
    expect(updateSettings(w.ctx.admin, { ...base, medium_lift: " 2,5 ", bradford_threshold: 300 })).toEqual({ changed: ["medium_lift", "bradford_threshold"] });
    const detail = JSON.parse(auditOf(db.sqlite, "settings.update").at(-1)!.detail!);
    expect(detail).toEqual({ changes: { medium_lift: { from: "2", to: "2.5" }, bradford_threshold: { from: "250", to: "300" } } });
    expect(getAdminSettings(w.ctx.admin).find((x) => x.key === "medium_lift")).toMatchObject({ value: "2.5", updatedBy: "admin" });
    expect(() => updateSettings(w.ctx.admin, { ...base, bradford_threshold: "12.5" })).toThrow(ZodError);
    expect(() => updateSettings(w.ctx.admin, { ...base, smig_monthly: "" })).toThrow(ZodError);
    expect(() => updateSettings(w.ctx.admin, { ...base, capacity_rate: "abc" })).toThrow(ZodError);
  });
});

describe("console et journal", () => {
  it("vue d'ensemble : comptes, sessions ouvertes (hors expirées), refus récents formatés", () => {
    sqlite().prepare("INSERT INTO session (id, user_id, expires_at) VALUES ('s1', ?, ?), ('s2', ?, ?)").run(w.users.rh, iso(3600_000), w.users.rh, iso(-1000));
    sqlite().prepare("UPDATE app_user SET password_hash = NULL WHERE login = 'orphan'").run();
    sqlite().prepare("UPDATE app_user SET active = 0 WHERE login = 'mgr2'").run();
    sqlite().prepare("UPDATE app_user SET locked_until = ? WHERE login = 'mgr'").run(iso(600_000));
    audit(null, "auth.login", { type: "user", id: "inconnu" }, "REFUSE");
    audit(w.users.mgr, "employee.view", { type: "employee", id: 7 }, "REFUSE", undefined, "10.1.2.3");
    audit(w.users.mgr, "dashboard.view", { type: "dashboard" }, "REFUSE");
    audit(w.users.mgr, "recommendation.list", undefined, "REFUSE");
    const o = getAdminOverview(w.ctx.admin, 30);
    expect(o.accounts).toMatchObject({ inactive: 1, pendingActivation: 3, locked: 1, openSessions: 1 });
    expect(o.security.days).toBe(30);
    expect(o.security.failedLogins).toBeGreaterThanOrEqual(1);
    expect(o.recentRefusals.slice(0, 3).map((r) => [r.action, r.target, r.login])).toEqual([
      ["recommendation.list", null, "mgr"],
      ["dashboard.view", "dashboard", "mgr"],
      ["employee.view", "employee #7", "mgr"],
    ]);
    expect(o.recentRefusals.every((r) => r.action !== "auth.login")).toBe(true);
    expect(o.recentRefusals[2].ip).toBe("10.1.2.3");
  });

  it("journal : filtres cumulés, pagination, liste des actions ; détail tronqué", () => {
    for (let i = 0; i < AUDIT_PAGE_SIZE + 5; i++) audit(w.users.rh, "export.csv", { type: "export", id: i }, "OK", { i, pad: "x".repeat(500) });
    const p1 = listAudit(w.ctx.admin, { action: "export.", user: "rh" });
    expect(p1).toMatchObject({ total: AUDIT_PAGE_SIZE + 5, page: 1, pageSize: AUDIT_PAGE_SIZE });
    expect(p1.rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(p1.rows[0].detail).toHaveLength(400);
    const p2 = listAudit(w.ctx.admin, { action: "export.", user: "rh", page: "2" as never });
    expect(p2.rows).toHaveLength(5);
    expect(p2.rows.at(-1)!.targetId).toBe("0");
    const today = new Date().toISOString().slice(0, 10);
    expect(listAudit(w.ctx.admin, { action: "export.", from: today, to: today, outcome: "OK" }).total).toBe(AUDIT_PAGE_SIZE + 5);
    expect(listAudit(w.ctx.admin, { action: "export.", to: "2000-01-01" }).total).toBe(0);
    expect(listAudit(w.ctx.admin, { user: "", action: "", outcome: "" as never }).total).toBeGreaterThan(AUDIT_PAGE_SIZE);
    expect(listAudit(w.ctx.admin, {}).actions).toEqual(expect.arrayContaining(["auth.login", "export.csv", "user.create"]));
    expect(() => listAudit(w.ctx.admin, { from: "hier" })).toThrow(ZodError);
    expect(() => listAudit(w.ctx.admin, { outcome: "PEUT-ETRE" as never })).toThrow(ZodError);
  });
});

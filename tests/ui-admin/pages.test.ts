import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { updateSettings } from "@/lib/dal/admin";
import { describeAudit, actionLabel } from "@/components/admin/audit-labels";
import { SETTINGS_UI, formatSetting, toDisplay, toRaw } from "@/components/admin/settings-labels";
import { concernedLabel, proposedAction } from "@/app/(app)/alerts/labels";
import { setupDb, teardownDb } from "./helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("pages");
  const { sqlite } = getDb();
  const add = sqlite.prepare("INSERT INTO app_user (login, password_hash, role, created_at) VALUES (?, NULL, 'MANAGER', ?)");
  for (let i = 0; i < 30; i++) add.run(`mgr.lot${String(i).padStart(2, "0")}`, `2026-01-${String(1 + (i % 28)).padStart(2, "0")}T08:00:00.000Z`);
  sqlite.prepare("UPDATE app_user SET locked_until = '2999-01-01T00:00:00.000Z', failed_attempts = 5 WHERE login = 'mgr2'").run();
});
afterAll(() => teardownDb(fx.file));

const as = (who: "admin" | "rh" | "mgr") =>
  (session.current = { userId: fx.users[who], login: fx.ctx[who].login, role: fx.ctx[who].role, employeeId: fx.ctx[who].employeeId } as SessionUser);
// Texte visible, espaces (insécables compris) normalisés en espaces simples
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("journal d'audit en phrases", () => {
  const users = new Map([["1", "admin"], ["2", "rh.demo"]]);
  it("consultation, refus, connexion refusée et paramètres traduits", () => {
    expect(describeAudit({ action: "employee.view", outcome: "OK", login: "rh.demo", targetType: "employee", targetId: "24", detail: null }, users)).toBe(
      "rh.demo a ouvert la fiche du collaborateur n° 24.",
    );
    expect(describeAudit({ action: "access.page", outcome: "REFUSE", login: "mgr", targetType: "route", targetId: "/recommendations", detail: '{"required":["RH"]}' }, users)).toBe(
      "mgr a tenté d'ouvrir la page « Recommandations » (réservée au rôle responsable RH) : accès refusé.",
    );
    expect(describeAudit({ action: "auth.login", outcome: "REFUSE", login: null, targetType: "user", targetId: "inconnu", detail: '{"reason":"inconnu_ou_inactif"}' }, users)).toContain(
      "identifiant « inconnu » (identifiant inconnu ou compte désactivé)",
    );
    const s = describeAudit(
      { action: "settings.update", outcome: "OK", login: "admin", targetType: "settings", targetId: null, detail: '{"changes":{"capacity_rate":{"from":"0.02","to":"0.03"}}}' },
      users,
    );
    expect(s).toMatch(/^admin a modifié les paramètres \(Capacité mensuelle d'entretiens .* : 2 % → 3 %\)\.$/);
    expect(describeAudit({ action: "user.unlock", outcome: "OK", login: "admin", targetType: "user", targetId: "2", detail: null }, users)).toBe("admin a déverrouillé le compte rh.demo.");
    expect(describeAudit({ action: "auth.login", outcome: "OK", login: "rh.demo", targetType: null, targetId: null, detail: null }, users, true)).toBe("Vous vous êtes connecté.");
    expect(describeAudit({ action: "scoring.publish", outcome: "OK", login: null, targetType: "scoring_run", targetId: "73", detail: '{"asOf":"2026-08-31","nScored":987}' })).toBe(
      "Le système (tâche automatique) a publié le calcul des risques n° 73 (au 31/08/2026, 987 collaborateurs évalués).",
    );
    expect(actionLabel("employee.view")).toBe("Ouvrir la fiche du collaborateur");
  });
});

describe("paramètres : unités d'affichage", () => {
  it("pourcentages convertis sans erreur d'arrondi ; libellé et effet concret", () => {
    expect(toDisplay("capacity_rate", 0.29)).toBe(29);
    expect(toRaw("capacity_rate", 2.5)).toBe(0.025);
    expect(toRaw("abs_reco_ecart_min", 0.2)).toBe(0.002);
    expect(toDisplay("medium_lift", 2)).toBe(2);
    expect(formatSetting("quality_threshold", 0.95)).toBe("95 %");
    expect(SETTINGS_UI.capacity_rate.effect(0.02, { nScored: 987, asOf: "2026-08-31", lastQuality: null, values: {} })).toContain("≈ 20 classés Élevé sur 987 évalués");
    expect(SETTINGS_UI.quality_threshold.effect(0.95, { nScored: null, asOf: null, lastQuality: 0.981, values: {} })).toContain(": accepté");
  });
});

describe("alertes : action proposée en groupe nominal court", () => {
  it("selon le type, le statut et le rôle", () => {
    expect(proposedAction({ type: "TURNOVER", status: "NOUVELLE", employeeName: "A B", departmentName: null }, "RH")).toBe("Échange individuel avec le collaborateur");
    expect(proposedAction({ type: "ABSENTEISME", status: "EN_COURS", employeeName: null, departmentName: null }, "MANAGER")).toMatch(/votre équipe/);
    expect(proposedAction({ type: "DONNEES", status: "TRAITEE", employeeName: null, departmentName: null }, "ADMIN")).toMatch(/clôturée/);
    expect(concernedLabel({ type: "SYSTEME", employeeName: null, departmentName: null })).toBe("L'outil (alerte technique)");
  });
});

describe("rendu des pages d'administration", () => {
  it("utilisateurs : 25 comptes par page, compte verrouillé en tête, actions explicites ; RH redirigé", async () => {
    const Page = (await import("@/app/(app)/admin/users/page")).default;
    as("admin");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);
    const t = text(html);
    expect(t).toContain("Utilisateurs et accès");
    expect(t).toMatch(/1–25 sur 34/);
    expect(t).toContain("Page 1 sur 2");
    expect(t.indexOf("mgr2")).toBeLessThan(t.indexOf("mgr.lot"));
    expect(t).toContain("Déverrouiller mgr2");
    expect(t).toContain("Générer un lien d'activation");
    expect(t).toContain("Désactiver le compte mgr");
    expect(t).not.toContain("Désactiver le compte admin");
    as("rh");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/interdit");
  });

  it("paramètres : valeurs en %, valeur par défaut, effet concret, bouton unique", async () => {
    const { sqlite } = getDb();
    const current = Object.fromEntries((sqlite.prepare("SELECT key, value FROM app_setting").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    updateSettings(fx.ctx.admin, { ...current, capacity_rate: "0.03" } as never);
    const Page = (await import("@/app/(app)/admin/settings/page")).default;
    as("admin");
    const t = text(renderToStaticMarkup((await Page()) as ReactElement));
    for (const s of ["Classement des niveaux de risque", "Valeur par défaut : 2 %", "Effet :", "Aucune modification à enregistrer."]) expect(t).toContain(s);
    expect(t).toContain("Rétablir la valeur par défaut : Capacité mensuelle");
    expect(t).toContain("Valeurs possibles : 0 à 5 points");
    expect(t).toMatch(/Valeur par défaut : 2 % · Modifié le \d{2}\/\d{2}\/\d{4} par admin/);
    expect(t).toMatch(/Valeur par défaut : 2 fois · Jamais modifié/);
    expect((t.match(/Enregistrer les paramètres/g) ?? []).length).toBe(1);
  });

  it("journal : phrases, filtres par famille d'action, aucune donnée nominative", async () => {
    const Page = (await import("@/app/(app)/admin/audit/page")).default;
    as("admin");
    const t = text(renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ action: "settings." }) })) as ReactElement));
    expect(t).toContain("admin a modifié les paramètres (Capacité mensuelle");
    expect(t).toContain("Type d'action : Paramètres");
    expect(t).not.toMatch(/Nom (DG|MGR|E\d)/);
  });

  it("console : phrase d'état et tâches fréquentes", async () => {
    const Page = (await import("@/app/(app)/admin/page")).default;
    as("admin");
    const t = text(renderToStaticMarkup((await Page()) as ReactElement));
    expect(t).toMatch(/points? d'attention|Tout fonctionne normalement/);
    expect(t).toContain("Comptes verrouillés : 1");
    for (const s of ["Importer un export AJIR", "Créer un compte", "Traiter les alertes", "Consulter le journal d'audit"]) expect(t).toContain(s);
  });
});

describe("rendu de Mon compte et du détail d'alerte", () => {
  it("Mon compte (manager) : activité en phrases, rien de réservé à la RH", async () => {
    getDb().sqlite.prepare("INSERT INTO audit_log (at, user_id, action, outcome) VALUES (?, ?, 'auth.login', 'OK')").run(new Date().toISOString(), fx.users.mgr);
    const Page = (await import("@/app/(app)/compte/page")).default;
    as("mgr");
    const t = text(renderToStaticMarkup((await Page()) as ReactElement));
    expect(t).toContain("Vous vous êtes connecté.");
    expect(t).toContain("Accès protégé");
    expect(t).toContain("Mot de passe actuel");
    expect(t).not.toMatch(/Lift|TND|Masse salariale brute/);
  });

  it("détail d'alerte : boutons verbe + objet, action proposée ; hors périmètre redirigé", async () => {
    const { sqlite } = getDb();
    const add = (audience: string, employee: number | null) =>
      Number(
        sqlite
          .prepare("INSERT INTO alert (type, severity, status, audience, manager_id, employee_id, title, message, dedup_key, link) VALUES ('TURNOVER', 'ATTENTION', 'NOUVELLE', ?, ?, ?, 'Risque', 'msg', ?, ?)")
          .run(audience, fx.emp.SUB, employee, `p-${audience}-${employee}`, employee ? `/employees/${employee}` : null).lastInsertRowid,
      );
    const mine = add("MANAGER", fx.emp.E2);
    const other = add("RH", fx.emp.E1);
    const Page = (await import("@/app/(app)/alerts/[id]/page")).default;
    as("mgr");
    const t = text(renderToStaticMarkup((await Page({ params: Promise.resolve({ id: String(mine) }) })) as ReactElement));
    for (const s of ["Prendre en charge l'alerte", "Rejeter l'alerte", "Action proposée", "Échange individuel avec le collaborateur", "Voir la fiche de Test Nom E2", "Suivi de l'alerte"]) expect(t).toContain(s);
    await expect(Page({ params: Promise.resolve({ id: String(other) }) })).rejects.toThrow("REDIRECT:/interdit");
    await expect(Page({ params: Promise.resolve({ id: "999999" }) })).rejects.toThrow("NOT_FOUND");
  });
});

describe("tableaux d'administration : tri annoncé et filtres cohérents", () => {
  it("utilisateurs : tri par identifiant décroissant, en-tête aria-sort et lien d'inversion", async () => {
    const Page = (await import("@/app/(app)/admin/users/page")).default;
    as("admin");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ tri: "compte", ordre: "desc" }) })) as ReactElement);
    const t = text(html);
    expect(t).toContain("triés par identifiant (décroissant)");
    expect(t.indexOf("mgr2")).toBeLessThan(t.indexOf("mgr.lot29"));
    expect(t.indexOf("mgr.lot29")).toBeLessThan(t.indexOf("mgr.lot20"));
    expect(html).toMatch(/<th scope="col" aria-sort="descending"[^>]*><a href="\/admin\/users\?tri=compte&amp;ordre=asc"/);
    expect(html).toContain('aria-sort="none"');
    for (const s of ["Appliquer les filtres", "Tous les comptes"]) expect(t).toContain(s);
  });

  it("journal : libellés de filtres communs et période rapide signalée", async () => {
    const Page = (await import("@/app/(app)/admin/audit/page")).default;
    as("admin");
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Tunis" });
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({ from: today }) })) as ReactElement);
    const t = text(html);
    for (const s of ["Appliquer les filtres", "Réinitialiser les filtres"]) expect(t).toContain(s);
    expect(t).not.toContain("Filtrer le journal");
    expect(html).toMatch(/aria-current="true"[^>]*>.*Aujourd&#x27;hui/);
  });
});

describe("création de compte refusée : saisie conservée", () => {
  it("identifiant existant ou matricule inconnu : erreur sous le champ, valeurs renvoyées, jamais de mot de passe", async () => {
    const { createUserAction } = await import("@/app/(app)/admin/users/actions");
    as("admin");
    const form = (values: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(values)) f.set(k, v);
      return f;
    };
    const taken = await createUserAction({}, form({ login: "mgr2", role: "RH", matricule: "", email: "mgr2@example.test", password: "Secret2026xx" }));
    expect(taken).toEqual({
      fieldErrors: { login: "Cet identifiant est déjà utilisé. Choisissez-en un autre." },
      values: { login: "mgr2", role: "RH", matricule: "", email: "mgr2@example.test" },
    });
    expect(JSON.stringify(taken)).not.toContain("Secret2026xx");

    const unknown = await createUserAction({}, form({ login: "nouveau.mgr", role: "MANAGER", matricule: "M99999999", email: "" }));
    expect(unknown.error).toBeUndefined();
    expect(unknown.fieldErrors?.matricule).toMatch(/^Aucun collaborateur ne porte ce matricule/);
    expect(unknown.values).toMatchObject({ login: "nouveau.mgr", matricule: "M99999999" });
    expect(getDb().sqlite.prepare("SELECT 1 FROM app_user WHERE login = 'nouveau.mgr'").get()).toBeUndefined();
  });
});

describe("retours d'action : toasts", () => {
  it("announce : succès avec le message du serveur, erreur avec un titre court, rien sinon", async () => {
    const calls: [string, unknown][] = [];
    vi.resetModules();
    // announce délègue à toastResult, qui passe par l'objet `toast` du module : on espionne ses méthodes
    const { toast } = await import("@/components/ui/toast");
    const success = vi.spyOn(toast, "success").mockImplementation((m: unknown) => (calls.push(["success", m]), ""));
    const error = vi.spyOn(toast, "error").mockImplementation((m: unknown) => (calls.push(["error", m]), ""));
    const { announce } = await import("@/components/admin/notify");
    const ok = { ok: "Compte x créé." };
    expect(announce(ok, { error: "Compte non créé" })).toBe(ok);
    announce({ ok: true }, { success: "Alerte prise en charge.", error: "Alerte non mise à jour" });
    announce({ error: "Session expirée." }, { error: "Alerte non mise à jour" });
    announce({ commentError: "Trop court" }, { error: "Alerte non mise à jour" });
    announce({}, { error: "Rien" });
    expect(calls).toEqual([
      ["success", "Compte x créé."],
      ["success", "Alerte prise en charge."],
      ["error", "Alerte non mise à jour"],
      ["error", "Alerte non mise à jour"],
    ]);
    success.mockRestore();
    error.mockRestore();
  });
});

describe("Mon compte : préférences d'affichage", () => {
  it("choix du thème clair / sombre / système, au clavier (boutons radio)", async () => {
    const Page = (await import("@/app/(app)/compte/page")).default;
    as("rh");
    const html = renderToStaticMarkup((await Page()) as ReactElement);
    const t = text(html);
    for (const s of ["Affichage", "Thème", "Clair", "Sombre", "Système", "mémorisé sur cet appareil"]) expect(t, s).toContain(s);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
  });
});

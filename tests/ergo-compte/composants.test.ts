import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Rendu statique des écrans du domaine COMPTE (connexion, activation, mot de passe, administration des comptes)
// et des composants ux partagés. Les Server Actions sont simulées : seul le rendu est vérifié.
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));
vi.mock("@/app/activation/actions", () => ({ activateAction: async () => ({}) }));
vi.mock("@/app/(app)/compte/actions", () => ({ changePasswordAction: async () => ({}) }));
vi.mock("@/app/(app)/admin/users/actions", () => ({ activationLinkAction: async () => ({}), setActiveAction: async () => ({}), unlockAction: async () => ({}) }));

const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

const { PasswordField } = await import("@/components/auth/password-field");
const { newPasswordErrors } = await import("@/components/auth/password-rules");

describe("champ mot de passe", () => {
  it("le lien d'aide suit le champ dans l'ordre de tabulation, tout en restant affiché à droite du libellé", () => {
    const m = html(
      h(PasswordField, { id: "password", name: "password", label: "Mot de passe", autoComplete: "current-password", labelAside: h("a", { href: "#aide" }, "Mot de passe oublié ?") }),
    );
    expect(m.indexOf('id="password"')).toBeLessThan(m.indexOf('href="#aide"'));
    expect(m.indexOf("Afficher le mot de passe")).toBeLessThan(m.indexOf('href="#aide"'));
    expect(m).toMatch(/class="col-start-2 row-start-1"><a href="#aide"/);
  });

  it("erreur propre au champ : message sous le champ, relié et annoncé comme invalide", () => {
    const m = html(h(PasswordField, { id: "confirm", name: "confirm", label: "Confirmation", autoComplete: "new-password", describedBy: "confirm-help", error: "Les deux saisies sont différentes." }));
    expect(m).toContain('aria-invalid="true"');
    expect(m).toContain('aria-describedby="confirm-help confirm-erreur"');
    expect(m).toMatch(/id="confirm-erreur"[^>]*>.*Les deux saisies sont différentes\./);
    const ok = html(h(PasswordField, { id: "confirm", name: "confirm", label: "Confirmation", autoComplete: "new-password" }));
    expect(ok).not.toContain("aria-invalid");
    expect(ok).not.toContain("confirm-erreur");
  });

  it("règles du nouveau mot de passe : ce qui ne va pas et comment corriger", () => {
    expect(newPasswordErrors("", "")).toEqual({ password: "Saisissez un nouveau mot de passe.", confirm: "Saisissez de nouveau le mot de passe pour le confirmer." });
    expect(newPasswordErrors("abc12", "abc12").password).toBe("Mot de passe trop court : 10 caractères au moins (5 saisis).");
    expect(newPasswordErrors("abcdefghijk", "abcdefghijk").password).toMatch(/une lettre et un chiffre/);
    expect(newPasswordErrors("Abcdefghij2", "Abcdefghij3")).toEqual({ confirm: expect.stringMatching(/^Les deux saisies sont différentes/) });
    expect(newPasswordErrors("Abcdefghij2", "Abcdefghij2")).toEqual({});
  });
});

describe("formulaires de mot de passe", () => {
  it("activation : vérification avant envoi (pas de bulle native), règles visibles, libellés E2E inchangés", async () => {
    const { ActivationForm } = await import("@/app/activation/activation-form");
    const m = html(h(ActivationForm, { token: "t", login: "rh.demo" }));
    expect(m).toMatch(/novalidate/i);
    const t = text(m);
    for (const s of ["Nouveau mot de passe", "Confirmation du mot de passe", "Au moins 10 caractères", "Des lettres et des chiffres", "Définir le mot de passe"]) expect(t, s).toContain(s);
    expect(m).toMatch(/autocomplete="new-password"/i);
    expect(m).toMatch(/autocomplete="username"/i);
  });

  it("Mon compte : un bouton afficher / masquer par champ (comme la connexion), plus de case à cocher globale", async () => {
    const { PasswordForm } = await import("@/app/(app)/compte/password-form");
    const m = html(h(PasswordForm, { login: "rh.demo", otherSessions: 2 }));
    const t = text(m);
    for (const s of ["Mot de passe actuel", "Afficher le mot de passe actuel", "Afficher le nouveau mot de passe", "Afficher la confirmation du mot de passe", "Changer mon mot de passe"])
      expect(t, s).toContain(s);
    expect(t).not.toContain("Afficher les mots de passe saisis");
    expect(m).not.toContain('type="checkbox"');
    expect((m.match(/aria-pressed="false"/g) ?? []).length).toBe(3);
    expect(m).toMatch(/novalidate/i);
    expect(m).toMatch(/autocomplete="current-password"/i);
    expect(t).not.toContain("Confirmez que c'est bien vous");
    expect(t).toContain("2 autres sessions seront fermées");
  });
});

describe("administration des comptes", () => {
  it("même libellé « Générer un lien d'activation » avec ou sans mot de passe, nommé pour le compte", async () => {
    const { UserActions } = await import("@/components/admin/user-actions");
    const props = { id: 7, login: "mgr2", active: true, locked: false, failedAttempts: 0, isSelf: false };
    for (const hasPassword of [true, false]) {
      const t = text(html(h(UserActions, { ...props, hasPassword })));
      expect(t).toContain("Générer un lien d'activation pour mgr2");
      expect(t).not.toContain("Lien de nouveau mot de passe");
      expect(t).toContain("Désactiver le compte mgr2");
    }
  });
});

describe("composants ux partagés", () => {
  it("OnThisPage : même API, collant à partir de 1024 px, aucune section active avant défilement", async () => {
    const { OnThisPage } = await import("@/components/ux/on-this-page");
    const m = html(h(OnThisPage, { items: [{ id: "a", label: "Indicateurs" }, { id: "b", label: "Historique" }] }));
    expect(m).toContain('aria-label="Sur cette page"');
    expect(m).toContain('href="#a"');
    expect(m).toContain("lg:sticky");
    expect(m).toContain("aria-[current]:bg-primary-soft");
    expect(m).not.toContain("aria-current");
  });

  it("AutoRefresh : état annoncé, bouton Suspendre de 40 px, rien quand inactif", async () => {
    const { AutoRefresh } = await import("@/components/ux/auto-refresh");
    const m = html(h(AutoRefresh, { active: true, label: "Import en cours." }));
    expect(text(m)).toContain("Import en cours. Actualisation toutes les 5 s Suspendre l'actualisation");
    expect(m).toContain('aria-live="polite"');
    expect(m).toMatch(/<button[^>]*class="[^"]*min-h-10/);
    expect(html(h(AutoRefresh, { active: false, label: "x" }))).toBe("");
  });

  it("MobileCollapse : API et rendu inchangés (repli sous 640 px)", async () => {
    const { MobileCollapse } = await import("@/components/ux/mobile-collapse");
    const m = html(h(MobileCollapse, { label: "Filtres", count: 1 }, h("div", null, "champs")));
    expect(m).toMatch(/class="hidden sm:block"/);
    expect(text(m)).toContain("Filtres 1 actif");
  });

  it("Breadcrumb : page courante annoncée ; safeReturn refuse les adresses externes", async () => {
    const { Breadcrumb, safeReturn } = await import("@/components/ux/breadcrumb");
    const m = html(h(Breadcrumb, { items: [{ label: "Tableau de bord", href: "/dashboard" }, { label: "Absentéisme" }] }));
    expect(m).toContain('aria-current="page"');
    expect(safeReturn("//evil.example", ["/dashboard"])).toBeUndefined();
    expect(safeReturn("/dashboard?x=1", ["/dashboard"])).toBe("/dashboard?x=1");
  });
});

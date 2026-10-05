import type { Page } from "@playwright/test";
import { test, expect, USERS, expectForbidden, outOfScopeEmployeeId, storageState, type RoleKey } from "./helpers";

// visible : entrées exigées pour le rôle ; hidden : entrées interdites (le menu peut en compter d'autres)
const MENU: Record<RoleKey, { visible: string[]; hidden: string[] }> = {
  admin: {
    visible: ["Console", "Utilisateurs et accès", "Paramètres", "Power BI", "Journal d'audit", "Santé des données", "Transparence du modèle", "Dérive des données", "Alertes", "Mon compte"],
    hidden: ["Tableau de bord", "Synthèse du mois", "Collaborateurs", "Mon équipe", "Mes équipes", "Équipes", "Absentéisme", "Recommandations", "Interventions", "Vérification a posteriori", "Formations", "Charge de travail", "Prévisions effectifs", "Droit d'accès", "Organigramme", "Rétention"],
  },
  rh: {
    visible: ["Tableau de bord", "Power BI", "Synthèse du mois", "Collaborateurs", "Équipes", "Absentéisme", "Recommandations", "Interventions", "Santé des données", "Transparence du modèle", "Dérive des données", "Vérification a posteriori", "Organigramme", "Rétention", "Alertes", "Mon compte"],
    hidden: ["Console", "Utilisateurs et accès", "Paramètres", "Journal d'audit", "Mon équipe"],
  },
  manager: {
    visible: ["Tableau de bord", "Power BI", "Synthèse du mois", "Mon équipe", "Mes équipes", "Organigramme", "Absentéisme", "Rétention", "Alertes", "Mon compte"],
    hidden: ["Collaborateurs", "Recommandations", "Interventions", "Santé des données", "Transparence du modèle", "Dérive des données", "Vérification a posteriori", "Prévisions effectifs", "Droit d'accès", "Console", "Utilisateurs et accès", "Paramètres", "Journal d'audit"],
  },
};

const FORBIDDEN_PAGES: Record<RoleKey, string[]> = {
  admin: ["/dashboard", "/synthese", "/employees", "/equipes", "/absenteeism", "/recommendations", "/interventions", "/backtesting", "/confidentialite", "/retention", "/organigramme"],
  rh: ["/admin", "/admin/users", "/admin/settings", "/admin/audit"],
  manager: ["/recommendations", "/interventions", "/derive", "/data-health", "/transparency", "/backtesting", "/confidentialite", "/admin", "/admin/users", "/admin/settings", "/admin/audit"],
};

// Nom accessible d'une entrée : libellé éventuellement suivi d'un compteur (« Alertes 3 alerte(s) ouverte(s) »)
const menuName = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
const nav = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });

for (const role of Object.keys(USERS) as RoleKey[]) {
  test.describe(`Navigation ${USERS[role].login}`, () => {
    test.use({ storageState: storageState(role) });

    test("la racine redirige vers l'accueil du rôle", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(new RegExp(`${USERS[role].home}$`));
      await page.goto("/login");
      await expect(page).toHaveURL(new RegExp(`${USERS[role].home}$`));
    });

    test("menu adapté au rôle", async ({ page }) => {
      await page.goto(USERS[role].home);
      for (const label of MENU[role].visible) await expect(nav(page).getByRole("link", { name: menuName(label) })).toBeVisible();
      for (const label of MENU[role].hidden) await expect(nav(page).getByRole("link", { name: menuName(label) })).toHaveCount(0);
    });

    test("chaque entrée du menu ouvre une page sans erreur ni violation de la CSP", async ({ page }) => {
      // En-tête Content-Security-Policy du build de production : Chromium signale tout blocage dans la console
      const csp: string[] = [];
      page.on("console", (m) => {
        if (/Content Security Policy|Refused to (load|execute|apply)/i.test(m.text())) csp.push(`${page.url()} : ${m.text()}`);
      });
      await page.goto(USERS[role].home);
      const hrefs = await nav(page).getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
      expect(hrefs.length).toBeGreaterThanOrEqual(MENU[role].visible.length);
      for (const href of hrefs) {
        const res = await page.goto(href);
        expect.soft(res?.status(), `statut HTTP de ${href}`).toBeLessThan(400);
        await expect.soft(page, href).toHaveURL(new RegExp(`${href.replace(/[/]/g, "\\/")}$`));
        await expect.soft(page.getByRole("heading", { level: 1 }).first(), href).toBeVisible();
        await expect.soft(page.getByText(/Une erreur est survenue|Application error|could not be found/i), href).toHaveCount(0);
        await expect.soft(page, href).not.toHaveTitle(/introuvable|404/i);
        await expect.soft(nav(page).locator(`a[href="${href}"]`), href).toHaveAttribute("aria-current", "page");
      }
      expect(csp, csp.join("\n")).toEqual([]);
    });

    test("pages hors rôle → /interdit", async ({ page }) => {
      for (const path of FORBIDDEN_PAGES[role]) {
        await page.goto(path);
        await expectForbidden(page);
      }
    });
  });
}

test.describe("Séparation des tâches ADMIN", () => {
  test.use({ storageState: storageState("admin") });

  test("l'admin arrive sur la console et n'accède à aucune fiche ni API RH", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/administration/i);
    const id = outOfScopeEmployeeId();
    await page.goto(`/employees/${id}`);
    await expectForbidden(page);
    for (const api of [`/api/employees/${id}`, "/api/employees", "/api/dashboard"]) {
      const res = await page.request.get(api);
      expect(res.status(), api).toBe(403);
    }
  });
});

// Menu réduit : data-nav="rail" sur <html>, choix mémorisé dans localStorage « pa-nav », rail de 64 px
test.describe("Menu réduit", () => {
  test.use({ storageState: storageState("rh") });

  const html = (page: Page) => page.locator("html");
  const stored = (page: Page) => page.evaluate(() => localStorage.getItem("pa-nav"));
  const navWidth = async (page: Page) => Math.round((await nav(page).boundingBox())?.width ?? 0);
  // Bulle du rail : décorative (aria-hidden), le nom accessible du lien suffit aux lecteurs d'écran
  const railTip = (page: Page, label: string) => page.locator('span[aria-hidden="true"]').filter({ hasText: new RegExp(`^${label}$`) });

  test("réduire : mémorisé, liens nommés, bulles au survol et au focus, rail dès le rechargement, puis déployer", async ({ page }) => {
    // Le script du <head> doit poser data-nav="rail" avant que le menu soit analysé : pas d'affichage déployé puis réduit
    await page.addInitScript(() => {
      const w = window as Window & { __railBeforeMenu?: boolean };
      const obs = new MutationObserver(() => {
        if (document.documentElement?.getAttribute("data-nav") !== "rail") return;
        w.__railBeforeMenu = !document.querySelector('nav[aria-label="Navigation principale"]');
        obs.disconnect();
      });
      obs.observe(document, { subtree: true, attributes: true, attributeFilter: ["data-nav"] });
    });
    await page.goto(USERS.rh.home);
    const collapse = page.getByRole("button", { name: "Réduire le menu" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(html(page)).not.toHaveAttribute("data-nav");
    expect(await navWidth(page)).toBeGreaterThan(200);

    await collapse.click();
    await expect(html(page)).toHaveAttribute("data-nav", "rail");
    expect(await stored(page)).toBe("rail");
    await expect(page.getByRole("button", { name: "Déployer le menu" })).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => navWidth(page)).toBeLessThanOrEqual(68);
    expect(await navWidth(page)).toBeGreaterThanOrEqual(60);
    for (const label of MENU.rh.visible) await expect(nav(page).getByRole("link", { name: menuName(label) })).toBeVisible();

    const navBox = (await nav(page).boundingBox())!;
    await nav(page).getByRole("link", { name: menuName("Synthèse du mois") }).hover();
    const hoverTip = railTip(page, "Synthèse du mois");
    await expect(hoverTip).toBeVisible();
    expect((await hoverTip.boundingBox())!.x, "bulle à droite du rail").toBeGreaterThanOrEqual(navBox.x + navBox.width);
    await page.mouse.move(navBox.x + navBox.width + 400, 450);
    await expect(hoverTip).toHaveCount(0);

    const org = nav(page).getByRole("link", { name: menuName("Organigramme") });
    await org.focus();
    await expect(railTip(page, "Organigramme")).toBeVisible();
    await org.blur();
    await expect(railTip(page, "Organigramme")).toHaveCount(0);

    await page.reload();
    await expect.poll(() => page.evaluate(() => (window as Window & { __railBeforeMenu?: boolean }).__railBeforeMenu)).toBe(true);
    await expect(html(page)).toHaveAttribute("data-nav", "rail");
    expect(await navWidth(page)).toBeLessThanOrEqual(68);
    const expand = page.getByRole("button", { name: "Déployer le menu" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");

    await expand.click();
    await expect(html(page)).not.toHaveAttribute("data-nav");
    expect(await stored(page)).toBeNull();
    await expect(page.getByRole("button", { name: "Réduire le menu" })).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => navWidth(page)).toBeGreaterThan(200);
    // Menu déployé : libellés visibles, pas de bulle
    await nav(page).getByRole("link", { name: menuName("Synthèse du mois") }).hover();
    await page.waitForTimeout(300);
    await expect(railTip(page, "Synthèse du mois")).toHaveCount(0);
    await page.reload();
    await expect(html(page)).not.toHaveAttribute("data-nav");
  });

  test("à 390 px, l'en-tête tient dans la largeur, menu réduit enregistré ou non", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(USERS.rh.home);
    const header = page.locator("header").first();
    for (const rail of [false, true]) {
      const state = rail ? "menu réduit enregistré" : "menu déployé";
      await page.evaluate((r) => (r ? localStorage.setItem("pa-nav", "rail") : localStorage.removeItem("pa-nav")), rail);
      await page.reload();
      if (rail) await expect(html(page)).toHaveAttribute("data-nav", "rail");
      await expect(page.getByRole("button", { name: "Menu de navigation" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^(Réduire|Déployer) le menu$/ })).toBeHidden();
      const report = await header.evaluate((h) => ({
        overflow: h.scrollWidth - h.clientWidth,
        outside: [...h.querySelectorAll<HTMLElement>("a, button, input")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1 && (r.left < -0.5 || r.right > window.innerWidth + 0.5);
          })
          .map((el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.tagName).trim()),
      }));
      expect(report.overflow, `débordement horizontal de l'en-tête (${state})`).toBeLessThanOrEqual(0);
      expect(report.outside, `contrôles de l'en-tête hors de l'écran (${state})`).toEqual([]);
    }
  });
});

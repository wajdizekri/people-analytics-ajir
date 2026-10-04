import { test, expect, activeTeamIds, axeScan, describeViolations, q1, storageState, waitReady, type RoleKey } from "./helpers";

// Contrôle axe-core WCAG 2.x niveaux A et AA : chaque page doit être sans violation.
// Détail des violations : pièces jointes du rapport HTML et test-results/e2e-axe/*.json
const rhAlert = () => q1<{ id: number }>("SELECT id FROM alert WHERE audience <> 'ADMIN' ORDER BY id LIMIT 1")?.id ?? 1;

const PAGES: { role: RoleKey | "anonyme"; label: string; path: () => string }[] = [
  { role: "anonyme", label: "connexion", path: () => "/login" },
  { role: "anonyme", label: "activation-invalide", path: () => "/activation?token=invalide" },
  { role: "rh", label: "tableau-de-bord", path: () => "/dashboard" },
  { role: "rh", label: "collaborateurs", path: () => "/employees" },
  { role: "rh", label: "fiche", path: () => "/employees/79" },
  { role: "rh", label: "absenteisme", path: () => "/absenteeism" },
  { role: "rh", label: "recommandations", path: () => "/recommendations" },
  { role: "rh", label: "alertes", path: () => "/alerts" },
  { role: "rh", label: "alerte-detail", path: () => `/alerts/${rhAlert()}` },
  { role: "rh", label: "sante-donnees", path: () => "/data-health" },
  { role: "rh", label: "transparence", path: () => "/transparency" },
  { role: "rh", label: "backtesting", path: () => "/backtesting" },
  { role: "rh", label: "mon-compte", path: () => "/compte" },
  { role: "rh", label: "synthese", path: () => "/synthese" },
  { role: "rh", label: "equipes", path: () => "/equipes" },
  { role: "rh", label: "interventions", path: () => "/interventions" },
  { role: "rh", label: "derive", path: () => "/derive" },
  { role: "rh", label: "formations", path: () => "/formations" },
  { role: "rh", label: "charge", path: () => "/charge" },
  { role: "rh", label: "previsions", path: () => "/previsions" },
  { role: "rh", label: "retention", path: () => "/retention" },
  { role: "rh", label: "organigramme", path: () => "/organigramme" },
  { role: "rh", label: "confidentialite", path: () => "/confidentialite" },
  { role: "rh", label: "aide", path: () => "/aide" },
  { role: "rh", label: "page-introuvable", path: () => "/page-inexistante" },
  { role: "manager", label: "tableau-de-bord", path: () => "/dashboard" },
  { role: "manager", label: "mon-equipe", path: () => "/employees" },
  { role: "manager", label: "fiche", path: () => `/employees/${activeTeamIds()[0]}` },
  { role: "manager", label: "interdit", path: () => "/recommendations" },
  { role: "manager", label: "synthese", path: () => "/synthese" },
  { role: "manager", label: "equipes", path: () => "/equipes" },
  { role: "manager", label: "formations", path: () => "/formations" },
  { role: "manager", label: "charge", path: () => "/charge" },
  { role: "manager", label: "retention", path: () => "/retention" },
  { role: "manager", label: "organigramme", path: () => "/organigramme" },
  { role: "admin", label: "console", path: () => "/admin" },
  { role: "admin", label: "utilisateurs", path: () => "/admin/users" },
  { role: "admin", label: "parametres", path: () => "/admin/settings" },
  { role: "admin", label: "journal-audit", path: () => "/admin/audit" },
  { role: "admin", label: "sante-donnees", path: () => "/data-health" },
  { role: "admin", label: "transparence", path: () => "/transparency" },
  { role: "admin", label: "derive", path: () => "/derive" },
  { role: "admin", label: "aide", path: () => "/aide" },
];

test.describe("Accessibilité axe (WCAG 2 A/AA)", () => {
  for (const p of PAGES) {
    test.describe(p.role, () => {
      if (p.role !== "anonyme") test.use({ storageState: storageState(p.role) });

      test(`${p.label}`, async ({ page }, testInfo) => {
        await page.goto(p.path());
        await waitReady(page);
        await page.waitForTimeout(500);
        const summary = await axeScan(page, testInfo, p.label, p.role);
        expect(summary.violations, `Violations axe sur ${summary.url} :\n${describeViolations(summary)}`).toEqual([]);
      });
    });
  }
});

// Thème sombre (choix enregistré avant le premier affichage) sur les pages principales : contrastes des jetons sombres
const DARK_PAGES = new Set([
  "anonyme:connexion",
  "rh:tableau-de-bord",
  "rh:collaborateurs",
  "rh:fiche",
  "rh:absenteisme",
  "rh:recommandations",
  "rh:alertes",
  "rh:synthese",
  "rh:equipes",
  "rh:previsions",
  "rh:retention",
  "rh:organigramme",
  "rh:mon-compte",
  "manager:tableau-de-bord",
  "manager:mon-equipe",
  "manager:equipes",
  "admin:console",
  "admin:utilisateurs",
  "admin:parametres",
  "admin:sante-donnees",
  "admin:transparence",
]);

test.describe("Accessibilité axe en thème sombre (WCAG 2 A/AA)", () => {
  for (const p of PAGES.filter((x) => DARK_PAGES.has(`${x.role}:${x.label}`))) {
    test.describe(p.role, () => {
      if (p.role !== "anonyme") test.use({ storageState: storageState(p.role) });

      test(`${p.label} (sombre)`, async ({ page }, testInfo) => {
        await page.addInitScript(() => {
          try {
            localStorage.setItem("pa-theme", "dark");
          } catch {}
        });
        await page.goto(p.path());
        await waitReady(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await page.waitForTimeout(500);
        const summary = await axeScan(page, testInfo, `${p.label}-sombre`, p.role);
        expect(summary.violations, `Violations axe (sombre) sur ${summary.url} :\n${describeViolations(summary)}`).toEqual([]);
      });
    });
  }
});

// Menu réduit en rail d'icônes (choix enregistré avant le premier affichage) : libellés masqués, pastille du compteur d'alertes, date dans l'en-tête
const RAIL_PAGES = new Set(["rh:tableau-de-bord"]);

test.describe("Accessibilité axe en menu réduit (WCAG 2 A/AA)", () => {
  for (const p of PAGES.filter((x) => RAIL_PAGES.has(`${x.role}:${x.label}`))) {
    test.describe(p.role, () => {
      if (p.role !== "anonyme") test.use({ storageState: storageState(p.role) });

      test(`${p.label} (menu réduit)`, async ({ page }, testInfo) => {
        await page.addInitScript(() => {
          try {
            localStorage.setItem("pa-nav", "rail");
          } catch {}
        });
        await page.goto(p.path());
        await waitReady(page);
        await expect(page.locator("html")).toHaveAttribute("data-nav", "rail");
        await page.waitForTimeout(500);
        const summary = await axeScan(page, testInfo, `${p.label}-menu-reduit`, p.role);
        expect(summary.violations, `Violations axe (menu réduit) sur ${summary.url} :\n${describeViolations(summary)}`).toEqual([]);
      });
    });
  }
});

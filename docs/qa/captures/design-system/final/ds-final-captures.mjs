// Captures finales du design system (clair / sombre, 1440 / 390) sur le serveur E2E isolé (:3200, data/e2e.db)
// Usage : node ds-final-captures.mjs   (ONLY=palette,toast,connexion… pour n'en refaire que quelques-unes)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/Users/stagiaire1/Desktop/aziz-pfe/people-analytics";
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.BASE ?? "http://localhost:3200";
const OUT = path.join(ROOT, "docs/qa/captures/design-system/final");
fs.mkdirSync(OUT, { recursive: true });

const USERS = {
  admin: { login: "admin", password: "Admin2026pfe", home: "/admin" },
  rh: { login: "rh.demo", password: "RhDemo2026pfe", home: "/dashboard" },
  manager: { login: "mgr.M10451", password: "MgrDemo2026pfe", home: "/dashboard" },
};

const PAGES = [
  { name: "connexion", role: null, path: "/login" },
  { name: "tableau-de-bord-rh", role: "rh", path: "/dashboard" },
  { name: "fiche-collaborateur-rh", role: "rh", path: "/employees/79" },
  { name: "synthese-rh", role: "rh", path: "/synthese" },
  { name: "absenteisme-manager", role: "manager", path: "/absenteeism" },
  { name: "previsions-rh", role: "rh", path: "/previsions" },
  { name: "transparence-rh", role: "rh", path: "/transparency" },
  { name: "sante-donnees-admin", role: "admin", path: "/data-health" },
  { name: "utilisateurs-admin", role: "admin", path: "/admin/users" },
  { name: "mon-compte-rh", role: "rh", path: "/compte" },
  { name: "organigramme-rh", role: "rh", path: "/organigramme" },
  { name: "retention-rh", role: "rh", path: "/retention" },
];

const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const errors = [];

async function ready(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await page.locator("main h1").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

const browser = await chromium.launch();
try {
  // Une connexion par rôle, sessions réutilisées dans toutes les combinaisons thème × largeur
  const states = {};
  for (const [role, u] of Object.entries(USERS)) {
    const ctx = await browser.newContext({ baseURL: BASE, locale: "fr-FR" });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Identifiant").fill(u.login);
    await page.getByLabel("Mot de passe", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL((url) => url.pathname.startsWith(u.home), { timeout: 60_000 });
    states[role] = await ctx.storageState();
    await ctx.close();
  }

  for (const theme of ["clair", "sombre"]) {
    for (const width of [1440, 390]) {
      const contexts = {};
      const ctxFor = async (role) => {
        const key = role ?? "anonyme";
        if (contexts[key]) return contexts[key];
        const ctx = await browser.newContext({
          baseURL: BASE,
          locale: "fr-FR",
          timezoneId: "Africa/Tunis",
          viewport: { width, height: width === 390 ? 844 : 900 },
          deviceScaleFactor: 1,
          colorScheme: theme === "sombre" ? "dark" : "light",
          storageState: role ? states[role] : undefined,
        });
        await ctx.addInitScript((t) => {
          try {
            localStorage.setItem("pa-theme", t);
          } catch {}
        }, theme === "sombre" ? "dark" : "light");
        contexts[key] = ctx;
        return ctx;
      };
      const suffix = `${width}-${theme}`;

      for (const p of PAGES) {
        if (only && !only.has(p.name)) continue;
        const page = await (await ctxFor(p.role)).newPage();
        page.on("pageerror", (e) => errors.push(`${p.name} ${suffix} : ${e.message}`));
        await page.goto(p.path);
        await ready(page);
        await page.screenshot({ path: path.join(OUT, `${p.name}-${suffix}.png`), fullPage: true });
        await page.close();
        console.log("ok", p.name, suffix);
      }

      if (!only || only.has("palette")) {
        const page = await (await ctxFor("rh")).newPage();
        await page.goto("/dashboard");
        await ready(page);
        await page.keyboard.press("Control+K");
        const dialog = page.getByRole("dialog", { name: "Recherche rapide" });
        await dialog.waitFor({ timeout: 15_000 });
        await dialog.getByRole("combobox").fill("abs");
        await page.waitForTimeout(1200);
        await page.screenshot({ path: path.join(OUT, `palette-ctrl-k-${suffix}.png`) });
        await page.close();
        console.log("ok palette", suffix);
      }

      if (!only || only.has("toast")) {
        // Toast d'erreur sans écriture en base : identifiant déjà pris
        const page = await (await ctxFor("admin")).newPage();
        await page.goto("/admin/users");
        await ready(page);
        const form = page.getByRole("form", { name: "Créer un compte" });
        await form.getByLabel("Identifiant").fill("admin");
        await form.getByRole("button", { name: "Créer le compte" }).click();
        await page.getByText("Compte non créé").first().waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT, `toast-${suffix}.png`) });
        await page.close();
        console.log("ok toast", suffix);
      }

      for (const ctx of Object.values(contexts)) await ctx.close();
    }
  }
} finally {
  await browser.close();
}
if (errors.length) console.log("Erreurs de page :\n" + errors.join("\n"));

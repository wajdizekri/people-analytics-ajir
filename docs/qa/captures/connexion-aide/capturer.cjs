// Captures connexion, activation, aide (3 rôles), 403 et 404 à 1440 et 390 px. Usage : node docs/qa/captures/connexion-aide/capturer.cjs <avant|apres>
const path = require("node:path");
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const BASE = "http://localhost:3000";
const phase = process.argv[2] || "avant";
const OUT = path.join(ROOT, "docs", "qa", "captures", "connexion-aide", phase);
fs.mkdirSync(OUT, { recursive: true });

const USERS = {
  rh: { login: "rh.demo", password: "RhDemo2026pfe" },
  manager: { login: "mgr.M10451", password: "MgrDemo2026pfe" },
  admin: { login: "admin", password: "Admin2026pfe" },
};
const WIDTHS = [1440, 390];

async function shot(page, name, full = false) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log("ok", name);
}

async function login(page, u) {
  await page.goto(`${BASE}/login`, { timeout: 120_000 });
  await page.getByLabel("Identifiant").fill(u.login);
  await page.getByLabel("Mot de passe", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 120_000 });
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 900 : 844 }, locale: "fr-FR" });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`, { timeout: 120_000 });
      await shot(page, `login-${w}`);
      await page.getByLabel("Identifiant").fill("inconnu.capture");
      await page.getByLabel("Mot de passe", { exact: true }).fill("MauvaisMdp1xx");
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForTimeout(2500);
      await shot(page, `login-erreur-${w}`);
      await page.goto(`${BASE}/activation?token=invalide`, { timeout: 120_000 });
      await shot(page, `activation-invalide-${w}`);
      await page.goto(`${BASE}/adresse-inconnue`, { timeout: 120_000 });
      await shot(page, `404-sans-session-${w}`);
      await ctx.close();
    }
    for (const role of Object.keys(USERS)) {
      for (const w of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 900 : 844 }, locale: "fr-FR" });
        const page = await ctx.newPage();
        await login(page, USERS[role]);
        await page.goto(`${BASE}/aide`, { timeout: 120_000 });
        await shot(page, `aide-${role}-${w}`);
        await shot(page, `aide-${role}-${w}-complet`, true);
        if (role === "manager") {
          await page.goto(`${BASE}/recommendations`, { timeout: 120_000 });
          await shot(page, `interdit-manager-${w}`);
        }
        if (role === "rh") {
          await page.goto(`${BASE}/employees/99999999`, { timeout: 120_000 });
          await shot(page, `404-dans-app-rh-${w}`);
          await page.goto(`${BASE}/adresse-inconnue`, { timeout: 120_000 });
          await shot(page, `404-rh-${w}`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

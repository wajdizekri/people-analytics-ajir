// Captures « Données et modèle » (santé des données, transparence, dérive, backtesting) : thèmes clair et sombre, 1440 et 390 px, RH et ADMIN.
// Une seule navigation par page : bascule de thème (data-theme) et de largeur sur la page chargée (serveur partagé lent).
// Usage : node docs/qa/captures/design-system/donnees-modele/capturer.cjs <avant|apres> [filtre1,filtre2]   (filtre : « derive-admin », « backtesting »…)
const path = require("node:path");
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const BASE = "http://localhost:3000";
const phase = process.argv[2] || "avant";
const filters = (process.argv[3] || "").split(",").filter(Boolean);
const wanted = (key) => !filters.length || filters.some((f) => key.includes(f));
const OUT = path.join(__dirname, phase);
fs.mkdirSync(OUT, { recursive: true });

const USERS = {
  rh: { login: "rh.demo", password: "RhDemo2026pfe", pages: ["data-health", "transparency", "derive", "backtesting"] },
  admin: { login: "admin", password: "Admin2026pfe", pages: ["data-health", "transparency", "derive"] },
};
const SIZES = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
];
const THEMES = [
  ["clair", "light"],
  ["sombre", "dark"],
];
const T = 300_000;

async function setTheme(page, value) {
  await page.evaluate((v) => {
    try {
      localStorage.setItem("pa-theme", v);
    } catch {}
    document.documentElement.setAttribute("data-theme", v);
    document.documentElement.setAttribute("data-theme-pref", v);
  }, value);
}

async function capturePage(page, p, role) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/${p}`, { timeout: T, waitUntil: "commit" });
  await page.locator("main h1").first().waitFor({ timeout: T });
  // Graphiques ECharts : rendus après hydratation (lente sur le serveur partagé)
  await page.locator("canvas").first().waitFor({ timeout: 240_000 }).catch(() => console.log("pas de graphique", p));
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.waitForTimeout(1500);
    for (const [label, value] of THEMES) {
      await setTheme(page, value);
      await page.waitForTimeout(1500);
      const name = `${p}-${role}-${label}-${s.w}`;
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
      console.log("ok", name);
    }
  }
  if (p === "data-health" && role === "admin" && phase !== "avant") {
    // Étapes de l'import : fichiers choisis (un obligatoire manquant, un fichier non prévu)
    const csv = (name) => ({ name, mimeType: "text/csv", buffer: Buffer.from("code;libelle;") });
    await page.locator("#export-files").setInputFiles([csv("employees.csv"), csv("contracts.csv"), csv("inconnu.csv")]);
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.w, height: s.h });
      for (const [label, value] of THEMES) {
        await setTheme(page, value);
        await page.waitForTimeout(800);
        const name = `${p}-${role}-import-selection-${label}-${s.w}`;
        await page.locator("#import").screenshot({ path: path.join(OUT, `${name}.png`) });
        console.log("ok", name);
      }
    }
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [role, u] of Object.entries(USERS)) {
      if (!u.pages.some((p) => wanted(`${p}-${role}`))) continue;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
      ctx.setDefaultTimeout(T);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`, { timeout: T, waitUntil: "domcontentloaded" });
      await page.getByLabel("Identifiant").fill(u.login);
      await page.getByLabel("Mot de passe", { exact: true }).fill(u.password);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: T, waitUntil: "commit" });
      for (const p of u.pages) {
        if (!wanted(`${p}-${role}`)) continue;
        console.log("page", p, role);
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await capturePage(page, p, role);
            break;
          } catch (e) {
            console.log("échec", p, role, attempt, e.message.split("\n")[0]);
          }
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

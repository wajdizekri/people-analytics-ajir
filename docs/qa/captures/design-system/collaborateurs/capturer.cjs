// Captures « Collaborateurs » (liste, fiche, simulation « et si ? »), thèmes clair et sombre, 1440 et 390 px, RH et manager.
// Usage : node docs/qa/captures/design-system/collaborateurs/capturer.cjs <avant|apres> [filtre1,filtre2…] — serveur partagé sur localhost:3000.
const path = require("node:path");
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const BASE = "http://localhost:3000";
const phase = process.argv[2] || "avant";
const filter = process.argv[3] || "";
const OUT = path.join(__dirname, phase);
fs.mkdirSync(OUT, { recursive: true });

const USERS = {
  rh: { login: "rh.demo", password: "RhDemo2026pfe", fiche: 24 },
  manager: { login: "mgr.M10451", password: "MgrDemo2026pfe", fiche: 429 },
};
const WIDTHS = [1440, 390];
const THEMES = ["clair", "sombre"];

async function login(page, u) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(`${BASE}/login`, { timeout: 180_000, waitUntil: "networkidle" }).catch(() => {});
      await page.locator("#login").fill(u.login, { timeout: 120_000 });
      await page.locator("#password").fill(u.password);
      await page.locator("button[type=submit]").click();
      // Cookie de session posé par la Server Action : inutile d'attendre le rendu du tableau de bord (serveur partagé lent)
      for (let t = 0; t < 240; t++) {
        if ((await page.context().cookies()).some((c) => c.name === "pa_session")) return;
        await page.waitForTimeout(500);
      }
      throw new Error("pas de cookie de session");
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}

async function open(page, url, value) {
  await page.goto(url, { timeout: 180_000 });
  await page.locator("main h1").first().waitFor({ timeout: 180_000 });
  await page.evaluate((v) => (document.documentElement.dataset.theme = v), value);
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [role, u] of Object.entries(USERS)) {
      for (const theme of THEMES) {
        for (const w of WIDTHS) {
          const want = (n) => !filter || filter.split(",").some((f) => n.includes(f));
          const names = [`liste-${role}-${theme}-${w}`, `fiche-${role}-${theme}-${w}`, `simulation-${role}-${theme}-${w}`];
          if (!names.some(want)) continue;
          const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 900 : 844 }, locale: "fr-FR", colorScheme: theme === "sombre" ? "dark" : "light" });
          const value = theme === "sombre" ? "dark" : "light";
          await ctx.addInitScript((v) => {
            try {
              localStorage.setItem("pa-theme", v);
            } catch {}
            document.documentElement.dataset.theme = v;
          }, value);
          const page = await ctx.newPage();
          page.setDefaultTimeout(60_000);
          await login(page, u);
          if (want(names[0])) {
            await open(page, `${BASE}/employees`, value);
            await page.screenshot({ path: path.join(OUT, `${names[0]}.png`), fullPage: true });
            console.log("ok", names[0]);
          }
          if (want(names[1]) || (role === "rh" && want(names[2]))) {
            await open(page, `${BASE}/employees/${u.fiche}`, value);
            if (want(names[1])) {
              await page.screenshot({ path: path.join(OUT, `${names[1]}.png`), fullPage: true });
              console.log("ok", names[1]);
            }
            if (role === "rh" && want(names[2])) {
              const sec = page.locator("section#simulation");
              await sec.getByLabel(/Augmentation du salaire de base/).first().fill("10");
              await sec.getByRole("button", { name: /Simuler/ }).click();
              await sec.getByText(/Le niveau de risque (passerait|resterait)/).first().waitFor({ timeout: 180_000 }).catch(() => {});
              await page.waitForTimeout(1200);
              await sec.scrollIntoViewIfNeeded();
              await sec.screenshot({ path: path.join(OUT, `${names[2]}.png`) });
              console.log("ok", names[2]);
            }
          }
          await ctx.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Captures du domaine Collaborateurs (liste, fiche d'un collaborateur en risque élevé, simulation) en 1440 et 390 px.
// Usage : node docs/qa/captures/collaborateurs/capture.cjs avant|apres [rh|manager] [1440|390] — serveur partagé sur localhost:3000.
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../../../..");
const { chromium } = require(ROOT + "/node_modules/playwright");
const phase = process.argv[2] || "avant";
const only = process.argv[3];
const OUT = path.join(ROOT, "docs/qa/captures/collaborateurs", phase);
const BASE = "http://localhost:3000";
const USERS = { rh: ["rh.demo", "RhDemo2026pfe"], manager: ["mgr.M10451", "MgrDemo2026pfe"] };
const RH_ID = 24, MGR_ID = 429;

async function login(ctx, role) {
  const page = await ctx.newPage();
  for (let i = 0; i < 4; i++) {
    await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.fill("#login", USERS[role][0]);
    await page.fill("#password", USERS[role][1]);
    await page.click("button[type=submit]");
    try { await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 }); await page.close(); return; }
    catch { console.log("login retry", i, (await page.locator("[role=alert]").allInnerTexts().catch(() => [])).join(" | ")); }
  }
  throw new Error("login impossible");
}

async function go(page, url) {
  for (let i = 0; i < 3; i++) {
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 }); await page.locator("main h1").first().waitFor({ timeout: 180000 }); return; } catch (e) { if (i === 2) throw e; }
  }
}

async function shot(page, name) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
  console.log("ok", name);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const role of ["rh", "manager"]) {
      if (only && only !== role) continue;
      for (const [w, h, tag] of [[1440, 900, "1440"], [390, 844, "390"]]) {
        if (process.argv[4] && process.argv[4] !== tag) continue;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "fr-FR", deviceScaleFactor: 1 });
        await login(ctx, role);
        const page = await ctx.newPage();
        page.setDefaultTimeout(60000);
        await go(page, BASE + "/employees");
        await shot(page, `${role}-liste-${tag}`);
        await go(page, BASE + `/employees/${role === "rh" ? RH_ID : MGR_ID}`);
        await shot(page, `${role}-fiche-${tag}`);
        if (role === "rh") {
          const sec = page.locator("section").filter({ has: page.getByRole("heading", { name: /Simulation|Que se passe/ }) }).first();
          const input = sec.getByLabel(/Augmentation du salaire de base/).first();
          await input.fill("10");
          await sec.getByRole("button", { name: /Simuler/ }).click();
          await sec.getByText(/Le niveau de risque (passerait|resterait)|Avant (calcul publié)/).first().waitFor({ timeout: 180000 }).catch(() => {});
          await page.waitForTimeout(800);
          await sec.scrollIntoViewIfNeeded();
          await sec.screenshot({ path: path.join(OUT, `rh-whatif-${tag}.png`) });
          console.log("ok whatif", tag);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

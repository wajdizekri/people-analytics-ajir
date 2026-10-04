// Captures /login (repos, erreur) et /activation (lien invalide), thèmes clair et sombre, 1440 et 390 px.
// Usage : node docs/qa/captures/design-system/connexion/capturer.cjs <avant|apres> [--headed]
// En « apres » : erreurs console / CSP / WebGL, état de la constellation et délai « formulaire interactif » vs « scène 3D prête »
// (rapport JSON à côté des captures). --headed : fenêtre visible au lieu du mode headless.
const path = require("node:path");
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const BASE = "http://localhost:3000";
const phase = process.argv[2] || "avant";
const headed = process.argv.includes("--headed");
const OUT = path.join(__dirname, phase);
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [1440, 390];
const THEMES = ["clair", "sombre"];
const report = { phase, headed, date: new Date().toISOString(), runs: [] };

async function settle(page, ms = 600) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("ok", name);
}

(async () => {
  // GPU de la machine (D3D11) : sans ces options, Chromium headless n'a que SwiftShader (rendu logiciel), que la page écarte
  const browser = await chromium.launch({ headless: !headed, args: headed ? [] : ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] });
  try {
    for (const theme of THEMES) {
      for (const w of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width: w, height: w > 500 ? 900 : 844 }, locale: "fr-FR", deviceScaleFactor: 1 });
        if (theme === "sombre") {
          await ctx.addInitScript(() => {
            try {
              localStorage.setItem("pa-theme", "dark");
            } catch {}
            if (document.documentElement) document.documentElement.dataset.theme = "dark";
          });
        }
        // Violations CSP et erreurs JS remontées par la page
        await ctx.addInitScript(() => {
          window.__paCsp = [];
          document.addEventListener("securitypolicyviolation", (e) => window.__paCsp.push(`${e.violatedDirective} ${e.blockedURI}`));
        });
        const page = await ctx.newPage();
        const run = { theme, width: w, console: [], pageErrors: [], csp: [] };
        page.on("console", (m) => {
          if (m.type() === "error" || m.type() === "warning") run.console.push(`[${m.type()}] ${m.text().slice(0, 300)} @ ${m.location().url ?? ""}:${m.location().lineNumber ?? ""}`);
        });
        page.on("pageerror", (e) => run.pageErrors.push(String(e).slice(0, 300)));

        // Premier fichier JS de three / React Three Fiber demandé (chargement différé de la scène)
        page.on("request", (r) => {
          if (run.threeRequestMs === undefined && /three/i.test(r.url()) && r.resourceType() === "script") run.threeRequestMs = Date.now() - t0;
        });
        const t0 = Date.now();
        await page.goto(`${BASE}/login`, { timeout: 300_000, waitUntil: "domcontentloaded" });
        if (theme === "sombre") await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
        if (phase === "apres") {
          // Formulaire interactif = hydraté : le bouton afficher/masquer change d'état au clic
          const toggle = page.getByRole("button", { name: "Afficher le mot de passe" });
          await toggle.waitFor({ timeout: 60_000 });
          for (let i = 0; i < 400; i++) {
            await toggle.click();
            if ((await toggle.getAttribute("aria-pressed")) === "true") break;
            await page.waitForTimeout(25);
          }
          run.formInteractiveMs = Date.now() - t0;
          await toggle.click();
          // Pointeur hors du formulaire (pas d'état de survol sur la capture ; parallaxe de la scène)
          await page.mouse.move(Math.round(w * 0.2), 300);
          const state = await page
            .waitForFunction(() => {
              const el = document.querySelector("[data-constellation]");
              const s = el?.getAttribute("data-constellation");
              return s === "3d" || s === "static" ? s : null;
            }, null, { timeout: 60_000 })
            .then((h) => h.jsonValue())
            .catch(() => "inconnu");
          run.constellation = state;
          run.sceneReadyMs = Date.now() - t0;
          run.constellationReason = await page.evaluate(() => document.querySelector("[data-constellation]")?.getAttribute("data-reason") ?? null);
        }
        await settle(page, phase === "apres" ? 1500 : 600);
        await shot(page, `login-${theme}-${w}`);

        await page.getByLabel("Identifiant").fill(`capture.${phase}.${theme}.${w}`);
        await page.getByLabel("Mot de passe", { exact: true }).fill("MauvaisMdp1xx");
        await page.getByRole("button", { name: "Se connecter" }).click();
        await page.getByText("Identifiant ou mot de passe incorrect.").waitFor({ timeout: 180_000 }).catch(() => {});
        await page.waitForTimeout(400);
        await shot(page, `login-erreur-${theme}-${w}`);

        run.csp.push(...(await page.evaluate(() => window.__paCsp ?? [])));
        await page.goto(`${BASE}/activation?token=invalide`, { timeout: 300_000, waitUntil: "domcontentloaded" });
        if (theme === "sombre") await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
        await settle(page);
        await shot(page, `activation-invalide-${theme}-${w}`);

        run.csp.push(...(await page.evaluate(() => window.__paCsp ?? [])));
        report.runs.push(run);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "rapport.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.runs, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

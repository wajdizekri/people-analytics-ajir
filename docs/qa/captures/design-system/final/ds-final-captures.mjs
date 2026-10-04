// Captures finales (design system, chantier visuels a7, graphiques 1a, ergonomie e9) sur le serveur E2E isolé (:3200, data/e2e.db).
// 1. Serveur en arrière-plan : E2E_SKIP_BUILD=1 node tests/e2e/server.mjs   (PowerShell : $env:E2E_SKIP_BUILD="1"; node tests/e2e/server.mjs)
// 2. node docs/qa/captures/design-system/final/ds-final-captures.mjs
// BASE (défaut http://localhost:3200) ; ONLY=<groupe|page|ancien nom>,… (ex. ONLY=palette,toast,connexion ou ONLY=graphiques) ;
// --liste : plan des captures, sans navigateur.
// Fichiers : <role>-<page>-<theme>-<menu|rail>-<largeur>[-<vue>].png ; sans vue = haut de page, à la taille de la fenêtre.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, "../../../../..");
const require = createRequire(path.join(ROOT, "package.json"));

const BASE = process.env.BASE ?? "http://localhost:3200";
const E2E_DB = path.join(ROOT, "data", "e2e.db");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null;

const USERS = {
  admin: { login: "admin", password: "Admin2026pfe", home: "/admin" },
  rh: { login: "rh.demo", password: "RhDemo2026pfe", home: "/dashboard" },
  manager: { login: "mgr.M10451", password: "MgrDemo2026pfe", home: "/dashboard" },
  // Racine de la hiérarchie (M12037, 632 personnes sous lui) : compte sans mot de passe dans app.db, posé dans data/e2e.db seulement
  "mgr-m12037": { login: "mgr.M12037", password: "MgrDemo2026pfe", home: "/dashboard", seedE2e: true },
};
const HEIGHT = { 1440: 900, 1536: 864, 390: 844 };
const viewportOf = (width) => ({ width, height: HEIGHT[width] ?? 900 });

const THEMES = ["clair", "sombre"];
const ROLE_ORDER = [null, "rh", "manager", "admin", "mgr-m12037"];
const WIDTH_ORDER = [1440, 1536, 390];
const FRAME_ORDER = ["haut", "pleine", "graphiques-1", "graphiques-2", "bas", "hierarchie", "liste", "survol", "entete", "entete-ouvert", "palette", "toast", "impression"];
const NO_SUFFIX = new Set(["haut", "palette", "toast"]);

// ---------- Plan : une prise de vue = un chargement de page ; ses vues produisent un fichier chacune ----------
const SHOTS = new Map();
function add(group, { role = null, slug, path: p, theme, nav = "menu", width, frames, legacy }) {
  const who = role ?? "anonyme";
  const id = `${who}-${slug}-${theme}-${nav}-${width}`;
  let s = SHOTS.get(id);
  if (!s) SHOTS.set(id, (s = { id, role, slug, path: p, theme, nav, width, frames: new Map(), rank: SHOTS.size }));
  else if (s.path !== p) throw new Error(`Plan incohérent : ${id} (${s.path} / ${p})`);
  for (const f of frames) {
    const keys = s.frames.get(f) ?? new Set();
    for (const k of [group, slug, `${who}-${slug}`, legacy]) if (k) keys.add(k);
    s.frames.set(f, keys);
  }
}

// pages : les 12 écrans de l'ancien script (anciens noms acceptés par ONLY). 390 px en pleine page comme avant : sous md, ni menu
// collant ni barre collante sur ces écrans ; 1440 px à la taille de la fenêtre (menu latéral collant, h-dvh).
const LEGACY = [
  ["connexion", null, "connexion", "/login"],
  ["tableau-de-bord-rh", "rh", "tableau-de-bord", "/dashboard"],
  ["fiche-collaborateur-rh", "rh", "fiche-collaborateur", "/employees/79"],
  ["synthese-rh", "rh", "synthese", "/synthese"],
  ["absenteisme-manager", "manager", "absenteisme", "/absenteeism"],
  ["previsions-rh", "rh", "previsions", "/previsions"],
  ["transparence-rh", "rh", "transparence", "/transparency"],
  ["sante-donnees-admin", "admin", "sante-donnees", "/data-health"],
  ["utilisateurs-admin", "admin", "utilisateurs", "/admin/users"],
  ["mon-compte-rh", "rh", "mon-compte", "/compte"],
  ["organigramme-rh", "rh", "organigramme", "/organigramme"],
  ["retention-rh", "rh", "retention", "/retention"],
];
for (const [legacy, role, slug, p] of LEGACY)
  for (const theme of THEMES) {
    add("pages", { role, slug, path: p, theme, width: 1440, frames: ["haut"], legacy });
    add("pages", { role, slug, path: p, theme, width: 390, frames: ["pleine"], legacy });
  }
for (const theme of THEMES)
  for (const width of [1440, 390]) {
    add("palette", { role: "rh", slug: "palette-ctrl-k", path: "/dashboard", theme, width, frames: ["palette"] });
    add("toast", { role: "admin", slug: "toast", path: "/admin/users", theme, width, frames: ["toast"] });
  }

for (const theme of THEMES)
  for (const nav of ["menu", "rail"]) {
    add("menu", { role: "rh", slug: "tableau-de-bord", path: "/dashboard", theme, nav, width: 1440, frames: ["haut"] });
    add("menu", { role: "admin", slug: "console", path: "/admin", theme, nav, width: 1440, frames: ["haut"] });
  }
add("menu", { role: "rh", slug: "tableau-de-bord", path: "/dashboard", theme: "clair", nav: "rail", width: 1440, frames: ["survol"] });
add("menu", { role: "rh", slug: "tableau-de-bord", path: "/dashboard", theme: "clair", nav: "rail", width: 390, frames: ["haut"] });

const MONITORING = [
  ["console", "/admin"],
  ["parametres", "/admin/settings"],
  ["sante-donnees", "/data-health"],
  ["derive", "/derive"],
  ["transparence", "/transparency"],
  ["verification", "/backtesting"],
];
for (const role of ["admin", "rh"])
  for (const [slug, p] of MONITORING)
    for (const theme of THEMES) add("monitoring", { role, slug, path: p, theme, width: 1440, frames: slug === "parametres" ? ["haut", "bas"] : ["haut"] });

const CHARTS = [
  ["tableau-de-bord", "/dashboard"],
  ["absenteisme", "/absenteeism"],
  ["charge", "/charge"],
  ["interventions", "/interventions"],
  ["fiche-collaborateur", "/employees/79"],
  ["transparence", "/transparency"],
];
for (const [slug, p] of CHARTS)
  for (const [theme, width] of [["clair", 1440], ["sombre", 1440], ["clair", 390]])
    add("graphiques", { role: "rh", slug, path: p, theme, width, frames: ["graphiques-1", "graphiques-2"] });

add("impression", { role: "rh", slug: "tableau-de-bord", path: "/dashboard", theme: "sombre", width: 1440, frames: ["impression"] });

for (const theme of THEMES)
  for (const width of [1440, 1536]) add("theme", { role: "rh", slug: "tableau-de-bord", path: "/dashboard", theme, width, frames: ["entete", "entete-ouvert"] });

for (const theme of THEMES) {
  add("organigramme-m12037", { role: "mgr-m12037", slug: "organigramme", path: "/organigramme", theme, width: 1440, frames: theme === "clair" ? ["hierarchie", "liste"] : ["hierarchie"] });
  add("organigramme-m12037", { role: "mgr-m12037", slug: "organigramme", path: "/organigramme", theme, width: 390, frames: ["hierarchie"] });
}

const fileOf = (s, f) => `${s.id}${NO_SUFFIX.has(f) ? "" : `-${f}`}.png`;
const order = (list, v) => list.indexOf(v);
const plan = [...SHOTS.values()]
  .map((s) => ({ ...s, frames: FRAME_ORDER.filter((f) => s.frames.has(f) && (!ONLY || [...s.frames.get(f)].some((k) => ONLY.has(k)))), groups: s.frames }))
  .filter((s) => s.frames.length)
  .sort(
    (a, b) =>
      order(ROLE_ORDER, a.role) - order(ROLE_ORDER, b.role) ||
      order(THEMES, a.theme) - order(THEMES, b.theme) ||
      a.nav.localeCompare(b.nav) ||
      order(WIDTH_ORDER, a.width) - order(WIDTH_ORDER, b.width) ||
      a.rank - b.rank,
  );
const planned = plan.reduce((n, s) => n + s.frames.length, 0);

if (ONLY) {
  const known = new Set([...SHOTS.values()].flatMap((s) => [...s.frames.values()].flatMap((k) => [...k])));
  for (const k of ONLY) if (!known.has(k)) console.log(`attention ONLY : « ${k} » ne correspond à aucune capture`);
}
if (process.argv.includes("--liste")) {
  for (const s of plan) for (const f of s.frames) console.log(`${fileOf(s, f)}  [${[...s.groups.get(f)].join(", ")}]`);
  console.log(`${planned} capture(s) prévue(s), ${plan.length} chargement(s) de page`);
  process.exit(0);
}

// ---------- Journal ----------
const written = [];
const skipped = [];
const warnings = [];
const failures = [];
const pageErrors = [];
const warn = (m) => {
  warnings.push(m);
  console.log("attention", m);
};

// ---------- Attentes ----------
// Canevas ECharts peints : plus d'espace réservé (avant hydratation), chaque graphique visible initialisé, canevas de taille non
// nulle avec des pixels non transparents, et même empreinte de pixels sur `need` relevés consécutifs (animation terminée).
function chartsPainted(need) {
  const w = window;
  const seen = (el) => el.getClientRects().length > 0 && el.offsetWidth > 0 && el.offsetHeight > 0;
  const fail = (why) => {
    w.__paCharts = { why, sig: null, n: 0 };
    return false;
  };
  if ([...document.querySelectorAll('[role="img"] > .animate-pulse')].some(seen)) return fail("espace réservé avant hydratation");
  if ([...document.querySelectorAll(".echarts-for-react:not([_echarts_instance_])")].some(seen)) return fail("graphique non initialisé");
  let sig = "";
  for (const box of document.querySelectorAll("[_echarts_instance_]")) {
    if (!seen(box)) continue;
    const layers = [...box.querySelectorAll("canvas")].filter((c) => c.width > 0 && c.height > 0);
    if (!layers.length) {
      const svg = box.querySelector("svg");
      if (svg && svg.childElementCount) {
        sig += `svg${svg.innerHTML.length};`;
        continue;
      }
      return fail("canevas absent ou de taille nulle");
    }
    let painted = false;
    let sum = 0;
    for (const c of layers) {
      const g = c.getContext("2d");
      if (!g) continue;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 28)
        if (d[i]) {
          painted = true;
          sum = (sum * 31 + d[i] + d[i - 1] * 3 + d[i - 2] * 5 + d[i - 3] * 7) % 2147483647;
        }
    }
    if (!painted) return fail("canevas encore vide");
    sig += `${layers.length}:${box.offsetWidth}x${box.offsetHeight}:${sum};`;
  }
  const prev = w.__paCharts;
  const n = prev && prev.sig === sig ? prev.n + 1 : 1;
  w.__paCharts = { why: "animation en cours", sig, n };
  return n >= need;
}

async function waitCharts(page, label, { need = 3, timeout = 25_000 } = {}) {
  await page.evaluate(() => {
    window.__paCharts = undefined;
  });
  try {
    await page.waitForFunction(chartsPainted, need, { polling: 250, timeout });
  } catch {
    const why = await page.evaluate(() => window.__paCharts?.why ?? "?").catch(() => "?");
    warn(`${label} : graphiques non stabilisés après ${timeout / 1000} s (${why}), capture prise quand même`);
  }
}

async function ready(page, label) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 30_000 })
    .catch(() => warn(`${label} : aria-busy encore présent après 30 s`));
  await page.locator("main h1").first().waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function scrollTo(page, top) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

const shoot = (page, file, opts = {}) => page.screenshot({ path: path.join(OUT, file), animations: "disabled", ...opts });

// Sommaire collant (OnThisPage) en haut de page dès lg : marge pour ne pas masquer le titre du visuel
const leadOf = (width) => (width >= 1024 ? 64 : 12);

function chartStops(lead) {
  const vh = window.innerHeight;
  const max = Math.max(0, document.scrollingElement.scrollHeight - vh);
  const at = (top) => Math.max(0, Math.min(max, Math.round(top - lead)));
  const cards = [...document.querySelectorAll("[_echarts_instance_]")]
    .filter((el) => el.getClientRects().length > 0 && el.offsetHeight >= 120)
    .map((el) => {
      const r = (el.closest("section") ?? el).getBoundingClientRect();
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
    })
    .sort((a, b) => a.top - b.top);
  if (!cards.length) return { charts: 0, stops: [0, max] };
  const first = at(cards[0].top);
  const next = cards.find((c) => c.top > first + lead + 1 && c.bottom > first + vh);
  return { charts: cards.length, stops: [first, next ? at(next.top) : max] };
}

async function sectionTop(page, selector, lead) {
  return page.evaluate(
    ([sel, l]) => {
      const el = document.querySelector(sel);
      const box = (el?.closest("section") ?? el)?.getBoundingClientRect();
      return box ? Math.max(0, Math.round(box.top + window.scrollY - l)) : 0;
    },
    [selector, lead],
  );
}

// ---------- Vues ----------
const FRAMES = {
  async haut(page, s, file) {
    await scrollTo(page, 0);
    await shoot(page, file);
  },
  async pleine(page, s, file) {
    await scrollTo(page, 0);
    await shoot(page, file, { fullPage: true });
  },
  async "graphiques-1"(page, s, file, st) {
    st.charts ??= await page.evaluate(chartStops, leadOf(s.width));
    if (!st.charts.charts) warn(`${file} : aucun graphique ECharts visible sur la page`);
    await scrollTo(page, st.charts.stops[0]);
    await shoot(page, file);
  },
  async "graphiques-2"(page, s, file, st) {
    st.charts ??= await page.evaluate(chartStops, leadOf(s.width));
    await scrollTo(page, st.charts.stops[1]);
    await shoot(page, file);
  },
  async bas(page, s, file) {
    await scrollTo(page, await page.evaluate(() => document.scrollingElement.scrollHeight));
    await shoot(page, file);
  },
  async hierarchie(page, s, file) {
    await scrollTo(page, await sectionTop(page, "#org-main-title", leadOf(s.width)));
    await shoot(page, file);
  },
  async liste(page, s, file) {
    await page.getByRole("group", { name: "Affichage" }).getByRole("button", { name: "Liste" }).click();
    const list = page.locator('ul[aria-label="Organigramme en liste"]');
    await list.waitFor({ timeout: 15_000 });
    // Parcours au clavier : droite = déplier, puis premier enfant (anneau de focus visible)
    await list.locator("summary[data-tree]").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await scrollTo(page, await sectionTop(page, "#org-main-title", leadOf(s.width)));
    await shoot(page, file);
  },
  async survol(page, s, file) {
    await scrollTo(page, 0);
    await page.locator('#menu-lateral a[href="/absenteeism"]').hover();
    await page
      .locator(".on-navy > span.fixed")
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => warn(`${file} : bulle du menu réduit non affichée au survol`));
    await page.waitForTimeout(200);
    await shoot(page, file);
  },
  async entete(page, s, file) {
    await scrollTo(page, 0);
    await page.locator("header").first().screenshot({ path: path.join(OUT, file), animations: "disabled" });
  },
  async "entete-ouvert"(page, s, file) {
    await scrollTo(page, 0);
    const header = page.locator("header").first();
    await header.locator('button[aria-haspopup="menu"][title^="Thème"]').click();
    await page.locator('[role="menu"][aria-label="Thème d\'affichage"]').waitFor({ timeout: 5_000 });
    const box = await header.boundingBox();
    await shoot(page, file, { clip: { x: box.x, y: box.y, width: box.width, height: box.height + 180 } });
    await page.keyboard.press("Escape");
  },
  async palette(page, s, file) {
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Recherche rapide" });
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.getByRole("combobox").fill("abs");
    await page.waitForTimeout(1200);
    await shoot(page, file);
  },
  async toast(page, s, file) {
    // Toast d'erreur sans écriture en base : identifiant déjà pris
    const form = page.getByRole("form", { name: "Créer un compte" });
    await form.getByLabel("Identifiant").fill("admin");
    await form.getByRole("button", { name: "Créer le compte" }).click();
    await page
      .getByText("Compte non créé")
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => warn(`${file} : toast « Compte non créé » non affiché`));
    await page.waitForTimeout(700);
    await shoot(page, file);
  },
  // Ctrl+P en thème sombre : emulateMedia applique print.css (pastilles --pa-chart-* ramenées au clair) ; beforeprint, que Chrome
  // émet à l'impression mais pas emulateMedia, fait repasser ThemeSync en clair et redessiner les canevas.
  async impression(page, s, file) {
    await page.evaluate(() => document.querySelectorAll("canvas").forEach((c) => c.setAttribute("data-pa-avant-impression", "")));
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (theme !== "light") warn(`${file} : data-theme=${theme} après beforeprint (ThemeSync n'est pas repassé en clair)`);
    await page
      .waitForFunction(() => ![...document.querySelectorAll("[_echarts_instance_] canvas[data-pa-avant-impression]")].some((c) => c.getClientRects().length > 0), null, {
        polling: 250,
        timeout: 15_000,
      })
      .catch(() => warn(`${file} : des canevas n'ont pas été redessinés après le passage en clair`));
    await waitCharts(page, file, { need: 3, timeout: 15_000 });
    await scrollTo(page, 0);
    // Pleine page : en impression, menu et en-tête masqués, éléments collants rendus statiques (print.css)
    await shoot(page, file, { fullPage: true });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: null });
  },
};

// ---------- Connexion ----------
async function seedE2eAccount(u) {
  const url = new URL(BASE);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === (process.env.E2E_PORT ?? "3200");
  if (!local || !fs.existsSync(E2E_DB)) {
    warn(`${u.login} : mot de passe non posé (BASE n'est pas le serveur E2E sur data/e2e.db), connexion tentée telle quelle`);
    return;
  }
  const Database = require("better-sqlite3");
  const { hash, verify } = require("@node-rs/argon2");
  const db = new Database(E2E_DB, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const row = db.prepare("SELECT id, password_hash FROM app_user WHERE login = ? AND role = 'MANAGER'").get(u.login);
    if (!row) throw new Error(`${u.login} absent de data/e2e.db`);
    const ok = row.password_hash ? await verify(row.password_hash, u.password).catch(() => false) : false;
    const pwd = ok ? row.password_hash : await hash(u.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    db.prepare("UPDATE app_user SET password_hash = ?, active = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(pwd, row.id);
    if (!ok) console.log(`${u.login} : mot de passe de démonstration posé dans data/e2e.db (copie recréée à chaque lancement du serveur E2E)`);
  } finally {
    db.close();
  }
}

async function login(browser, role) {
  const u = USERS[role];
  if (u.seedE2e) await seedE2eAccount(u);
  const ctx = await browser.newContext({ baseURL: BASE, locale: "fr-FR" });
  try {
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Identifiant").fill(u.login);
    await page.getByLabel("Mot de passe", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL((url) => url.pathname.startsWith(u.home), { timeout: 60_000 });
    return await ctx.storageState();
  } finally {
    await ctx.close();
  }
}

async function waitServer() {
  const until = Date.now() + 180_000;
  for (;;) {
    try {
      const r = await fetch(new URL("/login", BASE), { redirect: "manual" });
      if (r.status < 500) return;
    } catch {}
    if (Date.now() > until) throw new Error(`Serveur injoignable sur ${BASE} : lancer d'abord E2E_SKIP_BUILD=1 node tests/e2e/server.mjs`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function openContext(browser, s, storageState) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    locale: "fr-FR",
    timezoneId: "Africa/Tunis",
    viewport: viewportOf(s.width),
    deviceScaleFactor: 1,
    colorScheme: s.theme === "sombre" ? "dark" : "light",
    storageState,
  });
  await ctx.addInitScript(
    ({ theme, rail }) => {
      try {
        localStorage.setItem("pa-theme", theme);
        if (rail) localStorage.setItem("pa-nav", "rail");
        else localStorage.removeItem("pa-nav");
      } catch {}
    },
    { theme: s.theme === "sombre" ? "dark" : "light", rail: s.nav === "rail" },
  );
  return ctx;
}

// ---------- Exécution ----------
const refused = new Map();

async function runShot(ctx, s) {
  const deny = `${s.role}|${s.path}`;
  if (refused.has(deny)) {
    skipped.push(`${s.id} : ${refused.get(deny)} (déjà constaté)`);
    console.log("ignorée", s.id, refused.get(deny));
    return;
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${s.id} : ${e.message}`));
  try {
    await page.setViewportSize(viewportOf(s.width));
    const resp = await page.goto(s.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await ready(page, s.id);
    const where = new URL(page.url()).pathname;
    const status = resp?.status() ?? 0;
    if (status === 403 || where === "/interdit" || (where === "/login" && s.path !== "/login")) {
      const why = status === 403 ? "réponse 403" : `redirigée vers ${where}`;
      refused.set(deny, why);
      skipped.push(`${s.id} : ${why}`);
      console.log("ignorée", s.id, why);
      return;
    }
    const html = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), nav: document.documentElement.getAttribute("data-nav") }));
    const wantTheme = s.theme === "sombre" ? "dark" : "light";
    if (html.theme !== wantTheme) warn(`${s.id} : data-theme=${html.theme}, attendu ${wantTheme}`);
    if (s.path !== "/login" && (html.nav === "rail") !== (s.nav === "rail")) warn(`${s.id} : data-nav=${html.nav ?? "absent"}, attendu ${s.nav === "rail" ? "rail" : "absent"}`);
    if (s.path === "/login") await page.waitForTimeout(1500);
    await waitCharts(page, s.id);
    const st = {};
    for (const [i, f] of s.frames.entries()) {
      const file = fileOf(s, f);
      try {
        if (i > 0) await waitCharts(page, file, { need: 2, timeout: 8_000 });
        await FRAMES[f](page, s, file, st);
        written.push(file);
        console.log("ok", file);
      } catch (e) {
        failures.push(`${file} : ${String(e?.message ?? e).split("\n")[0]}`);
        console.log("ÉCHEC", file, String(e?.message ?? e).split("\n")[0]);
      }
    }
  } catch (e) {
    for (const f of s.frames) failures.push(`${fileOf(s, f)} : ${String(e?.message ?? e).split("\n")[0]}`);
    console.log("ÉCHEC", s.id, String(e?.message ?? e).split("\n")[0]);
  } finally {
    await page.close();
  }
}

const { chromium } = require("@playwright/test");
const started = Date.now();
await waitServer();
const browser = await chromium.launch();
try {
  const states = {};
  for (const role of new Set(plan.map((s) => s.role).filter(Boolean))) {
    try {
      states[role] = await login(browser, role);
    } catch (e) {
      warn(`connexion impossible pour ${USERS[role].login} : ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
  // Un seul contexte ouvert à la fois (poste à 8 Go) : plan trié par rôle, thème et menu
  let ctx = null;
  let ctxKey = null;
  for (const s of plan) {
    if (s.role && !states[s.role]) {
      skipped.push(`${s.id} : pas de session pour ${USERS[s.role].login}`);
      continue;
    }
    const key = `${s.role}|${s.theme}|${s.nav}`;
    if (key !== ctxKey) {
      await ctx?.close();
      ctx = await openContext(browser, s, s.role ? states[s.role] : undefined);
      ctxKey = key;
    }
    await runShot(ctx, s);
  }
  await ctx?.close();
} finally {
  await browser.close();
}

const minutes = ((Date.now() - started) / 60_000).toFixed(1).replace(".", ",");
console.log(`\n${written.length} capture(s) écrite(s) sur ${planned} prévue(s), en ${minutes} min, dans ${path.relative(ROOT, OUT)}`);
if (skipped.length) console.log(`Ignorées (${skipped.length}) :\n  ${skipped.join("\n  ")}`);
if (warnings.length) console.log(`Avertissements (${warnings.length}) :\n  ${warnings.join("\n  ")}`);
if (pageErrors.length) console.log(`Erreurs de page (${pageErrors.length}) :\n  ${pageErrors.join("\n  ")}`);
if (failures.length) {
  console.log(`Échecs (${failures.length}) :\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}

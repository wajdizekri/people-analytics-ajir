import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Role } from "@/db/schema";

const state = vi.hoisted(() => ({
  pathname: "/alerts",
  rail: false,
  ctx: { role: "RH", login: "rh.demo" },
  inserted: [] as (() => unknown)[],
}));

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: () => {} }),
  useServerInsertedHTML: (cb: () => unknown) => void state.inserted.push(cb),
}));
vi.mock("@/components/layout/nav-rail", async (orig) => ({ ...(await orig<object>()), useNavRail: () => state.rail }));
vi.mock("@/lib/dal/context", () => ({ pageContext: async () => state.ctx }));
vi.mock("@/lib/dal/alerts", () => ({ countOpenAlerts: () => 3 }));
vi.mock("@/lib/dal/employees", () => ({ referenceDate: () => "2026-08-31" }));
vi.mock("@/app/login/actions", () => ({ logoutAction: async () => {} }));

const { Initials } = await import("@/components/ui");
const { NAV, Sidebar, MobileNav, NavToggle, BrandMark } = await import("@/components/layout/sidebar");
const { setNavRail, syncNavRail } = await import("@/components/layout/nav-rail");
const realRail = await vi.importActual<typeof import("@/components/layout/nav-rail")>("@/components/layout/nav-rail");
const { navScript, NAV_STORAGE_KEY } = await import("@/components/layout/nav-script");
const { default: AppLayout } = await import("@/app/(app)/layout");

const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const count = (m: string, re: RegExp) => (m.match(re) ?? []).length;

const navOf = (m: string) => /<nav[^>]*aria-label="Navigation principale"[^>]*>([\s\S]*?)<\/nav>/.exec(m)![1];
const links = (m: string) =>
  [...navOf(m).matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)].map((x) => ({ href: x[1], attrs: x[2], inner: x[3], text: text(x[3]) }));
const side = (role: Role, props: Record<string, unknown> = {}) => {
  const p = { role, alertCount: 0, dataDate: "31/08/2026", login: "rh.demo", roleLabel: "Responsable RH", ...props };
  return html(h(Sidebar, { ...p, avatar: h(Initials, { name: p.login }) }));
};
const layout = async (role: Role, login: string) => {
  state.ctx = { role, login };
  return html(await (AppLayout as unknown as (p: { children: ReactNode }) => Promise<ReactElement>)({ children: h("p", null, "contenu de la page") }));
};

afterEach(() => {
  state.pathname = "/alerts";
  state.rail = false;
  vi.unstubAllGlobals();
});

// Contraste WCAG 2.x d'un blanc translucide posé sur le fond du menu
const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
const token = (selector: string, name: string) => new RegExp(`${selector.replace(/[[\]"]/g, "\\$&")} \\{[^}]*--pa-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)![1];
const LIGHT = ":root";
const DARK = '[data-theme="dark"]';
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);

const EXPECTED: Record<Role, { sections: string[]; items: [string, string][] }> = {
  RH: {
    sections: ["Vue d'ensemble", "Collaborateurs", "Analyses", "Données et modèle", "Aide et compte"],
    items: [
      ["/dashboard", "Tableau de bord"], ["/powerbi", "Power BI"], ["/synthese", "Synthèse du mois"], ["/alerts", "Alertes"],
      ["/employees", "Collaborateurs"], ["/equipes", "Équipes"], ["/organigramme", "Organigramme"], ["/recommendations", "Recommandations"], ["/interventions", "Interventions"],
      ["/absenteeism", "Absentéisme"], ["/formations", "Formations"], ["/charge", "Charge de travail"], ["/retention", "Rétention"], ["/previsions", "Prévisions effectifs"],
      ["/data-health", "Santé des données"], ["/transparency", "Transparence du modèle"], ["/derive", "Dérive des données"], ["/backtesting", "Vérification a posteriori"], ["/confidentialite", "Droit d'accès"],
      ["/aide", "Aide"], ["/compte", "Mon compte"],
    ],
  },
  MANAGER: {
    sections: ["Vue d'ensemble", "Collaborateurs", "Analyses", "Aide et compte"],
    items: [
      ["/dashboard", "Tableau de bord"], ["/powerbi", "Power BI"], ["/synthese", "Synthèse du mois"], ["/alerts", "Alertes"],
      ["/employees", "Mon équipe"], ["/equipes", "Mes équipes"], ["/organigramme", "Organigramme"],
      ["/absenteeism", "Absentéisme"], ["/formations", "Formations"], ["/charge", "Charge de travail"], ["/retention", "Rétention"],
      ["/aide", "Aide"], ["/compte", "Mon compte"],
    ],
  },
  ADMIN: {
    sections: ["Administration", "Données et modèle", "Aide et compte"],
    items: [
      ["/admin", "Console"], ["/alerts", "Alertes"], ["/admin/users", "Utilisateurs et accès"], ["/admin/settings", "Paramètres"], ["/powerbi", "Power BI"], ["/admin/audit", "Journal d'audit"],
      ["/data-health", "Santé des données"], ["/transparency", "Transparence du modèle"], ["/derive", "Dérive des données"],
      ["/aide", "Aide"], ["/compte", "Mon compte"],
    ],
  },
};
const ROLES = Object.keys(EXPECTED) as Role[];

describe("menu latéral : entrées par rôle", () => {
  it("libellés, chemins, ordre et sections inchangés pour chaque rôle", () => {
    for (const role of ROLES) {
      const m = side(role);
      expect(links(m).map((l) => [l.href, l.text]), role).toEqual(EXPECTED[role].items);
      expect([...navOf(m).matchAll(/<p id="side-nav-\d+"[^>]*>([^<]+)<\/p>/g)].map((x) => text(x[1])), role).toEqual(EXPECTED[role].sections);
      expect(count(m, /aria-label="Navigation principale"/g), role).toBe(1);
    }
    expect(NAV.map((s) => s.section)).toEqual(["Vue d'ensemble", "Collaborateurs", "Analyses", "Administration", "Données et modèle", "Aide et compte"]);
  });

  it("chaque liste est reliée à son titre de section", () => {
    const m = side("RH");
    const ids = [...m.matchAll(/<ul aria-labelledby="([^"]+)"/g)].map((x) => x[1]);
    expect(ids).toHaveLength(5);
    for (const id of ids) expect(m).toContain(`<p id="${id}"`);
  });

  it("page ouverte : une seule entrée marquée, sous-pages comprises, « Console » en correspondance exacte", () => {
    const current = (m: string) => links(m).filter((l) => l.attrs.includes('aria-current="page"')).map((l) => l.href);
    expect(current(side("RH"))).toEqual(["/alerts"]);
    state.pathname = "/employees/12";
    expect(current(side("RH"))).toEqual(["/employees"]);
    state.pathname = "/admin/users";
    expect(current(side("ADMIN"))).toEqual(["/admin/users"]);
    state.pathname = "/admin";
    expect(current(side("ADMIN"))).toEqual(["/admin"]);
    const active = links(side("ADMIN")).find((l) => l.href === "/admin")!;
    expect(active.attrs).toMatch(/class="[^"]*bg-white[^"]*font-semibold[^"]*before:bg-accent/);
    expect(links(side("ADMIN")).find((l) => l.href === "/alerts")!.attrs).not.toMatch(/font-semibold|before:bg-accent/);
  });

  it("lisibilité : lignes d'au moins 40 px, une icône de 20 px dessinée pour chaque entrée", () => {
    for (const role of ROLES) {
      for (const l of links(side(role))) {
        expect(l.attrs, l.href).toMatch(/class="[^"]*\btext-sm\b[^"]*\bmin-h-10\b/);
        expect(l.inner, l.href).toMatch(/^<svg aria-hidden="true"[^>]*class="h-5 w-5 shrink-0[^"]*"[^>]*stroke-width="1.75"/);
        expect(l.inner, l.href).not.toContain("M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z");
      }
    }
    const paths = links(side("RH")).map((l) => /<path d="([^"]+)"/.exec(l.inner)![1]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("compteur d'alertes : nombre, texte pour lecteur d'écran, plafond 99+, absent à zéro", () => {
    expect(text(side("RH", { alertCount: 35 }))).toContain("Alertes 35 alertes ouvertes");
    expect(text(side("RH", { alertCount: 1 }))).toContain("Alertes 1 alerte ouverte");
    expect(text(side("ADMIN", { alertCount: 120 }))).toContain("Alertes 99+ alertes ouvertes");
    expect(text(side("RH"))).not.toMatch(/alertes? ouvertes?/);
    expect(links(side("RH", { alertCount: 35 })).filter((l) => /ouvertes/.test(l.text)).map((l) => l.href)).toEqual(["/alerts"]);
  });
});

describe("menu réduit (rail)", () => {
  it("déployé par défaut au rendu serveur, sans lecture du navigateur", () => {
    const Probe = () => h("i", null, String(realRail.useNavRail()));
    expect(html(h(Probe, null))).toBe("<i>false</i>");
    const m = side("RH");
    expect(m).toMatch(/^<div class="[^"]*\bw-64\b[^"]*\bmotion-reduce:transition-none\b[^"]*in-data-\[nav=rail\]:w-16/);
    expect(m).toMatch(/transition-\[width\] duration-200/);
  });

  it("libellés toujours présents pour les lecteurs d'écran, masqués visuellement par le rail seulement", () => {
    state.rail = true;
    const m = side("RH", { alertCount: 35 });
    expect(links(m).map((l) => l.text.replace(/ 35 alertes ouvertes$/, ""))).toEqual(EXPECTED.RH.items.map((i) => i[1]));
    for (const l of links(m)) {
      const label = /<span class="([^"]*)">[^<]+<\/span>/.exec(l.inner)![1];
      expect(label, l.href).toContain("in-data-[nav=rail]:sr-only");
      expect(label, l.href).not.toMatch(/(^| )hidden\b|in-data-\[nav=rail\]:hidden/);
    }
    expect(text(m)).toContain("Alertes 35 alertes ouvertes");
    expect(m).toMatch(/<p id="side-nav-0" class="[^"]*in-data-\[nav=rail\]:sr-only/);
    expect(text(m)).toContain("Compte connecté : rh.demo Responsable RH");
    expect(text(m)).toContain("People Analytics");
  });

  it("bouton de l'en-tête : état annoncé, menu désigné, libellé selon l'état", () => {
    const open = html(h(NavToggle, null));
    expect(open).toMatch(/<button type="button" aria-expanded="true" aria-controls="menu-lateral" title="Réduire le menu"/);
    expect(text(open)).toBe("Réduire le menu");
    expect(side("RH")).toMatch(/<nav id="menu-lateral" aria-label="Navigation principale"/);
    state.rail = true;
    const closed = html(h(NavToggle, null));
    expect(closed).toContain('aria-expanded="false"');
    expect(text(closed)).toBe("Déployer le menu");
    expect(closed).toMatch(/class="hidden [^"]*md:inline-flex/);
  });

  it("script avant affichage : pose data-nav=rail seulement si le choix est enregistré, jamais d'erreur", () => {
    const run = (getItem: () => string | null) => {
      const attrs: Record<string, string> = {};
      new Function("document", "localStorage", navScript)({ documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } }, { getItem });
      return attrs;
    };
    expect(NAV_STORAGE_KEY).toBe("pa-nav");
    expect(run(() => "rail")).toEqual({ "data-nav": "rail" });
    expect(run(() => null)).toEqual({});
    expect(run(() => "n'importe quoi")).toEqual({});
    expect(
      run(() => {
        throw new Error("stockage bloqué");
      }),
    ).toEqual({});
  });

  it("choix mémorisé dans localStorage (pa-nav), appliqué sur <html>, toléré si le stockage est indisponible", () => {
    const attrs = new Map<string, string>();
    const store = new Map<string, string>();
    vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } });
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    setNavRail(true);
    expect([store.get("pa-nav"), attrs.get("data-nav")]).toEqual(["rail", "rail"]);
    attrs.clear();
    syncNavRail();
    expect(attrs.get("data-nav")).toBe("rail");
    setNavRail(false);
    expect([store.has("pa-nav"), attrs.has("data-nav")]).toEqual([false, false]);
    const blocked = () => {
      throw new Error("stockage bloqué");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    setNavRail(true);
    expect(attrs.get("data-nav")).toBe("rail");
    syncNavRail();
    expect(attrs.has("data-nav")).toBe(false);
  });
});

describe("pied du menu, marque et thèmes", () => {
  it("pied : date des données et compte connecté ; rien sans ces informations", () => {
    const m = side("MANAGER", { login: "mgr.demo", roleLabel: "Manager" });
    const foot = m.slice(m.indexOf("</nav>"));
    expect(text(foot)).toBe("Données AJIR au 31/08/2026 MD Compte connecté : mgr.demo Manager");
    expect(foot).toMatch(/<p class="[^"]*in-data-\[nav=rail\]:hidden[^"]*">.*Données AJIR au/);
    const bare = html(h(Sidebar, { role: "RH", alertCount: 2 }));
    expect(text(bare.slice(bare.indexOf("</nav>")))).toBe("");
  });

  it("aucune balise <header> dans le menu (le premier <header> de la page est l'en-tête de l'application)", () => {
    expect(side("RH")).not.toMatch(/<header/);
    expect(html(h(MobileNav, { role: "RH", alertCount: 0 }))).not.toMatch(/<header/);
  });

  it("couleurs : jetons ou variantes dark:, aucune teinte fixe de palette", () => {
    const all = [side("RH", { alertCount: 3 }), html(h(MobileNav, { role: "RH", alertCount: 3, dataDate: "31/08/2026", login: "rh.demo", roleLabel: "Responsable RH" })), html(h(BrandMark, { light: true }))].join("");
    expect(all).not.toMatch(/(text|bg|border|ring)-(sky|emerald|slate|gray|red|amber|fuchsia)-\d/);
    expect(all).not.toMatch(/brand-(orange|navy|blue)/);
    const light = html(h(BrandMark, { light: true }));
    expect(light).toContain("text-heading");
    expect(light).toContain("text-fg-muted");
    expect(light).not.toContain("text-white");
    expect(light).not.toContain("in-data-[nav=rail]");
    expect(html(h(BrandMark, null))).toContain("text-white");
  });

  it("contrastes AA sur le fond du menu, thèmes clair et sombre", () => {
    const m = side("RH", { alertCount: 3 });
    const alphas = [...m.matchAll(/[\s"]text-white\/(\d+)/g)].map((x) => Number(x[1]) / 100);
    expect(alphas.length).toBeGreaterThan(20);
    const weakest = Math.min(...alphas);
    for (const [name, theme] of [["clair", LIGHT], ["sombre", DARK]] as const) {
      const bg = rgb(token(theme, "nav"));
      expect(ratio(over([255, 255, 255], weakest, bg), bg), `${name} texte le plus discret`).toBeGreaterThanOrEqual(4.5);
      expect(ratio([255, 255, 255], over([255, 255, 255], 0.1, bg)), `${name} survol`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(rgb(token(theme, "accent")), bg), `${name} barre et pastille`).toBeGreaterThanOrEqual(3);
      expect(ratio(rgb(token(theme, "accent-fg")), rgb(token(theme, "accent"))), `${name} compteur`).toBeGreaterThanOrEqual(4.5);
    }
    // Entrée active : fond blanc en clair, voile blanc à 14 % en sombre ; texte text-heading, icône text-link puis accent
    const darkActive = over([255, 255, 255], 0.14, rgb(token(DARK, "nav")));
    expect(m).toMatch(/aria-current="page" class="[^"]*bg-white[^"]*text-heading[^"]*dark:bg-white\/\[0\.14\]/);
    expect(ratio(rgb(token(LIGHT, "heading")), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(token(LIGHT, "link")), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(token(DARK, "heading")), darkActive)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(token(DARK, "accent")), darkActive)).toBeGreaterThanOrEqual(3);
  });
});

describe("menu mobile", () => {
  it("bouton de divulgation, panneau masqué, date des données et compte, variante claire en jetons", () => {
    const m = html(h(MobileNav, { role: "MANAGER", alertCount: 2, dataDate: "31/08/2026", login: "mgr.demo", roleLabel: "Manager" }));
    expect(m).toMatch(/<button type="button" aria-expanded="false" aria-controls="menu-mobile"/);
    expect(m).toMatch(/<div id="menu-mobile" hidden=""/);
    expect(text(m)).toContain("Menu de navigation");
    expect(text(m)).toContain("Données AJIR au 31/08/2026");
    expect(text(m)).toContain("Compte connecté : mgr.demo · Manager");
    expect(links(m).map((l) => [l.href, l.text.replace(/ 2 alertes ouvertes$/, "")])).toEqual(EXPECTED.MANAGER.items);
    const active = links(m).find((l) => l.attrs.includes('aria-current="page"'))!;
    expect(active.href).toBe("/alerts");
    expect(active.attrs).toMatch(/class="[^"]*\bmin-h-11\b[^"]*bg-primary-soft[^"]*font-semibold[^"]*before:bg-accent/);
    expect(m).not.toContain("in-data-[nav=rail]");
    expect(m).not.toMatch(/text-white|bg-white/);
  });
});

describe("en-tête de l'application", () => {
  it("RH : un seul contrôle de recherche, date, thème, « Mon compte », « Déconnexion », lien d'évitement", async () => {
    const m = await layout("RH", "rh.demo");
    expect(count(m, /<header/g)).toBe(1);
    const head = /<header[\s\S]*<\/header>/.exec(m)![0];
    expect(count(head, /aria-haspopup="dialog"/g)).toBe(1);
    expect(head).not.toMatch(/role="search"|type="search"|recherche-entete|<input/);
    const search = /<button[^>]*aria-haspopup="dialog"[\s\S]*?<\/button>/.exec(head)![0];
    expect(search).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(text(search)).toBe("Recherche rapide Rechercher un collaborateur, une page… Ctrl K");
    const hintId = /aria-describedby="([^"]+)"/.exec(search)![1];
    expect(search).toMatch(new RegExp(`<span id="${hintId}" aria-hidden="true"[^>]*>Rechercher un collaborateur, une page…</span>`));
    expect(text(head)).toContain("Données AJIR au 31/08/2026");
    expect(head).toMatch(/aria-haspopup="menu"[^>]*title="Thème : /);
    expect(text(/<a href="\/compte" title="Mon compte"[\s\S]*?<\/a>/.exec(head)![0])).toBe("Mon compte : RD rh.demo Responsable RH");
    expect(text(/<button type="submit"[\s\S]*?<\/button>/.exec(head)![0])).toBe("Déconnexion");
    expect(head).toMatch(/aria-expanded="true" aria-controls="menu-lateral"/);
    expect(m).toMatch(/<a href="#contenu"[^>]*>Aller au contenu<\/a>/);
    expect(m).toMatch(/<main id="contenu" tabindex="-1"/);
    expect(text(m)).toContain("contenu de la page");
    expect(m.indexOf('href="#contenu"')).toBeLessThan(m.indexOf("<nav"));
  });

  it("ADMIN et manager : identité dans l'en-tête, aucune invite à chercher un collaborateur pour l'ADMIN", async () => {
    const admin = await layout("ADMIN", "admin");
    const head = /<header[\s\S]*<\/header>/.exec(admin)![0];
    expect(text(head)).toContain("Rechercher une page, une alerte…");
    expect(head).not.toMatch(/collaborateur/i);
    expect(text(head)).toContain("Mon compte : A admin Administrateur");
    expect(links(admin).map((l) => l.text.replace(/ 3 alertes ouvertes$/, ""))).toEqual(EXPECTED.ADMIN.items.map((i) => i[1]));
    const mgr = await layout("MANAGER", "mgr.demo");
    expect(text(/<header[\s\S]*<\/header>/.exec(mgr)![0])).toContain("Mon compte : MD mgr.demo Manager");
    expect(text(mgr)).toContain("Rechercher un collaborateur, une page…");
  });

  it("script du menu réduit : inséré une fois dans <head> au rendu serveur, jamais dans l'arbre de la page", async () => {
    state.inserted.length = 0;
    const m = await layout("RH", "rh.demo");
    expect(m).not.toContain("pa-nav");
    expect(state.inserted).toHaveLength(1);
    expect(html(state.inserted[0]())).toBe(`<script>${navScript}</script>`);
    expect(state.inserted[0]()).toBeNull();
  });
});

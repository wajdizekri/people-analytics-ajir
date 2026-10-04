import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

const ui = await import("@/components/ui");
const { themeScript, THEME_STORAGE_KEY } = await import("@/components/ui/theme-script");
const { DARK_COLORS, SEMANTIC, BAND_FILL, darkOption, cssChartColor, bestTextOn } = await import("@/components/charts/theme");
const { chartTheme, LIGHT_TOKENS, readChartTokens } = await import("@/components/charts/echart");

const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

// Contraste WCAG 2.x
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const tokens = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  const body = css.slice(i, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--pa-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
};

describe("thème clair / sombre", () => {
  // Exécute le script en ligne contre un faux document : choix enregistré, défaut système, suivi des changements
  function run(stored: string | null, systemDark: boolean) {
    const attrs: Record<string, string> = {};
    const listeners: Record<string, () => void> = {};
    const mql = { matches: systemDark, addEventListener: (_: string, cb: () => void) => (listeners.media = cb) };
    const doc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    const win = { matchMedia: () => mql, addEventListener: (_: string, cb: (e: { key: string }) => void) => (listeners.storage = () => cb({ key: THEME_STORAGE_KEY })) };
    const storage = { value: stored, getItem: () => storage.value };
    new Function("document", "window", "localStorage", themeScript)(doc, win, storage);
    return { attrs, mql, listeners, storage };
  }

  it("script avant affichage : choix enregistré, sinon thème du système, et suivi des changements", () => {
    expect(run("dark", false).attrs).toEqual({ "data-theme": "dark", "data-theme-pref": "dark" });
    expect(run("light", true).attrs["data-theme"]).toBe("light");
    const sys = run(null, true);
    expect(sys.attrs).toEqual({ "data-theme": "dark", "data-theme-pref": "system" });
    sys.mql.matches = false;
    sys.listeners.media();
    expect(sys.attrs["data-theme"]).toBe("light");
    sys.storage.value = "dark";
    sys.listeners.storage();
    expect(sys.attrs["data-theme"]).toBe("dark");
    expect(run("n'importe quoi", false).attrs["data-theme-pref"]).toBe("system");
  });

  it("ThemeToggle : menu à cocher étiqueté (en-tête) et boutons radio (Mon compte), état annoncé", () => {
    const m = html(h(ui.ThemeToggle, null));
    expect(m).toContain('aria-haspopup="menu"');
    expect(m).toContain('role="menu"');
    expect(m.match(/role="menuitemradio"/g)).toHaveLength(3);
    expect(m).toContain('aria-checked="true"');
    expect(text(m)).toContain("Thème : Système");
    expect(m).toContain('role="status"');
    const s = html(h(ui.ThemeToggle, { variant: "segmented" }));
    expect(s).toMatch(/<fieldset[^>]*><legend[^>]*>Thème<\/legend>/);
    expect(s.match(/type="radio"/g)).toHaveLength(3);
    expect(text(s)).toContain("Clair Sombre Système");
  });

  it("jetons : contrastes WCAG AA dans les deux thèmes", () => {
    const light = tokens(":root");
    const dark = { ...light, ...tokens('[data-theme="dark"]') };
    const text45: [string, string][] = [
      ["fg", "canvas"], ["fg", "surface"], ["fg", "surface-2"], ["fg", "surface-3"],
      ["fg-muted", "canvas"], ["fg-muted", "surface"], ["fg-muted", "surface-2"], ["fg-muted", "surface-3"],
      ["fg-subtle", "canvas"], ["fg-subtle", "surface"], ["fg-subtle", "surface-2"],
      ["heading", "canvas"], ["heading", "surface"],
      ["link", "surface"], ["link", "canvas"], ["link", "primary-soft"],
      ["primary-fg", "primary"], ["primary-fg", "primary-hover"], ["accent-fg", "accent"],
      ["danger", "danger-soft"], ["warning", "warning-soft"], ["success", "success-soft"], ["info", "info-soft"],
      ["danger", "surface"], ["warning", "surface"], ["success", "surface"], ["info", "surface"],
    ];
    const ui3: [string, string][] = [["line-strong", "surface"], ["line-strong", "canvas"], ["focus", "surface"], ["focus", "canvas"]];
    for (const [name, t] of [["clair", light], ["sombre", dark]] as const) {
      for (const [f, b] of text45) expect(ratio(t[f], t[b]), `${name} ${f}/${b}`).toBeGreaterThanOrEqual(4.5);
      for (const [f, b] of ui3) expect(ratio(t[f], t[b]), `${name} ${f}/${b}`).toBeGreaterThanOrEqual(3);
      for (const k of ["danger-solid", "danger-solid-hover", "nav"]) expect(ratio("#ffffff", t[k]), `${name} blanc/${k}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("graphiques en thème sombre", () => {
  it("palette sombre ≥ 3:1 sur la surface sombre, variables CSS alignées sur DARK_COLORS", () => {
    const surface = tokens('[data-theme="dark"]').surface;
    for (const tone of Object.values(SEMANTIC)) expect(ratio(DARK_COLORS[tone], surface), tone).toBeGreaterThanOrEqual(3);
    for (const [light, dark] of Object.entries(DARK_COLORS)) {
      if (!/^#[0-9a-f]{6}$/.test(light)) continue;
      expect(css, light).toContain(`--pa-chart-${light.slice(1)}: ${dark};`);
    }
    expect(cssChartColor(SEMANTIC.defavorable)).toBe("var(--pa-chart-b91c1c, #b91c1c)");
    expect(cssChartColor("#123456")).toBe("#123456");
  });

  it("darkOption : couleurs remappées sans toucher l'option d'origine, étiquettes intérieures recontrastées", () => {
    const option = {
      tooltip: { backgroundColor: "#ffffff", textStyle: { color: "#0f172a" } },
      series: [
        { type: "bar", name: "Élevé", itemStyle: { color: SEMANTIC.defavorable }, label: { show: true, position: "inside", color: "#ffffff" }, data: [1, 2] },
        { type: "line", name: "Bande", areaStyle: { color: BAND_FILL }, data: [{ value: 3, itemStyle: { color: SEMANTIC.attention } }] },
      ],
    };
    type S = { name: string; itemStyle: { color: string }; label: { color: string }; areaStyle: { color: string }; data: { itemStyle: { color: string } }[] };
    const d = darkOption(option) as unknown as { darkMode: boolean; tooltip: typeof option.tooltip; series: S[] };
    const [s0, s1] = [d.series[0]!, d.series[1]!];
    expect(d.darkMode).toBe(true);
    expect(d.tooltip.backgroundColor).toBe("#111a2b");
    expect(d.tooltip.textStyle.color).toBe("#e6edf7");
    expect(s0.itemStyle.color).toBe("#f87171");
    expect(s0.label.color).toBe(bestTextOn("#f87171"));
    expect(ratio(s0.label.color, "#f87171")).toBeGreaterThanOrEqual(4.5);
    expect(s1.areaStyle.color).not.toBe(BAND_FILL);
    expect(s1.data[0]!.itemStyle.color).toBe("#fbbf24");
    expect(option.series[0]!.itemStyle!.color).toBe(SEMANTIC.defavorable);
    expect(s1.name).toBe("Bande");
  });

  it("thème ECharts construit à partir des jetons (clair par défaut, sombre remappé)", () => {
    const light = chartTheme(LIGHT_TOKENS);
    expect(light.tooltip.backgroundColor).toBe("#ffffff");
    expect(light.valueAxis.splitLine.lineStyle.color).toBe(LIGHT_TOKENS.grid);
    const darkTokens = readChartTokens(true);
    const dark = chartTheme(darkTokens, true);
    expect(dark.darkMode).toBe(true);
    expect(dark.tooltip.backgroundColor).toBe("#111a2b");
    expect(ratio(darkTokens.muted, "#111a2b")).toBeGreaterThanOrEqual(4.5);
    expect(dark.color[0]).toBe(DARK_COLORS[SEMANTIC.neutre]);
  });
});

describe("toasts", () => {
  it("Toaster : deux zones annoncées (assertive pour les erreurs, polite pour le reste) présentes dès le rendu", () => {
    const m = html(h(ui.Toaster, null));
    expect(m).toContain('aria-live="assertive"');
    expect(m).toContain('aria-live="polite"');
  });

  it("toast.success|error|info renvoient un identifiant ; un id fourni remplace la notification", () => {
    const a = ui.toast.success("Paramètres enregistrés.", { description: "Effet au prochain calcul." });
    const b = ui.toast.error("Échec de l'import.");
    expect(a).not.toBe(b);
    expect(ui.toast.info("Import lancé.", { id: "import" })).toBe("import");
    expect(ui.toast("Import terminé.", { id: "import" })).toBe("import");
    ui.toast.dismiss();
  });
});

describe("formateurs communs (revue transverse T4, T6, T13)", () => {
  it("noms, mois, élision, modèle en mots", async () => {
    expect(ui.fmt.person("Trabelsi", "Wassim")).toBe("Trabelsi Wassim");
    expect(ui.fmt.person(null, null)).toBe("—");
    expect(ui.fmt.month("2026-08")).toBe("août 2026");
    expect(ui.fmt.month("2025-09-30", { short: true })).toBe("sept. 2025");
    expect(ui.fmt.ofMonth("2026-08")).toBe("d'août 2026");
    expect(ui.fmt.ofMonth("2026-09")).toBe("de septembre 2026");
    expect(ui.fmt.de("Amri Nadia")).toBe("d'Amri Nadia");
    expect(ui.fmt.de("Souissi Hazem")).toBe("de Souissi Hazem");
    expect(ui.fmt.model("logreg-v1-20260930", "2026-09-30")).toBe("modèle mis en service le 30/09/2026");
    expect(ui.fmt.model("abs-ridge-v1-20260930")).toBe("modèle du 30/09/2026");
    expect(ui.fmt.model("modele-maison", null)).toBe("modèle en service");
    const { monthCategories } = await import("@/components/charts/pbi");
    expect(monthCategories(["2025-12", "2026-01"])).toEqual(["déc. 2025", "janv. 2026"]);
  });
});

describe("squelettes", () => {
  it("SkeletonPage : une seule annonce « Chargement », formes décoratives, 4 variantes", () => {
    for (const variant of ["dashboard", "liste", "rapport", "fiche"] as const) {
      const m = html(h(ui.SkeletonPage, { variant }));
      expect(m.match(/role="status"/g), variant).toHaveLength(1);
      expect(m).toContain('aria-busy="true"');
      expect(text(m)).toBe("Chargement de la page…");
      expect(m).toContain("animate-pulse");
    }
    expect(html(h(ui.SkeletonTable, { rows: 3, columns: 4 }))).toContain('aria-hidden="true"');
    expect(html(h(ui.SkeletonKpiRow, { count: 3 })).match(/rounded-card/g)).toHaveLength(3);
  });
});

describe("DataTable", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    href: `/employees/${i}`,
    cells: { nom: `Collaborateur ${i}`, anciennete: `${i} ans` },
    sort: { nom: `Collaborateur ${i}`, anciennete: i },
  }));
  const columns = [
    { key: "nom", label: "Nom" },
    { key: "anciennete", label: "Ancienneté (ans)", numeric: true },
  ];

  it("tri annoncé, nombres à droite, lien réel, pagination « 1–25 sur 30 », vue en cartes", () => {
    const m = html(h(ui.DataTable, { columns, rows, caption: "Collaborateurs", defaultSort: { key: "anciennete", dir: "desc" } }));
    expect(m).toContain('aria-sort="descending"');
    expect(m).toMatch(/<caption[^>]*>Collaborateurs/);
    expect(m).toContain("sticky top-0");
    expect(m).toContain("text-right tabular-nums");
    expect(m.indexOf("Collaborateur 29")).toBeLessThan(m.indexOf("Collaborateur 28"));
    expect(m).toContain('href="/employees/29"');
    expect(text(m)).toContain("1–25 sur 30");
    expect(text(m)).toContain("Page suivante");
    expect(m).toMatch(/<ul aria-label="Collaborateurs" class="[^"]*sm:hidden/);
  });

  it("texte long en carte (cardBlock) et ligne cliquable sans envelopper la cellule (rowHref)", () => {
    const m = html(
      h(ui.DataTable, {
        caption: "Formations à risque",
        columns: [{ key: "nom", label: "Collaborateur" }, { key: "facteurs", label: "Principaux facteurs", cardBlock: true }],
        rows: [{ id: 1, rowHref: "/employees/1", cells: { nom: h("a", { href: "/employees/1" }, "Ali Ben Salah"), facteurs: "Ancienneté, absences" } }],
      }),
    );
    expect(m).toContain('data-href="/employees/1"');
    expect(m.match(/<a href="\/employees\/1"/g)).toHaveLength(2);
    expect(m).toMatch(/class="col-span-2[^"]*"><dt[^>]*>Principaux facteurs/);
  });

  it("ChartData : libellé de ligne en lien quand une vue filtrée existe (withDrillSpec)", async () => {
    const pbi = await import("@/components/charts/pbi");
    const m = html(h(pbi.ChartData, { caption: "x", table: { headers: ["Département", "Effectif"], rows: [["Production", "12"]], hrefs: ["/employees?departement=3"] } }));
    expect(m).toContain('href="/employees?departement=3"');
    expect(text(m)).toContain("Production");
  });

  it("aucune ligne : état vide fourni par la page", () => {
    const m = html(h(ui.DataTable, { columns, rows: [], caption: "Collaborateurs", empty: h(ui.EmptyState, { title: "Aucun collaborateur" }) }));
    expect(text(m)).toBe("Aucun collaborateur");
  });
});

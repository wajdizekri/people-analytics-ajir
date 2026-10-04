import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Chantier ergonomie (04/10/2026), agent UI : états, mobile et clavier des composants partagés
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

const ui = await import("@/components/ui");
const { chartTheme, LIGHT_TOKENS } = await import("@/components/charts/echart");

const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const classOf = (m: string, tag: string) => (new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(m)?.[1] ?? "").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// Classe de couleur de texte « text-fg » seule (pas text-fg-muted / text-fg-subtle)
const hasTextFg = (cls: string) => /(^|\s)text-fg(\s|$)/.test(cls);

describe("menus : élément destructif lisible, téléchargement, focus", () => {
  it("MenuButton / ConfirmButton destructifs : rouge sans classe concurrente text-fg (qui l'emporterait)", () => {
    const cls = classOf(html(h(ui.MenuButton, { danger: true, icon: "trash" }, "Supprimer le compte")), "button");
    expect(cls).toContain("text-danger");
    expect(cls).toContain("hover:bg-danger-soft");
    expect(hasTextFg(cls)).toBe(false);
    expect(cls).not.toContain("hover:bg-surface-3");
    const confirm = classOf(html(h(ui.ConfirmButton, { title: "Désactiver ?", consequence: "x", menuItem: true, onConfirm: () => {} }, "Désactiver")), "button");
    expect(confirm).toContain("text-danger");
    expect(hasTextFg(confirm)).toBe(false);
    expect(hasTextFg(ui.menuItemClass())).toBe(true);
    expect(ui.menuItemCls).toBe(ui.menuItemClass());
  });

  it("MenuLink : lien de téléchargement en <a download> (pas de navigation client), attributs transmis", () => {
    const m = html(h(ui.MenuLink, { href: "/api/export/alerts.csv", icon: "download", download: true }, "Exporter (CSV)"));
    expect(m).toMatch(/<a href="\/api\/export\/alerts\.csv" role="menuitem"[^>]*download=""/);
    expect(text(m)).toBe("Exporter (CSV)");
  });

  it("ActionBar : une action par ligne sous 640 px, en ligne au-delà ; bouton du menu pleine largeur", () => {
    const m = html(h(ui.ActionBar, { more: h(ui.MenuLink, { href: "/x" }, "Voir le journal") }, h(ui.ButtonLink, { href: "/y", variant: "primary" }, "Importer un export AJIR")));
    const bar = classOf(m, "div");
    expect(bar).toContain("flex-col");
    expect(bar).toContain("[&>*]:w-full");
    expect(bar).toContain("sm:flex-row");
    expect(bar).toContain("sm:[&>*]:w-auto");
    expect(m).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*class="[^"]*w-full/);
  });
});

describe("boutons : états", () => {
  it("raison de désactivation ajoutée à un aria-describedby fourni (au lieu de l'écraser)", () => {
    const m = html(h(ui.Button, { disabled: true, disabledReason: "Aucun fichier choisi.", "aria-describedby": "aide-import" }, "Importer"));
    const ids = /aria-describedby="([^"]+)"/.exec(m)?.[1].split(" ") ?? [];
    expect(ids[0]).toBe("aide-import");
    expect(ids).toHaveLength(2);
    expect(m).toContain(`id="${ids[1]}"`);
  });

  it("tertiaire désactivé : pas d'effet de survol", () => {
    expect(ui.buttonClass("tertiary")).toContain("disabled:hover:bg-transparent");
  });
});

describe("indicateurs : variation lisible sans la couleur", () => {
  it("KpiTile delta : flèche, sens écrit, texte, référence et jugement", () => {
    const m = html(h(ui.KpiTile, { label: "Absentéisme après l'action", value: "+0,4", unit: "pt", delta: { value: 0.4, label: "+0,4 pt", reference: "vs avant l'action", good: "down" } }));
    expect(text(m)).toContain("En hausse : +0,4 pt vs avant l'action à surveiller");
    expect(m).toMatch(/aria-hidden="true"[^>]*>▲/);
    expect(text(html(h(ui.KpiTile, { label: "x", value: "1", delta: { value: -2, label: "−2", good: "down" } })))).toContain("favorable");
    expect(text(html(h(ui.KpiTile, { label: "Effectif", value: "1 069", delta: { value: -9, label: "−9", good: "neutral" } })))).not.toMatch(/favorable|surveiller/);
    expect(text(html(h(ui.KpiTile, { label: "x", value: "1", delta: { value: 0, label: "0", good: "up" } })))).toContain("Stable : 0 stable");
  });

  it("KpiTile cliquable : lien (navigation client) avec « Voir le détail » souligné au survol", () => {
    const m = html(h(ui.KpiTile, { label: "Demandes ouvertes", value: "3", href: "/confidentialite?statut=OUVERTE" }));
    expect(m).toMatch(/<a href="\/confidentialite\?statut=OUVERTE" class="group /);
    expect(m).toContain("group-hover:underline");
    expect(text(m)).toContain("Voir le détail");
  });
});

describe("badges et messages en jetons", () => {
  it("Badge : tons sémantiques, anciens noms acceptés", () => {
    expect(html(h(ui.Badge, { tone: "success" }, "Actif"))).toContain("bg-success-soft text-success");
    expect(html(h(ui.Badge, { tone: "emerald" }, "Actif"))).toContain("bg-success-soft text-success");
    expect(html(h(ui.Badge, null, "Brouillon"))).toContain("bg-surface-3 text-fg-muted");
  });

  it("pastilles de statut en jetons (plus de couleurs Tailwind fixes)", () => {
    for (const tone of ["success", "info", "warning", "danger"] as const) {
      const m = html(h(ui.StatusBadge, { tone }, "x"));
      expect(m).toContain(`rounded-full bg-${tone}"`);
      expect(m).not.toMatch(/sky-|red-|amber-|emerald-/);
    }
    expect(html(h(ui.RiskBadge, { level: "MOYEN" }))).toContain("rounded-full bg-warning");
  });

  it("Notice avec action : l'action passe sous le texte sous 640 px, ordre de lecture inchangé", () => {
    const m = html(h(ui.Notice, { tone: "warning", title: "Calcul en retard", action: h(ui.ButtonLink, { href: "/data-health" }, "Voir la santé des données") }, "Le calcul de septembre n'est pas publié."));
    expect(m).toMatch(/<div class="w-full pl-7 sm:w-auto[^"]*"><a href="\/data-health"/);
    expect(text(m)).toBe("Calcul en retard Le calcul de septembre n'est pas publié. Voir la santé des données");
  });

  it("PageHeader : titre qui se coupe, liseré en jeton d'accent", () => {
    const m = html(h(ui.PageHeader, { title: "Recommandations", actions: h(ui.ActionBar, null, h(ui.ButtonLink, { href: "/x" }, "Exporter")) }));
    expect(m).toMatch(/<h1 class="[^"]*break-words/);
    expect(m).toContain("border-accent");
    expect(m).not.toContain("border-brand-orange");
  });
});

describe("DataTable : tri sur mobile et état vide de repli", () => {
  const columns = [
    { key: "nom", label: "Nom" },
    { key: "effectif", label: "Effectif", numeric: true },
  ];
  const rows = [
    { id: 1, cells: { nom: "Achats", effectif: "79" }, sort: { nom: "Achats", effectif: 79 } },
    { id: 2, cells: { nom: "Production", effectif: "304" }, sort: { nom: "Production", effectif: 304 } },
  ];

  it("vue en cartes : liste « Trier par » (masquée sur grand écran) reliée à son libellé, sens en mots", () => {
    const m = html(h(ui.DataTable, { columns, rows, caption: "Départements", defaultSort: { key: "effectif", dir: "desc" } }));
    const id = /<label for="([^"]+)"[^>]*>Trier par<\/label>/.exec(m)?.[1];
    expect(id).toBeTruthy();
    expect(m).toMatch(new RegExp(`<select id="${id}"`));
    expect(m).toMatch(/<div class="mb-2 flex items-center gap-2 sm:hidden">/);
    expect(m).toMatch(/<option value="effectif:desc" selected="">Effectif, décroissant<\/option>/);
    expect(text(m)).toContain("Nom, de A à Z");
    expect(m).not.toContain("Ordre initial");
    expect(html(h(ui.DataTable, { columns, rows, caption: "Départements" }))).toContain("Ordre initial");
  });

  it("pas de liste de tri sans colonne triable ni pour une seule ligne", () => {
    expect(html(h(ui.DataTable, { columns, rows: [rows[0]], caption: "x" }))).not.toContain("Trier par");
    expect(html(h(ui.DataTable, { columns, rows: rows.map((r) => ({ ...r, sort: undefined })), caption: "x" }))).not.toContain("Trier par");
  });

  it("aucune ligne et aucun état vide fourni : message au lieu d'un tableau muet", () => {
    expect(text(html(h(ui.DataTable, { columns, rows: [], caption: "Départements" })))).toBe("Départements : aucune ligne à afficher.");
  });
});

describe("menu « Plus d'actions »", () => {
  it("bouton étiqueté, menu masqué, éléments role=menuitem", () => {
    const m = html(h(ui.MoreActions, null, h(ui.MenuButton, { icon: "refresh" }, "Recalculer")));
    expect(m).toMatch(/<button type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="([^"]+)"/);
    expect(m).toMatch(/role="menu" aria-label="Plus d&#x27;actions" hidden=""/);
    expect(m).toContain('role="menuitem"');
  });
});

describe("graphiques sous 640 px", () => {
  it("infobulle plus étroite sur mobile (le point survolé reste visible)", () => {
    expect(chartTheme(LIGHT_TOKENS).tooltip.extraCssText).toContain("max-width:320px");
    expect(chartTheme(LIGHT_TOKENS, false, true).tooltip.extraCssText).toContain("max-width:260px");
  });
});

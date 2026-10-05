import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Role } from "@/db/schema";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/alerts", useRouter: () => ({ push: () => {} }) }));

const ui = await import("@/components/ui");
const pbi = await import("@/components/charts/pbi");
const { NAV, Sidebar, MobileNav } = await import("@/components/layout/sidebar");
const { MobileCollapse } = await import("@/components/ux/mobile-collapse");
const { InfoTip } = await import("@/components/help/info-tip");

const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
// Élément <span> complet qui commence à `i`
const spanAt = (m: string, i: number) => {
  const re = /<\/?span\b[^>]*>/g;
  re.lastIndex = i;
  let depth = 0;
  for (let t = re.exec(m); t; t = re.exec(m)) {
    depth += t[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.slice(i, re.lastIndex);
  }
  return m.slice(i);
};
// Texte visible : sans les bulles « ? » (bouton et texte masqué) ; texte des bulles fermées
const TIP = '<span class="relative inline-flex align-middle';
const visible = (m: string) => {
  let out = m;
  for (let i = out.indexOf(TIP); i >= 0; i = out.indexOf(TIP)) out = out.slice(0, i) + out.slice(i + spanAt(out, i).length);
  return text(out);
};
const bubbles = (m: string) => [...m.matchAll(/<span id="[^"]+" hidden=""/g)].map((x) => text(spanAt(m, x.index)));
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("boutons", () => {
  it("variantes et compatibilité buttonCls : hauteur ≥ 40 px, destructif rouge", () => {
    for (const k of ["primary", "secondary", "tertiary", "danger"] as const) expect(ui.buttonCls[k]).toContain("min-h-10");
    expect(ui.buttonCls.danger).toContain("bg-danger-solid");
    expect(ui.buttonClass("primary", "lg")).toContain("min-h-12");
  });

  it("Button : type button par défaut, icône décorative, état en cours (texte, désactivé, aria-busy)", () => {
    const m = html(h(ui.Button, { variant: "primary", icon: "save" }, "Enregistrer les paramètres"));
    expect(m).toContain('type="button"');
    expect(m).toContain('aria-hidden="true"');
    const p = html(h(ui.Button, { variant: "primary", pending: true, pendingLabel: "Enregistrement…" }, "Enregistrer"));
    expect(p).toContain("disabled");
    expect(p).toContain('aria-busy="true"');
    expect(text(p)).toBe("Enregistrement…");
  });

  it("Button désactivé : raison visible et reliée au bouton", () => {
    const m = html(h(ui.Button, { disabled: true, disabledReason: "Sélectionnez au moins un fichier." }, "Importer"));
    const id = /aria-describedby="([^"]+)"/.exec(m)?.[1];
    expect(id).toBeTruthy();
    expect(m).toContain(`id="${id}"`);
    expect(text(m)).toContain("Sélectionnez au moins un fichier.");
  });

  it("ButtonLink : lien interne, lien externe annoncé", () => {
    expect(html(h(ui.ButtonLink, { href: "/employees", variant: "secondary" }, "Voir la liste"))).toMatch(/<a href="\/employees"[^>]*min-h-10/);
    const ext = html(h(ui.ButtonLink, { href: "https://example.org", external: true }, "Documentation"));
    expect(ext).toContain('target="_blank"');
    expect(text(ext)).toContain("(nouvel onglet)");
  });

  it("SubmitButton : bouton de soumission primaire", () => {
    const m = html(h("form", null, h(ui.SubmitButton, { pendingLabel: "Import en cours…" }, "Importer un export AJIR")));
    expect(m).toContain('type="submit"');
    expect(m).toContain("bg-primary");
    expect(text(m)).toBe("Importer un export AJIR");
  });

  it("ConfirmButton : boîte de dialogue étiquetée (titre + conséquence), soumission avec name/value, motif obligatoire", () => {
    const m = html(
      h(
        "form",
        null,
        h(ui.ConfirmButton, {
          title: "Rejeter cette recommandation ?",
          consequence: "La recommandation sera close. La décision est tracée.",
          name: "decision",
          value: "REJETEE",
          confirmLabel: "Confirmer le rejet",
          reason: { name: "comment", label: "Motif du rejet", required: true },
        }, "Rejeter"),
      ),
    );
    expect(m).toMatch(/<button type="button"[^>]*aria-haspopup="dialog"/);
    const submit = /<button type="submit" hidden=""[^>]*>/.exec(m)?.[0] ?? "";
    expect(submit).toContain('name="decision"');
    expect(submit).toContain('value="REJETEE"');
    const labelled = /<dialog[^>]*aria-labelledby="([^"]+)"[^>]*aria-describedby="([^"]+)"/.exec(m);
    expect(labelled).toBeTruthy();
    expect(m).toContain(`id="${labelled![1]}"`);
    expect(new RegExp(`id="${labelled![2]}"[^>]*><p>La recommandation sera close\. La décision est tracée\.</p></div>`).test(m)).toBe(true);
    expect(text(m)).toContain("Rejeter cette recommandation ?");
    expect(text(m)).toContain("La recommandation sera close.");
    expect(text(m)).toContain("Motif du rejet (obligatoire)");
    expect(m).toMatch(/<textarea[^>]*name="comment"/);
    expect(m).not.toMatch(/<textarea[^>]*required/);
    expect(text(m)).toContain("Confirmer le rejet");
    expect(text(m)).toContain("Annuler");
    expect(m).toContain("bg-danger-solid");
  });

  it("ConfirmButton : état en cours imposé (useActionState)", () => {
    const m = html(h(ui.ConfirmButton, { title: "Rejeter ?", consequence: "x", pending: true, pendingLabel: "Enregistrement…" }, "Rejeter"));
    expect(m).toMatch(/<button type="button" disabled=""[^>]*aria-busy="true"/);
    expect(text(m)).toContain("Enregistrement…");
  });

  it("FormActions et ActionBar : primaire à droite, menu « Plus d'actions »", () => {
    const f = html(h(ui.FormActions, { status: h(ui.Alert, { tone: "success" }, "Paramètres enregistrés.") }, h(ui.Button, { variant: "tertiary" }, "Annuler"), h(ui.Button, { variant: "primary", type: "submit" }, "Enregistrer")));
    expect(f).toContain("flex-col-reverse");
    expect(f.indexOf("Annuler")).toBeLessThan(f.indexOf("Enregistrer"));
    expect(f).toContain('role="status"');
    const a = html(h(ui.ActionBar, { more: h(ui.MenuLink, { href: "/x", icon: "download" }, "Exporter (CSV)") }, h(ui.ButtonLink, { href: "/y", variant: "primary" }, "Importer")));
    expect(a).toContain('aria-haspopup="menu"');
    expect(a).toContain('aria-expanded="false"');
    expect(a).toMatch(/role="menu"[^>]*hidden/);
    expect(a).toContain('role="menuitem"');
    expect(text(a)).toContain("Plus d'actions");
  });
});

describe("textes", () => {
  it("PageHeader : titre h1, phrase d'objectif dans la bulle « ? » hors du titre, périmètre et période annoncés", () => {
    const m = html(h(ui.PageHeader, { title: "Absentéisme", subtitle: "Repérer les équipes les plus touchées.", scope: "Toute l'entreprise", period: "sept. 2025 – août 2026", actions: h("a", { href: "/x" }, "Exporter") }));
    expect(m).toMatch(/<h1[^>]*>Absentéisme<\/h1><span class="relative inline-flex/);
    expect(visible(m)).toBe("Absentéisme Périmètre : Toute l'entreprise Période : sept. 2025 – août 2026 Exporter");
    expect(text(m)).toContain("Aide : Absentéisme");
    expect(bubbles(m)).toEqual(["Absentéisme : Repérer les équipes les plus touchées."]);
    const bare = html(h(ui.PageHeader, { title: "Alertes", badge: h(ui.StatusBadge, { tone: "warning" }, "Prévision indicative") }));
    expect(bare).not.toContain("<button");
    expect(text(bare)).toBe("Alertes Prévision indicative");
  });

  it("SectionHeader : description dans la bulle, ajoutée à la bulle fournie (une seule), titre seul nom de la section", () => {
    expect(html(h(ui.SectionHeader, { title: "Tendances", id: "tendances", level: 3 }))).toMatch(/<h3 id="tendances" class="[^"]*">Tendances<\/h3><\/div>/);
    const own = html(h(ui.SectionHeader, { title: "Tendances", description: "Évolution sur 12 mois." }));
    expect(visible(own)).toBe("Tendances");
    expect(bubbles(own)).toEqual(["Tendances : Évolution sur 12 mois."]);
    const merged = html(h(ui.SectionHeader, { title: "Turnover", id: "t", description: "Sur 12 mois.", tip: h(InfoTip, { label: "Turnover" }, "Sorties rapportées à l'effectif.") }));
    expect(merged.match(/<button/g)).toHaveLength(1);
    expect(merged).toMatch(/<h2 id="t" class="[^"]*">Turnover<\/h2>/);
    expect(bubbles(merged)).toEqual(["Turnover : Sorties rapportées à l'effectif. Sur 12 mois."]);
    const sec = html(h(ui.Section, { id: "imports", title: "Imports", intro: "Historique des imports." }, "…"));
    expect(visible(sec)).toBe("Imports …");
    expect(bubbles(sec)).toEqual(["Imports : Historique des imports."]);
  });

  it("EmptyState : titre + action visibles, pourquoi dans la bulle « ? », titre h1 possible", () => {
    const e = html(h(ui.EmptyState, { title: "Aucune alerte nouvelle", actions: h(ui.ButtonLink, { href: "/alerts" }, "Voir toutes les alertes"), headingLevel: 1 }, "Les alertes apparaissent après le calcul mensuel."));
    expect(e).toMatch(/<h1[^>]*>Aucune alerte nouvelle<\/h1>/);
    expect(visible(e)).toBe("Aucune alerte nouvelle Voir toutes les alertes");
    expect(bubbles(e)).toEqual(["Aucune alerte nouvelle : Les alertes apparaissent après le calcul mensuel."]);
    expect(html(h(ui.EmptyState, { title: "Vide" }))).toMatch(/<p class="[^"]*font-semibold/);
    expect(html(h(ui.EmptyState, { title: "Vide" }))).not.toContain("<button");
  });

  it("Card : description dans la bulle « ? » du titre", () => {
    const c = html(h(ui.Card, { title: "Imports récents", description: "Trois derniers imports AJIR." }, "…"));
    expect(visible(c)).toBe("Imports récents …");
    expect(bubbles(c)).toEqual(["Imports récents : Trois derniers imports AJIR."]);
  });

  it("Notice / Alert : rôles annoncés, anciens tons acceptés, préfixe pour lecteur d'écran", () => {
    expect(html(h(ui.Notice, { tone: "amber" }, "x"))).not.toContain("role=");
    expect(html(h(ui.Notice, { tone: "amber" }, "x"))).toContain("bg-warning-soft");
    expect(html(h(ui.Alert, { tone: "error" }, "Le fichier est manquant."))).toContain('role="alert"');
    const ok = html(h(ui.Alert, { tone: "success" }, "Enregistré."));
    expect(ok).toContain('role="status"');
    expect(text(ok)).toBe("Succès : Enregistré.");
    expect(html(h(ui.Notice, { role: "status", tone: "red" }, "x"))).toContain('role="status"');
  });

  it("badges : texte toujours présent", () => {
    expect(text(html(h(ui.RiskBadge, { level: "ELEVE" })))).toBe("Risque Élevé");
    expect(text(html(h(ui.RiskBadge, { level: "MOYEN", compact: true })))).toBe("Moyen");
    expect(text(html(h(ui.RiskBadge, { level: null })))).toBe("Non évalué");
    expect(text(html(h(ui.StatusBadge, { tone: "warning" }, "En cours")))).toBe("En cours");
  });
});

describe("blocs de lecture rapide", () => {
  it("StatusSummary, QuestionAnswer : verdict écrit, question en h2, périmètre", () => {
    const st = text(html(h(ui.StatusSummary, { tone: "attention", label: "À surveiller", title: "Deux contrôles dépassent le seuil.", points: ["Doublons de pointage"] })));
    expect(st).toBe("À surveiller Deux contrôles dépassent le seuil. Doublons de pointage");
    const qa = html(h(ui.QuestionAnswer, { id: "q", question: "Mes équipes sont-elles en surcharge ?", verdict: { tone: "critique", label: "Oui, 2 équipes", text: "Deux équipes dépassent le seuil." }, scope: "Toute l'entreprise, août 2026" }));
    expect(qa).toMatch(/<section aria-labelledby="q"/);
    expect(qa).toMatch(/<h2 id="q"[^>]*>Mes équipes sont-elles en surcharge \?<\/h2>/);
    expect(text(qa)).toContain("Oui, 2 équipes Deux équipes dépassent le seuil. Toute l'entreprise, août 2026");
  });

  it("Section et Steps : section étiquetée, étape courante annoncée", () => {
    const sec = html(h(ui.Section, { id: "imports", title: "Imports", intro: "Historique." }, "…"));
    expect(sec).toMatch(/<section id="imports" aria-labelledby="imports-titre"/);
    expect(sec).toMatch(/<h2 id="imports-titre"/);
    const st = html(h(ui.Steps, { steps: [{ title: "Choisir les fichiers", status: "done" }, { title: "Vérifier", status: "current" }, { title: "Importer", status: "todo" }] }));
    expect(st).toMatch(/<li aria-current="step"/);
    expect(text(st)).toContain("Étape 1 : Choisir les fichiers Terminée");
    expect(text(st)).toContain("Étape 2 : Vérifier En cours");
  });

  it("IconArray et KpiTile : pictogrammes étiquetés, lien de pied", () => {
    const ia = html(h(pbi.IconArray, { segments: [{ n: 14, tone: "defavorable" }], total: 100, label: "Sur 100 collaborateurs, 14 en risque élevé" }));
    expect(ia).toContain('role="img" aria-label="Sur 100 collaborateurs, 14 en risque élevé"');
    expect((ia.match(/<span /g) ?? []).length).toBe(100);
    expect(html(h(ui.KpiTile, { label: "Imports", value: "3", detailHref: "/data-health" }))).toMatch(/<a href="\/data-health"[^>]*>Voir le détail/);
    const tile = html(h(ui.KpiTile, { label: "Imports", value: "3", period: "30 derniers jours", hint: "Dont 1 en échec", href: "/data-health" }));
    expect(visible(tile)).toBe("Imports 3 Voir le détail ›");
    expect(bubbles(tile)).toEqual(["Imports : 30 derniers jours Dont 1 en échec"]);
    expect(tile).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
  });
});

describe("indicateurs et visuels", () => {
  it("KpiCard : libellé, valeur + unité, variation avec flèche, texte et jugement écrit ; période dans la bulle", () => {
    const m = html(h(pbi.KpiCard, { label: "Turnover glissant", period: "12 mois, fin août 2026", value: "10,9", unit: "%", delta: { value: 0.4, label: "+0,4 pt", reference: "vs sept. 2025", good: "down" } }));
    const t = visible(m);
    expect(t).toContain("Turnover glissant 10,9 %");
    expect(t).toContain("En hausse : +0,4 pt vs sept. 2025 à surveiller");
    expect(bubbles(m)).toEqual(["Turnover glissant : 12 mois, fin août 2026"]);
    expect(m).toMatch(/aria-hidden="true"[^>]*>▲/);
    expect(text(html(h(pbi.KpiCard, { label: "Effectif", value: "1 069", delta: { value: -9, label: "−9", good: "neutral" } })))).not.toMatch(/favorable|surveiller/);
    expect(text(html(h(pbi.KpiCard, { label: "x", value: "1", delta: { value: -1, label: "−1", good: "down" } })))).toContain("favorable");
  });

  it("KpiCard : lien de carte avec libellé, lien de pied, bulle posée hors du lien", () => {
    const linked = html(h(pbi.KpiCard, { label: "Risque élevé", value: "19", href: "/employees?niveau=ELEVE", linkLabel: "Voir les 19 collaborateurs", tip: h("button", { type: "button" }, "?") }));
    expect(linked).toMatch(/<a href="\/employees\?niveau=ELEVE"[^>]*>.*Voir les 19 collaborateurs.*<\/a><span[^>]*><button/);
    const foot = html(h(pbi.KpiCard, { label: "Absentéisme", value: "0,8", detailHref: "/absenteeism" }));
    expect(foot).toMatch(/<div[^>]*>.*<a href="\/absenteeism"[^>]*>Voir le détail/);
  });

  it("ChartCard : titre seul, mesure · périmètre · période dans la bulle, graphique résumé et tableau « Voir les données »", () => {
    const chart = pbi.lineChart({ categories: ["juil. 2026", "août 2026"], series: [{ name: "Taux d'absence", values: [1, 0.8] }], measure: "Taux d'absence", unit: "%" });
    const m = html(h(pbi.ChartCard, { title: "Absentéisme mensuel (%)", measure: "Taux d'absence", unit: "%", scope: "Toute l'entreprise", period: "juil. – août 2026", chart }));
    expect(m).toMatch(/<h2[^>]*>Absentéisme mensuel \(%\)<\/h2>/);
    expect(visible(m)).not.toContain("Toute l'entreprise");
    expect(bubbles(m)).toEqual(["Absentéisme mensuel (%) : Taux d'absence (%) · , Toute l'entreprise · , juil. – août 2026"]);
    expect(m).toMatch(/role="img" aria-label="Courbe d&#x27;évolution/);
    expect(m).toContain("<details");
    expect(text(m)).toContain("Voir les données");
    expect(m).toMatch(/<th scope="row"[^>]*>juil\. 2026<\/th><td[^>]*>1,0/);
  });
});

describe("menu et gabarit", () => {
  const items = (role: Role) => NAV.flatMap((s) => s.items.filter((i) => i.roles.includes(role)).map((i) => i.labels?.[role] ?? i.label));

  it("sections cohérentes, libellés courts, chaque entrée une seule fois par rôle, Alertes pour tous", () => {
    for (const role of ["ADMIN", "RH", "MANAGER"] as Role[]) {
      const list = items(role);
      expect(new Set(list).size, role).toBe(list.length);
      expect(list).toContain("Alertes");
      for (const l of list) expect(l.length, l).toBeLessThanOrEqual(26);
    }
    expect(items("MANAGER")).toEqual(["Tableau de bord", "Power BI", "Synthèse du mois", "Alertes", "Mon équipe", "Mes équipes", "Organigramme", "Absentéisme", "Formations", "Charge de travail", "Rétention", "Aide", "Mon compte"]);
    expect(items("ADMIN")[0]).toBe("Console");
    expect(items("ADMIN")).not.toContain("Tableau de bord");
  });

  it("page active évidente et compteur d'alertes lisible", () => {
    const m = html(h(Sidebar, { role: "RH", alertCount: 35 }));
    expect(m).toMatch(/aria-current="page"[^>]*bg-white[^>]*font-semibold|bg-white[^>]*font-semibold[^>]*aria-current="page"|aria-current="page" class="[^"]*bg-white/);
    expect(text(m)).toContain("Alertes 35 alertes ouvertes");
    expect(text(html(h(Sidebar, { role: "RH", alertCount: 1 })))).toContain("1 alerte ouverte");
    expect(text(html(h(MobileNav, { role: "MANAGER", alertCount: 0, dataDate: "31/08/2026" })))).toContain("Données AJIR au 31/08/2026");
  });

  it("MobileCollapse : bouton masqué sur grand écran, contenu replié sous 640 px", () => {
    const m = html(h(MobileCollapse, { label: "Filtres", count: 2 }, h("form", null, "…")));
    expect(m).toMatch(/aria-expanded="false"[^>]*class="[^"]*sm:hidden/);
    expect(m).toMatch(/class="hidden sm:block"/);
    expect(text(m)).toContain("Filtres 2 actifs");
  });
});

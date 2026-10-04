import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActiveFilters, FilterForm } from "@/components/pilotage/filters";
import { ShortcutBar } from "@/components/ux/shortcuts";
import { WhatsNew } from "@/components/insights";
import type { EmployeeNewsDto } from "@/lib/dal/synthesis";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));

const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const count = (s: string, needle: string) => s.split(needle).length - 1;
const selectCls = (out: string, name: string) => new RegExp(`<select id="f-${name}"[^>]*class="([^"]*)"`).exec(out)?.[1] ?? "";

const PERIODE = { name: "periode", label: "Période", defaultValue: "12m", options: [{ value: "6m", label: "6 derniers mois" }, { value: "12m", label: "12 derniers mois" }] };
const DEPT = { name: "departement", label: "Département", allLabel: "Tous", options: [{ value: "3", label: "Production" }] };
const NIVEAU = { name: "niveau", label: "Niveau de risque", allLabel: "Tous", options: [{ value: "ELEVE", label: "Élevé" }] };

describe("barre de filtres", () => {
  it("libellés associés, une ligne à partir de lg, boutons « Appliquer les filtres » et « Réinitialiser les filtres »", () => {
    const out = html(createElement(FilterForm, { action: "/dashboard", values: { periode: "12m" }, fields: [PERIODE, DEPT, NIVEAU], hidden: { retour: "/dashboard" } }));
    for (const f of ["periode", "departement", "niveau"]) {
      expect(out).toContain(`<label for="f-${f}"`);
      expect(out).toContain(`<select id="f-${f}" name="${f}"`);
    }
    expect(out).toContain("lg:flex lg:flex-wrap lg:items-end");
    expect(out).toContain('aria-label="Filtres"');
    expect(out).toContain('<input type="hidden" name="retour" value="/dashboard"/>');
    expect(out).toMatch(/<a href="\/dashboard"[^>]*>.*Réinitialiser les filtres<\/a>/);
    expect(out).toMatch(/<button type="submit"[^>]*>.*Appliquer les filtres<\/button>/);
  });

  it("sous 640 px : un seul bouton replie listes et boutons, avec le nombre de filtres actifs ; valeur par défaut ni surlignée ni comptée", () => {
    const idle = html(createElement(FilterForm, { action: "/dashboard", values: { periode: "12m" }, fields: [PERIODE, DEPT, NIVEAU], showReset: false }));
    expect(count(idle, "Afficher les filtres")).toBe(1);
    expect(idle).not.toContain("actif)");
    expect(selectCls(idle, "periode")).not.toContain("border-primary!");
    expect(idle).toMatch(/class="hidden sm:flex col-span-full[^"]*"[^>]*>.*Appliquer les filtres/);
    expect(idle).not.toContain("Réinitialiser les filtres");

    const active = html(createElement(FilterForm, { action: "/dashboard", values: { periode: "6m", departement: 3 }, fields: [PERIODE, DEPT, NIVEAU] }));
    expect(active).toContain("Afficher les filtres (2 actifs)");
    expect(selectCls(active, "periode")).toContain("border-primary!");
    expect(selectCls(active, "departement")).toContain("border-primary!");
    expect(selectCls(active, "niveau")).not.toContain("border-primary!");
  });

  it("avec une recherche, les boutons restent visibles repliés ; une seule liste n'est pas repliée", () => {
    const search = html(createElement(FilterForm, { action: "/employees", values: {}, fields: [DEPT, NIVEAU], search: { name: "q", label: "Nom ou matricule" } }));
    expect(search).toMatch(/<input id="f-q" type="search"[^>]*name="q"/);
    expect(search).toContain('<label for="f-q"');
    expect(search).toMatch(/class="flex col-span-full[^"]*"[^>]*>.*Appliquer les filtres/);
    const single = html(createElement(FilterForm, { action: "/interventions", values: {}, fields: [DEPT] }));
    expect(single).not.toContain("Afficher les filtres");
    expect(single).toMatch(/class="grid col-span-full/);
  });

  it("filtres actifs : texte « Filtres actifs : », puces retirables, restriction de rôle distincte des valeurs invalides", () => {
    const none = html(createElement(ActiveFilters, { filters: [] }));
    expect(none).toMatch(/Filtres actifs :<\/span><span>aucun<\/span>/);
    const out = html(
      createElement(ActiveFilters, {
        filters: [{ label: "Département", value: "Production", removeHref: "/dashboard" }],
        ignored: ["contrat", "periode"],
        restricted: ["contrat"],
      }),
    );
    expect(out).toContain('href="/dashboard"');
    expect(out).toContain("Retirer le filtre Département");
    expect(out).toContain("Filtre contrat non disponible dans la vue manager");
    expect(out).toContain("Paramètre(s) invalide(s) ignoré(s) : période.");
  });
});

describe("bandeau « À traiter »", () => {
  it("éléments en attente en lien (urgent marqué en mots), éléments à zéro en texte coché sans lien, cibles ≥ 40 px", () => {
    const out = html(
      createElement(ShortcutBar, {
        items: [
          { href: "/alerts?status=NOUVELLE", count: 3, singular: "nouvelle alerte", plural: "nouvelles alertes", detail: "dont 1 critique", urgent: true, none: "Aucune nouvelle alerte" },
          { href: "/recommendations?statut=PROPOSEE", count: 0, singular: "recommandation à décider", plural: "recommandations à décider", none: "Aucune recommandation à décider" },
          { href: "/autre", count: 0, singular: "demande", plural: "demandes" },
        ],
      }),
    );
    expect(out).toContain('aria-label="À traiter"');
    expect(out).toMatch(/<a href="\/alerts\?status=NOUVELLE" class="[^"]*min-h-10[^"]*bg-danger-soft[^"]*">/);
    expect(out).toContain("nouvelles alertes<span");
    expect(out).toContain(", dont 1 critique");
    expect(out).not.toContain('href="/recommendations');
    expect(out).toContain("Aucune recommandation à décider");
    expect(out).toContain("0 demande");
    expect(out).not.toContain('href="/autre"');
  });

  it("rien à afficher sans élément", () => {
    expect(html(createElement(ShortcutBar, { items: [] }))).toBe("");
  });
});

describe("« Quoi de neuf » de la fiche", () => {
  it("changement de niveau : sens écrit et pastille sémantique (hausse rouge, baisse verte, inchangé gris)", () => {
    const data: EmployeeNewsDto = {
      view: "RH",
      employeeId: 1,
      month: "2026-08",
      previousMonth: "2026-07",
      window: { from: "2026-08-01", to: "2026-08-31" },
      items: [
        { kind: "RISQUE", before: "MOYEN", after: "ELEVE" },
        { kind: "RISQUE", before: "ELEVE", after: "FAIBLE" },
        { kind: "RISQUE", before: "MOYEN", after: "MOYEN" },
      ],
    };
    const out = html(createElement(WhatsNew, { data }));
    expect(out).toMatch(/bg-danger"><\/span>Risque en hausse/);
    expect(out).toMatch(/bg-success"><\/span>Risque en baisse/);
    expect(out).toMatch(/bg-fg-subtle"><\/span>Risque<span class="sr-only">/);
  });
});

describe("jetons sémantiques seulement (thème sombre)", () => {
  it("fichiers du périmètre tableau de bord et synthèse", () => {
    const files = [
      "src/app/(app)/dashboard/page.tsx",
      "src/app/(app)/dashboard/loading.tsx",
      "src/app/(app)/dashboard/messages.ts",
      "src/app/(app)/synthese/page.tsx",
      "src/app/(app)/synthese/loading.tsx",
      "src/components/ux/shortcuts.tsx",
      "src/components/pilotage/filters.tsx",
      "src/components/pilotage/filter-fields.tsx",
      "src/components/insights/whats-new.tsx",
    ];
    const raw = /\b(?:bg|text|border(?:-[lrtbxy])?|ring|divide|from|via|to|accent)-(?:slate|gray|sky|red|amber|emerald|brand|white|black)\b|#[0-9a-f]{6}\b/i;
    for (const f of files) expect(fs.readFileSync(path.resolve(process.cwd(), f), "utf8"), f).not.toMatch(raw);
  });
});

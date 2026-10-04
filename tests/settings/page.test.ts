import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { updateSettings } from "@/lib/dal/admin";
import { SETTINGS_UI, SETTING_GROUPS, fieldChange } from "@/components/admin/settings-labels";
import { SettingRow, type SettingField } from "@/components/admin/settings-row";
import { SettingsSaveBar, type SettingChange } from "@/components/admin/settings-save-bar";
import { BudgetTable, SmigTable, budgetErrors, smigErrors } from "@/components/admin/settings-tables";
import { setupDb, teardownDb } from "../ui-admin/helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("settings");
});
afterAll(() => teardownDb(fx.file));

const as = (who: "admin" | "rh") =>
  (session.current = { userId: fx.users[who], login: fx.ctx[who].login, role: fx.ctx[who].role, employeeId: fx.ctx[who].employeeId } as SessionUser);
// Texte visible, espaces (insécables compris) normalisés en espaces simples
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const page = async () => {
  const Page = (await import("@/app/(app)/admin/settings/page")).default;
  as("admin");
  return renderToStaticMarkup((await Page()) as ReactElement);
};
const save = (changes: Record<string, string>) => {
  const rows = getDb().sqlite.prepare("SELECT key, value FROM app_setting").all() as { key: string; value: string }[];
  updateSettings(fx.ctx.admin, { ...Object.fromEntries(rows.map((r) => [r.key, r.value])), ...changes } as never);
};

describe("page Paramètres : structure", () => {
  it("une seule navigation de sections (puces sous lg, liste collante à gauche dès lg), une carte titrée par thème", async () => {
    const html = await page();
    const t = text(html);
    expect(count(html, /<nav /g)).toBe(1);
    expect(html).not.toContain("Sur cette page");
    const nav = html.match(/<nav aria-label="Thèmes des paramètres"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toMatch(/^<nav aria-label="Thèmes des paramètres" class="[^"]*lg:sticky lg:top-4/);
    const chips = nav.match(/<div class="[^"]*lg:hidden">[\s\S]*?<\/ul><\/div>/)?.[0] ?? "";
    const list = nav.match(/<div class="hidden lg:block">[\s\S]*?<\/ul><\/div>/)?.[0] ?? "";
    expect(chips).not.toContain("sticky");
    for (const part of [chips, list]) {
      expect(count(part, /<a href="#/g)).toBe(SETTING_GROUPS.length);
      expect(part).toMatch(/<a href="#risque" aria-current="location"/);
      expect(count(part, /aria-current=/g)).toBe(1);
      expect(part).not.toMatch(/modifié/);
      for (const g of SETTING_GROUPS) {
        expect(part, g.id).toContain(`href="#${g.id}"`);
        expect(text(part), g.id).toContain(g.nav);
      }
    }
    for (const g of SETTING_GROUPS) {
      expect(html, g.id).toContain(`<section id="${g.id}" aria-labelledby="sg-${g.id}"`);
      expect(html, g.id).toContain(`<h2 id="sg-${g.id}"`);
      expect(t, g.id).toContain(`${g.title} ${g.intro}`);
    }
    // Deux éléments collants seulement, jamais superposés : la navigation (colonne de gauche, en haut, dès lg) et la barre
    // d'enregistrement (colonne du contenu, en bas, après la dernière carte : elle ne masque pas le dernier champ)
    const sticky = html.match(/<[a-z]+ [^>]*class="[^"]*(?<![a-z0-9:-])(?:lg:)?sticky(?![a-z0-9:-])[^"]*"/g) ?? [];
    expect(sticky.length).toBe(2);
    expect(sticky[0]).toMatch(/^<nav [^>]*lg:sticky lg:top-4/);
    expect(sticky[1]).toMatch(/^<div class="[^"]*sticky bottom-2 z-20/);
    const [navAt, columnAt, barAt] = ["<nav ", '<div class="@container min-w-0">', "sticky bottom-2"].map((s) => html.indexOf(s));
    expect(navAt).toBeGreaterThan(-1);
    expect(columnAt).toBeGreaterThan(html.indexOf("</nav>"));
    expect(barAt).toBeGreaterThan(html.lastIndexOf("</section>"));
    expect(count(html, /<form/g)).toBe(1);
    expect(count(html, /<h1/g)).toBe(1);
    expect(t).toContain("Les changements s'appliquent au prochain calcul ou au prochain import.");
  });

  it("réservée à l'administrateur", async () => {
    const Page = (await import("@/app/(app)/admin/settings/page")).default;
    as("rh");
    await expect(Page()).rejects.toThrow("REDIRECT:/interdit");
  });

  it("loading.tsx : squelette annoncé, même grille que la page (thèmes à gauche, lignes libellé / champ)", async () => {
    const Loading = (await import("@/app/(app)/admin/settings/loading")).default;
    const out = renderToStaticMarkup(createElement(Loading));
    expect(out).toMatch(/^<div role="status" aria-live="polite" aria-busy="true"><span class="sr-only">Chargement des paramètres…<\/span><div aria-hidden="true">/);
    const html = await page();
    for (const grid of ["lg:grid-cols-[14rem_minmax(0,1fr)]", "@lg:grid-cols-[minmax(0,1fr)_12rem]"]) {
      expect(out).toContain(grid);
      expect(html).toContain(grid);
    }
  });
});

describe("page Paramètres : ligne de paramètre", () => {
  it("libellé relié au champ, description courte, bornes compactes, valeur par défaut, effet, bulle d'aide", async () => {
    const html = await page();
    const t = text(html);
    for (const [key, ui] of Object.entries(SETTINGS_UI)) {
      expect(html, key).toContain(`<label for="s-${key}"`);
      expect(html, key).toMatch(new RegExp(`<input id="s-${key}" type="number"[^>]*name="${key}"`));
      expect(html, key).toContain(`aria-describedby="s-${key}-help s-${key}-bornes s-${key}-meta s-${key}-effect"`);
      for (const part of ["help", "bornes", "meta", "effect"]) expect(count(html, new RegExp(`id="s-${key}-${part}"`, "g")), `${key}-${part}`).toBe(1);
      expect(t, key).toContain(`${ui.short} `);
      expect(t, key).toContain(`Définition : ${ui.label}`);
      expect(t, key).toContain(ui.help);
    }
    // 15 bulles de paramètre + celle du barème, fermées au chargement
    expect(count(html, /aria-expanded="false"/g)).toBe(Object.keys(SETTINGS_UI).length + 1);
    expect(html).toMatch(/<input id="s-capacity_rate"[^>]*min="0.5" max="20" step="0.1"[^>]*aria-invalid="false"[^>]*value="2"/);
    expect(t).toContain("Valeur par défaut : 2 % · Jamais modifié");
    expect(t).toContain("Valeurs possibles : 0,5 à 20 %");
    expect(t).toContain("Valeurs possibles : 0 à 5 points");
    expect(t).toContain("Valeurs possibles : 1 à 12 mois");
    expect(t).toContain("Effet : 2 % des collaborateurs évalués seront classés en risque élevé à chaque calcul mensuel.");
  });

  it("textes vérifiés par les tests E2E ; lien « Rétablir » seulement quand la valeur diffère du défaut", async () => {
    save({ capacity_rate: "0.03" });
    const html = await page();
    const t = text(html);
    expect(html).toMatch(/<input id="s-capacity_rate"[^>]*value="3"/);
    expect(t).toMatch(/Valeur par défaut : 2 % · Modifié le \d{2}\/\d{2}\/\d{4} par admin/);
    expect(t).toMatch(/Valeur par défaut : 2 fois · Jamais modifié/);
    expect(t).toContain("Rétablir la valeur par défaut : Capacité mensuelle d'entretiens");
    expect(count(t, /Rétablir la valeur par défaut/g)).toBe(1);
    // État initial : rien à enregistrer, bouton d'enregistrement unique et désactivé, aucun badge ni alerte
    expect(t).toContain("Aucune modification à enregistrer.");
    expect(count(t, /Enregistrer les paramètres/g)).toBe(1);
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*aria-describedby="settings-etat"/);
    expect(html).toContain('<p id="settings-etat"');
    expect(t).not.toContain("Annuler les modifications");
    expect(t).not.toContain("à corriger");
    expect(html).not.toMatch(/>Modifié<\/span>/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("ring-accent");
  });

  it("champ modifié : anneau d'accent et badge « Modifié » ; erreur de bornes sous le champ, annoncée par le champ", () => {
    const field: SettingField = { key: "capacity_rate", value: "0.02", defaultValue: "0.02", min: 0.005, max: 0.2, step: 0.001, updatedAt: null, updatedBy: null };
    const row = (props: { value: string; raw: number; changed: boolean; error?: string; effect?: string | null }) =>
      renderToStaticMarkup(createElement(SettingRow, { field, ui: SETTINGS_UI.capacity_rate, error: null, effect: "Effet de démonstration.", onChange: () => {}, ...props }));

    const same = row({ value: "2", raw: 0.02, changed: false });
    expect(same).not.toContain("ring-accent");
    expect(same).not.toMatch(/>Modifié<\/span>/);
    expect(text(same)).not.toContain("Rétablir");

    const changed = row({ value: "3", raw: 0.03, changed: true });
    expect(changed).toContain("ring-2 ring-accent");
    expect(changed).toMatch(/>Modifié<\/span>/);
    expect(changed).toMatch(/<button type="button"[^>]*>.*Rétablir la valeur par défaut<span class="sr-only"> : Capacité mensuelle/);
    expect(changed).toContain('aria-invalid="false"');

    const tooHigh = row({ value: "50", raw: 0.5, changed: true, error: "Maximum 20 %." });
    expect(tooHigh).toMatch(/<input id="s-capacity_rate"[^>]*aria-invalid="true" aria-describedby="s-capacity_rate-err s-capacity_rate-help /);
    expect(tooHigh).toMatch(/<p id="s-capacity_rate-err"[^>]*>Maximum 20 %\.<\/p>/);
    expect(tooHigh).toContain("border-danger");
    expect(tooHigh).not.toContain("ring-accent");

    const empty = row({ value: "", raw: NaN, changed: true, error: "Saisissez une valeur.", effect: null });
    expect(text(empty)).toContain("Effet : saisissez une valeur valide pour le voir.");
    expect(text(empty)).toContain("Rétablir la valeur par défaut");
  });
});

describe("page Paramètres : barème SMIG et budgets", () => {
  const meta = { updatedAt: null, updatedBy: null };
  const noop = () => {};

  it("barème : tableau à en-têtes, montants à droite, ajout et retrait nommés, lecture en clair", async () => {
    const html = await page();
    const t = text(html);
    const smig = html.match(/<div role="group" aria-labelledby="smig-titre"[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(smig).toContain('<h3 id="smig-titre"');
    expect(smig).toContain('<caption class="sr-only">Périodes du barème SMIG</caption>');
    expect(count(smig, /<th scope="col"/g)).toBe(3);
    expect(text(smig)).toContain("À partir du SMIG mensuel (TND) Action");
    expect(smig).toMatch(/<input type="date" aria-label="Date d&#x27;effet de la période 1"[^>]*value=""/);
    expect(smig).toMatch(/aria-label="Date d&#x27;effet de la période 2"[^>]*value="2026-01-01"/);
    expect(smig).toMatch(/aria-label="SMIG mensuel de la période 1 \(TND\)"[^>]*text-right[^>]*value="528.32"/);
    expect(smig).toMatch(/aria-label="SMIG mensuel de la période 2 \(TND\)"[^>]*text-right[^>]*value="554.736"/);
    expect(t).toContain("Sans date : couvre tout ce qui précède.");
    for (const s of ["Retirer la période 1", "Retirer la période 2", "Ajouter une période"]) expect(t).toContain(s);
    expect(t).toContain("En clair : 528,32 TND jusqu'au 31/12/2025, puis 554,736 TND à partir du 01/01/2026.");
    expect(html).toMatch(/<input type="hidden" name="smig_schedule" value="[^"]*554\.736/);
  });

  it("barème : contrôles immédiats sous la cellule fautive, sans lecture en clair tant qu'une ligne est à corriger", () => {
    const rows = [
      { id: 0, from: "", value: "528.32" },
      { id: 1, from: "", value: "50" },
      { id: 2, from: "2026-01-01", value: "" },
    ];
    const out = renderToStaticMarkup(createElement(SmigTable, { rows, setRows: noop, errors: smigErrors(rows), valid: true, changed: true, meta }));
    expect(out).toMatch(/aria-label="Date d&#x27;effet de la période 2"[^>]*aria-invalid="true" aria-describedby="smig-1-date-err"/);
    expect(out).toMatch(/aria-label="SMIG mensuel de la période 3 \(TND\)"[^>]*aria-invalid="true" aria-describedby="smig-2-montant-err"/);
    for (const s of ["Saisissez la date d'effet.", "Entre 100 et 5 000 TND.", "Saisissez un montant."]) expect(text(out)).toContain(s);
    expect(text(out)).not.toContain("En clair");
    expect(out).toMatch(/>Modifié<\/span>/);
    expect(out).not.toContain('disabled=""');

    const alone = renderToStaticMarkup(createElement(SmigTable, { rows: [rows[0]], setRows: noop, errors: new Map(), valid: false, changed: false, serverError: "Refus du serveur.", meta }));
    expect(alone).toMatch(/<button type="button" disabled=""[^>]*title="Le barème doit garder au moins une période"/);
    expect(text(alone)).toContain("Barème actuel absent ou illisible : le contrôle utilise le SMIG de repli.");
    expect(alone).toContain('aria-describedby="smig-help smig-err"');
    expect(alone).toMatch(/<p id="smig-err"[^>]*>Refus du serveur\.<\/p>/);
    expect(text(alone)).toContain("En clair : 528,32 TND sans limite de date.");
  });

  it("budgets : état vide guidé, puis tableau avec montant relu et résumé", async () => {
    const empty = await page();
    expect(text(empty)).toContain("Aucun budget saisi : ajoutez une année pour activer les recommandations budgétaires.");
    expect(text(empty)).toContain("Aucun budget enregistré");
    expect(empty).toContain('<input type="hidden" name="budgets" value="[]"/>');
    expect(empty).toContain('<div role="group" aria-labelledby="sg-budget" aria-describedby="budgets-help"');

    save({ budgets: JSON.stringify([{ year: 2027, amount: 1500000 }, { year: 2026, amount: 1717368 }]) });
    const html = await page();
    const t = text(html);
    const table = html.match(/<caption class="sr-only">Budgets annuels de masse salariale<\/caption>[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(count(table, /<th scope="col"/g)).toBe(3);
    expect(table).toMatch(/aria-label="Année du budget 1"[^>]*value="2026"/);
    expect(table).toMatch(/aria-label="Budget brut 2026 \(TND\)"[^>]*text-right[^>]*value="1717368"/);
    expect(text(table)).toContain("1 717 368 TND");
    for (const s of ["Retirer le budget 2026", "Retirer le budget 2027", "Ajouter une année"]) expect(t).toContain(s);
    expect(t).toContain("En clair : recommandations budgétaires possibles pour 2026 et 2027.");
    expect(t).not.toContain("Aucun budget enregistré");
  });

  it("budgets : contrôles immédiats (année en double, hors bornes, montant trop faible)", () => {
    const rows = [
      { id: 0, year: "2026", amount: "500" },
      { id: 1, year: "2026", amount: "" },
      { id: 2, year: "1999", amount: "1500000" },
    ];
    const out = renderToStaticMarkup(createElement(BudgetTable, { rows, setRows: noop, errors: budgetErrors(rows), changed: true, meta, labelledBy: "sg-budget" }));
    expect(out).toMatch(/aria-label="Année du budget 1"[^>]*aria-invalid="true" aria-describedby="budget-0-annee-err"/);
    expect(out).toMatch(/aria-label="Budget brut 2026 \(TND\)"[^>]*aria-invalid="true" aria-describedby="budget-0-montant-err"/);
    for (const s of ["Année déjà saisie.", "Au moins 1 000 TND.", "Saisissez un montant.", "Entre 2000 et 2100.", "1 500 000 TND"]) expect(text(out)).toContain(s);
    expect(text(out)).not.toContain("En clair");
  });
});

describe("page Paramètres : barre d'enregistrement", () => {
  const bar = (props: { changes: SettingChange[]; refusal?: string }) => renderToStaticMarkup(createElement(SettingsSaveBar, { pending: false, onReset: () => {}, ...props }));
  const capacity = { key: "capacity_rate", ...fieldChange({ key: "capacity_rate", value: "0.02", min: 0.005, max: 0.2 }, "3")! };

  it("sans modification : collée en bas de l'écran, état en clair, bouton désactivé relié à cet état", () => {
    const out = bar({ changes: [] });
    expect(out).toMatch(/^<div class="[^"]*sticky bottom-2 z-20[^"]*border-l-line-strong"/);
    expect(text(out)).toContain("Aucune modification à enregistrer.");
    expect(out).toMatch(/<button type="submit" disabled=""[^>]*aria-describedby="settings-etat"/);
    expect(text(out)).not.toContain("Annuler les modifications");
  });

  it("avec des modifications : compteur et récapitulatif vérifiés par les tests E2E, annulation, enregistrement actif", () => {
    const out = bar({ changes: [capacity, { key: "medium_lift", text: "Seuil du niveau « Moyen » (multiple du risque moyen) : minimum 1 fois", invalid: true }] });
    const t = text(out);
    expect(t).toContain("1 modification à enregistrer :");
    expect(t).toMatch(/Capacité mensuelle .* → 3 %/);
    expect(count(out, /<li>/g)).toBe(2);
    expect(t).toContain("1 valeur à corriger :");
    expect(t).toContain("Annuler les modifications");
    expect(count(t, /Enregistrer les paramètres/g)).toBe(1);
    expect(out).toMatch(/<button type="submit" class=/);
    expect(out).toContain("border-l-accent");
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("tabindex");
    expect(t).not.toContain("Aucune modification à enregistrer.");
  });

  it("refus du serveur : une seule alerte ; au-delà de cinq modifications, liste défilante et focalisable", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, text: `Paramètre ${i} : 1 → 2` }));
    const out = bar({ changes: many, refusal: "Paramètres non enregistrés : certaines valeurs sont hors des bornes autorisées." });
    expect(count(out, /role="alert"/g)).toBe(1);
    expect(text(out)).toContain("certaines valeurs sont hors des bornes autorisées");
    expect(text(out)).toContain("6 modifications à enregistrer :");
    expect(out).toMatch(/<ul tabindex="0" aria-label="Récapitulatif des modifications" class="[^"]*max-h-24 overflow-y-auto/);
  });
});

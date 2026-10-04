import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LeverSearchDto } from "@/lib/dal/whatif";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}));

const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
// Texte lisible : balises retirées, entités et espaces insécables normalisés
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");
const noop = () => {};
const FRAMING = "Pistes à discuter lors d'un échange, pas une décision. Estimation du modèle, non causale.";
const METHOD: LeverSearchDto["method"] = {
  steps: { salaryPct: 2.5, overtimeCutH: 10, trainingHours: 20 },
  limits: { salaryPct: 30, overtimeCutH: 40, trainingHours: 200 },
  promotionEffort: 1,
  combos: 1429,
  evaluated: 512,
  pruned: 300,
  engineRuns: 42,
  ms: 380,
};
const placement = (score: number, level: "ELEVE" | "MOYEN" | "FAIBLE") => ({ score, level, rank: 4, lift: 2, population: 987 });

const found: LeverSearchDto = {
  employeeId: 7,
  asOf: "2026-08-31",
  model: { version: "logreg-v1-20260930", kind: "LOGREG" },
  notice: "Estimation non causale",
  stored: { score: 0.31, level: "ELEVE" },
  before: placement(0.31, "ELEVE"),
  status: "TROUVE",
  message: "2 pistes pour passer sous le niveau Élevé, de la plus petite à la plus forte.",
  proposals: [
    {
      levers: { salaryPct: 7.5, overtimeCutH: 0, trainingHours: 40, promotion: false },
      effort: 0.45,
      after: placement(0.18, "MOYEN"),
      applied: { salary: { before: 1500, after: 1612.5 }, grade: null, overtimeRemovedH: 0, trainingHours: 40 },
      cost: { monthlySalaryDelta: 112.5, annual: 1573.7, chargeRate: 0.1657 },
    },
    {
      levers: { salaryPct: 0, overtimeCutH: 20, trainingHours: 0, promotion: true },
      effort: 1.5,
      after: placement(0.09, "FAIBLE"),
      applied: { salary: { before: 1500, after: 2700 }, grade: { before: "G2", after: "G3" }, overtimeRemovedH: 60, trainingHours: 0 },
      cost: { monthlySalaryDelta: 1200, annual: 16786.08, chargeRate: 0.1657 },
    },
  ],
  method: METHOD,
  notes: [],
};

describe("panneau « et si ? » : recherche des leviers", () => {
  it("bouton de recherche et cadrage visibles avant toute recherche, simulation manuelle inchangée", async () => {
    const { WhatIfPanel } = await import("@/components/pilotage/what-if-panel");
    const out = text(
      html(createElement(WhatIfPanel, { employeeId: 7, notice: "Estimation non causale", limits: { salaryPct: 30, overtimeCutH: 40, trainingHours: 200 }, defaultChargeRatePct: 16.57 })),
    );
    expect(out).toContain("Trouver les leviers les plus efficaces");
    expect(out).toContain(FRAMING);
    expect(out).toContain("Par où commencer ?");
    for (const s of ["Simulation « et si ? »", "Simuler ces actions", "Réinitialiser la simulation", "Augmentation du salaire de base (%)", "Promotion au grade supérieur"])
      expect(out).toContain(s);
    expect(out).not.toContain("Piste 1");
    expect(out).not.toContain("Appliquer à la simulation");
  });

  it("cartes : leviers, probabilité avant → après, niveau atteint, coût, bouton « Appliquer à la simulation »", async () => {
    const { LeverSearchResults } = await import("@/components/pilotage/what-if-panel");
    const raw = html(createElement(LeverSearchResults, { r: found, onApply: noop }));
    const out = text(raw);
    expect(out).toContain("Piste 1");
    expect(out).toContain("Piste 2");
    expect(out).toContain("Salaire de base +7,5 %");
    expect(out).toContain("Formation +40 h");
    expect(out).toContain("Promotion de G2 à G3");
    expect(out).toContain("Heures supplémentaires −20 h par mois");
    expect(out).toMatch(/Probabilité à 6 mois : 31,0 % → puis 18,0 %/);
    expect(out).toMatch(/Probabilité à 6 mois : 31,0 % → puis 9,0 %/);
    expect((out.match(/Niveau atteint :/g) ?? []).length).toBe(2);
    expect((out.match(/Appliquer à la simulation/g) ?? []).length).toBe(2);
    expect(out).toContain("(piste 2)");
    expect(out).toContain("ampleur 0,45");
    expect(out).toContain("Hors coût de la formation.");
    expect(out).toMatch(/Hausse de salaire : 1 574 TND par an, charges comprises\./);
    expect(raw.indexOf("Piste 1")).toBeLessThan(raw.indexOf("Piste 2"));
    // détail de la méthode : grille, coût normalisé, dominance, volume et modèle
    expect(out).toContain("Comment les pistes sont choisies");
    expect(out).toContain("Pas testés : 2,5 % de salaire, 10 h supplémentaires, 20 h de formation, promotion ou non.");
    expect(out).toContain("30 %, 40 h et 200 h valent 1");
    expect(out).toMatch(/512 combinaisons évaluées sur 1 429, en 0,4 s, avec le modèle du 30\/09\/2026/);
    // aucun libellé du résultat de simulation (sélecteurs E2E), aucune lecture causale
    expect(out).not.toMatch(/Salaire de base : [\d\s]+TND →/);
    expect(out).not.toContain("Coût annuel estimé");
    expect(out).not.toContain("Le niveau de risque passerait");
    expect(out).not.toMatch(/départs? évités?/i);
  });

  it("score à règles B0 : points au lieu d'une probabilité", async () => {
    const { LeverSearchResults } = await import("@/components/pilotage/what-if-panel");
    const b0: LeverSearchDto = {
      ...found,
      model: { version: "b0-v1", kind: "B0" },
      before: placement(4, "ELEVE"),
      proposals: [{ ...found.proposals[1], levers: { salaryPct: 0, overtimeCutH: 0, trainingHours: 0, promotion: true }, effort: 1, after: placement(1, "FAIBLE") }],
    };
    const out = text(html(createElement(LeverSearchResults, { r: b0, onApply: noop })));
    expect(out).toMatch(/Score à règles : 4 points → puis 1 point/);
    expect(out).not.toContain("Probabilité à 6 mois");
  });

  it("aucune combinaison : message explicite, lien vers les facteurs associés, aucune carte", async () => {
    const { LeverSearchResults } = await import("@/components/pilotage/what-if-panel");
    const message = "Aucune combinaison dans les limites de la simulation ne fait baisser le niveau ; voir les facteurs associés.";
    const raw = html(createElement(LeverSearchResults, { r: { ...found, status: "AUCUNE", message, proposals: [] }, onApply: noop }));
    const out = text(raw);
    expect(out).toContain(message);
    expect(out).toContain("Aucune piste dans les limites de la simulation");
    expect(raw).toContain('href="#estimation"');
    expect(out).not.toContain("Piste 1");
    expect(out).toContain("Comment les pistes sont choisies");
  });

  it("niveau déjà faible : message, ni carte ni détail de méthode ; notes affichées", async () => {
    const { LeverSearchResults } = await import("@/components/pilotage/what-if-panel");
    const message = "Le niveau de risque est déjà Faible : aucune piste à rechercher.";
    const out = text(
      html(
        createElement(LeverSearchResults, {
          r: { ...found, status: "DEJA_FAIBLE", message, proposals: [], notes: ["Grade maximal (G8) déjà atteint : promotion impossible."] },
          onApply: noop,
        }),
      ),
    );
    expect(out).toContain(message);
    expect(out).toContain("Grade maximal (G8) déjà atteint");
    expect(out).not.toContain("Comment les pistes sont choisies");
    expect(out).not.toContain("Appliquer à la simulation");
  });

  it("jetons sémantiques seulement (thème sombre)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/components/pilotage/what-if-panel.tsx"), "utf8");
    expect(src).not.toMatch(/\b(?:bg|text|border(?:-[lrtbxy])?|ring|divide|from|via|to|accent)-(?:slate|gray|sky|red|amber|emerald|brand|white|black)\b|#[0-9a-f]{6}\b/i);
  });
});

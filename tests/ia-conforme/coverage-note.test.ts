import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageNote, coveragePct, coverageSentence } from "@/components/ai/conformal/coverage-note";
import { AbsenteeismForecastCard } from "@/components/ai/absenteeism/forecast-section";
import { readConformal, type CoverageCell } from "@/lib/ai/conformal";
import type { AbsForecastDto } from "@/lib/dal/ai-absenteeism";
import { TERMS } from "@/lib/help/terms";

vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));

const S = " ";
const cell = (coverage: number, months = 26): CoverageCell => ({ months, from: "2024-07", to: "2026-08", n: 72, coverage, target: 0.8 });

describe("phrase de couverture sous une prévision", () => {
  it("cible atteinte : nombre de mois de test, part des valeurs observées, cible entre parenthèses", () => {
    expect(coverageSentence(cell(0.8125))).toEqual({
      below: false,
      text: `Fourchette calibrée : sur les 26 derniers mois de test, 81${S}% des valeurs observées y sont tombées (cible 80${S}%).`,
    });
    expect(coverageSentence(cell(0.8))!.below).toBe(false);
  });

  it("sous la cible : le dit explicitement", () => {
    expect(coverageSentence(cell(0.75, 24))).toEqual({
      below: true,
      text: `Fourchette calibrée : sur les 24 derniers mois de test, 75${S}% des valeurs observées y sont tombées, sous la cible de 80${S}%.`,
    });
  });

  it("n'arrondit jamais une couverture insuffisante jusqu'à la cible", () => {
    expect(coveragePct(0.7996, 0.8)).toBe(`79,9${S}%`);
    expect(coverageSentence(cell(0.7996))!.text).toContain(`79,9${S}% des valeurs observées y sont tombées, sous la cible`);
    expect(coveragePct(0.7949, 0.8)).toBe(`79${S}%`);
    expect(coveragePct(0.8004, 0.8)).toBe(`80${S}%`);
  });

  it("singulier pour un seul mois ; rien sans couverture mesurée", () => {
    expect(coverageSentence(cell(0.9, 1))!.text).toContain("sur le dernier mois de test");
    expect(coverageSentence({ ...cell(0.9), coverage: null })).toBeNull();
    expect(coverageSentence(cell(0.9, 0))).toBeNull();
  });

  it("rendu : une ligne et la bulle de définition du glossaire ; rien pour un modèle non calibré", () => {
    const html = renderToStaticMarkup(createElement(CoverageNote, { cell: cell(0.75) }));
    expect(html).toContain("sous la cible de 80");
    expect(html).toContain('data-couverture="sous-la-cible"');
    expect(html).toContain(`Définition : ${TERMS.fourchetteCalibree.label}`);
    expect(html).toContain(TERMS.fourchetteCalibree.text.slice(0, 40));
    expect(renderToStaticMarkup(createElement(CoverageNote, { cell: cell(0.83), note: "Mesure faite pour le scénario de référence." }))).toContain(
      `(cible 80${S}%). Mesure faite pour le scénario de référence.`,
    );
    expect(renderToStaticMarkup(createElement(CoverageNote, { cell: null }))).toBe("");
  });
});

const months = (from: number, n: number) => Array.from({ length: n }, (_, k) => `${2024 + Math.floor((from + k) / 12)}-${String(((from + k) % 12) + 1).padStart(2, "0")}`);
const unit = (key: string, scope: "ENTREPRISE" | "DEPARTEMENT", label: string) => ({
  key,
  scope,
  label,
  observed: months(8, 24).map((m, k) => ({ month: m, rate: 0.007 + (k % 5) * 0.0005 })),
  forecast: months(32, 3).map((m, k) => ({ month: m, horizon: k + 1, value: 0.008, lower: 0.004, upper: 0.013 })),
});
const dto: AbsForecastDto = {
  view: "RH",
  asOf: "2026-08-31",
  modelVersion: "abs-ridge-v2-test",
  units: [unit("E", "ENTREPRISE", "Entreprise"), unit("D1", "DEPARTEMENT", "Production")],
  teamTooSmall: false,
  recommendations: [],
};

describe("prévision de /absenteeism", () => {
  it("affiche la couverture de la portée affichée (entreprise d'abord)", () => {
    const html = renderToStaticMarkup(createElement(AbsenteeismForecastCard, { d: dto, preferKey: "E", coverage: { ENTREPRISE: cell(0.75), DEPARTEMENT: cell(0.86) } }));
    expect(html).toContain("75 % des valeurs observées y sont tombées, sous la cible de 80");
    expect(html).not.toContain("86 %");
    expect(html).toContain("La fourchette probable à 80 % contient la valeur réelle environ 8 fois sur 10");
  });

  it("modèle sans calibration conforme : aucune phrase de couverture", () => {
    const html = renderToStaticMarkup(createElement(AbsenteeismForecastCard, { d: dto, preferKey: "E" }));
    expect(html).not.toContain("Fourchette calibrée");
  });
});

describe("lecture de la couverture d'une version de modèle", () => {
  it("null pour une version publiée sans champ conformal, inconnue ou au nom suspect", () => {
    expect(readConformal("absenteeism", "abs-ridge-v1-20260930")).toBeNull();
    expect(readConformal("workload", "workload-ridge-v1-20260930")).toBeNull();
    expect(readConformal("workforce", "effectif-v1-20260930")).toBeNull();
    expect(readConformal("absenteeism", "../../package")).toBeNull();
    expect(readConformal("absenteeism", "inexistant-v9")).toBeNull();
    expect(readConformal("absenteeism", null)).toBeNull();
  });
});

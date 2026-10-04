import { stackedBarChart, type ChartSpec, type Tone } from "@/components/charts/pbi";

// Formations à risque empilées par niveau (helper partagé stackedBarChart : total en bout de barre, « Voir les données »).
export const PARTS = {
  eleve: { label: "Risque élevé", tone: "defavorable" },
  moyen: { label: "Risque moyen", tone: "attention" },
  aRisque: { label: "À risque (élevé ou moyen)", tone: "attention" },
  faible: { label: "Risque faible", tone: "contexte" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export function stackedCounts(p: {
  rows: { name: string; values: number[] }[];
  parts: { label: string; tone: Tone }[];
  categoryName: string;
  measure: string;
  keepOrder?: boolean;
}): ChartSpec {
  return stackedBarChart({
    rows: p.rows,
    parts: p.parts,
    measure: p.measure,
    unit: "formations",
    digits: 0,
    sort: p.keepOrder ? "none" : "desc",
    categoryName: p.categoryName,
  });
}

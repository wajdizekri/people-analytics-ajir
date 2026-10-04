import type { EChartsOption } from "echarts";
import { AXIS, GRID, LEGEND, SEMANTIC, TOOLTIP_AXIS, type Tone } from "@/components/charts/pbi";

// Options sérialisables (sans fonction) : construites côté serveur, rendues par le wrapper client EChart (formats français).
// Les visuels standard passent par les helpers de @/components/charts/pbi (lineChart, barChart…) ; ici, ce qui n'y entre pas.
// Couleurs : palette SEMANTIC seulement ; textes, axes et infobulles sans couleur écrite, pour suivre le thème clair / sombre du wrapper.
const NBSP = " ";
const pct = (r: number | null) => (r == null ? null : Math.round(r * 1000) / 10);
const categoryAxis = (data: string[]) => ({ type: "category" as const, data, ...AXIS, splitLine: { show: false } });
const valueAxis = { type: "value" as const, ...AXIS, axisLine: { show: false } };

export const frRate = (r: number, digits = 1) => `${(r * 100).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}%`;

// Niveaux de risque : couleurs sémantiques de la charte (mêmes que les badges)
export const RISK_LEVELS = [
  { key: "ELEVE", label: "Élevé", tone: "defavorable", color: SEMANTIC.defavorable },
  { key: "MOYEN", label: "Moyen", tone: "attention", color: SEMANTIC.attention },
  { key: "FAIBLE", label: "Faible", tone: "favorable", color: SEMANTIC.favorable },
  { key: "nonScored", label: "Non évalués", tone: "contexte", color: SEMANTIC.contexte },
] as const satisfies readonly { key: string; label: string; tone: Tone; color: string }[];
export type RiskTotals = { ELEVE: number; MOYEN: number; FAIBLE: number; nonScored: number };

// « Direction de la production » → « Production » : libellé d'axe court ; nom complet dans les tableaux
export function shortDepartment(name: string): string {
  const m = /^Direction\s+(?:de\s+la\s+|de\s+l['’]|des\s+|du\s+|de\s+|d['’])?(.+)$/i.exec(name.trim());
  return m ? m[1].charAt(0).toLocaleUpperCase("fr-FR") + m[1].slice(1) : name;
}

export function rateLinesOption(labels: string[], lines: { name: string; rates: (number | null)[]; emphasis?: boolean }[]): EChartsOption {
  const legend = lines.length > 1;
  return {
    grid: { ...GRID, top: legend ? 36 : 12 },
    legend: legend ? { ...LEGEND, type: "scroll" } : undefined,
    tooltip: TOOLTIP_AXIS,
    xAxis: { ...categoryAxis(labels), boundaryGap: false },
    yAxis: { ...valueAxis, axisLabel: { ...AXIS.axisLabel, formatter: "{value} %" } },
    series: lines.map((l) => ({
      name: l.name,
      type: "line",
      data: l.rates.map(pct),
      symbolSize: 6,
      showSymbol: l.rates.length <= 24,
      lineStyle: l.emphasis ? { width: 2, color: SEMANTIC.reference, type: "dashed" } : { width: 2 },
      itemStyle: l.emphasis ? { color: SEMANTIC.reference } : undefined,
    })),
  };
}

type RiskRow = { name: string; ELEVE: number; MOYEN: number };

// Risques élevés et moyens par département : barres groupées triées, valeurs écrites ; Faible et non évalués restent dans le tableau
export function riskByDepartmentOption(rows: RiskRow[]): EChartsOption {
  const levels = RISK_LEVELS.filter((l) => l.key === "ELEVE" || l.key === "MOYEN");
  return {
    animation: false,
    grid: { left: 8, right: 32, top: 32, bottom: 8, outerBoundsMode: "same", outerBoundsContain: "all" },
    legend: { top: 0, left: 0, icon: "roundRect", data: levels.map((l) => l.label) },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", min: 0, minInterval: 1, show: false },
    yAxis: { type: "category", inverse: true, data: rows.map((r) => shortDepartment(r.name)), axisLabel: { width: 150, overflow: "truncate" } },
    series: levels.map((l) => ({
      name: l.label,
      type: "bar" as const,
      barMaxWidth: 14,
      barGap: "15%",
      barCategoryGap: "30%",
      itemStyle: { color: l.color, borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", fontSize: 12 },
      data: rows.map((r) => r[l.key]),
    })),
  };
}

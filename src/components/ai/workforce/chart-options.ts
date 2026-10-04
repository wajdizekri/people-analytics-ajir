import type { EChartsOption } from "echarts";
import { AXIS, GRID } from "@/components/charts/pbi";
import { BAND_FILL, CHART_PALETTE, SEMANTIC } from "@/components/charts/theme";

// Observé + projeté avec bande de fourchette. Base sérialisable ; les formats français (axe, infobulle, étiquette de fin)
// sont ajoutés côté navigateur par ProjectionChart.

const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const monthShort = (ym: string) => `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Charte : bleu ArabSoft = valeur observée ; gris en tirets = prévision, bande grise = fourchette ; scénario de référence
// (comparaison d'un scénario simulé) en magenta AJIR pointillé (CHART_PALETTE[1]) pour rester distinct des deux gris. Couleurs claires canoniques :
// EChart les remplace par leurs équivalents sombres (DARK_COLORS) en thème sombre.
export const PROJECTION_COLORS = { observed: SEMANTIC.neutre, projected: SEMANTIC.prevision, band: BAND_FILL, reference: CHART_PALETTE[1] } as const;
export const SERIES = { observed: "Observé", projected: "Projection", band: "Fourchette probable à 80 %", reference: "Scénario de référence" } as const;

export type Point = { month: string; value: number };
export type Band = Point & { lower: number; upper: number };

export function projectionOption(opts: { observed: Point[]; projected: Band[]; reference?: Band[] | null; divisor?: number; digits?: number; axisName: string }): EChartsOption {
  const div = opts.divisor ?? 1;
  const f = 10 ** (opts.digits ?? 0);
  const r = (v: number) => Math.round((v / div) * f) / f;
  const obs = opts.observed;
  const pr = opts.projected;
  const labels = [...obs.map((p) => p.month), ...pr.map((p) => p.month)].map(monthShort);
  const nObs = obs.length;
  const pad = (n: number) => new Array<null>(n).fill(null);
  const anchor = nObs ? r(obs[nObs - 1].value) : null;
  const head = (v: number | null) => [...pad(Math.max(0, nObs - 1)), ...(nObs ? [v] : [])];
  const hidden = { lineStyle: { opacity: 0 }, symbol: "none", silent: true } as const;
  const ref = opts.reference?.length ? opts.reference : null;

  return {
    animation: false,
    grid: { ...GRID, left: 56, right: 72, top: 28, bottom: 28 },
    legend: { show: false },
    xAxis: { type: "category", data: labels, boundaryGap: false, ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, name: opts.axisName, nameGap: 12, nameTextStyle: { color: AXIS.axisLabel.color, fontSize: 12, align: "left" }, ...AXIS },
    series: [
      {
        name: SERIES.observed,
        type: "line",
        data: [...obs.map((p) => r(p.value)), ...pad(pr.length)],
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { width: 2.5, color: PROJECTION_COLORS.observed },
        itemStyle: { color: PROJECTION_COLORS.observed },
        markLine: nObs
          ? {
              symbol: "none",
              silent: true,
              label: { formatter: "Observé  │  Projection", position: "end", color: AXIS.axisLabel.color, fontSize: 12 },
              lineStyle: { type: "solid", color: "#cbd5e1" },
              data: [{ xAxis: labels[nObs - 1] }],
            }
          : undefined,
      },
      { name: "_basse", type: "line", stack: "ic", data: [...head(anchor), ...pr.map((p) => r(p.lower))], ...hidden },
      {
        name: SERIES.band,
        type: "line",
        stack: "ic",
        data: [...head(nObs ? 0 : null), ...pr.map((p) => Math.round((r(p.upper) - r(p.lower)) * f) / f)],
        ...hidden,
        areaStyle: { color: PROJECTION_COLORS.band },
      },
      ...(ref
        ? [
            {
              name: SERIES.reference,
              type: "line" as const,
              data: [...head(anchor), ...ref.map((p) => r(p.value))],
              symbol: "none",
              lineStyle: { width: 1.5, type: "dotted" as const, color: PROJECTION_COLORS.reference },
              itemStyle: { color: PROJECTION_COLORS.reference },
            },
          ]
        : []),
      {
        name: SERIES.projected,
        type: "line",
        data: [...head(anchor), ...pr.map((p) => r(p.value))],
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { width: 2.5, type: "dashed", color: PROJECTION_COLORS.projected },
        itemStyle: { color: PROJECTION_COLORS.projected },
      },
    ],
  };
}

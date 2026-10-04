import type { ChartSpec, ChartTable } from "@/components/charts/builders";
import { BAND_FILL, CHART_PALETTE, NBSP, SEMANTIC, frNumber } from "@/components/charts/theme";
import type { CurveSummary } from "@/lib/retention/summary";

// Courbe de maintien en escalier (Kaplan-Meier) : une série par groupe, l'ensemble en référence avec sa bande d'IC à 95 %.
// Option sérialisable (aucune fonction) : infobulles précalculées dans data.tip, rendues par le wrapper EChart.

export type RetentionSeries = { name: string; curve: CurveSummary };

export const CI_LABEL = "Intervalle de confiance à 95 %";

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${frNumber(v * 100, 1)}${NBSP}%`);
export const ciText = (lower: number | null, upper: number | null) => (lower == null || upper == null ? "—" : `${frNumber(lower * 100, 1)} – ${frNumber(upper * 100, 1)}${NBSP}%`);
export const followedText = (n: number | null) => (n == null ? "—" : `${frNumber(n, 0)} suivi${n > 1 ? "s" : ""}`);
export const monthsText = (m: number) => `${frNumber(m, 0)}${NBSP}mois`;

const grid = (top: number) => ({ left: 8, right: 24, top, bottom: 8, outerBoundsMode: "same" as const, outerBoundsContain: "all" as const });

function points(c: CurveSummary) {
  return c.survival.map((s, m) =>
    s == null ? null : { value: Math.round(s * 1000) / 10, tip: `${pct(s)} · IC ${ciText(c.lower[m], c.upper[m])} · ${followedText(c.atRisk[m])}` },
  );
}

function milestoneRows(name: string, c: CurveSummary): string[][] {
  return c.milestones.map((ms) => [name, monthsText(ms.months), pct(ms.survival), ciText(ms.lower, ms.upper), ms.atRisk == null ? "moins de 5" : frNumber(ms.atRisk, 0)]);
}

export function retentionTable(overall: RetentionSeries | null, groups: RetentionSeries[], measure: string): ChartTable {
  return {
    headers: ["Groupe", "Ancienneté", measure, CI_LABEL, "Encore suivis"],
    rows: [...(overall ? milestoneRows(overall.name, overall.curve) : []), ...groups.flatMap((g) => milestoneRows(g.name, g.curve))],
  };
}

export function retentionChart(i: { overall: RetentionSeries; groups: RetentionSeries[]; tableGroups: RetentionSeries[]; measure: string; height?: number }): ChartSpec {
  const segmented = i.groups.length > 0;
  const months = i.overall.curve.survival.length;
  const categories = Array.from({ length: months }, (_, m) => `${m} mois`);
  const o = i.overall.curve;
  const bandLower = o.lower.map((v) => ({ value: v == null ? null : Math.round(v * 1000) / 10, skip: true }));
  const bandWidth = o.upper.map((v, m) => {
    const lo = o.lower[m];
    return { value: v == null || lo == null ? null : Math.round((v - lo) * 1000) / 10, skip: true };
  });
  const band = [
    { name: CI_LABEL, type: "line" as const, step: "end" as const, stack: "ic", data: bandLower, symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: "#c3ccd8" }, silent: true, z: 1 },
    {
      name: CI_LABEL,
      type: "line" as const,
      step: "end" as const,
      stack: "ic",
      data: bandWidth,
      symbol: "none",
      lineStyle: { opacity: 0 },
      itemStyle: { color: "#c3ccd8" },
      areaStyle: { color: BAND_FILL },
      silent: true,
      z: 1,
    },
  ];
  const line = (name: string, c: CurveSummary, color: string, dashed: boolean, z: number, withMedian: boolean) => ({
    name,
    type: "line" as const,
    step: "end" as const,
    data: points(c),
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: dashed ? 2 : 2.5, color, type: dashed ? ("dashed" as const) : ("solid" as const) },
    itemStyle: { color },
    emphasis: { focus: "series" as const },
    markLine: withMedian
      ? {
          silent: true,
          symbol: ["none", "none"],
          data: [
            {
              yAxis: 50,
              label: { formatter: "50 % : durée médiane", position: "insideEndTop" as const, color: "#334155", fontSize: 12 },
              lineStyle: { color: SEMANTIC.reference, type: "dashed" as const, width: 1 },
            },
          ],
        }
      : undefined,
    z,
  });
  const groupLines = i.groups.map((g, k) => line(g.name, g.curve, CHART_PALETTE[k % CHART_PALETTE.length], false, 3, false));
  const overallLine = line(i.overall.name, o, segmented ? SEMANTIC.reference : SEMANTIC.neutre, segmented, 2, true);
  const names = [...i.groups.map((g) => g.name), i.overall.name, CI_LABEL];
  const at = (c: CurveSummary, m: number) => c.milestones.find((x) => x.months === m)?.survival ?? null;
  const summary = [i.overall, ...i.groups]
    .map((s) => {
      const parts = [12, 24].flatMap((m) => (at(s.curve, m) == null ? [] : [`${pct(at(s.curve, m))} à ${m} mois`]));
      return parts.length ? `${s.name} : ${parts.join(", ")}` : null;
    })
    .filter(Boolean)
    .join(" ; ");

  return {
    option: {
      animation: false,
      grid: grid(segmented ? 88 : 64),
      legend: { top: 0, left: 0, data: names, icon: "roundRect" },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: categories,
        boundaryGap: false,
        name: "Ancienneté depuis l'embauche",
        nameLocation: "middle",
        nameGap: 30,
        axisLabel: { interval: months > 49 ? 11 : 5 },
      },
      yAxis: {
        type: "value",
        name: `${i.measure} (%)`,
        nameLocation: "end",
        nameGap: 14,
        nameTextStyle: { align: "left" },
        min: 0,
        max: 100,
        axisLabel: { formatter: "{value} %" },
      },
      series: [...band, overallLine, ...groupLines],
    },
    format: { unit: "%", digits: 1 },
    height: i.height ?? 340,
    ariaLabel: `Courbe de maintien en escalier : ${i.measure.toLowerCase()} selon l'ancienneté depuis l'embauche, de 0 à ${months - 1} mois.${summary ? ` ${summary}.` : ""}`,
    table: retentionTable(i.overall, i.tableGroups, i.measure),
  };
}


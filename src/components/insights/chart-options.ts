import type { EChartsOption } from "echarts";
import { AXIS, GRID, TOOLTIP_AXIS } from "@/components/charts/pbi";
import type { DriftStatus } from "@/lib/drift/psi";
import { DRIFT_COLORS } from "./labels";

// Options sérialisables (sans fonction), construites côté serveur et rendues par le wrapper client EChart
const valueAxis = { type: "value" as const, ...AXIS, axisLine: { show: false } };
const nameAxisLabel = { ...AXIS.axisLabel, width: 190, overflow: "truncate" as const };

// PSI par variable, trié décroissant, barres colorées par statut et repères aux seuils
export function psiBarsOption(rows: { label: string; psi: number; status: DriftStatus }[], thresholds: { moderate: number; strong: number }): EChartsOption {
  const sorted = [...rows].sort((a, b) => b.psi - a.psi);
  return {
    grid: { left: 200, right: 48, top: 24, bottom: 8 },
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: { ...valueAxis, name: "PSI", nameGap: 6, nameTextStyle: { color: "#64748b", fontSize: 11 } },
    yAxis: { type: "category", data: sorted.map((r) => r.label), inverse: true, ...AXIS, axisLabel: nameAxisLabel, splitLine: { show: false } },
    series: [
      {
        name: "PSI",
        type: "bar",
        barMaxWidth: 16,
        data: sorted.map((r) => ({ value: Math.round(r.psi * 1000) / 1000, itemStyle: { color: DRIFT_COLORS[r.status], borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: "right", fontSize: 10, color: "#334155" },
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { type: "dashed", color: "#475569" },
          label: { formatter: "{c}", color: "#475569", fontSize: 10 },
          data: [{ xAxis: thresholds.moderate }, { xAxis: thresholds.strong }],
        },
      },
    ],
  };
}

// Rapport observé / prévu par cohorte avec la bande cible
export function oeLineOption(labels: string[], oe: (number | null)[], target: [number, number]): EChartsOption {
  return {
    grid: { ...GRID, top: 16 },
    tooltip: TOOLTIP_AXIS,
    xAxis: { type: "category", data: labels, ...AXIS, boundaryGap: false, splitLine: { show: false } },
    yAxis: { ...valueAxis, min: 0 },
    series: [
      {
        name: "Observé / prévu",
        type: "line",
        data: oe.map((v) => (v == null ? null : Math.round(v * 100) / 100)),
        symbolSize: 6,
        lineStyle: { width: 2 },
        markArea: { silent: true, itemStyle: { color: "rgba(21,128,61,0.08)" }, data: [[{ yAxis: target[0] }, { yAxis: target[1] }]] },
        markLine: { symbol: "none", silent: true, lineStyle: { type: "dashed", color: "#475569" }, label: { show: false }, data: [{ yAxis: 1 }] },
      },
    ],
  };
}

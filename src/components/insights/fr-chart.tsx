"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/echart";

// Repli local en attendant le format français dans EChart (docs/qa/DEMANDES_COMPOSANTS.md) : les options restent
// sérialisables côté serveur, les formateurs (fonctions) sont posés ici, côté navigateur. Valeurs « pct » déjà en %.
export type ChartUnit = "int" | "pct" | "pct2" | "h";

const NBSP = " ";
const num = (v: number, max: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: max });
export const FORMAT: Record<ChartUnit, (v: number) => string> = {
  int: (v) => num(Math.round(v), 0),
  pct: (v) => `${num(v, 1)}${NBSP}%`,
  pct2: (v) => `${num(v, 2)}${NBSP}%`,
  h: (v) => `${num(v, 1)}${NBSP}h`,
};

type Obj = Record<string, unknown>;
const asList = (v: unknown): Obj[] => (Array.isArray(v) ? v : v ? [v] : []) as Obj[];
const valueOf = (p: unknown): number | null => {
  const v = (p as { value?: unknown })?.value ?? p;
  const n = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function withFrenchFormat(option: EChartsOption, unit: ChartUnit): EChartsOption {
  const f = FORMAT[unit];
  const label = (p: unknown) => {
    const v = valueOf(p);
    return v == null ? "" : f(v);
  };
  const axis = (a: unknown) =>
    asList(a).map((x) => (x.type === "value" ? { ...x, axisLabel: { ...(x.axisLabel as Obj), formatter: (v: number) => f(v) } } : x));
  const withLabel = (l: unknown) => (l && typeof l === "object" && !("formatter" in l) ? { ...(l as Obj), formatter: label } : l);
  const o: Obj = { ...(option as Obj) };
  if (o.xAxis) o.xAxis = axis(o.xAxis);
  if (o.yAxis) o.yAxis = axis(o.yAxis);
  if (o.tooltip) o.tooltip = { ...(o.tooltip as Obj), valueFormatter: (v: unknown) => (typeof v === "number" ? f(v) : "—") };
  if (o.series) o.series = asList(o.series).map((s) => ({ ...s, label: withLabel(s.label), endLabel: withLabel(s.endLabel) }));
  return o as EChartsOption;
}

export function FrChart({ option, unit, height, ariaLabel }: { option: EChartsOption; unit: ChartUnit; height?: number; ariaLabel: string }) {
  const formatted = useMemo(() => withFrenchFormat(option, unit), [option, unit]);
  return <EChart option={formatted} height={height} ariaLabel={ariaLabel} />;
}

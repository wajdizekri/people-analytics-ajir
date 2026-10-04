"use client";

import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/echart";
import { AXIS, LEGEND, TOOLTIP_AXIS } from "@/components/charts/pbi";
import { DARK_COLORS } from "@/components/charts/theme";
import { useTheme } from "@/components/ui/theme";
import { PROJECTION_COLORS, SERIES, monthShort, projectionOption, type Band, type Point } from "./chart-options";

const nf = (d: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

function Swatch({ kind, dark }: { kind: "observed" | "projected" | "band" | "reference"; dark: boolean }) {
  if (kind === "band")
    return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-5 rounded-sm ring-1 ring-inset ring-line-strong/50"
        style={{ background: dark ? (DARK_COLORS[PROJECTION_COLORS.band] ?? PROJECTION_COLORS.band) : PROJECTION_COLORS.band }}
      />
    );
  const dash = kind === "observed" ? undefined : kind === "projected" ? "5 3" : "1.5 2.5";
  const color = dark ? (DARK_COLORS[PROJECTION_COLORS[kind]] ?? PROJECTION_COLORS[kind]) : PROJECTION_COLORS[kind];
  return (
    <svg aria-hidden="true" viewBox="0 0 24 6" className="h-1.5 w-6 shrink-0 overflow-visible">
      <line x1="0" y1="3" x2="24" y2="3" stroke={color} strokeWidth="3" strokeDasharray={dash} strokeLinecap={kind === "reference" ? "round" : "butt"} />
    </svg>
  );
}

// Légende en texte, dans l'ordre de lecture : observé, projection, fourchette (expliquée), référence
export function ProjectionLegend({ observedMonths, simulated }: { observedMonths: number; simulated: boolean }) {
  const dark = useTheme().resolvedTheme === "dark";
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      <li className="inline-flex items-center gap-1.5">
        <Swatch kind="observed" dark={dark} /> {SERIES.observed} ({observedMonths} derniers mois)
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Swatch kind="projected" dark={dark} /> {simulated ? "Projection du scénario simulé" : "Projection (scénario de référence)"}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Swatch kind="band" dark={dark} /> {SERIES.band} : la valeur réelle devrait s&apos;y trouver dans 8 cas sur 10
      </li>
      {simulated && (
        <li className="inline-flex items-center gap-1.5">
          <Swatch kind="reference" dark={dark} /> {SERIES.reference}, pour comparaison
        </li>
      )}
    </ul>
  );
}

export function ProjectionChart({
  observed,
  projected,
  reference,
  divisor = 1,
  digits = 0,
  unit,
  axisName,
  height = 300,
  ariaLabel,
}: {
  observed: Point[];
  projected: Band[];
  reference?: Band[] | null;
  divisor?: number;
  digits?: number;
  unit: string;
  axisName: string;
  height?: number;
  ariaLabel: string;
}) {
  const base = projectionOption({ observed, projected, reference, divisor, digits, axisName });
  const num = nf(digits);
  // Infobulle en valeur exacte (unité pleine), axe et étiquette de fin dans l'unité de l'axe
  const val = (v: number) => `${(divisor === 1 ? num : nf(0)).format(v)} ${unit}`;
  const nObs = observed.length;
  const refByMonth = new Map((reference ?? []).map((p) => [p.month, p]));

  const tooltip = (params: unknown) => {
    const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number } | undefined;
    const i = first?.dataIndex ?? 0;
    if (i < nObs) return `<strong>${monthShort(observed[i].month)}</strong><br/>${SERIES.observed} : ${val(observed[i].value)}`;
    const p = projected[i - nObs];
    if (!p) return "";
    const ref = refByMonth.get(p.month);
    return (
      `<strong>${monthShort(p.month)}</strong><br/>${SERIES.projected} : ${val(p.value)}` +
      `<br/>${SERIES.band} : ${val(p.lower)} – ${val(p.upper)}` +
      (ref ? `<br/>${SERIES.reference} : ${val(ref.value)}` : "")
    );
  };

  const option: EChartsOption = {
    ...base,
    tooltip: { ...TOOLTIP_AXIS, formatter: tooltip },
    yAxis: { ...(base.yAxis as object), axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => nf(0).format(v) } },
    series: (base.series as Record<string, unknown>[]).map((s) =>
      s.name === SERIES.projected
        ? { ...s, endLabel: { show: true, color: LEGEND.textStyle.color, fontWeight: 600, fontSize: 12, formatter: (p: { value: number }) => num.format(p.value) } }
        : s,
    ) as EChartsOption["series"],
  };
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

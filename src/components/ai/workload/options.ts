import type { EChartsOption } from "echarts";
import { AXIS, CHART_PALETTE, GRID, LEGEND, SEMANTIC, TOOLTIP_AXIS, barChart, lineChart, type ChartSpec, type Tone } from "@/components/charts/pbi";
import type { GroupView, Tension } from "@/lib/dal/ai-workload";
import { fr } from "./insight-kit";

// Visuels de /charge. Les helpers partagés (lineChart, barChart) donnent formats français, tableau « Voir les données »
// et texte pour lecteur d'écran ; seule la vue « plusieurs équipes » du manager garde une option écrite à la main.
export const monthShort = fr.monthShort;
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
const MEASURE = "Heures sup par ETP";
export const tensionTone = (t: Tension): Tone | undefined => (t === "PROBABLE" ? "defavorable" : t === "POSSIBLE" ? "attention" : undefined);

// Une série observée (bleu) prolongée par la prévision (gris en tirets) et sa fourchette probable à 80 %
export function groupLineChart(g: GroupView, threshold: number | null, height = 300): ChartSpec {
  const months = [...g.observed.map((p) => p.month), ...g.forecast.map((p) => p.month)];
  const nObs = g.observed.length;
  const pad = (n: number) => new Array<null>(n).fill(null);
  const anchor = nObs ? [{ value: r1(g.observed[nObs - 1].value), skip: true }] : [];
  const lead = pad(Math.max(0, nObs - 1));
  const hasBand = g.forecast.some((p) => p.lower != null && p.upper != null);
  return lineChart({
    categories: months.map(monthShort),
    series: [
      { name: "Observé", values: [...g.observed.map((p) => r1(p.value)), ...pad(g.forecast.length)], tone: "neutre" },
      { name: "Prévision", values: [...lead, ...anchor, ...g.forecast.map((p) => r1(p.value))], tone: "prevision" },
    ],
    band: hasBand
      ? { lower: [...lead, ...anchor, ...g.forecast.map((p) => r1(p.lower))], upper: [...lead, ...anchor, ...g.forecast.map((p) => r1(p.upper))] }
      : undefined,
    measure: MEASURE,
    unit: "h",
    digits: 1,
    references: threshold != null ? [{ value: threshold, label: "Seuil de tension" }] : undefined,
    categoryName: "Mois",
    height,
  });
}

// Barres horizontales (axe des catégories inversé) : étiquette de la ligne de référence posée en haut de la ligne, à l'horizontale
// (le helper partagé l'écrit le long de la ligne verticale, par-dessus les barres).
export function topReferenceLabels(spec: ChartSpec): ChartSpec {
  const o = spec.option as { grid?: Record<string, unknown>; series?: { markLine?: { data?: { label?: Record<string, unknown> }[] } }[] };
  const ml = o.series?.[0]?.markLine;
  if (!ml?.data?.length) return spec;
  ml.data = ml.data.map((d) => ({ ...d, label: { ...d.label, position: "start", distance: 4 } }));
  o.grid = { ...o.grid, top: 28 };
  spec.height += 20;
  return spec;
}

// Un nom par barre, même sur mobile : les noms d'équipe tiennent sur une ligne, mais la boîte d'étiquette (deux lignes sous 640 px)
// déborde sur la barre voisine et ECharts masquait une étiquette sur deux.
function everyCategoryLabel(spec: ChartSpec): ChartSpec {
  const o = spec.option as { yAxis?: { axisLabel?: Record<string, unknown> } };
  if (o.yAxis && !Array.isArray(o.yAxis)) o.yAxis = { ...o.yAxis, axisLabel: { ...o.yAxis.axisLabel, interval: 0, hideOverlap: false } };
  return spec;
}

// Pic prévu par équipe (barres triées) : rouge = tension probable, ambre = possible, seuil en ligne de référence
export function peakBars(rows: { name: string; value: number; tension: Tension; tip: string }[], threshold: number | null): ChartSpec {
  return everyCategoryLabel(
    topReferenceLabels(
      barChart({
        rows: rows.map((r) => ({ name: r.name, value: r1(r.value), tone: tensionTone(r.tension), tip: r.tip })),
        measure: "Pic prévu d'heures sup par ETP",
        unit: "h",
        digits: 1,
        references: threshold != null ? [{ value: threshold, label: "Seuil de tension" }] : undefined,
        categoryName: "Équipe (manager)",
      }),
    ),
  );
}

// Départements : pic prévu, couleur de tension, moyenne de l'entreprise en référence
export function departmentBars(rows: { name: string; value: number; tension: Tension; tip: string }[], company: number | null): ChartSpec {
  return topReferenceLabels(
    barChart({
      rows: rows.map((r) => ({ name: r.name, value: r1(r.value), tone: tensionTone(r.tension), tip: r.tip })),
      measure: "Pic prévu d'heures sup par ETP",
      unit: "h",
      digits: 1,
      references: company != null ? [{ value: r1(company)!, label: "Entreprise" }] : undefined,
      categoryName: "Département",
    }),
  );
}

export type SeriesInput = {
  name: string;
  observed: { month: string; value: number }[];
  forecast: { month: string; value: number; lower: number | null; upper: number | null }[];
};

// Manager avec plusieurs équipes : une couleur par équipe, observé (trait plein) puis prévu (tirets), seuil annoté.
// Les valeurs sont formatées en français par le wrapper EChart (format { unit: "h", digits: 1 }).
export function observedForecastOption(groups: SeriesInput[], threshold: number | null): EChartsOption {
  const months = [...new Set(groups.flatMap((g) => [...g.observed.map((p) => p.month), ...g.forecast.map((p) => p.month)]))].sort();
  const idx = new Map(months.map((m, i) => [m, i]));
  const series: Record<string, unknown>[] = [];
  groups.forEach((g, k) => {
    const color = CHART_PALETTE[k % CHART_PALETTE.length];
    const obs: (number | null)[] = months.map(() => null);
    const fc: (number | null)[] = months.map(() => null);
    for (const p of g.observed) obs[idx.get(p.month)!] = r1(p.value);
    const last = g.observed[g.observed.length - 1];
    if (last && g.forecast.length) fc[idx.get(last.month)!] = r1(last.value);
    for (const p of g.forecast) fc[idx.get(p.month)!] = r1(p.value);
    series.push({ name: g.name, type: "line", data: obs, symbolSize: 5, lineStyle: { width: 2.5, color }, itemStyle: { color } });
    series.push({
      name: g.name,
      type: "line",
      data: fc,
      symbolSize: 5,
      lineStyle: { width: 2, color, type: "dashed" },
      itemStyle: { color },
      connectNulls: false,
    });
  });
  if (threshold != null && series.length)
    series[0].markLine = {
      silent: true,
      symbol: "none",
      lineStyle: { color: SEMANTIC.reference, type: "dashed", width: 1.5 },
      label: { formatter: `Seuil de tension : ${fr.hours(threshold)}`, position: "insideEndTop", color: SEMANTIC.reference, fontSize: 12, fontWeight: 600 },
      data: [{ yAxis: threshold }],
    };
  return {
    grid: { ...GRID, top: 56 },
    legend: { ...LEGEND, type: "scroll" },
    tooltip: TOOLTIP_AXIS,
    xAxis: { type: "category", data: months.map(monthShort), boundaryGap: false, ...AXIS, splitLine: { show: false } },
    yAxis: { type: "value", name: `${MEASURE} (h)`, nameTextStyle: { align: "left" }, ...AXIS, axisLine: { show: false }, min: 0 },
    series: series as EChartsOption["series"],
  };
}

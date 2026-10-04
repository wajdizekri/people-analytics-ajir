import type { EChartsOption, MarkLineComponentOption } from "echarts";
import { BAND_FILL, BAND_LABEL, CHART_INK, CHART_PALETTE, CHART_SURFACE, MARK, SEMANTIC, axisName, formatShort, formatValue, frNumber, type Tone, type ValueFormat } from "./theme";

// Les 5 visuels de la charte (docs/qa/CHARTE_UI.md § 5), prêts à l'emploi : courbe d'évolution, barres horizontales triées,
// barre empilée 100 %, anneau ≤ 4 parts, histogramme. Chaque helper renvoie un ChartSpec sérialisable (aucune fonction) :
// option ECharts, format des valeurs, résumé pour lecteur d'écran et tableau « Voir les données ».
// Usage : <ChartCard title="L'absentéisme baisse depuis mars" measure="Taux d'absence" unit="%" period="sept. 2025 – août 2026" chart={lineChart({...})} />

export type ChartTable = { headers: string[]; rows: string[][] };
export type ChartSpec = {
  option: EChartsOption;
  format: ValueFormat;
  height: number;
  mobileHeight?: number;
  ariaLabel: string;
  table: ChartTable;
};
export type Reference = { value: number; label: string };

const LABEL_COLOR = CHART_INK.ink;
const DARK_TEXT = CHART_INK.fg;

// Marques de la compétence dataviz (MARK de theme.ts, partagé avec le kit pbi.tsx) : barre de 24 px au plus à bout arrondi
// de 4 px, 2 px entre aplats accolés, courbe de 2 px, repère de 8 px cerclé de la surface, lavis à 10 %.
const BAR_MAX = MARK.bar.barMaxWidth;
const BAR_END = MARK.bar.itemStyle.borderRadius;
const COLUMN_END = MARK.column.itemStyle.borderRadius;
const STACK_GAP = MARK.stack.itemStyle;
const LINE_WIDTH = MARK.line.lineStyle.width;
const MARKER = MARK.line.symbolSize;
const MARKER_RING = MARK.line.itemStyle;
const AREA_OPACITY = MARK.area.opacity;

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
// Texte lisible posé sur un aplat : blanc ou encre selon le meilleur contraste
export function textOn(fill: string) {
  if (!/^#[0-9a-f]{6}$/i.test(fill)) return DARK_TEXT;
  const l = lum(fill);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (lum(DARK_TEXT) + 0.05) ? "#ffffff" : DARK_TEXT;
}

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** Libellés de mois d'axe uniques (REVUE_TRANSVERSE T13) : ["2025-09", …] → ["sept. 2025", …]. */
export function monthCategories(yms: string[]) {
  return yms.map((ym) => {
    const m = /^(\d{4})-(\d{2})/.exec(ym);
    return m ? `${MONTHS_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : ym;
  });
}

// Teinte d'une série : ton de la charte, sinon la teinte de son rang dans CHART_PALETTE ; au-delà des 6 teintes, jamais une teinte
// recyclée : gris de contexte (parts additives regroupées dans « Autres » par foldParts, courbes en trait pointillé par lineChart)
const colorOf = (tone: Tone | undefined, i: number): string => (tone ? SEMANTIC[tone] : (CHART_PALETTE[i] ?? SEMANTIC.contexte));
const beyondPalette = (tone: Tone | undefined, i: number) => !tone && i >= CHART_PALETTE.length;

type Part = { label: string; tone?: Tone };
const OTHERS = "Autres";
// Parts d'un total (empilé, 100 %) : celles qui n'ont plus de teinte sont additionnées dans « Autres » (une seule : grise sous son nom).
// Le tableau « Voir les données » garde le détail de chaque part.
function foldParts(parts: Part[]) {
  const extra = parts.flatMap((p, k) => (beyondPalette(p.tone, k) ? [k] : []));
  if (extra.length < 2) return { parts, fold: (values: number[]) => values, folded: [] as string[] };
  const keep = parts.flatMap((_, k) => (extra.includes(k) ? [] : [k]));
  return {
    parts: [...keep.map((k) => parts[k]), { label: OTHERS, tone: "contexte" as Tone }],
    fold: (values: number[]) => [...keep.map((k) => values[k] || 0), extra.reduce((s, k) => s + (values[k] || 0), 0)],
    folded: extra.map((k) => parts[k].label),
  };
}
const partNames = (parts: Part[], folded: string[]) => parts.map((p) => (folded.length && p.label === OTHERS && p.tone === "contexte" ? `${OTHERS} (${folded.join(", ")})` : p.label)).join(", ");

// Segment d'une pile : bout arrondi sur le dernier segment non nul ; segment nul sans bordure (pas de trait de surface sur l'axe)
const segmentStyle = (value: number, last: boolean, radius: [number, number, number, number]) =>
  last ? { itemStyle: { borderRadius: radius } } : value === 0 ? { itemStyle: { borderWidth: 0 } } : {};

const missing = (d: unknown) => d == null || d === "-" || (typeof d === "object" && !Array.isArray(d) && ((d as { value?: unknown }).value == null || (d as { value?: unknown }).value === "-"));
/** Un point sans voisin renseigné (série d'un seul point comprise) : invisible sur une courbe sans repère. Points de raccord (skip) exclus. */
export function hasIsolatedPoint(data: unknown): boolean {
  if (!Array.isArray(data)) return false;
  return data.some((d, k) => !missing(d) && !(d as { skip?: boolean } | null)?.skip && missing(data[k - 1]) && missing(data[k + 1]));
}

// Marge intérieure : les étiquettes et noms d'axes restent dans le cadre (aucun débordement)
const grid = (top: number, bottom = 8, right = 24) => ({ left: 8, right, top, bottom, outerBoundsMode: "same" as const, outerBoundsContain: "all" as const });

// Épaisseur d'une barre de shareChart : tracé = hauteur moins légende (40), marge basse (30), graduations et nom de l'axe (44 ;
// 40 sans axe des catégories), partagé entre les lignes ; barre = 70 % de sa bande, 24 px au plus (écart au rendu ECharts < 1 px :
// tests/charts-marks)
function shareBarThickness(height: number, rows: number, categoryAxis: boolean) {
  return Math.min(BAR_MAX, (0.7 * Math.max(0, height - (categoryAxis ? 114 : 110))) / Math.max(1, rows));
}

// Arrondi « agréable » vers le haut (1, 2, 2,5, 5 × 10^n) pour inclure une ligne de référence dans l'axe
function niceCeil(v: number) {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = [1, 2, 2.5, 5, 10].find((k) => k * p >= v)!;
  return m * p;
}

const lastValue = (values: (number | null)[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return { value: values[i] as number, index: i };
  return null;
};

// Ligne horizontale d'une courbe : étiquette en bout de ligne, hors du tracé, sur deux lignes (libellé puis valeur) ; la marge droite lui est réservée
const END_LABEL_MAX = 104;
function endLabelWidth(refs: Reference[] | undefined, f: ValueFormat): number {
  if (!refs?.length) return 0;
  const chars = Math.max(...refs.flatMap((r) => [r.label.length, formatValue(r.value, f).length]));
  return Math.min(END_LABEL_MAX, Math.ceil(chars * 6.8) + 4);
}

function referenceLine(refs: Reference[] | undefined, axis: "xAxis" | "yAxis", f: ValueFormat): MarkLineComponentOption | undefined {
  if (!refs?.length) return undefined;
  const width = endLabelWidth(refs, f);
  return {
    silent: true,
    symbol: ["none", "none"],
    data: refs.map((r) => ({
      ...(axis === "yAxis" ? { yAxis: r.value } : { xAxis: r.value }),
      // Ligne horizontale : texte à droite du bout de ligne (jamais sur la courbe) ; ligne verticale : texte horizontal au-dessus du tracé
      label:
        axis === "yAxis"
          ? { formatter: `${r.label}\n${formatValue(r.value, f)}`, position: "end" as const, distance: 6, width, overflow: "break" as const, lineHeight: 15, color: LABEL_COLOR, fontSize: 12 }
          : { formatter: `${r.label} : ${formatValue(r.value, f)}`, position: "end" as const, color: LABEL_COLOR, fontSize: 12 },
      lineStyle: { color: SEMANTIC.reference, type: "dashed" as const, width: 1.5 },
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Courbe d'évolution (une à cinq séries), lignes de référence annotées, bande d'incertitude pour les prévisions
// ---------------------------------------------------------------------------------------------------------------
// Point masqué de l'infobulle (raccord observé → prévision) : { value, skip: true }
export type ChartPoint = number | null | { value: number | null; skip?: boolean };
const val = (v: ChartPoint): number | null => (v == null ? null : typeof v === "number" ? v : v.value);
const skipped = (v: ChartPoint) => v != null && typeof v === "object" && !!v.skip;

const EXTRA_DASH: ("dotted" | number[])[] = ["dotted", [8, 3, 2, 3], [2, 5], [12, 4]];

export type LineSeries = {
  name: string;
  values: ChartPoint[];
  /** Sens de la couleur : neutre (bleu ArabSoft), favorable, attention, defavorable, reference, prevision (gris en tirets). */
  tone?: Tone;
  dashed?: boolean;
  area?: boolean;
};

export function lineChart(i: {
  categories: string[];
  series: LineSeries[];
  measure: string;
  unit?: string;
  digits?: number;
  references?: Reference[];
  band?: { lower: ChartPoint[]; upper: ChartPoint[]; label?: string };
  /** Axe à partir de 0 (défaut) ; false pour zoomer sur une variation faible. */
  zeroBased?: boolean;
  categoryName?: string;
  height?: number;
}): ChartSpec {
  const f: ValueFormat = { unit: i.unit, digits: i.digits };
  const bandLabel = i.band?.label ?? BAND_LABEL;
  const lines = i.series.map((s, k) => {
    const color = colorOf(s.tone, k);
    const dashed = s.dashed || s.tone === "prevision";
    // Au-delà des 6 teintes : gris de contexte, chaque courbe avec son motif de trait (la légende, l'infobulle et le tableau la nomment)
    const extra = beyondPalette(s.tone, k) ? EXTRA_DASH[(k - CHART_PALETTE.length) % EXTRA_DASH.length] : null;
    return {
      name: s.name,
      type: "line" as const,
      data: s.values,
      symbol: "circle",
      // Repère au survol seulement, sauf point isolé (série d'un seul point, valeur entourée de manques) : il serait invisible
      showSymbol: hasIsolatedPoint(s.values),
      symbolSize: MARKER,
      connectNulls: false,
      lineStyle: { width: LINE_WIDTH, color, type: extra ?? (dashed ? ("dashed" as const) : ("solid" as const)) },
      itemStyle: { color, ...MARKER_RING },
      areaStyle: s.area ? { color, opacity: AREA_OPACITY } : undefined,
      emphasis: { focus: "series" as const },
      markLine: k === 0 ? referenceLine(i.references, "yAxis", f) : undefined,
      z: 3,
    };
  });
  const bandSeries = i.band
    ? [
        {
          name: bandLabel,
          type: "line" as const,
          stack: "fourchette",
          data: i.band.lower.map((v) => ({ value: val(v), skip: true })),
          lineStyle: { opacity: 0 },
          itemStyle: { color: "#c3ccd8" },
          symbol: "none",
          silent: true,
          z: 1,
        },
        {
          name: bandLabel,
          type: "line" as const,
          stack: "fourchette",
          data: i.band.upper.map((up, k) => {
            const u = val(up);
            const lo = val(i.band!.lower[k]);
            if (u == null || lo == null) return { value: null, skip: true };
            return skipped(up) || skipped(i.band!.lower[k]) ? { value: u - lo, skip: true } : { value: u - lo, tip: `${formatValue(lo, f)} – ${formatValue(u, f)}` };
          }),
          lineStyle: { opacity: 0 },
          itemStyle: { color: "#c3ccd8" },
          areaStyle: { color: BAND_FILL },
          symbol: "none",
          z: 1,
        },
      ]
    : [];
  const names = [...i.series.map((s) => s.name), ...(i.band ? [bandLabel] : [])];
  const legend = names.length > 1;
  // Courbes grises en motif : leur entrée de légende dessine le trait (pastille carrée pour les autres), sinon toutes se ressemblent
  const patterned = new Set(i.series.filter((s, k) => beyondPalette(s.tone, k)).map((s) => s.name));
  const legendData = patterned.size ? names.map((n) => (patterned.has(n) ? n : { name: n, icon: "roundRect" })) : names;
  const nums = (list: ChartPoint[]) => list.map(val).filter((v): v is number => v != null);
  const dataMax = Math.max(0, ...i.series.flatMap((s) => nums(s.values)), ...nums(i.band?.upper ?? []));
  const refMax = Math.max(0, ...(i.references ?? []).map((r) => r.value));
  const first = i.categories[0] ?? "";
  const lastCat = i.categories[i.categories.length - 1] ?? "";
  const latest = i.series
    .map((s) => {
      const l = lastValue(s.values.map(val));
      return l ? `${s.name} : ${formatValue(l.value, f)} (${i.categories[l.index]})` : null;
    })
    .filter(Boolean)
    .join(" ; ");

  return {
    option: {
      animation: false,
      grid: grid(legend ? 64 : 36, 8, i.references?.length ? endLabelWidth(i.references, f) + 12 : 24),
      legend: legend ? { top: 0, left: 0, data: legendData, ...(patterned.size ? {} : { icon: "roundRect" }) } : undefined,
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: i.categories, boundaryGap: false, name: i.categoryName, nameLocation: "middle", nameGap: 30 },
      yAxis: {
        type: "value",
        name: axisName(i.measure, i.unit),
        nameLocation: "end",
        nameGap: 14,
        nameTextStyle: { align: "left" },
        min: i.zeroBased === false ? undefined : 0,
        scale: i.zeroBased === false,
        max: refMax > dataMax ? niceCeil(refMax * 1.1) : undefined,
        axisLabel: i.unit === "%" ? { formatter: "{value} %" } : undefined,
      },
      series: [...bandSeries, ...lines],
    },
    format: f,
    height: i.height ?? 280,
    ariaLabel: `Courbe d'évolution : ${axisName(i.measure, i.unit)}, de ${first} à ${lastCat}.${latest ? ` Dernière valeur : ${latest}.` : ""}${
      i.references?.length ? ` Référence : ${i.references.map((r) => `${r.label} ${formatValue(r.value, f)}`).join(", ")}.` : ""
    }`,
    table: {
      headers: [i.categoryName ?? "Période", ...i.series.map((s) => s.name), ...(i.band ? [`${bandLabel} : basse`, `${bandLabel} : haute`] : [])],
      rows: i.categories.map((c, k) => [
        c,
        ...i.series.map((s) => formatValue(val(s.values[k] ?? null), f)),
        ...(i.band ? [formatValue(val(i.band.lower[k] ?? null), f), formatValue(val(i.band.upper[k] ?? null), f)] : []),
      ]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Barres horizontales triées : comparaison entre catégories, valeurs affichées si ≤ 12 barres
// ---------------------------------------------------------------------------------------------------------------
export type BarRow = { name: string; value: number | null; tone?: Tone; tip?: string };

export function barChart(i: {
  rows: BarRow[];
  measure: string;
  unit?: string;
  digits?: number;
  /** Tri décroissant par défaut ; « none » garde l'ordre fourni (ordre naturel : tranches d'âge…). */
  sort?: "desc" | "asc" | "none";
  /** Noms mis en valeur (bleu) ; les autres barres passent en gris. */
  highlight?: string[];
  references?: Reference[];
  categoryName?: string;
  height?: number;
}): ChartSpec {
  const f: ValueFormat = { unit: i.unit, digits: i.digits };
  const rows = [...i.rows];
  if (i.sort !== "none") rows.sort((a, b) => ((i.sort === "asc" ? 1 : -1) * ((a.value ?? -Infinity) - (b.value ?? -Infinity))) || a.name.localeCompare(b.name, "fr"));
  const showValues = rows.length <= 12;
  const hl = i.highlight ? new Set(i.highlight) : null;
  const color = (r: BarRow) => (r.tone ? SEMANTIC[r.tone] : hl && !hl.has(r.name) ? SEMANTIC.contexte : SEMANTIC.neutre);
  const dataMax = Math.max(0, ...rows.map((r) => r.value ?? 0));
  const refMax = Math.max(0, ...(i.references ?? []).map((r) => r.value));
  const top = rows.filter((r) => r.value != null).slice(0, 3);
  return {
    option: {
      animation: false,
      grid: grid(i.references?.length ? 28 : 8, showValues ? 30 : 44, showValues ? 64 : 24),
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        min: 0,
        max: refMax > dataMax ? niceCeil(refMax * 1.1) : undefined,
        name: axisName(i.measure, i.unit),
        nameLocation: "middle",
        nameGap: showValues ? 10 : 30,
        axisLabel: showValues ? { show: false } : i.unit === "%" ? { formatter: "{value} %" } : undefined,
        splitLine: { show: !showValues },
      },
      yAxis: { type: "category", inverse: true, data: rows.map((r) => r.name), axisLabel: { width: 150, overflow: "truncate", ellipsis: "…" } },
      series: [
        {
          name: i.measure,
          type: "bar",
          data: rows.map((r) => ({ value: r.value, itemStyle: { color: color(r) }, tip: r.tip })),
          barMaxWidth: BAR_MAX,
          barCategoryGap: "32%",
          itemStyle: { borderRadius: BAR_END },
          label: { show: showValues, position: "right", color: LABEL_COLOR, fontSize: 12 },
          markLine: referenceLine(i.references, "xAxis", f),
        },
      ],
    },
    format: f,
    height: i.height ?? Math.max(140, rows.length * 30 + 56),
    ariaLabel: `Barres horizontales${i.sort === "none" ? "" : " triées"} : ${axisName(i.measure, i.unit)} par ${i.categoryName?.toLowerCase() ?? "catégorie"} (${rows.length}).${
      top.length ? ` En tête : ${top.map((r) => `${r.name} ${formatValue(r.value, f)}`).join(", ")}.` : ""
    }`,
    table: { headers: [i.categoryName ?? "Catégorie", axisName(i.measure, i.unit)], rows: rows.map((r) => [r.name, formatValue(r.value, f)]) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 2 bis. Barres empilées en valeurs absolues (≤ 5 composantes), total en bout de barre. Horizontales par défaut (catégories triées) ;
// orientation « vertical » pour un axe du temps : colonnes dans l'ordre fourni, total au-dessus de chaque colonne
// ---------------------------------------------------------------------------------------------------------------
export function stackedBarChart(i: {
  rows: { name: string; values: number[] }[];
  parts: { label: string; tone?: Tone }[];
  measure: string;
  unit?: string;
  digits?: number;
  /** Tri par total décroissant (défaut des barres horizontales) ou ordre fourni (défaut des colonnes : mois, tranches). */
  sort?: "desc" | "none";
  /** « vertical » : une colonne par période (axe du temps) ; valeurs des segments dans l'infobulle et le tableau, total écrit au-dessus. */
  orientation?: "horizontal" | "vertical";
  categoryName?: string;
  height?: number;
}): ChartSpec {
  const vertical = i.orientation === "vertical";
  const f: ValueFormat = { unit: i.unit, digits: i.digits };
  const { parts, fold, folded } = foldParts(i.parts);
  const rows = i.rows.map((r) => ({ ...r, shown: fold(r.values), total: r.values.reduce((a, b) => a + (b || 0), 0) }));
  if ((i.sort ?? (vertical ? "none" : "desc")) !== "none") rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "fr"));
  const max = Math.max(1, ...rows.map((r) => r.total));
  const topRow = rows.reduce<(typeof rows)[number] | null>((best, r) => (best == null || r.total > best.total ? r : best), null);
  const colors = parts.map((p, k) => colorOf(p.tone, k));
  // Bout arrondi de 4 px sur le dernier segment non nul de chaque pile, base droite
  const lastPart = rows.map((r) => r.shown.reduce((t, v, k) => (v > 0 ? k : t), -1));
  const integers = i.rows.every((r) => r.values.every((v) => Number.isInteger(v || 0)));
  const name = axisName(i.measure, i.unit);
  const categoryAxis = vertical
    ? { type: "category" as const, data: rows.map((r) => r.name), name: i.categoryName, nameLocation: "middle" as const, nameGap: 30, axisLabel: { hideOverlap: true } }
    : { type: "category" as const, inverse: true, data: rows.map((r) => r.name), axisLabel: { width: 150, overflow: "truncate" as const, ellipsis: "…" } };
  // Colonnes : marge haute pour le total écrit au-dessus de la plus haute ; nombres entiers seulement si toutes les valeurs le sont
  const valueAxis = vertical
    ? {
        type: "value" as const,
        min: 0,
        minInterval: integers ? 1 : undefined,
        boundaryGap: ["0%", "10%"] as [string, string],
        name,
        nameLocation: "end" as const,
        nameGap: 14,
        nameTextStyle: { align: "left" as const },
        axisLabel: i.unit === "%" ? { formatter: "{value} %" } : undefined,
      }
    : { type: "value" as const, min: 0, name, nameLocation: "middle" as const, nameGap: 10, axisLabel: { show: false }, splitLine: { show: false } };
  return {
    option: {
      animation: false,
      grid: vertical ? grid(64, 8, 16) : grid(40, 30, 64),
      legend: { top: 0, left: 0, data: parts.map((p) => p.label), icon: "roundRect" },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: vertical ? categoryAxis : valueAxis,
      yAxis: vertical ? valueAxis : categoryAxis,
      series: [
        ...parts.map((p, k) => ({
          name: p.label,
          type: "bar" as const,
          stack: "total",
          barMaxWidth: BAR_MAX,
          barCategoryGap: "30%",
          itemStyle: { color: colors[k], ...STACK_GAP },
          label: { show: !vertical, position: "inside" as const, color: textOn(colors[k]), fontSize: 12, fontWeight: 600 },
          data: rows.map((r, n) => {
            const v = r.shown[k] || 0;
            const end = segmentStyle(v, k === lastPart[n], vertical ? COLUMN_END : BAR_END);
            return vertical ? { value: v, ...end } : { value: v, ...end, label: { show: v / max >= 0.08 } };
          }),
        })),
        {
          name: "Total",
          type: "bar" as const,
          stack: "total",
          silent: true,
          itemStyle: { color: "transparent" },
          label: { show: true, position: vertical ? ("top" as const) : ("right" as const), color: LABEL_COLOR, fontSize: 12, fontWeight: 600 },
          data: rows.map((r) => ({ value: 0, skip: true, labelText: formatShort(r.total, f) || "0" })),
        },
      ],
    },
    format: f,
    height: i.height ?? (vertical ? 300 : Math.max(160, rows.length * 32 + 90)),
    ariaLabel: `${vertical ? "Colonnes empilées" : "Barres empilées"} : ${name} par ${i.categoryName?.toLowerCase() ?? "catégorie"}, réparties en ${partNames(parts, folded)}.${
      topRow ? ` Total le plus élevé : ${topRow.name} (${formatValue(topRow.total, f)}).` : ""
    }`,
    table: {
      headers: [i.categoryName ?? "Catégorie", ...i.parts.map((p) => p.label), "Total"],
      rows: rows.map((r) => [r.name, ...i.parts.map((_, k) => formatValue(r.values[k] || 0, { digits: f.digits })), formatValue(r.total, f)]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Barre empilée 100 % : part de chaque composante (≤ 5) dans un total, une barre par ligne
// ---------------------------------------------------------------------------------------------------------------
export function shareChart(i: {
  rows: { name: string; values: number[] }[];
  parts: { label: string; tone?: Tone }[];
  measure: string;
  /** Unité des effectifs (infobulle et tableau) : « collaborateurs » par défaut. */
  unit?: string;
  categoryName?: string;
  height?: number;
}): ChartSpec {
  const countFmt: ValueFormat = { unit: i.unit ?? "collaborateurs", digits: 0 };
  const totals = i.rows.map((r) => r.values.reduce((a, b) => a + (b || 0), 0));
  const pct = (v: number, t: number) => (t > 0 ? (v / t) * 100 : 0);
  const single = i.rows.length === 1;
  const categoryAxis = !single || i.rows[0].name !== "";
  const { parts, fold } = foldParts(i.parts);
  const shown = i.rows.map((r) => fold(r.values));
  const colors = parts.map((p, k) => colorOf(p.tone, k));
  const lastPart = shown.map((v) => v.reduce((t, x, k) => (x > 0 ? k : t), -1));
  const height = i.height ?? Math.max(single ? 120 : 140, i.rows.length * 44 + 90);
  // Étiquette intérieure (texte de 12 px) seulement dans une barre d'au moins 16 px d'épaisseur et de 8 % de longueur ;
  // sinon la part se lit dans l'infobulle et le tableau
  const thick = shareBarThickness(height, i.rows.length, categoryAxis) >= 16;
  return {
    option: {
      animation: false,
      grid: grid(40, 30, 16),
      legend: { top: 0, left: 0, data: parts.map((p) => p.label), icon: "roundRect" },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", min: 0, max: 100, name: "Part (%)", nameLocation: "middle", nameGap: 28, axisLabel: { formatter: "{value} %" } },
      yAxis: { type: "category", inverse: true, data: i.rows.map((r) => r.name), show: categoryAxis, axisLabel: { width: 150, overflow: "truncate", ellipsis: "…" } },
      series: parts.map((p, k) => ({
        name: p.label,
        type: "bar",
        stack: "total",
        barMaxWidth: BAR_MAX,
        barCategoryGap: "30%",
        itemStyle: { color: colors[k], ...STACK_GAP },
        label: { show: true, position: "inside", color: textOn(colors[k]), fontSize: 12, fontWeight: 600 },
        data: i.rows.map((r, n) => {
          const share = pct(shown[n][k] || 0, totals[n]);
          return {
            value: Math.round(share * 10) / 10,
            tip: `${frNumber(share, 1)} % (${formatValue(shown[n][k] || 0, countFmt)})`,
            labelText: `${frNumber(share, 0)} %`,
            label: { show: thick && share >= 8 },
            ...segmentStyle(shown[n][k] || 0, k === lastPart[n], BAR_END),
          };
        }),
      })),
    },
    format: { unit: "%", digits: 1 },
    height,
    ariaLabel: `Barre empilée 100 % : ${i.measure}. ${i.rows
      .map((r, n) => `${r.name ? `${r.name} : ` : ""}${i.parts.map((p, k) => `${p.label} ${frNumber(pct(r.values[k] || 0, totals[n]), 0)} %`).join(", ")}`)
      .join(" ; ")}.`,
    table: {
      headers: [i.categoryName ?? "Catégorie", ...i.parts.map((p) => p.label), "Total"],
      rows: i.rows.map((r, n) => [
        r.name || i.measure,
        ...i.parts.map((_, k) => `${formatValue(r.values[k] || 0, { digits: 0 })} (${frNumber(pct(r.values[k] || 0, totals[n]), 1)} %)`),
        formatValue(totals[n], countFmt),
      ]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Anneau : part d'un tout, 4 parts au plus (au-delà, les plus petites sont regroupées dans « Autres »)
// ---------------------------------------------------------------------------------------------------------------
export function donutChart(i: {
  parts: { name: string; value: number; tone?: Tone }[];
  measure: string;
  unit?: string;
  center?: { value: string; label: string };
  categoryName?: string;
  height?: number;
}): ChartSpec {
  const f: ValueFormat = { unit: i.unit, digits: 0 };
  let parts = i.parts.filter((p) => p.value > 0 || i.parts.length <= 4);
  if (parts.length > 4) {
    const sorted = [...parts].sort((a, b) => b.value - a.value);
    parts = [...sorted.slice(0, 3), { name: "Autres", value: sorted.slice(3).reduce((a, p) => a + p.value, 0), tone: "contexte" as Tone }];
  }
  const total = parts.reduce((a, p) => a + p.value, 0);
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const legendValues = Object.fromEntries(parts.map((p) => [p.name, `${formatValue(p.value, { digits: 0 })} (${frNumber(share(p.value), 0)} %)`]));
  return {
    option: {
      animation: false,
      tooltip: { trigger: "item" },
      legend: { bottom: 0, left: "center", icon: "roundRect", data: parts.map((p) => p.name) },
      title: i.center
        ? { text: i.center.value, subtext: i.center.label, left: "center", top: "32%", textStyle: { fontSize: 22, fontWeight: 600, color: DARK_TEXT }, subtextStyle: { fontSize: 12, color: CHART_INK.muted } }
        : undefined,
      series: [
        {
          name: i.measure,
          type: "pie",
          radius: ["56%", "72%"],
          center: ["50%", "42%"],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderColor: CHART_SURFACE, borderWidth: 2 },
          data: parts.map((p, k) => ({ name: p.name, value: p.value, itemStyle: { color: colorOf(p.tone, k) }, tip: `${formatValue(p.value, f)} (${frNumber(share(p.value), 1)} %)` })),
        },
      ],
    },
    format: { ...f, legendValues },
    height: i.height ?? 290,
    mobileHeight: 320,
    ariaLabel: `Anneau : ${i.measure}${i.center ? `, total ${i.center.value} ${i.center.label}` : ""}. ${parts.map((p) => `${p.name} ${frNumber(share(p.value), 0)} %`).join(", ")}.`,
    table: {
      headers: [i.categoryName ?? "Catégorie", axisName(i.measure, i.unit), "Part"],
      rows: parts.map((p) => [p.name, formatValue(p.value, f), `${frNumber(share(p.value), 1)} %`]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Histogramme : distribution d'une mesure par classes (voir toBins)
// ---------------------------------------------------------------------------------------------------------------
export type Bin = { label: string; count: number };

export function histogramChart(i: {
  bins: Bin[];
  /** Mesure distribuée (axe horizontal) : « Jours d'absence sur 12 mois ». */
  measure: string;
  unit?: string;
  /** Ce qui est compté (axe vertical) : « Collaborateurs » par défaut. */
  countLabel?: string;
  countUnit?: string;
  reference?: { bin: string; label: string };
  height?: number;
}): ChartSpec {
  const countLabel = i.countLabel ?? "Collaborateurs";
  const f: ValueFormat = { unit: i.countUnit ?? "collaborateurs", digits: 0 };
  const showValues = i.bins.length <= 12;
  const mode = i.bins.reduce((m, b) => (b.count > m.count ? b : m), i.bins[0] ?? { label: "", count: 0 });
  const crossed = i.reference?.bin;
  return {
    option: {
      animation: false,
      grid: grid(28, 8, 16),
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "category", data: i.bins.map((b) => b.label), name: axisName(i.measure, i.unit), nameLocation: "middle", nameGap: 30, axisLabel: { hideOverlap: true } },
      // Ligne de référence : marge haute de 25 %, son étiquette (au-dessus du tracé) ne touche plus la valeur de la barre la plus haute
      yAxis: { type: "value", min: 0, minInterval: 1, ...(i.reference ? { boundaryGap: ["0%", "25%"] as [string, string] } : {}), name: countLabel, nameLocation: "middle", nameRotate: 90, nameGap: 36 },
      series: [
        {
          name: countLabel,
          type: "bar",
          // La ligne traverse la valeur de sa classe : celle-ci n'est pas écrite (axe, infobulle et tableau la donnent)
          data: i.bins.map((b) => (b.label === crossed ? { value: b.count, label: { show: false } } : b.count)),
          barCategoryGap: "6%",
          itemStyle: { color: SEMANTIC.neutre, borderRadius: COLUMN_END },
          label: { show: showValues, position: "top", color: LABEL_COLOR, fontSize: 12 },
          markLine: i.reference
            ? {
                silent: true,
                symbol: ["none", "none"],
                data: [{ xAxis: i.reference.bin, label: { formatter: i.reference.label, position: "end", color: LABEL_COLOR, fontSize: 12 }, lineStyle: { color: SEMANTIC.reference, type: "dashed", width: 1.5 } }],
              }
            : undefined,
        },
      ],
    },
    format: f,
    height: i.height ?? 260,
    ariaLabel: `Histogramme : répartition des ${countLabel.toLowerCase()} selon ${axisName(i.measure, i.unit)}, ${i.bins.length} classes. Classe la plus fréquente : ${mode.label} (${formatValue(mode.count, f)}).`,
    table: { headers: [axisName(i.measure, i.unit), countLabel], rows: i.bins.map((b) => [b.label, formatValue(b.count, f)]) },
  };
}

// Classes de largeur fixe : « 0–4 » pour des entiers, « 0 – 5 » sinon. La dernière classe inclut le maximum.
export function toBins(values: number[], opts: { width: number; min?: number; max?: number; digits?: number }): Bin[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length || opts.width <= 0) return [];
  const min = opts.min ?? Math.floor(Math.min(...clean) / opts.width) * opts.width;
  const max = opts.max ?? Math.max(...clean);
  const integers = clean.every(Number.isInteger) && Number.isInteger(opts.width) && Number.isInteger(min);
  const n = Math.max(1, Math.ceil((max - min) / opts.width + (integers ? 1e-9 : 0)) || 1);
  const bins: Bin[] = Array.from({ length: n }, (_, k) => {
    const a = min + k * opts.width;
    const b = a + opts.width;
    const label = integers && opts.width > 1 ? `${frNumber(a, 0)}–${frNumber(b - 1, 0)}` : integers ? frNumber(a, 0) : `${frNumber(a, opts.digits)} – ${frNumber(b, opts.digits)}`;
    return { label, count: 0 };
  });
  for (const v of clean) {
    if (v < min || v > max) continue;
    bins[Math.min(n - 1, Math.floor((v - min) / opts.width))].count++;
  }
  return bins;
}

// ---------------------------------------------------------------------------------------------------------------
// Complément : évolution d'un niveau (Faible / Moyen / Élevé) mois par mois, en escalier sur un axe de catégories
// ---------------------------------------------------------------------------------------------------------------
const LEVEL_TONE: Record<string, Tone> = { Élevé: "defavorable", Moyen: "attention", Faible: "favorable" };

export function levelStepChart(i: {
  categories: string[];
  /** Niveau de chaque période (null : non évalué). */
  levels: (string | null)[];
  /** Ordre des niveaux, du bas vers le haut. */
  order?: string[];
  name?: string;
  height?: number;
}): ChartSpec {
  const order = i.order ?? ["Faible", "Moyen", "Élevé"];
  const name = i.name ?? "Niveau de risque";
  const last = lastValue(i.levels.map((l) => (l == null ? null : order.indexOf(l))));
  return {
    option: {
      animation: false,
      grid: grid(16, 8, 24),
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: i.categories, boundaryGap: false },
      yAxis: { type: "category", data: order, axisLine: { show: false }, splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } },
      series: [
        {
          name,
          type: "line",
          step: "end",
          // Repères toujours visibles : ils portent la couleur du niveau de chaque période
          symbol: "circle",
          showSymbol: true,
          symbolSize: MARKER,
          lineStyle: { width: LINE_WIDTH, color: SEMANTIC.reference },
          itemStyle: MARKER_RING,
          data: i.levels.map((l) => (l == null ? { value: null, skip: true } : { value: l, tip: l, itemStyle: { color: SEMANTIC[LEVEL_TONE[l] ?? "neutre"] } })),
        },
      ],
    },
    format: {},
    height: i.height ?? 200,
    ariaLabel: `Évolution du ${name.toLowerCase()} de ${i.categories[0] ?? ""} à ${i.categories[i.categories.length - 1] ?? ""}.${
      last ? ` Dernier niveau : ${order[last.value]} (${i.categories[last.index]}).` : ""
    }`,
    table: { headers: ["Période", name], rows: i.categories.map((c, k) => [c, i.levels[k] ?? "Non évalué"]) },
  };
}

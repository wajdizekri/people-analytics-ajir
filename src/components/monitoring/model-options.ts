import type { EChartsOption } from "echarts";
import { AXIS, TOOLTIP_AXIS, TOOLTIP_ITEM, type ChartSpec } from "@/components/charts/pbi";
import { BAND_FILL, SEMANTIC, frNumber } from "@/components/charts/theme";
import type { BacktestGainPoint, BacktestMonth } from "@/lib/dal/backtest";
import type { EstimateBinDTO, RunPointDTO } from "@/lib/dal/data-monitoring";
import { LEVEL_STYLE, binLabel, runLabel } from "./data-options";

// Visuels des écrans « Transparence du modèle » et « Vérification a posteriori ». Chaque fonction renvoie un ChartSpec
// sérialisable (option ECharts, format, résumé pour lecteur d'écran, tableau « Voir les données »), construit depuis un DTO.
// Couleurs : sémantique de la charte, écrites pour le thème clair ; EChart les remplace en sombre (clés de DARK_COLORS uniquement).

const NBSP = "\u00a0";
const INK = "#334155";
const MUTED = "#475569";
const SURFACE = "#ffffff";
const LINK = "#94a3b8";
/** Couleur de légende de la zone « écart acceptable » (aplat : BAND_FILL). */
export const ZONE_COLOR = "#c3ccd8";
const ZONE = ZONE_COLOR;

const round1 = (v: number) => Math.round(v * 10) / 10;
export const pctText = (v: number, digits = 1) => `${frNumber(v, digits)}${NBSP}%`;
/** Pourcentage signé : « +11 % », « −9 % » (signe moins typographique), « 0 % ». */
export function signedPct(v: number, digits = 0): string {
  const zero = Number(Math.abs(v).toFixed(digits)) === 0;
  return `${zero ? "" : v > 0 ? "+" : "−"}${frNumber(Math.abs(v), digits)}${NBSP}%`;
}

// Étiquettes et noms d'axes contenus dans le cadre (même réglage que les helpers du kit)
const grid = (top: number, right = 16, bottom = 8) => ({ left: 8, right, top, bottom, outerBoundsMode: "same" as const, outerBoundsContain: "all" as const });
const legend = (data: (string | { name: string; icon: string })[]) => ({ top: 0, left: 0, itemWidth: 14, itemHeight: 10, itemGap: 16, textStyle: { fontSize: 12, color: INK }, data });
const pctAxis = (name: string, max: number, vertical = false) => ({
  type: "value" as const,
  min: 0,
  max,
  ...AXIS,
  axisLabel: { ...AXIS.axisLabel, formatter: "{value} %" },
  name,
  nameLocation: "middle" as const,
  nameGap: vertical ? 42 : 30,
  ...(vertical ? { nameRotate: 90 } : {}),
  nameTextStyle: { color: MUTED, fontSize: 12 },
});
// Tracé d'accompagnement (repère, zone, liaison) : ni survol, ni infobulle
const QUIET = { symbol: "none", silent: true, tooltip: { show: false } } as const;
// Arrondi de 4 px sur le dernier segment non nul de chaque pile (côté valeur) ; la base reste droite
function stackEnd(values: number[][], radius: [number, number, number, number]) {
  const last = (values[0] ?? []).map((_, i) => values.reduce((t, s, k) => (s[i] > 0 ? k : t), -1));
  return (k: number, i: number) => (k === last[i] ? { borderRadius: radius } : {});
}

// ---------------------------------------------------------------------------------------------------------------
// Transparence : poids relatif signé des principaux facteurs (barres divergentes autour de zéro)
// ---------------------------------------------------------------------------------------------------------------
/**
 * Poids relatif en % ; positif : associé à un risque plus élevé, négatif : à un risque plus faible.
 * `axis` : libellé court de l'axe (deux lignes au plus sous 640 px) ; `label` reste écrit en entier dans l'infobulle et le tableau.
 */
export type FactorRow = { label: string; weight: number; axis?: string };
export const factorDirection = (weight: number) => (weight >= 0 ? "Risque plus élevé" : "Risque plus faible");

export function factorsChart(input: FactorRow[]): ChartSpec {
  const rows = [...input].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.label.localeCompare(b.label, "fr"));
  const max = Math.max(5, Math.ceil((Math.max(0, ...rows.map((r) => Math.abs(r.weight))) * 1.35) / 5) * 5);
  const option: EChartsOption = {
    animation: false,
    grid: grid(8, 20),
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      min: -max,
      max,
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, formatter: "{value} %" },
      name: "Poids relatif du facteur (%)",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: MUTED, fontSize: 12 },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.axis ?? r.label),
      ...AXIS,
      axisLine: { show: false },
      axisLabel: { ...AXIS.axisLabel, color: INK, width: 200, overflow: "break", interval: 0 },
      splitLine: { show: false },
    },
    series: [
      {
        name: "Poids relatif",
        type: "bar",
        barMaxWidth: 16,
        data: rows.map((r) => {
          const up = r.weight >= 0;
          return {
            value: round1(r.weight),
            itemStyle: { color: up ? SEMANTIC.defavorable : SEMANTIC.favorable, borderRadius: up ? [0, 4, 4, 0] : [4, 0, 0, 4] },
            label: { show: true, position: up ? ("right" as const) : ("left" as const), color: INK, fontSize: 12, formatter: signedPct(r.weight) },
            tip: `${r.axis && r.axis !== r.label ? `${r.label} : ` : ""}${signedPct(r.weight)}, ${factorDirection(r.weight).toLowerCase()}`,
          };
        }),
        markLine: { symbol: "none", silent: true, label: { show: false }, lineStyle: { type: "solid", width: 1, color: SEMANTIC.reference }, data: [{ xAxis: 0 }] },
      },
    ],
  };
  return {
    option,
    format: { unit: "%", digits: 0 },
    height: Math.max(220, 72 + rows.length * 30),
    mobileHeight: 72 + rows.length * 46,
    ariaLabel: `Barres divergentes autour de zéro : poids relatif de ${rows.length} facteurs, du plus influent au moins influent. ${rows
      .map((r) => `${r.label} : ${signedPct(r.weight)}, ${factorDirection(r.weight).toLowerCase()}`)
      .join(" ; ")}.`,
    table: { headers: ["Facteur", "Sens", "Poids relatif"], rows: rows.map((r) => [r.label, factorDirection(r.weight), signedPct(r.weight)]) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Transparence : calibration par groupe (risque annoncé contre démissions observées), marge d'incertitude et zone cible
// ---------------------------------------------------------------------------------------------------------------
export type CalibrationBin = { predicted: number; observed: number; n: number | null };
/** Écart acceptable du rapport observé / prévu (cible fixée avant l'entraînement). */
export const CALIBRATION_TARGET = [0.8, 1.25] as const;

// Intervalle de Wilson à 95 % d'une proportion observée sur n observations supposées indépendantes
export function wilson95(p: number, n: number): [number, number] {
  const z = 1.959964;
  const d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Points de calibration en % : risque annoncé, démissions observées, marge à 95 % (null sans effectif). */
export function calibrationPoints(bins: CalibrationBin[]) {
  return bins.map((b) => {
    const ci = b.n != null && b.n > 0 ? wilson95(b.observed, b.n) : null;
    return { predicted: b.predicted * 100, observed: b.observed * 100, low: ci ? ci[0] * 100 : null, high: ci ? ci[1] * 100 : null, n: b.n };
  });
}

export function calibrationChart(bins: CalibrationBin[]): ChartSpec {
  const pts = calibrationPoints(bins);
  const max = Math.ceil((Math.max(1, ...pts.flatMap((p) => [p.predicted, p.high ?? p.observed])) * 1.08) / 2) * 2;
  const maxN = Math.max(1, ...pts.map((p) => p.n ?? 0));
  const size = (n: number | null) => (n == null ? 10 : Math.max(8, Math.round(5 + 5 * Math.sqrt(n / maxN))));
  const margin = (p: (typeof pts)[number]) => (p.low != null && p.high != null ? `${frNumber(p.low, 1)} à ${pctText(p.high)}` : "—");
  const [lo, hi] = CALIBRATION_TARGET;
  const top = pts.at(-1);
  const option: EChartsOption = {
    animation: false,
    grid: grid(12, 20),
    tooltip: TOOLTIP_ITEM,
    xAxis: pctAxis("Risque annoncé par le modèle (%)", max),
    yAxis: pctAxis("Démissions observées (%)", max, true),
    series: [
      // Zone cible : deux tracés empilés, seule la bande entre × 0,8 et × 1,25 est remplie
      { name: "Écart acceptable", type: "line", stack: "ecart", data: [[0, 0], [max, lo * max]], lineStyle: { opacity: 0 }, itemStyle: { color: ZONE }, ...QUIET },
      { name: "Écart acceptable", type: "line", stack: "ecart", data: [[0, 0], [max, (hi - lo) * max]], lineStyle: { opacity: 0 }, itemStyle: { color: ZONE }, areaStyle: { color: BAND_FILL }, ...QUIET },
      { name: "Accord parfait", type: "line", data: [[0, 0], [max, max]], lineStyle: { type: "dashed", width: 1.5, color: SEMANTIC.reference }, itemStyle: { color: SEMANTIC.reference }, ...QUIET },
      ...pts
        .filter((p) => p.low != null && p.high != null)
        .map((p) => ({
          name: "Marge d'incertitude à 95 %",
          type: "line" as const,
          data: [[round1(p.predicted), round1(p.low!)], [round1(p.predicted), round1(p.high!)]],
          lineStyle: { width: 2, color: SEMANTIC.neutre },
          itemStyle: { color: SEMANTIC.neutre },
          ...QUIET,
        })),
      {
        name: "Modèle",
        type: "scatter",
        z: 5,
        itemStyle: { color: SEMANTIC.neutre, borderColor: SURFACE, borderWidth: 2 },
        data: pts.map((p) => ({
          value: [round1(p.predicted), round1(p.observed)],
          symbolSize: size(p.n),
          tip: `risque annoncé ${pctText(p.predicted)}, démissions observées ${pctText(p.observed)}${p.low != null ? ` (marge ${margin(p)})` : ""}${p.n != null ? `, ${frNumber(p.n, 0)} observations` : ""}`,
        })),
      },
    ],
  };
  return {
    option,
    format: { unit: "%", digits: 1 },
    height: 320,
    mobileHeight: 300,
    ariaLabel: `Nuage de points : pour chaque groupe de collaborateurs au risque proche, risque annoncé par le modèle et part ayant réellement démissionné, avec la marge d'incertitude à 95 %. La diagonale marque l'accord parfait.${
      top ? ` Groupe au risque le plus haut : ${pctText(top.predicted)} annoncés, ${pctText(top.observed)} observés.` : ""
    } Le détail figure dans le tableau.`,
    table: {
      headers: ["Risque annoncé (moyenne)", "Démissions observées", "Marge d'incertitude à 95 %", "Observations"],
      rows: pts.map((p) => [pctText(p.predicted), pctText(p.observed), margin(p), p.n != null ? frNumber(p.n, 0) : "—"]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Transparence : équité, démissions réelles et risque estimé moyen par groupe sur une même échelle
// ---------------------------------------------------------------------------------------------------------------
/** Taux en fraction (0–1) ; verdict en mots : « juste », « surestimé », « sous-estimé ». */
export type FairnessDot = { group: string; observed: number; estimated: number; verdict: string };

export function fairnessChart(rows: FairnessDot[]): ChartSpec {
  const max = Math.max(2, Math.ceil(Math.max(0, ...rows.flatMap((r) => [r.observed, r.estimated])) * 75) * 2);
  const option: EChartsOption = {
    animation: false,
    grid: grid(40, 24),
    legend: legend([
      { name: "Démissions réelles", icon: "circle" },
      { name: "Risque estimé moyen", icon: "diamond" },
    ]),
    tooltip: TOOLTIP_ITEM,
    xAxis: pctAxis("Part des collaborateurs du groupe (%)", max),
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => r.group),
      ...AXIS,
      axisLine: { show: false },
      axisLabel: { ...AXIS.axisLabel, color: INK, interval: 0 },
      splitLine: { show: false },
    },
    series: [
      ...rows.map((r) => ({
        name: "Écart",
        type: "line" as const,
        data: [[round1(r.observed * 100), r.group], [round1(r.estimated * 100), r.group]],
        lineStyle: { width: 2, color: LINK },
        itemStyle: { color: LINK },
        ...QUIET,
      })),
      {
        name: "Démissions réelles",
        type: "scatter",
        symbol: "circle",
        symbolSize: 13,
        z: 4,
        itemStyle: { color: SEMANTIC.neutre, borderColor: SURFACE, borderWidth: 2 },
        // Une seule étiquette par groupe, au-dessus des deux points : valeurs et jugement en mots
        label: { show: true, position: "top", distance: 7, color: INK, fontSize: 12 },
        data: rows.map((r) => ({
          value: [round1(r.observed * 100), r.group],
          labelText: `réel ${pctText(r.observed * 100)} · estimé ${pctText(r.estimated * 100)} · ${r.verdict}`,
          tip: `${r.group} : ${pctText(r.observed * 100)} ont réellement démissionné`,
        })),
      },
      {
        name: "Risque estimé moyen",
        type: "scatter",
        symbol: "diamond",
        symbolSize: 10,
        z: 5,
        itemStyle: { color: SEMANTIC.reference, borderColor: SURFACE, borderWidth: 1.5 },
        data: rows.map((r) => ({
          value: [round1(r.estimated * 100), r.group],
          tip: `${r.group} : ${pctText(r.estimated * 100)} de risque estimé en moyenne (${r.verdict})`,
        })),
      },
    ],
  };
  return {
    option,
    format: { unit: "%", digits: 1 },
    height: 92 + rows.length * 48,
    mobileHeight: 118 + rows.length * 48,
    ariaLabel: `Points par groupe sur une même échelle : démissions réelles et risque estimé moyen. ${rows
      .map((r) => `${r.group} : réel ${pctText(r.observed * 100)}, estimé ${pctText(r.estimated * 100)}, ${r.verdict}`)
      .join(" ; ")}.`,
    table: {
      headers: ["Groupe", "Démissions réelles", "Risque estimé moyen", "Justesse"],
      rows: rows.map((r) => [r.group, pctText(r.observed * 100), pctText(r.estimated * 100), r.verdict]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Transparence : part des niveaux de risque à chaque calcul (barres empilées 100 %, un calcul par ligne)
// ---------------------------------------------------------------------------------------------------------------
export function levelShareChart(runs: RunPointDTO[]): ChartSpec {
  const total = (r: RunPointDTO) => r.levels.ELEVE + r.levels.MOYEN + r.levels.FAIBLE;
  const share = (r: RunPointDTO, n: number) => (total(r) ? (n / total(r)) * 100 : 0);
  const values = LEVEL_STYLE.map((l) => runs.map((r) => share(r, r.levels[l.key])));
  const end = stackEnd(values, [0, 4, 4, 0]);
  const last = runs.at(-1);
  const option: EChartsOption = {
    animation: false,
    grid: grid(32, 20),
    legend: legend(LEVEL_STYLE.map((l) => ({ name: l.label, icon: "roundRect" }))),
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: { ...pctAxis("Part des collaborateurs évalués (%)", 100), interval: 25 },
    yAxis: {
      type: "category",
      inverse: true,
      data: runs.map(runLabel),
      ...AXIS,
      axisLine: { show: false },
      axisLabel: { ...AXIS.axisLabel, color: INK, interval: 0 },
      splitLine: { show: false },
    },
    series: LEVEL_STYLE.map((l, k) => ({
      name: l.label,
      type: "bar" as const,
      stack: "niveaux",
      barMaxWidth: 14,
      barCategoryGap: "35%",
      // Bordure de la couleur de la surface : 2 px d'écart entre deux segments voisins
      itemStyle: { color: l.color, borderColor: SURFACE, borderWidth: 1 },
      data: runs.map((r, i) => ({
        value: values[k][i],
        itemStyle: end(k, i),
        tip: `${pctText(values[k][i])} (${frNumber(r.levels[l.key], 0)})`,
      })),
    })),
  };
  return {
    option,
    format: { unit: "%", digits: 1 },
    height: 260,
    ariaLabel: `Barres empilées à 100 % : part des niveaux de risque Élevé, Moyen et Faible à chaque calcul mensuel.${
      last && total(last) ? ` ${runLabel(last)} : ${LEVEL_STYLE.map((l) => `${l.label} ${pctText(share(last, last.levels[l.key]))}`).join(", ")}.` : ""
    }`,
    table: {
      headers: ["Calcul", ...LEVEL_STYLE.map((l) => l.label)],
      rows: [...runs].reverse().map((r) => [
        `${runLabel(r)}${r.current ? " (publié)" : ""}`,
        ...LEVEL_STYLE.map((l) => (total(r) ? `${frNumber(r.levels[l.key], 0)} (${pctText(share(r, r.levels[l.key]))})` : "—")),
      ]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Transparence : répartition des risques estimés au dernier calcul, moyenne annotée
// ---------------------------------------------------------------------------------------------------------------
export function estimateHistogramChart(bins: EstimateBinDTO[], mean: number | null): ChartSpec {
  const short = (b: EstimateBinDTO) => (b.to == null ? `≥ ${frNumber(b.from * 100)}` : `${frNumber(b.from * 100)}–${frNumber(b.to * 100)}`);
  const at = mean == null ? -1 : bins.findIndex((b) => mean >= b.from && (b.to == null || mean < b.to));
  const inBin = at >= 0 && bins[at].to != null ? (mean! - bins[at].from) / (bins[at].to! - bins[at].from) : 0.5;
  const mode = bins.reduce((m, b) => (b.n > m.n ? b : m), bins[0] ?? { from: 0, to: null, n: 0 });
  const option: EChartsOption = {
    animation: false,
    grid: grid(28, 16),
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: bins.map(short),
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, hideOverlap: true },
      name: "Risque estimé de démission à 6 mois (%)",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: MUTED, fontSize: 12 },
    },
    // Marge haute : l'annotation de la moyenne reste au-dessus des barres et de leurs valeurs
    yAxis: { type: "value", min: 0, minInterval: 1, boundaryGap: ["0%", "25%"], ...AXIS, name: "Collaborateurs", nameLocation: "middle", nameRotate: 90, nameGap: 42, nameTextStyle: { color: MUTED, fontSize: 12 } },
    series: [
      {
        name: "Effectif",
        type: "bar",
        barCategoryGap: "8%",
        itemStyle: { color: SEMANTIC.neutre, borderRadius: [3, 3, 0, 0] },
        label: { show: bins.length <= 12, position: "top", color: INK, fontSize: 11 },
        // La valeur de la classe traversée par la ligne de moyenne n'est pas écrite (elle se lit sur l'axe, l'infobulle et le tableau)
        data: bins.map((b, i) => ({
          value: b.n,
          tip: `${frNumber(b.n, 0)} collaborateur${b.n > 1 ? "s" : ""} (${binLabel(b)})`,
          ...(i === at ? { label: { show: false } } : {}),
        })),
        ...(at >= 0
          ? {
              markLine: {
                symbol: "none",
                silent: true,
                lineStyle: { type: "dashed" as const, width: 1.5, color: SEMANTIC.reference },
                label: { show: true, position: "end" as const, color: INK, fontSize: 12, formatter: `Moyenne : ${pctText(mean! * 100)}` },
                // Position dans la classe : l'axe des catégories place un indice fractionnaire entre deux centres de barres
                data: [{ xAxis: at + inBin - 0.5 }],
              },
            }
          : {}),
      },
    ],
  };
  return {
    option,
    format: { unit: "collaborateurs", digits: 0 },
    height: 260,
    ariaLabel: `Histogramme : nombre de collaborateurs par tranche de risque estimé de démission à 6 mois, ${bins.length} tranches. Tranche la plus fréquente : ${binLabel(mode)} (${frNumber(mode.n, 0)} collaborateurs).${
      mean != null ? ` Moyenne : ${pctText(mean * 100)}.` : ""
    }`,
    table: { headers: ["Tranche de risque estimé", "Collaborateurs"], rows: bins.map((b) => [binLabel(b), frNumber(b.n, 0)]) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Vérification a posteriori : courbe de gain (démissions repérées selon la part de collaborateurs contactés)
// ---------------------------------------------------------------------------------------------------------------
export function gainChart(points: BacktestGainPoint[], capacity: BacktestGainPoint | null): ChartSpec {
  const pct = (v: number) => Math.round(v * 1000) / 10;
  const curve = [...points, ...(capacity ? [capacity] : [])].sort((a, b) => a.share - b.share || a.captured - b.captured);
  const tip = (p: BacktestGainPoint) => `${pctText(p.share * 100)} contactés : ${pctText(p.captured * 100)} des démissions repérées`;
  const tenth = points.filter((p) => p.share > 0 && Math.abs(p.share * 10 - Math.round(p.share * 10)) < 1e-9);
  const rows = [...(capacity ? [{ ...capacity, name: "capacité RH" }] : []), ...(tenth.length > 2 ? tenth : points.filter((p) => p.share > 0)).map((p) => ({ ...p, name: "" }))];
  const option: EChartsOption = {
    animation: false,
    grid: grid(capacity ? 58 : 32, 24),
    legend: legend(["Modèle", "Tirage au hasard", ...(capacity ? [{ name: "Capacité RH", icon: "circle" }] : [])]),
    tooltip: TOOLTIP_AXIS,
    xAxis: { ...pctAxis("Part des collaborateurs contactés (%)", 100), interval: 25, axisPointer: { label: { formatter: "Collaborateurs contactés par ordre de risque" } } },
    yAxis: { ...pctAxis("Part des démissions repérées (%)", 100, true), interval: 25 },
    series: [
      {
        name: "Modèle",
        type: "line",
        symbol: "none",
        lineStyle: { width: 2, color: SEMANTIC.neutre },
        itemStyle: { color: SEMANTIC.neutre },
        data: curve.map((p) => ({ value: [pct(p.share), pct(p.captured)], tip: tip(p) })),
      },
      {
        name: "Tirage au hasard",
        type: "line",
        symbol: "none",
        silent: true,
        lineStyle: { type: "dashed", width: 1.5, color: SEMANTIC.reference },
        itemStyle: { color: SEMANTIC.reference },
        // skip : la diagonale n'apparaît pas dans l'infobulle
        data: [0, 100].map((v) => ({ value: [v, v], skip: true })),
      },
      ...(capacity
        ? [
            {
              name: "Capacité RH",
              type: "scatter" as const,
              symbolSize: 12,
              z: 5,
              itemStyle: { color: SEMANTIC.neutre, borderColor: SURFACE, borderWidth: 2 },
              data: [capacity].map((p) => ({ value: [pct(p.share), pct(p.captured)], tip: tip(p) })),
              markLine: {
                symbol: "none",
                silent: true,
                lineStyle: { type: "dashed" as const, width: 1, color: SEMANTIC.reference },
                label: { show: true, position: "end" as const, align: "left" as const, distance: 8, color: INK, fontSize: 12, formatter: `Capacité RH : ${pctText(capacity.share * 100)} contactés` },
                data: [{ xAxis: pct(capacity.share) }],
              },
            },
          ]
        : []),
    ],
  };
  return {
    option,
    format: { unit: "%", digits: 1 },
    height: 300,
    mobileHeight: 300,
    ariaLabel: `Courbe de gain : part des démissions repérées selon la part de collaborateurs contactés, du risque le plus haut au plus bas, comparée à un tirage au hasard.${
      capacity ? ` À la capacité RH : ${tip(capacity)}.` : ""
    }`,
    table: {
      headers: ["Collaborateurs contactés", "Démissions repérées", "Tirage au hasard"],
      rows: rows.map((p) => [`${pctText(p.share * 100)}${p.name ? ` (${p.name})` : ""}`, pctText(p.captured * 100), pctText(p.share * 100)]),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Vérification a posteriori : démissions de chacun des 6 mois suivant l'origine, selon le niveau à l'origine
// ---------------------------------------------------------------------------------------------------------------
export function resignationTimelineChart(months: BacktestMonth[], labels: string[]): ChartSpec {
  const values = LEVEL_STYLE.map((l) => months.map((m) => m.levels[l.key]));
  const totals = months.map((m) => m.levels.ELEVE + m.levels.MOYEN + m.levels.FAIBLE);
  const end = stackEnd(values, [4, 4, 0, 0]);
  const names = LEVEL_STYLE.map((l) => `Classés ${l.label}`);
  const peak = totals.reduce((best, t, i) => (t > totals[best] ? i : best), 0);
  const option: EChartsOption = {
    animation: false,
    grid: grid(36, 16),
    legend: legend(names.map((name) => ({ name, icon: "roundRect" }))),
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: { type: "category", data: labels, ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", min: 0, minInterval: 1, ...AXIS, name: "Démissions", nameLocation: "middle", nameRotate: 90, nameGap: 30, nameTextStyle: { color: MUTED, fontSize: 12 } },
    series: [
      ...LEVEL_STYLE.map((l, k) => ({
        name: names[k],
        type: "bar" as const,
        stack: "demissions",
        barMaxWidth: 24,
        itemStyle: { color: l.color, borderColor: SURFACE, borderWidth: 1 },
        data: values[k].map((v, i) => (v > 0 ? { value: v, itemStyle: end(k, i) } : { value: null, skip: true })),
      })),
      {
        name: "Total",
        type: "bar" as const,
        stack: "demissions",
        silent: true,
        itemStyle: { color: "transparent" },
        label: { show: true, position: "top" as const, color: INK, fontSize: 12, fontWeight: 600 },
        data: totals.map((t) => ({ value: 0, skip: true, labelText: t ? frNumber(t, 0) : "" })),
      },
    ],
  };
  return {
    option,
    format: { unit: "démissions", digits: 0 },
    height: 300,
    mobileHeight: 300,
    ariaLabel: `Barres empilées : démissions de chacun des ${months.length} mois suivant la date d'origine, selon le niveau de risque à cette date.${
      totals.some((t) => t > 0) ? ` Mois le plus chargé : ${labels[peak]} (${frNumber(totals[peak], 0)}).` : ""
    }`,
    table: {
      headers: ["Mois", ...names, "Total"],
      rows: months.map((m, i) => [labels[i], ...LEVEL_STYLE.map((l) => frNumber(m.levels[l.key], 0)), frNumber(totals[i], 0)]),
    },
  };
}

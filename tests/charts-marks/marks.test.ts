import { describe, expect, it, vi } from "vitest";
import * as echarts from "echarts";
import { createElement, type ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

const { MARK } = await import("@/components/charts/pbi");
const { CHART_INK, CHART_PALETTE, CHART_SURFACE, SEMANTIC, CHART_FONT } = await import("@/components/charts/theme");
const { LIGHT_TOKENS, chartTheme, localizeOption, twoLineLabel } = await import("@/components/charts/echart");
const { barChart, donutChart, hasIsolatedPoint, histogramChart, levelStepChart, lineChart, shareChart, stackedBarChart } = await import("@/components/charts/builders");
type ChartSpec = import("@/components/charts/builders").ChartSpec;

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;
const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin"];
const RISK = [
  { label: "Élevé", tone: "defavorable" as const },
  { label: "Moyen", tone: "attention" as const },
  { label: "Faible", tone: "favorable" as const },
];

// Même chaîne que le composant EChart (thème, formats, mobile), rendue en SVG sans navigateur
function render(spec: ChartSpec, { width = 560, narrow = false } = {}) {
  const chart = echarts.init(null, chartTheme(LIGHT_TOKENS, false, narrow) as Any, { renderer: "svg", ssr: true, width, height: spec.height });
  chart.setOption(localizeOption(spec.option, spec.format, narrow), { notMerge: true });
  const model: Any = (chart as Any).getModel();
  const svg = chart.renderToSVGString();
  const plot = model.getComponent("grid")?.coordinateSystem?.getRect();
  const layouts = (series: number) => {
    const data = model.getSeriesByIndex(series).getData();
    return Array.from({ length: data.count() }, (_, k) => data.getItemLayout(k));
  };
  return { svg, plot, layouts, dispose: () => chart.dispose() };
}

describe("marques communes : mêmes valeurs que MARK du kit (pbi.tsx)", () => {
  it("thème du wrapper : courbe de 2 px, repère plein de 8 px masqué hors survol ; encres = CHART_INK", () => {
    expect(chartTheme(LIGHT_TOKENS).line).toMatchObject({ symbol: MARK.line.symbol, symbolSize: MARK.line.symbolSize, showSymbol: false, lineStyle: { width: MARK.line.lineStyle.width } });
    expect(LIGHT_TOKENS).toEqual({ ...CHART_INK });
  });

  it("lineChart : 2 px, repère de 8 px cerclé de la surface au survol seulement, lavis à 10 %", () => {
    const s = (lineChart({ categories: months, series: [{ name: "Taux", values: [1, 2, 3, 2, 1, 2], area: true }], measure: "Taux" }).option as Any).series[0];
    expect(s).toMatchObject({ symbol: MARK.line.symbol, symbolSize: MARK.line.symbolSize, showSymbol: false, lineStyle: { width: MARK.line.lineStyle.width } });
    expect(s.itemStyle).toMatchObject(MARK.line.itemStyle);
    expect(s.areaStyle.opacity).toBe(MARK.area.opacity);
  });

  it("barres de 24 px au plus, bout arrondi de 4 px côté valeur ; colonnes d'histogramme arrondies en haut ; anneau 56–72 %", () => {
    const bar = (barChart({ rows: [{ name: "A", value: 3 }], measure: "Effectif" }).option as Any).series[0];
    expect(bar.barMaxWidth).toBe(MARK.bar.barMaxWidth);
    expect(bar.itemStyle.borderRadius).toEqual(MARK.bar.itemStyle.borderRadius);
    const histo = (histogramChart({ bins: [{ label: "0–4", count: 3 }], measure: "Jours" }).option as Any).series[0];
    expect(histo.itemStyle.borderRadius).toEqual(MARK.column.itemStyle.borderRadius);
    const donut = (donutChart({ parts: [{ name: "A", value: 1 }], measure: "Effectif" }).option as Any).series[0];
    expect(donut.radius).toEqual(["56%", "72%"]);
    expect(donut.itemStyle).toMatchObject({ borderColor: CHART_SURFACE, borderWidth: 2 });
  });

  it("empilés et 100 % : 2 px entre segments, 24 px au plus, dernier segment non nul arrondi", () => {
    const stacked = (stackedBarChart({ rows: [{ name: "A", values: [1, 2, 0] }], parts: RISK, measure: "Formations" }).option as Any).series;
    const share = (shareChart({ rows: [{ name: "A", values: [1, 2, 0] }], parts: RISK, measure: "Niveaux" }).option as Any).series;
    for (const s of [...stacked.slice(0, 3), ...share]) {
      expect(s.itemStyle).toMatchObject(MARK.stack.itemStyle);
      expect(s.barMaxWidth).toBe(MARK.bar.barMaxWidth);
    }
    expect(stacked[1].data[0].itemStyle.borderRadius).toEqual(MARK.bar.itemStyle.borderRadius);
    expect(stacked[0].data[0].itemStyle).toBeUndefined();
    expect(share[1].data[0].itemStyle.borderRadius).toEqual(MARK.bar.itemStyle.borderRadius);
  });

  it("niveau en escalier : 2 px, repères toujours visibles (ils portent le niveau), cerclés de la surface", () => {
    const s = (levelStepChart({ categories: months.slice(0, 3), levels: ["Faible", "Moyen", "Élevé"] }).option as Any).series[0];
    expect(s).toMatchObject({ showSymbol: true, symbolSize: 8, lineStyle: { width: 2 }, itemStyle: MARK.line.itemStyle });
  });
});

describe("repères masqués : un point isolé reste visible", () => {
  it("hasIsolatedPoint : série d'un point, valeur entourée de manques ; raccord (skip) ignoré", () => {
    expect(hasIsolatedPoint([4])).toBe(true);
    expect(hasIsolatedPoint([1, null, 2, 3])).toBe(true);
    expect(hasIsolatedPoint([null, 2, null])).toBe(true);
    expect(hasIsolatedPoint([{ value: null }, { value: 2 }, "-"])).toBe(true);
    expect(hasIsolatedPoint([1, 2, null, 3, 4])).toBe(false);
    expect(hasIsolatedPoint([null, { value: 12, skip: true }, null])).toBe(false);
    expect(hasIsolatedPoint([])).toBe(false);
    expect(hasIsolatedPoint(undefined)).toBe(false);
  });

  it("lineChart : repères affichés seulement pour la série qui a un point isolé", () => {
    const o = lineChart({
      categories: months.slice(0, 3),
      series: [
        { name: "Suivi", values: [1, 2, 3] },
        { name: "Mesure ponctuelle", values: [null, 5, null] },
      ],
      measure: "Taux",
    }).option as Any;
    expect(o.series.map((s: Any) => s.showSymbol)).toEqual([false, true]);
    const one = lineChart({ categories: ["sept. 2026"], series: [{ name: "Probabilité", values: [12] }], measure: "Probabilité", unit: "%" });
    expect((one.option as Any).series[0].showSymbol).toBe(true);
  });

  it("rendu : la série d'un seul point dessine son repère, une courbe continue n'en dessine aucun hors survol", () => {
    const one = render(lineChart({ categories: ["sept. 2026"], series: [{ name: "Probabilité", values: [12] }], measure: "Probabilité", unit: "%" }));
    expect(one.svg).toContain(`fill="${SEMANTIC.neutre}"`);
    one.dispose();
    const many = render(lineChart({ categories: months, series: [{ name: "Taux", values: [1, 2, 3, 2, 1, 2] }], measure: "Taux" }));
    expect(many.svg).not.toContain(`fill="${SEMANTIC.neutre}"`);
    many.dispose();
  });

  it("options écrites à la main : repères gardés quand la série les règle ou a un point isolé ; sinon masqués par le thème", () => {
    const shown = (series: Any) => (localizeOption({ xAxis: { type: "category", data: ["a", "b", "c"] }, yAxis: { type: "value" }, series: [series] }) as Any).series[0].showSymbol;
    expect(shown({ type: "line", data: [1, 2, 3] })).toBeUndefined();
    expect(shown({ type: "line", data: [1, 2, 3], symbolSize: 6 })).toBe(true);
    expect(shown({ type: "line", data: [1, 2, 3], symbol: "circle" })).toBe(true);
    expect(shown({ type: "line", symbol: "none", data: [1, 2, { value: 3, symbol: "circle", symbolSize: 8 }] })).toBe(true);
    expect(shown({ type: "line", symbol: "none", data: [1, 2, 3] })).toBeUndefined();
    expect(shown({ type: "line", data: [null, 2, null] })).toBe(true);
    expect(shown({ type: "line", data: [1, 2, 3], symbolSize: 6, showSymbol: false })).toBe(false);
    expect(shown({ type: "bar", data: [2] })).toBeUndefined();
  });
});

describe("au-delà des 6 teintes : jamais une teinte recyclée", () => {
  const names = Array.from({ length: 8 }, (_, k) => `S${k + 1}`);

  it("courbes : 6 teintes dans l'ordre, puis gris de contexte avec un motif de trait propre à chaque courbe", () => {
    const o = lineChart({ categories: months, series: names.map((name, k) => ({ name, values: months.map((_, m) => k + m) })), measure: "Taux" }).option as Any;
    const colors = o.series.map((s: Any) => s.lineStyle.color);
    expect(colors.slice(0, 6)).toEqual([...CHART_PALETTE]);
    expect(colors.slice(6)).toEqual([SEMANTIC.contexte, SEMANTIC.contexte]);
    const types = o.series.map((s: Any) => JSON.stringify(s.lineStyle.type));
    expect(types.slice(0, 6).every((t: string) => t === '"solid"')).toBe(true);
    expect(new Set(types.slice(6)).size).toBe(2);
    expect(types.slice(6)).not.toContain('"solid"');
    expect(types.slice(6)).not.toContain('"dashed"');
  });

  it("barres empilées : parts sans teinte additionnées dans « Autres » (gris), détail gardé dans le tableau", () => {
    const spec = stackedBarChart({ rows: [{ name: "A", values: [1, 2, 3, 4, 5, 6, 7, 8] }], parts: names.map((label) => ({ label })), measure: "Effectif" });
    const o = spec.option as Any;
    expect(o.legend.data).toEqual([...names.slice(0, 6), "Autres"]);
    const others = o.series.find((s: Any) => s.name === "Autres");
    expect(others.itemStyle.color).toBe(SEMANTIC.contexte);
    expect(others.data[0].value).toBe(15);
    expect(o.series.filter((s: Any) => s.name !== "Total").map((s: Any) => s.itemStyle.color).slice(0, 6)).toEqual([...CHART_PALETTE]);
    expect(spec.table.headers).toEqual(["Catégorie", ...names, "Total"]);
    expect(spec.ariaLabel).toContain("Autres (S7, S8)");
  });

  it("100 % : une seule part de trop reste à son nom, en gris ; une part avec un ton n'est jamais regroupée", () => {
    const seven = shareChart({ rows: [{ name: "A", values: [1, 1, 1, 1, 1, 1, 4] }], parts: names.slice(0, 7).map((label) => ({ label })), measure: "Parts" }).option as Any;
    expect(seven.legend.data).toEqual(names.slice(0, 7));
    expect(seven.series[6].itemStyle.color).toBe(SEMANTIC.contexte);
    const toned = shareChart({
      rows: [{ name: "A", values: [1, 1, 1, 1, 1, 1, 1, 1, 1] }],
      parts: [...names.map((label) => ({ label })), { label: "Refus", tone: "defavorable" as const }],
      measure: "Parts",
    }).option as Any;
    expect(toned.legend.data).toEqual([...names.slice(0, 6), "Refus", "Autres"]);
    const others = toned.series.find((s: Any) => s.name === "Autres");
    expect(others.data[0].value).toBeCloseTo((2 / 9) * 100, 0);
  });
});

describe("shareChart : étiquettes intérieures masquées dans une barre de moins de 16 px", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, k) => ({ name: `Calcul ${k + 1}`, values: [1, 3, 16] }));

  it("douze calculs dans 260 px : aucune étiquette intérieure (infobulle et tableau) ; hauteur par défaut : étiquettes ≥ 8 %", () => {
    const tight = shareChart({ rows: rows(12), parts: RISK, measure: "Niveaux", height: 260 }).option as Any;
    expect(tight.series.every((s: Any) => s.data.every((d: Any) => d.label.show === false))).toBe(true);
    const roomy = shareChart({ rows: rows(12), parts: RISK, measure: "Niveaux" }).option as Any;
    expect(roomy.series[2].data.every((d: Any) => d.label.show)).toBe(true);
    expect(roomy.series[1].data.every((d: Any) => d.label.show)).toBe(true);
    expect(roomy.series[0].data.every((d: Any) => d.label.show === false)).toBe(true);
    const single = shareChart({ rows: [{ name: "", values: [19, 30, 938] }], parts: RISK, measure: "Niveaux" }).option as Any;
    expect(single.series[2].data[0].label.show).toBe(true);
  });

  it("épaisseur estimée fidèle au rendu ECharts : étiquette montrée si et seulement si la barre fait ≥ 16 px", () => {
    for (const [n, height] of [[1, undefined], [2, undefined], [6, 260], [7, 260], [12, 260], [12, undefined], [5, 200]] as const) {
      const spec = shareChart({ rows: n === 1 ? [{ name: "", values: [2, 3, 15] }] : rows(n), parts: RISK, measure: "Niveaux", height });
      const r = render(spec);
      const thickness = Math.abs(r.layouts(2)[0].height);
      r.dispose();
      expect((spec.option as Any).series[2].data[0].label.show, `${n} lignes, ${spec.height} px : barre de ${thickness.toFixed(1)} px`).toBe(thickness >= 16);
    }
  });
});

describe("stackedBarChart : variante verticale (axe du temps)", () => {
  const rows = months.map((name, k) => ({ name, values: [k, 2, 3] }));

  it("colonnes dans l'ordre fourni, total au-dessus, valeurs des segments hors du dessin, sommet arrondi", () => {
    const spec = stackedBarChart({ rows, parts: RISK, measure: "Démissions", orientation: "vertical", categoryName: "Mois" });
    const o = spec.option as Any;
    expect(o.xAxis).toMatchObject({ type: "category", data: months, name: "Mois" });
    expect(o.yAxis).toMatchObject({ type: "value", min: 0, minInterval: 1, name: "Démissions" });
    expect(o.series.slice(0, 3).every((s: Any) => s.label.show === false)).toBe(true);
    expect(o.series[3]).toMatchObject({ name: "Total", label: { position: "top" } });
    expect(o.series[3].data.map((d: Any) => d.labelText)).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(o.series[2].data[0].itemStyle.borderRadius).toEqual(MARK.column.itemStyle.borderRadius);
    expect(spec.height).toBe(300);
    expect(spec.ariaLabel).toMatch(/^Colonnes empilées : Démissions par mois, réparties en Élevé, Moyen, Faible\. Total le plus élevé : juin \(10\)\./);
    expect(spec.table.rows.map((r) => r[0])).toEqual(months);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it("valeurs décimales : graduations libres ; tri explicite possible ; horizontal par défaut inchangé", () => {
    const decimal = stackedBarChart({ rows: [{ name: "a", values: [0.5, 1] }], parts: RISK.slice(0, 2), measure: "Heures", orientation: "vertical" }).option as Any;
    expect(decimal.yAxis.minInterval).toBeUndefined();
    const sorted = stackedBarChart({ rows, parts: RISK, measure: "Démissions", orientation: "vertical", sort: "desc" }).option as Any;
    expect(sorted.xAxis.data[0]).toBe("juin");
    const horizontal = stackedBarChart({ rows, parts: RISK, measure: "Démissions" }).option as Any;
    expect(horizontal.yAxis).toMatchObject({ type: "category", inverse: true });
    expect(horizontal.yAxis.data[0]).toBe("juin");
    expect(horizontal.series[3].label.position).toBe("right");
  });

  it("rendu : colonnes de 24 px au plus, totaux écrits, mobile sans erreur", () => {
    const desk = render(stackedBarChart({ rows, parts: RISK, measure: "Démissions", orientation: "vertical" }));
    expect(desk.layouts(0).every((l: Any) => l.width <= 24)).toBe(true);
    for (const t of ["5", "8", "10"]) expect(desk.svg).toContain(`>${t}<`);
    desk.dispose();
    const phone = render(stackedBarChart({ rows, parts: RISK, measure: "Démissions", orientation: "vertical" }), { width: 360, narrow: true });
    expect(phone.svg).toContain("juin");
    phone.dispose();
  });
});

describe("histogramChart : ligne de référence sans chevauchement", () => {
  const bins = [40, 12, 8, 3].map((count, k) => ({ label: `${k * 5}–${k * 5 + 4}`, count }));

  it("marge haute et valeur de la classe traversée non écrite ; sans référence : options inchangées", () => {
    const o = histogramChart({ bins, measure: "Jours d'absence", reference: { bin: "5–9", label: "Médiane" } }).option as Any;
    expect(o.yAxis.boundaryGap).toEqual(["0%", "25%"]);
    expect(o.series[0].data).toEqual([40, { value: 12, label: { show: false } }, 8, 3]);
    const plain = histogramChart({ bins, measure: "Jours d'absence" }).option as Any;
    expect(plain.yAxis.boundaryGap).toBeUndefined();
    expect(plain.series[0].data).toEqual([40, 12, 8, 3]);
  });

  it("rendu : la barre la plus haute s'arrête au moins 20 px sous le haut du tracé (valeur sous l'étiquette de la ligne)", () => {
    for (const counts of [[3, 1, 2], [40, 12, 8, 3], [938, 120, 30, 5, 2]]) {
      for (const height of [200, 260]) {
        const b = counts.map((count, k) => ({ label: `${k * 5}–${k * 5 + 4}`, count }));
        const r = render(histogramChart({ bins: b, measure: "Jours", reference: { bin: b[0].label, label: "Médiane : 2 jours" }, height }));
        const top = Math.min(...r.layouts(0).map((l: Any) => l.y + Math.min(0, l.height)));
        r.dispose();
        expect(top - r.plot.y, `${counts} (${height} px)`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe("mobile : libellés de catégorie coupés après deux lignes avec « … »", () => {
  const font = `12px ${CHART_FONT}`;
  const fits = (line: string) => echarts.format.truncateText(line, 112, font, "…") === line;

  it("twoLineLabel : court inchangé, deux lignes sans ellipse quand le texte tient, sinon seconde ligne terminée par « … »", () => {
    expect(twoLineLabel("Achats", 112, font)).toBe("Achats");
    const two = twoLineLabel("Ressources humaines", 112, font);
    expect(two.replace("\n", " ")).toBe("Ressources humaines");
    const long = twoLineLabel("Direction des systèmes d'information et de la transformation numérique", 112, font);
    const lines = long.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines.every(fits)).toBe(true);
    expect(long.replace("\n", " ").startsWith("Direction des")).toBe(true);
  });

  it("localizeOption : formateur posé sur les axes de catégories larges, réglages de coupure gardés, libellés enrichis intacts", () => {
    const long = "Direction des systèmes d'information et de la transformation numérique";
    const o = localizeOption({ yAxis: { type: "category", data: [long], axisLabel: { width: 150 } }, xAxis: { type: "value" }, series: [] }, undefined, true) as Any;
    expect(o.yAxis.axisLabel).toMatchObject({ width: 112, overflow: "break", height: 28, lineOverflow: "truncate" });
    expect(o.yAxis.axisLabel.formatter(long, 0)).toBe(twoLineLabel(long, 112, font));
    const custom = localizeOption({ yAxis: { type: "category", axisLabel: { width: 150, formatter: (v: string) => `Équipe ${v}` } }, series: [] }, undefined, true) as Any;
    expect(custom.yAxis.axisLabel.formatter("Nord", 0)).toBe("Équipe Nord");
    const rich = localizeOption({ yAxis: { type: "category", axisLabel: { width: 150, formatter: "{v|72 %}", rich: { v: {} } } }, series: [] }, undefined, true) as Any;
    expect(rich.yAxis.axisLabel.formatter).toBe("{v|72 %}");
    const desktop = localizeOption({ yAxis: { type: "category", axisLabel: { width: 150 } }, series: [] }) as Any;
    expect(desktop.yAxis.axisLabel.formatter).toBeUndefined();
  });

  it("rendu à 360 px : la barre au libellé trop long finit sa seconde ligne par « … »", () => {
    const r = render(barChart({ rows: [{ name: "Direction des systèmes d'information et de la transformation numérique", value: 12 }, { name: "Achats", value: 3 }], measure: "Effectif" }), {
      width: 360,
      narrow: true,
    });
    expect(r.svg).toContain("…");
    expect(r.svg).toContain(">Achats<");
    r.dispose();
  });
});

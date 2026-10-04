import { describe, expect, it } from "vitest";
import { localizeOption } from "@/components/charts/echart";
import { barChart, donutChart, histogramChart, levelStepChart, lineChart, shareChart, stackedBarChart, textOn, toBins } from "@/components/charts/builders";
import { CHART_PALETTE, SEMANTIC, formatShort, formatValue, frNumber, unitFor } from "@/components/charts/theme";

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;
const nb = (s: string) => s.replace(/[  ]/g, " ");
const L = (r: number, g: number, b: number) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (hex: string) => {
  const l = L(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  return 1.05 / (l + 0.05);
};

describe("formats français des graphiques", () => {
  it("nombres, unités accordées, étiquettes courtes", () => {
    expect(nb(frNumber(1234.5))).toBe("1 234,5");
    expect(nb(frNumber(0.8, 1))).toBe("0,8");
    expect(frNumber(null)).toBe("—");
    expect(nb(formatValue(12.345, { unit: "%" }))).toBe("12,3 %");
    expect(nb(formatValue(1, { unit: "collaborateurs" }))).toBe("1 collaborateur");
    expect(nb(formatValue(0.5, { unit: "jours", digits: 1 }))).toBe("0,5 jour");
    expect(nb(formatValue(3, { unit: "mois" }))).toBe("3 mois");
    expect(unitFor(1, "mois")).toBe("mois");
    expect(nb(formatValue(1717368, { unit: "TND" }))).toBe("1 717 368 TND");
    expect(nb(formatShort(4.25, { unit: "%" }))).toBe("4,3 %");
    expect(nb(formatShort(1200, { unit: "collaborateurs" }))).toBe("1 200");
  });

  it("palette : couleurs sémantiques et catégorielles ≥ 3:1 sur blanc", () => {
    for (const c of [...Object.values(SEMANTIC), ...CHART_PALETTE]) expect(contrast(c), c).toBeGreaterThanOrEqual(3);
    expect(textOn(SEMANTIC.neutre)).toBe("#ffffff");
    expect(textOn("#f3f5f8")).toBe("#0f172a");
  });
});

describe("helpers des 5 visuels de la charte", () => {
  const months = ["sept. 2025", "oct. 2025", "nov. 2025"];

  it("courbe d'évolution : axe nommé avec unité, ligne de référence annotée incluse dans l'axe, tableau et résumé", () => {
    const spec = lineChart({ categories: months, series: [{ name: "Taux d'absence", values: [1.2, null, 0.8] }], measure: "Taux d'absence", unit: "%", references: [{ value: 4, label: "Seuil" }] });
    const o = spec.option as Any;
    expect(o.yAxis.name).toBe("Taux d'absence (%)");
    expect(o.yAxis.min).toBe(0);
    expect(o.yAxis.max).toBeGreaterThanOrEqual(4);
    expect(o.legend).toBeUndefined();
    // Étiquette en bout de ligne, hors du tracé (jamais sur la courbe) : libellé puis valeur, marge droite réservée
    expect(nb(o.series[0].markLine.data[0].label.formatter)).toBe("Seuil\n4,0 %");
    expect(o.series[0].markLine.data[0].label.position).toBe("end");
    expect(o.grid.right).toBeGreaterThanOrEqual(o.series[0].markLine.data[0].label.width);
    expect(o.series[0].itemStyle.color).toBe(CHART_PALETTE[0]);
    expect(spec.table.headers).toEqual(["Période", "Taux d'absence"]);
    expect(spec.table.rows.map((r) => nb(r[1]))).toEqual(["1,2 %", "—", "0,8 %"]);
    expect(nb(spec.ariaLabel)).toContain("Dernière valeur : Taux d'absence : 0,8 % (nov. 2025)");
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it("courbe avec prévision : série grise en tirets, bande d'incertitude précalculée, légende en haut", () => {
    const spec = lineChart({
      categories: months,
      series: [
        { name: "Effectif observé", values: [100, 102, null] },
        { name: "Prévision", values: [null, 102, 104], tone: "prevision" },
      ],
      band: { lower: [null, 102, 98], upper: [null, 102, 110] },
      measure: "Effectif",
      unit: "collaborateurs",
    });
    const o = spec.option as Any;
    const band = o.series.filter((s: Any) => s.stack === "fourchette");
    expect(band).toHaveLength(2);
    expect(band[0].data.every((d: Any) => d.skip)).toBe(true);
    expect(nb(band[1].data[2].tip)).toBe("98 collaborateurs – 110 collaborateurs");
    expect(band[1].data[2].value).toBe(12);
    const prev = o.series.find((s: Any) => s.name === "Prévision");
    expect(prev.lineStyle.type).toBe("dashed");
    expect(prev.lineStyle.color).toBe(SEMANTIC.prevision);
    expect(o.legend.data).toEqual(["Effectif observé", "Prévision", "Fourchette probable à 80 %"]);
    expect(spec.table.headers).toContain("Fourchette probable à 80 % : haute");
  });

  it("barres horizontales : tri décroissant, valeurs affichées si ≤ 12 barres, mise en valeur", () => {
    const spec = barChart({
      rows: [
        { name: "Achats", value: 79 },
        { name: "Production", value: 304 },
        { name: "Qualité", value: 86 },
      ],
      measure: "Effectif",
      unit: "collaborateurs",
      highlight: ["Production"],
    });
    const o = spec.option as Any;
    expect(o.yAxis.data).toEqual(["Production", "Qualité", "Achats"]);
    expect(o.series[0].label.show).toBe(true);
    expect(o.series[0].data[0].itemStyle.color).toBe(SEMANTIC.neutre);
    expect(o.series[0].data[1].itemStyle.color).toBe(SEMANTIC.contexte);
    expect(o.xAxis.min).toBe(0);
    const many = barChart({ rows: Array.from({ length: 13 }, (_, i) => ({ name: `D${i}`, value: i })), measure: "Effectif" });
    expect((many.option as Any).series[0].label.show).toBe(false);
    expect(spec.height).toBeGreaterThanOrEqual(140);
  });

  it("barre empilée 100 % : parts en %, infobulle avec l'effectif, étiquettes masquées sous 8 %", () => {
    const spec = shareChart({ rows: [{ name: "", values: [19, 30, 938] }], parts: [{ label: "Élevé", tone: "defavorable" }, { label: "Moyen", tone: "attention" }, { label: "Faible", tone: "favorable" }], measure: "Niveaux de risque" });
    const o = spec.option as Any;
    const shares = o.series.map((s: Any) => s.data[0].value);
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100, 0);
    expect(nb(o.series[0].data[0].tip)).toBe("1,9 % (19 collaborateurs)");
    expect(o.series[0].data[0].label.show).toBe(false);
    expect(o.series[2].data[0].label.show).toBe(true);
    expect(o.yAxis.show).toBe(false);
    expect(spec.table.rows[0][0]).toBe("Niveaux de risque");
  });

  it("anneau : 4 parts au plus (les plus petites regroupées dans « Autres »), valeurs dans la légende", () => {
    const spec = donutChart({ parts: [5, 4, 3, 2, 1].map((v, i) => ({ name: `P${i}`, value: v })), measure: "Effectif", unit: "collaborateurs", center: { value: "15", label: "collaborateurs" } });
    const data = (spec.option as Any).series[0].data;
    expect(data.map((d: Any) => d.name)).toEqual(["P0", "P1", "P2", "Autres"]);
    expect(data[3].value).toBe(3);
    expect(nb(spec.format.legendValues!.P0)).toBe("5 (33 %)");
    expect(spec.table.rows).toHaveLength(4);
  });

  it("histogramme et classes", () => {
    const bins = toBins([0, 1, 4, 5, 9, 10], { width: 5 });
    expect(bins.map((b) => b.label)).toEqual(["0–4", "5–9", "10–14"]);
    expect(bins.map((b) => b.count)).toEqual([3, 2, 1]);
    expect(toBins([0.5, 1.5, 2], { width: 1 }).map((b) => b.count)).toEqual([1, 2]);
    const spec = histogramChart({ bins, measure: "Jours d'absence", unit: "jours", reference: { bin: "5–9", label: "Médiane" } });
    const o = spec.option as Any;
    expect(o.xAxis.name).toBe("Jours d'absence (jours)");
    expect(o.yAxis.name).toBe("Collaborateurs");
    expect(o.series[0].markLine.data[0].xAxis).toBe("5–9");
    expect(nb(spec.ariaLabel)).toContain("Classe la plus fréquente : 0–4 (3 collaborateurs)");
  });
});

describe("compléments", () => {
  it("courbe : point de raccord masqué de l'infobulle (skip) dans les séries et la bande", () => {
    const spec = lineChart({
      categories: ["juil.", "août", "sept."],
      series: [
        { name: "Observé", values: [10, 12, null] },
        { name: "Prévision", values: [null, { value: 12, skip: true }, 13], tone: "prevision" },
      ],
      band: { lower: [null, { value: 12, skip: true }, 11], upper: [null, { value: 12, skip: true }, 15] },
      measure: "Effectif",
    });
    const o = spec.option as Any;
    expect(o.series.find((x: Any) => x.name === "Prévision").data[1]).toEqual({ value: 12, skip: true });
    const range = o.series.filter((x: Any) => x.stack === "fourchette")[1];
    expect(range.data[1].skip).toBe(true);
    expect(nb(range.data[2].tip)).toBe("11 – 15");
    expect(spec.table.rows[1]).toEqual(["août", "12", "12", "12", "12"]);
  });

  it("barres empilées en valeurs absolues : tri par total, total en bout de barre, hors infobulle et légende", () => {
    const spec = stackedBarChart({
      rows: [
        { name: "Qualité", values: [1, 2, 3] },
        { name: "Production", values: [5, 10, 40] },
      ],
      parts: [{ label: "Élevé", tone: "defavorable" }, { label: "Moyen", tone: "attention" }, { label: "Faible", tone: "favorable" }],
      measure: "Formations",
      unit: "formations",
      categoryName: "Département",
    });
    const o = spec.option as Any;
    expect(o.yAxis.data).toEqual(["Production", "Qualité"]);
    const total = o.series[3];
    expect(total.data.map((d: Any) => d.labelText)).toEqual(["55", "6"]);
    expect(total.data.every((d: Any) => d.skip)).toBe(true);
    expect(o.legend.data).toEqual(["Élevé", "Moyen", "Faible"]);
    expect(o.series[0].data[1].label.show).toBe(false);
    expect(spec.table.rows[0].map(nb)).toEqual(["Production", "5", "10", "40", "55 formations"]);
  });
});

describe("niveau en escalier", () => {
  it("axe de catégories des niveaux, jamais formaté en nombre ; points colorés ; tableau", () => {
    const spec = levelStepChart({ categories: ["juin", "juil.", "août"], levels: ["Faible", null, "Élevé"] });
    const o = localizeOption(spec.option, spec.format) as Any;
    expect(o.yAxis.data).toEqual(["Faible", "Moyen", "Élevé"]);
    expect(o.yAxis.axisLabel?.formatter).toBeUndefined();
    expect(o.series[0].data[2].itemStyle.color).toBe(SEMANTIC.defavorable);
    expect(spec.table.rows[1]).toEqual(["juil.", "Non évalué"]);
    expect(spec.ariaLabel).toContain("Dernier niveau : Élevé (août)");
  });
});

describe("wrapper EChart : options localisées côté client", () => {
  it("axes de valeur, gabarits et infobulles au format français", () => {
    const o = localizeOption({
      tooltip: { trigger: "item", formatter: "{b} : {c} ({d} %)" },
      xAxis: { type: "category", data: ["a"] },
      yAxis: [{ type: "value" }, { type: "value", axisLabel: { formatter: "{value} %" } }],
      series: [{ type: "bar", data: [1200.5], label: { show: true } }],
    }) as Any;
    expect(nb(o.yAxis[0].axisLabel.formatter(1200))).toBe("1 200");
    expect(nb(o.yAxis[1].axisLabel.formatter(0.8))).toBe("0,8 %");
    expect(nb(o.tooltip.formatter({ name: "R&D", value: 1234.5, percent: 12.345 }))).toBe("R&amp;D : 1 234,5 (12,3 %)");
    expect(nb(o.series[0].label.formatter({ value: 1200.5 }))).toBe("1 200,5");
    const pie = localizeOption({ series: [{ type: "pie", label: { show: true }, data: [] }] }) as Any;
    expect(pie.series[0].label.formatter).toBeUndefined();
  });

  it("infobulle par défaut : valueFormatter ; avec format : texte précalculé, unité, noms échappés", () => {
    const plain = localizeOption({ tooltip: { trigger: "axis" }, series: [] }) as Any;
    expect(nb(plain.tooltip.valueFormatter(0.75))).toBe("0,75");
    const spec = lineChart({ categories: ["a"], series: [{ name: "<b>x</b>", values: [10] }], measure: "Taux", unit: "%" });
    const o = localizeOption(spec.option, spec.format) as Any;
    const html = nb(o.tooltip.formatter([{ axisValueLabel: "a", seriesName: "<b>x</b>", value: 10, data: 10, marker: "" }, { seriesName: "f", value: 3, data: { value: 3, skip: true } }]));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("10,0 %");
    expect(html).not.toContain(">f<");
  });

  it("mobile : légende déplacée en bas (sur plusieurs lignes si longue), grille ajustée, libellés de catégorie sur deux lignes", () => {
    const o = localizeOption(
      { legend: { top: 0, left: 0 }, grid: { top: 40, bottom: 20 }, yAxis: { type: "category", axisLabel: { width: 150 } }, xAxis: { type: "value" }, series: [{ name: "A" }] },
      undefined,
      true,
    ) as Any;
    expect(o.legend.bottom).toBe(0);
    expect(o.legend.top).toBeUndefined();
    expect(o.grid.top).toBe(16);
    expect(o.grid.bottom).toBe(48);
    expect((localizeOption({ legend: {}, grid: { top: 64 }, series: [] }, undefined, true) as Any).grid.top).toBe(36);
    expect(o.yAxis.axisLabel).toMatchObject({ width: 112, overflow: "break", lineOverflow: "truncate" });
    const long = localizeOption({ legend: { data: ["Effectif observé", "Prévision", "Fourchette probable à 80 %"] }, grid: { top: 60, bottom: 8 }, series: [] }, undefined, true) as Any;
    expect(long.legend.type).toBe("plain");
    expect(long.grid.bottom).toBe(8 + 2 * 22 + 6);
  });

  it("légende en haut et nom d'axe vertical : la grille descend pour éviter le chevauchement", () => {
    const o = localizeOption({ legend: { top: 0 }, grid: { top: 36 }, yAxis: { type: "value", name: "Connexions par jour" }, series: [] }) as Any;
    expect(o.grid.top).toBe(60);
    expect((localizeOption({ grid: { top: 36 }, yAxis: { type: "value", name: "x" }, series: [] }) as Any).grid.top).toBe(36);
  });

  it("anneau : valeurs ajoutées aux entrées de légende", () => {
    const spec = donutChart({ parts: [{ name: "Élevé", value: 19 }], measure: "Niveaux" });
    const o = localizeOption(spec.option, spec.format) as Any;
    expect(nb(o.legend.formatter("Élevé"))).toBe("Élevé  19 (100 %)");
  });
});

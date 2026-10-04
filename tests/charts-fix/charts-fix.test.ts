import { describe, expect, it, vi } from "vitest";
import * as echarts from "echarts";
import { createElement, type ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

const { CHART_SURFACE, DARK_COLORS, SEMANTIC, darkOption } = await import("@/components/charts/theme");
const { LIGHT_TOKENS, chartTheme, localizeOption } = await import("@/components/charts/echart");
const { barChart, lineChart, shareChart, stackedBarChart } = await import("@/components/charts/builders");
type ChartSpec = import("@/components/charts/builders").ChartSpec;

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options et des éléments ECharts produits */
type Any = any;

// Même chaîne que le composant EChart (thème, formats, mobile, sombre), rendue en SVG sans navigateur
function render(spec: ChartSpec, opts: { width?: number; narrow?: boolean; dark?: boolean; height?: number } = {}) {
  const { width = 560, narrow = false, dark = false } = opts;
  const height = opts.height ?? (narrow ? (spec.mobileHeight ?? spec.height) : spec.height);
  const tokens = dark ? (Object.fromEntries(Object.entries(LIGHT_TOKENS).map(([k, v]) => [k, DARK_COLORS[v] ?? v])) as typeof LIGHT_TOKENS) : LIGHT_TOKENS;
  const chart = echarts.init(null, chartTheme(tokens, dark, narrow) as Any, { renderer: "svg", ssr: true, width, height });
  chart.setOption(localizeOption(dark ? darkOption(spec.option) : spec.option, spec.format, narrow), { notMerge: true });
  const model: Any = (chart as Any).getModel();
  const list: Any[] = (chart as Any).getZr().storage.getDisplayList(true);
  const centers = (series = 0) => {
    const data = model.getSeriesByIndex(series).getData();
    return Array.from({ length: data.count() }, (_, k) => {
      const l = data.getItemLayout(k);
      return l.y + l.height / 2;
    });
  };
  // Textes des axes (z 0 ; étiquettes des séries : z 2)
  const axisTexts = list.filter((el) => el.type === "tspan" && el.z === 0).map((el) => String(el.style.text));
  return { list, centers, axisTexts, dispose: () => chart.dispose() };
}
const minBand = (centers: number[]) => Math.min(...centers.slice(1).map((c, k) => Math.abs(c - centers[k])));

// /charge, graphique de droite : pic d'heures sup par département, référence « Entreprise : 7,3 h »
const CHARGE = barChart({
  rows: [9.5, 9.3, 9.2, 6.9, 5.9, 4.9, 4.8, 3.6].map((value, k) => ({ name: `Direction ${String.fromCharCode(65 + k)}`, value })),
  measure: "Pic prévu d'heures sup par ETP",
  unit: "h",
  digits: 1,
  references: [{ value: 7.3, label: "Entreprise" }],
});

describe("barChart : la ligne de référence passe sur les barres et sous les étiquettes de valeur", () => {
  it("options : étiquettes détourées de la surface (2 px de marge) ; ligne au z des barres, z2 entre barre et étiquette", () => {
    const s = (CHARGE.option as Any).series[0];
    expect(s.label).toMatchObject({ show: true, position: "right", backgroundColor: CHART_SURFACE, padding: [1, 3] });
    expect(s.markLine.z).toBe(s.z);
    expect(s.markLine.data[0]).toMatchObject({ xAxis: 7.3, z2: 2 });
    const plain = (barChart({ rows: [{ name: "A", value: 3 }], measure: "Effectif" }).option as Any).series[0];
    expect(plain.label.backgroundColor).toBeUndefined();
    expect(plain.markLine).toBeUndefined();
    // Courbes : ligne horizontale inchangée (au-dessus de la courbe, étiquette hors du tracé)
    const line = (lineChart({ categories: ["a", "b"], series: [{ name: "Taux", values: [1, 2] }], measure: "Taux", references: [{ value: 1.5, label: "Moyenne" }] }).option as Any).series[0];
    expect(line.markLine.z).toBeUndefined();
    expect(line.markLine.data[0].z2).toBeUndefined();
    expect(JSON.parse(JSON.stringify(CHARGE))).toEqual(CHARGE);
  });

  it("sombre : fond des étiquettes = surface sombre des cartes (#111a2b, --pa-surface)", () => {
    expect((darkOption(CHARGE.option) as Any).series[0].label.backgroundColor).toBe("#111a2b");
  });

  for (const dark of [false, true]) {
    it(`rendu ${dark ? "sombre" : "clair"} : barres, puis ligne en tirets, puis étiquettes de valeur sur leur fond`, () => {
      const r = render(CHARGE, { dark });
      const bar = dark ? DARK_COLORS[SEMANTIC.neutre] : SEMANTIC.neutre;
      const lastBar = r.list.findLastIndex((el) => el.type === "rect" && el.style?.fill === bar);
      const line = r.list.findIndex((el) => el.type === "ec-line" && el.style?.lineDash != null && el.style.lineDash !== "solid");
      const value = r.list.findIndex((el) => el.type === "tspan" && el.style.text === "6,9");
      expect(lastBar).toBeGreaterThanOrEqual(0);
      expect(line).toBeGreaterThan(lastBar);
      expect(value).toBeGreaterThan(line);
      expect(r.list[value].parent.style.backgroundColor).toBe(dark ? "#111a2b" : CHART_SURFACE);
      // Le fond est dessiné juste avant son texte, donc lui aussi au-dessus de la ligne
      const box = r.list.findIndex((el) => el.type === "rect" && el.parent === r.list[value].parent);
      expect(box).toBeGreaterThan(line);
      expect(r.list[box].style.fill).toBe(dark ? "#111a2b" : CHART_SURFACE);
      r.dispose();
    });
  }
});

describe("mobile : axe de 0 à 100 gradué 0, 25, 50, 75, 100", () => {
  it("options : intervalle de 25 pour un axe de 0 à 100 ; 4 graduations libres sinon ; ordinateur et intervalle fourni inchangés", () => {
    const axis = (a: Any, narrow = true) => (localizeOption({ xAxis: a, yAxis: { type: "category", data: ["a"] }, series: [] }, undefined, narrow) as Any).xAxis;
    expect(axis({ type: "value", min: 0, max: 100 })).toMatchObject({ interval: 25 });
    expect(axis({ type: "value", min: 0, max: 100 }).splitNumber).toBeUndefined();
    expect(axis({ type: "value", min: 0 })).toMatchObject({ splitNumber: 4 });
    expect(axis({ type: "value", min: 0 }).interval).toBeUndefined();
    expect(axis({ type: "value", min: 90, max: 100 })).toMatchObject({ splitNumber: 4 });
    expect(axis({ type: "value", min: 0, max: 100, interval: 20 }).interval).toBe(20);
    expect(axis({ type: "value", min: 0, max: 100, splitNumber: 5 })).toMatchObject({ splitNumber: 5 });
    expect(axis({ type: "value", min: 0, max: 100 }, false).interval).toBeUndefined();
  });

  const ticks = (texts: string[]) => texts.filter((t) => /^\d+\s%$/u.test(t)).map((t) => t.replace(/\s/gu, " "));

  it("rendu à 360 px : parts 100 % de /interventions et courbe de maintien de /retention", () => {
    const share = render(
      shareChart({ rows: ["Revue de la charge de travail", "Entretien de rétention"].map((name) => ({ name, values: [1, 39, 61] })), parts: [{ label: "Réalisées" }, { label: "En attente" }, { label: "Rejetées" }], measure: "Statut" }),
      { width: 360, narrow: true },
    );
    expect(ticks(share.axisTexts)).toEqual(["0 %", "25 %", "50 %", "75 %", "100 %"]);
    share.dispose();
    const months = Array.from({ length: 49 }, (_, k) => `${k} mois`);
    const retention: ChartSpec = {
      option: {
        grid: { left: 8, right: 24, top: 64, bottom: 8, outerBoundsMode: "same", outerBoundsContain: "all" },
        xAxis: { type: "category", data: months, boundaryGap: false },
        yAxis: { type: "value", name: "Part encore présente (%)", min: 0, max: 100, axisLabel: { formatter: "{value} %" } },
        series: [{ type: "line", step: "end", data: months.map((_, k) => 100 - k) }],
      },
      format: { unit: "%" },
      height: 340,
      ariaLabel: "",
      table: { headers: [], rows: [] },
    };
    const curve = render(retention, { width: 360, narrow: true });
    expect(ticks(curve.axisTexts)).toEqual(["0 %", "25 %", "50 %", "75 %", "100 %"]);
    curve.dispose();
  });
});

describe("mobile : deux noms voisins écrits sur deux lignes ne se touchent pas", () => {
  // /transparency, poids par famille : noms longs (deux lignes de 14 px sous 640 px)
  const FAMILIES = ["Absences (hors santé)", "Carrière et contrat", "Rémunération", "Équipe", "Temps de travail", "Formation et évaluation"];
  const GAP = 28 + 14;

  it("barChart : hauteur mobile de 44 px par barre (marge comprise) ; noms courts : hauteur inchangée", () => {
    const spec = barChart({ rows: FAMILIES.map((name, k) => ({ name, value: 29 - 3 * k })), measure: "Poids de la famille", unit: "%", digits: 0 });
    expect(spec.height).toBe(236);
    expect(spec.mobileHeight).toBe(6 * 44 + 65);
    const before = render(spec, { width: 360, narrow: true, height: spec.height });
    expect(minBand(before.centers())).toBeLessThan(GAP);
    before.dispose();
    const after = render(spec, { width: 360, narrow: true });
    expect(minBand(after.centers())).toBeGreaterThanOrEqual(GAP);
    after.dispose();
    expect(barChart({ rows: [{ name: "Achats", value: 3 }, { name: "Production", value: 5 }], measure: "Effectif" }).mobileHeight).toBeUndefined();
    expect(barChart({ rows: FAMILIES.map((name) => ({ name, value: 1 })), measure: "Poids", height: 600 }).mobileHeight).toBe(600);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it("rendu à 360 px : barres avec référence, barres empilées, parts 100 % (légende passée en bas)", () => {
    const parts = [{ label: "Réalisées" }, { label: "En attente de décision" }, { label: "Rejetées" }];
    const rows = (n: number) => Array.from({ length: n }, (_, k) => ({ name: `${FAMILIES[k % FAMILIES.length]} ${k}`, values: [1, 3, 4] }));
    for (const n of [2, 4, 6, 10]) {
      const specs = [
        barChart({ rows: rows(n).map((r, k) => ({ name: r.name, value: 20 - k })), measure: "Poids", unit: "%", references: [{ value: 10, label: "Moyenne" }] }),
        stackedBarChart({ rows: rows(n), parts, measure: "Recommandations" }),
        shareChart({ rows: rows(n), parts, measure: "Statut" }),
      ];
      for (const spec of specs) {
        expect(spec.mobileHeight, `${spec.ariaLabel.slice(0, 20)} (${n})`).toBeGreaterThan(0);
        const r = render(spec, { width: 360, narrow: true });
        expect(minBand(r.centers()), `${spec.ariaLabel.slice(0, 20)} (${n})`).toBeGreaterThanOrEqual(GAP);
        r.dispose();
      }
    }
  });

  it("colonnes verticales et barre 100 % sans nom de catégorie : pas de hauteur mobile ajoutée", () => {
    expect(stackedBarChart({ rows: [{ name: "Formation et évaluation", values: [1, 2] }], parts: [{ label: "A" }, { label: "B" }], measure: "x", orientation: "vertical" }).mobileHeight).toBeUndefined();
    expect(shareChart({ rows: [{ name: "", values: [19, 30, 938] }], parts: [{ label: "Élevé" }, { label: "Moyen" }, { label: "Faible" }], measure: "Niveaux" }).mobileHeight).toBeUndefined();
  });
});

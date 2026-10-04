import * as echarts from "echarts";
import { describe, expect, it } from "vitest";
import { LIGHT_TOKENS, chartTheme, localizeOption, readChartTokens } from "@/components/charts/echart";
import type { ChartSpec } from "@/components/charts/pbi";
import { BAND_FILL, DARK_COLORS, SEMANTIC, darkOption } from "@/components/charts/theme";
import {
  CALIBRATION_TARGET,
  calibrationChart,
  calibrationPoints,
  estimateHistogramChart,
  factorsChart,
  fairnessChart,
  gainChart,
  levelShareChart,
  resignationTimelineChart,
  signedPct,
  wilson95,
} from "@/components/monitoring/model-options";
import { FACTOR_PHRASE, factorAxisLabel, factorsHeadline } from "@/components/monitoring/model-words";
import { gainCurve, resignationsByMonth } from "@/lib/dal/backtest";
import type { RunPointDTO } from "@/lib/dal/data-monitoring";

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;
const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

const FACTORS = [
  { label: "Plus de temps sans promotion", weight: 5.9 },
  { label: "Salaire plus haut que la médiane du poste", weight: -11.2 },
  { label: "Plus d'absences courtes", weight: 10.8 },
  { label: "Plus d'heures de formation", weight: -6.1 },
];
const BINS = [
  { predicted: 0.02, observed: 0.021, n: 400 },
  { predicted: 0.099, observed: 0.093, n: 3563 },
  { predicted: 0.05, observed: 0.05, n: null },
];
const GROUPS = [
  { group: "Femmes", observed: 0.0405, estimated: 0.0405, verdict: "juste" },
  { group: "Hommes", observed: 0.0414, estimated: 0.0552, verdict: "surestimé" },
];
const run = (asOf: string, levels: [number, number, number], current = false): RunPointDTO => ({
  id: 1,
  asOf,
  modelVersion: "logreg-v1-20260930",
  modelKind: "LOGREG",
  nScored: levels[0] + levels[1] + levels[2],
  current,
  levels: { ELEVE: levels[0], MOYEN: levels[1], FAIBLE: levels[2] },
});
const RUNS = [run("2026-07-31", [20, 30, 950]), run("2026-08-31", [19, 35, 933], true)];
const HISTOGRAM = [
  { from: 0, to: 0.02, n: 5 },
  { from: 0.02, to: 0.04, n: 9 },
  { from: 0.04, to: 0.06, n: 4 },
  { from: 0.06, to: null, n: 1 },
];
// 200 collaborateurs classés par rang : 7 démissions, dont 3 parmi les 4 premiers (capacité RH de 2 %)
const RESIGNED = Array.from({ length: 200 }, (_, i) => [0, 1, 3, 10, 50, 120, 199].includes(i));
const CAPACITY = { share: 4 / 200, captured: 3 / 7 };
const MONTHS = resignationsByMonth("2024-11-30", [
  { level: "ELEVE", eventDate: "2025-03-01" },
  { level: "FAIBLE", eventDate: "2024-12-20" },
  { level: "FAIBLE", eventDate: "2025-03-15" },
  { level: "FAIBLE", eventDate: "2025-05-30" },
  { level: "MOYEN", eventDate: null },
]);
const MONTH_LABELS = ["déc. 2024", "janv. 2025", "févr. 2025", "mars 2025", "avr. 2025", "mai 2025"];

const specs = (): Record<string, ChartSpec> => ({
  facteurs: factorsChart(FACTORS),
  calibration: calibrationChart(BINS),
  equite: fairnessChart(GROUPS),
  niveaux: levelShareChart(RUNS),
  histogramme: estimateHistogramChart(HISTOGRAM, 0.041),
  gain: gainChart(gainCurve(RESIGNED), CAPACITY),
  frise: resignationTimelineChart(MONTHS.byMonth, MONTH_LABELS),
});

describe("facteurs du modèle", () => {
  it("barres divergentes triées par poids, étiquettes signées, couleur par sens, ligne zéro", () => {
    const spec = factorsChart(FACTORS);
    const o = spec.option as Any;
    expect(o.yAxis.data).toEqual(["Salaire plus haut que la médiane du poste", "Plus d'absences courtes", "Plus d'heures de formation", "Plus de temps sans promotion"]);
    const data = o.series[0].data;
    expect(data.map((d: Any) => d.value)).toEqual([-11.2, 10.8, -6.1, 5.9]);
    expect(data.map((d: Any) => nb(d.label.formatter))).toEqual(["−11 %", "+11 %", "−6 %", "+6 %"]);
    expect(data.map((d: Any) => d.label.position)).toEqual(["left", "right", "left", "right"]);
    expect(data.map((d: Any) => d.itemStyle.color)).toEqual([SEMANTIC.favorable, SEMANTIC.defavorable, SEMANTIC.favorable, SEMANTIC.defavorable]);
    // Axe symétrique autour de zéro, gradué en %, ligne zéro pleine
    expect(o.xAxis.min).toBe(-o.xAxis.max);
    expect(o.xAxis.max).toBeGreaterThan(11.2);
    expect(o.xAxis.axisLabel.formatter).toBe("{value} %");
    expect(o.series[0].markLine.data).toEqual([{ xAxis: 0 }]);
    expect(o.series[0].markLine.lineStyle.type).toBe("solid");
    expect(o.xAxis.name).toBe("Poids relatif du facteur (%)");
    // Le sens est aussi écrit : infobulle, tableau, résumé pour lecteur d'écran
    expect(data.map((d: Any) => nb(d.tip))).toEqual(["−11 %, risque plus faible", "+11 %, risque plus élevé", "−6 %, risque plus faible", "+6 %, risque plus élevé"]);
    expect(spec.table.rows.map((r) => r.map(nb))).toEqual([
      ["Salaire plus haut que la médiane du poste", "Risque plus faible", "−11 %"],
      ["Plus d'absences courtes", "Risque plus élevé", "+11 %"],
      ["Plus d'heures de formation", "Risque plus faible", "−6 %"],
      ["Plus de temps sans promotion", "Risque plus élevé", "+6 %"],
    ]);
    expect(nb(spec.ariaLabel)).toContain("Plus d'absences courtes : +11 %, risque plus élevé");
  });

  it("libellé court sur l'axe (deux lignes au plus sur mobile), phrase complète dans l'infobulle et le tableau", () => {
    const spec = factorsChart([{ label: FACTOR_PHRASE.compa_ratio, axis: factorAxisLabel("compa_ratio"), weight: -11.2 }]);
    const o = spec.option as Any;
    expect(o.yAxis.data).toEqual(["Salaire au-dessus de la médiane"]);
    expect(nb(o.series[0].data[0].tip)).toBe("Salaire plus haut que la médiane du poste : −11 %, risque plus faible");
    expect(spec.table.rows[0][0]).toBe("Salaire plus haut que la médiane du poste");
    expect(factorAxisLabel("short_episodes_12m")).toBe(FACTOR_PHRASE.short_episodes_12m);
    // Sous 640 px, EChart limite l'étiquette à deux lignes d'environ 17 caractères : chaque libellé d'axe doit y tenir
    const lines = (label: string) =>
      label.split(" ").reduce<string[]>((out, word) => {
        const last = out.at(-1);
        if (last != null && `${last} ${word}`.length <= 17) out[out.length - 1] = `${last} ${word}`;
        else out.push(word);
        return out;
      }, []);
    for (const name of Object.keys(FACTOR_PHRASE)) {
      const wrapped = lines(factorAxisLabel(name));
      expect(wrapped.length, `${name} : ${wrapped.join(" / ")}`).toBeLessThanOrEqual(2);
      expect(Math.max(...wrapped.map((l) => l.length)), name).toBeLessThanOrEqual(17);
    }
  });

  it("pourcentage signé et titre-message", () => {
    expect(nb(signedPct(11.2))).toBe("+11 %");
    expect(nb(signedPct(-8.4))).toBe("−8 %");
    expect(nb(signedPct(-0.2))).toBe("0 %");
    expect(nb(signedPct(3.26, 1))).toBe("+3,3 %");
    expect(factorsHeadline(["compa_ratio", "short_episodes_12m", "team_exit_rate_6m"])).toBe("Le salaire et les absences courtes pèsent le plus");
    expect(factorsHeadline(["tenure_months"])).toBe("L'ancienneté pèse le plus");
    expect(factorsHeadline(["short_episodes_12m"])).toBe("Les absences courtes pèsent le plus");
    expect(factorsHeadline(["variable_inconnue", "compa_ratio"])).toBeNull();
    expect(factorsHeadline([])).toBeNull();
  });
});

describe("calibration", () => {
  it("intervalle de Wilson à 95 % par groupe", () => {
    const [low, high] = wilson95(0.093, 3563);
    expect(low).toBeCloseTo(0.0839, 3);
    expect(high).toBeCloseTo(0.103, 3);
    expect(wilson95(0, 50)[0]).toBe(0);
    const pts = calibrationPoints(BINS);
    expect(pts[1].low!).toBeLessThan(pts[1].observed);
    expect(pts[1].high!).toBeGreaterThan(pts[1].observed);
    // Moins d'observations : marge plus large ; sans effectif : pas de marge
    expect(pts[0].high! - pts[0].low!).toBeGreaterThan(pts[1].high! - pts[1].low!);
    expect(pts[2]).toMatchObject({ low: null, high: null });
  });

  it("points avec barres verticales, taille selon l'effectif, diagonale « accord parfait », axes bornés et identiques, zone 0,8–1,25", () => {
    const spec = calibrationChart(BINS);
    const o = spec.option as Any;
    expect(o.xAxis).toMatchObject({ type: "value", min: 0 });
    expect(o.yAxis).toMatchObject({ type: "value", min: 0, max: o.xAxis.max });
    expect(o.xAxis.max).toBeGreaterThanOrEqual(10.3);
    expect(o.xAxis.axisLabel.formatter).toBe("{value} %");

    const diagonal = o.series.find((s: Any) => s.name === "Accord parfait");
    expect(diagonal.data).toEqual([[0, 0], [o.xAxis.max, o.xAxis.max]]);
    expect(diagonal.lineStyle.type).toBe("dashed");

    const margins = o.series.filter((s: Any) => s.name === "Marge d'incertitude à 95 %");
    expect(margins).toHaveLength(2);
    for (const m of margins) {
      expect(m.type).toBe("line");
      expect(m.data[0][0]).toBe(m.data[1][0]);
      expect(m.data[0][1]).toBeLessThan(m.data[1][1]);
      expect(m.silent).toBe(true);
    }
    expect(margins[1].data).toEqual([[9.9, 8.4], [9.9, 10.3]]);

    const points = o.series.find((s: Any) => s.name === "Modèle");
    expect(points.type).toBe("scatter");
    expect(points.data.map((d: Any) => d.value)).toEqual([[2, 2.1], [9.9, 9.3], [5, 5]]);
    expect(points.data[1].symbolSize).toBeGreaterThan(points.data[0].symbolSize);
    expect(points.data[0].symbolSize).toBeGreaterThanOrEqual(8);
    expect(nb(points.data[1].tip)).toBe("risque annoncé 9,9 %, démissions observées 9,3 % (marge 8,4 à 10,3 %), 3 563 observations");

    // Zone cible : bande entre 0,8 et 1,25 fois le risque annoncé (deux tracés empilés, le second rempli)
    const zone = o.series.filter((s: Any) => s.name === "Écart acceptable");
    expect(zone.map((s: Any) => s.stack)).toEqual(["ecart", "ecart"]);
    expect(zone[0].data[1][1]).toBeCloseTo(CALIBRATION_TARGET[0] * o.xAxis.max, 9);
    expect(zone[0].data[1][1] + zone[1].data[1][1]).toBeCloseTo(CALIBRATION_TARGET[1] * o.xAxis.max, 9);
    expect(zone[1].areaStyle.color).toBe(BAND_FILL);
    expect(zone[0].areaStyle).toBeUndefined();

    expect(spec.table.headers).toEqual(["Risque annoncé (moyenne)", "Démissions observées", "Marge d'incertitude à 95 %", "Observations"]);
    expect(spec.table.rows.map((r) => r.map(nb))).toEqual([
      ["2,0 %", "2,1 %", "1,1 à 4,0 %", "400"],
      ["9,9 %", "9,3 %", "8,4 à 10,3 %", "3 563"],
      ["5,0 %", "5,0 %", "—", "—"],
    ]);
    expect(nb(spec.ariaLabel)).toContain("marge d'incertitude à 95 %");
  });
});

describe("équité", () => {
  it("par groupe : démissions réelles et risque estimé sur une même échelle, jugement écrit", () => {
    const spec = fairnessChart(GROUPS);
    const o = spec.option as Any;
    expect(o.yAxis.data).toEqual(["Femmes", "Hommes"]);
    expect(o.xAxis).toMatchObject({ type: "value", min: 0 });
    expect(o.xAxis.max).toBeGreaterThan(5.5);
    const real = o.series.find((s: Any) => s.name === "Démissions réelles");
    const estimated = o.series.find((s: Any) => s.name === "Risque estimé moyen");
    expect(real.data.map((d: Any) => d.value)).toEqual([[4.1, "Femmes"], [4.1, "Hommes"]]);
    expect(estimated.data.map((d: Any) => d.value)).toEqual([[4.1, "Femmes"], [5.5, "Hommes"]]);
    expect(real.symbol).not.toBe(estimated.symbol);
    expect(real.data.map((d: Any) => nb(d.labelText))).toEqual(["réel 4,1 % · estimé 4,1 % · juste", "réel 4,1 % · estimé 5,5 % · surestimé"]);
    expect(o.legend.data.map((l: Any) => l.name)).toEqual(["Démissions réelles", "Risque estimé moyen"]);
    // Un trait relie les deux points de chaque groupe
    expect(o.series.filter((s: Any) => s.name === "Écart").map((s: Any) => s.data)).toEqual([
      [[4.1, "Femmes"], [4.1, "Femmes"]],
      [[4.1, "Hommes"], [5.5, "Hommes"]],
    ]);
    expect(nb(spec.ariaLabel)).toContain("Hommes : réel 4,1 %, estimé 5,5 %, surestimé");
  });
});

describe("suivi mensuel", () => {
  it("part des niveaux : barres empilées à 100 %, écart de 2 px entre segments, légende", () => {
    const spec = levelShareChart(RUNS);
    const o = spec.option as Any;
    expect(o.series.map((s: Any) => [s.name, s.type, s.stack])).toEqual([
      ["Élevé", "bar", "niveaux"],
      ["Moyen", "bar", "niveaux"],
      ["Faible", "bar", "niveaux"],
    ]);
    expect(o.legend.data.map((l: Any) => l.name)).toEqual(["Élevé", "Moyen", "Faible"]);
    expect(o.xAxis).toMatchObject({ min: 0, max: 100 });
    expect(o.yAxis.data).toEqual(["juil. 2026", "août 2026"]);
    for (const i of [0, 1]) expect(o.series.reduce((sum: number, s: Any) => sum + s.data[i].value, 0)).toBeCloseTo(100, 9);
    for (const s of o.series) expect(s.itemStyle).toMatchObject({ borderColor: "#ffffff", borderWidth: 1 });
    expect(nb(o.series[0].data[1].tip)).toBe("1,9 % (19)");
    expect(spec.table.rows[0].map(nb)).toEqual(["août 2026 (publié)", "19 (1,9 %)", "35 (3,5 %)", "933 (94,5 %)"]);
  });

  it("histogramme des risques estimés : ligne de moyenne annotée, placée dans sa classe", () => {
    const spec = estimateHistogramChart(HISTOGRAM, 0.041);
    const o = spec.option as Any;
    expect(o.xAxis.data).toEqual(["0–2", "2–4", "4–6", "≥ 6"]);
    const s = o.series[0];
    expect(s.data.map((d: Any) => d.value)).toEqual([5, 9, 4, 1]);
    expect(nb(s.markLine.label.formatter)).toBe("Moyenne : 4,1 %");
    // 4,1 % : au vingtième de la classe 4–6 (indice 2), soit 2 + 0,05 − 0,5 sur l'axe des classes
    expect(s.markLine.data[0].xAxis).toBeCloseTo(1.55, 9);
    expect(s.data[2].label).toEqual({ show: false });
    expect(s.data[1].label).toBeUndefined();
    expect(o.yAxis.boundaryGap).toEqual(["0%", "25%"]);
    expect(spec.table.rows.map((r) => r.map(nb))).toEqual([["0 à 2 %", "5"], ["2 à 4 %", "9"], ["4 à 6 %", "4"], ["6 % et plus", "1"]]);
    expect((estimateHistogramChart(HISTOGRAM, null).option as Any).series[0].markLine).toBeUndefined();
  });
});

describe("vérification a posteriori", () => {
  it("courbe de gain calculée par rang", () => {
    const curve = gainCurve(RESIGNED);
    expect(curve).toHaveLength(101);
    expect(curve[0]).toEqual({ share: 0, captured: 0 });
    expect(curve[2]).toEqual({ share: 0.02, captured: 3 / 7 });
    expect(curve[100]).toEqual({ share: 1, captured: 1 });
    for (let k = 1; k < curve.length; k++) expect(curve[k].captured).toBeGreaterThanOrEqual(curve[k - 1].captured);
    // Moins de 100 collaborateurs : un point par personne
    expect(gainCurve([true, false, true, false]).map((p) => p.captured)).toEqual([0, 0.5, 0.5, 1, 1]);
    expect(gainCurve([])).toEqual([]);
    expect(gainCurve([false, false])).toEqual([]);
  });

  it("visuel de gain : diagonale « hasard », point et repère « capacité RH »", () => {
    const spec = gainChart(gainCurve(RESIGNED), CAPACITY);
    const o = spec.option as Any;
    expect(o.xAxis).toMatchObject({ min: 0, max: 100 });
    expect(o.yAxis).toMatchObject({ min: 0, max: 100 });
    const [model, random, capacity] = o.series;
    expect(model.name).toBe("Modèle");
    const xs = model.data.map((d: Any) => d.value[0]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(model.data.at(-1).value).toEqual([100, 100]);
    expect(random.name).toBe("Tirage au hasard");
    expect(random.data.map((d: Any) => d.value)).toEqual([[0, 0], [100, 100]]);
    expect(random.lineStyle.type).toBe("dashed");
    expect(capacity).toMatchObject({ name: "Capacité RH", type: "scatter" });
    expect(capacity.data[0].value).toEqual([2, 42.9]);
    expect(nb(capacity.data[0].tip)).toBe("2,0 % contactés : 42,9 % des démissions repérées");
    expect(capacity.markLine.data).toEqual([{ xAxis: 2 }]);
    expect(nb(capacity.markLine.label.formatter)).toBe("Capacité RH : 2,0 % contactés");
    expect(o.legend.data.map((l: Any) => l.name ?? l)).toEqual(["Modèle", "Tirage au hasard", "Capacité RH"]);
    expect(spec.table.rows[0].map(nb)).toEqual(["2,0 % (capacité RH)", "42,9 %", "2,0 %"]);
    expect(spec.table.rows).toHaveLength(11);
    expect(nb(spec.ariaLabel)).toContain("À la capacité RH : 2,0 % contactés : 42,9 % des démissions repérées");
    // Sans niveau Élevé : ni point ni repère
    const bare = gainChart(gainCurve(RESIGNED), null).option as Any;
    expect(bare.series.map((s: Any) => s.name)).toEqual(["Modèle", "Tirage au hasard"]);
  });

  it("démissions par mois après l'origine, selon le niveau à l'origine", () => {
    expect(MONTHS.byMonth.map((m) => m.month)).toEqual(["2024-12", "2025-01", "2025-02", "2025-03", "2025-04", "2025-05"]);
    expect(MONTHS.byMonth[0].levels).toEqual({ ELEVE: 0, MOYEN: 0, FAIBLE: 1 });
    expect(MONTHS.byMonth[3].levels).toEqual({ ELEVE: 1, MOYEN: 0, FAIBLE: 1 });
    expect(MONTHS.byMonth[5].levels).toEqual({ ELEVE: 0, MOYEN: 0, FAIBLE: 1 });
    expect(MONTHS.undated).toBe(1);

    const spec = resignationTimelineChart(MONTHS.byMonth, MONTH_LABELS);
    const o = spec.option as Any;
    expect(o.xAxis.data).toEqual(MONTH_LABELS);
    expect(o.series.map((s: Any) => [s.name, s.stack])).toEqual([
      ["Classés Élevé", "demissions"],
      ["Classés Moyen", "demissions"],
      ["Classés Faible", "demissions"],
      ["Total", "demissions"],
    ]);
    expect(o.series[0].data[3]).toMatchObject({ value: 1 });
    expect(o.series[0].data[0]).toEqual({ value: null, skip: true });
    // Dernier segment non nul de la pile : extrémité arrondie ; total écrit au-dessus de chaque mois
    expect(o.series[2].data[3].itemStyle).toEqual({ borderRadius: [4, 4, 0, 0] });
    expect(o.series[0].data[3].itemStyle).toEqual({});
    expect(o.series[3].data.map((d: Any) => d.labelText)).toEqual(["1", "", "", "2", "", "1"]);
    for (const s of o.series.slice(0, 3)) expect(s.itemStyle).toMatchObject({ borderColor: "#ffffff", borderWidth: 1 });
    expect(spec.table.rows[3]).toEqual(["mars 2025", "1", "0", "1", "2"]);
    expect(spec.ariaLabel).toContain("Mois le plus chargé : mars 2025 (2)");
  });
});

describe("thème et rendu", () => {
  const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(.+\))$/i;
  const colors = (v: unknown, out = new Set<string>()): Set<string> => {
    if (typeof v === "string") {
      if (COLOR.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => colors(x, out));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => colors(x, out));
    return out;
  };

  it("options sérialisables, aucune couleur hors de DARK_COLORS", () => {
    const known = new Set(Object.keys(DARK_COLORS));
    for (const [name, spec] of Object.entries(specs())) {
      expect(JSON.parse(JSON.stringify(spec)), name).toEqual(spec);
      const used = [...colors(spec.option)];
      expect(used.length, name).toBeGreaterThan(0);
      expect(used.filter((c) => !known.has(c.toLowerCase())), name).toEqual([]);
    }
  });

  const render = (spec: ChartSpec, dark: boolean) => {
    const chart = echarts.init(null, chartTheme(dark ? readChartTokens(true) : LIGHT_TOKENS, dark), { renderer: "svg", ssr: true, width: 560, height: spec.height });
    chart.setOption(localizeOption(dark ? darkOption(spec.option) : spec.option, spec.format, false));
    const svg = nb(chart.renderToSVGString());
    chart.dispose();
    return svg;
  };

  it("rendu ECharts en clair et en sombre : étiquettes écrites, couleurs claires remplacées en sombre", () => {
    const expected: Record<string, string[]> = {
      facteurs: ["+11 %", "−11 %", "Poids relatif du facteur (%)"],
      calibration: ["Risque annoncé par le modèle (%)", "Démissions observées (%)"],
      equite: ["réel 4,1 % · estimé 5,5 % · surestimé", "Risque estimé moyen"],
      niveaux: ["août 2026", "Faible", "100 %"],
      histogramme: ["Moyenne : 4,1 %", "≥ 6"],
      gain: ["Capacité RH : 2,0 % contactés", "Tirage au hasard"],
      frise: ["mars 2025", "Classés Élevé"],
    };
    for (const [name, spec] of Object.entries(specs())) {
      const light = render(spec, false);
      const dark = render(spec, true);
      for (const label of expected[name]) {
        expect(light, `${name} (clair)`).toContain(label);
        expect(dark, `${name} (sombre)`).toContain(label);
      }
      expect(Object.values(SEMANTIC).some((c) => light.includes(c)), `${name} : couleur sémantique tracée`).toBe(true);
      for (const c of Object.values(SEMANTIC)) {
        if (!light.includes(c)) continue;
        expect(dark, `${name} : ${c} en sombre`).not.toContain(c);
        expect(dark, `${name} : équivalent sombre de ${c}`).toContain(DARK_COLORS[c]);
      }
    }
  });
});

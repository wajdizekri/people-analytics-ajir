import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

const pbi = await import("@/components/charts/pbi");
const { CHART_INK, CHART_PALETTE, CHART_SURFACE, DARK_COLORS, SEMANTIC, cssChartColor, darkOption } = await import("@/components/charts/theme");
const { localizeOption } = await import("@/components/charts/echart");
const { InfoTip } = await import("@/components/help/info-tip");

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;
const h = (type: unknown, props: Record<string, unknown> | null, ...children: ReactNode[]) => createElement(type as string, props, ...children);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const nb = (s: string) => s.replace(/[  ]/g, " ");
const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
// Élément <span> complet qui commence à `i`
const spanAt = (m: string, i: number) => {
  const re = /<\/?span\b[^>]*>/g;
  re.lastIndex = i;
  let depth = 0;
  for (let t = re.exec(m); t; t = re.exec(m)) {
    depth += t[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.slice(i, re.lastIndex);
  }
  return m.slice(i);
};
// Texte visible : sans les bulles « ? » (bouton et texte masqué) ; texte des bulles fermées
const TIP = '<span class="relative inline-flex align-middle';
const visible = (m: string) => {
  let out = m;
  for (let i = out.indexOf(TIP); i >= 0; i = out.indexOf(TIP)) out = out.slice(0, i) + out.slice(i + spanAt(out, i).length);
  return text(out);
};
const bubbles = (m: string) => [...m.matchAll(/<span id="[^"]+" hidden=""/g)].map((x) => text(spanAt(m, x.index)));

// Contraste WCAG (même luminance que tests/components/charts.test.ts), ici entre deux couleurs
const L = (r: number, g: number, b: number) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const lum = (hex: string) => L(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Contrôles du validateur de palette de la compétence dataviz : OKLab × 100, daltonisme simulé (Machado 2009, sévérité 1)
const linear = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const oklab = ([r, g, b]: number[]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const seen = (hex: string, m?: number[][]) => oklab(m ? m.map((row) => Math.min(1, Math.max(0, row.reduce((a, k, i) => a + k * linear(hex)[i], 0)))) : linear(hex));
const gap = (a: string, b: string, m?: number[][]) => 100 * Math.hypot(...seen(a, m).map((v, i) => v - seen(b, m)[i]));
const cvdGap = (a: string, b: string) => Math.min(gap(a, b, CVD.protan), gap(a, b, CVD.deutan));
const lightness = (hex: string) => oklab(linear(hex))[0];
const chroma = (hex: string) => Math.hypot(oklab(linear(hex))[1], oklab(linear(hex))[2]);
const hue = (hex: string) => ((Math.atan2(oklab(linear(hex))[2], oklab(linear(hex))[1]) * 180) / Math.PI + 360) % 360;

const WHITE = "#ffffff";
const DARK_SURFACE = "#111a2b";
const darkPalette = CHART_PALETTE.map((c) => DARK_COLORS[c]);
const BANDS: { to: number; tone: "critique" | "attention" | "bon"; label: string }[] = [
  { to: 60, tone: "critique", label: "Critique" },
  { to: 80, tone: "attention", label: "À surveiller" },
  { to: 100, tone: "bon", label: "Bon" },
];

// Toutes les couleurs hexadécimales écrites dans une option
function hexes(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    if (/^#[0-9a-f]{3,8}$/i.test(v)) out.add(v.toLowerCase());
  } else if (Array.isArray(v)) v.forEach((x) => hexes(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => hexes(x, out));
  return out;
}

describe("palette catégorielle", () => {
  it("6 à 8 teintes distinctes, bleu ArabSoft d'abord, aucune couleur sémantique ni teinte rouge, ambre ou verte", () => {
    expect(CHART_PALETTE.length).toBeGreaterThanOrEqual(6);
    expect(CHART_PALETTE.length).toBeLessThanOrEqual(8);
    expect(CHART_PALETTE[0]).toBe(SEMANTIC.neutre);
    expect(new Set(CHART_PALETTE).size).toBe(CHART_PALETTE.length);
    expect(new Set(darkPalette).size).toBe(CHART_PALETTE.length);
    const reserved = Object.entries(SEMANTIC).filter(([tone]) => tone !== "neutre").map(([, hex]) => hex);
    for (const c of CHART_PALETTE) expect(reserved, c).not.toContain(c);
    // Arc froid, du turquoise au magenta : ni rouge (28°), ni ambre (58° ; 84° en sombre), ni vert (150°)
    for (const c of [...CHART_PALETTE, ...darkPalette]) {
      expect(hue(c), c).toBeGreaterThanOrEqual(170);
      expect(hue(c), c).toBeLessThanOrEqual(355);
    }
  });

  it("chaque teinte et chaque couleur sémantique a son équivalent sombre, sa variable CSS et un contraste ≥ 3:1 dans les deux thèmes", () => {
    for (const c of [...CHART_PALETTE, ...Object.values(SEMANTIC)]) {
      expect(DARK_COLORS[c], c).toMatch(/^#[0-9a-f]{6}$/);
      expect(cssChartColor(c)).toBe(`var(--pa-chart-${c.slice(1)}, ${c})`);
      expect(css, c).toContain(`--pa-chart-${c.slice(1)}: ${DARK_COLORS[c]};`);
      expect(contrast(c, WHITE), `${c} sur blanc`).toBeGreaterThanOrEqual(3);
      expect(contrast(DARK_COLORS[c], DARK_SURFACE), `${DARK_COLORS[c]} sur surface sombre`).toBeGreaterThanOrEqual(3);
    }
  });

  it("encres des graphiques ≥ 4,5:1 dans les deux thèmes ; surface et traits remappés", () => {
    for (const ink of [CHART_INK.fg, CHART_INK.ink, CHART_INK.muted]) {
      expect(contrast(ink, WHITE), ink).toBeGreaterThanOrEqual(4.5);
      expect(contrast(DARK_COLORS[ink], DARK_SURFACE), DARK_COLORS[ink]).toBeGreaterThanOrEqual(4.5);
    }
    expect(CHART_SURFACE).toBe(CHART_INK.surface);
    expect(DARK_COLORS[CHART_SURFACE]).toBe(DARK_SURFACE);
    for (const c of Object.values(CHART_INK)) expect(DARK_COLORS[c], c).toBeTruthy();
  });

  it("contrôles du validateur dataviz : clarté, saturation, écarts des teintes voisines (vision normale et daltonienne)", () => {
    const check = (palette: string[], band: [number, number], name: string) => {
      for (const c of palette) {
        expect(lightness(c), `${name} clarté ${c}`).toBeGreaterThanOrEqual(band[0]);
        expect(lightness(c), `${name} clarté ${c}`).toBeLessThanOrEqual(band[1]);
        expect(chroma(c), `${name} saturation ${c}`).toBeGreaterThanOrEqual(0.1);
      }
      // Voisines dans l'ordre (piles, barres, courbes) + toutes les paires des trois premières (anneau : la 3e touche la 1re)
      const pairs = [...palette.slice(1).map((c, i) => [palette[i], c]), [palette[0], palette[2]]];
      for (const [a, b] of pairs) {
        expect(cvdGap(a, b), `${name} daltonisme ${a} ↔ ${b}`).toBeGreaterThanOrEqual(8);
        expect(gap(a, b), `${name} vision normale ${a} ↔ ${b}`).toBeGreaterThanOrEqual(15);
      }
    };
    check([...CHART_PALETTE], [0.43, 0.77], "clair");
    check(darkPalette, [0.48, 0.67], "sombre");
  });

  it("mise en valeur : le bleu neutre ressort du gris de contexte dans les deux thèmes", () => {
    expect(gap(SEMANTIC.neutre, SEMANTIC.contexte)).toBeGreaterThanOrEqual(15);
    expect(gap(DARK_COLORS[SEMANTIC.neutre], DARK_COLORS[SEMANTIC.contexte])).toBeGreaterThanOrEqual(15);
    expect(cvdGap(DARK_COLORS[SEMANTIC.neutre], DARK_COLORS[SEMANTIC.contexte])).toBeGreaterThanOrEqual(8);
  });
});

describe("thème sombre : aucune couleur fixe dans ce que le kit émet", () => {
  const emitted: Record<string, unknown> = {
    AXIS: pbi.AXIS,
    LEGEND: pbi.LEGEND,
    TOOLTIP_AXIS: pbi.TOOLTIP_AXIS,
    TOOLTIP_ITEM: pbi.TOOLTIP_ITEM,
    MARK: pbi.MARK,
    sparkline: pbi.sparklineOption([1, 2, null, 3]),
    donut: pbi.donutOption([5, 4, 3, 2, 1].map((value, i) => ({ name: `P${i}`, value })), { value: "15", label: "comptes" }),
    gauge: pbi.gaugeOption(72, { warn: 80, crit: 60, higherIsBetter: true, unit: "%" }),
    bullet: pbi.bulletOption(72.5, { unit: "%", target: 90, bands: BANDS }),
    bulletNu: pbi.bulletOption(3, { target: 5 }),
  };

  it("toutes les couleurs écrites ont un équivalent sombre ; options sérialisables", () => {
    for (const [name, value] of Object.entries(emitted)) {
      const found = [...hexes(value)];
      expect(found.length, name).toBeGreaterThan(0);
      for (const c of found) expect(DARK_COLORS[c], `${name} : ${c}`).toBeTruthy();
      expect(JSON.parse(JSON.stringify(value)), name).toEqual(value);
    }
  });

  it("darkOption : encres claires sur surface sombre, écarts en couleur de surface", () => {
    const d = darkOption(emitted.donut as object) as Any;
    expect(d.series[0].itemStyle.borderColor).toBe(DARK_SURFACE);
    expect(d.title.textStyle.color).toBe(DARK_COLORS[CHART_INK.fg]);
    expect(d.legend.textStyle.color).toBe(DARK_COLORS[CHART_INK.ink]);
    const b = darkOption(emitted.bullet as object) as Any;
    expect(b.yAxis.axisLabel.rich.v.color).toBe(DARK_COLORS[CHART_INK.fg]);
    expect(b.series[0].data[0].itemStyle.color).toBe(DARK_COLORS[SEMANTIC.attention]);
  });
});

describe("marques et réglages communs", () => {
  it("barres à bout arrondi de 4 px, écart de 2 px entre aplats, courbe de 2 px, repère de 8 px au survol", () => {
    expect(pbi.MARK.bar).toMatchObject({ barMaxWidth: 24, itemStyle: { borderRadius: [0, 4, 4, 0] } });
    expect(pbi.MARK.column.itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    expect(pbi.MARK.stack.itemStyle).toEqual({ borderColor: CHART_SURFACE, borderWidth: 1 });
    expect(pbi.MARK.line).toMatchObject({ showSymbol: false, symbolSize: 8, lineStyle: { width: 2 }, itemStyle: { borderColor: CHART_SURFACE, borderWidth: 2 } });
    expect(pbi.AXIS.splitLine.lineStyle).toMatchObject({ width: 1, type: "solid" });
    expect(pbi.AXIS.axisLabel.color).toBe(CHART_INK.muted);
    expect(pbi.LEGEND.textStyle.color).toBe(CHART_INK.ink);
  });

  it("légende à partir de deux séries seulement", () => {
    expect(pbi.legendFor(["Taux d'absence"])).toBeUndefined();
    expect(pbi.legendFor(["Observé", "Prévision"])).toMatchObject({ data: ["Observé", "Prévision"], icon: "roundRect" });
  });
});

describe("sparklineOption", () => {
  it("courbe de 2 px en retrait, dernier point renseigné marqué en couleur d'accent et cerclé de la surface", () => {
    const o = pbi.sparklineOption([3, 5, null, 4, null]) as Any;
    const s = o.series[0];
    expect(s.symbol).toBe("none");
    expect(s.lineStyle).toMatchObject({ width: 2, color: SEMANTIC.contexte });
    expect(s.areaStyle.opacity).toBeLessThanOrEqual(0.12);
    expect(s.data[3]).toEqual({ value: 4, symbol: "circle", symbolSize: 8, itemStyle: { color: SEMANTIC.neutre, borderColor: CHART_SURFACE, borderWidth: 2 } });
    expect(s.data.filter((d: Any) => d && typeof d === "object")).toHaveLength(1);
    expect(o.grid.right).toBeGreaterThanOrEqual(5);
    const toned = pbi.sparklineOption([1, 2], SEMANTIC.defavorable, SEMANTIC.defavorable) as Any;
    expect(toned.series[0].lineStyle.color).toBe(SEMANTIC.defavorable);
    expect(toned.series[0].data[1].itemStyle.color).toBe(SEMANTIC.defavorable);
    expect((pbi.sparklineOption([null, null]) as Any).series[0].data).toEqual([null, null]);
  });
});

describe("donutOption", () => {
  it("4 parts au plus : les plus petites regroupées dans « Autres », écart de 2 px, étiquette centrale, valeurs de légende", () => {
    const items = [1, 5, 2, 4, 3, 0].map((value, i) => ({ name: `P${i}`, value }));
    const o = pbi.donutOption(items, { value: "15", label: "comptes actifs" }) as Any;
    const data = o.series[0].data;
    expect(data.map((d: Any) => d.name)).toEqual(["P1", "P3", "P4", "Autres"]);
    expect(data[3].value).toBe(3);
    expect(data[3].itemStyle.color).toBe(SEMANTIC.contexte);
    expect(o.legend.data).toEqual(["P1", "P3", "P4", "Autres"]);
    expect(o.series[0].itemStyle).toMatchObject({ borderColor: CHART_SURFACE, borderWidth: 2 });
    expect(o.title).toMatchObject({ text: "15", subtext: "comptes actifs" });
    expect(nb(pbi.donutLegendValues(items).Autres)).toBe("3 (20 %)");
    expect(nb(pbi.donutLegendValues(items).P1)).toBe("5 (33 %)");
    const lv = localizeOption(o, { legendValues: pbi.donutLegendValues(items) }) as Any;
    expect(nb(lv.legend.formatter("P1"))).toBe("P1  5 (33 %)");
  });

  it("4 parts ou moins : ordre et noms conservés (la couleur suit la série), pas d'étiquette centrale sans total", () => {
    const o = pbi.donutOption([{ name: "Administrateur", value: 1 }, { name: "Responsable RH", value: 0 }, { name: "Manager", value: 2, color: SEMANTIC.reference }]) as Any;
    expect(o.series[0].data.map((d: Any) => d.name)).toEqual(["Administrateur", "Responsable RH", "Manager"]);
    expect(o.series[0].data[2].itemStyle.color).toBe(SEMANTIC.reference);
    expect(o.title).toBeUndefined();
  });
});

describe("bulletOption : valeur face aux seuils et à la cible", () => {
  it("zones teintées bornées et graduées, barre dans le ton de sa zone, cible étiquetée, valeur et zone écrites", () => {
    const o = pbi.bulletOption(72.5, { unit: "%", digits: 1, target: 90, bands: BANDS, name: "Score qualité" }) as Any;
    const s = o.series[0];
    expect(s.type).toBe("bar");
    expect(s.data[0]).toEqual({ value: 72.5, itemStyle: { color: SEMANTIC.attention } });
    expect(s.barWidth).toBeLessThanOrEqual(24);
    expect(s.itemStyle.borderRadius).toEqual([0, 4, 4, 0]);
    expect(s.markArea.data.map((a: Any) => [a[0].xAxis, a[1].xAxis, a[0].itemStyle.color])).toEqual([
      [0, 60, SEMANTIC.defavorable],
      [60, 80, SEMANTIC.attention],
      [80, 100, SEMANTIC.favorable],
    ]);
    expect(s.markLine.data[0].xAxis).toBe(90);
    expect(nb(s.markLine.data[0].label.formatter)).toBe("Cible 90 %");
    expect(s.markLine.data[0].lineStyle.type).toBe("solid");
    expect(o.xAxis).toMatchObject({ min: 0, max: 100, axisLabel: { customValues: [0, 60, 80, 100], showMaxLabel: true } });
    expect(nb(o.yAxis.axisLabel.formatter)).toBe("{v|72,5 %}\n{n|À surveiller}");
    expect(o.yAxis.axisLabel.rich.v.color).toBe(CHART_INK.fg);
    expect(nb(o.tooltip.formatter)).toBe("Score qualité : <strong>72,5 %</strong><br/>À surveiller<br/>Cible : 90 %");
    expect(Array.isArray(o.yAxis)).toBe(false);
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    const shown = localizeOption(o) as Any;
    expect(nb(shown.xAxis.axisLabel.formatter(60))).toBe("60 %");
    expect(shown.tooltip.formatter).toBe(o.tooltip.formatter);
  });

  it("borne haute exclue, valeur hors échelle, valeur absente, barre sans zone", () => {
    const tone = (v: number | null) => (pbi.bulletOption(v, { unit: "%", bands: BANDS }) as Any).series[0].data[0];
    expect(tone(59.9).itemStyle.color).toBe(SEMANTIC.defavorable);
    expect(tone(60).itemStyle.color).toBe(SEMANTIC.attention);
    expect(tone(100).itemStyle.color).toBe(SEMANTIC.favorable);
    const over = pbi.bulletOption(130, { unit: "%", bands: BANDS }) as Any;
    expect(over.xAxis.max).toBeGreaterThanOrEqual(130);
    expect(over.series[0].markArea.data[2][1].xAxis).toBe(over.xAxis.max);
    const none = pbi.bulletOption(null, { unit: "%", bands: BANDS, target: 90 }) as Any;
    expect(none.series[0].data[0].value).toBeNull();
    expect(none.yAxis.axisLabel.formatter).toBe("{v|—}\n{n|Non évalué}");
    const plain = pbi.bulletOption(34, { unit: "jours", target: { value: 30, label: "Objectif" } }) as Any;
    expect(plain.series[0].data[0].itemStyle.color).toBe(SEMANTIC.neutre);
    expect(plain.series[0].markArea.data).toHaveLength(1);
    expect(plain.xAxis.max).toBe(50);
    expect(nb(plain.series[0].markLine.data[0].label.formatter)).toBe("Objectif 30 jours");
    expect(plain.yAxis.axisLabel.formatter).toBe("{v|34}");
    expect((pbi.bulletOption(0.8, { unit: "%" }) as Any).xAxis.max).toBe(100);
  });

  it("bulletChart : hauteur, résumé et tableau « Voir les données »", () => {
    const spec = pbi.bulletChart({ value: 72.5, measure: "Score qualité", unit: "%", target: 90, bands: BANDS });
    expect(spec.height).toBe(76);
    expect(pbi.bulletChart({ value: 1, measure: "x" }).height).toBe(58);
    expect(nb(spec.ariaLabel)).toBe("Barre de niveau : Score qualité (%). Valeur : 72,5 % (À surveiller). Cible : 90 %. Zones : Critique, moins de 60 % ; À surveiller, de 60 % à 80 % ; Bon, 80 % et plus.");
    expect(spec.table.rows.map((r) => r.map(nb))).toEqual([
      ["Valeur", "72,5 %"],
      ["Cible", "90 %"],
      ["Critique", "moins de 60 %"],
      ["À surveiller", "de 60 % à 80 %"],
      ["Bon", "80 % et plus"],
    ]);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    expect(nb(pbi.bulletChart({ value: null, measure: "Score qualité", unit: "%" }).ariaLabel)).toContain("Valeur : Non évalué.");
  });
});

describe("gaugeOption (compatibilité)", () => {
  it("bande fine, encres en jetons, valeur avec unité, statut écrit ; sans valeur : ni aiguille ni zéro", () => {
    const o = pbi.gaugeOption(72, { warn: 80, crit: 60, higherIsBetter: true, unit: "%" }) as Any;
    const s = o.series[0];
    expect(s.axisLine.lineStyle.width).toBeLessThanOrEqual(12);
    expect(s.axisLine.lineStyle.color).toEqual([[0.6, SEMANTIC.defavorable], [0.8, SEMANTIC.attention], [1, SEMANTIC.favorable]]);
    expect(s.pointer.itemStyle.color).toBe(CHART_INK.ink);
    expect(s.detail.color).toBe(CHART_INK.fg);
    expect(nb(s.detail.formatter)).toBe("{value} %");
    expect(s.data[0]).toEqual({ value: 72, name: "À surveiller" });
    expect((pbi.gaugeOption(3, { warn: 4, crit: 6, max: 10 }) as Any).series[0].data[0].name).toBe("Bon");
    const none = pbi.gaugeOption(null, { warn: 80, crit: 60, higherIsBetter: true }) as Any;
    expect(none.series[0].pointer.show).toBe(false);
    expect(none.series[0].detail.formatter).toBe("—");
    expect(none.series[0].data[0].name).toBe("Non évalué");
  });
});

describe("KpiCard", () => {
  it("hauteur homogène, nombre héros en chiffres tabulaires, tendance et lien calés en pied", () => {
    const m = html(h(pbi.KpiCard, { label: "Turnover glissant", value: "10,9", unit: "%", spark: [10, 10.4, 10.9], sparkLabel: "10,9 % en août", detailHref: "/retention" }));
    expect(m).toMatch(/^<div class="flex h-full flex-col /);
    expect(m).toMatch(/<p class="[^"]*tabular-nums[^"]*text-heading[^"]*"><span>10,9<\/span><span[^>]*>%<\/span><\/p>/);
    expect(m).toMatch(/<div class="mt-auto pt-2"><div class="flex items-end gap-2"><div class="min-w-0 flex-1" aria-hidden="true">/);
    expect(m).toMatch(/role="img" aria-label="Tendance : Turnover glissant"/);
    expect(text(m)).toContain("10,9 % en août Voir le détail");
    expect(m).toMatch(/<a href="\/retention"[^>]*>Voir le détail/);
  });

  it("état « non évalué » : tiret, mention, ni unité, ni variation, ni tendance ; le motif passe dans la bulle « ? »", () => {
    const m = html(h(pbi.KpiCard, { label: "Collaborateurs en risque élevé", value: null, unit: "%", delta: { value: 1, label: "+1", good: "down" }, spark: [1, 2], hint: "Aucun calcul de risque publié" }));
    expect(visible(m)).toBe("Collaborateurs en risque élevé — Non évalué");
    expect(bubbles(m)).toEqual(["Collaborateurs en risque élevé : Aucun calcul de risque publié"]);
    expect(m).toMatch(/<span aria-hidden="true" class="text-fg-subtle">—<\/span>/);
    expect(m).not.toContain("Tendance");
    expect(text(html(h(pbi.KpiCard, { label: "Sorties", value: null, emptyLabel: "Masqué" })))).toBe("Sorties — Masqué");
    // Tiret passé par la page : rendu inchangé (pas de mention ajoutée), unité retirée
    const dash = html(h(pbi.KpiCard, { label: "Score", value: "—", unit: "%", hint: "Aucun import terminé" }));
    expect(visible(dash)).toBe("Score —");
    expect(dash).not.toMatch(/<span aria-hidden="true" class="text-fg-subtle">—/);
  });

  it("titres seuls : libellé, valeur et variation visibles ; période et aide dans une seule bulle, ajoutées à la définition fournie", () => {
    const delta = { value: -0.4, label: "−0,4 pt", reference: "vs juillet", good: "down" };
    const own = html(h(pbi.KpiCard, { label: "Turnover glissant", value: "10,9", unit: "%", delta, period: "12 derniers mois", hint: "Démissions et abandons de poste" }));
    expect(visible(own)).toBe("Turnover glissant 10,9 % ▼ En baisse : −0,4 pt vs juillet favorable");
    expect(own.match(/<button/g)).toHaveLength(1);
    expect(text(own)).toContain("Détails : Turnover glissant");
    expect(bubbles(own)).toEqual(["Turnover glissant : 12 derniers mois Démissions et abandons de poste"]);
    expect(own).toMatch(/<div class="flex h-full flex-col [^"]*pr-10/);
    const tip = h(InfoTip, { label: "Turnover", align: "end" }, "Sorties sur 12 mois.");
    const merged = html(h(pbi.KpiCard, { label: "Turnover glissant", value: "10,9", period: "12 derniers mois", href: "/retention", tip }));
    expect(merged.match(/<button/g)).toHaveLength(1);
    expect(text(merged)).toContain("Définition : Turnover");
    expect(bubbles(merged)).toEqual(["Turnover : Sorties sur 12 mois. 12 derniers mois"]);
    expect(merged).toMatch(/<\/a><span class="absolute right-2 top-2\.5">/);
    expect(merged).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
  });

  it("ton de tuile : cadre et valeur dans le ton, sans changer la bordure au survol ; couleur de la mini-courbe", () => {
    const m = html(h(pbi.KpiCard, { label: "Échecs", value: "12", tone: "critique", status: { tone: "critique", label: "Critique" }, href: "/admin/audit" }));
    expect(m).toMatch(/<a href="\/admin\/audit" class="[^"]*border-danger! ring-1 ring-inset ring-danger[^"]*"/);
    expect(m).not.toContain("hover:border-primary/50");
    expect(m).toMatch(/<p class="[^"]*text-danger[^"]*"><span>12<\/span>/);
    expect(text(m)).toContain("Critique");
    expect(html(h(pbi.KpiCard, { label: "x", value: "1", tone: "attention" }))).toContain("border-warning!");
    const calm = html(h(pbi.KpiCard, { label: "x", value: "1", tone: "bon", href: "/x" }));
    expect(calm).toContain("hover:border-primary/50");
    expect(calm).toContain("text-heading");
  });

  it("DeltaLine lisible sans la couleur : flèche, sens écrit, écart signé, jugement en toutes lettres dans une pastille à bordure", () => {
    const up = html(h(pbi.DeltaLine, { delta: { value: 0.4, label: "+0,4 pt", reference: "vs sept. 2025", good: "down" } }));
    expect(text(up)).toBe("▲ En hausse : +0,4 pt vs sept. 2025 à surveiller");
    expect(up).toMatch(/<span class="rounded-full border [^"]*border-danger\/30[^"]*">à surveiller<\/span>/);
    expect(text(html(h(pbi.DeltaLine, { delta: { value: -2, label: "−2", good: "down" } })))).toBe("▼ En baisse : −2 favorable");
    expect(text(html(h(pbi.DeltaLine, { delta: { value: 0, label: "0", good: "up" } })))).toBe("▬ Stable : 0 stable");
    expect(text(html(h(pbi.DeltaLine, { delta: { value: 3, label: "+3", good: "neutral" } })))).toBe("▲ En hausse : +3");
  });
});

describe("IconArray", () => {
  it("cases pleines en variable de thème, cases vides en jetons, aucune couleur fixe", () => {
    const m = html(h(pbi.IconArray, { segments: [{ n: 2, tone: "defavorable" }, { n: 1, color: CHART_PALETTE[1] }], total: 10, label: "Sur 10 collaborateurs, 3 partis" }));
    expect(m).toContain('role="img" aria-label="Sur 10 collaborateurs, 3 partis"');
    expect((m.match(/<span /g) ?? []).length).toBe(10);
    expect((m.match(/background:var\(--pa-chart-b91c1c, #b91c1c\)/g) ?? []).length).toBe(2);
    expect(m).toContain(`background:var(--pa-chart-${CHART_PALETTE[1].slice(1)}, ${CHART_PALETTE[1]})`);
    expect((m.match(/border border-line bg-surface-3/g) ?? []).length).toBe(7);
    expect(m).not.toMatch(/#e2e8f0|bg-white|slate-/);
  });
});

describe("ChartData et VisualCard", () => {
  const table = { headers: ["Département", "Effectif", "Niveau"], rows: [["Production", "1 204", "Élevé"], ["Qualité", "—", "Non évalué"]], hrefs: ["/employees?departement=3", undefined] };

  it("en-têtes de colonne, nombres à droite, texte à gauche, lien de ligne, rien à l'impression quand il est replié", () => {
    const m = html(h(pbi.ChartData, { caption: "Effectif par département", table }));
    expect(m).toMatch(/<details class="[^"]*print:\[&amp;:not\(\[open\]\)\]:hidden[^"]*"/);
    expect(m).toMatch(/<th scope="col" class="[^"]*text-right[^"]*">Effectif<\/th>/);
    expect(m).toMatch(/<th scope="col" class="(?![^"]*text-right)[^"]*">Niveau<\/th>/);
    expect(m).toMatch(/<td class="[^"]*text-right tabular-nums[^"]*">1 204<\/td><td class="(?![^"]*text-right)[^"]*">Élevé<\/td>/);
    expect(m).toMatch(/<th scope="row"[^>]*><a href="\/employees\?departement=3"[^>]*>Production<\/a><\/th>/);
    expect(m).toMatch(/<th scope="row"[^>]*>Qualité<\/th><td class="[^"]*text-right[^"]*">—<\/td>/);
    expect(m).not.toMatch(/bg-white|text-slate|#[0-9a-f]{6}/);
  });

  it("VisualCard : actions sous le titre sous 640 px, à droite au-delà", () => {
    const m = html(h(pbi.VisualCard, { title: "Absentéisme mensuel (%)", measure: "Taux d'absence", unit: "%", actions: h("a", { href: "/absenteeism" }, "Analyser l'absentéisme") }));
    expect(m).toMatch(/<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">/);
    expect(m).toMatch(/<div class="flex shrink-0 flex-wrap items-center gap-2 text-\[13px\]"><a href="\/absenteeism">/);
  });

  it("VisualCard titres seuls : titre nommant la section, sous-titre et note dans la bulle « ? » posée hors du titre, tableau conservé", () => {
    const chart = { option: {}, height: 200, ariaLabel: "Barres", table: { headers: ["Département", "Effectif"], rows: [["Production", "12"]] } };
    const m = html(
      h(pbi.VisualCard, { title: "Effectif par département", measure: "Effectif", unit: "collaborateurs", scope: "Toute l'entreprise", period: "août 2026", footnote: "Hors stagiaires.", chart }),
    );
    const id = /<section aria-labelledby="([^"]+)"/.exec(m)?.[1];
    expect(id).toBeTruthy();
    expect(m).toContain(`<h2 id="${id}" class="`);
    expect(m).toMatch(/<h2 [^>]*>Effectif par département<\/h2><span class="relative inline-flex/);
    expect(visible(m)).not.toMatch(/Toute l'entreprise|août 2026|Hors stagiaires/);
    expect(m).not.toMatch(/<p[\s>]/);
    expect(bubbles(m)).toEqual(["Effectif par département : Effectif (collaborateurs) · , Toute l'entreprise · , août 2026 Hors stagiaires."]);
    expect(text(m)).toContain("Détails : Effectif par département");
    expect(m).not.toContain("aria-describedby");
    expect(m).toContain("<details");
    expect(text(m)).toContain("Voir les données");

    const plain = html(h(pbi.VisualCard, { title: "Effectif fin de mois", badge: h("span", null, "Prévision indicative") }, "…"));
    expect(plain).not.toContain("<button");
    expect(plain).toMatch(/<\/h2><\/div><span>Prévision indicative<\/span>/);
    const sub = html(h(pbi.VisualCard, { title: "Turnover (%)", subtitle: "Démissions sur 12 mois", measure: "ignoré", id: "turnover" }, "…"));
    expect(sub).toMatch(/^<section id="turnover" aria-labelledby=/);
    expect(bubbles(sub)).toEqual(["Turnover (%) : Démissions sur 12 mois"]);
  });
});

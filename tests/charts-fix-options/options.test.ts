import { describe, expect, it, vi } from "vitest";
import * as echarts from "echarts";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts et des éléments zrender rendus */
type Any = any;

// Mesure du texte proche du navigateur (même simulation que tests/charts-fix) : posée avant toute mesure. zrender prend la chasse
// de « 国 » pour hauteur de ligne : un idéogramme vaut la taille de police.
const charWidth = (ch: string, size: number) => {
  if (/[⺀-鿿]/.test(ch)) return size;
  if (ch === "…") return size * 0.75;
  const base = ch.normalize("NFD")[0] ?? ch;
  if (/[   ]/.test(base)) return size * 0.27;
  if (/[il'’.,;:!|()│-]/.test(base)) return size * 0.3;
  if (/[mwMW%]/.test(base)) return size * 0.82;
  if (/[A-Z]/.test(base)) return size * 0.62;
  if (/[0-9+−]/.test(base)) return size * 0.55;
  return size * 0.52;
};
echarts.setPlatformAPI({
  measureText: (text: string, font?: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1] ?? 12);
    return { width: [...(text ?? "")].reduce((w, ch) => w + charWidth(ch, size), 0) } as TextMetrics;
  },
});

const { DARK_COLORS, darkOption } = await import("@/components/charts/theme");
const { LIGHT_TOKENS, chartTheme, localizeOption, readChartTokens } = await import("@/components/charts/echart");
const { projectionOption, BAND_EDGE, PROJECTION_COLORS, SERIES } = await import("@/components/ai/workforce/chart-options");
const { factorsChart, FACTOR_LABEL_MARGIN } = await import("@/components/monitoring/model-options");
const { FACTOR_PHRASE, factorAxisLabel } = await import("@/components/monitoring/model-words");
const { retentionChart, MEDIAN_LABEL } = await import("@/components/retention/chart-options");
const { tiersFor } = await import("@/components/org-chart/scale");
const { absenteeismByDepartmentTitle, absenteeismTitle } = await import("@/app/(app)/dashboard/messages");
const pbi = await import("@/components/charts/pbi");

const DARK_SURFACE = "#111a2b";
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Clarté OKLCH (formule d'Ottosson), pour l'écart entre paliers d'une échelle ordonnée
const oklchL = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};

type Rect = { x: number; y: number; width: number; height: number };
type Drawn = { texts: { text: string; rect: Rect }[]; lines: { name: string; points: [number, number][] }[] };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Rendu ECharts côté serveur, tel que le wrapper EChart l'affiche (thème, formats, réglages mobiles sous 640 px)
function draw(option: Any, width: number, height: number, narrow: boolean, format?: Any): Drawn {
  const chart = echarts.init(null, chartTheme(LIGHT_TOKENS, false, narrow) as Any, { renderer: "svg", ssr: true, width, height });
  chart.setOption(localizeOption(option, format, narrow), { notMerge: true });
  chart.renderToSVGString();
  const out: Drawn = { texts: [], lines: [] };
  for (const el of (chart as Any).getZr().storage.getDisplayList(true) as Any[]) {
    if (el.type === "tspan" && el.style?.text) {
      const r = el.getBoundingRect().clone();
      if (el.transform) r.applyTransform(el.transform);
      out.texts.push({ text: String(el.style.text).replace(/\s+/g, " ").trim(), rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
    }
    if (el.type === "ec-polyline" && el.shape?.points) {
      const p = el.shape.points as ArrayLike<number>;
      const t = el.transform as number[] | null;
      const pts: [number, number][] = [];
      for (let i = 0; i + 1 < p.length; i += 2) pts.push(t ? [t[0] * p[i] + t[2] * p[i + 1] + t[4], t[1] * p[i] + t[3] * p[i + 1] + t[5]] : [p[i], p[i + 1]]);
      out.lines.push({ name: String(el.parent?.__ecComponentInfo?.mainType ?? ""), points: pts });
    }
  }
  chart.dispose();
  return out;
}
const textRect = (d: Drawn, text: string) => {
  const found = d.texts.find((t) => t.text === text);
  expect(found, `texte « ${text} » dessiné (${d.texts.map((t) => t.text).join(" | ")})`).toBeDefined();
  return found!.rect;
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Prévisions : le nom de l'axe Y et le libellé « Observé │ Projection » ne se chevauchent plus, à 390 comme à 1440 px
// ---------------------------------------------------------------------------------------------------------------
const months = (from: number, n: number) => Array.from({ length: n }, (_, k) => `${2024 + Math.floor((8 + from + k) / 12)}-${String(((8 + from + k) % 12) + 1).padStart(2, "0")}`);
const OBSERVED = months(0, 24).map((month, k) => ({ month, value: 1070 + Math.round(6 * Math.sin(k / 2)) }));
const PROJECTED = months(24, 12).map((month, k) => ({ month, value: 1068 - k, lower: 1060 - 3 * k, upper: 1075 + 1.2 * k }));
const SEPARATOR = "Observé │ Projection";

describe("prévisions : libellés au-dessus du tracé", () => {
  const cases = [
    { axisName: "Collaborateurs", width: 310, narrow: true },
    { axisName: "Milliers de TND", width: 310, narrow: true },
    { axisName: "Collaborateurs", width: 1080, narrow: false },
    { axisName: "Milliers de TND", width: 520, narrow: false },
  ];

  it("la simulation reproduit le défaut des captures à 390 px (nom d'axe et séparateur sur la même ligne)", () => {
    const o = projectionOption({ observed: OBSERVED, projected: PROJECTED, axisName: "Collaborateurs" }) as Any;
    const before = { ...o, grid: { ...o.grid, top: 28 }, yAxis: { ...o.yAxis, nameGap: 12 } };
    const d = draw(before, 310, 255, true);
    expect(overlap(textRect(d, "Collaborateurs"), textRect(d, SEPARATOR))).toBe(true);
  });

  it.each(cases)("$axisName à $width px : nom d'axe au-dessus du séparateur, sans chevauchement, dans le cadre", ({ axisName, width, narrow }) => {
    const d = draw(projectionOption({ observed: OBSERVED, projected: PROJECTED, axisName }), width, narrow ? 255 : 300, narrow);
    const name = textRect(d, axisName);
    const sep = textRect(d, SEPARATOR);
    expect(overlap(name, sep), `${JSON.stringify(name)} / ${JSON.stringify(sep)}`).toBe(false);
    expect(name.y + name.height).toBeLessThanOrEqual(sep.y);
    expect(name.y).toBeGreaterThanOrEqual(0);
    expect(sep.x).toBeGreaterThanOrEqual(0);
    expect(sep.x + sep.width).toBeLessThanOrEqual(width);
  });

  it("bornes de la fourchette tracées : trait de 1 px en jeton d'axe, ≥ 3:1 sur la surface sombre ; aplat et légende inchangés", () => {
    const o = projectionOption({ observed: OBSERVED, projected: PROJECTED, axisName: "Collaborateurs" }) as Any;
    const edges = o.series.filter((s: Any) => s.stack === "ic");
    expect(edges.map((s: Any) => s.name)).toEqual(["_basse", SERIES.band]);
    for (const s of edges) {
      expect(s.lineStyle).toEqual({ width: 1, color: BAND_EDGE });
      expect(s.silent).toBe(true);
    }
    expect(edges[1].areaStyle.color).toBe(PROJECTION_COLORS.band);
    const dark = darkOption(o) as Any;
    const darkEdge = dark.series.find((s: Any) => s.name === "_basse").lineStyle.color;
    expect(darkEdge).toBe(DARK_COLORS[BAND_EDGE]);
    expect(contrast(darkEdge, DARK_SURFACE)).toBeGreaterThanOrEqual(3);
    // Plus discret que la projection dans les deux thèmes
    expect(contrast(BAND_EDGE, "#ffffff")).toBeLessThan(contrast(PROJECTION_COLORS.projected, "#ffffff"));
    expect(contrast(darkEdge, DARK_SURFACE)).toBeLessThan(contrast(DARK_COLORS[PROJECTION_COLORS.projected], DARK_SURFACE));
    // Séparateur en jeton (plus de couleur écrite en dur)
    expect(Object.keys(DARK_COLORS)).toContain(o.series[0].markLine.lineStyle.color);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 4. DeltaLine : la flèche n'est jamais seule sur sa ligne
// ---------------------------------------------------------------------------------------------------------------
describe("DeltaLine : flèche et écart insécables", () => {
  const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
  const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
  const nowrap = (m: string) => text(/<span class="whitespace-nowrap">((?:<span[^>]*>[^<]*<\/span>)*[^<]*)<\/span>/.exec(m)?.[1] ?? "");

  it.each([
    [{ value: -0.0067, label: "−0,67 pt sur les 4 dernières semaines", reference: "vs les semaines précédentes", good: "down" }, "▼ En baisse : −0,67 pt"],
    [{ value: -0.2, label: "−0,2 pt en août 2026 vs sept. 2025", good: "down" }, "▼ En baisse : −0,2 pt"],
    [{ value: -9, label: "−9 depuis fin sept. 2025", good: "neutral" }, "▼ En baisse : −9"],
    [{ value: -0.6, label: "−0,6 h vs juil. 2026", good: "down" }, "▼ En baisse : −0,6 h"],
    [{ value: 0.4, label: "+0,4 pt", reference: "vs sept. 2025", good: "down" }, "▲ En hausse : +0,4 pt"],
  ] as const)("%o", (delta, head) => {
    const m = html(createElement(pbi.DeltaLine, { delta: delta as Any }));
    expect(nowrap(m)).toBe(head);
    expect(m).toMatch(/<span class="whitespace-nowrap"><span aria-hidden="true"[^>]*>[▲▼]<\/span>/);
    // Lecture inchangée : flèche, sens, écart, suite, référence, jugement
    const full = text(m);
    expect(full.startsWith(head)).toBe(true);
    expect(full).toContain(`${delta.label.replace(/[  ]/g, " ")}${"reference" in delta ? ` ${delta.reference}` : ""}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Facteurs du modèle à 390 px : l'étiquette d'une barre négative ne colle plus au libellé du facteur
// ---------------------------------------------------------------------------------------------------------------
const FACTORS = [
  { name: "compa_ratio", weight: -11.2 },
  { name: "short_episodes_12m", weight: 10.8 },
  { name: "team_exit_rate_6m", weight: 10.6 },
  { name: "bradford_12m", weight: -8.1 },
  { name: "absence_rate_3m", weight: 7.2 },
  { name: "contract_cdd", weight: 6.9 },
  { name: "training_hours_12m", weight: -6.1 },
  { name: "last_eval_score", weight: -4.2 },
].filter((f) => f.name in FACTOR_PHRASE);

function factorGaps(spec: Any, width: number, narrow: boolean) {
  const d = draw(spec.option, width, narrow ? spec.mobileHeight : spec.height, narrow, spec.format);
  const values = d.texts.filter((t) => /^−\d+ %$/.test(t.text));
  expect(values.length).toBeGreaterThan(0);
  const cy = (r: Rect) => r.y + r.height / 2;
  return values.map((v) => {
    // Lignes du libellé de facteur de la même rangée (centre à moins de 16 px), à gauche de l'étiquette de valeur
    const row = d.texts.filter((t) => !/[%)]$/.test(t.text) && Math.abs(cy(t.rect) - cy(v.rect)) < 16 && t.rect.x < v.rect.x);
    expect(row.length, v.text).toBeGreaterThan(0);
    const right = Math.max(...row.map((t) => t.rect.x + t.rect.width));
    return { label: v.text, gap: v.rect.x - right };
  });
}

describe("facteurs du modèle : barres négatives lisibles sur mobile", () => {
  const rows = FACTORS.map((f) => ({ label: FACTOR_PHRASE[f.name as keyof typeof FACTOR_PHRASE], axis: factorAxisLabel(f.name), weight: f.weight }));

  it("au moins 8 px entre l'étiquette « −11 % » et le libellé du facteur, à 324 et 1100 px ; axe symétrique conservé", () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const spec = factorsChart(rows) as Any;
    expect(spec.option.yAxis.axisLabel.margin).toBe(FACTOR_LABEL_MARGIN);
    expect(spec.option.xAxis.min).toBe(-spec.option.xAxis.max);
    expect(spec.option.xAxis.max).toBe(20);
    for (const [width, narrow] of [[324, true], [1100, false]] as const)
      for (const g of factorGaps(spec, width, narrow)) expect(g.gap, `${width} px, ${g.label}`).toBeGreaterThanOrEqual(8);
  });

  it("la simulation reproduit le défaut d'avant (marge de 8 px, axe à 1,35 fois le plus grand poids)", () => {
    const spec = factorsChart(rows.map((r) => (r.weight === -11.2 ? { ...r, weight: -14.6 } : r))) as Any;
    const before = { ...spec, option: { ...spec.option, xAxis: { ...spec.option.xAxis, min: -20, max: 20 }, yAxis: { ...spec.option.yAxis, axisLabel: { ...spec.option.yAxis.axisLabel, margin: 8 } } } };
    const gaps = factorGaps(before, 324, true);
    expect(Math.min(...gaps.map((g) => g.gap))).toBeLessThan(4);
    for (const g of factorGaps(spec, 324, true)) expect(g.gap, g.label).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Rétention : l'étiquette des 50 % n'est plus traversée par la courbe
// ---------------------------------------------------------------------------------------------------------------
function curve(n: number, median: number) {
  const survival = Array.from({ length: n }, (_, m) => Math.round(Math.exp((-m * Math.LN2) / median) * 1000) / 1000);
  return {
    n: 715,
    events: 249,
    stopMonths: n - 1,
    medianMonths: median,
    milestones: [],
    survival,
    lower: survival.map((s) => Math.max(0, s - 0.03)),
    upper: survival.map((s) => Math.min(1, s + 0.03)),
    atRisk: survival.map((s) => Math.round(715 * s)),
  };
}
const segmentHits = (pts: [number, number][], r: Rect) =>
  pts.some((p, k) => {
    const q = pts[k + 1];
    if (!q) return false;
    const box = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), width: Math.abs(q[0] - p[0]) || 0.5, height: Math.abs(q[1] - p[1]) || 0.5 };
    return overlap(box, r);
  });

describe("rétention : repère des 50 %", () => {
  const overall = { name: "Toute l'entreprise", curve: curve(69, 48) };

  it.each([
    [324, 289, true],
    [900, 340, false],
  ] as const)("%i px : aucune courbe ne traverse l'étiquette « 50 % : durée médiane »", (width, height, narrow) => {
    const spec = retentionChart({ overall, groups: [], tableGroups: [], measure: "Part encore présente" }) as Any;
    const d = draw(spec.option, width, height, narrow, spec.format);
    const label = textRect(d, "50 % : durée médiane");
    const curves = d.lines.filter((l) => l.points.length > 10);
    expect(curves.length).toBeGreaterThan(0);
    for (const c of curves) expect(segmentHits(c.points, label)).toBe(false);
  });

  it("la simulation reproduit le défaut d'avant (étiquette en fin de ligne, au-dessus)", () => {
    const spec = retentionChart({ overall, groups: [], tableGroups: [], measure: "Part encore présente" }) as Any;
    const s = spec.option.series.find((x: Any) => x.markLine);
    s.markLine.data[0].label = { ...MEDIAN_LABEL, position: "insideEndTop", backgroundColor: undefined, padding: undefined };
    const d = draw(spec.option, 324, 289, true, spec.format);
    const label = textRect(d, "50 % : durée médiane");
    expect(d.lines.some((c) => c.points.length > 10 && segmentHits(c.points, label))).toBe(true);
  });

  it("fond de surface et marge intérieure, lisibles en clair et en sombre", () => {
    const spec = retentionChart({ overall, groups: [], tableGroups: [], measure: "Part encore présente" }) as Any;
    const light = spec.option.series.find((x: Any) => x.markLine).markLine.data[0].label;
    expect(light).toMatchObject({ position: "insideStartBottom", backgroundColor: "#ffffff", padding: [2, 4] });
    const dark = (darkOption(spec.option) as Any).series.find((x: Any) => x.markLine).markLine.data[0].label;
    expect(dark.backgroundColor).toBe(readChartTokens(true).surface);
    expect(contrast(dark.color, dark.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.color, light.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 9. Tableau de bord : titres d'absentéisme arrondis comme les barres (2 décimales)
// ---------------------------------------------------------------------------------------------------------------
describe("titres d'absentéisme du tableau de bord", () => {
  const nb = (s: string) => s.replace(/[  ]/g, " ");
  // Valeurs des visuels : toPct(r, 2) de dashboard/page.tsx
  const bar = (r: number) => (Math.round(r * 100 * 10 ** 2) / 10 ** 2).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  it("« 0,98 % contre 0,78 % », comme les barres (jamais « 1,0 % contre 0,8 % »)", () => {
    const rows = [
      { name: "Direction logistique", absenteeismRate: 0.009812 },
      { name: "Direction de la production", absenteeismRate: 0.00831 },
    ];
    const title = nb(absenteeismByDepartmentTitle(rows, 0.007804));
    expect(title).toBe("Direction logistique : absentéisme le plus élevé (0,98 % contre 0,78 % en moyenne)");
    expect(title).toContain(`${bar(0.009812)} %`);
    expect(title).toContain(`${bar(0.007804)} %`);
  });

  it("courbe mensuelle : même arrondi, position comparée sur les valeurs affichées", () => {
    expect(nb(absenteeismTitle(0.00649, 0.007804, "août 2026"))).toBe("En août 2026, l'absentéisme (0,65 %) est sous la moyenne de la période");
    expect(nb(absenteeismTitle(0.0078, 0.0080, "août 2026"))).toBe("En août 2026, l'absentéisme (0,78 %) est proche de la moyenne de la période");
    expect(nb(absenteeismTitle(0.0125, 0.0080, "août 2026"))).toBe("En août 2026, l'absentéisme (1,25 %) est au-dessus de la moyenne de la période");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 10. Organigramme : pastilles d'effectif lisibles en sombre
// ---------------------------------------------------------------------------------------------------------------
describe("organigramme : échelle d'effectif en sombre", () => {
  const ref = { absenteeism: null, riskShare: null };

  it("chaque palier ≥ 3:1 sur la surface sombre, contraste croissant, écart de clarté ≥ 0,06 ; clair inchangé", () => {
    const tiers = tiersFor("effectif", ref);
    expect(tiers.map((t) => t.label)).toEqual(["Moins de 10 personnes", "10 à 49 personnes", "50 à 199 personnes", "200 personnes et plus"]);
    expect(tiers.map((t) => t.color.light)).toEqual(["#a9c4e8", "#5b8fcf", "#1e56a3", "#0b3a66"]);
    const dark = tiers.map((t) => t.color.dark);
    for (const c of dark) expect(contrast(c, DARK_SURFACE), c).toBeGreaterThanOrEqual(3);
    for (let k = 1; k < dark.length; k++) {
      expect(contrast(dark[k], DARK_SURFACE)).toBeGreaterThan(contrast(dark[k - 1], DARK_SURFACE));
      expect(oklchL(dark[k]) - oklchL(dark[k - 1]), `${dark[k - 1]} → ${dark[k]}`).toBeGreaterThanOrEqual(0.06);
    }
  });
});

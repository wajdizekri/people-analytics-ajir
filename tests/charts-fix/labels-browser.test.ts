import { describe, expect, it, vi } from "vitest";
import * as echarts from "echarts";
import { createElement, type ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des éléments zrender rendus */
type Any = any;

// Mesure du navigateur simulée (chasses proches de Segoe UI 12 px, « a » = 6,2 px). Le découpage « break » de zrender mesure lettre
// par lettre : une lettre accentuée y compte comme un idéogramme (« 国 », 12 px), et dès qu'une table des chasses ASCII a coûté plus
// de 16 ms à construire (page chargée), les polices suivantes n'en ont plus : chaque lettre y compte comme un « a ». Cohérent avec les
// coupures des captures à 390 px (« Salaire au-dessus / de » : 20 lettres × 6,2 > 112 px, alors que le texte d'un seul tenant tient
// en 107 px). Posée avant toute mesure : les caches de zrender de ce fichier en partent.
const EM: Record<string, number> = {
  a: 0.517, b: 0.58, c: 0.45, d: 0.58, e: 0.53, f: 0.32, g: 0.58, h: 0.56, i: 0.24, j: 0.24, k: 0.47, l: 0.24, m: 0.86,
  n: 0.56, o: 0.58, p: 0.58, q: 0.58, r: 0.34, s: 0.42, t: 0.33, u: 0.56, v: 0.47, w: 0.76, x: 0.47, y: 0.47, z: 0.42,
  " ": 0.27, "'": 0.2, "’": 0.2, "(": 0.3, ")": 0.3, "-": 0.38, ".": 0.25, ",": 0.25, "…": 0.75,
};
const charWidth = (ch: string, size: number) => {
  if (/[⺀-鿿]/.test(ch)) return size;
  const base = ch.normalize("NFD")[0] ?? ch;
  return size * (EM[base] ?? (/[0-9]/.test(base) ? 0.55 : /[A-Z]/.test(base) ? 0.6 : 0.5));
};
const busy = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};
echarts.setPlatformAPI({
  measureText: (text: string, font?: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1] ?? 12);
    const chars = [...(text ?? "")];
    if (chars.length === 1 && text.charCodeAt(0) < 128) busy(0.2);
    return { width: chars.reduce((w, ch) => w + charWidth(ch, size), 0) } as TextMetrics;
  },
});
// Première table des chasses, lente (128 lettres × 0,2 ms) : zrender n'en construit plus aucune ensuite
echarts.format.truncateText("x".repeat(40), 20, "11px amorce", "…");

const { CHART_FONT } = await import("@/components/charts/theme");
const { LIGHT_TOKENS, chartTheme, localizeOption, twoLineLabel } = await import("@/components/charts/echart");
const { barChart, shareChart } = await import("@/components/charts/builders");

// Police des libellés d'axe telle qu'ECharts l'écrit (style et graisse par défaut, famille du thème)
const font = `normal normal 12px ${CHART_FONT}`;
// Libellés longs réels : facteurs de /transparency (model-words.ts), types d'action de /interventions (pilotage/labels.ts),
// familles de facteurs, départements
const LABELS = [
  "Salaire au-dessus de la médiane",
  "Plus de départs dans l'équipe",
  "Contrat CDD (plutôt que CDI)",
  "Plan de formation et de développement",
  "Absences (hors santé)",
  "Carrière et contrat",
  "Formation et évaluation",
  "Revue de la charge de travail",
  "Entretien de rétention",
  "Direction des systèmes d'information et de la transformation numérique",
  "Plus d'heures supplémentaires rémunérées sur les douze derniers mois",
];

// Libellé tel qu'ECharts le dessine sur l'axe mobile (boîte de 112 px, découpage « break », deux lignes de 14 px au plus)
function rendered(text: string) {
  const t = new echarts.graphic.Text({ style: { text, font, width: 112, overflow: "break", lineHeight: 14, height: 28, lineOverflow: "truncate" } });
  t.getBoundingRect();
  return ((t as Any).childrenRef() as Any[]).filter((c) => c.type === "tspan").map((c) => String(c.style.text));
}
const complete = (text: string, lines: string[]) => lines.join(" ").replace(/\s+/g, " ").trim() === text;
const endsCut = (lines: string[]) => lines[lines.length - 1].endsWith("…");

// Découpage d'avant le correctif (mesure d'un seul tenant seulement), pour vérifier que la simulation reproduit le défaut
function oldTwoLineLabel(text: string, width: number) {
  const cut = (s: string) => echarts.format.truncateText(s, width, `12px ${CHART_FONT}`, "…");
  const words = text.trim().split(/\s+/);
  let first = words[0] ?? "";
  let k = 1;
  while (k < words.length && cut(`${first} ${words[k]}`) === `${first} ${words[k]}`) first = `${first} ${words[k++]}`;
  const rest = words.slice(k).join(" ");
  return rest ? `${cut(first)}\n${cut(rest)}` : cut(first);
}

describe("mobile : libellé de catégorie coupé toujours terminé par « … » (mesure du navigateur simulée)", () => {
  it("la simulation reproduit le défaut des captures : l'ancien découpage est recoupé, la 3e ligne disparaît sans « … »", () => {
    const broken = LABELS.filter((l) => {
      const lines = rendered(oldTwoLineLabel(l, 112));
      return !complete(l, lines) && !endsCut(lines);
    });
    expect(broken).toEqual(expect.arrayContaining(["Salaire au-dessus de la médiane", "Plus de départs dans l'équipe", "Contrat CDD (plutôt que CDI)", "Plan de formation et de développement"]));
    expect(rendered(oldTwoLineLabel("Salaire au-dessus de la médiane", 112)).map((l) => l.trim())).toEqual(["Salaire au-dessus", "de"]);
  });

  it("twoLineLabel : ECharts dessine exactement les lignes produites ; texte entier, ou dernière ligne terminée par « … »", () => {
    for (const label of LABELS) {
      for (const width of [108, 112]) {
        const text = twoLineLabel(label, width, font);
        const lines = rendered(text);
        expect(lines, label).toEqual(text.split("\n"));
        expect(lines.length, label).toBeLessThanOrEqual(2);
        if (!complete(label, lines)) expect(endsCut(lines), `${label} → ${lines.join(" / ")}`).toBe(true);
      }
    }
    expect(twoLineLabel("Salaire au-dessus de la médiane", 108, font)).toBe("Salaire au-dessus\nde la médiane");
    expect(twoLineLabel("Plan de formation et de développement", 108, font)).toMatch(/^Plan de formation\n.+…$/);
  });

  it("localizeOption : formateur à 108 px (4 px de marge) dans la boîte de 112 px, police écrite comme celle d'ECharts", () => {
    const o = localizeOption({ yAxis: { type: "category", data: LABELS, axisLabel: { width: 200, overflow: "break", interval: 0 } }, xAxis: { type: "value" }, series: [] }, undefined, true) as Any;
    expect(o.yAxis.axisLabel).toMatchObject({ width: 112, overflow: "break", lineHeight: 14, height: 28, lineOverflow: "truncate", interval: 0 });
    for (const [k, label] of LABELS.entries()) expect(o.yAxis.axisLabel.formatter(label, k)).toBe(twoLineLabel(label, 108, font));
    const bold = localizeOption({ yAxis: { type: "category", axisLabel: { width: 150, fontWeight: 600, fontSize: 13 } }, xAxis: { type: "value" }, series: [] }, undefined, true) as Any;
    expect(bold.yAxis.axisLabel.formatter(LABELS[0], 0)).toBe(twoLineLabel(LABELS[0], 108, `normal 600 13px ${CHART_FONT}`));
  });

  // Lignes de chaque libellé d'axe dessiné (TSpan regroupés par texte parent)
  function axisLabels(option: Any, height: number) {
    const chart = echarts.init(null, chartTheme(LIGHT_TOKENS, false, true) as Any, { renderer: "svg", ssr: true, width: 360, height });
    chart.setOption(localizeOption(option, undefined, true), { notMerge: true });
    const groups = new Map<Any, string[]>();
    for (const el of (chart as Any).getZr().storage.getDisplayList(true) as Any[]) {
      if (el.type !== "tspan" || !el.parent) continue;
      groups.set(el.parent, [...(groups.get(el.parent) ?? []), String(el.style.text)]);
    }
    chart.dispose();
    return [...groups.values()];
  }

  it("rendu à 360 px (barres triées, parts 100 %, facteurs signés) : chaque libellé tient sur deux lignes, coupé avec « … »", () => {
    const bars = barChart({ rows: LABELS.map((name, k) => ({ name, value: 20 - k })), measure: "Poids", unit: "%" });
    const shares = shareChart({ rows: LABELS.slice(6, 10).map((name) => ({ name, values: [1, 3, 4] })), parts: [{ label: "Réalisées" }, { label: "En attente" }, { label: "Rejetées" }], measure: "Statut" });
    // Forme des facteurs de /transparency (monitoring/model-options.ts) : axe de catégories de 200 px en « break »
    const factors = {
      option: {
        grid: { left: 8, right: 24, top: 8, bottom: 20, outerBoundsMode: "same", outerBoundsContain: "all" },
        xAxis: { type: "value", min: -15, max: 15 },
        yAxis: { type: "category", inverse: true, data: LABELS, axisLabel: { width: 200, overflow: "break", interval: 0 } },
        series: [{ type: "bar", barMaxWidth: 16, data: LABELS.map((_, k) => (k % 2 ? -1 : 1) * (11 - k)) }],
      },
      height: 72 + LABELS.length * 46,
    };
    for (const [spec, names] of [
      [bars, LABELS],
      [shares, LABELS.slice(6, 10)],
      [factors, LABELS],
    ] as const) {
      const drawn = axisLabels(spec.option, ("mobileHeight" in spec ? spec.mobileHeight : undefined) ?? spec.height);
      for (const label of names) {
        const lines = drawn.find((l) => label.startsWith(l[0].replace(/…$/, "")));
        expect(lines, label).toBeDefined();
        expect(lines!.length, label).toBeLessThanOrEqual(2);
        if (!complete(label, lines!)) expect(endsCut(lines!), `${label} → ${lines!.join(" / ")}`).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EChart, chartTheme, localizeOption, readChartTokens } from "@/components/charts/echart";
import type { ChartSpec } from "@/components/charts/builders";
import { DARK_COLORS, SEMANTIC, darkOption } from "@/components/charts/theme";
import { AUTH_SERIES, JOB_PARTS, authDailyChart, formatDuration, jobsChart, refusalsChart, roleCounts } from "@/components/monitoring/admin-options";
import type { AdminMonitoringDTO, DailyActivity, JobStats } from "@/lib/dal/monitoring";

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;

const DAY = 86_400_000;
const nb = (s: string) => s.replace(/[  ]/g, " ");

// Activité concentrée sur les derniers jours, comme sur la base de démonstration ; tous les jours précédents sont sans activité
function dailySeries(tail: { logins: number[]; failed: number[]; refusals?: number[] }, days = 30, to = "2026-10-02"): DailyActivity[] {
  const end = Date.parse(`${to}T00:00:00Z`);
  const offset = days - tail.logins.length;
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * DAY).toISOString().slice(0, 10),
    logins: tail.logins[i - offset] ?? 0,
    failedLogins: tail.failed[i - offset] ?? 0,
    refusals: tail.refusals?.[i - offset] ?? 0,
  }));
}

// DTO de la capture du 02/10/2026 : 232 connexions réussies, 21 échecs, 21 refus, aucun traitement
const dto: AdminMonitoringDTO = {
  days: 30,
  from: "2026-09-03",
  to: "2026-10-02",
  daily: dailySeries({ logins: [31, 38, 112, 51], failed: [2, 4, 10, 5], refusals: [0, 2, 19, 0] }),
  week: { logins: { current: 232, previous: 0 }, failedLogins: { current: 21, previous: 0 }, refusals: { current: 21, previous: 0 } },
  refusalsByAction: [
    { action: "access.page", count: 17 },
    { action: "employee.view", count: 4 },
  ],
  jobs: [],
};

const jobs: JobStats[] = [
  { type: "IMPORT", counts: { EN_FILE: 0, EN_COURS: 0, TERMINE: 4, ECHEC: 1 }, total: 5, avgDurationSeconds: 62.4 },
  { type: "SCORING", counts: { EN_FILE: 1, EN_COURS: 1, TERMINE: 3, ECHEC: 0 }, total: 5, avgDurationSeconds: 8.2 },
  { type: "BATCH_MENSUEL", counts: { EN_FILE: 0, EN_COURS: 0, TERMINE: 1, ECHEC: 0 }, total: 1, avgDurationSeconds: null },
];

const specs = (): [string, ChartSpec][] => [
  ["connexions", authDailyChart(dto.daily)],
  ["traitements", jobsChart(jobs)],
  ["refus", refusalsChart(dto.refusalsByAction)],
];

const COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\(.+\)|hsla?\(.+\))$/i;
function colorsOf(node: unknown, out = new Set<string>()): Set<string> {
  if (typeof node === "string") {
    if (COLOR.test(node)) out.add(node.toLowerCase());
  } else if (Array.isArray(node)) node.forEach((v) => colorsOf(v, out));
  else if (node && typeof node === "object") Object.values(node).forEach((v) => colorsOf(v, out));
  return out;
}

// Même chaîne que le composant EChart : thème, remappage sombre, formats français ; rendu SVG sans navigateur
function draw(spec: ChartSpec, { dark = false, narrow = false, width = 720 } = {}): string {
  const chart = echarts.init(null, chartTheme(readChartTokens(dark), dark), { renderer: "svg", ssr: true, width, height: spec.height });
  chart.setOption(localizeOption(dark ? darkOption(spec.option) : spec.option, spec.format, narrow), { notMerge: true });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

describe("connexions par jour", () => {
  const spec = authDailyChart(dto.daily);
  const o = spec.option as Any;
  const line = (name: string) => o.series.find((s: Any) => s.name === name);

  it("deux séries non vides, un point par jour, jours sans activité à 0", () => {
    expect(o.xAxis.data).toHaveLength(30);
    expect(o.xAxis.data[0]).toBe("03/09");
    expect(o.xAxis.data[29]).toBe("02/10");
    for (const [name, total] of [[AUTH_SERIES.logins, 232], [AUTH_SERIES.failed, 21]] as const) {
      const data: unknown[] = line(name).data;
      expect(data, name).toHaveLength(30);
      expect(data.every((v) => typeof v === "number"), name).toBe(true);
      expect(data.slice(0, 26), name).toEqual(Array(26).fill(0));
      expect((data as number[]).reduce((a, b) => a + b, 0), name).toBe(total);
    }
    expect(o.legend.data).toEqual([AUTH_SERIES.logins, AUTH_SERIES.failed]);
    expect(o.yAxis).toMatchObject({ min: 0, minInterval: 1, name: "Connexions par jour" });
  });

  it("réussites en neutre, échecs en défavorable, maximum de chaque série étiqueté (et lui seul)", () => {
    expect(line(AUTH_SERIES.logins).itemStyle.color).toBe(SEMANTIC.neutre);
    expect(line(AUTH_SERIES.failed).itemStyle.color).toBe(SEMANTIC.defavorable);
    expect(line(AUTH_SERIES.logins).markPoint.data).toEqual([{ name: "Maximum", coord: [28, 112] }]);
    expect(line(AUTH_SERIES.logins).markPoint.label.formatter).toBe("112");
    expect(line(AUTH_SERIES.failed).markPoint.data).toEqual([{ name: "Maximum", coord: [28, 10] }]);
    for (const s of o.series) expect(s.label?.show ?? false, s.name).toBe(false);
  });

  it("deux maximums voisins de même hauteur : une seule étiquette ; aucune activité : aucune étiquette, séries à 0", () => {
    const close = authDailyChart(dailySeries({ logins: [3, 6], failed: [1, 6] })).option as Any;
    expect(close.series.find((s: Any) => s.name === AUTH_SERIES.logins).markPoint.data[0].coord).toEqual([29, 6]);
    expect(close.series.find((s: Any) => s.name === AUTH_SERIES.failed).markPoint).toBeUndefined();

    const idle = authDailyChart(dailySeries({ logins: [], failed: [] }));
    for (const s of (idle.option as Any).series) {
      expect(s.data).toEqual(Array(30).fill(0));
      expect(s.markPoint).toBeUndefined();
    }
    expect(nb(idle.ariaLabel)).toBe("Courbes par jour du 03/09/2026 au 02/10/2026 : 0 connexion réussie et 0 échec de connexion.");
  });

  it("résumé et tableau : totaux, jour du maximum, une ligne par jour avec les refus", () => {
    expect(nb(spec.ariaLabel)).toBe(
      "Courbes par jour du 03/09/2026 au 02/10/2026 : 232 connexions réussies et 21 échecs de connexion. Maximum : 112 connexions réussies le 01/10/2026.",
    );
    expect(spec.table.headers).toEqual(["Jour", "Connexions réussies", "Échecs de connexion", "Refus d'accès"]);
    expect(spec.table.rows).toHaveLength(30);
    expect(spec.table.rows[0]).toEqual(["03/09/2026", "0", "0", "0"]);
    expect(spec.table.rows[28]).toEqual(["01/10/2026", "112", "10", "19"]);
  });
});

describe("traitements par type et statut", () => {
  it("barres empilées en trois parts sans vert, écart de surface entre segments, total en bout de barre", () => {
    const o = jobsChart(jobs).option as Any;
    expect(o.yAxis.data).toEqual(["Import", "Calcul des risques", "Calcul mensuel"]);
    const parts = o.series.filter((s: Any) => s.name !== "Total");
    expect(parts.map((s: Any) => s.name)).toEqual(["Terminé", "En file ou en cours", "Échec"]);
    expect(parts.map((s: Any) => s.itemStyle.color)).toEqual([SEMANTIC.neutre, SEMANTIC.attention, SEMANTIC.defavorable]);
    expect(JOB_PARTS.map((p) => p.tone)).not.toContain("favorable");
    expect(parts.map((s: Any) => s.data.map((d: Any) => d.value))).toEqual([
      [4, 3, 1],
      [0, 2, 0],
      [1, 0, 0],
    ]);
    for (const s of parts) {
      expect(s.stack, s.name).toBe("total");
      expect(s.itemStyle, s.name).toMatchObject({ borderColor: "#ffffff", borderWidth: 1 });
    }
    expect(o.series.find((s: Any) => s.name === "Total").data.map((d: Any) => d.labelText)).toEqual(["5", "5", "1"]);
  });

  it("tableau : les quatre statuts, le total et la durée moyenne ; résumé avec les échecs", () => {
    const spec = jobsChart(jobs);
    expect(spec.table.headers).toEqual(["Type de traitement", "Terminé", "En cours", "En file", "Échec", "Total", "Durée moyenne (terminés)"]);
    expect(spec.table.rows.map((r) => r.map(nb))).toEqual([
      ["Import", "4", "0", "0", "1", "5", "1 min 02 s"],
      ["Calcul des risques", "3", "1", "1", "0", "5", "8,2 s"],
      ["Calcul mensuel", "1", "0", "0", "0", "1", "—"],
    ]);
    expect(spec.ariaLabel).toContain("Import 5, dont 1 en échec");
    expect(formatDuration(4000)).toBe("1 h 06 min");
  });
});

describe("refus d'accès par action", () => {
  it("barres horizontales triées, 8 lignes au plus, libellés en clair, clic vers le journal filtré", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ action: i === 0 ? "employee.view" : i === 1 ? "access.page" : `action.${i}`, count: i === 1 ? 17 : 8 - i }));
    const spec = refusalsChart(many);
    const o = spec.option as Any;
    expect(o.yAxis.type).toBe("category");
    expect(o.yAxis.data).toHaveLength(8);
    expect(o.yAxis.data[0]).toBe("Ouvrir une page réservée");
    expect(o.yAxis.axisLabel.overflow).toBe("break");
    const values = o.series[0].data.map((d: Any) => d.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(o.series[0].label).toMatchObject({ show: true, position: "right" });
    expect(new Set(o.series[0].data.map((d: Any) => d.itemStyle.color))).toEqual(new Set([SEMANTIC.neutre]));
    expect(o.series[0].data[0].href).toBe("/admin/audit?outcome=REFUSE&action=access.page");
    expect(spec.table.hrefs?.[1]).toBe("/admin/audit?outcome=REFUSE&action=employee.view");
    expect(spec.table.rows.slice(0, 2)).toEqual([
      ["Ouvrir une page réservée", "17"],
      ["Ouvrir la fiche du collaborateur", "8"],
    ]);
  });
});

describe("comptes par rôle : une ligne de chiffres", () => {
  it("du plus nombreux au moins nombreux, accord au singulier", () => {
    expect(roleCounts({ ADMIN: 1, RH: 1, MANAGER: 156 })).toEqual(["156 managers", "1 responsable RH", "1 administrateur"]);
    expect(roleCounts({ ADMIN: 2, RH: 0, MANAGER: 1 })).toEqual(["2 administrateurs", "1 manager", "0 responsable RH"]);
  });
});

describe("thème et rendu des trois visuels", () => {
  it("options sérialisables, aucune couleur fixe hors DARK_COLORS", () => {
    const known = new Set(Object.keys(DARK_COLORS).map((c) => c.toLowerCase()));
    for (const [name, spec] of [...specs(), ["traitements (aucun)", jobsChart([])] as [string, ChartSpec]]) {
      expect(JSON.parse(JSON.stringify(spec)), name).toEqual(spec);
      const colors = [...colorsOf(spec.option)];
      expect(colors.length, name).toBeGreaterThan(0);
      expect(colors.filter((c) => !known.has(c)), name).toEqual([]);
    }
  });

  it("ECharts dessine chaque visuel en clair et en sombre (aucune erreur, séries tracées dans la couleur du thème)", () => {
    const tones: Record<string, (keyof typeof SEMANTIC)[]> = { connexions: ["neutre", "defavorable"], traitements: ["neutre", "attention", "defavorable"], refus: ["neutre"] };
    for (const [name, spec] of specs()) {
      const light = draw(spec);
      const dark = draw(spec, { dark: true });
      expect((light.match(/<path/g) ?? []).length, name).toBeGreaterThan(1);
      for (const tone of tones[name]) {
        expect(light, `${name} clair ${tone}`).toContain(SEMANTIC[tone]);
        expect(dark, `${name} sombre ${tone}`).toContain(DARK_COLORS[SEMANTIC[tone]]);
        expect(dark, `${name} sombre ${tone}`).not.toContain(SEMANTIC[tone]);
      }
      expect(dark, name).not.toContain("#ffffff");
      expect(() => draw(spec, { narrow: true, width: 340 }), name).not.toThrow();
    }
    expect(draw(authDailyChart(dto.daily))).toMatch(/<text[^>]*>112<\/text>/);
  });
});

describe("cartes vides de la capture du 02/10 : un graphique pas encore dessiné", () => {
  it("avant l'hydratation, EChart n'a pas de canevas : son espace réservé est un squelette, jamais un cadre vide", () => {
    const spec = authDailyChart(dto.daily);
    const html = renderToStaticMarkup(createElement(EChart, { option: spec.option, format: spec.format, height: spec.height, ariaLabel: spec.ariaLabel }));
    expect(html).toContain('role="img"');
    expect(html).not.toContain("<canvas");
    const placeholder = html.match(/<div[^>]*style="height:280px"[^>]*>/)?.[0] ?? "";
    expect(placeholder).toMatch(/class="[^"]*\bbg-/);
  });
});

import { describe, expect, it } from "vitest";
import { DARK_COLORS, SEMANTIC } from "@/components/charts/theme";
import {
  JOB_PARTS,
  PARETO_BARS,
  TREND_MIN_IMPORTS,
  controlShares,
  controlsParetoOption,
  driftBarsOption,
  driftZoneScale,
  jobDurationOption,
  jobsByStatusOption,
  observedExpectedOption,
  oeTargetOption,
  qualityMarks,
  qualityScale,
  qualityTrendOption,
  rejectedShareOption,
  rejectionsByRuleOption,
} from "@/components/monitoring/data-options";
import type { ImportPointDTO, JobTypeStatsDTO, RuleRejectionDTO } from "@/lib/dal/data-monitoring";

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;

// Espaces insécables (160) et fines insécables (8239) ramenées à l'espace pour comparer les textes
const nb = (s: string) => s.replace(new RegExp(`[${String.fromCharCode(160, 8239)}]`, "g"), " ");

const imp = (id: number, qualityScore: number | null, status: ImportPointDTO["status"] = "OK", rowsOk = 980, rowsRejected = 20): ImportPointDTO => ({
  id,
  startedAt: `2026-0${id}-28T20:31:00.000Z`,
  status,
  rowsOk,
  rowsRejected,
  qualityScore,
});

const rules: RuleRejectionDTO[] = [
  { rule: "PAIE_INCOMPLETE", label: "Collaborateur actif sans paie du mois", severity: "AVERTISSEMENT", n: 17 },
  { rule: "POINTAGE_DUPLIQUE", label: "Pointage en double", severity: "REJET", n: 7739 },
  { rule: "GRADE_INCONNU", label: "Grade inconnu (grade ignoré)", severity: "CORRECTION", n: 120 },
  { rule: "POINTAGE_SANS_SORTIE", label: "Pointage sans heure de sortie", severity: "AVERTISSEMENT", n: 17085 },
];

const jobs: JobTypeStatsDTO[] = [
  { type: "IMPORT", byStatus: { TERMINE: 4, ECHEC: 1, EN_COURS: 0, EN_FILE: 0 }, total: 5, avgDurationSec: 180 },
  { type: "BATCH_MENSUEL", byStatus: { TERMINE: 3, ECHEC: 0, EN_COURS: 1, EN_FILE: 1 }, total: 5, avgDurationSec: 412 },
];


const thresholds = { moderate: 0.1, strong: 0.25 };
const drift = [
  { label: "Ancienneté (mois)", psi: 0.14, tone: "attention" as const, status: "À surveiller" },
  { label: "Contrat CDD", psi: 0, tone: "bon" as const, status: "Stable" },
  { label: "Mois depuis la dernière augmentation", psi: 4.48, tone: "critique" as const, status: "Dérive forte" },
  { label: "Taux d'absence hors santé (3 mois)", psi: 0.08, tone: "bon" as const, status: "Stable" },
  { label: "Mois depuis la dernière promotion", psi: 0.26, tone: "critique" as const, status: "Dérive forte" },
];

describe("santé des données : Pareto des contrôles", () => {
  it("contrôles triés du plus signalé au moins signalé, couleur selon l'effet, nombre et part au bout de chaque barre", () => {
    const shares = controlShares(rules);
    expect(shares.map((r) => r.rule)).toEqual(["POINTAGE_SANS_SORTIE", "POINTAGE_DUPLIQUE", "GRADE_INCONNU", "PAIE_INCOMPLETE"]);
    expect(shares.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);

    const o = controlsParetoOption(rules) as Any;
    expect(o.yAxis.data).toEqual(["Pointage sans heure de sortie", "Pointage en double", "Grade inconnu (grade ignoré)", "Collaborateur actif sans paie du mois"]);
    expect(o.yAxis.inverse).toBe(true);
    expect(o.xAxis.min).toBe(0);
    const bars = o.series[0].data;
    expect(bars.map((b: Any) => b.value)).toEqual([17085, 7739, 120, 17]);
    expect(bars.map((b: Any) => b.itemStyle.color)).toEqual([SEMANTIC.reference, SEMANTIC.defavorable, SEMANTIC.attention, SEMANTIC.reference]);
    expect(bars.every((b: Any) => b.label.show && b.label.position === "right")).toBe(true);
    expect(nb(bars[0].label.formatter)).toBe("17 085 (68,4 %)");
    expect(nb(bars[1].tip)).toBe("7 739 (31,0 %) · Rejet (ligne écartée)");
    expect(o.series[0].barMaxWidth).toBeLessThanOrEqual(24);
    expect(rejectionsByRuleOption(rules)).toEqual(o);
  });

  it(`au-delà de ${PARETO_BARS} contrôles, les moins signalés sont regroupés en une barre`, () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ rule: `R${i}`, label: `Contrôle ${i + 1}`, severity: "REJET", n: 1000 - i * 60 }));
    const o = controlsParetoOption(many) as Any;
    expect(o.yAxis.data).toHaveLength(PARETO_BARS);
    expect(o.yAxis.data.at(-1)).toBe("5 autres contrôles");
    const bars = o.series[0].data;
    expect(bars.reduce((s: number, b: Any) => s + b.value, 0)).toBe(many.reduce((s, r) => s + r.n, 0));
    expect(bars.at(-1).itemStyle.color).toBe(SEMANTIC.contexte);
  });

  it("contrôle de gravité inconnue : couleur de contexte, sans erreur", () => {
    const o = controlsParetoOption([{ rule: "X", label: "Contrôle ancien", severity: "INFO", n: 3 }]) as Any;
    expect(o.series[0].data[0].itemStyle.color).toBe(SEMANTIC.contexte);
  });
});

describe("santé des données : tendance de la qualité", () => {
  it("un ou deux imports : une barre de niveau par import, face au seuil de blocage, du plus récent au plus ancien", () => {
    expect(TREND_MIN_IMPORTS).toBe(3);
    const one = qualityMarks([imp(1, 0.981)], 0.95);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ id: 1, rejected: 20, read: 1000 });
    // barre de niveau du kit : valeur, seuil nommé et zones de qualityStatus (le format exact des bornes appartient au kit)
    const rows = one[0].spec.table.rows.map((r) => r.map(nb));
    expect(rows.map((r) => r[0])).toEqual(["Valeur", "Seuil de blocage", "Sous le seuil", "Proche du seuil", "Conforme"]);
    expect(rows[0][1]).toBe("98,1 %");
    expect(rows[1][1]).toMatch(/^95(,0)? %$/);
    const axis = (one[0].spec.option as Any).xAxis;
    expect([axis.min, axis.max]).toEqual([90, 100]);
    expect(nb(one[0].spec.ariaLabel)).toContain("Valeur : 98,1 % (Conforme)");

    const two = qualityMarks([imp(1, 0.931, "BLOQUE"), imp(2, 0.981)], 0.95);
    expect(two.map((m) => m.id)).toEqual([2, 1]);
    expect(nb(two[1].spec.ariaLabel)).toContain("Valeur : 93,1 % (Sous le seuil)");
    // même échelle pour les deux barres : les scores se comparent d'un coup d'œil
    expect(two.map((m) => (m.spec.option as Any).xAxis.min)).toEqual([90, 90]);
  });

  it("échelle du score : bornes rondes autour du seuil et de la plus basse valeur", () => {
    expect(qualityScale([0.981], 0.95)).toEqual({ min: 90, max: 100, threshold: 95 });
    expect(qualityScale([0.981, null, 0.86], 0.95)).toEqual({ min: 80, max: 100, threshold: 95 });
    expect(qualityScale([], 0.95)).toEqual({ min: 90, max: 100, threshold: 95 });
  });

  it("à partir de trois imports : courbe bornée de 90 à 100 %, seuil annoté, seul le dernier point étiqueté", () => {
    const o = qualityTrendOption([imp(1, 0.972), imp(2, 0.981), imp(3, 0.943, "BLOQUE")], 0.95) as Any;
    expect([o.yAxis.min, o.yAxis.max, o.yAxis.interval]).toEqual([90, 100, 2]);
    const s = o.series[0];
    expect(s.type).toBe("line");
    expect(s.lineStyle.width).toBe(2);
    expect(s.data.map((d: Any) => d.value)).toEqual([97.2, 98.1, 94.3]);
    expect(s.markLine.data).toEqual([{ yAxis: 95 }]);
    expect(nb(s.markLine.label.formatter)).toBe("Seuil de blocage : 95 %");
    expect(s.data.filter((d: Any) => d.label?.show)).toHaveLength(1);
    expect(nb(s.data[2].label.formatter)).toBe("94,3 %");
    // import sous le seuil : point rouge ; son étiquette et celle du seuil de part et d'autre de la ligne
    expect(s.data[2].itemStyle.color).toBe(SEMANTIC.defavorable);
    expect(s.data[0].itemStyle).toBeUndefined();
    expect([s.data[2].label.position, s.markLine.label.verticalAlign]).toEqual(["bottom", "bottom"]);
    const up = qualityTrendOption([imp(1, 0.943, "BLOQUE"), imp(2, 0.972), imp(3, 0.981)], 0.95) as Any;
    expect([up.series[0].data[2].label.position, up.series[0].markLine.label.verticalAlign]).toEqual(["top", "top"]);
    // import en échec : pas de score, la courbe s'interrompt
    const gap = qualityTrendOption([imp(1, 0.972), imp(2, null, "ECHEC"), imp(3, 0.981)], 0.95) as Any;
    expect(gap.series[0].data[1]).toBeNull();
    expect(gap.series[0].connectNulls).toBe(false);
  });

  it("part des lignes écartées : barres partant de zéro, une valeur par import", () => {
    const o = rejectedShareOption([imp(1, 0.972, "OK", 970, 30), imp(2, 0.981), imp(3, 0.943, "BLOQUE", 900, 100)]) as Any;
    expect(o.yAxis.min).toBe(0);
    expect(o.series[0].type).toBe("bar");
    expect(o.series[0].data).toEqual([3, 2, 10]);
    expect(o.series[0].barMaxWidth).toBeLessThanOrEqual(24);
    expect(o.xAxis.data).toEqual(["28/01\nn° 1", "28/02\nn° 2", "28/03\nn° 3"]);
  });
});

describe("santé des données : traitements", () => {
  it("mêmes couleurs que la console : terminé en neutre, attente et exécution en attention, échec en défavorable", () => {
    expect(JOB_PARTS.map((p) => [p.label, p.color])).toEqual([
      ["Terminé", SEMANTIC.neutre],
      ["En file ou en cours", SEMANTIC.attention],
      ["Échec", SEMANTIC.defavorable],
    ]);
    const o = jobsByStatusOption(jobs) as Any;
    expect(o.series.map((s: Any) => s.name)).toEqual(["Terminé", "En file ou en cours", "Échec"]);
    expect(o.series.map((s: Any) => s.data.map((d: Any) => (typeof d === "number" ? d : d.value)))).toEqual([
      [4, 3],
      [0, 2],
      [1, 0],
    ]);
    expect(o.series.map((s: Any) => s.itemStyle.color)).not.toContain(SEMANTIC.favorable);
  });
});

describe("dérive des données", () => {
  it("échelle en trois zones de même largeur : stable, à surveiller, dérive forte", () => {
    const { top, at } = driftZoneScale(thresholds, 4.48);
    expect(top).toBe(5);
    expect([at(0), at(0.1), at(0.25), at(5)]).toEqual([0, 1, 2, 3]);
    expect(at(0.05)).toBeCloseTo(0.5, 9);
    expect(at(0.175)).toBeCloseTo(1.5, 9);
    expect(at(2.625)).toBeCloseTo(2.5, 9);
    expect(at(12)).toBe(3);
    // sans variable en dérive, la troisième zone garde une étendue lisible
    expect(driftZoneScale(thresholds, 0.04).top).toBe(0.5);
  });

  it("indice par variable : barres triées, couleur du statut, zones de seuil nommées, valeur écrite si la variable a changé", () => {
    const o = driftBarsOption(drift, thresholds) as Any;
    expect(o.yAxis.data).toEqual(["Mois depuis la dernière augmentation", "Mois depuis la dernière promotion", "Ancienneté (mois)", "Taux d'absence hors santé (3 mois)", "Contrat CDD"]);
    expect([o.xAxis.min, o.xAxis.max]).toEqual([0, 3]);
    const s = o.series[0];
    expect(s.data.map((b: Any) => b.itemStyle.color)).toEqual([SEMANTIC.defavorable, SEMANTIC.defavorable, SEMANTIC.attention, SEMANTIC.favorable, SEMANTIC.favorable]);
    // chaque barre s'arrête dans la zone de son statut
    expect(s.data.map((b: Any) => Math.min(2, Math.floor(b.value)))).toEqual([2, 2, 1, 0, 0]);
    expect(s.data.map((b: Any) => b.label.show)).toEqual([true, true, true, false, false]);
    expect(s.data.map((b: Any) => b.label.formatter)).toEqual(["4,48", "0,26", "0,14", "0,08", "0,00"]);
    expect(s.data[2].tip).toBe("Indice 0,14 · À surveiller");
    const zones = s.markArea.data;
    expect(zones.map((z: Any) => z[0].name)).toEqual(["Stable\n< 0,10", "À surveiller\n0,10 à 0,25", "Dérive\n≥ 0,25"]);
    expect(zones.map((z: Any) => [z[0].xAxis, z[1].xAxis])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(zones.map((z: Any) => z[0].itemStyle.color)).toEqual([SEMANTIC.favorable, SEMANTIC.attention, SEMANTIC.defavorable]);
    expect(s.markLine.data).toEqual([{ xAxis: 1 }, { xAxis: 2 }]);
    expect(s.barMaxWidth).toBeLessThanOrEqual(24);
  });

  it("rapport observé / prévu : zone cible nommée, cohortes hors cible repérées, axe borné autour de la zone", () => {
    const o = oeTargetOption(["mai 2025", "juin 2025", "juil. 2025", "août 2025"], [1.1, 1.31, null, 0.7], [0.8, 1.25]) as Any;
    const s = o.series[0];
    expect(s.markArea.data).toEqual([[{ yAxis: 0.8 }, { yAxis: 1.25 }]]);
    expect(s.markArea.label.formatter).toBe("Zone cible\n0,80 à 1,25");
    expect(s.markArea.itemStyle).toEqual({ color: SEMANTIC.favorable, opacity: 0.12 });
    expect(s.markLine.data).toEqual([{ yAxis: 1 }]);
    expect(s.data[0].itemStyle).toBeUndefined();
    expect(s.data[1].itemStyle.color).toBe(SEMANTIC.attention);
    expect(s.data[2]).toBeNull();
    expect(s.data[3].tip).toBe("0,70 · hors de la zone cible");
    expect(s.data.filter((d: Any) => d?.label?.show)).toHaveLength(1);
    expect([o.yAxis.min, o.yAxis.max, o.yAxis.interval]).toEqual([0.5, 1.5, 0.25]);
    const wide = oeTargetOption(["a", "b"], [0.4, 3.2], [0.8, 1.25]) as Any;
    expect([wide.yAxis.min, wide.yAxis.max, wide.yAxis.interval]).toEqual([0, 3.5, 0.5]);
  });

  it("taux observé et prévu (vue RH) : deux séries nommées, taux prévu en gris de référence", () => {
    const o = observedExpectedOption(["mai 2025", "juin 2025"], [0.044, 0.041], [0.038, null], "Taux prévu par le modèle") as Any;
    expect(o.series.map((s: Any) => s.name)).toEqual(["Taux observé", "Taux prévu par le modèle"]);
    expect(o.series[0].data).toEqual([4.4, 4.1]);
    expect(o.series[1].data).toEqual([3.8, null]);
    expect(o.series[1].lineStyle).toMatchObject({ type: "dashed", color: SEMANTIC.reference });
    expect(o.yAxis.min).toBe(0);
  });
});

describe("thème sombre", () => {
  const COLOR = new RegExp("^(#[0-9a-f]{3,8}|rgba?[(]|hsla?[(])", "i");
  function colors(v: unknown, found = new Set<string>()): Set<string> {
    if (typeof v === "string") {
      if (COLOR.test(v)) found.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => colors(x, found));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => colors(x, found));
    return found;
  }

  it("options sérialisables, sans couleur fixe hors de DARK_COLORS (EChart les remplace toutes en sombre)", () => {
    const options: Record<string, unknown> = {
      controlsPareto: controlsParetoOption(rules),
      qualityTrend: qualityTrendOption([imp(1, 0.972), imp(2, 0.981), imp(3, 0.943, "BLOQUE")], 0.95),
      rejectedShare: rejectedShareOption([imp(1, 0.972), imp(2, 0.981), imp(3, 0.943)]),
      qualityMark: qualityMarks([imp(1, 0.981)], 0.95)[0].spec.option,
      jobsByStatus: jobsByStatusOption(jobs),
      jobDuration: jobDurationOption(jobs),
      driftBars: driftBarsOption(drift, thresholds),
      oeTarget: oeTargetOption(["a", "b", "c"], [1.1, 1.31, 0.7], [0.8, 1.25]),
      observedExpected: observedExpectedOption(["a", "b"], [0.04, 0.05], [0.04, 0.04], "Taux prévu par le modèle"),
    };
    for (const [name, option] of Object.entries(options)) {
      expect(JSON.parse(JSON.stringify(option)), name).toEqual(option);
      const unknown = [...colors(option)].filter((c) => !(c.toLowerCase() in DARK_COLORS) && !(c in DARK_COLORS));
      expect(unknown, name).toEqual([]);
    }
  });
});

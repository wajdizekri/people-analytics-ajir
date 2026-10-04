import { describe, expect, it } from "vitest";
import { RiskSet, chi2Survival, gammaQ, kaplanMeier, logRank, medianTime, stopTime, survivalAt, type Subject } from "@/lib/retention/km";
import { DAYS_PER_MONTH, summarizeCurve } from "@/lib/retention/summary";

const subj = (time: number, event: boolean, entry = 0): Subject => ({ entry, time, event });

// Freireich (1963), leucémie, groupe 6-MP : 21 patients, « + » = censuré (exemple de manuel, Kleinbaum & Klein ch. 2)
const SIX_MP: Subject[] = [
  ...[6, 6, 6, 7, 10, 13, 16, 22, 23].map((t) => subj(t, true)),
  ...[6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35].map((t) => subj(t, false)),
];
const PLACEBO: Subject[] = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23].map((t) => subj(t, true));

describe("Kaplan-Meier : exemple de manuel (6-MP)", () => {
  const fit = kaplanMeier(SIX_MP);

  it("marches, effectifs à risque et S(t) calculés à la main", () => {
    expect(fit.n).toBe(21);
    expect(fit.events).toBe(9);
    expect(fit.steps.map((s) => [s.time, s.atRisk, s.events])).toEqual([
      [6, 21, 3],
      [7, 17, 1],
      [10, 15, 1],
      [13, 12, 1],
      [16, 11, 1],
      [22, 7, 1],
      [23, 6, 1],
    ]);
    const expected = [18 / 21, (18 / 21) * (16 / 17), (18 / 21) * (16 / 17) * (14 / 15)];
    expected.push(expected[2] * (11 / 12), expected[2] * (11 / 12) * (10 / 11));
    expected.push(expected[4] * (6 / 7), expected[4] * (6 / 7) * (5 / 6));
    fit.steps.forEach((s, i) => expect(s.survival).toBeCloseTo(expected[i], 12));
    expect(fit.steps.map((s) => Math.round(s.survival * 1000) / 1000)).toEqual([0.857, 0.807, 0.753, 0.69, 0.627, 0.538, 0.448]);
  });

  it("IC de Greenwood en log(-log) : bornes calculées à la main", () => {
    const ref = [
      [0.6197, 0.9516],
      [0.5631, 0.9228],
      [0.5032, 0.8894],
      [0.4316, 0.8491],
      [0.3675, 0.8049],
      [0.2678, 0.7468],
      [0.1881, 0.6801],
    ];
    fit.steps.forEach((s, i) => {
      expect(s.lower).toBeCloseTo(ref[i][0], 4);
      expect(s.upper).toBeCloseTo(ref[i][1], 4);
    });
    // t = 6 à la main : v = 3 / (21 × 18), se = √v / |ln S| ; bornes S^exp(±1,96 se)
    const s6 = 18 / 21;
    const se = Math.sqrt(3 / (21 * 18)) / Math.abs(Math.log(s6));
    expect(fit.steps[0].lower).toBeCloseTo(s6 ** Math.exp(1.959963984540054 * se), 12);
    expect(fit.steps[0].upper).toBeCloseTo(s6 ** Math.exp(-1.959963984540054 * se), 12);
  });

  it("S(t) continue à droite, durée médiane = 23 semaines", () => {
    expect(survivalAt(fit, 5.9).survival).toBe(1);
    expect(survivalAt(fit, 6).survival).toBeCloseTo(18 / 21, 12);
    expect(survivalAt(fit, 21.99).survival).toBeCloseTo(0.6275, 4);
    expect(survivalAt(fit, 100).survival).toBeCloseTo(0.4482, 4);
    expect(medianTime(fit)).toBe(23);
    expect(medianTime(fit, 22)).toBeNull();
    expect(medianTime(kaplanMeier([subj(5, false), subj(8, true), subj(9, false)]))).toBe(8);
    expect(medianTime(kaplanMeier([subj(5, false), subj(8, true), subj(9, false), subj(10, false)]))).toBeNull();
  });
});

describe("Kaplan-Meier : ex-æquo et entrée retardée", () => {
  it("à un même instant, la sortie précède la censure (le censuré reste à risque)", () => {
    const fit = kaplanMeier([subj(2, true), subj(2, false), subj(3, true), subj(4, false)]);
    expect(fit.steps.map((s) => [s.time, s.atRisk, s.events])).toEqual([
      [2, 4, 1],
      [3, 2, 1],
    ]);
    expect(fit.steps[0].survival).toBeCloseTo(3 / 4, 12);
    expect(fit.steps[1].survival).toBeCloseTo(3 / 8, 12);
  });

  it("plusieurs sorties ex-æquo : une seule marche (1 - d/n)", () => {
    const fit = kaplanMeier([subj(5, true), subj(5, true), subj(5, true), subj(9, true), subj(9, true)]);
    expect(fit.steps[0]).toMatchObject({ time: 5, atRisk: 5, events: 3 });
    expect(fit.steps[0].survival).toBeCloseTo(2 / 5, 12);
    expect(fit.steps[1].survival).toBe(0);
    expect(fit.steps[1]).toMatchObject({ lower: 0, upper: 0 });
  });

  it("entrée retardée : un sujet n'est à risque que sur ]entrée, sortie]", () => {
    // A ]0,5] sortie, B ]0,8] censuré, C ]3,6] sortie, D ]4,10] sortie, E ]7,9] censuré
    const data = [subj(5, true), subj(8, false), subj(6, true, 3), subj(10, true, 4), subj(9, false, 7)];
    const fit = kaplanMeier(data);
    expect(fit.steps.map((s) => [s.time, s.atRisk])).toEqual([
      [5, 4],
      [6, 3],
      [10, 1],
    ]);
    expect(fit.steps.map((s) => s.survival)).toEqual([3 / 4, 1 / 2, 0]);
    // Sans tenir compte de l'entrée, E serait compté à risque à t = 5 et 6 : estimation biaisée vers le haut
    const naive = kaplanMeier(data.map((s) => ({ ...s, entry: 0 })));
    expect(naive.steps[0].survival).toBeCloseTo(4 / 5, 12);
    const risk = new RiskSet(data);
    expect([0.5, 3, 3.5, 5, 7.5, 9.5].map((t) => risk.at(t))).toEqual([2, 2, 3, 4, 3, 1]);
  });

  it("sujets sans durée d'exposition (sortie <= entrée) ignorés", () => {
    const fit = kaplanMeier([subj(3, true, 3), subj(2, true, 5), subj(4, true)]);
    expect(fit.n).toBe(1);
    expect(fit.steps).toEqual([expect.objectContaining({ time: 4, atRisk: 1, survival: 0 })]);
  });
});

describe("arrêt de la courbe sous k personnes suivies", () => {
  const data = [subj(5, true), subj(8, false), subj(6, true, 3), subj(10, true, 4), subj(9, false, 7)];

  it("premier instant après lequel l'effectif suivi passe sous k", () => {
    const risk = new RiskSet(data);
    expect(stopTime(risk, 2)).toBe(9);
    // Entrées retardées : 2 personnes seulement suivies au départ, la courbe ne peut pas commencer
    expect(stopTime(risk, 3)).toBe(0);
    expect(stopTime(new RiskSet(SIX_MP), 5)).toBe(25);
    expect(stopTime(new RiskSet([]), 5)).toBe(0);
  });

  it("résumé mensuel : jalons au-delà de l'arrêt non publiés, effectif suivi aux jalons", () => {
    const m = DAYS_PER_MONTH;
    // 6 embauches suivies : sorties à 2 et 7 mois, censures à 13, 13, 30 et 40 mois
    const days = [2, 7, 13, 13, 30, 40].map((x) => Math.round(x * m));
    const curve = summarizeCurve(
      days.map((t, i) => subj(t, i < 2)),
      { minAtRisk: 5, horizonMonths: 40 },
    );
    expect(curve.n).toBe(6);
    expect(curve.events).toBe(2);
    // Après la sortie à 7 mois, 4 personnes restent suivies : courbe arrêtée à 7 mois
    expect(curve.stopMonths).toBeCloseTo(days[1] / m, 9);
    expect(curve.milestones[0]).toMatchObject({ months: 6, atRisk: 5 });
    expect(curve.milestones[0].survival).toBeCloseTo(5 / 6, 12);
    expect(curve.milestones.slice(1).every((x) => x.survival == null && x.atRisk == null)).toBe(true);
    expect(curve.survival[0]).toBe(1);
    expect(curve.atRisk[0]).toBe(6);
    expect(curve.survival[3]).toBeCloseTo(5 / 6, 12);
    expect(curve.survival[7]).toBeNull();
    expect(curve.medianMonths).toBeNull();
  });
});

describe("test du log-rank", () => {
  it("6-MP contre placebo : χ² = 16,79 pour 1 ddl (valeur de manuel)", () => {
    const lr = logRank([SIX_MP, PLACEBO])!;
    expect(lr.df).toBe(1);
    expect(lr.observed).toEqual([9, 21]);
    expect(lr.expected[0]).toBeCloseTo(19.25, 2);
    expect(lr.expected[1]).toBeCloseTo(10.75, 2);
    expect(lr.chi2).toBeCloseTo(16.79, 2);
    expect(lr.pValue).toBeCloseTo(4.17e-5, 6);
  });

  it("k groupes : ddl = k - 1 ; groupes identiques -> χ² nul ; moins de 2 groupes -> null", () => {
    const a = [subj(3, true), subj(5, false), subj(7, true), subj(9, true)];
    const same = logRank([a, a.map((s) => ({ ...s })), a.map((s) => ({ ...s }))])!;
    expect(same.df).toBe(2);
    expect(same.chi2).toBeCloseTo(0, 12);
    expect(same.pValue).toBeCloseTo(1, 12);
    expect(logRank([a, []])).toBeNull();
    expect(logRank([a])).toBeNull();
  });

  it("3 groupes : χ² indépendant de l'ordre des groupes (groupe de référence retiré de la matrice)", () => {
    const g3 = [subj(2, true), subj(4, true), subj(4, false), subj(12, true), subj(15, false)];
    const orders = [
      [SIX_MP, PLACEBO, g3],
      [g3, SIX_MP, PLACEBO],
      [PLACEBO, g3, SIX_MP],
    ];
    const chi = orders.map((o) => logRank(o)!.chi2);
    expect(chi[1]).toBeCloseTo(chi[0], 9);
    expect(chi[2]).toBeCloseTo(chi[0], 9);
    const lr = logRank(orders[0])!;
    expect(lr.df).toBe(2);
    expect(lr.observed.reduce((x, y) => x + y, 0)).toBeCloseTo(lr.expected.reduce((x, y) => x + y, 0), 9);
  });

  it("loi du χ² : quantiles connus et cas exact à 2 ddl", () => {
    expect(chi2Survival(3.841458820694124, 1)).toBeCloseTo(0.05, 10);
    expect(chi2Survival(5.991464547107979, 2)).toBeCloseTo(0.05, 10);
    expect(chi2Survival(7.814727903251178, 3)).toBeCloseTo(0.05, 10);
    expect(chi2Survival(4, 2)).toBeCloseTo(Math.exp(-2), 12);
    expect(chi2Survival(0, 3)).toBe(1);
    expect(gammaQ(1, 30)).toBeCloseTo(Math.exp(-30), 20);
  });
});

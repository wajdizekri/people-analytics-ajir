import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_NAMES, FSV, GROUPS } from "@/lib/features/spec";
import {
  calibratedLogit,
  checkBundle,
  explain,
  featurePhrase,
  goldenMaxDiff,
  managerPhrase,
  meanProfileLogit,
  parseBundle,
  predict,
  predictRaw,
  toLoadedModel,
  toModelOrder,
  type B0Bundle,
  type LogregBundle,
} from "@/lib/scoring/model";

const neutral = () => FEATURES.map((f) => f.impute);
const snap = (over: Record<string, number>) => {
  const v = neutral();
  for (const [k, x] of Object.entries(over)) v[FEATURE_NAMES.indexOf(k)] = x;
  return v;
};

const logreg = (over: Partial<LogregBundle> = {}): LogregBundle => ({
  version: "lr-test",
  kind: "LOGREG",
  fsv: FSV,
  features: ["compa_ratio", "overtime_h_avg_3m"],
  standardization: { mean: [1, 10], std: [0.2, 0] },
  coef: [-2, 0.5],
  intercept: -1,
  ...over,
});

const b0 = (rules: B0Bundle["rules"], features?: string[]): B0Bundle => ({ version: "b0-test", kind: "B0", fsv: FSV, rules, ...(features ? { features } : {}) });

describe("contrôles structurels du bundle", () => {
  it("fsv différente, variable inconnue, règle hors bundle, dimensions incohérentes", () => {
    expect(checkBundle(logreg({ fsv: "v0" }))).toEqual([`fsv du modèle (v0) différente de la fsv courante (${FSV})`]);
    expect(checkBundle(logreg({ features: ["compa_ratio", "age_du_capitaine"] }))).toEqual(["variable inconnue : age_du_capitaine"]);
    expect(checkBundle(logreg({ coef: [1] }))).toEqual(["dimensions incohérentes (features, coef, mean, std)"]);
    expect(checkBundle(logreg({ standardization: { mean: [1, 2], std: [1] } }))).toEqual(["dimensions incohérentes (features, coef, mean, std)"]);
    expect(checkBundle(b0([{ feature: "compa_ratio", op: "<", value: 0.9, points: 2 }], ["tenure_months"]))).toEqual([
      "règle sur une variable absente du bundle : compa_ratio",
    ]);
  });

  it("toLoadedModel refuse un bundle incohérent et positionne les variables dans l'ordre du snapshot", () => {
    expect(() => toLoadedModel(logreg({ fsv: "v0", coef: [1] }), 1)).toThrow(/fsv du modèle.*;.*dimensions incohérentes/);
    const m = toLoadedModel(logreg(), 7);
    expect(m).toMatchObject({ id: 7, version: "lr-test", kind: "LOGREG", fsv: FSV });
    expect(m.idx).toEqual([FEATURE_NAMES.indexOf("compa_ratio"), FEATURE_NAMES.indexOf("overtime_h_avg_3m")]);
    expect(toModelOrder(m, snap({ compa_ratio: 0.8, overtime_h_avg_3m: 30 }))).toEqual([0.8, 30]);
  });

  it("B0 sans liste de variables : variables déduites des règles, sans doublon, dans l'ordre", () => {
    const m = toLoadedModel(
      b0([
        { feature: "overtime_h_avg_3m", op: ">", value: 20, points: 1 },
        { feature: "compa_ratio", op: "<", value: 0.9, points: 2 },
        { feature: "overtime_h_avg_3m", op: ">", value: 40, points: 1 },
      ]),
      null,
    );
    expect(m.idx).toEqual([FEATURE_NAMES.indexOf("overtime_h_avg_3m"), FEATURE_NAMES.indexOf("compa_ratio")]);
  });

  it("schéma : kind inconnu et règle à opérateur inconnu refusés", () => {
    expect(() => parseBundle({ version: "x", kind: "LGBM", fsv: "v1" })).toThrow(/Bundle invalide/);
    expect(() => parseBundle({ version: "x", kind: "B0", fsv: "v1", rules: [{ feature: "compa_ratio", op: "!=", value: 1, points: 1 }] })).toThrow(
      /rules\.0\.op/,
    );
    expect(() => parseBundle({ version: "x", kind: "B0", fsv: "v1", rules: [] })).toThrow(/Bundle invalide/);
  });
});

describe("prédiction LOGREG", () => {
  it("écart-type nul traité comme 1, calibration absente = identité, formule exacte", () => {
    const m = toLoadedModel(logreg(), null);
    const x = [0.8, 14];
    const logit = -1 + -2 * ((0.8 - 1) / 0.2) + 0.5 * (14 - 10);
    expect(predictRaw(m, x)).toBeCloseTo(1 / (1 + Math.exp(-logit)), 15);
    expect(calibratedLogit(m, snap({ compa_ratio: 0.8, overtime_h_avg_3m: 14 }))).toBeCloseTo(logit, 12);
    expect(meanProfileLogit(m)).toBe(-1);
  });

  it("calibration de Platt appliquée au logit ; sigmoïde stable aux extrêmes", () => {
    const m = toLoadedModel(logreg({ calibration: { method: "platt", a: 0.5, b: 0.25 } }), null);
    const logit = -1 + -2 * ((0.8 - 1) / 0.2);
    expect(predictRaw(m, [0.8, 10])).toBeCloseTo(1 / (1 + Math.exp(-(0.5 * logit + 0.25))), 15);
    expect(meanProfileLogit(m)).toBe(0.5 * -1 + 0.25);
    const extreme = toLoadedModel(logreg({ intercept: 0, coef: [1000, 0] }), null);
    const low = predictRaw(extreme, [-10, 0]);
    const high = predictRaw(extreme, [10, 0]);
    expect(Number.isFinite(low) && low >= 0 && low < 1e-300).toBe(true);
    expect(high).toBe(1);
  });

  it("logit indisponible pour un score à règles", () => {
    const m = toLoadedModel(b0([{ feature: "compa_ratio", op: "<", value: 0.9, points: 2 }]), null);
    expect(() => calibratedLogit(m, neutral())).toThrow(/score à règles/);
    expect(() => meanProfileLogit(m)).toThrow(/score à règles/);
  });
});

describe("score à règles B0", () => {
  const rules: B0Bundle["rules"] = [
    { feature: "late_count_3m", op: "<=", value: 1, points: 1 },
    { feature: "contract_cdd", op: "==", value: 1, points: 3 },
    { feature: "team_size", op: ">=", value: 10, points: 2 },
    { feature: "compa_ratio", op: "<", value: 0.9, points: 5 },
    { feature: "overtime_h_avg_3m", op: ">", value: 20, points: 7 },
  ];
  const m = toLoadedModel(b0(rules), null);

  it("chaque opérateur, bornes incluses ou exclues", () => {
    expect(predict(m, snap({ late_count_3m: 1, contract_cdd: 0, team_size: 9, compa_ratio: 0.9, overtime_h_avg_3m: 20 }))).toBe(1);
    expect(predict(m, snap({ late_count_3m: 2, contract_cdd: 1, team_size: 10, compa_ratio: 0.89, overtime_h_avg_3m: 20.5 }))).toBe(3 + 2 + 5 + 7);
    expect(predict(m, snap({ late_count_3m: 2, contract_cdd: 0.5, team_size: 0, compa_ratio: 1, overtime_h_avg_3m: 0 }))).toBe(0);
  });

  it("explication : règles déclenchées seulement, points cumulés par variable, ex-æquo départagés par l'ordre des groupes", () => {
    const bm = toLoadedModel(
      b0([
        { feature: "overtime_h_avg_3m", op: ">", value: 20, points: 1 },
        { feature: "overtime_h_avg_3m", op: ">", value: 40, points: 1 },
        { feature: "compa_ratio", op: "<", value: 0.9, points: 3 },
        { feature: "months_since_promotion", op: ">", value: 48, points: 2 },
        { feature: "absence_rate_3m", op: ">", value: 0.04, points: 2 },
        { feature: "team_size", op: ">", value: 100, points: 9 },
      ]),
      null,
    );
    const g = explain(bm, snap({ overtime_h_avg_3m: 45, compa_ratio: 0.8, months_since_promotion: 60, absence_rate_3m: 0.05 }));
    expect(g.map((x) => [x.group, x.contribution])).toEqual([
      ["REMUNERATION", 3],
      ["CARRIERE", 2],
      ["TEMPS_TRAVAIL", 2],
      ["ABSENCES", 2],
    ]);
    const tt = g.find((x) => x.group === "TEMPS_TRAVAIL")!;
    expect(tt.features).toEqual([{ feature: "overtime_h_avg_3m", value: 45, contribution: 2 }]);
    expect(tt.rules).toHaveLength(2);
    expect(tt.phraseRh).toBe("45 h supplémentaires par mois en moyenne");
    expect(tt.phraseManager).toBe(GROUPS.TEMPS_TRAVAIL.label_manager);
    expect(g.every((x) => x.direction === "HAUSSE")).toBe(true);
    expect(explain(bm, neutral())).toEqual([]);
  });
});

describe("golden et explication LOGREG", () => {
  const m = toLoadedModel(logreg(), null);

  it("goldenMaxDiff : lignes au format du modèle ou du snapshot ; dimension inconnue ou p non numérique = Infinity", () => {
    const x = [0.8, 14];
    const p = predictRaw(m, x);
    expect(goldenMaxDiff(m, [{ x, p }])).toBeLessThan(1e-15);
    expect(goldenMaxDiff(m, [{ x: snap({ compa_ratio: 0.8, overtime_h_avg_3m: 14 }), p: p + 1e-6 }])).toBeCloseTo(1e-6, 12);
    expect(goldenMaxDiff(m, [{ x: [1, 2, 3], p: 0.5 }])).toBe(Infinity);
    expect(goldenMaxDiff(m, [{ x, p: Number.NaN }])).toBe(Infinity);
    expect(goldenMaxDiff(m, [])).toBe(0);
  });

  it("profil moyen : contributions nulles, pas de variable principale, phrase RH = libellé du groupe", () => {
    const g = explain(m, snap({ compa_ratio: 1, overtime_h_avg_3m: 10 }));
    expect(g.map((x) => x.group)).toEqual(["REMUNERATION", "TEMPS_TRAVAIL"]);
    for (const x of g) {
      expect(x.contribution).toBe(0);
      expect(x.topFeature).toBeNull();
      expect(x.topFeatureValue).toBeNull();
      expect(x.phraseRh).toBe(GROUPS[x.group].label_rh);
      expect(x.rules).toBeUndefined();
    }
  });

  it("contribution d'un groupe = a × coef × z, sens et variable principale", () => {
    const cm = toLoadedModel(logreg({ calibration: { method: "platt", a: 2, b: 0 } }), null);
    const g = explain(cm, snap({ compa_ratio: 0.6, overtime_h_avg_3m: 8 }));
    const rem = g.find((x) => x.group === "REMUNERATION")!;
    const tt = g.find((x) => x.group === "TEMPS_TRAVAIL")!;
    expect(rem.contribution).toBeCloseTo(2 * -2 * ((0.6 - 1) / 0.2), 12);
    expect(rem).toMatchObject({ direction: "HAUSSE", topFeature: "compa_ratio", topFeatureValue: 0.6, phraseRh: "Salaire à 60 % de la médiane du poste" });
    expect(tt.contribution).toBeCloseTo(2 * 0.5 * (8 - 10), 12);
    expect(tt).toMatchObject({ direction: "BAISSE", topFeature: "overtime_h_avg_3m" });
    expect(g[0].group).toBe("REMUNERATION");
  });
});

describe("phrases", () => {
  it("binaire à 1, tendances signées, arrondis et pourcentages", () => {
    expect(featurePhrase("contract_cdd", 1)).toBe("Contrat à durée déterminée");
    expect(featurePhrase("mandatory_training_overdue", 0)).toBe("Pas de formation obligatoire en retard");
    expect(featurePhrase("overtime_trend_6m", 2.345)).toBe("Heures supplémentaires en évolution de +2,3 h/mois");
    expect(featurePhrase("overtime_trend_6m", -0.04)).toBe("Heures supplémentaires en évolution de 0 h/mois");
    expect(featurePhrase("team_exit_rate_6m", 0.05)).toBe("5 % de départs volontaires dans l'équipe sur 6 mois");
    expect(featurePhrase("absence_rate_3m", 0.123)).toBe("Taux d'absence hors santé de 12 % sur 3 mois");
    expect(featurePhrase("tenure_months", 131.6)).toBe("Ancienneté de 132 mois");
    expect(() => featurePhrase("inconnue", 1)).toThrow(/Variable inconnue/);
  });

  it("phrase manager : libellé sans chiffre, code brut pour un groupe inconnu", () => {
    for (const code of Object.keys(GROUPS)) expect(managerPhrase(code)).not.toMatch(/\d/);
    expect(managerPhrase("INCONNU")).toBe("INCONNU");
  });
});

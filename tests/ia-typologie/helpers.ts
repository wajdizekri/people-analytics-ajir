import { FEATURE_INDEX, FEATURES, FSV } from "@/lib/features/spec";
import type { DepartureRow } from "@/lib/ai/typology/departures";

// Bundle synthétique calculable à la main : 2 variables, 3 profils.
// z = [(log1p(ancienneté) - 3) / 1, (heures sup - 10) / 5], bornes [0 ; 10] et [0 ; 40].
export const FEATS = ["tenure_months", "overtime_h_avg_3m"] as const;

const trait = (feature: string, direction: "HAUSSE" | "BAISSE" | "PROCHE", text: string) => ({ feature, direction, effect: direction === "BAISSE" ? -1 : 1, text });

export function syntheticBundle(over: Record<string, unknown> = {}) {
  return {
    version: "typo-test",
    kind: "KMEANS",
    topic: "TYPOLOGIE_DEPARTS",
    fsv: FSV,
    features: [...FEATS],
    feature_index: FEATS.map((f) => FEATURE_INDEX[f]),
    transform: ["log1p", "none"],
    clip: [
      [0, 10],
      [0, 40],
    ],
    standardization: { mean: [3, 10], std: [1, 5] },
    centers: [
      [-1, 0],
      [1, 0],
      [0, 2],
    ],
    profiles: [
      {
        id: 1,
        label: "Arrivées récentes",
        traits: [
          trait("tenure_months", "BAISSE", "Ancienneté médiane de 8 mois, contre 55 mois pour l'ensemble des départs"),
          trait("contract_cdd", "HAUSSE", "62 % en CDD au moment du départ, contre 26 % pour l'ensemble"),
          trait("job_family:Production", "HAUSSE", "58 % dans la famille Production, contre 40 % pour l'ensemble des départs"),
        ],
        size: 40,
        share: 0.4,
        median_tenure_months: 8,
        stability: 0.91,
      },
      {
        id: 2,
        label: "Grande ancienneté, sans promotion depuis longtemps",
        traits: [
          trait("tenure_months", "HAUSSE", "Ancienneté médiane de 150 mois, contre 55 mois pour l'ensemble des départs"),
          trait("months_since_promotion", "HAUSSE", "Sans promotion depuis 80 mois en médiane (ou depuis l'embauche), contre 35 mois pour l'ensemble"),
          trait("absence_rate_12m", "PROCHE", "Absences hors santé proches de l'ensemble des départs : 1,2 % contre 1,4 %"),
        ],
        size: 35,
        share: 0.35,
        median_tenure_months: 150,
        stability: 0.7,
      },
      {
        id: 3,
        label: "Heures supplémentaires élevées",
        traits: [
          trait("overtime_h_avg_3m", "HAUSSE", "Heures supplémentaires : 24 h par mois en moyenne sur 3 mois, contre 7 h pour l'ensemble"),
          trait("training_hours_12m", "BAISSE", "Formation : 3 h sur 12 mois en moyenne, contre 12 h pour l'ensemble"),
          trait("raise_pct_12m", "PROCHE", "Augmentation sur 12 mois proche de l'ensemble des départs : 4,9 % contre 5,4 %"),
        ],
        size: 25,
        share: 0.25,
        median_tenure_months: 40,
        stability: 0.55,
      },
    ],
    k: 3,
    min_profile_size: 20,
    trained_at: "2026-10-04T00:00:00Z",
    train_from: "2020-10-01",
    train_to: "2026-08-28",
    train_rows: 100,
    ...over,
  };
}

// Vecteur feature_snapshot complet (ordre de shared/features.json), valeurs d'imputation par défaut
export function snapshot(values: Partial<Record<string, number>>): number[] {
  return FEATURES.map((f) => values[f.name] ?? f.impute);
}

// Ancienneté dont log1p vaut exactement l'entier voulu à l'arrondi près
export const tenureFor = (logValue: number) => Math.expm1(logValue);

let nextId = 1;
export function row(values: Partial<Record<string, number>> | null, o: Partial<DepartureRow> = {}): DepartureRow {
  const id = nextId++;
  return {
    exitId: id,
    employeeId: id,
    exitDate: "2025-06-30",
    reason: "DEMISSION",
    eventDate: "2025-05-31",
    asOf: values ? "2025-04-30" : null,
    valuesJson: values ? JSON.stringify(snapshot(values)) : null,
    departmentName: "Production",
    jobFamily: "Production",
    ...o,
  };
}

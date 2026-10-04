import raw from "../../../shared/features.json";

export type GroupSpec = { label_rh: string; label_manager: string; actionable: boolean };
export type FeatureSpec = { name: string; group: string; impute: number; unit: string; label: string; cap?: number };
export type B0Rule = { feature: string; op: "<" | "<=" | ">" | ">=" | "=="; value: number; points: number };

type FeaturesFile = {
  fsv: string;
  horizon_months: number;
  groups: Record<string, GroupSpec>;
  features: FeatureSpec[];
  b0_rules: B0Rule[];
};

export const FEATURES_SPEC = raw as unknown as FeaturesFile;
export const FSV = FEATURES_SPEC.fsv;
export const FEATURES: FeatureSpec[] = FEATURES_SPEC.features;
export const FEATURE_NAMES: string[] = FEATURES.map((f) => f.name);
export const GROUPS: Record<string, GroupSpec> = FEATURES_SPEC.groups;
export const GROUP_CODES: string[] = Object.keys(GROUPS);
export const B0_RULES: B0Rule[] = FEATURES_SPEC.b0_rules;

export const FEATURE_INDEX: Record<string, number> = Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, i]));

export function featureSpec(name: string): FeatureSpec {
  const i = FEATURE_INDEX[name];
  if (i === undefined) throw new Error(`Variable inconnue : ${name}`);
  return FEATURES[i];
}

// Catégories jamais transmises au manager : ABSENCES (signal d'absentéisme individuel) et, avec un score à règles,
// REMUNERATION (qui y signifie exactement « salaire sous 90 % de la médiane du poste »).
export function managerVisibleGroup(group: string, modelKind: string): boolean {
  return group !== "ABSENCES" && !(group === "REMUNERATION" && modelKind === "B0");
}

// Actions réservées à la RH, jamais transmises au manager
export const RH_ONLY_ACTIONS = new Set(["REVISION_SALARIALE"]);

// Catégories d'absence prises en compte : hors santé (maladie, maternité) et hors congé annuel
export const COUNTED_ABSENCE = new Set(["ABSENCE_INJUSTIFIEE", "CONGE_SANS_SOLDE", "AUTRE"]);
export const HEALTH_ABSENCE = new Set(["MALADIE", "MATERNITE"]);

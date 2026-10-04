import { z } from "zod";
import { FEATURE_PARAMS, TRAINING_FEATURES, type TrainingFeature, type TrainingFeatures } from "./features";

export const trainingBundleSchema = z.object({
  version: z.string().min(1),
  kind: z.literal("LOGREG"),
  topic: z.literal("FORMATION"),
  features: z.array(z.enum(TRAINING_FEATURES)).min(1),
  feature_params: z.object({
    horizon_days: z.number(),
    team_window_days: z.number(),
    team_min_trainings: z.number(),
    margin_clip: z.number(),
    new_hire_months: z.number(),
  }),
  impute: z.record(z.string(), z.number()),
  standardization: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }),
  coef: z.array(z.number()),
  intercept: z.number(),
  calibration: z.object({ method: z.string(), a: z.number(), b: z.number() }),
  base_rate: z.number(),
  levels: z.object({ high: z.number(), medium: z.number() }),
  metrics: z.record(z.string(), z.unknown()).optional(),
});
export type TrainingBundle = z.infer<typeof trainingBundleSchema>;
export const goldenSchema = z.array(z.object({ x: z.array(z.number()), p: z.number() }));
export const GOLDEN_TOLERANCE = 1e-9;

export type TrainingLevel = "ELEVE" | "MOYEN" | "FAIBLE";
export type TrainingFactor = { group: string; contribution: number; direction: "HAUSSE" | "BAISSE"; phraseRh: string; phraseManager: string };

export function parseTrainingBundle(json: unknown): TrainingBundle {
  const r = trainingBundleSchema.safeParse(json);
  if (!r.success) throw new Error(`Bundle FORMATION invalide : ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ")}`);
  const b = r.data;
  const n = b.features.length;
  if (b.coef.length !== n || b.standardization.mean.length !== n || b.standardization.std.length !== n)
    throw new Error("Bundle FORMATION invalide : dimensions incohérentes.");
  for (const [k, v] of Object.entries(FEATURE_PARAMS))
    if (b.feature_params[k as keyof typeof FEATURE_PARAMS] !== v) throw new Error(`Bundle FORMATION : paramètre ${k} différent du calcul des variables.`);
  return b;
}

export function toVector(b: TrainingBundle, f: TrainingFeatures): number[] {
  return b.features.map((name) => {
    const v = f[name];
    if (v != null && Number.isFinite(v)) return v;
    const imp = b.impute[name];
    if (imp === undefined) throw new Error(`Variable ${name} manquante sans imputation.`);
    return imp;
  });
}

const zOf = (b: TrainingBundle, j: number, v: number) => (v - b.standardization.mean[j]) / (b.standardization.std[j] === 0 ? 1 : b.standardization.std[j]);

// Même suite d'opérations que bundle_predict (ml/training/run.py)
export function predictTraining(b: TrainingBundle, x: number[]): number {
  let logit = b.intercept;
  for (let j = 0; j < x.length; j++) logit += b.coef[j] * zOf(b, j, x[j]);
  const s = b.calibration.a * logit + b.calibration.b;
  if (s >= 0) return 1 / (1 + Math.exp(-s));
  const e = Math.exp(s);
  return e / (1 + e);
}

export function levelOf(b: TrainingBundle, p: number): TrainingLevel {
  return p >= b.levels.high ? "ELEVE" : p >= b.levels.medium ? "MOYEN" : "FAIBLE";
}

export function checkGolden(b: TrainingBundle, golden: unknown): { rows: number; maxDiff: number } {
  const rows = goldenSchema.parse(golden);
  let maxDiff = 0;
  for (const r of rows) maxDiff = Math.max(maxDiff, Math.abs(predictTraining(b, r.x) - r.p));
  if (maxDiff > GOLDEN_TOLERANCE) throw new Error(`Parité rompue avec le bundle ${b.version} : écart ${maxDiff}`);
  return { rows: rows.length, maxDiff };
}

// Groupes explicatifs : libellé manager (catégorie, sans chiffre) ; phrase RH chiffrée.
const GROUP_OF: Record<TrainingFeature, string> = {
  days_to_due: "ECHEANCE",
  log_days_to_due: "ECHEANCE",
  started: "AVANCEMENT",
  hours: "DUREE",
  tenure_months: "ANCIENNETE",
  log_tenure: "ANCIENNETE",
  new_hire: "ANCIENNETE",
  emp_past_n: "HISTORIQUE",
  emp_late_rate: "HISTORIQUE",
  emp_margin_days: "HISTORIQUE",
  emp_overdue_other: "HISTORIQUE",
  team_late_rate_12m: "EQUIPE",
  overtime_h_3m: "CHARGE",
  open_mandatory_others: "CHARGE",
  due_summer: "PERIODE",
};

export const TRAINING_GROUP_LABEL: Record<string, string> = {
  ECHEANCE: "Échéance proche",
  AVANCEMENT: "Formation non commencée",
  DUREE: "Durée de la formation",
  ANCIENNETE: "Ancienneté",
  HISTORIQUE: "Historique de réalisation des formations obligatoires",
  EQUIPE: "Réalisation des formations dans l'équipe",
  CHARGE: "Charge de travail",
  PERIODE: "Période de l'échéance",
};

const MIN_FACTOR = 0.05;
const MAX_FACTORS = 3;
const n0 = (x: number) => Math.round(x).toLocaleString("fr-FR");
const plural = (n: number, s: string) => `${n} ${s}${Math.abs(n) > 1 ? "s" : ""}`;

function phraseRh(group: string, f: TrainingFeatures, lateCount: number): string {
  switch (group) {
    case "ECHEANCE":
      return `Échéance dans ${plural(f.days_to_due ?? 0, "jour")}${f.started ? "" : ", formation non commencée"}`;
    case "AVANCEMENT":
      return f.started ? "Formation commencée, non terminée" : "Formation non commencée";
    case "DUREE":
      return `Formation de ${n0(f.hours ?? 0)} h`;
    case "ANCIENNETE":
      return `Ancienneté : ${f.tenure_months ?? 0} mois`;
    case "HISTORIQUE": {
      const n = f.emp_past_n ?? 0;
      if (!n || f.emp_margin_days == null) return "Aucune formation obligatoire échue auparavant (valeur moyenne retenue)";
      const m = f.emp_margin_days;
      const when = m >= 0 ? `${plural(Math.round(m), "jour")} avant l'échéance` : `${plural(Math.round(-m), "jour")} après l'échéance`;
      return `Formations obligatoires passées terminées en moyenne ${when} (${lateCount} en retard sur ${n})`;
    }
    case "EQUIPE":
      return f.team_late_rate_12m == null
        ? "Historique d'équipe insuffisant (valeur moyenne retenue)"
        : `Équipe : ${n0(f.team_late_rate_12m * 100)}\u00a0% des formations obligatoires échues sur 12 mois terminées en retard`;
    case "CHARGE":
      return `Heures supplémentaires : ${n0(f.overtime_h_3m ?? 0)} h par mois en moyenne sur 3 mois`;
    case "PERIODE":
      return f.due_summer ? "Échéance en période estivale (juillet-août)" : "Échéance hors période estivale";
    default:
      return TRAINING_GROUP_LABEL[group] ?? group;
  }
}

// Contributions exactes au logit calibré (a * coef_j * z_j) sommées par groupe ; facteurs en HAUSSE, les plus forts d'abord.
export function explainTraining(b: TrainingBundle, f: TrainingFeatures, x: number[], lateCount = 0): TrainingFactor[] {
  const byGroup = new Map<string, number>();
  b.features.forEach((name, j) => {
    const g = GROUP_OF[name];
    byGroup.set(g, (byGroup.get(g) ?? 0) + b.calibration.a * b.coef[j] * zOf(b, j, x[j]));
  });
  return [...byGroup.entries()]
    .filter(([, c]) => c >= MIN_FACTOR)
    .sort((a, c) => c[1] - a[1])
    .slice(0, MAX_FACTORS)
    .map(([group, contribution]) => ({
      group,
      contribution: Math.round(contribution * 1e6) / 1e6,
      direction: "HAUSSE" as const,
      phraseRh: phraseRh(group, f, lateCount),
      phraseManager: TRAINING_GROUP_LABEL[group] ?? group,
    }));
}

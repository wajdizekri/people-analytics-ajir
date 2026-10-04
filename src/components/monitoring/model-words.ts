import { FEATURES } from "@/lib/features/spec";
import { featureShortLabel } from "@/lib/drift/labels";

// Variables du modèle en langage courant : sens « plus de… » (un effet positif = risque estimé plus élevé quand la valeur augmente)
export const FACTOR_PHRASE: Record<string, string> = {
  tenure_months: "Ancienneté plus longue",
  contract_cdd: "Contrat CDD (plutôt que CDI)",
  grade_level: "Grade plus élevé",
  months_since_promotion: "Plus de temps sans promotion",
  job_change_12m: "Changement de poste dans l'année",
  compa_ratio: "Salaire plus haut que la médiane du poste",
  raise_pct_12m: "Augmentation plus forte sur 12 mois",
  months_since_raise: "Plus de temps sans augmentation",
  overtime_h_avg_3m: "Plus d'heures supplémentaires",
  overtime_trend_6m: "Heures supplémentaires en hausse",
  late_count_3m: "Plus de retards",
  arrival_std_min_3m: "Horaires d'arrivée plus irréguliers",
  no_badge_days_3m: "Plus de jours sans pointage ni absence déclarée",
  absence_rate_3m: "Plus d'absences hors santé (3 mois)",
  absence_rate_12m: "Plus d'absences hors santé (12 mois)",
  short_episodes_12m: "Plus d'absences courtes",
  bradford_12m: "Absences courtes et répétées (facteur de Bradford)",
  training_hours_12m: "Plus d'heures de formation",
  mandatory_training_overdue: "Formation obligatoire en retard",
  last_eval_score: "Meilleure note à la dernière évaluation",
  eval_delta: "Évaluation en progression",
  eval_missing: "Aucune évaluation disponible",
  team_exit_rate_6m: "Plus de départs volontaires dans l'équipe",
  manager_change_12m: "Changement de manager dans l'année",
  team_size: "Équipe plus grande",
};

export const factorPhrase = (name: string) => FACTOR_PHRASE[name] ?? featureShortLabel(name);

const UNIT = new Map(FEATURES.map((f) => [f.name, f.unit]));
const OP: Record<string, string> = { "<": "inférieur à", "<=": "au plus", ">": "supérieur à", ">=": "au moins", "==": "égal à" };
const num = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

// Condition d'une règle du score B0 en mots : « Compa-ratio (salaire / médiane du poste) inférieur à 90 % »
export function ruleCondition(feature: string, op: string, value: number): string {
  const unit = UNIT.get(feature);
  const label = featureShortLabel(feature);
  if (unit === "0/1") return value >= 1 && op !== "<" ? `${label} : oui` : `${label} : non`;
  const shown = unit === "ratio" ? `${num(value * 100)} %` : unit && !["nombre", "score", "niveau"].includes(unit) ? `${num(value)} ${unit}` : num(value);
  return `${label} ${OP[op] ?? op} ${shown}`;
}

// Sujet d'un facteur pour un titre de visuel : « les absences courtes », « le salaire »
const FACTOR_TOPIC: Record<string, string> = {
  tenure_months: "l'ancienneté",
  contract_cdd: "le contrat CDD",
  grade_level: "le grade",
  months_since_promotion: "le temps sans promotion",
  job_change_12m: "les changements de poste",
  compa_ratio: "le salaire",
  raise_pct_12m: "les augmentations",
  months_since_raise: "le temps sans augmentation",
  overtime_h_avg_3m: "les heures supplémentaires",
  overtime_trend_6m: "la hausse des heures supplémentaires",
  late_count_3m: "les retards",
  arrival_std_min_3m: "les horaires irréguliers",
  no_badge_days_3m: "les jours sans pointage",
  absence_rate_3m: "les absences récentes",
  absence_rate_12m: "les absences sur 12 mois",
  short_episodes_12m: "les absences courtes",
  bradford_12m: "les absences répétées",
  training_hours_12m: "les heures de formation",
  mandatory_training_overdue: "les formations en retard",
  last_eval_score: "la note d'évaluation",
  eval_delta: "l'évolution de l'évaluation",
  eval_missing: "l'absence d'évaluation",
  team_exit_rate_6m: "les départs dans l'équipe",
  manager_change_12m: "les changements de manager",
  team_size: "la taille de l'équipe",
};

// Titre-message du visuel des facteurs, d'après les deux plus influents : « Le salaire et les absences courtes pèsent le plus »
// (null si un facteur n'a pas de nom court : la page garde alors un titre générique)
export function factorsHeadline(names: string[]): string | null {
  const topics = names.slice(0, 2).map((n) => FACTOR_TOPIC[n]);
  if (!topics.length || topics.some((t) => !t)) return null;
  const subject = topics.join(" et ");
  const plural = topics.length > 1 || topics[0].startsWith("les ");
  return `${subject.charAt(0).toLocaleUpperCase("fr-FR")}${subject.slice(1)} ${plural ? "pèsent" : "pèse"} le plus`;
}

// Libellé court d'un facteur pour l'axe d'un graphique : tient sur deux lignes sous 640 px (la phrase complète reste dans le tableau)
const FACTOR_AXIS: Record<string, string> = {
  job_change_12m: "Changement de poste récent",
  compa_ratio: "Salaire au-dessus de la médiane",
  raise_pct_12m: "Augmentation plus forte",
  months_since_raise: "Augmentation plus ancienne",
  overtime_trend_6m: "Heures sup. en hausse",
  arrival_std_min_3m: "Arrivées plus irrégulières",
  no_badge_days_3m: "Plus de jours sans pointage",
  absence_rate_3m: "Plus d'absences (3 mois)",
  absence_rate_12m: "Plus d'absences (12 mois)",
  bradford_12m: "Absences courtes et répétées",
  mandatory_training_overdue: "Formation en retard",
  last_eval_score: "Meilleure note d'évaluation",
  team_exit_rate_6m: "Plus de départs dans l'équipe",
  manager_change_12m: "Changement de manager",
};

export const factorAxisLabel = (name: string) => FACTOR_AXIS[name] ?? factorPhrase(name);

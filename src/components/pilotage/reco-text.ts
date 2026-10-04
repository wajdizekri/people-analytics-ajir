import { lcFirst } from "./labels";

// Action : ce que recouvre l'action proposée, en groupe nominal court
export const RECO_WHAT: Record<string, string> = {
  ENTRETIEN: "entretien individuel sur les attentes et perspectives",
  REVISION_SALARIALE: "comparaison aux postes équivalents et étude d'un ajustement",
  CHARGE_TRAVAIL: "revue de la charge et des heures supplémentaires",
  PLAN_FORMATION: "formation ou parcours de développement",
};

// Pourquoi, en libellé + valeur (facteurs associés, jamais des causes)
export function recoWhy(triggerGroup: string, triggerLabel: string): { label: string; value: string } {
  return triggerGroup === "NIVEAU_ELEVE" ? { label: "Déclencheur", value: "niveau de risque Élevé" } : { label: "Facteur principal", value: lcFirst(triggerLabel) };
}

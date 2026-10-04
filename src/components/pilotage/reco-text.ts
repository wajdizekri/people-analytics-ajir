// Pourquoi : facteur déclencheur en phrase (facteurs associés, jamais des causes)
export const RECO_WHY: Record<string, string> = {
  NIVEAU_ELEVE: "Classé au niveau de risque Élevé lors du calcul : un échange individuel est recommandé.",
  REMUNERATION: "La rémunération fait partie des principaux facteurs associés à son niveau de risque.",
  TEMPS_TRAVAIL: "Le temps de travail (heures supplémentaires, horaires) fait partie des principaux facteurs associés à son niveau de risque.",
  FORMATION_EVAL: "La formation et l'évaluation font partie des principaux facteurs associés à son niveau de risque.",
};

// Que faire : l'action proposée, en une phrase lisible par la RH comme par le manager
export const RECO_WHAT: Record<string, string> = {
  ENTRETIEN: "Proposer un entretien pour comprendre ses attentes et ses perspectives.",
  REVISION_SALARIALE: "Comparer sa rémunération à celle de postes équivalents et étudier un ajustement.",
  CHARGE_TRAVAIL: "Examiner avec le collaborateur sa charge de travail et ses heures supplémentaires.",
  PLAN_FORMATION: "Proposer une formation ou un parcours de développement adapté.",
};

export const recoWhy = (triggerGroup: string, triggerLabel: string) => RECO_WHY[triggerGroup] ?? `Facteur associé à son niveau de risque : ${triggerLabel}.`;

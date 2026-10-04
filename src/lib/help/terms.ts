import type { Role } from "@/db/schema";

// Définitions courtes des bulles « ? » : une seule définition par concept, reprise partout (écrans et centre d'aide).
// Les textes visibles par un manager ne citent ni le lift, ni la masse salariale, ni une probabilité chiffrée.
export type Term = { label: string; text: string; roles?: readonly Role[] };

const STAFF: Role[] = ["ADMIN", "RH"];

export const TERMS = {
  niveauRisque: {
    label: "Niveau de risque",
    text: "Classement du risque de départ volontaire (démission ou abandon de poste) dans les 6 mois : Élevé, Moyen ou Faible. Il est recalculé chaque mois à partir des données AJIR. C'est une estimation, pas une certitude.",
  },
  niveauEleve: {
    label: "Niveau Élevé",
    text: "Les collaborateurs les plus exposés, dans la limite de la capacité d'entretiens RH du mois. Ce niveau sert à choisir qui rencontrer en priorité ; la plupart de ces collaborateurs ne partent pas.",
  },
  niveauMoyen: {
    label: "Niveau Moyen",
    text: "Risque estimé nettement supérieur à la moyenne (au moins 2 fois, valeur par défaut), sans faire partie du niveau Élevé.",
  },
  nonEvalue: {
    label: "Non évalué",
    text: "Collaborateur hors du calcul : stage ou SIVP, CDD qui se termine dans les 6 mois, arrivée depuis moins d'un mois, 60 ans ou plus dans les 6 mois, démission déjà connue ou opposition du collaborateur au calcul de son risque.",
  },
  capacite: {
    label: "Capacité d'entretiens RH",
    text: "Part des collaborateurs évalués que la RH peut recevoir en entretien chaque mois (2 % par défaut). Elle fixe le nombre maximal de collaborateurs au niveau Élevé.",
  },
  lift: {
    label: "Lift",
    text: "Nombre de fois où le risque estimé dépasse la moyenne des collaborateurs évalués. Un lift de 3 signifie un risque 3 fois plus élevé que la moyenne.",
    roles: STAFF,
  },
  liftMoyen: {
    label: "Lift moyen",
    text: "Moyenne des lifts des collaborateurs évalués du département. Au-dessus de 1, le département est plus exposé que la moyenne de l'entreprise.",
    roles: ["RH"],
  },
  facteursAssocies: {
    label: "Facteurs associés",
    text: "Éléments du dossier qui pèsent le plus dans l'estimation (charge de travail, évolution de carrière…). Ils vont souvent de pair avec les départs, mais ils n'en sont pas la cause démontrée.",
  },
  scoreRegles: {
    label: "Score à règles",
    text: "Méthode simple : chaque condition remplie (par exemple un salaire sous 90 % de la médiane du poste) ajoute des points. Le résultat est un nombre de points, et non un pourcentage.",
    roles: STAFF,
  },
  probabilite: {
    label: "Probabilité à 6 mois",
    text: "Estimation, en pourcentage, de la probabilité d'une démission ou d'un abandon de poste dans les 6 mois. Réservée à la RH.",
    roles: STAFF,
  },
  effectif: {
    label: "Effectif",
    text: "Nombre de collaborateurs en CDI ou CDD présents le dernier jour du mois. Stages et SIVP exclus.",
  },
  turnover: {
    label: "Turnover glissant 12 mois",
    text: "Sorties des 12 derniers mois divisées par l'effectif moyen de ces 12 mois, en %. Le turnover volontaire ne compte que les démissions et abandons de poste. Stages et SIVP exclus.",
  },
  absenteisme: {
    label: "Absentéisme hors santé non planifié",
    text: "Jours d'absence injustifiée, de congé sans solde ou d'autre absence, divisés par les jours ouvrables, en %. Maladie, maternité et congés annuels ne sont pas comptés.",
  },
  entreesSorties: {
    label: "Entrées et sorties",
    text: "Collaborateurs en CDI ou CDD arrivés et partis pendant la période. Le passage d'un stage ou d'un SIVP à un CDD ou CDI compte comme une entrée. Départ volontaire : démission ou abandon de poste.",
  },
  formationsObligatoires: {
    label: "Formations obligatoires réalisées",
    text: "Part des formations obligatoires arrivées à échéance pendant la période qui sont terminées, en %. Une formation terminée en retard compte comme réalisée.",
  },
  masseSalariale: {
    label: "Masse salariale brute",
    text: "Somme des salaires bruts du mois, tous contrats confondus, en dinars (TND). Charges patronales non comprises.",
    roles: ["RH"],
  },
  petitsGroupes: {
    label: "Petits groupes",
    text: "Pour protéger l'anonymat, aucun taux ni nombre de sorties n'est affiché pour un groupe de moins de 5 personnes, ni quand il pourrait se déduire d'un autre chiffre.",
  },
  anomalieCollective: {
    label: "Anomalie collective",
    text: "Hausse inhabituelle de l'absentéisme d'une équipe ou d'un département deux semaines de suite, par rapport au niveau attendu pour la période (Ramadan, jours fériés, ponts et séance unique pris en compte). Groupes d'au moins 5 personnes.",
  },
  bradford: {
    label: "Signal individuel (facteur de Bradford)",
    text: "Indicateur qui pèse davantage les absences courtes et répétées : nombre d'absences au carré multiplié par le nombre de jours d'absence, sur 12 mois. Au-delà du seuil, un signal « à vérifier » est créé. Ce n'est pas un constat.",
    roles: ["RH"],
  },
  scoreQualite: {
    label: "Score qualité",
    text: "Part des lignes acceptées à l'import (moyenne par fichier), multipliée par la complétude de la paie du dernier mois. Sous le seuil (95 % par défaut), l'import est bloqué et aucun nouveau calcul n'est publié.",
    roles: STAFF,
  },
  lignesRejetees: {
    label: "Lignes rejetées",
    text: "Lignes de l'export AJIR non importées parce qu'un contrôle a échoué : date invalide, doublon, matricule inconnu, salaire sous le SMIG…",
    roles: STAFF,
  },
  gravite: {
    label: "Rejet, correction, avertissement",
    text: "Rejet : la ligne n'est pas importée. Correction : la ligne est importée avec une valeur neutralisée (grade inconnu laissé vide, par exemple). Avertissement : simple information, la ligne est importée.",
    roles: STAFF,
  },
  fraicheur: {
    label: "Fraîcheur des données",
    text: "Nombre de jours entre aujourd'hui et le dernier pointage importé. Un export AJIR est attendu chaque mois.",
    roles: STAFF,
  },
  worker: {
    label: "Service de calcul (worker)",
    text: "Programme qui traite en arrière-plan les imports et le calcul mensuel. S'il est arrêté, les demandes restent en attente.",
    roles: STAFF,
  },
  calculRisques: {
    label: "Calcul des risques",
    text: "Calcul mensuel des niveaux de risque. Il est bloqué tant que le dernier import n'atteint pas le seuil de qualité : les écrans gardent alors le dernier calcul publié.",
    roles: STAFF,
  },
  traitements: {
    label: "Traitements (jobs)",
    text: "Tâches exécutées par le service de calcul : import, agrégats, variables, calcul des risques, détection des anomalies, calcul mensuel complet.",
    roles: STAFF,
  },
  auc: {
    label: "AUC",
    text: "Capacité du modèle à placer un collaborateur parti devant un collaborateur resté. 0,5 correspond au hasard, 1 à un classement parfait.",
    roles: STAFF,
  },
  liftCapacite: {
    label: "Lift à la capacité",
    text: "Taux de démission des collaborateurs classés Élevé, divisé par le taux moyen. Un lift de 3 : le groupe ciblé démissionne 3 fois plus que la moyenne. Cible : au moins 3.",
    roles: STAFF,
  },
  observePrevu: {
    label: "Observé / prévu",
    text: "Nombre de départs observés divisé par le nombre de départs estimés. Proche de 1 : les estimations sont justes en moyenne. Cible : entre 0,8 et 1,25.",
    roles: STAFF,
  },
  penteCalibration: {
    label: "Pente de calibration",
    text: "Indique si les estimations sont trop dispersées (pente inférieure à 1) ou trop resserrées (supérieure à 1). Cible : entre 0,8 et 1,2.",
    roles: STAFF,
  },
  calibration: {
    label: "Calibration",
    text: "Compare, par tranche d'estimation, le risque estimé au taux de départ réellement observé. Des points proches de la diagonale indiquent des estimations fiables.",
    roles: STAFF,
  },
  courbeDecision: {
    label: "Courbe de décision",
    text: "Compare le bénéfice d'un ciblage par le modèle à celui d'un ciblage de tous les collaborateurs, selon le coût relatif d'une action inutile. Analyse indicative, sans effet sur les niveaux de risque.",
    roles: STAFF,
  },
  equite: {
    label: "Rapport d'équité",
    text: "Compare, par sexe et par tranche d'âge, la justesse des estimations et la part de collaborateurs classés Élevé. TPR@k : part des partis qui étaient classés Élevé. FPR@k : part des restés classés Élevé. Sexe et âge ne sont pas des variables du calcul.",
    roles: STAFF,
  },
  variables: {
    label: "Effet (+1 σ) et odds ratio",
    text: "Effet d'une valeur nettement plus haute que la moyenne (un écart-type, σ) sur l'estimation. Odds ratio supérieur à 1 : associé à un risque plus élevé ; inférieur à 1 : associé à un risque plus faible.",
    roles: STAFF,
  },
  tauxBase: {
    label: "Taux de base",
    text: "Part de l'ensemble des collaborateurs évalués qui ont démissionné dans les 6 mois. C'est le point de comparaison de la précision et du lift.",
    roles: STAFF,
  },
  precision: {
    label: "Précision",
    text: "Part des collaborateurs d'un groupe (par exemple les classés Élevé) qui ont effectivement démissionné dans les 6 mois.",
    roles: STAFF,
  },
  rappel: {
    label: "Rappel",
    text: "Part de toutes les démissions de la période qui concernaient des collaborateurs déjà repérés par le groupe.",
    roles: STAFF,
  },
  backtest: {
    label: "Vérification a posteriori",
    text: "Rejoue le calcul du risque à une date passée et le compare aux démissions réellement observées dans les 6 mois suivants (en anglais : backtesting).",
    roles: ["RH"],
  },
  dateOrigine: {
    label: "Date d'origine",
    text: "Fin de mois à laquelle le calcul est rejoué. Seuls les mois suivis pendant 6 mois complets sont proposés.",
    roles: ["RH"],
  },
  retention: {
    label: "Rétention à 12 mois",
    text: "Part des embauchés en CDI ou CDD encore présents 12 mois après leur arrivée, estimée par la méthode de Kaplan-Meier. Stages et SIVP ne comptent pas comme des embauches.",
  },
  kaplanMeier: {
    label: "Courbe de maintien (Kaplan-Meier)",
    text: "Part des embauchés encore présents selon l'ancienneté. Chaque marche correspond à des départs. Les arrivées récentes, qui n'ont pas encore autant d'ancienneté, comptent tant qu'elles sont suivies.",
  },
  censure: {
    label: "Censure",
    text: "Collaborateur encore présent à la date des données : on sait seulement qu'il est resté au moins jusque-là. Il compte dans le calcul jusqu'à cette date, sans être compté comme un départ.",
  },
  dureeMediane: {
    label: "Durée médiane de présence",
    text: "Ancienneté à laquelle la moitié des embauchés est partie. « Non atteinte » : plus de la moitié est encore présente à la fin du suivi.",
  },
} as const satisfies Record<string, Term>;

export type TermId = keyof typeof TERMS;

export function termFor(id: TermId, role?: Role): Term | null {
  const t: Term = TERMS[id];
  return !role || !t.roles || t.roles.includes(role) ? t : null;
}

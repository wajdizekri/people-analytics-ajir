// Contrôles d'import expliqués en mots : ce que la règle signifie et l'action corrective côté AJIR.
// Codes : src/lib/import/rules.ts (libellés et gravités inchangés).

import { RULES } from "@/lib/import/rules";

export const RULE_HELP: Record<string, { meaning: string; action: string }> = {
  EN_TETE_INVALIDE: {
    meaning: "La première ligne du fichier n'a pas les colonnes attendues : tout le fichier a été ignoré.",
    action: "Réexporter le fichier depuis AJIR avec le modèle d'export prévu (noms de colonnes inchangés, séparateur « ; »).",
  },
  FORMAT_LIGNE: {
    meaning: "La ligne n'a pas le même nombre de colonnes que l'en-tête (point-virgule ou guillemet mal placé).",
    action: "Repérer dans AJIR le champ qui contient un « ; » ou un retour à la ligne, le corriger, puis réexporter.",
  },
  CHAMP_OBLIGATOIRE: {
    meaning: "Une information indispensable est vide (matricule, date, code…).",
    action: "Compléter la fiche concernée dans AJIR, puis réimporter l'export.",
  },
  DATE_INVALIDE: {
    meaning: "Une date est illisible ou impossible (format attendu : AAAA-MM-JJ).",
    action: "Corriger la date dans AJIR ou vérifier le format de date de l'export.",
  },
  VALEUR_INVALIDE: {
    meaning: "Une valeur ne fait pas partie des valeurs prévues (type de contrat, motif, nombre…).",
    action: "Corriger la valeur dans AJIR en utilisant un code de la liste prévue par le contrat d'export.",
  },
  MATRICULE_DUPLIQUE: {
    meaning: "Le même matricule apparaît deux fois dans le fichier des collaborateurs.",
    action: "Fusionner ou corriger les fiches en double dans AJIR.",
  },
  DOUBLON: {
    meaning: "La même ligne apparaît plusieurs fois : seule la première a été gardée.",
    action: "Aucune action urgente. Signaler le doublon à l'équipe AJIR pour qu'il ne se reproduise pas.",
  },
  MATRICULE_INCONNU: {
    meaning: "La ligne concerne un matricule absent du fichier des collaborateurs.",
    action: "Vérifier que le collaborateur figure bien dans employees.csv (oubli ou matricule mal saisi).",
  },
  DEPARTEMENT_INCONNU: {
    meaning: "Le département indiqué n'existe pas dans departments.csv.",
    action: "Ajouter le département à l'export ou corriger son code dans AJIR.",
  },
  SORTIE_AVANT_EMBAUCHE: {
    meaning: "La date de sortie est antérieure à la date d'embauche.",
    action: "Corriger la date d'embauche ou la date de sortie dans AJIR.",
  },
  FIN_AVANT_DEBUT: {
    meaning: "La date de fin d'une période (contrat, absence, formation) est antérieure à sa date de début.",
    action: "Corriger les dates de la période dans AJIR.",
  },
  ABSENCE_HORS_EMPLOI: {
    meaning: "L'absence tombe avant l'embauche ou après la sortie du collaborateur.",
    action: "Vérifier les dates de l'absence et les dates d'emploi dans AJIR.",
  },
  SALAIRE_SOUS_SMIG: {
    meaning: "Le salaire de base est inférieur au SMIG : montant probablement erroné (temps partiel mal codé, montant tronqué).",
    action: "Vérifier le bulletin dans AJIR et corriger le montant ou le temps de travail.",
  },
  POINTAGE_DUPLIQUE: {
    meaning: "Deux pointages le même jour pour le même collaborateur : le second a été écarté.",
    action: "Aucune correction nécessaire pour les analyses. Signaler à l'équipe AJIR si le volume augmente (double passage de badge).",
  },
  POINTAGE_FUTUR: {
    meaning: "Le pointage est daté après la date de l'import.",
    action: "Vérifier l'horloge de la pointeuse et corriger la date dans AJIR.",
  },
  POINTAGE_HORS_EMPLOI: {
    meaning: "Le pointage tombe avant l'embauche ou après la sortie du collaborateur.",
    action: "Vérifier les dates d'emploi du collaborateur dans AJIR.",
  },
  GRADE_INCONNU: {
    meaning: "Le grade n'est pas reconnu : la ligne est importée sans grade.",
    action: "Ajouter le grade à la grille de l'export ou corriger son code dans AJIR.",
  },
  MANAGER_INEXISTANT: {
    meaning: "Le manager indiqué n'existe pas : le collaborateur est importé sans rattachement hiérarchique.",
    action: "Corriger le matricule du manager dans AJIR.",
  },
  CYCLE_HIERARCHIQUE: {
    meaning: "Le rattachement forme une boucle (A dirige B qui dirige A) : un lien a été rompu.",
    action: "Corriger la hiérarchie dans AJIR.",
  },
  SORTIE_SANS_MOTIF: {
    meaning: "La sortie n'a pas de motif reconnu : elle est importée avec le motif « Autre ».",
    action: "Renseigner le motif de sortie dans AJIR (démission, fin de CDD…) : il compte dans le turnover.",
  },
  POINTAGE_SANS_SORTIE: {
    meaning: "Une arrivée est pointée sans heure de sortie : la journée est importée sans sortie.",
    action: "Aucune correction obligatoire. Rappeler aux équipes de pointer en sortie.",
  },
  PAIE_INCOMPLETE: {
    meaning: "Un collaborateur en poste n'a pas de paie pour le dernier mois de l'export.",
    action: "Vérifier que la paie du mois est complète dans l'export AJIR.",
  },
  PAIE_BRUT_INCOHERENT: {
    meaning: "Le salaire brut dépasse le double du salaire de base.",
    action: "Vérifier les primes et rappels du mois dans AJIR.",
  },
  VARIATION_VOLUME: {
    meaning: "Le nombre de lignes du fichier varie de plus de 30 % par rapport à l'import précédent.",
    action: "Vérifier que l'export est complet (période et filtres d'extraction).",
  },
  FIN_DONNEES_AVANCE: {
    meaning: "La date de fin des données avance anormalement loin d'un import à l'autre.",
    action: "Vérifier les dates de l'export (pointages datés trop loin dans le temps).",
  },
};

// Effet de la gravité sur la ligne, en mots
export const SEVERITY_EFFECT: Record<string, { label: string; effect: string; tone: "danger" | "warning" | "neutral" }> = {
  REJET: { label: "Rejet", effect: "ligne écartée", tone: "danger" },
  CORRECTION: { label: "Correction", effect: "ligne importée après correction", tone: "warning" },
  AVERTISSEMENT: { label: "Avertissement", effect: "ligne importée, à vérifier", tone: "neutral" },
};

export const FILE_LABEL: Record<string, string> = {
  "departments.csv": "Départements",
  "employees.csv": "Collaborateurs",
  "contracts.csv": "Contrats",
  "exits.csv": "Sorties",
  "career_events.csv": "Événements de carrière",
  "attendance.csv": "Pointages",
  "absences.csv": "Absences",
  "payroll.csv": "Paie",
  "trainings.csv": "Formations",
  "evaluations.csv": "Évaluations",
  "users.csv": "Comptes utilisateurs",
};

export const ruleLabel = (rule: string) => (rule in RULES ? RULES[rule as keyof typeof RULES].label : rule);
export const fileLabel = (file: string) => FILE_LABEL[file] ?? file;

// Action à mener en quelques mots (verbe + objet), pour le tableau des contrôles : première phrase, sans parenthèse,
// sans complément après « : », sans point final ; le texte complet reste dans RULE_HELP
export function shortAction(rule: string): string | null {
  const action = RULE_HELP[rule]?.action;
  if (!action) return null;
  const first = action.match(/^.*?[.!?](?=[ ]|$)/)?.[0] ?? action;
  return first
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+:.*$/, "")
    .replace(/[.!?]$/, "")
    .trim();
}

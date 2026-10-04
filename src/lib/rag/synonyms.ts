// Synonymes métier de l'assistant d'aide : si une entrée d'un groupe figure dans la question,
// les autres entrées du groupe sont ajoutées à la requête (src/lib/rag/index.ts). Accents et casse indifférents ;
// une entrée de plusieurs mots est cherchée comme une expression.
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["turnover", "rotation", "départs", "démissions", "sorties"],
  ["absentéisme", "absences", "arrêts"],
  ["heures sup", "heures supp", "heures supplémentaires"],
  ["recommandation", "action", "préconisation"],
  ["fiche", "fiche collaborateur", "profil"],
  ["collaborateur", "salarié", "employé", "agent"],
  ["compte", "utilisateur", "accès"],
  ["mot de passe", "identifiant", "connexion"],
  ["import", "AJIR", "chargement"],
  ["confidentialité", "RGPD", "INPDP", "données personnelles", "vie privée"],
  ["journal", "audit", "traçabilité"],
  ["effectif", "ETP", "headcount"],
  ["salaire", "rémunération", "masse salariale"],
  ["charge de travail", "surcharge"],
  ["congé", "vacances"],
  ["entretien", "rencontrer"],
  ["modèle", "IA", "algorithme", "intelligence artificielle"],
];

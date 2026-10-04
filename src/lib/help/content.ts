import type { Role } from "@/db/schema";
import { FEATURES, GROUPS } from "@/lib/features/spec";

// Contenus du centre d'aide, tirés de docs/DICTIONNAIRE.md et de shared/features.json, réécrits pour des RH non spécialistes.
// `roles` absent = visible par tous les rôles.

export type Audience = { roles?: readonly Role[] };
export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrateur", RH: "Responsable RH", MANAGER: "Manager" };

const PILOTAGE: Role[] = ["RH", "MANAGER"];
const STAFF: Role[] = ["ADMIN", "RH"];

export function forRole<T extends Audience>(items: readonly T[], role: Role): T[] {
  return items.filter((i) => !i.roles || i.roles.includes(role));
}

export const visibleTo = (a: Audience, role: Role) => !a.roles || a.roles.includes(role);

// ---------- Sections du centre d'aide ----------

export type SectionId =
  | "commencer"
  | "faq"
  | "ecrans"
  | "risque"
  | "tableau-de-bord"
  | "absenteisme"
  | "recommandations"
  | "alertes"
  | "qualite-donnees"
  | "modele"
  | "confidentialite"
  | "glossaire";
export const SECTIONS: ({ id: SectionId; title: string; titles?: Partial<Record<Role, string>> } & Audience)[] = [
  { id: "commencer", title: "Par où commencer ?" },
  { id: "faq", title: "Questions fréquentes" },
  { id: "ecrans", title: "Vos écrans" },
  { id: "risque", title: "Comprendre le risque de départ" },
  { id: "tableau-de-bord", title: "Lire le tableau de bord", roles: PILOTAGE },
  { id: "absenteisme", title: "Absentéisme et anomalies", roles: PILOTAGE },
  { id: "recommandations", title: "Recommandations et suivi", roles: PILOTAGE },
  { id: "alertes", title: "Alertes" },
  { id: "qualite-donnees", title: "Qualité des données", roles: STAFF },
  { id: "modele", title: "Transparence du modèle", titles: { RH: "Transparence du modèle et vérification a posteriori" }, roles: STAFF },
  { id: "confidentialite", title: "Confidentialité et droits" },
  { id: "glossaire", title: "Glossaire" },
];

// ---------- Par où commencer ? (trois étapes par rôle) ----------

export type StartStep = { title: string; text: string; href: string; cta: string };
export const START: Record<Role, StartStep[]> = {
  RH: [
    {
      title: "Lisez la synthèse du mois",
      text: "Les constats du mois en quelques phrases : évolution de l'effectif, des départs et de l'absentéisme, nouveaux passages au niveau Élevé.",
      href: "/synthese",
      cta: "Ouvrir la synthèse du mois",
    },
    {
      title: "Repérez les collaborateurs à rencontrer",
      text: "La liste des collaborateurs classés au niveau Élevé, triés par rang, avec les facteurs associés à leur estimation.",
      href: "/employees?niveau=ELEVE",
      cta: "Voir les collaborateurs au niveau Élevé",
    },
    {
      title: "Traitez les recommandations",
      text: "Pour chaque action proposée, indiquez si elle a été réalisée (avec la date) ou rejetée (avec un commentaire). Le suivi est tracé.",
      href: "/recommendations",
      cta: "Ouvrir les recommandations",
    },
  ],
  MANAGER: [
    {
      title: "Lisez la synthèse du mois",
      text: "Les constats du mois pour votre équipe en quelques phrases : effectif, départs, absentéisme et niveaux de risque.",
      href: "/synthese",
      cta: "Ouvrir la synthèse du mois",
    },
    {
      title: "Consultez votre équipe",
      text: "Le niveau de risque de chaque collaborateur et les grandes catégories de facteurs associés, pour préparer vos échanges.",
      href: "/employees",
      cta: "Ouvrir Mon équipe",
    },
    {
      title: "Suivez vos alertes",
      text: "Les changements à examiner dans votre équipe : passage au niveau Élevé, hausse inhabituelle de l'absentéisme.",
      href: "/alerts",
      cta: "Voir mes alertes",
    },
  ],
  ADMIN: [
    {
      title: "Vérifiez la santé des données",
      text: "Le dernier import AJIR, son score qualité et l'état du calcul mensuel. Un import bloqué empêche toute mise à jour des écrans.",
      href: "/data-health",
      cta: "Ouvrir Santé des données",
    },
    {
      title: "Gérez les comptes",
      text: "Créez les comptes, générez les liens d'activation (valables 7 jours) et déverrouillez les comptes bloqués.",
      href: "/admin/users",
      cta: "Ouvrir Utilisateurs et accès",
    },
    {
      title: "Réglez les paramètres",
      text: "Capacité d'entretiens RH, seuil de qualité des imports et seuils des signaux. Chaque modification est tracée.",
      href: "/admin/settings",
      cta: "Ouvrir les paramètres",
    },
  ],
};

// ---------- Écrans (plan de l'application par rôle) ----------

export type Screen = { href: string; label: string; labels?: Partial<Record<Role, string>>; purpose: string; help?: SectionId } & Audience;
export const SCREENS: Screen[] = [
  { href: "/dashboard", label: "Tableau de bord", purpose: "Indicateurs clés : effectif, départs, absentéisme, formations et niveaux de risque.", roles: PILOTAGE, help: "tableau-de-bord" },
  {
    href: "/employees",
    label: "Collaborateurs",
    labels: { MANAGER: "Mon équipe" },
    purpose: "Liste des collaborateurs avec leur niveau de risque, et fiche détaillée de chacun.",
    roles: PILOTAGE,
    help: "risque",
  },
  { href: "/absenteeism", label: "Absentéisme", purpose: "Taux d'absence par équipe ou par département et anomalies détectées.", roles: PILOTAGE, help: "absenteisme" },
  { href: "/formations", label: "Formations", purpose: "Formations obligatoires : taux de réalisation, échéances à venir, retards, formations à risque de dépasser leur échéance et relances proposées.", roles: PILOTAGE },
  { href: "/charge", label: "Charge de travail", purpose: "Heures supplémentaires par équipe : 12 derniers mois, prévision à 3 mois avec fourchette, équipes en tension et recommandations (surcharges individuelles réservées à la RH).", roles: PILOTAGE },
  { href: "/retention", label: "Rétention", purpose: "Part des embauchés encore présents après 6, 12, 24, 36 ou 48 mois (courbes de maintien), par cohorte d'embauche, département, premier contrat ou famille de métier.", roles: PILOTAGE },
  { href: "/previsions", label: "Prévisions effectifs", purpose: "Projection à 12 mois de l'effectif et de la masse salariale par département, avec fourchette, scénario modifiable (embauches, hausse de janvier, budget) et recommandations.", roles: ["RH"] },
  { href: "/recommendations", label: "Recommandations", purpose: "Suivi des actions proposées, décidées et réalisées.", roles: ["RH"], help: "recommandations" },
  { href: "/admin", label: "Console", purpose: "Vue d'ensemble de l'administration : connexions, refus d'accès, traitements.", roles: ["ADMIN"] },
  { href: "/admin/users", label: "Utilisateurs et accès", purpose: "Comptes, rôles et liens d'activation.", roles: ["ADMIN"], help: "confidentialite" },
  { href: "/admin/settings", label: "Paramètres", purpose: "Capacité d'entretiens RH, seuils de qualité et de signal.", roles: ["ADMIN"], help: "risque" },
  { href: "/admin/audit", label: "Journal d'audit", purpose: "Trace des consultations sensibles, des modifications et des accès refusés.", roles: ["ADMIN"], help: "confidentialite" },
  { href: "/data-health", label: "Santé des données", purpose: "Imports AJIR, contrôles qualité et état du calcul mensuel.", roles: STAFF, help: "qualite-donnees" },
  { href: "/transparency", label: "Transparence du modèle", purpose: "Méthode de calcul du risque, performances, équité et paramètres de décision.", roles: STAFF, help: "modele" },
  { href: "/backtesting", label: "Vérification a posteriori", purpose: "Comparaison des niveaux de risque passés avec les démissions observées ensuite.", roles: ["RH"], help: "modele" },
  { href: "/alerts", label: "Alertes", purpose: "Alertes de votre périmètre et leur suivi.", help: "alertes" },
  { href: "/confidentialite", label: "Droit d'accès", purpose: "Demandes d'accès, d'opposition et de rectification d'un collaborateur : données détenues, export de la réponse, opposition au traitement prédictif et registre des demandes, chaque action étant tracée.", roles: ["RH"], help: "confidentialite" },
  { href: "/compte", label: "Mon compte", purpose: "Profil, droits de votre rôle, mot de passe et activité récente." },
];

// ---------- Indicateurs du tableau de bord ----------

export type KpiHelp = { id: string; label: string; definition: string; formula: string; scope: string; exclusions?: string; unit: string; period: string } & Audience;
export const KPIS: KpiHelp[] = [
  {
    id: "effectif",
    label: "Effectif",
    definition: "Nombre de collaborateurs présents le dernier jour du mois.",
    formula: "Collaborateurs en CDI ou CDD dont le contrat a commencé et qui ne sont pas sortis à la fin du mois.",
    scope: "Population choisie avec les filtres.",
    exclusions: "Stages et SIVP.",
    unit: "collaborateurs",
    period: "Dernier mois de la période ; la variation est calculée depuis le premier mois.",
  },
  {
    id: "turnover",
    label: "Turnover glissant 12 mois",
    definition: "Rythme des départs sur un an, toutes causes confondues.",
    formula: "Sorties des 12 derniers mois divisées par l'effectif moyen de ces 12 mois.",
    scope: "Population choisie avec les filtres ; le turnover volontaire ne compte que les démissions et abandons de poste.",
    exclusions: "Stages et SIVP. Il faut 12 mois d'historique pour l'afficher.",
    unit: "% ; variation en points (pt)",
    period: "Valeur du dernier mois ; la courbe montre la valeur de chaque mois.",
  },
  {
    id: "absenteisme",
    label: "Absentéisme hors santé non planifié",
    definition: "Part du temps de travail perdue en absences non prévues.",
    formula: "Jours d'absence comptés divisés par les jours ouvrables (présents × jours ouvrés du mois, hors week-ends et jours fériés).",
    scope: "Tous les contrats, stages et SIVP compris.",
    exclusions: "Maladie et maternité (données de santé), congés annuels. Sont comptés : absence injustifiée, congé sans solde, autre absence.",
    unit: "%",
    period: "Cumul de la période ; la courbe est mensuelle.",
  },
  {
    id: "masse",
    label: "Masse salariale brute",
    definition: "Coût salarial brut du mois.",
    formula: "Somme des salaires bruts des bulletins du mois.",
    scope: "Tous les contrats présents dans le mois, gratifications de stage comprises.",
    exclusions: "Charges patronales.",
    unit: "dinars (TND)",
    period: "Dernier mois de la période, et cumul de la période.",
    roles: ["RH"],
  },
  {
    id: "entrees-sorties",
    label: "Entrées / sorties",
    definition: "Arrivées et départs pendant la période.",
    formula: "Entrée : début du premier CDI ou CDD. Sortie : dernier jour dans l'entreprise, quel que soit le motif. Départ volontaire : démission ou abandon de poste.",
    scope: "Population choisie avec les filtres.",
    exclusions: "Stages et SIVP ; le passage d'un stage ou d'un SIVP à un CDD ou CDI compte comme une entrée.",
    unit: "collaborateurs",
    period: "Somme de la période.",
  },
  {
    id: "formations",
    label: "Formations obligatoires réalisées",
    definition: "Respect des formations obligatoires.",
    formula: "Formations obligatoires terminées divisées par les formations obligatoires arrivées à échéance pendant la période.",
    scope: "Population choisie avec les filtres.",
    exclusions: "Le statut pris en compte est celui connu aujourd'hui : une formation terminée en retard compte comme réalisée.",
    unit: "%",
    period: "Cumul de la période.",
  },
  {
    id: "niveaux",
    label: "Collaborateurs par niveau de risque",
    definition: "Nombre de collaborateurs actifs à chaque niveau de risque (Élevé, Moyen, Faible) et nombre de non évalués.",
    formula: "Résultat du dernier calcul mensuel publié.",
    scope: "Collaborateurs actifs de la population choisie.",
    exclusions: "Les non évalués (stages, SIVP, CDD courts, nouveaux arrivants, départs à la retraite proches, démissions connues, oppositions au calcul) sont comptés à part.",
    unit: "collaborateurs",
    period: "Fin du mois du dernier calcul publié (date affichée sous le titre).",
  },
  {
    id: "lift-moyen",
    label: "Lift moyen par département",
    definition: "Exposition moyenne du département par rapport à l'ensemble des collaborateurs évalués.",
    formula: "Moyenne, dans le département, du rapport entre le risque estimé de chaque collaborateur et le risque moyen.",
    scope: "Collaborateurs évalués du département.",
    exclusions: "Non affiché avec un score à règles.",
    unit: "multiplicateur (× 1 = moyenne)",
    period: "Dernier calcul publié.",
    roles: ["RH"],
  },
];

// ---------- Familles de facteurs et variables ----------

export const GROUP_HELP: Record<string, string> = {
  CARRIERE: "ancienneté, type de contrat, grade, promotions, changements de poste",
  REMUNERATION: "position du salaire par rapport au poste, augmentations",
  TEMPS_TRAVAIL: "heures supplémentaires, retards, régularité des horaires, jours sans pointage",
  ABSENCES: "absences non planifiées hors santé, absences courtes et répétées",
  FORMATION_EVAL: "formations suivies, formations obligatoires, évaluations annuelles",
  EQUIPE: "départs dans l'équipe, changement de manager, taille de l'équipe",
};

export const VARIABLE_HELP: Record<string, string> = {
  tenure_months: "Ancienneté, en mois depuis l'embauche.",
  contract_cdd: "Contrat à durée déterminée (CDD) en cours.",
  grade_level: "Niveau du grade, de G1 à G8.",
  months_since_promotion: "Mois écoulés depuis la dernière promotion (à défaut, depuis l'embauche).",
  job_change_12m: "Changement de poste au cours des 12 derniers mois.",
  compa_ratio: "Salaire de base comparé au salaire médian des collaborateurs de même famille de métier et de même grade (compa-ratio).",
  raise_pct_12m: "Augmentations de salaire cumulées sur 12 mois, en %.",
  months_since_raise: "Mois écoulés depuis la dernière augmentation.",
  overtime_h_avg_3m: "Heures supplémentaires pointées par mois, en moyenne sur 3 mois.",
  overtime_trend_6m: "Évolution des heures supplémentaires sur 6 mois (hausse ou baisse, en heures par mois).",
  late_count_3m: "Jours avec plus de 10 minutes de retard, sur 3 mois.",
  arrival_std_min_3m: "Irrégularité des heures d'arrivée sur 3 mois (écart-type, en minutes).",
  no_badge_days_3m: "Jours ouvrés sans pointage ni absence déclarée, sur 3 mois.",
  absence_rate_3m: "Taux d'absence hors santé et hors congés annuels, sur 3 mois.",
  absence_rate_12m: "Taux d'absence hors santé et hors congés annuels, sur 12 mois.",
  short_episodes_12m: "Absences courtes (3 jours ou moins), sur 12 mois.",
  bradford_12m: "Facteur de Bradford sur 12 mois : pèse davantage les absences courtes et répétées.",
  training_hours_12m: "Heures de formation terminées, sur 12 mois.",
  mandatory_training_overdue: "Formation obligatoire dont l'échéance est dépassée sans être terminée.",
  last_eval_score: "Note de la dernière évaluation annuelle, sur 5.",
  eval_delta: "Écart entre les deux dernières notes d'évaluation.",
  eval_missing: "Aucune évaluation disponible.",
  team_exit_rate_6m: "Part de départs volontaires dans l'équipe du même manager, sur 6 mois.",
  manager_change_12m: "Changement de manager au cours des 12 derniers mois.",
  team_size: "Nombre de collaborateurs de l'équipe du même manager.",
};

export type GroupHelp = { code: string; label: string; summary: string; variables: { name: string; text: string }[] };

// Familles de facteurs dans l'ordre de features.json ; libellés manager pour le manager, sans la famille Absences qui ne lui est jamais montrée
export function factorGroups(role: Role): GroupHelp[] {
  return Object.entries(GROUPS)
    .filter(([code]) => role !== "MANAGER" || code !== "ABSENCES")
    .map(([code, g]) => ({
      code,
      label: role === "MANAGER" ? g.label_manager : g.label_rh,
      summary: GROUP_HELP[code] ?? "",
      variables: role === "MANAGER" ? [] : FEATURES.filter((f) => f.group === code).map((f) => ({ name: f.name, text: VARIABLE_HELP[f.name] ?? f.name })),
    }));
}

// ---------- Glossaire RH tunisien ----------

export type GlossaryEntry = { term: string; definition: string } & Audience;
export const GLOSSARY: GlossaryEntry[] = [
  { term: "Abandon de poste", definition: "Absence prolongée sans justification qui conduit à la rupture du contrat. Compté comme un départ volontaire." },
  { term: "Absence injustifiée", definition: "Absence sans justificatif. Comptée dans l'absentéisme hors santé non planifié." },
  { term: "Absentéisme hors santé non planifié", definition: "Jours d'absence injustifiée, de congé sans solde ou d'autre absence, rapportés aux jours ouvrables. Maladie, maternité et congés annuels exclus." },
  { term: "AJIR", definition: "Progiciel de gestion RH et paie d'ArabSoft. Source unique des données de l'application, importées chaque mois." },
  { term: "Capacité d'entretiens RH", definition: "Part des collaborateurs évalués que la RH peut recevoir en entretien chaque mois (2\u00a0% par défaut). Elle fixe le nombre maximal de collaborateurs au niveau Élevé : 20 pour 1\u00a0000 évalués." },
  { term: "CDD", definition: "Contrat à durée déterminée. Évalué seulement si son terme dépasse les 6 prochains mois." },
  { term: "CDI", definition: "Contrat à durée indéterminée." },
  { term: "Censure", definition: "Dans une courbe de maintien, collaborateur encore présent à la date des données : il compte jusqu'à cette date, sans être compté comme un départ.", roles: PILOTAGE },
  { term: "Charges patronales", definition: "Cotisations sociales à la charge de l'employeur (CNSS). Utilisées pour chiffrer le coût annuel dans la simulation « et si ? ».", roles: ["RH"] },
  { term: "Collaborateur évalué", definition: "Collaborateur pris en compte dans le calcul mensuel du risque de départ. Les autres apparaissent « Non évalué »." },
  { term: "Compa-ratio", definition: "Salaire de base divisé par le salaire médian des collaborateurs de même famille de métier et de même grade. 0,9 = 10\u00a0% sous la médiane.", roles: ["RH"] },
  { term: "Congé annuel", definition: "Absence planifiée. Jamais comptée dans l'absentéisme." },
  { term: "Congé sans solde", definition: "Absence non rémunérée. Comptée dans l'absentéisme hors santé non planifié." },
  { term: "Courbe de maintien (Kaplan-Meier)", definition: "Part des embauchés encore présents selon leur ancienneté, estimée en tenant compte des arrivées trop récentes pour être suivies aussi longtemps (méthode de Kaplan-Meier).", roles: PILOTAGE },
  { term: "Démission", definition: "Départ à l'initiative du collaborateur. C'est l'événement que le calcul du risque cherche à anticiper, avec l'abandon de poste." },
  { term: "Départ volontaire", definition: "Démission ou abandon de poste. Les fins de CDD, licenciements, retraites, décès et mutations sont des départs non volontaires." },
  { term: "ETP (équivalent temps plein)", definition: "Unité qui ramène les temps partiels à des postes à temps plein : deux mi-temps font 1 ETP. Sert à comparer les heures supplémentaires d'équipes de tailles différentes." },
  { term: "Facteur de Bradford", definition: "Nombre d'absences au carré multiplié par le nombre de jours d'absence, sur 12 mois. Pèse davantage les absences courtes et répétées. Signal individuel réservé à la RH, toujours « à vérifier ».", roles: ["RH"] },
  { term: "Fourchette de prévision", definition: "Intervalle où la valeur future a de bonnes chances de se trouver (fourchette probable à 80\u00a0%). Exemple : effectif prévu 1\u00a0055, fourchette de 1\u00a0022 à 1\u00a0088." },
  { term: "Famille de métier", definition: "Regroupement de postes proches. Sert de référence pour comparer les salaires.", roles: ["RH"] },
  { term: "Grade", definition: "Niveau de classification, de G1 (le plus bas) à G8." },
  { term: "Heures supplémentaires", definition: "Temps pointé au-delà de l'horaire normal, ramené à une moyenne mensuelle." },
  { term: "INPDP", definition: "Instance Nationale de Protection des Données Personnelles, autorité de contrôle tunisienne." },
  { term: "Jours fériés", definition: "Fêtes civiles et religieuses tunisiennes. Non travaillés : ils ne comptent pas dans les jours ouvrables." },
  { term: "Jours ouvrés", definition: "Du lundi au vendredi, hors jours fériés." },
  { term: "Loi organique n° 2004-63", definition: "Loi du 27 juillet 2004 relative à la protection des données à caractère personnel, qui encadre ce traitement." },
  { term: "Maladie, maternité", definition: "Absences pour raison de santé. Jamais utilisées pour estimer un risque ni pour un signal individuel." },
  { term: "Lift", definition: "Nombre de fois où le risque estimé dépasse la moyenne des collaborateurs évalués. Un lift de 3 : risque 3 fois plus élevé que la moyenne.", roles: ["ADMIN", "RH"] },
  { term: "Masse salariale", definition: "Somme des salaires bruts du mois, en dinars (TND), hors charges patronales.", roles: ["RH"] },
  { term: "Matricule", definition: "Identifiant du collaborateur dans AJIR." },
  { term: "Niveau de risque", definition: "Élevé, Moyen, Faible ou Non évalué : classement mensuel du risque de départ volontaire dans les 6 mois. C'est une estimation, pas une certitude." },
  { term: "Point (pt)", definition: "Écart entre deux pourcentages. Passer de 8,0\u00a0% à 8,4\u00a0% est une hausse de 0,4 point, et non de 0,4\u00a0%." },
  { term: "Pont", definition: "Jour ouvré isolé entre un jour férié et un week-end. Pris en compte pour interpréter l'absentéisme." },
  { term: "Préavis", definition: "Délai entre la démission et la sortie. Estimé à 1 mois quand la date de démission n'est pas connue." },
  { term: "Ramadan", definition: "Mois de jeûne aux horaires réduits. L'absentéisme attendu est ajusté pendant cette période." },
  { term: "Rétention", definition: "Part des embauchés (CDI ou CDD) encore présents après une ancienneté donnée : 12 mois, 24 mois… C'est le complément du taux de départ de la cohorte.", roles: PILOTAGE },
  { term: "Séance unique", definition: "Horaire continu réduit (juillet-août et Ramadan). L'absentéisme attendu est ajusté pendant cette période." },
  { term: "SIVP", definition: "Stage d'initiation à la vie professionnelle, contrat aidé d'insertion des diplômés. Exclu de l'effectif, du turnover et du calcul du risque." },
  { term: "SMIG", definition: "Salaire minimum interprofessionnel garanti. Un salaire de base inférieur, hors stage et SIVP, est rejeté à l'import.", roles: ["ADMIN", "RH"] },
  { term: "Stage", definition: "Période de stage, avec une gratification possible. Exclu de l'effectif, du turnover et du calcul du risque." },
  { term: "TND", definition: "Dinar tunisien, unité de tous les montants.", roles: ["ADMIN", "RH"] },
  { term: "Turnover (rotation du personnel)", definition: "Sorties sur 12 mois divisées par l'effectif moyen sur 12 mois. Le turnover volontaire ne compte que les démissions et abandons de poste." },
];

// ---------- Questions fréquentes ----------

// Formulées comme on les pose ; réponse courte, avec un exemple chiffré quand il aide.
const NB = "\u00a0";

export type FaqTopic = "priorites" | "indicateurs" | "donnees";
export const FAQ_TOPICS: Record<FaqTopic, string> = {
  priorites: "Priorités et risque de départ",
  indicateurs: "Lire les indicateurs",
  donnees: "Données, comptes et accès",
};

export type Faq = { q: string; a: string; topic: FaqTopic } & Audience;
export const FAQ: Faq[] = [
  {
    topic: "priorites",
    q: "Qui dois-je rencontrer en priorité ce mois-ci ?",
    a: `Les collaborateurs classés au niveau Élevé, puis Moyen. Leur nombre suit la capacité d'entretiens RH : avec 1${NB}000 collaborateurs évalués et une capacité de 2${NB}%, 20 au plus sont classés Élevé. Dans Collaborateurs, filtrez sur le niveau Élevé : la liste est triée par rang.`,
    roles: ["RH"],
  },
  {
    topic: "priorites",
    q: "Quels collaborateurs de mon équipe dois-je voir en priorité ?",
    a: `Ceux classés au niveau Élevé, puis Moyen, dans Mon équipe. Le niveau Élevé est rare : environ 20 collaborateurs sur 1${NB}000 dans l'entreprise. Une équipe de 9 personnes n'en compte souvent aucun.`,
    roles: ["MANAGER"],
  },
  {
    topic: "priorites",
    q: "Un collaborateur classé Élevé va-t-il partir ?",
    a: "Pas forcément : c'est une estimation, pas une certitude. Exemple : si 6 des 20 collaborateurs classés Élevé démissionnent dans les 6 mois, les 14 autres restent. Le niveau sert à choisir avec qui échanger en premier, jamais à juger une personne.",
    roles: ["RH", "MANAGER"],
  },
  {
    topic: "priorites",
    q: "Pourquoi un collaborateur est-il « Non évalué » ?",
    a: "Il est hors du calcul : stage ou SIVP, CDD qui se termine dans les 6 mois, arrivée depuis moins d'un mois, 60 ans ou plus dans les 6 mois, démission déjà connue, ou opposition au calcul. Exemple : au calcul de fin août, un CDD qui se termine le 31 décembre n'est pas évalué.",
    roles: ["RH", "MANAGER"],
  },
  {
    topic: "priorites",
    q: "Il y a moins de collaborateurs au niveau Élevé que la capacité prévue : est-ce normal ?",
    a: "Oui, la capacité est un plafond. Exemple : pour un plafond de 20, si les 19e, 20e et 21e collaborateurs ont exactement la même estimation, aucun des trois n'est classé Élevé : 18 le sont. Ainsi, le niveau ne dépend jamais de l'ordre des matricules.",
    roles: ["RH", "ADMIN"],
  },
  {
    topic: "priorites",
    q: "Que montre la simulation « et si ? » de la fiche collaborateur ?",
    a: `Comment l'estimation changerait si une donnée changeait. Exemple : avec une hausse de salaire de 5${NB}%, l'estimation passe de 15${NB}% à 12${NB}%. C'est un ordre de grandeur, pas l'effet garanti d'une action.`,
    roles: ["RH"],
  },
  {
    topic: "priorites",
    q: "Que faire d'une recommandation qui ne convient pas ?",
    a: "Rejetez-la avec un commentaire (3 caractères au moins), puis indiquez si elle était pertinente. Ces retours améliorent les propositions suivantes. Une recommandation n'est jamais une obligation.",
    roles: ["RH"],
  },
  {
    topic: "priorites",
    q: "Puis-je annoncer son niveau de risque à un collaborateur ?",
    a: "Mieux vaut aborder la situation concrète (charge de travail, évolution, formation) que le niveau lui-même, qui est une aide interne à la décision. En cas de doute, contactez la RH.",
    roles: ["MANAGER"],
  },
  {
    topic: "priorites",
    q: "Pourquoi je ne vois ni salaire ni pourcentage de risque ?",
    a: "Ces informations sont réservées à la RH. Vous voyez le niveau de risque de vos collaborateurs et les grandes catégories de facteurs associés : cela suffit pour préparer un échange.",
    roles: ["MANAGER"],
  },
  {
    topic: "indicateurs",
    q: "Pourquoi les chiffres ne changent-ils pas tous les jours ?",
    a: "Les données viennent de l'export AJIR, importé une fois par mois. Exemple : « Données AJIR au 31/08/2026 » signifie que les chiffres s'arrêtent au 31 août, même consultés le 15 septembre.",
  },
  {
    topic: "indicateurs",
    q: `Le turnover passe de 8,0${NB}% à 8,4${NB}% : comment le lire ?`,
    a: `C'est une hausse de 0,4 point (pt), et non de 0,4${NB}%. Le turnover glissant rapporte les sorties des 12 derniers mois à l'effectif moyen : pour 1${NB}000 collaborateurs en moyenne, 0,4 point représente 4 départs de plus sur un an.`,
    roles: ["RH", "MANAGER"],
  },
  {
    topic: "indicateurs",
    q: "Comment est calculé le taux d'absentéisme ?",
    a: `Jours d'absence non prévus, hors santé, divisés par les jours ouvrables. Exemple : 10 collaborateurs × 22 jours ouvrés = 220 jours ; 11 jours d'absence injustifiée donnent 11 ÷ 220 = 5,0${NB}%. Maladie, maternité et congés annuels ne sont jamais comptés.`,
    roles: ["RH", "MANAGER"],
  },
  {
    topic: "indicateurs",
    q: "Pourquoi certains indicateurs de mon équipe sont-ils masqués ?",
    a: "Pour protéger l'anonymat : aucun taux d'absence, turnover ni nombre de sorties n'est affiché pour un groupe de moins de 5 personnes, ni quand il pourrait se déduire d'un autre chiffre. Exemple : une équipe de 4 personnes affiche « — » à la place de son taux d'absence.",
    roles: ["MANAGER"],
  },
  {
    topic: "indicateurs",
    q: "Pourquoi l'absentéisme du tableau de bord diffère-t-il de celui de la page Absentéisme ?",
    a: "Le tableau de bord rapporte les absences à l'effectif présent en fin de mois ; la page Absentéisme compte les jours de présence de chacun. Exemple : un collaborateur arrivé le 15 compte pour un mois entier au tableau de bord, pour un demi-mois sur la page Absentéisme.",
    roles: ["RH"],
  },
  {
    topic: "donnees",
    q: "Un import est « Bloqué » : que faire ?",
    a: `Son score qualité est sous le seuil : par exemple 93${NB}% pour un seuil de 95${NB}%. Ouvrez son détail dans Santé des données, faites corriger l'export dans AJIR, puis importez-le de nouveau. En attendant, les écrans gardent le dernier calcul publié.`,
    roles: ["RH", "ADMIN"],
  },
  {
    topic: "donnees",
    q: "Une information sur un collaborateur est fausse : que faire ?",
    a: "Corrigez-la dans AJIR : la correction apparaîtra après le prochain import mensuel. L'application lit les données AJIR sans jamais les modifier.",
    roles: ["RH"],
  },
  {
    topic: "donnees",
    q: "Une information sur un collaborateur de mon équipe est fausse : que faire ?",
    a: "Signalez-la à la RH, qui la corrige dans AJIR. La correction apparaîtra ici après le prochain import mensuel.",
    roles: ["MANAGER"],
  },
  {
    topic: "donnees",
    q: "Un collaborateur demande quelles données le concernent : que faire ?",
    a: "Préparez la réponse depuis l'écran Droit d'accès. Elle regroupe les données de ce collaborateur utilisées par l'application ; chaque demande est tracée.",
    roles: ["RH"],
  },
  {
    topic: "donnees",
    q: "Un collaborateur demande quelles données le concernent : que faire ?",
    a: "Transmettez la demande à la RH, qui prépare la réponse depuis l'écran Droit d'accès.",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    topic: "donnees",
    q: "Pourquoi n'ai-je pas accès au tableau de bord ni aux fiches ?",
    a: "Par séparation des tâches : l'administrateur gère l'outil (comptes, paramètres, imports, modèle) sans voir de données RH individuelles.",
    roles: ["ADMIN"],
  },
  {
    topic: "donnees",
    q: "Comment créer le compte d'un nouveau manager ?",
    a: "Dans Utilisateurs et accès, créez le compte avec le rôle Manager et le matricule du collaborateur, qui doit être actif. Un lien d'activation valable 7 jours s'affiche : transmettez-le au manager.",
    roles: ["ADMIN"],
  },
  {
    topic: "donnees",
    q: "Un utilisateur a oublié son mot de passe : que faire ?",
    a: "Dans Utilisateurs et accès, générez un nouveau lien d'activation et transmettez-le. Il est valable 7 jours et ne sert qu'une fois ; l'ancien mot de passe reste valable jusqu'à son utilisation.",
    roles: ["ADMIN"],
  },
  {
    topic: "donnees",
    q: "Un compte est verrouillé : que faire ?",
    a: "Après 5 essais infructueux, le compte est bloqué 1 minute, puis 2, 4… jusqu'à 64 minutes. Débloquez-le tout de suite avec « Déverrouiller » dans Utilisateurs et accès.",
    roles: ["ADMIN"],
  },
  {
    topic: "donnees",
    q: "Comment modifier la capacité d'entretiens RH ?",
    a: `Dans Paramètres. Exemple : passer de 0,02 à 0,03 porte le plafond de 20 à 30 collaborateurs au niveau Élevé pour 1${NB}000 évalués. La nouvelle valeur s'applique au prochain calcul mensuel ; la modification est tracée dans le journal d'audit.`,
    roles: ["ADMIN"],
  },
  {
    topic: "priorites",
    q: "Comment la simulation trouve-t-elle les leviers les plus efficaces ?",
    a: `Elle teste une grille d'actions et garde les plus petites qui feraient baisser le niveau de risque. Exemple : une promotion seule, ou 15${NB}% de salaire avec 20 heures supplémentaires de moins par mois. Ce sont des pistes à discuter lors d'un échange, pas une décision ni un effet garanti.`,
    roles: ["RH"],
  },
];

// ---------- Droits par rôle ----------

export const ROLE_SCOPE: Record<Role, { sees: string[]; neverSees: string[] }> = {
  RH: {
    sees: [
      "Tous les collaborateurs de l'entreprise, rémunération comprise.",
      "L'estimation chiffrée du risque, les facteurs détaillés et les recommandations.",
      "Les signaux individuels d'absentéisme, toujours « à vérifier ».",
      "La santé des données, la transparence du modèle et la vérification a posteriori.",
    ],
    neverSees: ["La gestion des comptes, les paramètres et le journal d'audit (réservés à l'administrateur)."],
  },
  MANAGER: {
    sees: [
      "Les collaborateurs de votre hiérarchie, et eux seuls.",
      "Leur niveau de risque et les grandes catégories de facteurs associés.",
      "Les indicateurs de votre équipe, hors rémunération.",
    ],
    neverSees: [
      "Les salaires et le pourcentage de risque.",
      "Les signaux individuels d'absentéisme et la catégorie « Assiduité ».",
      "Les indicateurs d'un groupe de moins de 5 personnes.",
      "Les collaborateurs hors de votre hiérarchie.",
    ],
  },
  ADMIN: {
    sees: [
      "Les comptes, les rôles, les paramètres et le journal d'audit.",
      "Les imports AJIR, la qualité des données et le service de calcul.",
      "La fiche du modèle, sans aucune donnée individuelle.",
    ],
    neverSees: ["Les fiches collaborateurs, les salaires et les estimations individuelles.", "Le tableau de bord, l'absentéisme et les recommandations."],
  },
};

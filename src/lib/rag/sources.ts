import crypto from "node:crypto";
import type { Role } from "@/db/schema";
import type { SectionId } from "@/lib/help/content";
import type { TermId } from "@/lib/help/terms";

// Manifeste des sources du corpus de l'assistant d'aide (src/lib/rag/corpus.json, produit par `npm run rag:index`).
// Documentation seulement : aucune donnée de salarié, aucun chiffre de la base. Un passage reçoit les rôles de son entrée
// (`roles` absent = tous, comme forRole) restreints à ceux de la rubrique de /aide vers laquelle il renvoie.

const PILOTAGE: Role[] = ["RH", "MANAGER"];
const STAFF: Role[] = ["ADMIN", "RH"];
const RH: Role[] = ["RH"];
const ADMIN: Role[] = ["ADMIN"];
const ALL: Role[] = ["ADMIN", "RH", "MANAGER"];

// ---------- Aide intégrée (src/lib/help) ----------

export const HELP_FILES = ["src/lib/help/content.ts", "src/lib/help/terms.ts", "shared/features.json"] as const;

export type HelpKind = "START" | "FAQ" | "SCREENS" | "KPIS" | "FACTORS" | "GLOSSARY" | "TERMS" | "ROLE_SCOPE";
export type HelpSource = { source: string; kind: HelpKind; section: SectionId };

/** Une entrée par contenu de l'aide, dans l'ordre du corpus ; `section` = rubrique de /aide où il est affiché. */
export const HELP_SOURCES: readonly HelpSource[] = [
  { source: "help:commencer", kind: "START", section: "commencer" },
  { source: "help:faq", kind: "FAQ", section: "faq" },
  { source: "help:ecrans", kind: "SCREENS", section: "ecrans" },
  { source: "help:indicateurs", kind: "KPIS", section: "tableau-de-bord" },
  { source: "help:facteurs", kind: "FACTORS", section: "risque" },
  { source: "help:glossaire", kind: "GLOSSARY", section: "glossaire" },
  { source: "help:termes", kind: "TERMS", section: "glossaire" },
  { source: "help:droits", kind: "ROLE_SCOPE", section: "confidentialite" },
];

export type TermPlacement = { section: SectionId; cap?: readonly Role[] };

/** Rubrique de chaque définition de terms.ts ; `cap` restreint un terme de pilotage rangé dans une rubrique commune. */
export const TERM_PLACEMENT: Partial<Record<TermId, TermPlacement>> = {
  niveauRisque: { section: "risque" },
  niveauEleve: { section: "risque" },
  niveauMoyen: { section: "risque" },
  nonEvalue: { section: "risque" },
  capacite: { section: "risque" },
  lift: { section: "risque" },
  liftMoyen: { section: "tableau-de-bord" },
  facteursAssocies: { section: "risque" },
  scoreRegles: { section: "risque" },
  probabilite: { section: "risque" },
  effectif: { section: "tableau-de-bord" },
  turnover: { section: "tableau-de-bord" },
  absenteisme: { section: "tableau-de-bord" },
  entreesSorties: { section: "tableau-de-bord" },
  formationsObligatoires: { section: "tableau-de-bord" },
  masseSalariale: { section: "tableau-de-bord" },
  petitsGroupes: { section: "confidentialite" },
  anomalieCollective: { section: "absenteisme" },
  bradford: { section: "absenteisme" },
  scoreQualite: { section: "qualite-donnees" },
  lignesRejetees: { section: "qualite-donnees" },
  gravite: { section: "qualite-donnees" },
  fraicheur: { section: "qualite-donnees" },
  worker: { section: "qualite-donnees" },
  calculRisques: { section: "qualite-donnees" },
  traitements: { section: "qualite-donnees" },
  auc: { section: "modele" },
  liftCapacite: { section: "modele" },
  observePrevu: { section: "modele" },
  penteCalibration: { section: "modele" },
  calibration: { section: "modele" },
  courbeDecision: { section: "modele" },
  equite: { section: "modele" },
  variables: { section: "modele" },
  tauxBase: { section: "modele" },
  precision: { section: "modele" },
  rappel: { section: "modele" },
  backtest: { section: "modele" },
  dateOrigine: { section: "modele" },
  retention: { section: "glossaire", cap: PILOTAGE },
  kaplanMeier: { section: "glossaire", cap: PILOTAGE },
  censure: { section: "glossaire", cap: PILOTAGE },
  dureeMediane: { section: "glossaire", cap: PILOTAGE },
  profilDepart: { section: "risque" },
  surchargePrevue: { section: "ecrans", cap: PILOTAGE },
  fourchetteCalibree: { section: "glossaire", cap: PILOTAGE },
};

// ---------- Documents (docs/) ----------

export type DocRule = {
  /** Titre Markdown (texte brut, numéro compris), testé sur chaque titre du chemin : la règle la plus profonde l'emporte. */
  heading: RegExp;
  include?: boolean;
  roles?: readonly Role[];
  section?: SectionId;
  /** Tableau dont une colonne restreint les rôles de chaque ligne (« RH, Manager », « RH seulement »…). */
  rolesColumn?: string;
  dropColumns?: readonly string[];
};

export type DocSource = {
  path: string;
  /** Nom lisible, repris dans le titre des passages. */
  label: string;
  roles: readonly Role[];
  section: SectionId;
  /** Sections retenues par défaut ; sinon seules celles d'une règle `include: true`. */
  include: boolean;
  /** Texte placé sous le titre de niveau 1. */
  intro?: boolean;
  /** Toute phrase ou ligne qui touche un sujet réservé à la RH (MANAGER_RESERVED) est retirée des passages du manager. */
  managerGuard?: boolean;
  rules?: readonly DocRule[];
  /** Phrases ou lignes écartées, en plus de DEMO_DROP. */
  drop?: readonly RegExp[];
  /** Parenthèses retirées avant découpage. */
  strip?: readonly RegExp[];
};

/** Sujets réservés à la RH : un passage du manager n'en parle jamais (CONVENTIONS.md, DTO par rôle). */
export const MANAGER_RESERVED =
  /lift|salaire|salarial|rémunération|compa[-_]ratio|bradford|probabilit|prob6|charges patronales|smig|\btnd\b|famille de métier|revision_salariale|assiduité|signal individuel|masse|budget|what-if|« et si|backtest|a posteriori/i;

/** Phrases jamais indexées : chiffres de la base de démonstration ou du simulateur, matricules. */
export const DEMO_DROP: readonly RegExp[] = [
  /base de démonstration|base de démo\b|copie de travail|copie de la base/i,
  /data\/[\w./-]+\.db|ground_truth|mixte_medium|charge_medium/,
  /\bM\d{4,}/,
];

// Résultats chiffrés sur données simulées : intervalles de confiance et mesures datées écartés.
const RESULT_DROP: RegExp[] = [/\[\s*[−-]?\d+(?:,\d+)?\s*;\s*[−-]?\d+(?:,\d+)?\s*\]/, /R² /, /^(?:Code|Tests) : /];
const RESULT_STRIP: RegExp[] = [
  /\s*\([^()]*(?:\d{2}\/\d{2}\/20\d{2}|\b20\d{2}-\d{2}\b|cas sur|(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) 20\d{2}|dans l'historique)[^()]*\)/g,
];

const result = (s: Omit<DocSource, "include" | "drop" | "strip"> & { drop?: RegExp[]; strip?: RegExp[] }): DocSource => ({
  ...s,
  include: false,
  drop: [...RESULT_DROP, ...(s.drop ?? [])],
  strip: [...RESULT_STRIP, ...(s.strip ?? [])],
});

export const DOC_SOURCES: readonly DocSource[] = [
  {
    // Tables (§ 1-2) : schéma technique pour les développeurs, non indexé.
    path: "docs/DICTIONNAIRE.md",
    label: "Dictionnaire des données",
    roles: RH,
    section: "risque",
    include: false,
    managerGuard: true,
    rules: [
      { heading: /^3\. Paramètres/, include: true, roles: STAFF, section: "risque" },
      { heading: /^4\. Contrôles qualité/, include: true, roles: STAFF, section: "qualite-donnees" },
      { heading: /^5\. Dictionnaire des KPI/, include: true, roles: PILOTAGE, section: "tableau-de-bord", rolesColumn: "Rôles", dropColumns: ["#", "Code"] },
      { heading: /^6\. Population/, include: true, roles: RH, section: "risque" },
      { heading: /^6\.1 /, roles: PILOTAGE },
      { heading: /^7\. Les 25 variables/, include: true, roles: RH, section: "risque", dropColumns: ["#", "Sources"] },
      { heading: /^7 bis\./, include: true, roles: RH, section: "ecrans" },
      { heading: /^Absentéisme/, section: "absenteisme" },
      { heading: /^8\. Glossaire/, include: true, roles: PILOTAGE, section: "glossaire", dropColumns: ["À valider"] },
    ],
    drop: [/^Source : /],
  },
  { path: "docs/conformite/note-information.md", label: "Note d'information des salariés", roles: ALL, section: "confidentialite", include: true },
  { path: "docs/conformite/procedure-exercice-des-droits.md", label: "Procédure d'exercice des droits", roles: ALL, section: "confidentialite", include: true, intro: true },
  {
    path: "docs/EXPLOITATION.md",
    label: "Guide d'exploitation",
    roles: ADMIN,
    section: "qualite-donnees",
    include: true,
    rules: [
      { heading: /^4\.[34] /, section: "modele" },
      { heading: /^7\. Rétention/, section: "confidentialite" },
      { heading: /^9\. Réentraînement/, section: "modele" },
      { heading: /^10\. Synthèse/, section: "confidentialite" },
    ],
    drop: [/Durée de référence/],
  },
  {
    path: "docs/INSTALLATION.md",
    label: "Guide d'installation",
    roles: ADMIN,
    section: "qualite-donnees",
    include: true,
    rules: [
      { heading: /^3\.6 bis /, section: "modele" },
      { heading: /^3\.10 bis /, section: "confidentialite" },
    ],
    drop: [/Ordre de grandeur mesuré|Référence mesurée/],
  },
  result({
    path: "docs/RESULTATS_ANOMALIES_QUALITE.md",
    label: "Détection des anomalies d'absentéisme",
    roles: RH,
    section: "absenteisme",
    rules: [{ heading: /^(1\. Ce qui est évalué|8\. Limites)/, include: true }],
    strip: [/ : 22 % des salariés touchés[^.]*/],
  }),
  result({
    path: "docs/RESULTATS_IA_ABSENTEISME.md",
    label: "Prévision de l'absentéisme",
    roles: RH,
    section: "absenteisme",
    rules: [{ heading: /^(6\. Recommandations collectives|7\. Interface et droits|8\. Limites)/, include: true }],
    drop: [/premier essai/],
  }),
  result({
    path: "docs/RESULTATS_IA_CHARGE.md",
    label: "Prévision de la charge de travail",
    roles: RH,
    section: "ecrans",
    rules: [{ heading: /^(1\. Données et définitions|8\. Limites)/, include: true }],
    drop: [/^Lignes \(origine/],
  }),
  result({
    path: "docs/RESULTATS_IA_CONFORME.md",
    label: "Fourchettes de prévision calibrées",
    roles: RH,
    section: "glossaire",
    rules: [{ heading: /^(1\. Méthode|7\. Limites)/, include: true }],
  }),
  result({
    path: "docs/RESULTATS_IA_EFFECTIFS.md",
    label: "Projection des effectifs et de la masse salariale",
    roles: RH,
    section: "ecrans",
    rules: [{ heading: /^(2\. Méthode|7\. Écran|8\. Limites)/, include: true }],
    drop: [/selon les années de l'historique|Effets mensuels/],
    strip: [/, \d+ lignes département × mois, R² [^.]*/, /\s*\(\+?[−-]?\d+,\d+ % par mois\)/],
  }),
  result({
    path: "docs/RESULTATS_IA_FORMATION.md",
    label: "Risque de retard des formations obligatoires",
    roles: RH,
    section: "ecrans",
    rules: [{ heading: /^(Question et cible|Niveaux du produit|Limites)/, include: true }],
    drop: [/^Panel : |^Taux de retard : /],
  }),
  result({
    path: "docs/RESULTATS_IA_INTERVENTIONS.md",
    label: "Comparaison des collaborateurs suivis et non suivis",
    roles: RH,
    section: "recommandations",
    rules: [{ heading: /^(1\. Question|4\. Hypothèses|7\. Limites)/, include: true }],
  }),
  result({
    path: "docs/RESULTATS_IA_LEVIER.md",
    label: "Leviers les plus efficaces",
    roles: RH,
    section: "faq",
    intro: true,
    rules: [{ heading: /^(1\. Méthode|5\. Limites|6\. Cadrage éthique)/, include: true }],
    drop: [/ACTION_LABEL/],
  }),
  result({
    path: "docs/RESULTATS_IA_SYNTHESE.md",
    label: "Synthèse du mois rédigée",
    roles: RH,
    section: "commencer",
    intro: true,
    rules: [{ heading: /^(Garde-fous|Limites)$/, include: true }],
    drop: [/check-install/],
  }),
  result({
    path: "docs/RESULTATS_IA_TYPOLOGIE.md",
    label: "Profils types de départs",
    roles: RH,
    section: "ecrans",
    rules: [{ heading: /^Question et population/, include: true }],
    drop: [/Période couverte/],
  }),
  result({
    path: "docs/RESULTATS_ML.md",
    label: "Modèle de risque de départ",
    roles: STAFF,
    section: "modele",
    rules: [{ heading: /^8\. Limites/, include: true }],
  }),
];

// ---------- Empreinte des sources ----------

/** Fichiers dont dépend le corpus (manifeste et indexeur compris), en chemins relatifs à la racine du projet. */
export const SOURCE_FILES: readonly string[] = [...HELP_FILES, ...DOC_SOURCES.map((d) => d.path), "src/lib/rag/sources.ts", "scripts/rag-index.ts"].sort();

/** SHA-256 du contenu des sources (fins de ligne normalisées) : le corpus versionné est à jour s'il porte la même valeur. */
export function hashSources(read: (file: string) => string): string {
  const h = crypto.createHash("sha256");
  for (const file of SOURCE_FILES) h.update(`${file}\n${read(file).replace(/^﻿/, "").replace(/\r\n?/g, "\n")}\n`);
  return h.digest("hex");
}

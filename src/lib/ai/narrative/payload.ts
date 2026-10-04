import { MONTH_PATTERN, countWords, dateLabel, hours, monthLabel, normalizeNumber, numbersIn, pct, pts, splitSentences } from "./format";
import type { NarrativeFacts } from "./template";

// Charge utile transmise à l'IA générative : liste blanche de champs typés, agrégats non nominatifs déjà affichés pour le
// rôle. Chaque valeur est contrôlée par un motif strict (aucun texte libre ne peut y passer : ni nom, ni matricule, ni
// identifiant, ni libellé de service). Puis vérification du texte généré : chaque nombre doit figurer dans la charge utile.

export const PERIMETERS = { RH: "toute l'entreprise", MANAGER: "votre équipe (périmètre hiérarchique)" } as const;

export const PAYLOAD_SCHEMA = {
  perimetre: "perimetre",
  mois: "mois",
  moisPrecedent: "mois",
  donneesAu: "date",
  calculDeRisquePublie: "booleen",
  calculPrecedentDisponible: "booleen",
  seuilPetitGroupe: "entier",
  effectifFinDeMois: "entier",
  effectifFinMoisPrecedent: "entier",
  variationEffectif: "entierSigne",
  entrees: "entier",
  sorties: "entierOuMasque",
  sortiesVolontaires: "entierOuMasque",
  collaborateursRisqueEleve: "entierOuMasque",
  nouveauxRisqueEleve: "entierOuMasque",
  sortisDuRisqueEleve: "entierOuMasque",
  absenteismeHorsSante: "tauxOuMasque",
  absenteismeHorsSanteMoisPrecedent: "tauxOuMasque",
  variationAbsenteisme: "pointsOuMasque",
  heuresSupParPersonne: "heuresOuMasque",
  heuresSupParPersonneMoisPrecedent: "heuresOuMasque",
  alertesATraiter: "entier",
  alertesCritiques: "entier",
  nouvellesAlertes: "entierOuMasque",
  recommandationsEnAttente: "entier",
  nouvellesRecommandations: "entierOuMasque",
  formationsObligatoiresEnRetard: "entier",
  nouvellesFormationsEnRetard: "entier",
} as const;

type KindType = {
  perimetre: (typeof PERIMETERS)[keyof typeof PERIMETERS];
  mois: string;
  date: string;
  booleen: boolean;
  entier: number;
  entierSigne: number;
  entierOuMasque: number | null;
  tauxOuMasque: string | null;
  pointsOuMasque: string | null;
  heuresOuMasque: string | null;
};

export type NarrativePayload = { [K in keyof typeof PAYLOAD_SCHEMA]: KindType[(typeof PAYLOAD_SCHEMA)[K]] };
export const PAYLOAD_FIELDS = Object.keys(PAYLOAD_SCHEMA) as (keyof NarrativePayload)[];

const isInt = (v: unknown, signed = false): v is number => typeof v === "number" && Number.isSafeInteger(v) && (signed || v >= 0);
const CHECK: Record<keyof KindType, (v: unknown) => boolean> = {
  perimetre: (v) => Object.values(PERIMETERS).includes(v as KindType["perimetre"]),
  mois: (v) => typeof v === "string" && MONTH_PATTERN.test(v),
  date: (v) => typeof v === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(v),
  booleen: (v) => typeof v === "boolean",
  entier: (v) => isInt(v),
  entierSigne: (v) => isInt(v, true),
  entierOuMasque: (v) => v === null || isInt(v),
  tauxOuMasque: (v) => v === null || (typeof v === "string" && /^\d{1,3},\d\u00a0%$/.test(v)),
  pointsOuMasque: (v) => v === null || (typeof v === "string" && /^[+−]?\d{1,3},\d\u00a0pt$/.test(v)),
  heuresOuMasque: (v) => v === null || (typeof v === "string" && /^\d{1,3},\d\u00a0h$/.test(v)),
};

/** Lève une erreur si un champ hors liste blanche est présent, manque ou ne respecte pas son motif. */
export function assertWhitelisted(payload: Record<string, unknown>): asserts payload is NarrativePayload {
  const keys = Object.keys(payload);
  const extra = keys.filter((k) => !(k in PAYLOAD_SCHEMA));
  if (extra.length) throw new Error(`Champ hors liste blanche : ${extra.join(", ")}`);
  for (const k of PAYLOAD_FIELDS) {
    if (!(k in payload)) throw new Error(`Champ manquant : ${k}`);
    if (!CHECK[PAYLOAD_SCHEMA[k]](payload[k])) throw new Error(`Valeur refusée pour ${k}`);
  }
}

export function buildPayload(f: NarrativeFacts): NarrativePayload {
  const payload: NarrativePayload = {
    perimetre: PERIMETERS[f.view],
    mois: monthLabel(f.month),
    moisPrecedent: monthLabel(f.previousMonth),
    donneesAu: dateLabel(f.referenceDate),
    calculDeRisquePublie: f.hasCurrentRun,
    calculPrecedentDisponible: f.hasPreviousRun,
    seuilPetitGroupe: f.minGroupSize,
    effectifFinDeMois: f.headcount,
    effectifFinMoisPrecedent: f.headcountBefore,
    variationEffectif: f.headcount - f.headcountBefore,
    entrees: f.entries,
    sorties: f.exits,
    sortiesVolontaires: f.voluntaryExits,
    collaborateursRisqueEleve: f.hasCurrentRun ? f.high : null,
    nouveauxRisqueEleve: f.newHigh,
    sortisDuRisqueEleve: f.leftHigh,
    absenteismeHorsSante: f.absenteeism == null ? null : pct(f.absenteeism),
    absenteismeHorsSanteMoisPrecedent: f.absenteeismBefore == null ? null : pct(f.absenteeismBefore),
    variationAbsenteisme: f.absenteeism == null || f.absenteeismBefore == null ? null : pts(f.absenteeism - f.absenteeismBefore),
    heuresSupParPersonne: f.overtime == null ? null : hours(f.overtime),
    heuresSupParPersonneMoisPrecedent: f.overtimeBefore == null ? null : hours(f.overtimeBefore),
    alertesATraiter: f.alertsOpen,
    alertesCritiques: f.alertsCritical,
    nouvellesAlertes: f.alertsNew,
    recommandationsEnAttente: f.recommendationsOpen,
    nouvellesRecommandations: f.recommendationsNew,
    formationsObligatoiresEnRetard: f.trainingsOverdue,
    nouvellesFormationsEnRetard: f.trainingsOverdueNew,
  };
  assertWhitelisted(payload);
  return payload;
}

/** Nombres autorisés dans le texte généré : ceux de la charge utile (valeurs absolues, chaînes comprises). */
export function allowedNumbers(payload: NarrativePayload): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(payload)) {
    if (typeof v === "number") out.add(normalizeNumber(v));
    else if (typeof v === "string") for (const n of numbersIn(v)) out.add(n);
  }
  return out;
}

export const MAX_SENTENCES = 6;
export const MAX_WORDS = 20;

const L = "(?<![\\p{L}])";
const R = "(?![\\p{L}])";
const NUMBER_WORDS = new RegExp(
  `${L}(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|vingts|trente|quarante|cinquante|soixante|cent|cents|mille|millions?|milliers?|dizaines?|douzaines?|centaines?|moitié|tiers|quart|double|triple)${R}`,
  "iu",
);
// « non causale » reste permis (vocabulaire imposé) ; les formulations de cause ou d'effet sont refusées
const CAUSAL = new RegExp(
  `${L}(caus(e|es|é|ée|és|ées|er|ent)|provoqu\\p{L}*|entraîn\\p{L}*|en raison d|dû à|due à|dus à|dues à|grâce à|parce qu|s'expliqu\\p{L}*|expliqu\\p{L}*|conséquences?|impact\\p{L}*|évit\\p{L}*)${R}`,
  "iu",
);

export type Verification = { ok: true; sentences: string[] } | { ok: false; reason: string };

// Contrôle du texte généré, avant tout affichage ; un refus entraîne le repli sur les gabarits
export function verifyGenerated(raw: string, payload: NarrativePayload): Verification {
  const text = raw.replace(/[ \t\r\n]+/g, " ").trim();
  if (!text) return { ok: false, reason: "vide" };
  if (/[#*_`|<>[\]{}]|https?:|www\./i.test(text) || /^\s*[-•]/.test(text)) return { ok: false, reason: "mise_en_forme" };
  if (!/[.!?…]$/.test(text)) return { ok: false, reason: "phrase_incomplete" };
  const sentences = splitSentences(text);
  if (sentences.length > MAX_SENTENCES) return { ok: false, reason: "trop_de_phrases" };
  if (sentences.some((s) => countWords(s) > MAX_WORDS)) return { ok: false, reason: "phrase_trop_longue" };
  if (/\d\.\d/.test(text)) return { ok: false, reason: "format_nombre" };
  if (NUMBER_WORDS.test(text)) return { ok: false, reason: "nombre_en_lettres" };
  const allowed = allowedNumbers(payload);
  if (numbersIn(text).some((n) => !allowed.has(n))) return { ok: false, reason: "nombre_non_fourni" };
  if (CAUSAL.test(text)) return { ok: false, reason: "vocabulaire_causal" };
  return { ok: true, sentences };
}

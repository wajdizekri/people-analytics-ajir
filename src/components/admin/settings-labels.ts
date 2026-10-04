// Libellés des paramètres en langage RH, unité d'affichage et effet concret.
// Partagé par le formulaire (client) et l'action d'enregistrement (message de confirmation).
// Les bornes et la validation restent celles de la DAL (SETTINGS_SPEC) : ici, présentation seulement.

export type EffectContext = {
  nScored: number | null; // collaborateurs évalués au dernier calcul publié
  asOf: string | null; // date du dernier calcul publié (AAAA-MM-JJ)
  lastQuality: number | null; // score qualité du dernier import (0-1)
  values: Record<string, number>; // valeurs en cours de saisie (unités de stockage)
};

export type SettingUi = {
  label: string;
  help: string; // explication complète, dans la bulle d'aide
  suffix: string;
  suffixPlural?: string; // à partir de 2 (« 0,2 point », « 5 points »)
  scale?: number; // valeur affichée = valeur stockée × scale (pourcentages)
  effect: (v: number, c: EffectContext) => string;
};

const NBSP = "\u00a0";
export const frNum = (n: number, digits = 2) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
// Saisie « 1 234,5 » ou « 1234.5 » → 1234.5 ; NaN si illisible (une saisie vide se teste avant)
export const parseNum = (s: string) => Number(s.trim().replace(/\s/g, "").replace(",", "."));
const pct = (v: number) => `${frNum(v * 100, 2)}${NBSP}%`;
const date = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const SETTINGS_UI: Record<string, SettingUi> = {
  capacity_rate: {
    label: "Capacité mensuelle d'entretiens (part classée « Élevé »)",
    help: "Part des collaborateurs évalués classés au niveau Élevé chaque mois. Réglez-la sur le nombre d'entretiens que la RH peut mener.",
    suffix: "%",
    scale: 100,
    effect: (v, c) => {
      if (!c.nScored) return `${pct(v)} des évalués classés Élevé`;
      const k = Math.round(v * c.nScored);
      return `≈ ${frNum(k, 0)} ${plural(k, "classé", "classés")} Élevé sur ${frNum(c.nScored, 0)} évalués${c.asOf ? ` (calcul du ${date(c.asOf)})` : ""}`;
    },
  },
  medium_lift: {
    label: "Seuil du niveau « Moyen » (multiple du risque moyen)",
    help: "Hors niveau Élevé, un collaborateur est classé Moyen si son estimation atteint ce multiple de l'estimation moyenne.",
    suffix: "fois",
    effect: (v) => `Moyen dès ${frNum(4 * v, 1)} % si moyenne à 4 %`,
  },
  min_events_for_model: {
    label: "Départs observés avant d'utiliser le modèle statistique",
    help: "En dessous de ce nombre de départs observés, le calcul utilise le score à règles, plus simple que le modèle statistique. La valeur 0 désactive cette règle.",
    suffix: "départs",
    effect: (v) =>
      v === 0
        ? "Modèle statistique toujours utilisé"
        : `Score à règles sous ${frNum(v, 0)} départs observés`,
  },
  indicative_until_events: {
    label: "Départs observés avant une probabilité fiable",
    help: "En dessous de ce nombre de départs observés, la probabilité est présentée comme « indicative ». Ce seuil doit être au moins égal à celui du modèle statistique.",
    suffix: "départs",
    effect: (v) => `Mention « probabilité indicative » sous ${frNum(v, 0)} départs`,
  },
  quality_threshold: {
    label: "Score qualité minimal d'un import AJIR",
    help: "Sous ce score, l'import est bloqué et le calcul des risques suspendu jusqu'au prochain import correct.",
    suffix: "%",
    scale: 100,
    effect: (v, c) =>
      c.lastQuality != null
        ? `Dernier import (${pct(c.lastQuality)}) : ${c.lastQuality >= v ? "accepté" : "bloqué"}`
        : `Import bloqué sous ${pct(v)}`,
  },
  smig_monthly: {
    label: "SMIG mensuel de repli",
    help: "Sert au contrôle « salaire de base ≥ SMIG » seulement si le barème daté ci-dessous est vide ou illisible.",
    suffix: "TND",
    effect: (v) => `Signal si salaire de base < ${frNum(v, 3)}${NBSP}TND, sans barème daté`,
  },
  bradford_threshold: {
    label: "Seuil d'absences répétées (facteur de Bradford)",
    help: "Le facteur de Bradford pèse surtout les absences courtes et fréquentes : nombre d'absences au carré × jours d'absence, hors santé, sur 12 mois. Exemple : 5 absences totalisant 10 jours donnent 5² × 10 = 250 points.",
    suffix: "points",
    effect: (v) => `Signal « à vérifier » au-delà de ${frNum(v, 0)} points`,
  },
  abs_reco_seuil_niveau: {
    label: "Écart avec l'absentéisme de l'entreprise",
    help: "Une équipe ou un département est signalé si son absentéisme prévu dépasse celui de l'entreprise sur 12 mois d'au moins cette part.",
    suffix: "%",
    scale: 100,
    effect: (v) => `Signal dès ${frNum(4 * (1 + v), 1)} % si entreprise à 4 %`,
  },
  abs_reco_seuil_hausse: {
    label: "Hausse d'absentéisme prévue dans une équipe",
    help: "Une équipe est signalée si sa prévision des 3 prochains mois dépasse son propre taux des 12 derniers mois d'au moins cette part.",
    suffix: "%",
    scale: 100,
    effect: (v) => `Signal dès ${frNum(4 * (1 + v), 1)} % si équipe à 4 %`,
  },
  abs_reco_ecart_min: {
    label: "Écart minimal pour proposer une action",
    help: "Évite les signaux dus aux petites équipes : l'écart de taux d'absence doit atteindre au moins cette valeur.",
    suffix: "point",
    suffixPlural: "points",
    scale: 100,
    effect: (v) => `Aucune action sous ${frNum(v * 100)} point d'écart`,
  },
  abs_reco_anomalies_min: {
    label: "Anomalies collectives avant une action de prévention",
    help: "Nombre d'anomalies collectives d'absentéisme sur les 3 derniers mois à partir duquel une action de prévention est proposée.",
    suffix: "anomalies",
    effect: (v) => `Action dès ${frNum(v, 0)} ${plural(v, "anomalie", "anomalies")} en 3 mois`,
  },
  workload_ot_threshold_h: {
    label: "Heures supplémentaires au-delà desquelles un mois est surchargé",
    help: "Heures supplémentaires pointées dans le mois au-delà desquelles le mois compte comme surchargé pour le collaborateur.",
    suffix: "h / mois",
    effect: (v, c) => {
      const m = c.values.workload_ot_months;
      return `Signal au-delà de ${frNum(v, 1)} h / mois${Number.isFinite(m) ? ` pendant ${frNum(m, 0)} mois` : ""}`;
    },
  },
  workload_ot_months: {
    label: "Durée d'une surcharge soutenue",
    help: "Nombre de mois consécutifs au-delà du seuil d'heures supplémentaires pour signaler une surcharge (entretien à prévoir).",
    suffix: "mois",
    effect: (v, c) => {
      const h = c.values.workload_ot_threshold_h;
      return `Signal après ${frNum(v, 0)} mois${Number.isFinite(h) ? ` au-dessus de ${frNum(h, 1)} h` : ""}`;
    },
  },
  retention_inbox_days: {
    label: "Conservation des exports AJIR déposés",
    help: "Les fichiers d'export déposés sur le serveur sont supprimés après ce délai par la purge planifiée.",
    suffix: "jours",
    effect: (v) => `Suppression après ${frNum(v, 0)} jours (≈ ${frNum(v / 30, 0)} mois)`,
  },
  retention_prediction_months: {
    label: "Conservation des estimations individuelles",
    help: "Estimations et facteurs individuels anciens, hors calcul en vigueur, supprimés après ce délai par la purge planifiée.",
    suffix: "mois",
    effect: (v) => `Suppression après ${frNum(v, 0)} mois (${frNum(v / 12, 1)} ans), hors calcul en vigueur`,
  },
};

// nav : libellé court de la navigation des thèmes (le titre complet reste celui de la carte)
export type SettingGroup = { id: string; title: string; nav: string; keys: string[]; block?: "smig" | "budgets" };

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "risque",
    title: "Classement des niveaux de risque",
    nav: "Niveaux de risque",
    keys: ["capacity_rate", "medium_lift"],
  },
  { id: "imports", title: "Contrôle des imports AJIR", nav: "Imports AJIR", keys: ["quality_threshold"] },
  {
    id: "absenteisme",
    title: "Absentéisme",
    nav: "Absentéisme",
    keys: ["bradford_threshold", "abs_reco_seuil_niveau", "abs_reco_seuil_hausse", "abs_reco_ecart_min", "abs_reco_anomalies_min"],
  },
  {
    id: "charge",
    title: "Charge de travail",
    nav: "Charge de travail",
    keys: ["workload_ot_threshold_h", "workload_ot_months"],
  },
  {
    id: "paie",
    title: "Paie et SMIG",
    nav: "Paie et SMIG",
    keys: ["smig_monthly"],
    block: "smig",
  },
  {
    id: "budget",
    title: "Budget de masse salariale",
    nav: "Budget",
    keys: [],
    block: "budgets",
  },
  {
    id: "modele",
    title: "Fiabilité du modèle de départ",
    nav: "Modèle de départ",
    keys: ["min_events_for_model", "indicative_until_events"],
  },
  {
    id: "conservation",
    title: "Durée de conservation des données",
    nav: "Conservation",
    keys: ["retention_inbox_days", "retention_prediction_months"],
  },
];

export function settingUiLabel(key: string): string | null {
  if (key in SETTINGS_UI) return SETTINGS_UI[key].label;
  if (key === "smig_schedule") return "Barème SMIG daté";
  if (key.startsWith("budget_masse_salariale_")) return `Budget de masse salariale ${key.slice("budget_masse_salariale_".length)}`;
  return null;
}

// Valeur stockée → valeur affichée (pourcentages en %), arrondie pour éviter 28,999999…
export function toDisplay(key: string, raw: number): number {
  const s = SETTINGS_UI[key]?.scale ?? 1;
  return Number((raw * s).toFixed(6));
}
export function toRaw(key: string, display: number): number {
  const s = SETTINGS_UI[key]?.scale ?? 1;
  return Number((display / s).toFixed(8));
}

export function unitOf(key: string, display: number): string {
  const ui = SETTINGS_UI[key];
  if (!ui) return "";
  return display >= 2 && ui.suffixPlural ? ui.suffixPlural : ui.suffix;
}

// « 2 % », « 2 fois », « 30 départs »
export function formatSetting(key: string, raw: number): string {
  const ui = SETTINGS_UI[key];
  const d = toDisplay(key, raw);
  return ui ? `${frNum(d, 3)}${NBSP}${unitOf(key, d)}` : frNum(raw, 3);
}

// Bornes compactes, dans l'unité affichée : « 0,5 à 20 % »
export function boundsLabel(key: string, min: number, max: number): string {
  const hi = toDisplay(key, max);
  return `${frNum(toDisplay(key, min), 3)} à ${frNum(hi, 3)}${NBSP}${unitOf(key, hi)}`;
}

// Champ numérique tel que la page le reçoit : valeur en vigueur et bornes en unité de stockage
export type SettingBounds = { key: string; value: string; min: number; max: number; int?: boolean };

// Saisie (unité affichée) → valeur en unité de stockage ; NaN si elle est vide ou illisible
export const typedToRaw = (key: string, typed: string) => (typed.trim() === "" ? NaN : toRaw(key, parseNum(typed)));

// Borne exprimée dans l'unité affichée (« Maximum 20 % » plutôt que « Maximum 0,2 »)
export function boundMessage(f: SettingBounds, which: "Minimum" | "Maximum"): string {
  const d = toDisplay(f.key, which === "Minimum" ? f.min : f.max);
  return `${which} ${frNum(d, 3)} ${unitOf(f.key, d)}.`;
}

// Contrôle immédiat d'une saisie, sous le champ ; null si elle est recevable. La DAL reste seule juge à l'enregistrement.
export function inputError(f: SettingBounds, typed: string): string | null {
  if (typed.trim() === "") return "Saisissez une valeur.";
  const raw = typedToRaw(f.key, typed);
  if (!Number.isFinite(raw)) return "Saisissez un nombre.";
  if (raw < f.min) return boundMessage(f, "Minimum");
  if (raw > f.max) return boundMessage(f, "Maximum");
  if (f.int && !Number.isInteger(raw)) return "Saisissez un nombre entier, sans décimale.";
  return null;
}

// Ligne du récapitulatif avant enregistrement : « <libellé> : 2 % → 3 % » ; saisie à corriger : « <libellé> : maximum 20 % » ;
// null si la saisie est égale à la valeur en vigueur
export function fieldChange(f: SettingBounds, typed: string): { text: string; invalid?: boolean } | null {
  const label = settingUiLabel(f.key) ?? f.key;
  const problem = inputError(f, typed);
  if (problem) return { text: `${label} : ${problem.charAt(0).toLowerCase()}${problem.slice(1).replace(/\.$/, "")}`, invalid: true };
  const raw = typedToRaw(f.key, typed);
  return raw === Number(f.value) ? null : { text: `${label} : ${formatSetting(f.key, Number(f.value))} → ${formatSetting(f.key, raw)}` };
}

// « 1 modification à enregistrer », « 2 modifications à enregistrer »
export const pendingLabel = (n: number) => `${n} modification${n > 1 ? "s" : ""} à enregistrer`;

import type { SynthesisDto } from "@/lib/dal/synthesis";
import { capitalize, count, int, monthLabel, ofLabel, pct, pts } from "./format";

// Synthèse rédigée par gabarits (version par défaut, seule version sans accès à Internet). Entrée : les agrégats de la
// synthèse déjà autorisés pour le rôle, jamais une donnée nominative. 6 phrases de 20 mots au plus, périmètre et période
// dits, vocabulaire « facteurs associés », aucune lecture causale.

export type NarrativeFacts = {
  view: "RH" | "MANAGER";
  month: string;
  previousMonth: string;
  referenceDate: string;
  hasCurrentRun: boolean;
  hasPreviousRun: boolean;
  smallPopulation: boolean;
  minGroupSize: number;
  headcount: number;
  headcountBefore: number;
  entries: number;
  exits: number | null;
  voluntaryExits: number | null;
  high: number | null;
  newHigh: number | null;
  leftHigh: number | null;
  absenteeism: number | null;
  absenteeismBefore: number | null;
  overtime: number | null;
  overtimeBefore: number | null;
  alertsOpen: number;
  alertsCritical: number;
  alertsNew: number | null;
  recommendationsOpen: number;
  recommendationsNew: number | null;
  trainingsOverdue: number;
  trainingsOverdueNew: number;
};

export type Narrative = {
  source: "GABARIT" | "IA";
  sentences: string[];
  /** Modèle d'IA générative qui a reformulé le texte (source IA). */
  model: string | null;
  /** Raison du repli sur les gabarits quand l'IA générative a été tentée sans succès. */
  fallback: string | null;
};

// Copie champ par champ : les listes nominatives de la synthèse (newHigh, leftHigh) et les constats rédigés ne sont jamais repris
export function factsFromSynthesis(s: SynthesisDto, minGroupSize: number): NarrativeFacts {
  const k = s.kpis;
  return {
    view: s.view,
    month: s.month,
    previousMonth: s.previousMonth,
    referenceDate: s.referenceDate,
    hasCurrentRun: s.current != null,
    hasPreviousRun: s.previous != null,
    smallPopulation: s.smallPopulation,
    minGroupSize,
    headcount: k.headcount.now,
    headcountBefore: k.headcount.before,
    entries: k.entries,
    exits: k.exits,
    voluntaryExits: k.voluntaryExits,
    high: k.high,
    newHigh: k.newHigh,
    leftHigh: k.leftHigh,
    absenteeism: k.absenteeism.now,
    absenteeismBefore: k.absenteeism.before,
    overtime: k.overtime.now,
    overtimeBefore: k.overtime.before,
    alertsOpen: k.alerts.open,
    alertsCritical: k.alerts.critical,
    alertsNew: k.alerts.sincePrevious,
    recommendationsOpen: k.recommendations.open,
    recommendationsNew: k.recommendations.sincePrevious,
    trainingsOverdue: k.trainingsOverdue.total,
    trainingsOverdueNew: k.trainingsOverdue.thisMonth,
  };
}

/** Seuil sous lequel l'absentéisme est dit stable (même règle que les constats de la synthèse). */
export const STABLE_ABSENTEEISM = 0.002;

function headcountSentence(f: NarrativeFacts, M: string, P: string): string {
  const scope = f.view === "RH" ? "de toute l'entreprise" : "de votre équipe";
  const diff = f.headcount - f.headcountBefore;
  if (f.headcount === 0)
    return `Fin ${M}, l'effectif ${scope} ne compte aucun collaborateur${diff < 0 ? `, contre ${int(f.headcountBefore)} fin ${P}` : ""}.`;
  const trend = diff > 0 ? `en hausse de ${int(diff)}` : diff < 0 ? `en baisse de ${int(-diff)}` : "stable";
  return `Fin ${M}, l'effectif ${scope} compte ${count(f.headcount, "collaborateur", "collaborateurs", "")}, ${trend} depuis fin ${P}.`;
}

function movementsSentence(f: NarrativeFacts, P: string): string {
  const entries = count(f.entries, "entrée", "entrées", "aucune entrée");
  if (f.exits == null) {
    const head = f.entries === 0 ? `Depuis fin ${P}, aucune entrée n'est enregistrée` : `Depuis fin ${P}, on compte ${entries}`;
    return `${head} ; les sorties restent masquées (groupe de moins de ${f.minGroupSize} personnes).`;
  }
  if (f.entries === 0 && f.exits === 0) return `Aucune entrée ni sortie n'est enregistrée depuis fin ${P}.`;
  const exits = count(f.exits, "sortie", "sorties", "aucune sortie");
  const voluntary = f.exits > 0 ? `, dont ${count(f.voluntaryExits ?? 0, "départ volontaire", "départs volontaires", "aucun départ volontaire")}` : "";
  return `Depuis fin ${P}, on compte ${entries} et ${exits}${voluntary}.`;
}

function riskSentence(f: NarrativeFacts, M: string, P: string): string {
  if (!f.hasCurrentRun || f.high == null) return "Aucun calcul du risque de départ n'est encore publié pour cette période.";
  const who = f.high === 0 ? "Aucun collaborateur n'est" : `${count(f.high, "collaborateur est", "collaborateurs sont", "")}`;
  if (f.newHigh == null || f.leftHigh == null) return `${who} en risque élevé au calcul ${ofLabel(M)} ; aucun calcul précédent ne permet de comparer.`;
  if (f.high === 0)
    return f.leftHigh === 0
      ? `Aucun collaborateur n'est en risque élevé au calcul ${ofLabel(M)}, comme au calcul précédent.`
      : `Aucun collaborateur n'est plus en risque élevé : ${int(f.leftHigh)} ${f.leftHigh > 1 ? "en sont sortis" : "en est sorti"} depuis le calcul ${ofLabel(P)}.`;
  const added = count(f.newHigh, "nouveau", "nouveaux", "aucun nouveau");
  const left = count(f.leftHigh, "sorti de ce niveau", "sortis de ce niveau", "aucun sorti de ce niveau");
  return `${who} en risque élevé : ${added}, ${left} depuis le calcul ${ofLabel(P)}.`;
}

function absenteeismSentence(f: NarrativeFacts, M: string, P: string): string {
  const now = f.absenteeism;
  const before = f.absenteeismBefore;
  if (now == null)
    return f.view === "MANAGER" && f.smallPopulation
      ? `L'absentéisme et les heures supplémentaires sont masqués pour un groupe de moins de ${f.minGroupSize} personnes.`
      : `L'absentéisme hors santé n'est pas disponible pour ${M}.`;
  if (before == null) return `L'absentéisme hors santé atteint ${pct(now)} en ${M}.`;
  const d = now - before;
  if (Math.abs(d) < STABLE_ABSENTEEISM) return `L'absentéisme hors santé reste stable : ${pct(now)} en ${M}, contre ${pct(before)} en ${P}.`;
  return `L'absentéisme hors santé ${d > 0 ? "augmente" : "baisse"} : ${pct(now)} en ${M}, contre ${pct(before)} en ${P} (${pts(d)}).`;
}

function pendingSentence(f: NarrativeFacts): string {
  const items = [
    f.alertsOpen > 0
      ? `${count(f.alertsOpen, "alerte", "alertes", "")} à traiter${f.alertsCritical > 0 ? ` (dont ${count(f.alertsCritical, "critique", "critiques", "")})` : ""}`
      : null,
    f.recommendationsOpen > 0
      ? count(f.recommendationsOpen, `recommandation ${f.view === "RH" ? "à décider" : "en cours"}`, `recommandations ${f.view === "RH" ? "à décider" : "en cours"}`, "")
      : null,
    f.trainingsOverdue > 0 ? count(f.trainingsOverdue, "formation obligatoire en retard", "formations obligatoires en retard", "") : null,
  ].filter((x): x is string => x != null);
  if (!items.length) return "Aucune alerte, recommandation ou formation obligatoire en retard n'attend de traitement.";
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
  return `Il reste ${list}.`;
}

function closingSentence(f: NarrativeFacts): string {
  return f.hasCurrentRun
    ? "Le niveau de risque est une estimation fondée sur des facteurs associés, non causale ; la décision reste humaine."
    : "Ces chiffres décrivent des évolutions, sans lecture causale ; chaque décision reste humaine.";
}

export function draftSentences(f: NarrativeFacts): string[] {
  const M = monthLabel(f.month);
  const P = monthLabel(f.previousMonth);
  return [headcountSentence(f, M, P), movementsSentence(f, P), riskSentence(f, M, P), absenteeismSentence(f, M, P), pendingSentence(f), closingSentence(f)].map(
    capitalize,
  );
}

export function draftNarrative(f: NarrativeFacts): Narrative {
  return { source: "GABARIT", sentences: draftSentences(f), model: null, fallback: null };
}

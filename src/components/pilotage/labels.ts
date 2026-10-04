export const LEVEL_LABELS = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible", NON_EVALUE: "Non évalué" } as const;
export const CONTRACT_LABELS: Record<string, string> = { CDI: "CDI", CDD: "CDD", SIVP: "SIVP", STAGE: "Stage" };
export const ABSENCE_LABELS: Record<string, string> = {
  CONGE_ANNUEL: "Congé annuel",
  ABSENCE_INJUSTIFIEE: "Absence injustifiée",
  CONGE_SANS_SOLDE: "Congé sans solde",
  AUTRE: "Autre absence",
};
export const CAREER_LABELS: Record<string, string> = {
  PROMOTION: "Promotion",
  AUGMENTATION: "Augmentation",
  MUTATION: "Mutation",
  CHANGEMENT_MANAGER: "Changement de manager",
  CHANGEMENT_POSTE: "Changement de poste",
};
export const TRAINING_STATUS_LABELS: Record<string, string> = { PLANIFIEE: "Planifiée", EN_COURS: "En cours", TERMINEE: "Terminée", ABANDONNEE: "Abandonnée" };
export const RECO_STATUS_LABELS: Record<string, string> = { PROPOSEE: "Proposée", REALISEE: "Réalisée", REJETEE: "Rejetée" };
export const FEEDBACK_LABELS: Record<string, string> = { PERTINENTE: "Pertinente", NON_PERTINENTE: "Non pertinente" };
export const ACTION_LABELS: Record<string, string> = {
  ENTRETIEN: "Entretien de rétention",
  REVISION_SALARIALE: "Revue de la rémunération",
  CHARGE_TRAVAIL: "Revue de la charge de travail",
  PLAN_FORMATION: "Plan de formation et de développement",
};
export const actionLabel = (code: string) => ACTION_LABELS[code] ?? code;

const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const formatMonth = (ym: string) => `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const formatDate = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function formatTenure(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mois`;
  return m ? `${y} an${y > 1 ? "s" : ""} ${m} mois` : `${y} an${y > 1 ? "s" : ""}`;
}

const dec = (n: number, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const formatLift = (lift: number) => `${dec(lift)} × le risque moyen`;
// Espace insécable avant « % » et « × » : jamais de retour à la ligne entre le nombre et son unité
export const formatLiftShort = (lift: number) => `${dec(lift)}\u00a0×`;
export const formatProb = (p: number) => `${dec(p * 100)}\u00a0%`;
export const formatPoints = (points: number) => `Score à règles (${dec(points, 0)} point${points > 1 ? "s" : ""})`;
export const formatRate = (r: number | null | undefined, d = 1) => (r == null ? "—" : `${dec(r * 100, d)}\u00a0%`);

// En toutes lettres pour une phrase ; formatLiftShort reste pour les tableaux
export const formatLiftWords = (lift: number) => `${dec(lift)} fois le risque moyen`;

// « a, b et c »
export const joinFr = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`);
// Minuscule initiale pour insérer un libellé dans une phrase (sauf sigle : « CDD », « RH »)
export const lcFirst = (s: string) => (/^[A-ZÀ-Ý]{2}/.test(s) ? s : s.charAt(0).toLocaleLowerCase("fr-FR") + s.slice(1));

// Date du jour (AAAA-MM-JJ) dans le fuseau de l'entreprise, pas en UTC (entre minuit et 1 h, UTC donne la veille)
export const todayTunis = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tunis", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

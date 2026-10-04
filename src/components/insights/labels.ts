import { STATUS_COLORS } from "@/components/charts/pbi";
import type { DriftStatus } from "@/lib/drift/psi";
import type { TensionLevel, TensionSignal } from "@/lib/dal/teams";
import type { Tone } from "@/lib/dal/synthesis";

export const TENSION_LABELS: Record<TensionLevel, string> = { FORTE: "Forte tension", TENSION: "Tension", SURVEILLER: "À surveiller", STABLE: "Stable" };
export const TENSION_TONE: Record<TensionLevel, "red" | "amber" | "sky" | "emerald"> = { FORTE: "red", TENSION: "amber", SURVEILLER: "sky", STABLE: "emerald" };
// Rampe rouge → orange → jaune → vert pâle : les équipes à regarder ressortent, les équipes stables restent discrètes.
// TENSION_TEXT : couleur du texte posé sur chaque fond (contraste ≥ 4,5:1).
export const TENSION_COLORS: Record<TensionLevel, string> = { FORTE: STATUS_COLORS.critique, TENSION: "#fb923c", SURVEILLER: "#fcd96a", STABLE: "#c4e6cf" };
export const TENSION_TEXT: Record<TensionLevel, string> = { FORTE: "#ffffff", TENSION: "#431407", SURVEILLER: "#422006", STABLE: "#14532d" };
export const TENSION_HELP: Record<TensionLevel, string> = {
  FORTE: "3 signaux ou plus",
  TENSION: "2 signaux",
  SURVEILLER: "1 signal",
  STABLE: "aucun signal",
};

export const SIGNAL_LABELS: Record<TensionSignal, string> = {
  RISQUE: "Risque de départ concentré",
  ABSENTEISME: "Absentéisme élevé",
  HEURES_SUP: "Heures supplémentaires élevées",
  FORMATION: "Formations obligatoires en retard",
  RECOMMANDATIONS: "Recommandations en attente",
};

export const DRIFT_LABELS: Record<DriftStatus, string> = { STABLE: "Stable", MODEREE: "Dérive modérée", FORTE: "Dérive forte" };
export const DRIFT_TONE: Record<DriftStatus, "emerald" | "amber" | "red"> = { STABLE: "emerald", MODEREE: "amber", FORTE: "red" };
export const DRIFT_COLORS: Record<DriftStatus, string> = { STABLE: STATUS_COLORS.bon, MODEREE: STATUS_COLORS.attention, FORTE: STATUS_COLORS.critique };

export const TONE_LABELS: Record<Tone, string> = { alerte: "Alerte", attention: "À surveiller", info: "Information", positif: "Bonne nouvelle" };
// Jetons sémantiques (docs/qa/DESIGN_SYSTEM.md) : mêmes teintes en thème clair et sombre
export const TONE_STYLE: Record<Tone, { border: string; icon: string; badge: "danger" | "warning" | "info" | "success" }> = {
  alerte: { border: "border-l-danger", icon: "bg-danger-soft text-danger", badge: "danger" },
  attention: { border: "border-l-warning", icon: "bg-warning-soft text-warning", badge: "warning" },
  info: { border: "border-l-info", icon: "bg-info-soft text-info", badge: "info" },
  positif: { border: "border-l-success", icon: "bg-success-soft text-success", badge: "success" },
};

// Libellé d'action d'un constat de la synthèse (verbe + objet, charte § 2), par clé ; à défaut, celui de la DAL
const STATEMENT_ACTIONS: Record<string, string> = {
  "nouveaux-eleves": "Voir les collaborateurs concernés",
  "premier-calcul": "Voir les collaborateurs en risque élevé",
  "sortis-du-risque": "Voir les collaborateurs sortis du risque élevé",
  mouvements: "Voir les entrées et sorties",
  absenteisme: "Analyser l'absentéisme",
  "heures-sup": "Analyser la charge de travail",
  alertes: "Traiter les alertes",
  formations: "Voir les formations en retard",
  effectif: "Ouvrir le tableau de bord",
};
export function statementAction(s: { key: string; href: string | null; linkLabel: string | null }): string {
  if (s.key === "recommandations") return s.href?.startsWith("/recommendations") ? "Décider des recommandations" : "Voir mon équipe";
  return STATEMENT_ACTIONS[s.key] ?? s.linkLabel ?? "Voir le détail";
}

export const EXIT_REASON_LABELS: Record<string, string> = {
  DEMISSION: "Démission",
  ABANDON: "Abandon de poste",
  FIN_CDD: "Fin de CDD",
  LICENCIEMENT: "Licenciement",
  RETRAITE: "Retraite",
  DECES: "Décès",
  MUTATION: "Mutation",
  AUTRE: "Autre motif",
};

export const LEVEL_CHANGE_LABELS = { BAISSE: "Niveau en baisse", HAUSSE: "Niveau en hausse", STABLE: "Niveau inchangé" } as const;

// Tracés d'icônes au trait (24 px), même style que le menu et la fiche
export const INSIGHT_ICONS = {
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01",
  watch: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  good: "M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3",
  news: "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2 M18 14h-8 M15 18h-5 M10 6h8v4h-8z",
  journey: "M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
  effect: "M3 3v18h18 M7 16l4-4 3 3 5-6 M15 9h4v4",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "M6 9l6 6 6-6",
} as const;
export type InsightIcon = keyof typeof INSIGHT_ICONS;

const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const shortMonth = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dec = (n: number, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const formatHours = (h: number | null | undefined, d = 1) => (h == null ? "—" : `${dec(h, d)} h`);
export const formatDays = (j: number | null | undefined) => (j == null ? "—" : `${dec(j, j % 1 === 0 ? 0 : 1)} j`);
export const formatPsi = (p: number | null | undefined) => (p == null ? "—" : dec(p, p >= 10 ? 1 : 3));
export const formatRatio = (r: number | null | undefined) => (r == null ? "—" : dec(r, 2));
export const formatPoints = (d: number | null | undefined) => (d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${dec(Math.abs(d) * 100)} pt`);
export const formatSignedHours = (d: number | null | undefined) => (d == null ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${dec(Math.abs(d))} h`);

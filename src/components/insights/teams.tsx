import { formatRate } from "@/components/pilotage/labels";
import type { TeamStats, TensionLevel } from "@/lib/dal/teams";
import { TENSION_LABELS, formatHours } from "./labels";

// Écran « Équipes » : pastille de niveau de tension et raison du niveau en mots (à partir des signaux calculés par la DAL)

// Même rampe que la carte des équipes (TENSION_COLORS en clair, TENSION_COLORS_DARK en sombre), en classes pour le rendu serveur
const DOT: Record<TensionLevel, string> = {
  FORTE: "bg-[#b91c1c] dark:bg-[#f87171]",
  TENSION: "bg-[#fb923c] dark:bg-[#fb923c]",
  SURVEILLER: "bg-[#fcd96a] dark:bg-[#6b5d12]",
  STABLE: "bg-[#c4e6cf] dark:bg-[#1f3b31]",
};

export function TensionDot({ level, className = "h-2.5 w-2.5" }: { level: TensionLevel; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-full ring-1 ring-fg/25 ${DOT[level]} ${className}`} />;
}

export function TensionBadge({ level }: { level: TensionLevel }) {
  const strong = level === "FORTE" || level === "TENSION";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
        strong ? "bg-surface font-semibold text-fg ring-line-strong/60" : "bg-surface-2 font-medium text-fg-muted ring-line"
      }`}
    >
      <TensionDot level={level} />
      {TENSION_LABELS[level]}
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;

// Une phrase par signal, avec la valeur de l'équipe et celle de la référence (entreprise pour la RH, périmètre pour le manager)
export function tensionReasons(t: TeamStats, ref: { absenteeismRate: number | null; overtimePerHead: number | null }, refLabel: string): string[] {
  const scored = t.risk.ELEVE + t.risk.MOYEN + t.risk.FAIBLE;
  return t.signals.map((s) => {
    switch (s) {
      case "RISQUE":
        return `${plural(t.risk.ELEVE + t.risk.MOYEN, "collaborateur", "collaborateurs")} sur ${scored} en risque de départ élevé ou moyen (dont ${t.risk.ELEVE} élevé)`;
      case "ABSENTEISME":
        return `absentéisme de ${formatRate(t.absenteeismRate)} (${refLabel} : ${formatRate(ref.absenteeismRate)})`;
      case "HEURES_SUP":
        return `${formatHours(t.overtimePerHead)} supplémentaires par personne et par mois (${refLabel} : ${formatHours(ref.overtimePerHead)})`;
      case "FORMATION":
        return `${plural(t.trainings.overdue, "formation obligatoire", "formations obligatoires")} en retard`;
      case "RECOMMANDATIONS":
        return `${plural(t.openRecommendations, "recommandation", "recommandations")} en attente de décision`;
    }
  });
}

export function reasonSentence(reasons: string[]): string {
  if (!reasons.length) return "Aucun signal de difficulté.";
  const s = reasons.join(" ; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

import { formatRate } from "@/components/pilotage/labels";
import type { TeamStats, TensionLevel } from "@/lib/dal/teams";
import { TENSION_LABELS, formatHours } from "./labels";

// Écran « Équipes » : pastille de niveau de tension et signaux du niveau (à partir des signaux calculés par la DAL)

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

// Un libellé + valeur par signal, avec la valeur de référence (entreprise pour la RH, périmètre pour le manager)
export function tensionReasons(t: TeamStats, ref: { absenteeismRate: number | null; overtimePerHead: number | null }, refLabel: string): string[] {
  const scored = t.risk.ELEVE + t.risk.MOYEN + t.risk.FAIBLE;
  return t.signals.map((s) => {
    switch (s) {
      case "RISQUE":
        return `Risque élevé ou moyen : ${(t.risk.ELEVE + t.risk.MOYEN).toLocaleString("fr-FR")} sur ${scored} (élevé : ${t.risk.ELEVE})`;
      case "ABSENTEISME":
        return `Absentéisme : ${formatRate(t.absenteeismRate)} (${refLabel} : ${formatRate(ref.absenteeismRate)})`;
      case "HEURES_SUP":
        return `Heures sup. : ${formatHours(t.overtimePerHead)} / pers. / mois (${refLabel} : ${formatHours(ref.overtimePerHead)})`;
      case "FORMATION":
        return `Formations obligatoires en retard : ${t.trainings.overdue.toLocaleString("fr-FR")}`;
      case "RECOMMANDATIONS":
        return `Recommandations en attente : ${t.openRecommendations.toLocaleString("fr-FR")}`;
    }
  });
}

export function reasonSentence(reasons: string[]): string {
  return reasons.length ? reasons.join(" ; ") : "Aucun signal";
}

import { ColorLegend, StatusBadge } from "@/components/ui";
import { VisualCard } from "@/components/charts/pbi";
import { SEMANTIC } from "@/components/charts/theme";
import { ZONE_COLOR, calibrationChart, type CalibrationBin } from "@/components/monitoring/model-options";

// Calibration par groupe de collaborateurs au risque proche : risque annoncé contre démissions observées,
// marge d'incertitude à 95 % (trait vertical), diagonale « accord parfait » et zone d'écart acceptable
export function CalibrationChart({ bins, onTarget, className = "" }: { bins: CalibrationBin[]; onTarget: boolean; className?: string }) {
  return (
    <VisualCard
      headingLevel={3}
      className={className}
      title="Risque annoncé et observé (%)"
      subtitle="Un point par groupe de risque proche"
      badge={<StatusBadge tone={onTarget ? "success" : "warning"}>{onTarget ? "Dans la cible" : "Hors cible"}</StatusBadge>}
      chart={calibrationChart(bins)}
      footnote="IC 95 % par groupe (loi binomiale), indicatif : observations répétées non corrigées. Taille du point : nombre d'observations."
    >
      <ColorLegend
        className="mt-2"
        items={[
          { color: SEMANTIC.neutre, label: "Modèle (IC 95 %)" },
          { color: SEMANTIC.reference, dashed: true, label: "Accord parfait" },
          { color: ZONE_COLOR, label: "Écart acceptable (0,8 à 1,25)" },
        ]}
      />
    </VisualCard>
  );
}

import { ColorLegend } from "@/components/ui";
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
      title={onTarget ? "Les points suivent la diagonale : les pourcentages sont fiables" : "Les points s'écartent de la diagonale : pourcentages à prendre avec prudence"}
      subtitle="Risque annoncé et démissions observées (%), par groupe de collaborateurs au risque proche"
      chart={calibrationChart(bins)}
      footnote="Marge calculée par groupe (loi binomiale), indicative : les observations répétées d'un même collaborateur ne sont pas corrigées. Taille du point : nombre d'observations du groupe."
    >
      <ColorLegend
        className="mt-2"
        items={[
          { color: SEMANTIC.neutre, label: "Modèle : un point par groupe, trait vertical = marge d'incertitude à 95 %" },
          { color: SEMANTIC.reference, dashed: true, label: "Accord parfait" },
          { color: ZONE_COLOR, label: "Écart acceptable : de 0,8 à 1,25 fois le risque annoncé" },
        ]}
      />
    </VisualCard>
  );
}

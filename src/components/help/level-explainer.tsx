import type { Role } from "@/db/schema";
import { RiskBadge } from "@/components/ui";

const num = (n: number, max = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: max });
export const formatCapacity = (rate: number) => `${num(rate * 100)} %`;

// Signification des niveaux de risque avec les paramètres en vigueur. Le mot « lift » n'est montré qu'à la RH et à l'administrateur.
export function LevelExplainer({ capacityRate, mediumLift, role }: { capacityRate: number; mediumLift: number; role: Role }) {
  const cap = formatCapacity(capacityRate);
  const times = num(mediumLift);
  const rows = [
    {
      badge: <RiskBadge level="ELEVE" />,
      text: (
        <>
          <strong>{cap}</strong> des évalués au plus, chaque mois (capacité d&apos;entretiens RH). Priorité d&apos;échange, pas départ annoncé.
        </>
      ),
    },
    {
      badge: <RiskBadge level="MOYEN" />,
      text: (
        <>
          Risque ≥ <strong>{times} fois</strong> la moyenne{role === "MANAGER" ? "" : ` (lift ≥ ${times})`}, hors Élevé.
        </>
      ),
    },
    { badge: <RiskBadge level="FAIBLE" />, text: <>Autres évalués. Départ toujours possible.</> },
    {
      badge: <RiskBadge level={null} />,
      text: <>Hors calcul : stage, SIVP, CDD finissant sous 6 mois, arrivée récente, 60 ans sous 6 mois, démission connue, opposition.</>,
    },
  ];
  return (
    <dl className="divide-y divide-line rounded-card border border-line bg-surface">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
          <dt>{r.badge}</dt>
          <dd className="text-sm text-fg-muted">{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

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
          Les collaborateurs les plus exposés : au plus <strong>{cap}</strong> des collaborateurs évalués chaque mois (capacité d&apos;entretiens RH).
          C&apos;est une liste de priorités pour échanger, pas une liste de départs annoncés.
        </>
      ),
    },
    {
      badge: <RiskBadge level="MOYEN" />,
      text: (
        <>
          Risque estimé au moins <strong>{times} fois</strong> supérieur à la moyenne des collaborateurs évalués
          {role === "MANAGER" ? "" : ` (lift ≥ ${times})`}, sans faire partie du niveau Élevé.
        </>
      ),
    },
    { badge: <RiskBadge level="FAIBLE" />, text: <>Tous les autres collaborateurs évalués. Faible ne veut pas dire nul : des départs restent possibles.</> },
    {
      badge: <RiskBadge level={null} />,
      text: (
        <>
          Hors du calcul. Contrat : stage, SIVP ou CDD qui se termine dans les 6 mois. Situation : arrivée depuis moins d&apos;un mois, 60 ans atteints dans
          les 6 mois, démission connue. Ou opposition du collaborateur au calcul.
        </>
      ),
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

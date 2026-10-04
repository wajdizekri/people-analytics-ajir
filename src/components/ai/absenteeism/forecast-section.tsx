import { EmptyState, cardCls, fmt } from "@/components/ui";
import type { AbsForecastDto, AbsForecastUnit } from "@/lib/dal/ai-absenteeism";
import type { CoverageCell } from "@/lib/ai/conformal";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { fr } from "@/components/ai/workload/insight-kit";
import { forecastChart } from "./chart";
import { ForecastPicker } from "./forecast-picker";

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export type ForecastTrend = "hausse" | "baisse" | "stable";
const FORECAST_TITLE = "Prévision de l'absentéisme (%)";

// Lecture d'une prévision : moyenne prévue sur 3 mois comparée à la moyenne des 12 derniers mois observés.
// Écart de moins de 0,2 point ou de moins de 20 % : « stable ».
export function readForecast(u: AbsForecastUnit) {
  const avg12 = mean(u.observed.slice(-12).map((p) => p.rate));
  const fc = mean(u.forecast.map((f) => f.value));
  const next = u.forecast[0] ?? null;
  let trend: ForecastTrend = "stable";
  if (avg12 != null && fc != null) {
    const d = fc - avg12;
    if (Math.abs(d) >= 0.002 && Math.abs(d) >= 0.2 * avg12) trend = d > 0 ? "hausse" : "baisse";
  }
  return { avg12, fc, next, trend };
}

// Visuel « prévision à 3 mois » de /absenteeism : courbe observé + prévu avec fourchette, tableau « Voir les données ».
// coverage : couverture mesurée par portée du modèle qui a produit les prévisions (version calibrée), badge sous le graphique.
export function AbsenteeismForecastCard({ d, preferKey, coverage }: { d: AbsForecastDto; preferKey?: string; coverage?: Partial<Record<AbsForecastUnit["scope"], CoverageCell>> | null }) {
  const rh = d.view === "RH";
  const units = [...d.units].sort((a, b) => (a.key === preferKey ? -1 : b.key === preferKey ? 1 : 0));
  const title = <h2 className="mb-3 text-base font-semibold text-fg">{FORECAST_TITLE}</h2>;
  return (
    <section className={`${cardCls} min-w-0 p-4 sm:p-5`} aria-label={FORECAST_TITLE}>
      {d.teamTooSmall ? (
        <>
          {title}
          <EmptyState title={`Prévision masquée : moins de ${MIN_GROUP_SIZE} personnes`} icon="users" compact />
        </>
      ) : !units.length ? (
        <>
          {title}
          <EmptyState title="Aucune prévision disponible" icon="chart" compact />
        </>
      ) : (
        <ForecastPicker
          title={FORECAST_TITLE}
          items={units.map((u) => {
            const r = readForecast(u);
            return { key: u.key, label: u.label, spec: forecastChart(u, r.avg12), trend: r.fc == null ? null : r.trend, coverage: coverage?.[u.scope] ?? null };
          })}
          help={[
            `Taux d'absence mensuel (%) : 24 mois observés puis 3 mois prévus, données au ${fr.date(d.asOf)}.`,
            "La fourchette probable à 80 % contient la valeur réelle environ 8 fois sur 10 : plus elle est large, plus la prévision est incertaine.",
            "Équipe et département sont pris au mois de chaque donnée : les taux peuvent différer légèrement de ceux du haut de page.",
            rh ? "" : `Un mois où l'équipe comptait moins de ${MIN_GROUP_SIZE} personnes n'est pas affiché.`,
            d.modelVersion ? `Prévision : ${fmt.model(d.modelVersion)}.` : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      )}
    </section>
  );
}

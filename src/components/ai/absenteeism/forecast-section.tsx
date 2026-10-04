import { EmptyState, Notice, cardCls, fmt } from "@/components/ui";
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

// Lecture d'une prévision : moyenne prévue sur 3 mois comparée à la moyenne des 12 derniers mois observés.
// Écart de moins de 0,2 point ou de moins de 20 % : « stable ».
export function readForecast(u: AbsForecastUnit) {
  const avg12 = mean(u.observed.slice(-12).map((p) => p.rate));
  const fc = mean(u.forecast.map((f) => f.value));
  const next = u.forecast[0] ?? null;
  const last = u.forecast[u.forecast.length - 1] ?? null;
  let trend: ForecastTrend = "stable";
  if (avg12 != null && fc != null) {
    const d = fc - avg12;
    if (Math.abs(d) >= 0.002 && Math.abs(d) >= 0.2 * avg12) trend = d > 0 ? "hausse" : "baisse";
  }
  const until = last ? fr.monthLong(last.month) : "";
  const message =
    fc == null
      ? `${u.label} : prévision indisponible`
      : trend === "stable"
        ? `${u.label} : taux stable, autour de ${fr.rate(fc)} jusqu'en ${until}`
        : `${u.label} : ${trend} prévue, autour de ${fr.rate(fc)} jusqu'en ${until}`;
  const detail = [
    avg12 != null ? `Moyenne des 12 derniers mois : ${fr.rate(avg12)}.` : null,
    next && next.lower != null && next.upper != null
      ? `${fr.monthLong(next.month).replace(/^./, (c) => c.toUpperCase())} : ${fr.rate(next.value)}, fourchette probable à 80 % de ${fr.rate(next.lower)} à ${fr.rate(next.upper)}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { avg12, fc, next, trend, message, detail };
}

// Visuel « prévision à 3 mois » de /absenteeism : courbe observé + prévu avec fourchette, tableau « Voir les données ».
// coverage : couverture mesurée par portée du modèle qui a produit les prévisions (version calibrée), ligne sous le graphique.
export function AbsenteeismForecastCard({ d, preferKey, coverage }: { d: AbsForecastDto; preferKey?: string; coverage?: Partial<Record<AbsForecastUnit["scope"], CoverageCell>> | null }) {
  const rh = d.view === "RH";
  const units = [...d.units].sort((a, b) => (a.key === preferKey ? -1 : b.key === preferKey ? 1 : 0));
  const title = <h2 className="mb-3 text-base font-semibold text-fg">Prévision de l&apos;absentéisme à 3 mois</h2>;
  return (
    <section className={`${cardCls} min-w-0 p-4 sm:p-5`} aria-label="Prévision de l'absentéisme à 3 mois">
      {d.teamTooSmall ? (
        <>
          {title}
          <Notice tone="warning">
            Votre équipe directe compte moins de {MIN_GROUP_SIZE} personnes en poste : aucune prévision n&apos;est affichée, pour protéger l&apos;anonymat.
          </Notice>
        </>
      ) : !units.length ? (
        <>
          {title}
          <EmptyState title="Aucune prévision disponible pour le moment" icon="chart" compact>
            {d.asOf
              ? "Aucune prévision n'a été calculée pour votre périmètre."
              : "Les prévisions apparaissent après le calcul mensuel, une fois le modèle « absentéisme » mis en service par l'administrateur."}
          </EmptyState>
        </>
      ) : (
        <ForecastPicker
          items={units.map((u) => {
            const r = readForecast(u);
            return { key: u.key, label: u.label, spec: forecastChart(u, r.avg12), message: r.message, detail: r.detail, coverage: coverage?.[u.scope] ?? null };
          })}
          subtitle={`Taux d'absence mensuel (%), 24 mois observés puis 3 mois prévus · données au ${fr.date(d.asOf)}`}
          footnote={[
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

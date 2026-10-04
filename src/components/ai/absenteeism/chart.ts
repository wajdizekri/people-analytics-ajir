import { barChart, lineChart, type ChartSpec } from "@/components/charts/pbi";
import type { AbsForecastUnit } from "@/lib/dal/ai-absenteeism";
import { fr } from "@/components/ai/workload/insight-kit";
import { topReferenceLabels } from "@/components/ai/workload/options";

// Visuels de /absenteeism construits avec les helpers partagés (formats français, tableau « Voir les données »).
// Les taux arrivent en fraction (0,0077) et sont tracés en % (0,77).
export const shortMonth = fr.monthShort;
const pct = (r: number | null | undefined) => (r == null ? null : Math.round(r * 10000) / 100);
const MEASURE = "Taux d'absence";

// Évolution du taux de l'ensemble du périmètre, moyenne de la période en référence
export function trendChart(p: { labels: string[]; rates: (number | null)[]; average: number | null; seriesName: string; weekly: boolean }): ChartSpec {
  return lineChart({
    categories: p.labels,
    series: [{ name: p.seriesName, values: p.rates.map(pct), tone: "neutre", area: true }],
    measure: MEASURE,
    unit: "%",
    digits: 2,
    references: p.average != null ? [{ value: pct(p.average)!, label: "Moyenne" }] : undefined,
    categoryName: p.weekly ? "Semaine" : "Mois",
    height: 280,
  });
}

// Comparaison des groupes : au-dessus de la moyenne en ambre, le reste grisé ; moyenne en ligne de référence
export function groupBars(p: { rows: { name: string; rate: number; tip: string }[]; average: number | null; averageLabel: string; categoryName: string }): ChartSpec {
  const above = p.average == null ? [] : p.rows.filter((r) => r.rate > p.average!).map((r) => r.name);
  return topReferenceLabels(barChart({
    rows: p.rows.map((r) => ({ name: r.name, value: pct(r.rate), tone: above.includes(r.name) ? "attention" : undefined, tip: r.tip })),
    measure: "Taux d'absence sur la période",
    unit: "%",
    digits: 2,
    highlight: above.length ? above : undefined,
    references: p.average != null ? [{ value: pct(p.average)!, label: p.averageLabel }] : undefined,
    categoryName: p.categoryName,
  }));
}

// Observé (bleu), prévision (gris en tirets) et fourchette probable à 80 % (bande grise), moyenne des 12 derniers mois en référence
export function forecastChart(u: AbsForecastUnit, avg12: number | null): ChartSpec {
  const nObs = u.observed.length;
  const months = [...u.observed.map((p) => p.month), ...u.forecast.map((f) => f.month)];
  const pad = (n: number) => new Array<null>(n).fill(null);
  // Point de raccord observé → prévision : tracé, mais absent de l'infobulle (il répéterait l'observé)
  const anchor = [{ value: pct(u.observed[nObs - 1]?.rate ?? null), skip: true }];
  return lineChart({
    categories: months.map(shortMonth),
    series: [
      { name: "Observé", values: [...u.observed.map((p) => pct(p.rate)), ...pad(u.forecast.length)], tone: "neutre" },
      { name: "Prévision", values: [...pad(nObs - 1), ...anchor, ...u.forecast.map((f) => pct(f.value))], tone: "prevision" },
    ],
    band: {
      lower: [...pad(nObs - 1), ...anchor, ...u.forecast.map((f) => pct(f.lower))],
      upper: [...pad(nObs - 1), ...anchor, ...u.forecast.map((f) => pct(f.upper))],
    },
    measure: MEASURE,
    unit: "%",
    digits: 2,
    references: avg12 != null ? [{ value: pct(avg12)!, label: "Moyenne 12 derniers mois" }] : undefined,
    categoryName: "Mois",
    height: 300,
  });
}

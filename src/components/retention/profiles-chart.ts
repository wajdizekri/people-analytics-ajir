import { barChart, type ChartSpec } from "@/components/charts/builders";
import { NBSP, frNumber } from "@/components/charts/theme";
import type { ProfileAggregate } from "@/lib/ai/typology/aggregate";

// Parts des départs classés par profil : barres horizontales triées, une seule teinte (la mesure, pas une identité de série).
// Libellés de profil sur deux lignes au plus ; tableau « Voir les données » enrichi (effectif, ancienneté, stabilité).

export const STABILITY_TEXT = (s: number | null) => (s == null ? "—" : s >= 0.75 ? "Élevée" : s >= 0.6 ? "Moyenne" : "Faible");
export const departuresText = (n: number) => `${frNumber(n, 0)} départ${n > 1 ? "s" : ""}`;
export const monthsLabel = (m: number | null) => (m == null ? "—" : `${frNumber(Math.round(m), 0)}${NBSP}mois`);
export const shareText = (s: number | null) => (s == null ? "—" : `${frNumber(s * 100, 1)}${NBSP}%`);

export function profilesChart(profiles: ProfileAggregate[]): ChartSpec {
  const shown = profiles.filter((p) => !p.masked && p.share != null);
  const spec = barChart({
    rows: shown.map((p) => ({
      name: p.label,
      value: Math.round(p.share! * 1000) / 10,
      tip: `${shareText(p.share)} · ${departuresText(p.departures ?? 0)} · ancienneté médiane ${monthsLabel(p.medianTenureMonths)}`,
    })),
    measure: "Part des départs volontaires classés",
    unit: "%",
    digits: 1,
    categoryName: "Profil",
  });
  const y = spec.option.yAxis as { axisLabel?: object };
  return {
    ...spec,
    option: { ...spec.option, yAxis: { ...y, axisLabel: { ...y.axisLabel, width: 210, overflow: "break" as const, lineHeight: 15 } } },
    height: Math.max(160, shown.length * 46 + 56),
    table: {
      headers: ["Profil", "Départs", "Part des départs classés", "Ancienneté médiane", "Stabilité du profil"],
      rows: [...shown]
        .sort((a, b) => (b.share ?? 0) - (a.share ?? 0))
        .map((p) => [p.label, frNumber(p.departures ?? 0, 0), shareText(p.share), monthsLabel(p.medianTenureMonths), STABILITY_TEXT(p.stability)]),
    },
  };
}

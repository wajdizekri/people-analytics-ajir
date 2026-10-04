import type { Delta } from "@/components/charts/pbi";

// Variations des cartes KPI. Écarts de taux calculés sur les valeurs affichées (arrondies au dixième de point) :
// jamais « 0,6 % contre 0,7 % : 0,0 pt ».

// Signe moins typographique (−), comme dans les constats de la synthèse
export const signed = (n: number, digits = 0) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "exceptZero" }).replace("-", "−");
export const pointsDiff = (a: number, b: number) => (Math.round(a * 1000) - Math.round(b * 1000)) / 10;

// KpiCard ajoute la flèche et le jugement écrit (« favorable », « à surveiller », « stable »)
export function rateDelta(from: number | null, to: number | null, since: string, good: "up" | "down"): Delta | null {
  if (from == null || to == null) return null;
  const value = pointsDiff(to, from);
  return { value, label: `${signed(value, 1)} pt ${since}`, good };
}

// Variation d'un nombre (collaborateurs, heures) arrondi à `digits` décimales ; good « neutral » : sans jugement (effectif)
export function countDelta(from: number, to: number, since: string, good: Delta["good"], unit = "", digits = 0): Delta {
  const f = 10 ** digits;
  const value = (Math.round(to * f) - Math.round(from * f)) / f;
  return { value, label: `${signed(value, digits)}${unit} ${since}`, good };
}

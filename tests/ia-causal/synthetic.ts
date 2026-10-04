import { mulberry32, type ComparisonUnit } from "@/lib/matching";

// Données synthétiques à effet connu pour la comparaison appariée.
// Confusion : x0 pousse à la fois la probabilité d'être suivi et celle de l'issue (comme un niveau de risque élevé).
// Effet : additif et constant sur la probabilité de l'issue 1 (y ~ Bernoulli(p0(x) + effet × suivi)), p0 ∈ [0,15 ; 0,5]
// donc jamais tronqué pour |effet| ≤ 0,15 : l'effet moyen sur les suivis, appariés ou non, vaut exactement `effect`.
// Issue 2 : sans aucun effet (vérité = 0), mesurée pour une unité sur deux.

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export type SyntheticOptions = { n?: number; strata?: number; effect?: number; seed?: number; treatBase?: number; confounding?: number };

export function syntheticUnits(o: SyntheticOptions = {}): ComparisonUnit[] {
  const { n = 4000, strata = 4, effect = -0.1, seed = 1, treatBase = -2.5, confounding = 1.2 } = o;
  const rand = mulberry32(seed);
  const units: ComparisonUnit[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = gaussian(rand);
    const x1 = gaussian(rand);
    const x2 = rand() < 0.3 ? 1 : 0;
    const x3 = gaussian(rand);
    const treated = rand() < sigmoid(treatBase + confounding * x0 + 0.5 * x1 + 0.4 * x2);
    const p0 = 0.15 + 0.35 * sigmoid(1.5 * x0 + 0.5 * x2);
    const y = rand() < p0 + (treated ? effect : 0) ? 1 : 0;
    const y2 = rand() < 0.2 + 0.4 * sigmoid(x0) ? 1 : 0;
    units.push({
      key: `u${String(i).padStart(6, "0")}`,
      stratum: `2025-${String(1 + (i % strata)).padStart(2, "0")}-28`,
      treated,
      x: [x0, x1, x2, x3],
      date: treated ? `2025-${String(1 + (i % strata)).padStart(2, "0")}-28` : null,
      outcomes: [y, i % 2 === 0 ? y2 : null],
    });
  }
  return units;
}

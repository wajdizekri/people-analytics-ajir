// Statistiques de l'appariement : générateur déterministe, différence standardisée, bootstrap des paires.

// mulberry32 : même graine, même fourchette à chaque affichage de la page
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const variance = (xs: number[]) => {
  if (!xs.length) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length;
};

// Dénominateur de la différence standardisée (Austin, 2009) : √((s²_suivis + s²_témoins) / 2), variances de population.
// Variables constantes dans chaque groupe : écart-type de l'ensemble, sinon 0 (différence nulle).
export function smdDenominator(treated: number[], control: number[]): number {
  const d = Math.sqrt((variance(treated) + variance(control)) / 2);
  return d > 1e-12 ? d : Math.sqrt(variance([...treated, ...control]));
}

export function standardizedDifference(treated: number[], control: number[], denominator = smdDenominator(treated, control)): number {
  if (!treated.length || !control.length) return 0;
  const diff = mean(treated) - mean(control);
  return denominator > 1e-12 ? diff / denominator : 0;
}

// Intervalle percentile du bootstrap des paires (Austin et Small, 2014 : appariement sans remise, rééchantillonnage des paires)
export function pairBootstrap(diffs: number[], replicates: number, level: number, rand: () => number): { low: number; high: number } {
  const n = diffs.length;
  const means = new Float64Array(replicates);
  for (let b = 0; b < replicates; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rand() * n)];
    means[b] = s / n;
  }
  means.sort();
  const alpha = (1 - level) / 2;
  const lo = Math.min(replicates - 1, Math.max(0, Math.floor(alpha * replicates)));
  const hi = Math.min(replicates - 1, Math.max(0, Math.ceil((1 - alpha) * replicates) - 1));
  return { low: means[lo], high: means[hi] };
}

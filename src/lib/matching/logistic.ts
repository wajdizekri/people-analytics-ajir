// Régression logistique ridge (Newton-Raphson, résolution de Cholesky) pour le score de propension.
// Objectif minimisé : Σ log-perte + (λ/2) Σ_j β_j² sur les variables standardisées (moyenne, écart-type de population),
// intercept non pénalisé : même objectif que scikit-learn LogisticRegression(C = 1/λ), rejoué par tests/ia-causal.
// La pénalité garantit la convergence quand les suivis sont peu nombreux ou parfaitement séparés.

export type LogisticFit = {
  intercept: number;
  coef: number[];
  keep: number[];
  mean: number[];
  std: number[];
  iterations: number;
  converged: boolean;
};

export type LogisticOptions = { lambda?: number; maxIter?: number; tol?: number };

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const softplus = (z: number) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

export function standardize(X: number[][]): { mean: number[]; std: number[]; keep: number[] } {
  const n = X.length;
  const p = n ? X[0].length : 0;
  const mean = new Array<number>(p).fill(0);
  const std = new Array<number>(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) mean[j] += row[j];
  for (let j = 0; j < p; j++) mean[j] /= n || 1;
  for (const row of X)
    for (let j = 0; j < p; j++) {
      const d = row[j] - mean[j];
      std[j] += d * d;
    }
  for (let j = 0; j < p; j++) std[j] = Math.sqrt(std[j] / (n || 1));
  const keep = std.flatMap((s, j) => (s > 1e-12 ? [j] : []));
  return { mean, std, keep };
}

function choleskySolve(A: Float64Array, b: Float64Array, d: number): Float64Array {
  const L = new Float64Array(d * d);
  for (let i = 0; i < d; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i * d + j];
      for (let k = 0; k < j; k++) s -= L[i * d + k] * L[j * d + k];
      if (i === j) {
        if (!(s > 0)) throw new Error("Matrice non définie positive");
        L[i * d + i] = Math.sqrt(s);
      } else L[i * d + j] = s / L[j * d + j];
    }
  const z = new Float64Array(d);
  for (let i = 0; i < d; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * d + k] * z[k];
    z[i] = s / L[i * d + i];
  }
  const x = new Float64Array(d);
  for (let i = d - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < d; k++) s -= L[k * d + i] * x[k];
    x[i] = s / L[i * d + i];
  }
  return x;
}

export function fitRidgeLogistic(X: number[][], y: number[], opts: LogisticOptions = {}): LogisticFit {
  const lambda = opts.lambda ?? 1;
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-10;
  const n = X.length;
  if (!n || y.length !== n) throw new Error("Données vides ou de tailles incohérentes");
  const { mean, std, keep } = standardize(X);
  const d = keep.length + 1;
  const Z = new Float64Array(n * d);
  for (let i = 0; i < n; i++) {
    Z[i * d] = 1;
    for (let k = 0; k < keep.length; k++) Z[i * d + k + 1] = (X[i][keep[k]] - mean[keep[k]]) / std[keep[k]];
  }
  const ybar = Math.min(1 - 1e-6, Math.max(1e-6, y.reduce((s, v) => s + v, 0) / n));
  let beta = new Float64Array(d);
  beta[0] = Math.log(ybar / (1 - ybar));

  const eta = (b: Float64Array, i: number) => {
    let s = 0;
    for (let k = 0; k < d; k++) s += b[k] * Z[i * d + k];
    return s;
  };
  const objective = (b: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const e = eta(b, i);
      s += softplus(e) - y[i] * e;
    }
    for (let k = 1; k < d; k++) s += (lambda / 2) * b[k] * b[k];
    return s;
  };

  let current = objective(beta);
  let iterations = 0;
  let converged = false;
  while (iterations < maxIter) {
    iterations++;
    const g = new Float64Array(d);
    const H = new Float64Array(d * d);
    for (let i = 0; i < n; i++) {
      const mu = sigmoid(eta(beta, i));
      const w = mu * (1 - mu);
      const r = mu - y[i];
      const o = i * d;
      for (let a = 0; a < d; a++) {
        const za = Z[o + a];
        g[a] += r * za;
        const wa = w * za;
        for (let c = 0; c <= a; c++) H[a * d + c] += wa * Z[o + c];
      }
    }
    for (let a = 0; a < d; a++) for (let c = 0; c < a; c++) H[c * d + a] = H[a * d + c];
    for (let k = 1; k < d; k++) {
      g[k] += lambda * beta[k];
      H[k * d + k] += lambda;
    }
    H[0] += 1e-12;
    const delta = choleskySolve(H, g, d);
    if (Math.max(...delta.map(Math.abs)) < tol) {
      beta = beta.map((b, k) => b - delta[k]);
      converged = true;
      break;
    }
    // Pas de Newton réduit de moitié tant que l'objectif pénalisé ne baisse pas
    let step = 1;
    let next = beta.map((b, k) => b - delta[k]);
    let value = objective(next);
    while (value > current && step > 1e-8) {
      step /= 2;
      next = beta.map((b, k) => b - step * delta[k]);
      value = objective(next);
    }
    if (value > current) break;
    beta = next;
    current = value;
  }
  return { intercept: beta[0], coef: Array.from(beta.slice(1)), keep, mean, std, iterations, converged };
}

// Logit du score de propension (échelle de l'appariement et du caliper)
export function linearPredictor(fit: LogisticFit, x: number[]): number {
  let s = fit.intercept;
  for (let k = 0; k < fit.keep.length; k++) {
    const j = fit.keep[k];
    s += fit.coef[k] * ((x[j] - fit.mean[j]) / fit.std[j]);
  }
  return s;
}

export const propensity = (fit: LogisticFit, x: number[]) => sigmoid(linearPredictor(fit, x));

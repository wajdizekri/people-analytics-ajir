// Population Stability Index (PSI) : calcul pur, sans accès base.
// PSI = Σ (a_i − e_i) × ln(a_i / e_i), e = parts de la période de référence, a = parts du mois courant, sur les
// classes de la référence. Une part nulle est remplacée par PSI_EPSILON (sinon le logarithme diverge).

export const PSI_THRESHOLDS = { moderate: 0.1, strong: 0.25 } as const;
export const PSI_EPSILON = 1e-4;
export const DEFAULT_BINS = 10;

export type DriftStatus = "STABLE" | "MODEREE" | "FORTE";

// DISCRETE : une classe par valeur observée dans la référence (+ une classe « autre ») ;
// QUANTILE : classes ]-∞ ; e0], ]e0 ; e1], …, ]e_k ; +∞[ sur les déciles de la référence (bornes dédoublonnées)
export type BinSpec = { kind: "DISCRETE"; values: number[] } | { kind: "QUANTILE"; edges: number[] };

export type PsiBin = { from: number | null; to: number | null; value: number | null; other: boolean; refShare: number; curShare: number };
export type PsiResult = { psi: number | null; nRef: number; nCur: number; spec: BinSpec | null; bins: PsiBin[] };

export function driftStatus(psi: number | null): DriftStatus | null {
  if (psi == null) return null;
  if (psi >= PSI_THRESHOLDS.strong) return "FORTE";
  if (psi >= PSI_THRESHOLDS.moderate) return "MODEREE";
  return "STABLE";
}

export function psiFromProportions(ref: number[], cur: number[], eps = PSI_EPSILON): number {
  if (ref.length !== cur.length) throw new Error("Classes de tailles différentes");
  let s = 0;
  for (let i = 0; i < ref.length; i++) {
    const e = Math.max(ref[i], eps);
    const a = Math.max(cur[i], eps);
    s += (a - e) * Math.log(a / e);
  }
  return s;
}

export function binSpec(ref: number[], maxBins = DEFAULT_BINS): BinSpec | null {
  const sorted = ref.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const distinct: number[] = [];
  for (const v of sorted) if (!distinct.length || v !== distinct[distinct.length - 1]) distinct.push(v);
  if (distinct.length <= maxBins) return { kind: "DISCRETE", values: distinct };
  const n = sorted.length;
  const max = sorted[n - 1];
  const edges: number[] = [];
  for (let i = 1; i < maxBins; i++) {
    const e = sorted[Math.min(n - 1, Math.max(0, Math.ceil((i * n) / maxBins) - 1))];
    if (e < max && (!edges.length || e > edges[edges.length - 1])) edges.push(e);
  }
  return { kind: "QUANTILE", edges };
}

export function binIndex(spec: BinSpec, v: number): number {
  if (spec.kind === "DISCRETE") {
    const i = spec.values.indexOf(v);
    return i < 0 ? spec.values.length : i;
  }
  let lo = 0;
  let hi = spec.edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spec.edges[mid] >= v) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const binCount = (spec: BinSpec) => (spec.kind === "DISCRETE" ? spec.values.length + 1 : spec.edges.length + 1);

export function binShares(spec: BinSpec, values: number[]): { shares: number[]; n: number } {
  const counts = new Array<number>(binCount(spec)).fill(0);
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    counts[binIndex(spec, v)]++;
    n++;
  }
  return { shares: counts.map((c) => (n ? c / n : 0)), n };
}

export function computePsi(ref: number[], cur: number[], maxBins = DEFAULT_BINS): PsiResult {
  const spec = binSpec(ref, maxBins);
  if (!spec) return { psi: null, nRef: 0, nCur: cur.filter(Number.isFinite).length, spec: null, bins: [] };
  const r = binShares(spec, ref);
  const c = binShares(spec, cur);
  const bins: PsiBin[] = r.shares.map((refShare, i) => {
    const curShare = c.shares[i];
    if (spec.kind === "DISCRETE") {
      const other = i === spec.values.length;
      return { from: null, to: null, value: other ? null : spec.values[i], other, refShare, curShare };
    }
    return { from: i === 0 ? null : spec.edges[i - 1], to: i < spec.edges.length ? spec.edges[i] : null, value: null, other: false, refShare, curShare };
  });
  const shown = bins.filter((b) => !b.other || b.curShare > 0 || b.refShare > 0);
  return { psi: c.n ? psiFromProportions(r.shares, c.shares) : null, nRef: r.n, nCur: c.n, spec, bins: shown };
}

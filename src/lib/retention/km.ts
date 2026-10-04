// Estimateur de Kaplan-Meier (ex-æquo, censure à droite, entrée retardée) et test du log-rank. Calculs purs, sans unité imposée.

// Sujet à risque sur l'intervalle ]entry, time] : entry = 0 pour un suivi dès l'origine, > 0 pour une entrée retardée (troncature à gauche)
export type Subject = { entry: number; time: number; event: boolean };

export type KmStep = {
  time: number;
  atRisk: number;
  events: number;
  survival: number;
  lower: number | null;
  upper: number | null;
};

export type KmFit = { n: number; events: number; steps: KmStep[] };

export type SurvivalPoint = { survival: number; lower: number | null; upper: number | null };

export const Z95 = 1.959963984540054;

const valid = (s: Subject) => Number.isFinite(s.entry) && Number.isFinite(s.time) && s.time > s.entry;

function upperBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lowerBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Ensemble à risque : n(t) = #{entry < t <= time} = #{entry < t} - #{time < t} (entry < time pour chaque sujet)
export class RiskSet {
  private readonly entries: number[];
  private readonly times: number[];
  constructor(subjects: Subject[]) {
    const kept = subjects.filter(valid);
    this.entries = kept.map((s) => s.entry).sort((a, b) => a - b);
    this.times = kept.map((s) => s.time).sort((a, b) => a - b);
  }
  get size(): number {
    return this.times.length;
  }
  at(t: number): number {
    return lowerBound(this.entries, t) - lowerBound(this.times, t);
  }
  // Effectif suivi juste après p, sur ]p, point suivant] : #{entry <= p} - #{time <= p}
  after(p: number): number {
    return upperBound(this.entries, p) - upperBound(this.times, p);
  }
  // Instants où l'effectif suivi change (0 compris), triés
  changePoints(): number[] {
    return [...new Set([0, ...this.entries, ...this.times])].sort((a, b) => a - b);
  }
}

// Ex-æquo : à un même instant, les sorties précèdent les censures (le censuré reste dans l'ensemble à risque).
// IC de Greenwood par transformation log(-log S) : S^exp(±z·se), se = sqrt(Σ d / (n (n - d))) / |log S|.
export function kaplanMeier(subjects: Subject[], z = Z95): KmFit {
  const kept = subjects.filter(valid);
  const risk = new RiskSet(kept);
  const deaths = new Map<number, number>();
  for (const s of kept) if (s.event) deaths.set(s.time, (deaths.get(s.time) ?? 0) + 1);
  const times = [...deaths.keys()].sort((a, b) => a - b);
  const steps: KmStep[] = [];
  let survival = 1;
  let greenwood = 0;
  let events = 0;
  for (const t of times) {
    const d = deaths.get(t)!;
    const n = risk.at(t);
    if (n <= 0) continue;
    events += d;
    survival *= 1 - d / n;
    greenwood = n > d ? greenwood + d / (n * (n - d)) : Infinity;
    steps.push({ time: t, atRisk: n, events: d, survival, ...logLogBounds(survival, greenwood, z) });
  }
  return { n: kept.length, events, steps };
}

function logLogBounds(survival: number, greenwood: number, z: number): { lower: number | null; upper: number | null } {
  if (survival <= 0) return { lower: 0, upper: 0 };
  if (survival >= 1) return { lower: 1, upper: 1 };
  if (!Number.isFinite(greenwood)) return { lower: null, upper: null };
  const se = Math.sqrt(greenwood) / Math.abs(Math.log(survival));
  return { lower: survival ** Math.exp(z * se), upper: survival ** Math.exp(-z * se) };
}

// S(t) continue à droite : dernière marche d'instant <= t (1 avant la première sortie)
export function survivalAt(fit: KmFit, t: number): SurvivalPoint {
  let lo = 0;
  let hi = fit.steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fit.steps[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return { survival: 1, lower: 1, upper: 1 };
  const s = fit.steps[lo - 1];
  return { survival: s.survival, lower: s.lower, upper: s.upper };
}

// Durée médiane : plus petit t tel que S(t) <= 0,5 ; null si la courbe reste au-dessus (médiane non atteinte)
export function medianTime(fit: KmFit, until = Infinity): number | null {
  const s = fit.steps.find((x) => x.survival <= 0.5 + 1e-12);
  return s && s.time <= until ? s.time : null;
}

// Premier instant p (>= 0) après lequel l'effectif suivi passe sous k : la courbe n'est montrée que sur [0, p].
// Avec `allowEmpty`, un effectif tombé à 0 n'arrête rien (groupe résiduel qui ne révèle aucune sortie).
export function stopTime(risk: RiskSet, k: number, allowEmpty = false): number {
  const points = risk.changePoints();
  for (const p of points) {
    const n = risk.after(p);
    if (n < k && !(allowEmpty && n === 0)) return p;
  }
  return points[points.length - 1] ?? 0;
}

// ---------- Test du log-rank (k groupes, ddl = k - 1) ----------

export type LogRank = { chi2: number; df: number; pValue: number; observed: number[]; expected: number[] };

export function logRank(groups: Subject[][]): LogRank | null {
  const kept = groups.map((g) => g.filter(valid)).filter((g) => g.length > 0);
  const k = kept.length;
  if (k < 2) return null;
  const risks = kept.map((g) => new RiskSet(g));
  const deaths = kept.map((g) => {
    const m = new Map<number, number>();
    for (const s of g) if (s.event) m.set(s.time, (m.get(s.time) ?? 0) + 1);
    return m;
  });
  const times = [...new Set(deaths.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  const observed = new Array<number>(k).fill(0);
  const expected = new Array<number>(k).fill(0);
  const v = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const t of times) {
    const nj = risks.map((r) => r.at(t));
    const dj = deaths.map((m) => m.get(t) ?? 0);
    const n = nj.reduce((a, b) => a + b, 0);
    const d = dj.reduce((a, b) => a + b, 0);
    if (n <= 0 || d === 0) continue;
    const f = n > 1 ? (d * (n - d)) / (n * n * (n - 1)) : 0;
    for (let i = 0; i < k; i++) {
      observed[i] += dj[i];
      expected[i] += (d * nj[i]) / n;
      for (let j = 0; j < k; j++) v[i][j] += f * nj[i] * ((i === j ? n : 0) - nj[j]);
    }
  }
  const u = observed.slice(0, k - 1).map((o, i) => o - expected[i]);
  const sub = v.slice(0, k - 1).map((row) => row.slice(0, k - 1));
  const x = solve(sub, u);
  if (!x) return null;
  const chi2 = Math.max(0, u.reduce((s, ui, i) => s + ui * x[i], 0));
  return { chi2, df: k - 1, pValue: chi2Survival(chi2, k - 1), observed, expected };
}

// Élimination de Gauss avec pivot partiel ; null si la matrice est singulière
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

// ---------- Loi du χ² : P(X > x) = Q(df/2, x/2), gamma incomplète régularisée supérieure ----------

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const xx = x - 1;
  let a = LANCZOS[0];
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  const lead = -x + a * Math.log(x) - lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - sum * Math.exp(lead));
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.min(1, Math.exp(lead) * h);
}

export const chi2Survival = (x: number, df: number) => gammaQ(df / 2, x / 2);

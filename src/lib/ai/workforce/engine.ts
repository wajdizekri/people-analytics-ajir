import type { CoverageCell } from "../conformal";

// Moteur de projection (stock-flux + régression de masse). Même suite d'opérations que ml/workforce/engine.py :
// toute modification doit être reportée des deux côtés (parité vérifiée par golden.json).

export const CAUSES = ["resign", "other", "cdd", "retire", "known"] as const;
export type Cause = (typeof CAUSES)[number];
export type ResignSource = "TAUX" | "LOGREG";

type Quantiles = { dept: number[]; total: number[] };
export type IntervalSpec = { level: number; method?: string } & Partial<Record<ResignSource, Quantiles>>;
// Champ additif des versions calibrées (ml/workforce/conformal.py) : [bas, haut] signés par horizon, en écarts-types
// stock-flux (effectif) ou en part de la prévision (masse). Absent : intervalle symétrique v1 (interval).
type ConformalQuantiles = { dept: [number, number][]; total: [number, number][] };
export type WorkforceConformal = { level: number; quantiles: Partial<Record<ResignSource, ConformalQuantiles>>; coverage?: Record<string, CoverageCell> };

export type EffectifBundle = {
  version: string;
  kind: string;
  horizon: number;
  prob6_months: number;
  windows: { rates_months: number; hires_months: number; hire_salary_months: number; cdd_months: number; min_hires_salary: number };
  retirement: { age: number; lag_days: number; q_prior: number; min_cases: number };
  cdd: { q_prior: number; min_cases: number };
  interval: IntervalSpec;
  conformal?: WorkforceConformal;
  metrics?: Record<string, unknown>;
};

export type MasseBundle = {
  version: string;
  kind: string;
  effectif_version?: string;
  season: number[];
  windows: { level_months: number };
  raise_fallback: number;
  interval: IntervalSpec;
  conformal?: WorkforceConformal;
  metrics?: Record<string, unknown>;
};

export type StateDepartment = {
  id: number;
  code: string;
  name: string;
  hc0: number;
  mass0: number | null;
  resignRate: number;
  otherRate: number;
  hiresPerMonth: number;
  hireSalary: number;
  avgBase: number;
  level: number | null;
};

export type StateMember = { d: number; base: number; p6: number | null; cdd: number | null; ret: number | null; known: number | null; grade: string | null };

export type WorkforceState = {
  asOf: string;
  month0: string;
  resignSource: ResignSource;
  qCdd: number;
  qRet: number;
  raise: number;
  drift: number;
  levelTotal: number | null;
  departments: StateDepartment[];
  members: StateMember[];
};

export type Scenario = { hiringPct?: number; raise?: number | null };

export type SeriesOut = {
  hc0: number;
  mass0: number | null;
  hc: number[];
  hcSd: number[];
  hcLower: number[];
  hcUpper: number[];
  exits: Record<Cause, number[]>;
  hires: number[];
  mass: number[] | null;
  massLower: number[] | null;
  massUpper: number[] | null;
};
export type DeptOut = SeriesOut & { id: number; code: string; name: string };
export type GradeOut = { grade: string; hc0: number; avgBase0: number; hc12: number };
export type Projection = { months: string[]; raise: number; hiringPct: number; departments: DeptOut[]; total: SeriesOut; byGrade: GradeOut[] };

export const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const monthLabel = (i: number) => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;

const zeros = (n: number) => new Array<number>(n).fill(0);
const exitsZeros = (n: number) => Object.fromEntries(CAUSES.map((c) => [c, zeros(n)])) as Record<Cause, number[]>;
const pickInterval = (q: IntervalSpec, source: ResignSource): Quantiles => {
  const v = q[source] ?? q.TAUX;
  if (!v) throw new Error("Bundle sans quantiles d'intervalle.");
  return v;
};
const pickConformal = (b: { conformal?: WorkforceConformal } | null, source: ResignSource): ConformalQuantiles | null =>
  b?.conformal ? (b.conformal.quantiles[source] ?? b.conformal.quantiles.TAUX ?? null) : null;
// Bornes à 80 % : quantiles conformes (v + bas × échelle, v + haut × échelle) s'ils existent, sinon v ± q × échelle (v1)
const band = (v: number, scale: number, q: number, cq: [number, number] | null): [number, number] =>
  cq ? [Math.max(0, v + cq[0] * scale), v + cq[1] * scale] : [Math.max(0, v - q * scale), v + q * scale];

export function project(be: EffectifBundle, bm: MasseBundle | null, state: WorkforceState, scenario: Scenario): Projection {
  const H = be.horizon;
  const m0 = monthIndex(state.month0);
  const months = Array.from({ length: H }, (_, i) => monthLabel(m0 + i + 1));
  const hiring = (scenario.hiringPct ?? 100) / 100;
  const raise = scenario.raise == null ? state.raise : scenario.raise;
  const qe = pickInterval(be.interval, state.resignSource);
  const qm = bm ? pickInterval(bm.interval, state.resignSource) : null;
  const ce = pickConformal(be, state.resignSource);
  const cm = pickConformal(bm, state.resignSource);

  const factor: number[] = [];
  let jan = 0;
  for (let k = 1; k <= H; k++) {
    if ((m0 + k) % 12 === 0) jan += 1;
    factor.push(Math.pow(1 + raise, jan) * Math.pow(1 + state.drift, k));
  }

  const acc = state.departments.map(() => ({ members: zeros(H), vari: zeros(H), base: zeros(H), hiresHc: zeros(H), exits: exitsZeros(H), hires: zeros(H) }));
  const grades = new Map<string, { hc0: number; base0: number; hc12: number }>();

  for (const mb of state.members) {
    const a = acc[mb.d];
    const dep = state.departments[mb.d];
    const h = mb.p6 != null ? 1 - Math.pow(1 - mb.p6, 1 / be.prob6_months) : dep.resignRate;
    const o = dep.otherRate;
    const g = mb.grade ?? "?";
    let gr = grades.get(g);
    if (!gr) grades.set(g, (gr = { hc0: 0, base0: 0, hc12: 0 }));
    gr.hc0 += 1;
    gr.base0 += mb.base;
    let s = 1;
    for (let k = 1; k <= H; k++) {
      const i = k - 1;
      if (mb.known != null) {
        if (k === mb.known) {
          a.exits.known[i] += s;
          s = 0;
        }
      } else {
        const r = s * h;
        a.exits.resign[i] += r;
        let s1 = s - r;
        const x = s1 * o;
        a.exits.other[i] += x;
        s1 = s1 - x;
        if (mb.cdd === k) {
          const c = s1 * state.qCdd;
          a.exits.cdd[i] += c;
          s1 = s1 - c;
        }
        if (mb.ret === k) {
          const t = s1 * state.qRet;
          a.exits.retire[i] += t;
          s1 = s1 - t;
        }
        s = s1;
      }
      a.members[i] += s;
      a.vari[i] += s * (1 - s);
      a.base[i] += s * mb.base;
    }
    gr.hc12 += s;
  }

  const departments: DeptOut[] = state.departments.map((dep, di) => {
    const a = acc[di];
    const r = dep.resignRate;
    const o = dep.otherRate;
    const hiresM = dep.hiresPerMonth * hiring;
    let prev = 0;
    const hc = zeros(H);
    const sd = zeros(H);
    const lo = zeros(H);
    const up = zeros(H);
    for (let k = 1; k <= H; k++) {
      const i = k - 1;
      const er = prev * r;
      const eo = (prev - er) * o;
      a.exits.resign[i] += er;
      a.exits.other[i] += eo;
      const cur = prev - er - eo + hiresM;
      a.hiresHc[i] = cur;
      a.hires[i] = hiresM;
      prev = cur;
      hc[i] = a.members[i] + cur;
      const v = a.vari[i] + cur;
      a.vari[i] = v;
      sd[i] = Math.sqrt(v);
      [lo[i], up[i]] = band(hc[i], sd[i], qe.dept[i], ce ? ce.dept[i] : null);
    }
    let mass: number[] | null = null;
    let mlo: number[] | null = null;
    let mup: number[] | null = null;
    const level = dep.level ?? state.levelTotal;
    if (bm && qm && level != null) {
      mass = zeros(H);
      mlo = zeros(H);
      mup = zeros(H);
      for (let k = 1; k <= H; k++) {
        const i = k - 1;
        const b = factor[i] * (a.base[i] + a.hiresHc[i] * dep.hireSalary);
        a.base[i] = b;
        mass[i] = b * Math.exp(level + bm.season[(m0 + k) % 12]);
        [mlo[i], mup[i]] = band(mass[i], mass[i], qm.dept[i], cm ? cm.dept[i] : null);
      }
    }
    return { id: dep.id, code: dep.code, name: dep.name, hc0: dep.hc0, mass0: dep.mass0, hc, hcSd: sd, hcLower: lo, hcUpper: up, exits: a.exits, hires: a.hires, mass, massLower: mlo, massUpper: mup };
  });

  const withMass = !!bm && !!qm && departments.length > 0 && departments.every((d) => d.mass != null);
  const total: SeriesOut = {
    hc0: departments.reduce((s, d) => s + d.hc0, 0),
    mass0: departments.length > 0 && departments.every((d) => d.mass0 != null) ? departments.reduce((s, d) => s + (d.mass0 as number), 0) : null,
    hc: zeros(H),
    hcSd: zeros(H),
    hcLower: zeros(H),
    hcUpper: zeros(H),
    exits: exitsZeros(H),
    hires: zeros(H),
    mass: withMass ? zeros(H) : null,
    massLower: withMass ? zeros(H) : null,
    massUpper: withMass ? zeros(H) : null,
  };
  for (let i = 0; i < H; i++) {
    let v = 0;
    departments.forEach((d, di) => {
      total.hc[i] += d.hc[i];
      v += acc[di].vari[i];
      total.hires[i] += d.hires[i];
      for (const c of CAUSES) total.exits[c][i] += d.exits[c][i];
      if (withMass) total.mass![i] += d.mass![i];
    });
    total.hcSd[i] = Math.sqrt(v);
    [total.hcLower[i], total.hcUpper[i]] = band(total.hc[i], total.hcSd[i], qe.total[i], ce ? ce.total[i] : null);
    if (withMass && qm) {
      const [mlo, mup] = band(total.mass![i], total.mass![i], qm.total[i], cm ? cm.total[i] : null);
      total.massLower![i] = mlo;
      total.massUpper![i] = mup;
    }
  }
  const byGrade = [...grades.keys()].sort().map((g) => {
    const x = grades.get(g)!;
    return { grade: g, hc0: x.hc0, avgBase0: x.base0 / x.hc0, hc12: x.hc12 };
  });
  return { months, raise, hiringPct: hiring * 100, departments, total, byGrade };
}

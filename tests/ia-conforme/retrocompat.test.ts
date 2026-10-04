import path from "node:path";
import { describe, expect, it } from "vitest";
import { forecastUnit, intervalScale, validateBundle as validateAbs, type AbsBundle, type Scope } from "@/lib/ai/absenteeism/model";
import { predictGroup, validateBundle as validateLoad, type WorkloadBundle, type WorkloadScope } from "@/lib/ai/workload/model";
import { project, type EffectifBundle, type MasseBundle, type Projection, type Scenario, type WorkforceState } from "@/lib/ai/workforce/engine";
import type { Golden as AbsGolden } from "../ai/absenteeism/helpers";
import { MODELS, readJson } from "./helpers";

// Les modèles publiés aujourd'hui (v1, sans champ `conformal`) doivent donner exactement les mêmes bornes qu'avant ;
// une version calibrée applique ses quantiles signés, portée par portée, avec repli sur la v1 pour une portée absente.

const ABS_V1 = path.join(MODELS, "absenteeism", "abs-ridge-v1-20260930");
const LOAD_V1 = path.join(MODELS, "workload", "workload-ridge-v1-20260930");
const WF = path.join(MODELS, "workforce");
const tol = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
// Golden Python ↔ TypeScript : même tolérance que les tests de parité existants (1e-9 relatif)
const tolGolden = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("absentéisme : bornes avec et sans calibration conforme", () => {
  const v1 = readJson<AbsBundle>(path.join(ABS_V1, "model.json"));
  const golden = readJson<AbsGolden>(path.join(ABS_V1, "golden.json"));
  const run = (b: AbsBundle, c: AbsGolden["cases"][number]) => forecastUnit(b, c.h, c.scope, c.own, c.parent, c.company, c.cal_t, c.cal_t12);

  it("sans champ conformal : bornes v1 inchangées (golden de la v1)", () => {
    expect(v1.conformal).toBeUndefined();
    expect(() => validateAbs(v1)).not.toThrow();
    for (const c of golden.cases.slice(0, 60)) {
      const f = run(v1, c);
      expect(tol(f.lower, c.lower) && tol(f.upper, c.upper)).toBe(true);
    }
  });

  it("avec champ conformal : quantiles par portée, repli sur la famille v1 pour une portée absente", () => {
    const q: Partial<Record<Scope, Record<string, [number, number]>>> = { EQUIPE: { "1": [-0.9, 2.4], "2": [-0.8, 2.5], "3": [-0.7, 2.6] } };
    const b = { ...clone(v1), version: "abs-test-conforme", conformal: { level: 0.8, quantiles: q } };
    expect(() => validateAbs(b)).not.toThrow();
    let teams = 0;
    let others = 0;
    for (const c of golden.cases) {
      const f = run(b, c);
      const s = intervalScale(f.value, c.own[1], v1.intervals.rate_floor);
      const [lo, hi] = c.scope === "EQUIPE" ? q.EQUIPE![String(c.h)] : v1.intervals.quantiles.AGREGE[String(c.h)];
      expect(tol(f.lower, Math.max(0, f.value + lo * s)) && tol(f.upper, f.value + hi * s)).toBe(true);
      expect(tol(f.value, c.value)).toBe(true);
      if (c.scope === "EQUIPE") teams++;
      else others++;
    }
    expect(teams).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
  });

  it("refuse des quantiles conformes qui excluraient la prévision", () => {
    const bad = { ...clone(v1), conformal: { level: 0.8, quantiles: { ENTREPRISE: { "1": [0.1, 2] as [number, number] } } } };
    expect(() => validateAbs(bad)).toThrow(/conformes/);
  });
});

type LoadRow = { scope: WorkloadScope; h: number; x: number[]; zbar12: number; s: number | null; value: number; lower: number; upper: number };

describe("charge de travail : bornes avec et sans calibration conforme", () => {
  const v1 = readJson<WorkloadBundle>(path.join(LOAD_V1, "model.json"));
  const rows = readJson<{ rows: LoadRow[] }>(path.join(LOAD_V1, "golden.json")).rows;

  it("sans champ conformal : bornes v1 inchangées (golden de la v1)", () => {
    expect(v1.conformal).toBeUndefined();
    for (const r of rows) {
      const p = predictGroup(v1, r.scope, r.h, r.x, r.zbar12, r.s);
      expect(tol(p.lower, r.lower) && tol(p.upper, r.upper) && tol(p.value, r.value)).toBe(true);
    }
  });

  it("quantiles symétriques [-q, q] : mêmes bornes que la v1 ; quantiles asymétriques : bornes sur l'échelle log", () => {
    const sym = { ...clone(v1), conformal: { level: 0.8, quantiles: {} as Record<WorkloadScope, Record<string, [number, number]>> } };
    for (const scope of ["EQUIPE", "DEPARTEMENT"] as const) {
      sym.conformal.quantiles[scope] = {};
      for (const h of v1.horizons) sym.conformal.quantiles[scope][String(h)] = [-v1.models[scope][String(h)].q, v1.models[scope][String(h)].q];
    }
    expect(() => validateLoad(sym)).not.toThrow();
    const asym = { ...clone(v1), conformal: { level: 0.8, quantiles: { DEPARTEMENT: { "1": [-0.5, 2], "2": [-0.5, 2], "3": [-0.5, 2] } as Record<string, [number, number]> } } };
    for (const r of rows) {
      const a = predictGroup(v1, r.scope, r.h, r.x, r.zbar12, r.s);
      expect(predictGroup(sym, r.scope, r.h, r.x, r.zbar12, r.s)).toEqual(a);
      const b = predictGroup(asym, r.scope, r.h, r.x, r.zbar12, r.s);
      if (r.scope === "EQUIPE") expect(b).toEqual(a);
      else {
        const sc = r.s ?? v1.interval.s_default.DEPARTEMENT;
        const zc = Math.log1p(b.value);
        if (b.value > 0) {
          expect(Math.abs(Math.log1p(b.upper) - (zc + 2 * sc))).toBeLessThan(1e-9);
          if (b.lower > 0) expect(Math.abs(Math.log1p(b.lower) - (zc - 0.5 * sc))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("refuse des quantiles conformes qui excluraient la prévision", () => {
    const bad = { ...clone(v1), conformal: { level: 0.8, quantiles: { EQUIPE: { "1": [-1, -0.1] as [number, number] } } } };
    expect(() => validateLoad(bad)).toThrow(/conformes/);
  });
});

type WfGolden = { state: WorkforceState; scenario: Scenario; output: Projection };

describe("effectifs et masse salariale : bornes avec et sans calibration conforme", () => {
  const be = readJson<EffectifBundle>(path.join(WF, "effectif-v1-20260930", "model.json"));
  const bm = readJson<MasseBundle>(path.join(WF, "masse-v1-20260930", "model.json"));
  const golden = readJson<WfGolden[]>(path.join(WF, "effectif-v1-20260930", "golden.json"));
  const cases = golden.filter((g) => g.state.members.length > 0).slice(0, 6);
  const H = be.horizon;
  const sym = (q: { dept: number[]; total: number[] }) => ({ dept: q.dept.map((v) => [-v, v] as [number, number]), total: q.total.map((v) => [-v, v] as [number, number]) });

  it("sans champ conformal : projection v1 inchangée (golden de la v1)", () => {
    expect(be.conformal).toBeUndefined();
    for (const g of cases) {
      const out = project(be, bm, g.state, g.scenario);
      for (const k of ["hcLower", "hcUpper"] as const) out.total[k].forEach((v, i) => expect(tolGolden(v, g.output.total[k][i])).toBe(true));
    }
  });

  it("quantiles symétriques : mêmes bornes que la v1 ; asymétriques : v + q × échelle ; LOGREG absent → quantiles TAUX", () => {
    const beSym = { ...clone(be), conformal: { level: 0.8, quantiles: { TAUX: sym(be.interval.TAUX!), LOGREG: sym(be.interval.LOGREG!) } } };
    const bmSym = { ...clone(bm), conformal: { level: 0.8, quantiles: { TAUX: sym(bm.interval.TAUX!), LOGREG: sym(bm.interval.LOGREG!) } } };
    const flat = (lo: number, hi: number) => Array.from({ length: H }, () => [lo, hi] as [number, number]);
    const beAsym = { ...clone(be), conformal: { level: 0.8, quantiles: { TAUX: { dept: flat(-1, 2), total: flat(-0.5, 3) } } } };
    const bmAsym = { ...clone(bm), conformal: { level: 0.8, quantiles: { TAUX: { dept: flat(-0.02, 0.05), total: flat(-0.01, 0.04) } } } };
    for (const g of cases) {
      const a = project(be, bm, g.state, g.scenario);
      const b = project(beSym, bmSym, g.state, g.scenario);
      expect(b.total.hcLower).toEqual(a.total.hcLower);
      expect(b.total.hcUpper).toEqual(a.total.hcUpper);
      expect(b.total.massUpper).toEqual(a.total.massUpper);
      b.departments.forEach((d, i) => expect(d.hcUpper).toEqual(a.departments[i].hcUpper));

      const c = project(beAsym, bmAsym, g.state, g.scenario); // cas LOGREG compris : repli sur TAUX
      expect(c.total.hc).toEqual(a.total.hc);
      for (let i = 0; i < H; i++) {
        expect(tol(c.total.hcLower[i], Math.max(0, c.total.hc[i] - 0.5 * c.total.hcSd[i]))).toBe(true);
        expect(tol(c.total.hcUpper[i], c.total.hc[i] + 3 * c.total.hcSd[i])).toBe(true);
        for (const d of c.departments) expect(tol(d.hcUpper[i], d.hc[i] + 2 * d.hcSd[i])).toBe(true);
        if (c.total.mass) expect(tol(c.total.massUpper![i], c.total.mass[i] * 1.04)).toBe(true);
      }
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareMatched, fitRidgeLogistic, linearPredictor, mulberry32, propensity, smdDenominator, standardizedDifference, type ComparisonUnit } from "@/lib/matching";
import { gaussian, sigmoid } from "./synthetic";

// Score de propension : régression logistique ridge en TypeScript, rejouée contre scikit-learn (ml/matching/reference.py)

describe("régression logistique ridge", () => {
  it("retrouve des coefficients connus sur un grand échantillon", () => {
    const rand = mulberry32(3);
    const truth = { b0: -1, b: [1, -0.5, 0.25] };
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 40000; i++) {
      const x = [gaussian(rand), gaussian(rand), gaussian(rand)];
      X.push(x);
      y.push(rand() < sigmoid(truth.b0 + truth.b.reduce((s, b, j) => s + b * x[j], 0)) ? 1 : 0);
    }
    const fit = fitRidgeLogistic(X, y, { lambda: 1e-6 });
    expect(fit.converged).toBe(true);
    const raw = fit.coef.map((c, k) => c / fit.std[fit.keep[k]]);
    const intercept = fit.intercept - raw.reduce((s, c, k) => s + c * fit.mean[fit.keep[k]], 0);
    raw.forEach((c, j) => expect(Math.abs(c - truth.b[j])).toBeLessThan(0.06));
    expect(Math.abs(intercept - truth.b0)).toBeLessThan(0.06);
  });

  it("données parfaitement séparées : la pénalité garantit des coefficients finis", () => {
    const X = [-2, -1.5, -1, 1, 1.5, 2].flatMap((v) => [[v], [v]]);
    const y = X.map(([v]) => (v > 0 ? 1 : 0));
    const fit = fitRidgeLogistic(X, y, { lambda: 1 });
    expect(fit.converged).toBe(true);
    expect(Number.isFinite(fit.coef[0])).toBe(true);
    expect(fit.coef[0]).toBeGreaterThan(0);
    expect(propensity(fit, [2])).toBeGreaterThan(0.5);
    expect(propensity(fit, [-2])).toBeLessThan(0.5);
  });

  it("variable constante écartée du modèle", () => {
    const rand = mulberry32(5);
    const X = Array.from({ length: 300 }, () => [gaussian(rand), 3]);
    const y = X.map(([a]) => (rand() < sigmoid(a) ? 1 : 0));
    const fit = fitRidgeLogistic(X, y);
    expect(fit.keep).toEqual([0]);
    expect(fit.coef).toHaveLength(1);
    expect(Number.isFinite(linearPredictor(fit, [0.3, 3]))).toBe(true);
  });

  it("différence standardisée : formule d'Austin, variances de population", () => {
    const t = [1, 2, 3];
    const c = [0, 0, 3];
    const den = Math.sqrt((2 / 3 + 2) / 2);
    expect(smdDenominator(t, c)).toBeCloseTo(den, 12);
    expect(standardizedDifference(t, c)).toBeCloseTo(1 / den, 12);
    expect(standardizedDifference([1, 1], [0, 0])).toBeCloseTo(2, 12);
    expect(standardizedDifference([2, 2], [2, 2])).toBe(0);
  });
});

type Golden = {
  lambda: number;
  caliper_sd: number;
  units: { key: string; stratum: string; treated: number; x: number[] }[];
  expected: { intercept: number; coef: number[]; caliper: number; pairs: [string, string][]; smd_before: number[]; smd_after: number[]; sklearn: string };
};

describe("fidélité TypeScript ↔ Python (golden de ml/matching/reference.py)", () => {
  const file = path.resolve(__dirname, "fixtures/matching-golden.json");
  const golden = JSON.parse(fs.readFileSync(file, "utf8")) as Golden;
  const X = golden.units.map((u) => u.x);
  const y = golden.units.map((u) => u.treated);
  const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} ≠ ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

  it("coefficients du score de propension identiques à scikit-learn à 1e-6 près", () => {
    const fit = fitRidgeLogistic(X, y, { lambda: golden.lambda });
    close(fit.intercept, golden.expected.intercept, 1e-6);
    expect(fit.coef).toHaveLength(golden.expected.coef.length);
    fit.coef.forEach((c, k) => close(c, golden.expected.coef[k], 1e-6));
  });

  it("caliper, paires et différences standardisées identiques à l'implémentation Python", () => {
    const units: ComparisonUnit[] = golden.units.map((u) => ({ key: u.key, stratum: u.stratum, treated: u.treated === 1, x: u.x, outcomes: [] }));
    const r = compareMatched(units, 0, { caliperSd: golden.caliper_sd, ridge: golden.lambda, minTreated: 1 });
    close(r.caliper as number, golden.expected.caliper, 1e-6);
    const sorted = (ps: string[][]) => [...ps].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    expect(sorted(r.pairs.map((p) => [p.treated, p.control]))).toEqual(sorted(golden.expected.pairs));
    r.balance.forEach((b, k) => {
      close(b.smdBefore, golden.expected.smd_before[k], 1e-9);
      close(b.smdAfter as number, golden.expected.smd_after[k], 1e-6);
    });
  });
});

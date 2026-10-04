import { describe, expect, it } from "vitest";
import { conformalInterval } from "@/lib/ai/conformal";
import { rng } from "./helpers";

const covered = (iv: [number, number], z: number) => iv[0] <= z && z <= iv[1];

describe("quantile conforme à rangs (split conformal)", () => {
  it("prend les rangs exacts : n = 24 → m = 20 écarts, i = 2, j = 22", () => {
    const z = Array.from({ length: 24 }, (_, k) => k + 1 - 12.5);
    const shuffled = [...z].sort((a, b) => Math.sin(a * 7) - Math.sin(b * 7));
    expect(conformalInterval(shuffled, 0.8)).toEqual([z[1], z[21]]);
    // n = 9 : plus petit échantillon à bornes finies (m = 8, i = 1, j = 9)
    expect(conformalInterval([-4, -3, -2, -1, 0, 1, 2, 3, 4], 0.8)).toEqual([-4, 4]);
  });

  it("contient toujours 0 (la prévision), ignore les valeurs non finies et refuse moins de 9 scores", () => {
    expect(conformalInterval(Array.from({ length: 24 }, (_, k) => k + 1), 0.8)).toEqual([0, 22]);
    expect(conformalInterval(Array.from({ length: 24 }, (_, k) => -(k + 1)), 0.8)).toEqual([-23, 0]);
    expect(conformalInterval([1, 2, 3, 4, 5, 6, 7, 8], 0.8)).toBeNull();
    expect(conformalInterval([NaN, Infinity, 1, 2, 3, 4, 5, 6, 7, 8], 0.8)).toBeNull();
    expect(conformalInterval([], 0.8)).toBeNull();
  });

  it("couvre au moins 80 % en moyenne avec 24 scores de calibration, loi normale ou asymétrique", () => {
    for (const [name, draw] of [
      ["normale", rng(11).normal],
      ["exponentielle centrée", (() => {
        const r = rng(12);
        return () => r.expo() - 1;
      })()],
    ] as const) {
      let hits = 0;
      const trials = 4000;
      for (let t = 0; t < trials; t++) {
        const iv = conformalInterval(Array.from({ length: 24 }, draw), 0.8)!;
        if (covered(iv, draw())) hits++;
      }
      const cov = hits / trials;
      expect(cov, name).toBeGreaterThanOrEqual(0.78); // garantie exacte (j - i) / (n + 1) = 0,80
      expect(cov, name).toBeLessThanOrEqual(0.84);
    }
  });

  it("n'est pas trop conservateur sur un grand échantillon : couverture proche de 80 %", () => {
    const r = rng(21);
    const iv = conformalInterval(Array.from({ length: 20000 }, r.normal), 0.8)!;
    let hits = 0;
    for (let t = 0; t < 50000; t++) if (covered(iv, r.normal())) hits++;
    expect(hits / 50000).toBeGreaterThan(0.785);
    expect(hits / 50000).toBeLessThan(0.815);
    expect(iv[0]).toBeCloseTo(-1.2816, 1);
    expect(iv[1]).toBeCloseTo(1.2816, 1);
  });

  it("score normalisé : la couverture tient pour les petites comme pour les grandes unités (résidus liés au niveau)", () => {
    const r = rng(31);
    // erreurs d'écart-type proportionnel à l'échelle s de l'unité (s = 1 ou 10)
    const unit = () => {
      const s = r.u() < 0.5 ? 1 : 10;
      return { s, e: s * r.normal() };
    };
    const cal = Array.from({ length: 4000 }, unit);
    const norm = conformalInterval(cal.map((c) => c.e / c.s), 0.8)!;
    const raw = conformalInterval(cal.map((c) => c.e), 0.8)!;
    const test = Array.from({ length: 20000 }, unit);
    const rate = (rows: typeof test, ok: (c: (typeof test)[number]) => boolean) => rows.filter(ok).length / rows.length;
    const big = test.filter((c) => c.s === 10);
    const small = test.filter((c) => c.s === 1);
    expect(rate(big, (c) => covered(norm, c.e / c.s))).toBeGreaterThan(0.77);
    expect(rate(small, (c) => covered(norm, c.e / c.s))).toBeGreaterThan(0.77);
    // sans normalisation, la couverture globale tient mais les grandes unités sont mal couvertes
    expect(rate(test, (c) => covered(raw, c.e))).toBeGreaterThan(0.77);
    expect(rate(big, (c) => covered(raw, c.e))).toBeLessThan(0.7);
  });
});

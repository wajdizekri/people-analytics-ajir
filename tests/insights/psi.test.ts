import { describe, expect, it } from "vitest";
import { PSI_EPSILON, binIndex, binSpec, computePsi, driftStatus, psiFromProportions } from "@/lib/drift/psi";

describe("PSI (Population Stability Index)", () => {
  it("valeur connue sur des proportions : 25/25/25/25 contre 10/40/40/10", () => {
    const expected = 2 * (-0.15 * Math.log(0.4)) + 2 * (0.15 * Math.log(1.6));
    expect(psiFromProportions([0.25, 0.25, 0.25, 0.25], [0.1, 0.4, 0.4, 0.1])).toBeCloseTo(expected, 12);
    expect(expected).toBeCloseTo(0.41589, 5);
  });

  it("répartitions identiques : PSI nul ; variable binaire 25 % contre 75 % : ln 3", () => {
    expect(psiFromProportions([0.2, 0.3, 0.5], [0.2, 0.3, 0.5])).toBe(0);
    const ref = [...new Array(75).fill(0), ...new Array(25).fill(1)];
    const cur = [...new Array(25).fill(0), ...new Array(75).fill(1)];
    const r = computePsi(ref, cur);
    expect(r.spec).toEqual({ kind: "DISCRETE", values: [0, 1] });
    expect(r.psi).toBeCloseTo(Math.log(3), 12);
    expect(r.bins.map((b) => [b.value, b.refShare, b.curShare])).toEqual([
      [0, 0.75, 0.25],
      [1, 0.25, 0.75],
    ]);
  });

  it("classe vide : lissage par epsilon (le logarithme ne diverge pas)", () => {
    const v = psiFromProportions([0.5, 0.5, 0], [0.5, 0.4, 0.1]);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeCloseTo(-0.1 * Math.log(0.8) + (0.1 - PSI_EPSILON) * Math.log(0.1 / PSI_EPSILON), 12);
  });

  it("variable continue : classes sur les déciles de la référence, bornes dédoublonnées", () => {
    const ref = Array.from({ length: 100 }, (_, i) => i + 1);
    const spec = binSpec(ref);
    expect(spec).toEqual({ kind: "QUANTILE", edges: [10, 20, 30, 40, 50, 60, 70, 80, 90] });
    expect(binIndex(spec!, 10)).toBe(0);
    expect(binIndex(spec!, 10.5)).toBe(1);
    expect(binIndex(spec!, 1000)).toBe(9);
    const same = computePsi(ref, ref);
    expect(same.psi).toBe(0);
    expect(same.bins).toHaveLength(10);
    // Beaucoup d'ex-æquo à 0 : moins de classes, jamais une classe vide au-dessus du maximum
    const skewed = [...new Array(70).fill(0), ...Array.from({ length: 30 }, (_, i) => i + 1)];
    const s = binSpec(skewed)!;
    expect(s.kind).toBe("QUANTILE");
    expect(s.kind === "QUANTILE" && s.edges[0]).toBe(0);
    expect(s.kind === "QUANTILE" && s.edges.every((e) => e < 30)).toBe(true);
  });

  it("décalage d'une variable continue : dérive forte", () => {
    const ref = Array.from({ length: 1000 }, (_, i) => i / 10);
    const cur = ref.map((x) => x + 30);
    const r = computePsi(ref, cur);
    expect(r.psi!).toBeGreaterThan(0.25);
    expect(driftStatus(r.psi)).toBe("FORTE");
  });

  it("seuils 0,1 et 0,25 ; valeurs inconnues de la référence dans la classe « autre »", () => {
    expect(driftStatus(0.0999)).toBe("STABLE");
    expect(driftStatus(0.1)).toBe("MODEREE");
    expect(driftStatus(0.2499)).toBe("MODEREE");
    expect(driftStatus(0.25)).toBe("FORTE");
    expect(driftStatus(null)).toBeNull();
    const r = computePsi([0, 0, 1, 1], [0, 1, 2, 2]);
    expect(r.bins.at(-1)).toMatchObject({ other: true, refShare: 0, curShare: 0.5 });
    expect(computePsi([], [1]).psi).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { compareMatched, nearestNeighborMatch, type MatchUnit } from "@/lib/matching";
import { syntheticUnits } from "./synthetic";

// Appariement par score de propension sur données synthétiques dont l'effet est connu (tests/ia-causal/synthetic.ts)

const naive = (units: ReturnType<typeof syntheticUnits>, j = 0) => {
  const m = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const t = units.filter((u) => u.treated && u.outcomes[j] != null).map((u) => u.outcomes[j] as number);
  const c = units.filter((u) => !u.treated && u.outcomes[j] != null).map((u) => u.outcomes[j] as number);
  return m(t) - m(c);
};

describe("effet connu, sélection sur variables observées", () => {
  const effect = -0.1;
  const units = syntheticUnits({ n: 12000, effect, seed: 7 });
  const r = compareMatched(units, 2);

  it("la comparaison brute est biaisée, l'estimation appariée retrouve l'effet", () => {
    expect(r.status).toBe("OK");
    expect(naive(units) - effect).toBeGreaterThan(0.05);
    const o = r.outcomes[0];
    expect(o.status).toBe("OK");
    expect(Math.abs((o.diff as number) - effect)).toBeLessThan(0.05);
    expect(o.low as number).toBeLessThan(o.diff as number);
    expect(o.high as number).toBeGreaterThan(o.diff as number);
    expect(o.naiveDiff).toBeCloseTo(naive(units), 12);
  });

  it("équilibre : écarts standardisés forts avant, sous 0,1 après", () => {
    expect(r.maxSmdBefore as number).toBeGreaterThan(0.5);
    expect(r.maxSmdAfter as number).toBeLessThan(0.1);
    expect(Math.abs(r.balance[0].smdAfter as number)).toBeLessThan(Math.abs(r.balance[0].smdBefore));
    expect(r.matchedShare as number).toBeGreaterThan(0.7);
    expect(r.supportShare as number).toBeGreaterThan(0.9);
  });

  it("issue sans effet mais confondue : la comparaison brute s'écarte de zéro, pas l'estimation appariée", () => {
    const o = r.outcomes[1];
    expect(o.status).toBe("OK");
    expect(o.pairs).toBeLessThan(r.matched);
    expect(naive(units, 1)).toBeGreaterThan(0.05);
    expect(Math.abs(o.diff as number)).toBeLessThan(0.07);
  });

  it("appariement exact sur la strate, sans remise, dans le caliper", () => {
    const byKey = new Map(units.map((u) => [u.key, u]));
    const controls = r.pairs.map((p) => p.control);
    expect(new Set(controls).size).toBe(controls.length);
    for (const p of r.pairs) {
      expect(byKey.get(p.treated)!.treated).toBe(true);
      expect(byKey.get(p.control)!.treated).toBe(false);
      expect(byKey.get(p.treated)!.stratum).toBe(byKey.get(p.control)!.stratum);
      expect(p.distance).toBeLessThanOrEqual(r.caliper as number);
    }
  });

  it("déterministe : même fourchette à chaque appel", () => {
    const again = compareMatched(units, 2);
    expect(again.outcomes).toEqual(r.outcomes);
    expect(again.pairs).toEqual(r.pairs);
  });
});

describe("couverture de la fourchette sur réplications", () => {
  it("effet de −0,1 : la fourchette à 95 % contient l'effet dans au moins 80 % des réplications", () => {
    const reps = Array.from({ length: 30 }, (_, k) => compareMatched(syntheticUnits({ n: 3000, effect: -0.1, seed: 100 + k }), 1, { bootstrap: 1000 }).outcomes[0]);
    const covered = reps.filter((o) => (o.low as number) <= -0.1 && -0.1 <= (o.high as number)).length;
    expect(covered).toBeGreaterThanOrEqual(24);
    const meanEstimate = reps.reduce((s, o) => s + (o.diff as number), 0) / reps.length;
    expect(Math.abs(meanEstimate + 0.1)).toBeLessThan(0.03);
  });

  it("effet nul : la fourchette exclut zéro dans au plus 20 % des réplications", () => {
    const reps = Array.from({ length: 30 }, (_, k) => compareMatched(syntheticUnits({ n: 3000, effect: 0, seed: 200 + k }), 1, { bootstrap: 1000 }).outcomes[0]);
    const excluded = reps.filter((o) => (o.low as number) > 0 || (o.high as number) < 0).length;
    expect(excluded).toBeLessThanOrEqual(6);
  });
});

describe("verdict d'équilibre", () => {
  it("confusion modérée et témoins nombreux : groupes comparables", () => {
    const r = compareMatched(syntheticUnits({ n: 8000, treatBase: -3, confounding: 0.6, seed: 11 }), 1);
    expect(r.verdict).toBe("COMPARABLE");
    expect(r.reasons).toEqual([]);
  });

  it("suivis majoritaires et très différents : comparaison fragile (appariement partiel)", () => {
    const r = compareMatched(syntheticUnits({ n: 3000, treatBase: 0.5, confounding: 3, seed: 12 }), 1);
    expect(r.verdict).toBe("FRAGILE");
    expect(r.reasons).toContain("APPARIEMENT_PARTIEL");
    expect(r.matchedShare as number).toBeLessThan(0.8);
  });
});

describe("plus proche voisin : caliper, remise, strate, date de l'action", () => {
  const u = (key: string, treated: boolean, score: number, extra: Partial<MatchUnit> = {}): MatchUnit => ({ key, stratum: "S", treated, score, ...extra });

  it("un suivi sans témoin dans le caliper reste sans paire", () => {
    const pairs = nearestNeighborMatch([u("t1", true, 0.5), u("t2", true, 5), u("c1", false, 0.45), u("c2", false, 1)], { caliper: 0.1 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ treated: 0, control: 2 });
    expect(pairs[0].distance).toBeCloseTo(0.05, 12);
  });

  it("sans remise, le second suivi prend le voisin suivant ; avec remise, le même témoin", () => {
    const units = [u("t1", true, 1.0), u("t2", true, 0.9), u("c1", false, 0.95), u("c2", false, 0.7)];
    const without = nearestNeighborMatch(units, { caliper: 1 });
    expect(without.map((p) => [units[p.treated].key, units[p.control].key])).toEqual([
      ["t1", "c1"],
      ["t2", "c2"],
    ]);
    const withReplacement = nearestNeighborMatch(units, { caliper: 1, replace: true });
    expect(withReplacement.map((p) => units[p.control].key)).toEqual(["c1", "c1"]);
  });

  it("jamais de témoin d'une autre strate", () => {
    const pairs = nearestNeighborMatch([u("t1", true, 1, { stratum: "A" }), u("c1", false, 1, { stratum: "B" }), u("c2", false, 1.5, { stratum: "A" })], { caliper: 1 });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].control).toBe(2);
  });

  it("un témoin sorti ou démissionnaire avant la date de l'action n'est pas retenu", () => {
    const units = [u("t1", true, 1, { date: "2025-03-15" }), u("c1", false, 1, { atRiskUntil: "2025-03-10" }), u("c2", false, 1.2, { atRiskUntil: "2025-05-01" })];
    const pairs = nearestNeighborMatch(units, { caliper: 1 });
    expect(units[pairs[0].control].key).toBe("c2");
    const sameDay = nearestNeighborMatch([u("t1", true, 1, { date: "2025-03-15" }), u("c1", false, 1, { atRiskUntil: "2025-03-15" })], { caliper: 1 });
    expect(sameDay).toHaveLength(0);
  });

  it("à distance égale, le témoin de plus petite clé", () => {
    const pairs = nearestNeighborMatch([u("t1", true, 1), u("c9", false, 1.5), u("c2", false, 0.5)], { caliper: 1 });
    expect(pairs[0].control).toBe(2);
  });
});

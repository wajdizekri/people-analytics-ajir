import { describe, expect, it } from "vitest";
import { LEVER_LIMITS, NO_LEVERS, type Levers } from "@/lib/whatif";
import {
  LEVER_STEPS,
  LEVER_VALUES,
  MAX_PROPOSALS,
  PROMOTION_EFFORT,
  compareLevers,
  dominates,
  leverEffort,
  leverGrid,
  leversUsed,
  pickMinimal,
} from "@/lib/whatif/search";

const L = (o: Partial<Levers>): Levers => ({ ...NO_LEVERS, ...o });
const key = (l: Levers) => `${l.salaryPct}|${l.overtimeCutH}|${l.trainingHours}|${l.promotion}`;
const GRID_SIZE = 13 * 5 * 11 * 2 - 1;

// Un pas de moins sur un levier (ou sans promotion) : la combinaison obtenue ne doit plus suffire si la piste est minimale
function oneStepDown(l: Levers): Levers[] {
  const out: Levers[] = [];
  if (l.salaryPct > 0) out.push({ ...l, salaryPct: l.salaryPct - LEVER_STEPS.salaryPct });
  if (l.overtimeCutH > 0) out.push({ ...l, overtimeCutH: l.overtimeCutH - LEVER_STEPS.overtimeCutH });
  if (l.trainingHours > 0) out.push({ ...l, trainingHours: l.trainingHours - LEVER_STEPS.trainingHours });
  if (l.promotion) out.push({ ...l, promotion: false });
  return out;
}

describe("grille discrète", () => {
  it("pas de 2,5 %, 10 h et 20 h jusqu'aux bornes du what-if, promotion oui/non : 1 429 combinaisons distinctes", () => {
    expect(LEVER_VALUES.salaryPct).toEqual([0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30]);
    expect(LEVER_VALUES.overtimeCutH).toEqual([0, 10, 20, 30, 40]);
    expect(LEVER_VALUES.trainingHours).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200]);
    const grid = leverGrid();
    expect(grid).toHaveLength(GRID_SIZE);
    expect(new Set(grid.map(key)).size).toBe(GRID_SIZE);
    for (const l of grid) {
      expect(leversUsed(l)).toBeGreaterThan(0);
      expect(l.salaryPct).toBeGreaterThanOrEqual(0);
      expect(l.salaryPct).toBeLessThanOrEqual(LEVER_LIMITS.salaryPct);
      expect(l.overtimeCutH).toBeLessThanOrEqual(LEVER_LIMITS.overtimeCutH);
      expect(l.trainingHours).toBeLessThanOrEqual(LEVER_LIMITS.trainingHours);
      expect(Number.isInteger(l.salaryPct / LEVER_STEPS.salaryPct)).toBe(true);
      expect(Number.isInteger(l.overtimeCutH / LEVER_STEPS.overtimeCutH)).toBe(true);
      expect(Number.isInteger(l.trainingHours / LEVER_STEPS.trainingHours)).toBe(true);
    }
    for (let i = 1; i < grid.length; i++) expect(compareLevers(grid[i - 1], grid[i])).toBeLessThan(0);
  });

  it("levier inapplicable (salaire invisible, grade maximal) : retiré de la grille", () => {
    const noSalary = leverGrid({ salary: false, promotion: true });
    expect(noSalary).toHaveLength(5 * 11 * 2 - 1);
    expect(noSalary.every((l) => l.salaryPct === 0)).toBe(true);
    const noPromotion = leverGrid({ salary: true, promotion: false });
    expect(noPromotion).toHaveLength(13 * 5 * 11 - 1);
    expect(noPromotion.every((l) => !l.promotion)).toBe(true);
  });
});

describe("coût normalisé et ordre", () => {
  it("part de chaque borne utilisée ; une promotion compte comme un levier à sa limite", () => {
    expect(leverEffort(NO_LEVERS)).toBe(0);
    expect(leverEffort(L({ salaryPct: 30 }))).toBe(1);
    expect(leverEffort(L({ overtimeCutH: 20 }))).toBe(0.5);
    expect(leverEffort(L({ trainingHours: 40 }))).toBeCloseTo(0.2, 12);
    expect(leverEffort(L({ promotion: true }))).toBe(PROMOTION_EFFORT);
    expect(PROMOTION_EFFORT).toBe(1);
    expect(leverEffort(L({ salaryPct: 15, overtimeCutH: 20 }))).toBe(1);
    expect(leverEffort(L({ salaryPct: 30, overtimeCutH: 40, trainingHours: 200, promotion: true }))).toBe(4);
  });

  it("à effort égal : moins de leviers d'abord, puis moins de salaire", () => {
    expect(compareLevers(L({ promotion: true }), L({ salaryPct: 15, overtimeCutH: 20 }))).toBeLessThan(0);
    expect(compareLevers(L({ promotion: true }), L({ salaryPct: 30 }))).toBeLessThan(0);
    expect(compareLevers(L({ trainingHours: 100 }), L({ salaryPct: 15 }))).toBeLessThan(0);
    expect(compareLevers(L({ salaryPct: 2.5 }), L({ trainingHours: 20 }))).toBeLessThan(0);
    expect(compareLevers(L({ salaryPct: 5 }), L({ salaryPct: 5 }))).toBe(0);
  });

  it("dominance : une combinaison qui utilise chaque levier au moins autant qu'une autre", () => {
    expect(dominates(L({ salaryPct: 5 }), L({ salaryPct: 5, trainingHours: 20 }))).toBe(true);
    expect(dominates(L({ salaryPct: 5 }), L({ salaryPct: 7.5 }))).toBe(true);
    expect(dominates(L({ salaryPct: 5 }), L({ salaryPct: 5, promotion: true }))).toBe(true);
    expect(dominates(L({ overtimeCutH: 10 }), L({ overtimeCutH: 40, trainingHours: 200, promotion: true }))).toBe(true);
    expect(dominates(L({ salaryPct: 5 }), L({ salaryPct: 5 }))).toBe(false);
    expect(dominates(L({ promotion: true }), L({ salaryPct: 30 }))).toBe(false);
    expect(dominates(L({ salaryPct: 5, overtimeCutH: 10 }), L({ salaryPct: 10 }))).toBe(false);
    expect(dominates(L({ salaryPct: 10 }), L({ salaryPct: 5, overtimeCutH: 10 }))).toBe(false);
  });
});

describe("sélection des plus petites pistes non dominées", () => {
  it("seuil sur un seul levier : une piste, les combinaisons qui la contiennent sont écartées sans calcul", () => {
    const seen: Levers[] = [];
    const r = pickMinimal(leverGrid(), (l) => {
      seen.push(l);
      return l.salaryPct >= 10;
    });
    expect(r.picked).toEqual([L({ salaryPct: 10 })]);
    expect(seen.filter((l) => l.salaryPct >= 10)).toEqual([L({ salaryPct: 10 })]);
    expect(r.evaluated).toBe(4 * 5 * 11 * 2 - 1 + 1);
    expect(r.pruned).toBe(9 * 5 * 11 * 2 - 1);
    expect(r.evaluated + r.pruned).toBe(GRID_SIZE);
  });

  it("seuil additif : 3 pistes, de la plus petite à la plus forte, aucune ne contient une autre, chacune minimale", () => {
    const succeeds = (l: Levers) => l.salaryPct / LEVER_LIMITS.salaryPct + l.trainingHours / LEVER_LIMITS.trainingHours >= 0.5;
    const r = pickMinimal(leverGrid(), succeeds);
    expect(r.picked).toEqual([L({ trainingHours: 100 }), L({ salaryPct: 15 }), L({ salaryPct: 12.5, trainingHours: 20 })]);
    expect(r.picked).toHaveLength(MAX_PROPOSALS);
    for (let i = 1; i < r.picked.length; i++) expect(leverEffort(r.picked[i - 1])).toBeLessThanOrEqual(leverEffort(r.picked[i]) + 1e-9);
    for (const a of r.picked) for (const b of r.picked) expect(dominates(a, b)).toBe(false);
    for (const p of r.picked) {
      expect(succeeds(p)).toBe(true);
      for (const lower of oneStepDown(p)) expect(succeeds(lower)).toBe(false);
    }
    // Contrôle exhaustif : aucune combinaison suffisante, moins coûteuse que la 3e piste, n'a été oubliée
    const last = leverEffort(r.picked[2]);
    const missed = leverGrid().filter((l) => succeeds(l) && leverEffort(l) < last - 1e-9 && !r.picked.some((p) => dominates(p, l) || compareLevers(p, l) === 0));
    expect(missed).toEqual([]);
  });

  it("aucune combinaison ne suffit : aucune piste, toute la grille est évaluée", () => {
    const r = pickMinimal(leverGrid(), () => false);
    expect(r.picked).toEqual([]);
    expect(r.evaluated).toBe(GRID_SIZE);
    expect(r.pruned).toBe(0);
  });

  it("arrêt dès la 3e piste ; nombre de pistes paramétrable", () => {
    const r = pickMinimal(leverGrid(), () => true);
    expect(r.picked).toEqual([L({ salaryPct: 2.5 }), L({ trainingHours: 20 }), L({ overtimeCutH: 10 })]);
    expect(r.evaluated).toBe(3);
    expect(pickMinimal(leverGrid(), () => true, 2).picked).toHaveLength(2);
  });
});

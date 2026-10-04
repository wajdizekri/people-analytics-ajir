import path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURE_NAMES, backfillFeatures } from "@/lib/features";
import { computeMonth, type FeatureVector } from "@/lib/features/compute";
import { loadChampion, promoteModel, registerBundle, scoreMonth, type LoadedModel } from "@/lib/scoring";
import { getSetting, setSetting } from "@/lib/settings";
import {
  NO_LEVERS,
  applyLevers,
  forkDataset,
  loadSimulationBase,
  place,
  simulate,
  simulateFrom,
  type Levers,
  type Placement,
  type SimulationOptions,
} from "@/lib/whatif";
import {
  LEVEL_RANK,
  MAX_PROPOSALS,
  compareLevers,
  dominates,
  leverEffort,
  leverEvaluator,
  leverGrid,
  makePlacer,
  searchLevers,
} from "@/lib/whatif/search";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildWhatIfScenario, ORIGIN, T } from "../fixtures/whatif";

const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");
const CHARGE = 0.1657;
// Budget large (poste partagé, E2E en parallèle) ; le temps mesuré est affiché dans la sortie du test
const BUDGET_MS = 10_000;
const MAX_ENGINE_RUNS = 1 + 39 + 2 * MAX_PROPOSALS;
const L = (o: Partial<Levers>): Levers => ({ ...NO_LEVERS, ...o });
const opts = (sqlite: TestDb["sqlite"]): SimulationOptions => ({
  capacityRate: Number(getSetting(sqlite, "capacity_rate")),
  mediumLift: Number(getSetting(sqlite, "medium_lift")),
  chargeRate: CHARGE,
});

// Oracle : chaque combinaison de la grille recalculée en entier (applyLevers + computeMonth + rankAndLevel), sans composition
// ni placement accéléré ; les pistes attendues sont les plus petites combinaisons suffisantes non dominées.
function exhaustive(sqlite: TestDb["sqlite"], model: LoadedModel, id: number) {
  const o = opts(sqlite);
  const base = loadSimulationBase(sqlite, model, id, T);
  const before = place(model, base.population, id, base.before, o.capacityRate, o.mediumLift);
  const ev = leverEvaluator(base, id, T);
  const placer = makePlacer(model, base.population, id, o.capacityRate, o.mediumLift);
  const rows: { l: Levers; values: number[]; composed: number[]; exact: Placement; fast: Placement }[] = [];
  for (const l of leverGrid(ev.allowed)) {
    const ds = forkDataset(base.ds, id);
    applyLevers(ds, id, T, l);
    const [r] = computeMonth(ds, T, [id]);
    rows.push({ l, values: r.values, composed: ev.values(l), exact: place(model, base.population, id, r.values, o.capacityRate, o.mediumLift), fast: placer(ev.values(l)) });
  }
  const ok = rows.filter((r) => LEVEL_RANK[r.exact.level] < LEVEL_RANK[before.level]).map((r) => r.l);
  const minimal = ok.filter((l) => !ok.some((m) => dominates(m, l))).sort(compareLevers);
  return { before, rows, expected: minimal.slice(0, MAX_PROPOSALS) };
}

function expectConsistent(sqlite: TestDb["sqlite"], model: LoadedModel, id: number) {
  const o = opts(sqlite);
  const oracle = exhaustive(sqlite, model, id);
  for (const r of oracle.rows) {
    expect(r.composed, JSON.stringify(r.l)).toEqual(r.values);
    expect(r.fast, JSON.stringify(r.l)).toEqual(r.exact);
  }
  const res = searchLevers(sqlite, model, id, T, o);
  expect(res.before).toEqual(oracle.before);
  expect(res.proposals.map((p) => p.levers)).toEqual(oracle.expected);
  for (const p of res.proposals) {
    // « Appliquer à la simulation » : le what-if donne exactement le résultat de la carte
    const sim = simulate(sqlite, model, id, T, p.levers, o);
    expect(p.result).toEqual(sim);
    expect(LEVEL_RANK[sim.after.level]).toBeLessThan(LEVEL_RANK[sim.before.level]);
    expect(p.effort).toBeCloseTo(leverEffort(p.levers), 3);
  }
  return res;
}

let db: TestDb;
let ids: ReturnType<typeof buildWhatIfScenario>;
let b0: LoadedModel;

beforeAll(() => {
  db = createTestDb();
  ids = buildWhatIfScenario(new Fixture(db.sqlite));
  setSetting(db.sqlite, "capacity_rate", "0.25");
  setSetting(db.sqlite, "data_end_date", T);
  backfillFeatures(db.sqlite, ORIGIN.slice(0, 7), ORIGIN.slice(0, 7));
  scoreMonth(db.sqlite, T);
  b0 = loadChampion(db.sqlite)!;
});
afterAll(() => db.close());

describe("moteur réutilisé : copie des sources et simulation", () => {
  it("simulateFrom sur une base chargée une fois = simulate ; la base n'est jamais modifiée", () => {
    const o = opts(db.sqlite);
    const base = loadSimulationBase(db.sqlite, b0, ids.f, T);
    const snap = () =>
      JSON.stringify([
        base.ds.careers.get(ids.f),
        base.ds.payroll.get(ids.f),
        base.ds.trainings.get(ids.f) ?? null,
        base.ds.attendance.get(ids.f)?.ot,
        base.ds.careers.size,
        base.ds.payroll.size,
        base.ds.trainings.size,
        base.before,
      ]);
    const s0 = snap();
    const all = { salaryPct: 30, overtimeCutH: 40, trainingHours: 200, promotion: true };
    for (const l of [all, L({ salaryPct: 10 }), L({ overtimeCutH: 20 }), L({ promotion: true })]) {
      expect(simulateFrom(b0, base, ids.f, T, l, o)).toEqual(simulate(db.sqlite, b0, ids.f, T, l, o));
      expect(snap()).toBe(s0);
    }
  });

  it("placement accéléré identique à rankAndLevel (ex-aequo B0, plafond de capacité, lift)", () => {
    const n = FEATURE_NAMES.length;
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.double({ min: 0, max: 60, noNaN: true }), { minLength: n, maxLength: n }), { minLength: 1, maxLength: 25 }),
        fc.array(fc.double({ min: 0, max: 60, noNaN: true }), { minLength: n, maxLength: n }),
        fc.nat(25),
        fc.constantFrom(1, 2),
        fc.double({ min: 0.005, max: 0.5, noNaN: true }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        (rows, values, slot, offset, capacityRate, mediumLift) => {
          const population: FeatureVector[] = rows.map((v, i) => ({ employeeId: 3 * (i + 1), values: v, partial: false }));
          const id = 3 * slot + offset;
          expect(makePlacer(b0, population, id, capacityRate, mediumLift)(values)).toEqual(place(b0, population, id, values, capacityRate, mediumLift));
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("recherche de leviers : modèle B0 (scénario de référence)", () => {
  it("F (4 points, Élevé) : promotion seule, ou +15 % de salaire et −20 h sup ; identique à la recherche exhaustive", () => {
    const res = expectConsistent(db.sqlite, b0, ids.f);
    expect(res.before).toMatchObject({ score: 4, level: "ELEVE" });
    expect(res.status).toBe("TROUVE");
    expect(res.proposals.map((p) => p.levers)).toEqual([L({ promotion: true }), L({ salaryPct: 15, overtimeCutH: 20 })]);
    expect(res.proposals.map((p) => p.result.after.level)).toEqual(["FAIBLE", "FAIBLE"]);
    expect(res.proposals.map((p) => p.effort)).toEqual([1, 1]);
    // dominance : aucune piste ne contient une autre ; minimalité : un pas de moins ne suffit plus
    const o = opts(db.sqlite);
    for (const lower of [L({ salaryPct: 12.5, overtimeCutH: 20 }), L({ salaryPct: 15, overtimeCutH: 10 })])
      expect(simulate(db.sqlite, b0, ids.f, T, lower, o).after.level).toBe("ELEVE");
    expect(res.stats.pruned).toBeGreaterThan(0);
  });

  it("A (Élevé, facteurs hors leviers : absences, formation obligatoire en retard) : aucune combinaison", () => {
    const res = expectConsistent(db.sqlite, b0, ids.a);
    expect(res.before.level).toBe("ELEVE");
    expect(res.status).toBe("AUCUNE");
    expect(res.proposals).toEqual([]);
    expect(res.stats.evaluated).toBe(res.stats.combos);
  });

  it("niveau déjà Faible : pas de recherche", () => {
    for (const id of [ids.b, ids.e]) {
      const res = searchLevers(db.sqlite, b0, id, T, opts(db.sqlite));
      expect(res.before.level).toBe("FAIBLE");
      expect(res.status).toBe("DEJA_FAIBLE");
      expect(res.proposals).toEqual([]);
      expect(res.stats.engineRuns).toBe(1);
    }
  });

  it("levier inapplicable (grade maximal) : promotion retirée de la grille et signalée", () => {
    db.sqlite.prepare("UPDATE employee SET grade = 'G8' WHERE id = ?").run(ids.f);
    try {
      const res = searchLevers(db.sqlite, b0, ids.f, T, opts(db.sqlite));
      expect(res.notes.some((n) => /Grade maximal/.test(n))).toBe(true);
      expect(res.proposals.every((p) => !p.levers.promotion)).toBe(true);
      expect(res.stats.combos).toBe(13 * 5 * 11 - 1);
    } finally {
      db.sqlite.prepare("UPDATE employee SET grade = 'G2' WHERE id = ?").run(ids.f);
    }
  });

  it("calcul borné : nombre de recalculs plafonné, temps mesuré", () => {
    const t0 = performance.now();
    const res = searchLevers(db.sqlite, b0, ids.f, T, opts(db.sqlite));
    const ms = performance.now() - t0;
    console.info(`[ia-levier] petite base (${res.before.population} évalués) : ${ms.toFixed(0)} ms, ${res.stats.engineRuns} recalculs, ${res.stats.evaluated}/${res.stats.combos} combinaisons évaluées`);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(res.stats.ms).toBeLessThan(BUDGET_MS);
    expect(res.stats.engineRuns).toBeLessThanOrEqual(MAX_ENGINE_RUNS);
  });
});

describe("recherche de leviers : modèle LOGREG (monotonie non garantie)", () => {
  let db2: TestDb;
  let toy: LoadedModel;
  let scored: { e: number; level: string }[];
  beforeAll(() => {
    db2 = createTestDb();
    buildWhatIfScenario(new Fixture(db2.sqlite));
    registerBundle(db2.sqlite, TOY);
    promoteModel(db2.sqlite, "logreg-toy-v1");
    setSetting(db2.sqlite, "min_events_for_model", "0");
    const runId = scoreMonth(db2.sqlite, T).runId;
    toy = loadChampion(db2.sqlite)!;
    scored = db2.sqlite.prepare("SELECT employee_id AS e, level FROM prediction WHERE run_id = ?").all(runId) as { e: number; level: string }[];
  });
  afterAll(() => db2.close());

  it("chaque salarié Élevé ou Moyen : pistes identiques à la recherche exhaustive et au what-if", () => {
    expect(toy.kind).toBe("LOGREG");
    const exposed = scored.filter((s) => s.level !== "FAIBLE");
    expect(exposed.length).toBeGreaterThan(0);
    for (const s of exposed) {
      const res = expectConsistent(db2.sqlite, toy, s.e);
      expect(["TROUVE", "AUCUNE"]).toContain(res.status);
      if (res.status === "AUCUNE") expect(res.proposals).toEqual([]);
    }
  });

  it("placement accéléré identique à rankAndLevel pour une probabilité continue", () => {
    const n = FEATURE_NAMES.length;
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.double({ min: -3, max: 60, noNaN: true }), { minLength: n, maxLength: n }), { minLength: 1, maxLength: 25 }),
        fc.array(fc.double({ min: -3, max: 60, noNaN: true }), { minLength: n, maxLength: n }),
        fc.nat(25),
        fc.double({ min: 0.005, max: 0.5, noNaN: true }),
        (rows, values, slot, capacityRate) => {
          const population: FeatureVector[] = rows.map((v, i) => ({ employeeId: 2 * (i + 1), values: v, partial: false }));
          const id = 2 * slot + 1;
          expect(makePlacer(toy, population, id, capacityRate, 2)(values)).toEqual(place(toy, population, id, values, capacityRate, 2));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("temps sur une population de taille réelle", () => {
  let db3: TestDb;
  let f: number;
  let model: LoadedModel;
  const SYNTHETIC = 2000;
  beforeAll(() => {
    db3 = createTestDb();
    const fx = new Fixture(db3.sqlite);
    const ids3 = buildWhatIfScenario(fx);
    f = ids3.f;
    db3.sqlite.transaction(() => {
      for (let i = 0; i < SYNTHETIC; i++) {
        const level = 1 + (i % 6);
        const id = fx.emp({ matricule: `S${i}`, hire: "2016-01-01", dept: ids3.dept, family: ["TECH", "ADM", "COM"][Math.floor(i / 6) % 3], grade: `G${level}`, managerId: ids3.m });
        fx.payroll(id, "2023-06", "2025-06", 1000 + 250 * level + (i % 17) * 35);
      }
    })();
    setSetting(db3.sqlite, "data_end_date", T);
    scoreMonth(db3.sqlite, T);
    model = loadChampion(db3.sqlite)!;
  });
  afterAll(() => db3.close());

  it("2 000 salariés de plus : recherche complète dans le budget, pistes vérifiées par le what-if", () => {
    const o = opts(db3.sqlite);
    const t0 = performance.now();
    const res = searchLevers(db3.sqlite, model, f, T, o);
    const ms = performance.now() - t0;
    console.info(
      `[ia-levier] population de ${res.before.population} évalués : ${ms.toFixed(0)} ms, ${res.stats.engineRuns} recalculs, ${res.stats.evaluated}/${res.stats.combos} combinaisons évaluées, ${res.proposals.length} piste(s)`,
    );
    expect(res.before.population).toBeGreaterThan(SYNTHETIC);
    expect(res.before.level).toBe("ELEVE");
    expect(res.status).not.toBe("DEJA_FAIBLE");
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(res.stats.engineRuns).toBeLessThanOrEqual(MAX_ENGINE_RUNS);
    for (const p of res.proposals) {
      const sim = simulate(db3.sqlite, model, f, T, p.levers, o);
      expect(p.result.after).toEqual(sim.after);
      expect(LEVEL_RANK[sim.after.level]).toBeLessThan(LEVEL_RANK.ELEVE);
    }
  });
});

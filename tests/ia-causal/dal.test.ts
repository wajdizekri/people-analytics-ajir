import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { HttpError } from "@/lib/dal/errors";
import { MATCHING_COVARIATES, MATCHING_OUTCOMES, asOfBefore, getMatchedComparison } from "@/lib/dal/intervention-impact";
import { compareMatched } from "@/lib/matching";
import { causalCtx, createCausalFixture, destroyCausalFixture, type CausalFixture } from "./fixture";
import { syntheticUnits } from "./synthetic";

// DAL de la comparaison appariée : rôles, gardes d'effectif, opposition, aucune donnée individuelle dans le DTO

let f: CausalFixture;
let c: ReturnType<typeof causalCtx>;
beforeAll(() => {
  f = createCausalFixture("dal");
  c = causalCtx(f);
});
afterAll(() => destroyCausalFixture(f));

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 200;
};
const refused = (userId: number) =>
  (getDb().sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'interventions.view' AND outcome = 'REFUSE' AND user_id = ?").get(userId) as { n: number }).n;

describe("gardes d'effectif (bibliothèque)", () => {
  it("moins de 20 suivis : aucune comparaison, aucun chiffre", () => {
    const units = syntheticUnits({ n: 2000, seed: 3 });
    const few = [...units.filter((u) => u.treated).slice(0, 19), ...units.filter((u) => !u.treated)];
    const r = compareMatched(few, 2);
    expect(r.status).toBe("INSUFFISANT");
    expect(r.treated).toBe(19);
    expect(r.matched).toBe(0);
    expect(r.balance).toEqual([]);
    for (const o of r.outcomes) expect(o).toMatchObject({ status: "INSUFFISANT", diff: null, low: null, high: null, treatedMean: null, naiveDiff: null });
  });

  it("indicateur mesuré sur moins de 20 paires : chiffre retiré pour cet indicateur seulement", () => {
    const units = syntheticUnits({ n: 4000, seed: 4 }).map((u, i) => ({ ...u, outcomes: [u.outcomes[0], u.treated && i % 50 !== 0 ? null : 1] }));
    const r = compareMatched(units, 2);
    expect(r.status).toBe("OK");
    expect(r.outcomes[0].status).toBe("OK");
    expect(r.outcomes[1].status).toBe("INSUFFISANT");
    expect(r.outcomes[1].pairs).toBeLessThan(20);
    expect(r.outcomes[1].diff).toBeNull();
    expect(r.outcomes[1].naiveDiff).toBeNull();
  });

  it("aucun témoin dans les strates des suivis : effectif insuffisant", () => {
    const units = syntheticUnits({ n: 2000, seed: 5 }).map((u) => (u.treated ? { ...u, stratum: "2030-01-31" } : u));
    expect(compareMatched(units, 1).status).toBe("INSUFFISANT");
  });
});

describe("DAL getMatchedComparison", () => {
  it("date « as of » : fin du mois précédant l'action", () => {
    expect(asOfBefore("2025-03-15")).toBe("2025-02-28");
    expect(asOfBefore("2025-03-31")).toBe("2025-02-28");
    expect(asOfBefore("2025-01-02")).toBe("2024-12-31");
  });

  it("ADMIN et MANAGER : 403 audité (même matrice de rôles que la page)", () => {
    expect(status(() => getMatchedComparison(c.admin))).toBe(403);
    expect(status(() => getMatchedComparison(c.manager))).toBe(403);
    expect(refused(f.users.admin)).toBeGreaterThan(0);
    expect(refused(f.users.manager)).toBeGreaterThan(0);
  });

  it("RH : entretiens comparés, plans de formation sous le seuil", () => {
    const d = getMatchedComparison(c.rh);
    expect(d).toMatchObject({ minTreated: 20, minPairs: 20, level: 0.95, caliperSd: 0.2, washoutMonths: 6, horizonMonths: 6, levelWindowMonths: 3 });
    const by = Object.fromEntries(d.actions.map((a) => [a.actionCode, a]));
    expect(Object.keys(by).sort()).toEqual(["ENTRETIEN", "PLAN_FORMATION"]);

    const e = by.ENTRETIEN;
    expect(e.status).toBe("OK");
    expect(e.actions).toBe(f.entretien.length);
    expect(e.comparable).toBeGreaterThanOrEqual(20);
    expect(e.comparable).toBeLessThanOrEqual(e.actions);
    expect(e.matched).toBeGreaterThanOrEqual(20);
    expect(e.balance).toHaveLength(MATCHING_COVARIATES.length);
    expect(e.outcomes.map((o) => o.outcome)).toEqual([...MATCHING_OUTCOMES]);
    // Suivis choisis surtout parmi les niveaux Élevé et Moyen : fort déséquilibre avant, réduit après
    const level = e.balance.find((b) => b.code === "level_moyen")!;
    expect(Math.abs(level.smdBefore)).toBeGreaterThan(0.3);
    expect(Math.abs(level.smdAfter as number)).toBeLessThan(Math.abs(level.smdBefore));
    expect(e.maxSmdAfter as number).toBeLessThan(e.maxSmdBefore as number);
    for (const o of e.outcomes) {
      expect(o.status).toBe("OK");
      expect(o.low as number).toBeLessThanOrEqual(o.diff as number);
      expect(o.high as number).toBeGreaterThanOrEqual(o.diff as number);
      expect(o.diff as number).toBeCloseTo((o.treatedRate as number) - (o.controlRate as number), 12);
    }

    const p = by.PLAN_FORMATION;
    expect(p).toMatchObject({ status: "INSUFFISANT", actions: 3, matched: 0, verdict: null, balance: [] });
    for (const o of p.outcomes) expect(o).toMatchObject({ status: "INSUFFISANT", diff: null, treatedRate: null });
  });

  it("aucune donnée individuelle dans le DTO", () => {
    const json = JSON.stringify(getMatchedComparison(c.rh));
    for (const s of ["MATCAUS-", "NomCausal", "PrenomCausal", "employeeId", '"key"', '"pairs":[', '"fit"', "propens", "logit", "matricule"]) expect(json).not.toContain(s);
    expect(json).not.toMatch(/[st]\d+@\d{4}-/);
  });

  it("déterministe : même fourchette à chaque affichage", () => {
    expect(getMatchedComparison(c.rh)).toEqual(getMatchedComparison(c.rh));
  });

  it("opposition au traitement : les suivis opposés sortent de la comparaison", () => {
    const before = getMatchedComparison(c.rh).actions.find((a) => a.actionCode === "ENTRETIEN")!;
    const opposed = f.entretien.slice(0, 5);
    const ins = getDb().sqlite.prepare("INSERT INTO employee_opposition (employee_id, since) VALUES (?, '2026-08-01')");
    for (const id of opposed) ins.run(id);
    try {
      const after = getMatchedComparison(c.rh).actions.find((a) => a.actionCode === "ENTRETIEN")!;
      expect(after.actions).toBe(before.actions - opposed.length);
      expect(after.comparable).toBeLessThan(before.comparable);
    } finally {
      getDb().sqlite.prepare("DELETE FROM employee_opposition WHERE employee_id IN (SELECT value FROM json_each(?))").run(JSON.stringify(opposed));
    }
  });
});

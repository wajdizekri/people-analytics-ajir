import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backtestEvent, getBacktest } from "@/lib/dal/backtest";
import { ensureChampion } from "@/lib/scoring";
import { buildWorld, openDalDb, publishRun } from "../fixtures/unit/dal-world";

const ORIGIN = "2024-11-30";
const HORIZON = "2025-05-30";
const exit = (o: { resignationDate?: string | null; exitDate: string; recordedAt: string }) => {
  const resignationDate = o.resignationDate ?? null;
  const d = new Date(`${o.exitDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { id: 1, resignationDate, exitDate: o.exitDate, recordedAt: o.recordedAt, event: resignationDate ?? d.toISOString().slice(0, 10) };
};

describe("backtestEvent : date comptée strictement après l'origine (E2E-06)", () => {
  it("démission datée dans l'horizon : sa date", () => {
    expect(backtestEvent(ORIGIN, HORIZON, [exit({ resignationDate: "2025-03-01", exitDate: "2025-03-31", recordedAt: "2025-03-02" })])).toEqual({ date: "2025-03-01" });
  });
  it("date de démission inconnue, sortie - 1 mois avant l'origine, saisie après : la sortie", () => {
    expect(backtestEvent(ORIGIN, HORIZON, [exit({ exitDate: "2024-12-20", recordedAt: "2024-12-22" })])).toEqual({ date: "2024-12-20" });
  });
  it("démission connue posée avant l'origine, saisie après : déjà démissionnaire, exclu", () => {
    expect(backtestEvent(ORIGIN, HORIZON, [exit({ resignationDate: "2024-11-15", exitDate: "2025-01-15", recordedAt: "2024-12-05" })])).toBe("AVANT_ORIGINE");
  });
  it("hors horizon ou aucune sortie : rien", () => {
    expect(backtestEvent(ORIGIN, HORIZON, [exit({ resignationDate: "2025-07-01", exitDate: "2025-07-31", recordedAt: "2025-07-01" })])).toBeNull();
    expect(backtestEvent(ORIGIN, HORIZON, [])).toBeNull();
  });
});

describe("getBacktest : aucune démission affichée à une date antérieure ou égale à l'origine", () => {
  let db: ReturnType<typeof openDalDb>;
  let w: ReturnType<typeof buildWorld>;
  const ids: Record<string, number> = {};
  beforeAll(() => {
    db = openDalDb("dal-backtest");
    w = buildWorld(db.sqlite);
    ensureChampion(db.sqlite);
    ids.Y = w.fx.emp({ matricule: "Y1", hire: "2018-01-01", dept: w.dept.prod, managerId: w.e.MGR });
    ids.Z = w.fx.emp({ matricule: "Z1", hire: "2018-01-01", dept: w.dept.prod, managerId: w.e.MGR });
    w.fx.exit(ids.Y, "2024-12-20", "DEMISSION", { recordedAt: "2024-12-22" });
    w.fx.exit(ids.Z, "2025-01-15", "DEMISSION", { resignation: "2024-11-15", recordedAt: "2024-12-05" });
    const pop = [w.e.T1, w.e.T2, w.e.T3, w.e.T4, ids.Y, ids.Z];
    const snap = db.sqlite.prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, ?, 'v1', '[]')");
    for (const id of pop) snap.run(id, ORIGIN);
    publishRun(
      db.sqlite,
      "B0",
      ORIGIN,
      pop.map((employeeId, i) => ({ employeeId, level: i >= 3 ? "ELEVE" : "FAIBLE", prob6: 6 - i, lift: 1 })),
      { version: "b0-v1", current: false },
    );
  });
  afterAll(() => db.close());

  it("dates strictement postérieures, délai positif ; démissionnaire connu avant l'origine exclu de la population", () => {
    const r = getBacktest(w.ctx.rh, { mois: "2024-11" }, { source: "api" }).result!;
    expect(r).toMatchObject({ asOf: ORIGIN, source: "RUN", n: 5, positives: 2 });
    const people = Object.fromEntries(r.people.map((p) => [p.id, p]));
    expect(people[w.e.T4]).toMatchObject({ resigned: true, eventDate: "2025-03-01", delayDays: 91 });
    expect(people[ids.Y]).toMatchObject({ resigned: true, eventDate: "2024-12-20", delayDays: 20 });
    expect(people[ids.Z]).toBeUndefined();
    for (const p of r.people.filter((x) => x.resigned)) {
      expect(p.eventDate! > ORIGIN).toBe(true);
      expect(p.delayDays!).toBeGreaterThan(0);
    }
  });
});

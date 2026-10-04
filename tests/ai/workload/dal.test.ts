import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { runStep } from "@/lib/ai/workload/step";
import type { AccessContext } from "@/lib/dal/context";
import { getWorkload, updateWorkloadRecommendation, type WorkloadManager, type WorkloadRh } from "@/lib/dal/ai-workload";
import { HttpError } from "@/lib/dal/errors";
import { AS_OF, cleanupWorkloadDb, setupWorkloadDb, type Fixture } from "./setup";

let fx: Fixture;
const db = () => getDb().sqlite;
const rh: AccessContext = { userId: 1, login: "rh", role: "RH", employeeId: null };
const admin: AccessContext = { userId: 2, login: "admin", role: "ADMIN", employeeId: null };
const manager = (employeeId: number, userId = 3): AccessContext => ({ userId, login: `mgr${userId}`, role: "MANAGER", employeeId });

beforeAll(() => {
  fx = setupWorkloadDb("dal");
  runStep(db(), AS_OF);
});
afterAll(() => cleanupWorkloadDb(fx.file));

const expectHttp = (fn: () => unknown, status: number) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
    return;
  }
  throw new Error(`HttpError ${status} attendue`);
};
const lastAudit = () => db().prepare("SELECT action, outcome, user_id AS userId, target_id AS targetId FROM audit_log ORDER BY id DESC LIMIT 1").get() as { action: string; outcome: string; userId: number; targetId: string };
const recoId = (where: string) => (db().prepare(`SELECT id FROM insight_recommendation WHERE topic = 'CHARGE_TRAVAIL' AND ${where} LIMIT 1`).get() as { id: number }).id;

describe("DAL charge de travail : rôles et gardes", () => {
  it("refuse l'ADMIN (403) et trace le refus", () => {
    expectHttp(() => getWorkload(admin), 403);
    expect(lastAudit()).toMatchObject({ action: "workload.view", outcome: "REFUSE", userId: admin.userId });
    expectHttp(() => updateWorkloadRecommendation(admin, recoId("scope = 'EQUIPE'"), { status: "REALISEE" }), 403);
  });

  it("donne à la RH départements, équipes, surcharges (hors opposés) et toutes les recommandations, lecture auditée", () => {
    const w = getWorkload(rh) as WorkloadRh;
    expect(w.view).toBe("RH");
    expect(w.asOf).toBe(AS_OF);
    expect(w.departments.map((d) => d.label).sort()).toEqual(["Direction A", "Direction B"]);
    expect(w.teams.map((t) => t.key).sort()).toEqual([fx.mgrA1, fx.mgrB].sort());
    const a1 = w.teams.find((t) => t.key === fx.mgrA1)!;
    expect(a1.observed).toHaveLength(12);
    expect(a1.forecast).toHaveLength(3);
    expect(a1.tension).not.toBeNull();
    expect(w.teams.find((t) => t.key === fx.mgrB)!.tension).toBeNull();
    expect(w.overloads.map((o) => o.employeeId)).toEqual([fx.overloaded]);
    expect(w.overloads[0]).toMatchObject({ months: 5, start: "2026-04" });
    expect(w.recommendations.some((r) => r.scope === "SALARIE" && r.employeeId === fx.overloaded)).toBe(true);
    expect(lastAudit()).toMatchObject({ action: "workload.view", outcome: "OK", userId: rh.userId });
  });

  it("ne montre au manager que ses équipes d'au moins 5 personnes, en agrégé, et ses recommandations collectives", () => {
    const w = getWorkload(manager(fx.head)) as WorkloadManager;
    expect(w.view).toBe("MANAGER");
    expect(w.teams.map((t) => t.key)).toEqual([fx.mgrA1]);
    expect(w.hiddenTeams).toBe(2); // sa propre équipe (2 managers) et celle de 3 personnes
    expect(Object.keys(w)).not.toContain("overloads");
    expect(w.recommendations.length).toBeGreaterThan(0);
    for (const r of w.recommendations) {
      expect(r).toMatchObject({ scope: "EQUIPE", audience: "MANAGER", employeeId: null });
    }
    const json = JSON.stringify(w);
    const names = db().prepare("SELECT first_name || ' ' || last_name AS n FROM employee WHERE id IN (?, ?)").all(fx.overloaded, fx.opposed) as { n: string }[];
    for (const { n } of names) expect(json).not.toContain(n);

    const other = getWorkload(manager(fx.mgrB, 4)) as WorkloadManager;
    expect(other.teams.map((t) => t.key)).toEqual([fx.mgrB]);
    expect(other.recommendations).toEqual([]);
    const small = getWorkload(manager(fx.mgrA2, 5)) as WorkloadManager;
    expect(small.teams).toEqual([]);
    expect(small.hiddenTeams).toBe(1);
  });

  it("laisse le manager traiter les recommandations de ses équipes, jamais les individuelles ni celles d'un autre périmètre", () => {
    const team = recoId(`scope = 'EQUIPE' AND manager_id = ${fx.mgrA1}`);
    const indiv = recoId("scope = 'SALARIE'");
    expectHttp(() => updateWorkloadRecommendation(manager(fx.mgrB, 4), team, { status: "REALISEE" }), 403);
    expect(lastAudit()).toMatchObject({ action: "insight.update", outcome: "REFUSE", targetId: String(team) });
    expectHttp(() => updateWorkloadRecommendation(manager(fx.head), indiv, { status: "REALISEE" }), 403);
    expectHttp(() => updateWorkloadRecommendation(manager(fx.head), 999_999, { status: "REALISEE" }), 404);

    expect(updateWorkloadRecommendation(manager(fx.head), team, { status: "REALISEE", comment: "Renfort intérimaire en octobre" })).toEqual({ id: team, status: "REALISEE" });
    expect(lastAudit()).toMatchObject({ action: "insight.update", outcome: "OK", userId: 3, targetId: String(team) });
    expectHttp(() => updateWorkloadRecommendation(manager(fx.head), team, { status: "REALISEE" }), 409);
  });

  it("exige un commentaire pour rejeter et trace la décision RH", () => {
    const indiv = recoId("scope = 'SALARIE'");
    expect(() => updateWorkloadRecommendation(rh, indiv, { status: "REJETEE" })).toThrow();
    updateWorkloadRecommendation(rh, indiv, { status: "REJETEE", comment: "Heures liées à un projet ponctuel" });
    const row = db().prepare("SELECT status, comment, updated_by AS by FROM insight_recommendation WHERE id = ?").get(indiv);
    expect(row).toEqual({ status: "REJETEE", comment: "Heures liées à un projet ponctuel", by: rh.userId });
    expect(lastAudit()).toMatchObject({ action: "insight.update", outcome: "OK", userId: rh.userId });
  });
});

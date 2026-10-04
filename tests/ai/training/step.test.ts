import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { relanceKey, runStep, teamKey, TEAM_RECO_MIN } from "@/lib/ai/training/step";
import { recordOpposition } from "@/lib/privacy";
import { REF } from "../../fixtures/unit/dal-world";
import { promoteBundle, trainingWorld, VERSION } from "./world";

let world: ReturnType<typeof trainingWorld>;
const sql = () => world.db.sqlite;

const risks = () =>
  sql()
    .prepare("SELECT training_id, employee_id, as_of, prob, level, factors_json, model_version FROM training_risk ORDER BY training_id")
    .all() as { training_id: number; employee_id: number; prob: number; level: string; factors_json: string; model_version: string }[];
const recos = () =>
  sql()
    .prepare("SELECT topic, scope, audience, department_id, manager_id, employee_id, action_code, title, rationale, priority, status, dedup_key FROM insight_recommendation ORDER BY dedup_key")
    .all() as Record<string, unknown>[];
const trainingId = (code: string) => (sql().prepare("SELECT id FROM training WHERE code = ?").get(code) as { id: number }).id;

beforeAll(() => {
  world = trainingWorld("ai-training-step");
});
afterAll(() => world.db.close());

describe("étape IA formation (batch mensuel)", () => {
  it("sans modèle FORMATION champion : étape ignorée, aucune écriture", () => {
    expect(runStep(sql(), REF).summary).toMatch(/aucun modèle FORMATION champion/);
    expect(risks()).toHaveLength(0);
    expect(recos()).toHaveLength(0);
  });

  it("écrit training_risk pour les formations obligatoires ouvertes des salariés actifs, avec niveau et facteurs", () => {
    promoteBundle(sql());
    const s = runStep(sql(), REF).summary;
    expect(s).toContain(VERSION);
    const r = risks();
    const { e } = world.w;
    expect(new Set(r.map((x) => x.employee_id))).toEqual(new Set([e.T1, e.T2, e.T3, e.SUB, e.S1, e.X1, e.T5]));
    expect(r.every((x) => x.model_version === VERSION && x.prob > 0 && x.prob < 1)).toBe(true);
    const near = r.filter((x) => x.training_id !== trainingId("SST-T5"));
    expect(near.every((x) => x.level === "ELEVE")).toBe(true);
    expect(r.find((x) => x.training_id === trainingId("SST-T5"))!.level).not.toBe("ELEVE");
    const f = JSON.parse(near[0].factors_json) as { group: string; phraseRh: string; phraseManager: string }[];
    expect(f[0]).toMatchObject({ group: "ECHEANCE", phraseManager: "Échéance proche" });
  });

  it("recommandations : relance RH par formation à risque élevé, recommandation d'équipe au manager direct si au moins 3 formations à risque", () => {
    const { e } = world.w;
    const all = recos();
    const individual = all.filter((r) => r.scope === "SALARIE");
    expect(individual).toHaveLength(6);
    expect(individual.every((r) => r.audience === "RH" && r.action_code === "RELANCE_FORMATION" && r.topic === "FORMATION")).toBe(true);
    const t1 = all.find((r) => r.dedup_key === relanceKey(trainingId("SST-T1")))!;
    expect(t1.title).toBe("Relancer PrenomT1 NomT1 pour la formation « Formation », échéance dans 3 jours");
    expect(t1).toMatchObject({ priority: 1, employee_id: e.T1, manager_id: e.MGR });
    const team = all.filter((r) => r.scope === "EQUIPE");
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ audience: "MANAGER", manager_id: e.MGR, employee_id: null, action_code: "PLANIFIER_TEMPS_FORMATION", dedup_key: teamKey(e.MGR, REF) });
    expect(team[0].title).toBe("4 formations obligatoires de votre équipe risquent de dépasser l'échéance : planifiez du temps de formation");
    expect(String(team[0].rationale)).not.toMatch(/Prenom|Nom|%/);
    expect(TEAM_RECO_MIN).toBe(3);
  });

  it("idempotente : rejouer le même mois donne exactement le même état", () => {
    const before = { r: risks(), c: recos() };
    runStep(sql(), REF);
    runStep(sql(), REF);
    expect(risks()).toEqual(before.r);
    expect(recos()).toEqual(before.c);
  });

  it("une recommandation déjà traitée n'est ni recréée ni réécrite", () => {
    const key = relanceKey(trainingId("SST-T1"));
    sql().prepare("UPDATE insight_recommendation SET status = 'REALISEE', title = 'traitée' WHERE dedup_key = ?").run(key);
    runStep(sql(), REF);
    expect(sql().prepare("SELECT status, title FROM insight_recommendation WHERE dedup_key = ?").all(key)).toEqual([{ status: "REALISEE", title: "traitée" }]);
  });

  it("salarié opposé au traitement : ni risque, ni relance ; l'équipe n'en compte plus que 3", () => {
    const { e } = world.w;
    recordOpposition(sql(), { employeeId: e.T2 });
    runStep(sql(), REF);
    expect(risks().some((x) => x.employee_id === e.T2)).toBe(false);
    expect(recos().some((r) => r.employee_id === e.T2)).toBe(false);
    const team = recos().find((r) => r.dedup_key === teamKey(e.MGR, REF))!;
    expect(team.title).toMatch(/^3 formations obligatoires/);
  });
});

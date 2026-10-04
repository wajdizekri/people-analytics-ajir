import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { countOpenAlerts, getAlert, listAlerts, updateAlert } from "@/lib/dal/alerts";
import {
  decideRecommendation,
  decideSchema,
  listRecommendations,
  recommendationListSchema,
  setRecommendationFeedback,
} from "@/lib/dal/recommendations";
import { getEmployeeDetail } from "@/lib/dal/employees";
import { createAlert } from "@/lib/engine/alerts";
import { SUPERSEDED_COMMENT } from "@/lib/engine/recommendations";
import { auditOf, buildWorld, expectHttp, openDalDb, publishRun, REF } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
const reco: Record<string, number> = {};
const alert: Record<string, number> = {};

beforeAll(() => {
  db = openDalDb("dal-recos-alerts");
  w = buildWorld(db.sqlite);
  const { e } = w;
  publishRun(db.sqlite, "B0", REF, [
    { employeeId: e.T1, level: "ELEVE", prob6: 3, lift: 3 },
    { employeeId: e.MGR2, level: "MOYEN", prob6: 2, lift: 2 },
  ]);
  const ins = db.sqlite.prepare("INSERT INTO recommendation (employee_id, action_code, trigger_group, status, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const add = (k: string, emp: number, action: string, group: string, status = "PROPOSEE", feedback: string | null = null, at = "2025-07-01T00:00:00Z") =>
    (reco[k] = Number(ins.run(emp, action, group, status, feedback, at).lastInsertRowid));
  add("t1Entretien", e.T1, "ENTRETIEN", "NIVEAU_ELEVE");
  add("t1Salaire", e.T1, "REVISION_SALARIALE", "REMUNERATION", "PROPOSEE", null, "2025-07-02T00:00:00Z");
  add("m2Charge", e.MGR2, "CHARGE_TRAVAIL", "TEMPS_TRAVAIL");
  add("t2Done", e.T2, "PLAN_FORMATION", "FORMATION_EVAL", "REALISEE", "PERTINENTE", "2025-05-01T00:00:00Z");
  add("t3Rejected", e.T3, "PLAN_FORMATION", "FORMATION_EVAL", "REJETEE", "NON_PERTINENTE", "2025-05-02T00:00:00Z");
  db.sqlite.prepare("INSERT INTO intervention (employee_id, recommendation_id, date, action_code) VALUES (?, ?, '2025-05-10', 'PLAN_FORMATION')").run(e.T2, reco.t2Done);

  const a = (k: string, input: Parameters<typeof createAlert>[1]) => {
    createAlert(db.sqlite, input);
    alert[k] = (db.sqlite.prepare("SELECT id FROM alert WHERE dedup_key = ?").get(input.dedupKey) as { id: number }).id;
  };
  const base = { severity: "ATTENTION" as const, title: "t", message: "m" };
  a("turnoverT1", { ...base, type: "TURNOVER", audience: "MANAGER", employeeId: e.T1, managerId: e.MGR, dedupKey: "k1", link: `/employees/${e.T1}` });
  a("teamSub", { ...base, type: "ABSENTEISME", audience: "MANAGER", managerId: e.SUB, dedupKey: "k2", link: "//evil.example/x" });
  a("absIndiv", { ...base, type: "ABSENTEISME", audience: "MANAGER", employeeId: e.S1, managerId: e.SUB, dedupKey: "k3", link: "https://evil.example" });
  a("teamMgr2", { ...base, type: "ABSENTEISME", audience: "MANAGER", managerId: e.MGR2, dedupKey: "k4" });
  a("rhOnly", { ...base, type: "TURNOVER", audience: "RH", employeeId: e.T1, dedupKey: "k5", severity: "CRITIQUE" });
  a("system", { ...base, type: "SYSTEME", audience: "ADMIN", dedupKey: "k6" });
  a("dataRh", { ...base, type: "DONNEES", audience: "RH", dedupKey: "k7", severity: "INFO" });
  a("dataNominative", { ...base, type: "DONNEES", audience: "RH", employeeId: e.T2, dedupKey: "k8" });
  db.sqlite.prepare("UPDATE alert SET status = 'TRAITEE' WHERE id = ?").run(alert.dataRh);
});
afterAll(() => db.close());

const q = (raw: Record<string, string> = {}) => recommendationListSchema.parse(raw);

describe("recommandations : liste et KPI d'adoption", () => {
  it("proposées d'abord, priorisées (risque élevé, entretien) puis les plus récentes ; niveau du run courant ; libellé du déclencheur", () => {
    const r = listRecommendations(w.ctx.rh, q());
    expect(r.rows.map((x) => x.id)).toEqual([reco.t1Entretien, reco.t1Salaire, reco.m2Charge, reco.t3Rejected, reco.t2Done]);
    expect(r.rows.find((x) => x.id === reco.t1Entretien)).toMatchObject({ level: "ELEVE", employee: { id: w.e.T1, matricule: "T1" }, triggerLabel: "NIVEAU_ELEVE" });
    expect(r.rows.find((x) => x.id === reco.t2Done)).toMatchObject({ level: null, interventionDate: "2025-05-10", triggerLabel: "Formation et évaluation" });
    expect(r.kpis).toEqual({ total: 5, proposed: 3, done: 1, rejected: 1, superseded: 0, adoptionRate: 0.5, feedbackCount: 2, relevantRate: 0.5, interventions: 1 });
    expect(r.actions).toEqual(["CHARGE_TRAVAIL", "ENTRETIEN", "PLAN_FORMATION", "REVISION_SALARIALE"]);
  });

  it("filtres action et département appliqués aux KPI ; statut à la liste seulement ; KPI vides = taux indéfinis", () => {
    const r = listRecommendations(w.ctx.rh, q({ action: "PLAN_FORMATION", statut: "REALISEE" }));
    expect(r.rows.map((x) => x.id)).toEqual([reco.t2Done]);
    expect(r.kpis).toMatchObject({ total: 2, done: 1, rejected: 1 });
    const com = listRecommendations(w.ctx.rh, q({ departement: String(w.dept.com) }));
    expect(com.rows.map((x) => x.id)).toEqual([reco.m2Charge]);
    expect(com.kpis).toEqual({ total: 1, proposed: 1, done: 0, rejected: 0, superseded: 0, adoptionRate: null, feedbackCount: 0, relevantRate: null, interventions: 0 });
    expect(listRecommendations(w.ctx.rh, q({ page: "50" }))).toMatchObject({ page: 1, pageCount: 1, total: 5 });
    expect(() => q({ action: "drop table" })).toThrow(ZodError);
  });

  it("remplacées par un nouveau calcul : hors des rejets et du taux d'adoption, comptées à part, signalées sur la liste et la fiche", () => {
    const ins = db.sqlite.prepare("INSERT INTO recommendation (employee_id, action_code, trigger_group, status, comment, created_at) VALUES (?, ?, ?, 'REJETEE', ?, '2025-04-01T00:00:00Z')");
    const sup = Number(ins.run(w.e.T3, "CHARGE_TRAVAIL", "TEMPS_TRAVAIL", SUPERSEDED_COMMENT).lastInsertRowid);
    const near = Number(ins.run(w.e.T3, "ENTRETIEN", "NIVEAU_ELEVE", `${SUPERSEDED_COMMENT} (copie)`).lastInsertRowid);
    try {
      const r = listRecommendations(w.ctx.rh, q());
      expect(r.kpis).toMatchObject({ total: 7, proposed: 3, done: 1, rejected: 2, superseded: 1, adoptionRate: 1 / 3 });
      expect(r.rows.find((x) => x.id === sup)).toMatchObject({ status: "REJETEE", superseded: true });
      expect(r.rows.find((x) => x.id === near)?.superseded).toBe(false);
      expect(r.rows.find((x) => x.id === reco.t3Rejected)?.superseded).toBe(false);
      const fiche = getEmployeeDetail(w.ctx.rh, w.e.T3, { source: "page" });
      expect(fiche.recommendations.find((x) => x.id === sup)?.superseded).toBe(true);
      expect(fiche.recommendations.find((x) => x.id === reco.t3Rejected)?.superseded).toBe(false);
    } finally {
      db.sqlite.prepare("DELETE FROM recommendation WHERE id IN (?, ?)").run(sup, near);
    }
  });

  it("manager et admin : 403 audité", () => {
    expectHttp(() => listRecommendations(w.ctx.mgr, q()), 403);
    expectHttp(() => listRecommendations(w.ctx.admin, q()), 403);
    expect(auditOf(db.sqlite, "recommendation.list").map((a) => [a.userId, a.outcome])).toEqual([
      [w.users.mgr, "REFUSE"],
      [w.users.admin, "REFUSE"],
    ]);
  });
});

describe("recommandations : décision et retour", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("schéma : date obligatoire et non future pour une réalisation ; commentaire d'au moins 3 caractères pour un rejet", () => {
    expect(decideSchema.safeParse({ recommendationId: "3", decision: "REALISEE" }).success).toBe(false);
    expect(decideSchema.safeParse({ recommendationId: 3, decision: "REALISEE", date: "2999-01-01" }).success).toBe(false);
    expect(decideSchema.safeParse({ recommendationId: 3, decision: "REALISEE", date: "01/07/2025" }).success).toBe(false);
    expect(decideSchema.safeParse({ recommendationId: 3, decision: "REJETEE", comment: " no " }).success).toBe(false);
    expect(decideSchema.safeParse({ recommendationId: 3, decision: "REJETEE", comment: "hors sujet" }).success).toBe(true);
    expect(decideSchema.safeParse({ recommendationId: 0, decision: "REJETEE", comment: "hors sujet" }).success).toBe(false);
  });

  it("rejet : aucun intervention créée, commentaire et retour conservés ; double traitement 409", () => {
    const res = decideRecommendation(w.ctx.rh, decideSchema.parse({ recommendationId: reco.m2Charge, decision: "REJETEE", comment: "déjà traité", feedback: "NON_PERTINENTE" }));
    expect(res).toEqual({ employeeId: w.e.MGR2, interventionId: null });
    expect(db.sqlite.prepare("SELECT status, comment, feedback, updated_by AS u FROM recommendation WHERE id = ?").get(reco.m2Charge)).toEqual({
      status: "REJETEE",
      comment: "déjà traité",
      feedback: "NON_PERTINENTE",
      u: w.users.rh,
    });
    expectHttp(() => decideRecommendation(w.ctx.rh, decideSchema.parse({ recommendationId: reco.m2Charge, decision: "REALISEE", date: today })), 409, "DEJA_TRAITEE");
    expect(JSON.parse(auditOf(db.sqlite, "recommendation.decide").at(-1)!.detail!)).toMatchObject({ decision: "REJETEE", interventionId: null, feedback: "NON_PERTINENTE" });
  });

  it("réalisation : intervention datée ; retour absent = retour existant conservé", () => {
    db.sqlite.prepare("UPDATE recommendation SET feedback = 'PERTINENTE' WHERE id = ?").run(reco.t1Entretien);
    const res = decideRecommendation(w.ctx.rh, decideSchema.parse({ recommendationId: reco.t1Entretien, decision: "REALISEE", date: "2025-07-15" }));
    expect(res.interventionId).toEqual(expect.any(Number));
    expect(db.sqlite.prepare("SELECT employee_id AS e, date, action_code AS a, created_by AS u FROM intervention WHERE id = ?").get(res.interventionId)).toEqual({
      e: w.e.T1,
      date: "2025-07-15",
      a: "ENTRETIEN",
      u: w.users.rh,
    });
    expect(db.sqlite.prepare("SELECT feedback FROM recommendation WHERE id = ?").get(reco.t1Entretien)).toEqual({ feedback: "PERTINENTE" });
  });

  it("recommandation inexistante 404 pour la RH ; manager 403 (sans révéler l'existence) audité", () => {
    expectHttp(() => decideRecommendation(w.ctx.rh, decideSchema.parse({ recommendationId: 999_999, decision: "REJETEE", comment: "abc" })), 404);
    expectHttp(() => decideRecommendation(w.ctx.mgr, decideSchema.parse({ recommendationId: 999_999, decision: "REJETEE", comment: "abc" })), 403);
    expectHttp(() => setRecommendationFeedback(w.ctx.mgr, { recommendationId: reco.t1Salaire, feedback: "PERTINENTE" }), 403);
    expect(auditOf(db.sqlite, "recommendation.feedback").at(-1)).toMatchObject({ outcome: "REFUSE", targetType: "recommendation", targetId: String(reco.t1Salaire) });
  });

  it("retour sur une recommandation déjà traitée : autorisé, audité", () => {
    expect(setRecommendationFeedback(w.ctx.rh, { recommendationId: reco.t3Rejected, feedback: "PERTINENTE" })).toEqual({ employeeId: w.e.T3 });
    expect(db.sqlite.prepare("SELECT status, feedback FROM recommendation WHERE id = ?").get(reco.t3Rejected)).toEqual({ status: "REJETEE", feedback: "PERTINENTE" });
    expect(auditOf(db.sqlite, "recommendation.feedback").at(-1)).toMatchObject({ outcome: "OK", userId: w.users.rh });
  });
});

describe("alertes : visibilité par rôle", () => {
  it("manager : alertes MANAGER de sa hiérarchie (sous-équipes comprises), jamais un signal individuel d'absentéisme", () => {
    expect(new Set(listAlerts(w.ctx.mgr).map((a) => a.id))).toEqual(new Set([alert.turnoverT1, alert.teamSub]));
    expect(listAlerts(w.ctx.sub).map((a) => a.id)).toEqual([alert.teamSub]);
    expect(listAlerts(w.ctx.mgr2).map((a) => a.id)).toEqual([alert.teamMgr2]);
    expect(listAlerts(w.ctx.orphan)).toEqual([]);
    expect(countOpenAlerts(w.ctx.mgr)).toBe(2);
    expect(countOpenAlerts(w.ctx.orphan)).toBe(0);
    expectHttp(() => getAlert(w.ctx.mgr, alert.absIndiv), 403);
  });

  it("RH : tout sauf l'audience ADMIN ; ADMIN : système et données non nominatives ; compteur des ouvertes", () => {
    const rh = listAlerts(w.ctx.rh).map((a) => a.id);
    expect(rh).not.toContain(alert.system);
    expect(rh).toHaveLength(Object.keys(alert).length - 1);
    expect(rh[0]).toBe(alert.rhOnly);
    expect(rh.at(-1)).toBe(alert.dataRh);
    expect(countOpenAlerts(w.ctx.rh)).toBe(Object.keys(alert).length - 2);
    expect(new Set(listAlerts(w.ctx.admin).map((a) => a.id))).toEqual(new Set([alert.system, alert.dataRh]));
    expect(countOpenAlerts(w.ctx.admin)).toBe(1);
    expect(listAlerts(w.ctx.rh, { type: "DONNEES", status: "TRAITEE", severity: "INFO" }).map((a) => a.id)).toEqual([alert.dataRh]);
    expect(listAlerts(w.ctx.rh, { limit: 2 })).toHaveLength(2);
  });

  it("liens : seuls les chemins internes sont conservés ; nom du salarié ; alerte clôturée non modifiable", () => {
    const rh = Object.fromEntries(listAlerts(w.ctx.rh).map((a) => [a.id, a]));
    expect(rh[alert.turnoverT1]).toMatchObject({ link: `/employees/${w.e.T1}`, employeeName: "PrenomT1 NomT1", canEdit: true });
    expect(rh[alert.teamSub].link).toBeNull();
    expect(rh[alert.absIndiv].link).toBeNull();
    expect(rh[alert.teamMgr2]).toMatchObject({ link: null, employeeName: null });
    expect(rh[alert.dataRh].canEdit).toBe(false);
  });
});

describe("alertes : liens", () => {
  // B4 (docs/qa/COUVERTURE.md), corrigé : "/\evil.example" commence par "/" mais pas par "//" ; les navigateurs lisent
  // "\" comme "/" dans une URL http(s). safeInternalLink n'accepte qu'un seul "/" suivi d'un caractère autre que "/" ou "\".
  it("un lien « /\\hôte » (équivalent navigateur de « //hôte ») est neutralisé", () => {
    createAlert(db.sqlite, { type: "DONNEES", severity: "INFO", audience: "RH", title: "t", message: "m", dedupKey: "k-backslash", link: "/\\evil.example/login" });
    const id = (db.sqlite.prepare("SELECT id FROM alert WHERE dedup_key = 'k-backslash'").get() as { id: number }).id;
    expect(new URL("/\\evil.example/login", "https://pa.atlas.tn").host).toBe("evil.example");
    expect(getAlert(w.ctx.rh, id).link).toBeNull();
  });
});

describe("alertes : traitement", () => {
  it("transition depuis un état final refusée (409) ; alerte inexistante 404 ; commentaire trop long refusé", () => {
    expectHttp(() => updateAlert(w.ctx.rh, alert.dataRh, { status: "EN_COURS" }), 409, "TRANSITION_INVALIDE");
    expectHttp(() => updateAlert(w.ctx.rh, 999_999, { status: "EN_COURS" }), 404);
    expect(() => updateAlert(w.ctx.rh, alert.rhOnly, { status: "TRAITEE", comment: "x".repeat(1001) })).toThrow(ZodError);
    expect(() => updateAlert(w.ctx.rh, alert.rhOnly, { status: "NOUVELLE" as never })).toThrow(ZodError);
  });

  it("manager : traite une alerte de sous-équipe ; commentaire vide ignoré ; auteur tracé", () => {
    const a = updateAlert(w.ctx.mgr, alert.teamSub, { status: "EN_COURS", comment: "   " });
    expect(a).toMatchObject({ status: "EN_COURS", comment: null, updatedByLogin: "mgr", canEdit: true });
    const b = updateAlert(w.ctx.mgr, alert.teamSub, { status: "TRAITEE", comment: "entretien fait" });
    expect(b).toMatchObject({ status: "TRAITEE", comment: "entretien fait", canEdit: false });
    expect(JSON.parse(auditOf(db.sqlite, "alert.update").at(-1)!.detail!)).toEqual({ from: "EN_COURS", to: "TRAITEE", comment: true });
    expect(countOpenAlerts(w.ctx.sub)).toBe(0);
    expectHttp(() => updateAlert(w.ctx.mgr2, alert.teamSub, { status: "REJETEE", comment: "pas moi" }), 403);
    expect(auditOf(db.sqlite, "alert.update").at(-1)).toMatchObject({ outcome: "REFUSE", userId: w.users.mgr2 });
  });
});

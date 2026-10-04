import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import type { AccessContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { getSynthesis, getEmployeeJourney, getEmployeeNews, pickStatements, MAX_STATEMENTS } from "@/lib/dal/synthesis";
import { getTeams, tensionSignals } from "@/lib/dal/teams";
import { getEmployeeInterventionEffects, getInterventions } from "@/lib/dal/interventions";
import { clearDriftCache, getDrift, retrainAdvice } from "@/lib/dal/drift";
import { CONSTANT_P, auditRows, createFixture, ctxOf, destroyFixture, leaks, logregManifest, meta, type Fixture } from "./fixture";

let f: Fixture;
let c: ReturnType<typeof ctxOf>;
let managerS: AccessContext;
const db = () => getDb().sqlite;

beforeAll(() => {
  f = createFixture("dal");
  c = ctxOf(f);
  managerS = { userId: f.users.manager, login: "mgr.s", role: "MANAGER", employeeId: f.ids.S };
});
afterAll(() => destroyFixture(f));

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 200;
};

// Valeurs sensibles : probabilités et lifts non entiers, montants d'augmentation, phrases chiffrées RH
function sensitive() {
  const nums = [
    ...(db().prepare("SELECT prob6 AS v FROM prediction").all() as { v: number }[]),
    ...(db().prepare("SELECT lift AS v FROM prediction").all() as { v: number }[]),
  ]
    .map((r) => r.v)
    .filter((v) => !Number.isInteger(v));
  return { numbers: [...nums, 1234.5, 1357.25], strings: ["9,5 %", "TND", "h supplémentaires par mois en moyenne"] };
}

describe("rôles et séparation des tâches", () => {
  it("ADMIN : synthèse, équipes, interventions et composants de fiche refusés (403 audité) ; dérive agrégée autorisée", () => {
    expect(status(() => getSynthesis(c.admin, meta))).toBe(403);
    expect(status(() => getTeams(c.admin, {}, meta))).toBe(403);
    expect(status(() => getInterventions(c.admin, { page: 1 }, meta))).toBe(403);
    expect(status(() => getEmployeeNews(c.admin, f.ids.A1, meta))).toBe(403);
    expect(status(() => getEmployeeJourney(c.admin, f.ids.A1, meta))).toBe(403);
    expect(status(() => getEmployeeInterventionEffects(c.admin, f.ids.B1, meta))).toBe(403);
    for (const a of ["synthesis.view", "teams.view", "interventions.view", "employee.news.view", "employee.journey.view", "employee.effects.view"])
      expect(auditRows(a).some((r) => r.userId === f.users.admin && r.outcome === "REFUSE"), a).toBe(true);
    const d = getDrift(c.admin);
    expect(d.view).toBe("ADMIN");
    const json = JSON.stringify(d);
    for (const k of ['"observed"', '"expected"', '"referenceRate"', "Nom", "Prenom", "M-"]) expect(json).not.toContain(k);
    expect(d.variables.length).toBe(25);
  });

  it("MANAGER : interventions et dérive refusées ; hors périmètre 403 audité ; inexistant 404", () => {
    expect(status(() => getInterventions(c.manager, { page: 1 }, meta))).toBe(403);
    expect(status(() => getDrift(c.manager))).toBe(403);
    expect(auditRows("drift.view").some((r) => r.userId === f.users.manager && r.outcome === "REFUSE")).toBe(true);
    expect(status(() => getEmployeeNews(c.manager, f.ids.C1, meta))).toBe(403);
    expect(status(() => getEmployeeJourney(c.manager, f.ids.C1, meta))).toBe(403);
    expect(status(() => getEmployeeInterventionEffects(c.manager, f.ids.C1, meta))).toBe(403);
    expect(auditRows("employee.news.view").some((r) => r.outcome === "REFUSE" && r.targetId === String(f.ids.C1))).toBe(true);
    expect(status(() => getEmployeeNews(c.rh, 999999, meta))).toBe(404);
  });

  it("DTO manager : ni probabilité, ni lift, ni salaire, ni phrase chiffrée, ni signal individuel d'absence ou d'heures sup", () => {
    const { numbers, strings } = sensitive();
    const dtos = [
      getSynthesis(c.manager, meta),
      getTeams(c.manager, {}, meta),
      getEmployeeNews(c.manager, f.ids.A1, meta),
      getEmployeeJourney(c.manager, f.ids.A1, meta),
      getEmployeeInterventionEffects(c.manager, f.ids.B1, meta),
    ];
    for (const d of dtos) expect(leaks(d, numbers, strings)).toEqual([]);
    // Contrôle du détecteur : le DTO RH de la fiche contient bien ces éléments
    expect(leaks(getEmployeeNews(c.rh, f.ids.A1, meta), numbers, strings).length).toBeGreaterThan(0);
  });
});

describe("synthèse du mois", () => {
  it("RH : entrées, sorties, risques, absentéisme, heures sup, alertes, recommandations et formations exacts", () => {
    const s = getSynthesis(c.rh, meta);
    expect(s).toMatchObject({ view: "RH", month: "2026-08", previousMonth: "2026-07", current: { asOf: "2026-08-31" }, previous: { asOf: "2026-07-31" }, smallPopulation: false });
    const k = s.kpis;
    expect(k.headcount).toEqual({ now: 16, before: 16 });
    expect(k).toMatchObject({ entries: 1, exits: 1, voluntaryExits: 1, high: 3, newHigh: 2, leftHigh: 2 });
    // Août : 3 j d'absence non planifiée (A1 2 j, B1 1 j) / 346 j ouvrés (15 × 21 + A6 10 + A7 21) ; juillet : 3 j (A2) / 16 × 23
    expect(k.absenteeism.now).toBeCloseTo(3 / 346, 12);
    expect(k.absenteeism.before).toBeCloseTo(3 / 368, 12);
    // Heures sup : 7 h pour 17 présents en août ; 2 h pour 16 présents en juillet
    expect(k.overtime.now).toBeCloseTo(7 / 17, 12);
    expect(k.overtime.before).toBeCloseTo(2 / 16, 12);
    expect(k.alerts).toEqual({ open: 2, critical: 1, sincePrevious: 2 });
    expect(k.recommendations).toEqual({ open: 2, sincePrevious: 2 });
    expect(k.trainingsOverdue).toEqual({ total: 2, thisMonth: 1 });
    expect(s.newHigh.map((p) => [p.id, p.before, p.after, p.reason])).toEqual([
      [f.ids.A1, "FAIBLE", "ELEVE", "HAUSSE"],
      [f.ids.A2, "MOYEN", "ELEVE", "HAUSSE"],
    ]);
    // C5 (opposé) exclu bien qu'il ait eu une prédiction ÉLEVÉ en juillet
    expect(s.leftHigh.map((p) => [p.id, p.reason])).toEqual([
      [f.ids.A3, "BAISSE"],
      [f.ids.A6, "SORTI"],
    ]);
    expect(auditRows("synthesis.view").some((r) => r.userId === f.users.rh && r.outcome === "OK")).toBe(true);
  });

  it("RH : 5 à 8 constats rédigés, les alertes d'abord, avec liens", () => {
    const s = getSynthesis(c.rh, meta);
    expect(s.statements.length).toBeGreaterThanOrEqual(5);
    expect(s.statements.length).toBeLessThanOrEqual(MAX_STATEMENTS);
    const texts = s.statements.map((x) => x.text);
    expect(texts).toContain("2 collaborateurs de Production sont passés en risque élevé depuis le calcul de juillet 2026.");
    expect(texts).toContain("2 collaborateurs ne sont plus en risque élevé (1 dont le niveau a baissé, 1 sorti de l'entreprise).");
    expect(texts).toContain("1 entrée et 1 sortie depuis le calcul de juillet 2026, dont 1 départ volontaire.");
    expect(texts.some((t) => t.startsWith("L'absentéisme hors santé reste stable : 0,9 % en août 2026"))).toBe(true);
    expect(texts).toContain("2 formations obligatoires sont en retard, dont 1 arrivée à échéance depuis le calcul de juillet 2026.");
    expect(s.statements[0].tone).toBe("alerte");
    const prod = (db().prepare("SELECT id FROM department WHERE code = 'PROD'").get() as { id: number }).id;
    expect(s.statements.find((x) => x.key === "nouveaux-eleves")?.href).toBe(`/employees?niveau=ELEVE&departement=${prod}`);
    const tones = s.statements.map((x) => ["alerte", "attention", "info", "positif"].indexOf(x.tone));
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
  });

  it("MANAGER : sa hiérarchie seulement ; recommandations réservées à la RH exclues", () => {
    const s = getSynthesis(c.manager, meta);
    expect(s.view).toBe("MANAGER");
    expect(s.kpis.headcount).toEqual({ now: 9, before: 9 });
    expect(s.kpis).toMatchObject({ entries: 1, exits: 1, voluntaryExits: 1, high: 2 });
    expect(s.kpis.absenteeism.now).toBeCloseTo(3 / 199, 12);
    expect(s.kpis.absenteeism.before).toBeCloseTo(3 / 207, 12);
    expect(s.kpis.overtime.now).toBeCloseTo(3 / 10, 12);
    expect(s.kpis.alerts.open).toBe(1);
    expect(s.kpis.recommendations.open).toBe(1);
    const scope = new Set([f.ids.A1, f.ids.A2, f.ids.A3, f.ids.A4, f.ids.A5, f.ids.A6, f.ids.A7, f.ids.S, f.ids.B1, f.ids.B2]);
    expect([...s.newHigh, ...s.leftHigh].every((p) => scope.has(p.id))).toBe(true);
    expect(s.statements.find((x) => x.key === "recommandations")?.text).toBe("1 recommandation concerne des collaborateurs de votre équipe ; la RH les instruit avec vous.");
  });

  it("MANAGER, petite population (2 personnes) : sorties, absentéisme et heures sup masqués", () => {
    const s = getSynthesis(managerS, meta);
    expect(s.smallPopulation).toBe(true);
    expect(s.kpis).toMatchObject({ exits: null, voluntaryExits: null, absenteeism: { now: null, before: null }, overtime: { now: null, before: null } });
    expect(s.statements.find((x) => x.key === "mouvements")?.text).toContain("les sorties ne sont pas affichées pour un groupe de moins de 5 personnes");
    expect(s.statements.some((x) => x.key === "absenteisme" || x.key === "heures-sup")).toBe(false);
    expect(s.statements.length).toBeGreaterThanOrEqual(5);
  });

  it("sélection des constats : remplissage jusqu'à 5, plafond à 8, ordre par priorité", () => {
    const d = (key: string, tone: "alerte" | "attention" | "info" | "positif", filler = false) => ({ key, tone, text: key, href: null, linkLabel: null, filler });
    expect(pickStatements([d("a", "positif"), d("b", "alerte"), d("f1", "info", true), d("f2", "info", true), d("f3", "info", true), d("f4", "info", true)]).map((s) => s.key)).toEqual([
      "b",
      "f1",
      "f2",
      "f3",
      "a",
    ]);
    expect(pickStatements(Array.from({ length: 10 }, (_, i) => d(`k${i}`, "info")))).toHaveLength(8);
  });
});

describe("mes équipes", () => {
  it("RH : effectif, niveaux, absentéisme, heures sup, formations, recommandations et tension exacts", () => {
    const t = getTeams(c.rh, {}, meta);
    expect(t.teams.map((x) => x.managerId)).toEqual([f.ids.R, f.ids.Q, f.ids.S]);
    const r = t.teams[0];
    expect(r).toMatchObject({ headcount: 7, present: 8, masked: false, openRecommendations: 2, risk: { ELEVE: 2, MOYEN: 1, FAIBLE: 3, nonScored: 1 } });
    // Juin-août : 6 × 66 j ouvrés + A6 (55) + A7 (21) = 472 ; 5 j d'absence ; 3 h sup sur 22 mois-personnes
    expect(r.absenteeismRate).toBeCloseTo(5 / 472, 12);
    expect(r.overtimePerHead).toBeCloseTo(3 / 22, 12);
    expect(r.trainings.overdue).toBe(1);
    expect(r.signals).toEqual(["RISQUE", "RECOMMANDATIONS"]);
    expect(r.tension).toBe("TENSION");
    const sTeam = t.teams.find((x) => x.managerId === f.ids.S)!;
    expect(sTeam.absenteeismRate).toBeCloseTo(1 / 132, 12);
    expect(sTeam.signals).toEqual(["FORMATION"]);
    const q = t.teams.find((x) => x.managerId === f.ids.Q)!;
    expect(q.risk).toEqual({ ELEVE: 1, MOYEN: 0, FAIBLE: 3, nonScored: 1 });
    expect(q.signals).toEqual(["RISQUE"]);
    expect(t.tensionCounts).toEqual({ FORTE: 0, TENSION: 1, SURVEILLER: 2, STABLE: 0 });
    expect(t.total.absenteeismRate).toBeCloseTo(6 / 1066, 12);
    expect(t.total.overtimePerHead).toBeCloseTo(11 / 49, 12);
    expect(t.maskedTeams).toBe(0);
  });

  it("RH : filtres département et tension", () => {
    const com = (db().prepare("SELECT id FROM department WHERE code = 'COM'").get() as { id: number }).id;
    const t = getTeams(c.rh, { departement: com }, meta);
    expect(t.teams.map((x) => x.managerId)).toEqual([f.ids.Q]);
    expect(t.total.headcount).toBe(5);
    expect(getTeams(c.rh, { tension: "oui" }, meta).teams).toHaveLength(3);
  });

  it("MANAGER : équipes de sa hiérarchie seulement ; petite équipe masquée et celle qui la révélerait par différence aussi", () => {
    const t = getTeams(c.manager, { departement: 999 }, meta);
    expect(t.view).toBe("MANAGER");
    expect(t.filters.departement).toBeNull();
    expect(t.teams.map((x) => x.managerId).sort()).toEqual([f.ids.R, f.ids.S].sort());
    expect(t.teams.every((x) => x.masked && x.absenteeismRate === null && x.overtimePerHead === null)).toBe(true);
    expect(t.maskedTeams).toBe(2);
    expect(t.total.masked).toBe(false);
    expect(t.total.absenteeismRate).toBeCloseTo(6 / 604, 12);
    // Indicateur masqué : jamais de signal ; recommandations réservées à la RH non comptées
    const r = t.teams.find((x) => x.managerId === f.ids.R)!;
    expect(r.openRecommendations).toBe(1);
    expect(r.signals).toEqual(["RISQUE"]);
    const small = getTeams(managerS, {}, meta);
    expect(small.total.masked).toBe(true);
    expect(small.teams[0].absenteeismRate).toBeNull();
  });

  it("signaux : un indicateur masqué n'en produit aucun", () => {
    const base = { headcount: 10, risk: { ELEVE: 0, MOYEN: 0, FAIBLE: 10, nonScored: 0 }, trainings: { overdue: 0, due: 0, done: 0, rate: null }, openRecommendations: 0 };
    expect(tensionSignals({ ...base, absenteeismRate: 0.05, overtimePerHead: 25 }, { absenteeismRate: 0.02, overtimePerHead: 5 })).toEqual(["ABSENTEISME", "HEURES_SUP"]);
    expect(tensionSignals({ ...base, absenteeismRate: null, overtimePerHead: null }, { absenteeismRate: 0.02, overtimePerHead: 5 })).toEqual([]);
  });
});

describe("interventions", () => {
  it("mesure avant / après exacte (3 mois de part et d'autre) et taux de réalisation par type d'action", () => {
    const d = getInterventions(c.rh, { page: 1 }, meta);
    expect(d.rows.map((r) => [r.employee.id, r.actionCode, r.date, r.source])).toEqual([
      [f.ids.C2, "PLAN_FORMATION", "2026-08-20", "RECOMMANDATION"],
      [f.ids.B1, "ENTRETIEN", "2026-04-15", "INTERVENTION"],
    ]);
    const m = d.rows[1].measure!;
    // Avant : janv.-mars (22 + 20 + 22 j ouvrés, 2 j d'absence, 30 h sup) ; après : mai-juil. (21 + 22 + 23 j, 0 j, 6 h)
    expect(m).toMatchObject({ complete: true, monthsBefore: 3, monthsAfter: 3, levelBefore: "ELEVE", levelAfter: "FAIBLE", levelChange: "BAISSE" });
    expect(m.absenteeismBefore).toBeCloseTo(2 / 64, 12);
    expect(m.absenteeismAfter).toBe(0);
    expect(m.overtimeBefore).toBeCloseTo(10, 12);
    expect(m.overtimeAfter).toBeCloseTo(2, 12);
    expect(d.rows[0].measure).toMatchObject({ complete: false, monthsAfter: 0, levelBefore: "FAIBLE", levelAfter: null, absenteeismAfter: null });
    const by = Object.fromEntries(d.byAction.map((a) => [a.actionCode, a]));
    expect(by.ENTRETIEN).toMatchObject({ proposed: 1, done: 1, rejected: 0, total: 2, completionRate: 0.5, actions: 1, measured: 1, levelDown: 1 });
    expect(by.PLAN_FORMATION).toMatchObject({ done: 1, total: 1, completionRate: 1, actions: 1, measured: 0 });
    expect(by.CHARGE_TRAVAIL).toMatchObject({ rejected: 1, completionRate: 0 });
    expect(by.REVISION_SALARIALE).toMatchObject({ proposed: 1, completionRate: 0 });
    expect(d.totals).toMatchObject({ proposed: 2, done: 2, rejected: 1, total: 5, completionRate: 0.4, actions: 2, measured: 1, levelDown: 1 });
    expect(d.totals.absenteeismDelta).toBeCloseTo(-2 / 64, 12);
    expect(d.totals.overtimeDelta).toBeCloseTo(-8, 12);
    expect(getInterventions(c.rh, { action: "ENTRETIEN", page: 1 }, meta).rows).toHaveLength(1);
    expect(auditRows("interventions.view").some((r) => r.userId === f.users.rh && r.outcome === "OK")).toBe(true);
  });

  it("fiche : RH mesure complète ; manager niveaux de risque seulement, au mois près", () => {
    const rh = getEmployeeInterventionEffects(c.rh, f.ids.B1, meta);
    expect(rh.view === "RH" && rh.items[0].measure?.overtimeBefore).toBeCloseTo(10, 12);
    const m = getEmployeeInterventionEffects(c.manager, f.ids.B1, meta);
    expect(m).toMatchObject({ view: "MANAGER", items: [{ month: "2026-04", actionCode: "ENTRETIEN", levelBefore: "ELEVE", levelAfter: "FAIBLE", levelChange: "BAISSE", complete: true }] });
  });
});

describe("composants de fiche : quoi de neuf et parcours", () => {
  it("quoi de neuf RH : niveau, nouveau facteur, carrière, formation, évaluation, absences et heures sup du mois", () => {
    const n = getEmployeeNews(c.rh, f.ids.A1, meta);
    expect(n.window).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(n.items).toEqual([
      { kind: "RISQUE", before: "FAIBLE", after: "ELEVE" },
      { kind: "FACTEUR", text: "taux d'absence hors santé de 9,5 % sur 3 mois" },
      { kind: "CARRIERE", type: "PROMOTION", date: "2026-08-01", from: "G3", to: "G4" },
      { kind: "CARRIERE", type: "AUGMENTATION", date: "2026-08-01", from: "1234.5", to: "1357.25" },
      { kind: "FORMATION", status: "EN_RETARD", title: "Sécurité", date: "2026-08-20" },
      { kind: "EVALUATION", date: "2026-08-20", score: 3, previousScore: 4 },
      { kind: "ABSENCE", now: 2, before: 0 },
      { kind: "HEURES_SUP", now: 3, before: 0 },
    ]);
  });

  it("quoi de neuf manager : ni augmentation, ni facteur Absences, ni absence ou heure sup individuelle", () => {
    const n = getEmployeeNews(c.manager, f.ids.A1, meta);
    expect(n.items.map((i) => i.kind)).toEqual(["RISQUE", "CARRIERE", "FORMATION", "EVALUATION"]);
    expect(getEmployeeNews(c.rh, f.ids.C5, meta).items[0]).toEqual({ kind: "OPPOSITION" });
  });

  it("opposition : visible par la RH seulement, jamais dans les DTO du manager (quoi de neuf, avant / après)", () => {
    expect(getEmployeeInterventionEffects(c.rh, f.ids.C5, meta).opposed).toBe(true);
    const news = getEmployeeNews(c.other, f.ids.C5, meta);
    expect(news.view).toBe("MANAGER");
    expect(news.items.some((i) => i.kind === "OPPOSITION")).toBe(false);
    const effects = getEmployeeInterventionEffects(c.other, f.ids.C5, meta);
    expect(effects).toMatchObject({ view: "MANAGER", opposed: false });
    expect(JSON.stringify([news, effects])).not.toMatch(/OPPOSITION|"opposed":true/);
  });

  it("parcours RH : chronologie, managers résolus, absences longues hors santé ; jamais maladie", () => {
    const j = getEmployeeJourney(c.rh, f.ids.A1, meta);
    expect(j.events.map((e) => [e.date, e.kind])).toEqual([
      ["2026-09-10", "RECOMMANDATION"],
      ["2026-08-20", "FORMATION_RETARD"],
      ["2026-08-01", "AUGMENTATION"],
      ["2026-08-01", "PROMOTION"],
      ["2026-03-02", "ABSENCE_LONGUE"],
      ["2025-05-01", "CHANGEMENT_MANAGER"],
      ["2020-01-06", "CONTRAT"],
      ["2020-01-06", "EMBAUCHE"],
    ]);
    expect(j.events.find((e) => e.kind === "CHANGEMENT_MANAGER")).toMatchObject({ from: "NomQ PrenomQ", to: "NomR PrenomR" });
    expect(j.events.find((e) => e.kind === "ABSENCE_LONGUE")).toMatchObject({ label: "CONGE_SANS_SOLDE", days: 10, endDate: "2026-03-13" });
  });

  it("parcours manager : ni augmentation, ni absence, ni action réservée à la RH, ni motif de sortie", () => {
    const j = getEmployeeJourney(c.manager, f.ids.A1, meta);
    expect(j.events.some((e) => e.kind === "AUGMENTATION" || e.kind === "ABSENCE_LONGUE" || e.kind === "INTERVENTION")).toBe(false);
    expect(getEmployeeJourney(c.manager, f.ids.A2, meta).events.some((e) => e.kind === "RECOMMANDATION")).toBe(false);
    expect(getEmployeeJourney(c.manager, f.ids.A6, meta).events.find((e) => e.kind === "SORTIE")).toMatchObject({ date: "2026-08-14", label: null });
    expect(getEmployeeJourney(c.rh, f.ids.A6, meta).events.find((e) => e.kind === "SORTIE")?.label).toBe("DEMISSION");
  });
});

describe("dérive des données", () => {
  beforeEach(() => clearDriftCache());
  const setManifest = (extra: Record<string, unknown>, status = "CHAMPION") =>
    db().prepare("UPDATE model_version SET manifest_json = ?, status = ?, promoted_at = ? WHERE id = ?").run(JSON.stringify(logregManifest(extra)), status, `2026-01-0${Object.keys(extra).length + 1}T00:00:00Z`, f.modelId);

  it("sans période d'entraînement : 12 premiers mois ; PSI connu (ln 3) et nul pour une variable inchangée ; observé / prévu", () => {
    setManifest({});
    const d = getDrift(c.rh);
    expect(d.reference).toEqual({ from: "2025-08-31", to: "2026-07-31", months: 12, rows: 192, source: "PREMIERS_MOIS" });
    expect(d.current).toEqual({ asOf: "2026-08-31", rows: 16 });
    const v = Object.fromEntries(d.variables.map((x) => [x.name, x]));
    expect(v.contract_cdd.psi).toBeCloseTo(Math.log(3), 4);
    expect(v.contract_cdd.status).toBe("FORTE");
    expect(v.tenure_months).toMatchObject({ psi: 0, status: "STABLE", kind: "QUANTILE" });
    expect(d.summary).toEqual({ STABLE: 24, MODEREE: 0, FORTE: 1 });
    expect(d.variables[0].name).toBe("contract_cdd");
    // Cohortes à suivi complet : août 2025 à février 2026 ; A6 (démission posée le 14/07/2026) positif fin janvier et fin février
    expect(d.view === "RH" && d.calibration.source).toBe("PROBABILITE");
    if (d.view !== "RH") throw new Error("vue RH attendue");
    expect(d.calibration.points.map((p) => p.asOf)).toEqual(["2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31", "2026-02-28"]);
    expect(d.calibration.points.at(-1)!.observed).toBeCloseTo(1 / 16, 12);
    expect(d.calibration.points.at(-1)!.expected).toBeCloseTo(CONSTANT_P, 9);
    expect(d.calibration.recent!.oe).toBeCloseTo(2 / (96 * CONSTANT_P), 6);
    expect(d.calibration.status).toBe("HORS_CIBLE");
    expect(d.recommendation.level).toBe("REENTRAINER");
    expect(d.recommendation.reasons[0]).toContain("contrat CDD");
  });

  it("période d'entraînement du bundle (train_from / train_to) utilisée comme référence", () => {
    setManifest({ train_from: "2025-08-31", train_to: "2026-01-31" });
    const d = getDrift(c.rh);
    expect(d.reference).toMatchObject({ from: "2025-08-31", to: "2026-01-31", months: 6, rows: 96, source: "BUNDLE" });
  });

  it("sans modèle probabiliste : comparaison au taux observé sur la période de référence", () => {
    setManifest({}, "CANDIDAT");
    const d = getDrift(c.rh);
    expect(d.model).toBeNull();
    if (d.view !== "RH") throw new Error("vue RH attendue");
    expect(d.calibration.source).toBe("TAUX_REFERENCE");
    expect(d.calibration.referenceRate).toBeCloseTo(2 / 112, 12);
    expect(d.calibration.recent!.oe).toBeCloseTo(112 / 96, 9);
    expect(d.calibration.status).toBe("DANS_LA_CIBLE");
    setManifest({});
  });

  it("recommandation : forte = réentraîner, modérée = surveiller, sinon rien", () => {
    const none = { source: null, status: null, oe: null } as const;
    expect(retrainAdvice([{ label: "X", status: "STABLE" }], none).level).toBe("RAS");
    expect(retrainAdvice([{ label: "X", status: "MODEREE" }], none).level).toBe("SURVEILLER");
    expect(retrainAdvice([{ label: "X", status: "FORTE" }], none).level).toBe("REENTRAINER");
    expect(retrainAdvice([], { source: "PROBABILITE", status: "HORS_CIBLE", oe: 1.6 }).level).toBe("REENTRAINER");
    expect(retrainAdvice([], { source: "TAUX_REFERENCE", status: "HORS_CIBLE", oe: 1.6 }).level).toBe("SURVEILLER");
  });
});

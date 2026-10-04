import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const session = vi.hoisted(() => ({ current: null as null | { userId: number; login: string; role: "ADMIN" | "RH" | "MANAGER"; employeeId: number | null } }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  readSession: async () => session.current,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { canSeeEmployee, ensurePilotage, getContext, homePath, pageContext, requireContext, scopeFilter, visibleEmployeeIds } from "@/lib/dal/context";
import {
  departmentOptions,
  employeeListSchema,
  getEmployeeDetail,
  getMe,
  getPublishedRun,
  listEmployees,
  managerOptions,
  parseQuery,
  referenceDate,
  type EmployeeDetailManager,
  type EmployeeDetailRh,
} from "@/lib/dal/employees";
import { setSetting } from "@/lib/settings";
import { GROUPS } from "@/lib/features/spec";
import { auditOf, buildWorld, expectHttp, openDalDb, publishRun, REF } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
let b0Run = 0;

beforeAll(() => {
  db = openDalDb("dal-employees");
  w = buildWorld(db.sqlite);
  const { e, fx } = w;
  fx.payroll(e.T1, "2024-01", "2025-08", 1500);
  fx.absence(e.T1, "2025-05-19", "2025-05-21", "MALADIE");
  fx.absence(e.T1, "2025-06-02", "2025-06-02", "ABSENCE_INJUSTIFIEE");
  fx.absence(e.T1, "2025-04-14", "2025-04-15", "CONGE_ANNUEL");
  fx.absence(e.T1, "2024-03-04", "2024-03-04", "AUTRE");
  fx.career(e.T1, "2025-01-01", "AUGMENTATION", "1400", "1500");
  fx.career(e.T1, "2025-02-01", "PROMOTION", "G1", "G2");
  fx.training(e.T1, { status: "TERMINEE", mandatory: true, start: "2025-01-10", end: "2025-01-12", due: "2025-01-31", hours: 7 });
  fx.evaluation(e.T1, "2025-01-20", 4);
  publishRun(db.sqlite, "B0", "2025-05-31", [{ employeeId: e.T1, level: "MOYEN", prob6: 2, lift: 2 }], { current: false, version: "b0-v1" });
  publishRun(db.sqlite, "B0", "2024-03-31", [{ employeeId: e.T1, level: "FAIBLE", prob6: 0, lift: 0 }], { current: false, version: "b0-v1" });
  publishRun(db.sqlite, "B0", REF, [{ employeeId: e.T1, level: "FAIBLE", prob6: 1, lift: 1 }], { current: false, version: "b0-ancien" });
  b0Run = publishRun(
    db.sqlite,
    "B0",
    REF,
    [
      {
        employeeId: e.T1,
        level: "ELEVE",
        prob6: 3,
        lift: 3,
        factors: [
          { group: "REMUNERATION", phraseRh: "Salaire à 80 % de la médiane du poste", phraseManager: "Rémunération" },
          { group: "ABSENCES", phraseRh: "3 absences courtes sur 12 mois", phraseManager: "Assiduité" },
          { group: "TEMPS_TRAVAIL", phraseRh: null, phraseManager: null },
        ],
      },
      { employeeId: e.T2, level: "MOYEN", prob6: 2, lift: 2 },
      { employeeId: e.T3, level: "FAIBLE", prob6: 0, lift: 0 },
      { employeeId: e.S1, level: "FAIBLE", prob6: 0, lift: 0 },
    ],
    { version: "b0-v1" },
  );
  const reco = db.sqlite.prepare("INSERT INTO recommendation (employee_id, action_code, trigger_group, created_at) VALUES (?, ?, ?, ?)");
  reco.run(e.T1, "REVISION_SALARIALE", "REMUNERATION", "2025-07-01T00:00:00Z");
  reco.run(e.T1, "ENTRETIEN", "NIVEAU_ELEVE", "2025-07-01T00:00:01Z");
});
afterAll(() => db.close());

const list = (ctx: keyof typeof w.ctx, raw: Record<string, string> = {}) => listEmployees(w.ctx[ctx], parseQuery(employeeListSchema, raw, "strict").data);
const mats = (rows: { matricule: string }[]) => rows.map((r) => r.matricule);

describe("contexte d'accès et périmètre", () => {
  it("filtre SQL par rôle : RH sans filtre, ADMIN et manager sans salarié rattaché : aucune ligne", () => {
    expect(scopeFilter(w.ctx.rh)).toEqual({ clause: "1=1", params: {} });
    expect(scopeFilter(w.ctx.admin)).toEqual({ clause: "1=0", params: {} });
    expect(scopeFilter(w.ctx.orphan)).toEqual({ clause: "1=0", params: {} });
    expect(scopeFilter(w.ctx.mgr, "x.id")).toMatchObject({ clause: expect.stringMatching(/^x\.id IN \(/), params: { scopeRoot: w.e.MGR } });
  });

  it("périmètre récursif, manager exclu de son propre périmètre", () => {
    const { e } = w;
    expect(visibleEmployeeIds(w.ctx.rh)).toBeNull();
    expect(visibleEmployeeIds(w.ctx.admin)).toEqual([]);
    expect(visibleEmployeeIds(w.ctx.orphan)).toEqual([]);
    expect(new Set(visibleEmployeeIds(w.ctx.mgr))).toEqual(new Set([e.T1, e.T2, e.T3, e.T4, e.T5, e.SUB, e.S1, e.S2]));
    expect(new Set(visibleEmployeeIds(w.ctx.sub))).toEqual(new Set([e.S1, e.S2]));
    expect(canSeeEmployee(w.ctx.mgr, e.S2)).toBe(true);
    expect(canSeeEmployee(w.ctx.mgr, e.MGR)).toBe(false);
    expect(canSeeEmployee(w.ctx.sub, e.T1)).toBe(false);
    expect(canSeeEmployee(w.ctx.mgr2, e.T1)).toBe(false);
    expect(canSeeEmployee(w.ctx.admin, e.T1)).toBe(false);
    expect(canSeeEmployee(w.ctx.orphan, e.T1)).toBe(false);
    expect(canSeeEmployee(w.ctx.rh, 999_999)).toBe(true);
  });

  it("ensurePilotage : ADMIN refusé et audité avec la cible ; RH et MANAGER admis", () => {
    expectHttp(() => ensurePilotage(w.ctx.admin, "test.pilotage", { type: "employee", id: 42 }), 403, "INTERDIT");
    expect(auditOf(db.sqlite, "test.pilotage")).toEqual([
      { userId: w.users.admin, targetType: "employee", targetId: "42", outcome: "REFUSE", detail: JSON.stringify({ role: "ADMIN" }), ip: null },
    ]);
    expect(() => ensurePilotage(w.ctx.rh, "test.pilotage")).not.toThrow();
    expect(() => ensurePilotage(w.ctx.orphan, "test.pilotage")).not.toThrow();
  });

  it("session → contexte ; 401 sans session, 403 rôle insuffisant ; pages : redirections", async () => {
    session.current = null;
    expect(await getContext()).toBeNull();
    await expect(requireContext()).rejects.toMatchObject({ status: 401, code: "NON_AUTHENTIFIE" });
    await expect(pageContext()).rejects.toThrow("REDIRECT /login");
    session.current = { userId: w.users.mgr, login: "mgr", role: "MANAGER", employeeId: w.e.MGR };
    expect(await getContext()).toEqual(w.ctx.mgr);
    await expect(requireContext(["RH"])).rejects.toMatchObject({ status: 403, code: "INTERDIT" });
    await expect(pageContext(["ADMIN"])).rejects.toThrow("REDIRECT /interdit");
    expect(await requireContext(["RH", "MANAGER"])).toEqual(w.ctx.mgr);
    expect(await pageContext()).toEqual(w.ctx.mgr);
    expect([homePath("ADMIN"), homePath("RH"), homePath("MANAGER")]).toEqual(["/admin", "/dashboard", "/dashboard"]);
  });
});

describe("liste des collaborateurs", () => {
  it("RH : effectif actif seulement (sortis exclus), score à règles en points, non évalués sans estimation", () => {
    const r = list("rh", { tri: "matricule" });
    expect(r.view).toBe("RH");
    expect(mats(r.rows)).toEqual(["DG", "MGR", "MGR2", "S1", "S2", "SUB", "T1", "T2", "T3", "T5", "X1"]);
    expect(r.run).toEqual({ asOf: REF, modelVersion: "b0-v1", modelKind: "B0" });
    if (r.view !== "RH") throw new Error();
    expect(r.rows.find((x) => x.matricule === "T1")!.estimate).toEqual({ type: "SCORE_REGLES", points: 3 });
    expect(r.rows.find((x) => x.matricule === "T5")!.estimate).toBeNull();
  });

  it("recherche : caractères spéciaux de LIKE échappés ; prénom-nom, nom-prénom et matricule", () => {
    expect(mats(list("rh", { q: "_" }).rows)).toEqual(["T2"]);
    expect(mats(list("rh", { q: "ben_ali%" }).rows)).toEqual(["T2"]);
    expect(mats(list("rh", { q: "Sami Ben" }).rows)).toEqual(["T2"]);
    expect(mats(list("rh", { q: "%" }).rows)).toEqual(["T2"]);
    expect(mats(list("rh", { q: "s1" }).rows)).toEqual(["S1"]);
  });

  it("filtres niveau (dont non évalué), manager, département, contrat, âge et ancienneté", () => {
    expect(mats(list("rh", { niveau: "ELEVE" }).rows)).toEqual(["T1"]);
    expect(mats(list("rh", { niveau: "NON_EVALUE", tri: "matricule" }).rows)).toEqual(["DG", "MGR", "MGR2", "S2", "SUB", "T5", "X1"]);
    expect(mats(list("rh", { manager: String(w.e.SUB), tri: "matricule" }).rows)).toEqual(["S1", "S2"]);
    expect(mats(list("rh", { departement: String(w.dept.com), tri: "matricule" }).rows)).toEqual(["MGR2", "X1"]);
    expect(mats(list("rh", { contrat: "CDD" }).rows)).toEqual(["T5"]);
    expect(mats(list("rh", { contrat: "STAGE" }).rows)).toEqual(["X1"]);
    expect(mats(list("rh", { age: "moins-30" }).rows)).toEqual(["T1"]);
    expect(mats(list("rh", { age: "50-plus", tri: "matricule" }).rows)).toEqual(["DG", "MGR", "T3"]);
    expect(mats(list("rh", { anciennete: "moins-1" }).rows)).toEqual(["T5"]);
    expect(mats(list("rh", { anciennete: "10-plus", tri: "matricule" }).rows)).toEqual(["DG", "MGR", "MGR2", "SUB", "T3"]);
  });

  it("tris et sens ; la page demandée au-delà de la dernière est ramenée à la dernière", () => {
    expect(mats(list("rh", { tri: "risque" }).rows).slice(0, 4)).toEqual(["T1", "T2", "S1", "T3"]);
    expect(mats(list("rh", { tri: "risque", ordre: "asc" }).rows).at(-1)).toBe("T1");
    expect(mats(list("rh", { tri: "probabilite" }).rows).slice(0, 2)).toEqual(["T1", "T2"]);
    expect(mats(list("rh", { tri: "matricule", ordre: "desc" }).rows)[0]).toBe("X1");
    expect(mats(list("rh", { tri: "anciennete" }).rows)[0]).toBe("T5");
    expect(mats(list("rh", { tri: "anciennete", ordre: "desc" }).rows)[0]).toBe("DG");
    expect(mats(list("rh", { tri: "departement" }).rows).slice(0, 2)).toEqual(["MGR2", "X1"]);
    expect(list("rh", { tri: "departement", ordre: "desc" }).rows.at(-1)!.department).toBe("Commercial");
    const byName = list("rh", { tri: "nom", ordre: "desc" }).rows.map((r) => r.lastName.toLowerCase());
    expect(byName).toEqual([...byName].sort().reverse());
    const last = list("rh", { page: "999" });
    expect(last).toMatchObject({ page: 1, pageCount: 1, total: 11, pageSize: 25 });
  });

  it("manager : périmètre seul, sans estimation ; tri par probabilité ramené au tri par niveau ; filtre hors périmètre sans effet", () => {
    const r = list("mgr", { tri: "matricule" });
    expect(r.view).toBe("MANAGER");
    expect(mats(r.rows)).toEqual(["S1", "S2", "SUB", "T1", "T2", "T3", "T5"]);
    expect(r.run).toEqual({ asOf: REF });
    for (const row of r.rows) expect(Object.keys(row)).not.toContain("estimate");
    expect(mats(list("mgr", { tri: "probabilite" }).rows)).toEqual(mats(list("mgr", { tri: "risque" }).rows));
    expect(list("mgr", { departement: String(w.dept.com) }).total).toBe(0);
    expect(list("mgr", { manager: String(w.e.MGR2) }).total).toBe(0);
    expect(list("orphan").total).toBe(0);
    expect(() => list("admin")).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("ancienneté au jour de référence (mois entamé non compté) ; date de référence invalide = aujourd'hui", () => {
    setSetting(db.sqlite, "data_end_date", "2025-06-10");
    expect(list("rh", { q: "T1" }).rows[0].tenureMonths).toBe(20);
    setSetting(db.sqlite, "data_end_date", "fin juin");
    expect(referenceDate()).toBe(new Date().toISOString().slice(0, 10));
    setSetting(db.sqlite, "data_end_date", REF);
    expect(list("rh", { q: "T1" }).rows[0].tenureMonths).toBe(21);
  });

  it("run pointé non publié ou pointeur invalide : aucun niveau affiché", () => {
    const staging = publishRun(db.sqlite, "B0", "2025-07-31", [{ employeeId: w.e.T3, level: "ELEVE", prob6: 9, lift: 9 }], { status: "STAGING", version: "b0-v1" });
    expect(getPublishedRun()).toBeNull();
    const r = list("rh", { q: "T3" });
    expect(r.run).toBeNull();
    expect(r.rows[0]).toMatchObject({ level: null });
    setSetting(db.sqlite, "current_run_id", "n'importe quoi");
    expect(getPublishedRun()).toBeNull();
    setSetting(db.sqlite, "current_run_id", String(b0Run));
    expect(getPublishedRun()?.id).toBe(b0Run);
    expect(staging).toBeGreaterThan(b0Run);
  });
});

describe("options de filtre", () => {
  it("départements et managers limités au périmètre ; RH : tout", () => {
    expect(departmentOptions().map((d) => d.label)).toEqual(["Commercial", "Production"]);
    expect(departmentOptions(w.ctx.rh).map((d) => d.label)).toEqual(["Commercial", "Production"]);
    expect(departmentOptions(w.ctx.mgr).map((d) => d.label)).toEqual(["Production"]);
    expect(departmentOptions(w.ctx.mgr2).map((d) => d.label)).toEqual(["Commercial"]);
    expect(departmentOptions(w.ctx.orphan)).toEqual([]);
    expect(new Set(managerOptions(w.ctx.mgr).map((o) => o.id))).toEqual(new Set([w.e.MGR, w.e.SUB]));
    expect(new Set(managerOptions(w.ctx.rh).map((o) => o.id))).toEqual(new Set([w.e.DG, w.e.MGR, w.e.SUB, w.e.MGR2]));
    expect(managerOptions(w.ctx.admin)).toEqual([]);
  });
});

describe("fiche collaborateur", () => {
  it("404 avant tout contrôle de périmètre, y compris pour un manager sans salarié", () => {
    expectHttp(() => getEmployeeDetail(w.ctx.orphan, 999_999, { source: "page" }), 404, "INTROUVABLE");
    expectHttp(() => getEmployeeDetail(w.ctx.orphan, w.e.T1, { source: "api", ip: "10.0.0.9" }), 403);
    expect(auditOf(db.sqlite, "employee.view").at(-1)).toMatchObject({ userId: w.users.orphan, outcome: "REFUSE", targetId: String(w.e.T1), ip: "10.0.0.9" });
  });

  it("RH : rémunération (12 derniers mois jusqu'à la référence), absences hors santé, jours de santé, facteurs et historique", () => {
    const d = getEmployeeDetail(w.ctx.rh, w.e.T1, { source: "page" }) as EmployeeDetailRh;
    expect(d.view).toBe("RH");
    expect(d.compensation.payroll).toHaveLength(12);
    expect(d.compensation.payroll[0].month).toBe("2025-06");
    expect(d.compensation.current).toEqual({ month: "2025-06", baseSalary: 1500, grossSalary: 1800 });
    expect(d.absences.healthDays).toBe(3);
    expect(d.absences.byCategory.map((a) => a.category).sort()).toEqual(["ABSENCE_INJUSTIFIEE", "CONGE_ANNUEL"]);
    if (d.estimation.status !== "OK") throw new Error(d.estimation.status);
    expect(d.estimation).toMatchObject({ level: "ELEVE", modelKind: "B0", estimate: { type: "SCORE_REGLES", points: 3 }, computedAt: "2025-07-01T00:00:00.000Z" });
    expect(d.estimation.factors.map((f) => f.phrase)).toEqual(["Salaire à 80 % de la médiane du poste", "3 absences courtes sur 12 mois", GROUPS.TEMPS_TRAVAIL.label_rh]);
    expect(d.estimation.history.map((h) => [h.asOf, h.level])).toEqual([
      ["2025-05-31", "MOYEN"],
      [REF, "ELEVE"],
    ]);
    expect(d.recommendations.map((r) => [r.actionCode, r.triggerLabel])).toEqual([
      ["ENTRETIEN", "NIVEAU_ELEVE"],
      ["REVISION_SALARIALE", GROUPS.REMUNERATION.label_rh],
    ]);
    const a = auditOf(db.sqlite, "employee.view").at(-1)!;
    expect(JSON.parse(a.detail!)).toEqual({ source: "page", view: "RH", salary: true, score: true });
  });

  it("manager : ni rémunération ni absences ; facteurs ABSENCES et REMUNERATION (B0) retirés ; ni revue salariale ni augmentation", () => {
    const d = getEmployeeDetail(w.ctx.mgr, w.e.T1, { source: "page" }) as EmployeeDetailManager;
    expect(d.view).toBe("MANAGER");
    expect(Object.keys(d)).not.toEqual(expect.arrayContaining(["compensation"]));
    expect(Object.keys(d)).not.toContain("absences");
    if (d.estimation.status !== "OK") throw new Error(d.estimation.status);
    expect(d.estimation.factors).toEqual([{ phrase: GROUPS.TEMPS_TRAVAIL.label_manager }]);
    expect(Object.keys(d.estimation)).toEqual(["status", "asOf", "level", "factors", "history"]);
    expect(d.estimation.history).toEqual([
      { asOf: "2025-05-31", level: "MOYEN" },
      { asOf: REF, level: "ELEVE" },
    ]);
    expect(d.recommendations.map((r) => r.actionCode)).toEqual(["ENTRETIEN"]);
    expect(d.careerEvents.map((c) => c.type)).toEqual(["PROMOTION"]);
    expect(JSON.parse(auditOf(db.sqlite, "employee.view").at(-1)!.detail!)).toEqual({ source: "page", view: "MANAGER", salary: false, score: true });
  });

  it("modèle LOGREG : la catégorie Rémunération redevient visible du manager, jamais Assiduité ; RH : probabilité et lift", () => {
    const lr = publishRun(db.sqlite, "LOGREG", REF, [
      {
        employeeId: w.e.T1,
        level: "ELEVE",
        prob6: 0.31,
        lift: 6.2,
        factors: [
          { group: "REMUNERATION", phraseManager: "Rémunération" },
          { group: "ABSENCES", phraseManager: "Assiduité" },
        ],
      },
    ]);
    try {
      const m = getEmployeeDetail(w.ctx.mgr, w.e.T1, { source: "page" }) as EmployeeDetailManager;
      if (m.estimation.status !== "OK") throw new Error();
      expect(m.estimation.factors).toEqual([{ phrase: "Rémunération" }]);
      const r = getEmployeeDetail(w.ctx.rh, w.e.T1, { source: "page" }) as EmployeeDetailRh;
      if (r.estimation.status !== "OK") throw new Error();
      expect(r.estimation.estimate).toEqual({ type: "PROBABILITE", prob6: 0.31, lift: 6.2 });
      expect(r.estimation.history.at(-1)).toEqual({ asOf: REF, level: "ELEVE", estimate: { type: "PROBABILITE", prob6: 0.31, lift: 6.2 } });
      expect(r.estimation.history[0].estimate).toEqual({ type: "SCORE_REGLES", points: 2 });
    } finally {
      setSetting(db.sqlite, "current_run_id", String(b0Run));
      expect(lr).toBeGreaterThan(b0Run);
    }
  });

  it("manager : seules les catégories qui font monter l'estimation ; aucune à la hausse = liste vide ; RH garde le sens", () => {
    const lr = publishRun(db.sqlite, "LOGREG", REF, [
      {
        employeeId: w.e.T1,
        level: "FAIBLE",
        prob6: 0.02,
        lift: 0.4,
        factors: [
          { group: "CARRIERE", phraseManager: "Évolution de carrière" },
          { group: "TEMPS_TRAVAIL", phraseManager: "Charge de travail" },
          { group: "EQUIPE", phraseManager: "Contexte d'équipe" },
        ],
      },
    ], { version: "logreg-sens" });
    const down = db.sqlite.prepare("UPDATE prediction_factor SET direction = 'BAISSE' WHERE group_code = ? AND prediction_id = (SELECT id FROM prediction WHERE run_id = ?)");
    try {
      down.run("CARRIERE", lr);
      down.run("EQUIPE", lr);
      const m = getEmployeeDetail(w.ctx.mgr, w.e.T1, { source: "page" }) as EmployeeDetailManager;
      if (m.estimation.status !== "OK") throw new Error(m.estimation.status);
      expect(m.estimation.factors).toEqual([{ phrase: "Charge de travail" }]);
      const r = getEmployeeDetail(w.ctx.rh, w.e.T1, { source: "page" }) as EmployeeDetailRh;
      if (r.estimation.status !== "OK") throw new Error(r.estimation.status);
      expect(r.estimation.factors.map((f) => [f.group, f.direction])).toEqual([
        ["CARRIERE", "BAISSE"],
        ["TEMPS_TRAVAIL", "HAUSSE"],
        ["EQUIPE", "BAISSE"],
      ]);
      down.run("TEMPS_TRAVAIL", lr);
      const none = getEmployeeDetail(w.ctx.mgr, w.e.T1, { source: "page" }) as EmployeeDetailManager;
      expect(none.estimation.status === "OK" && none.estimation.factors).toEqual([]);
    } finally {
      setSetting(db.sqlite, "current_run_id", String(b0Run));
    }
  });

  it("non évalué et aucun run : états explicites pour les deux vues", () => {
    const rh = getEmployeeDetail(w.ctx.rh, w.e.T5, { source: "page" }) as EmployeeDetailRh;
    const mg = getEmployeeDetail(w.ctx.mgr, w.e.T5, { source: "page" }) as EmployeeDetailManager;
    expect(rh.estimation).toEqual({ status: "NON_EVALUE", asOf: REF });
    expect(mg.estimation).toEqual({ status: "NON_EVALUE", asOf: REF });
    expect(rh.compensation.current).toBeNull();
    setSetting(db.sqlite, "current_run_id", "");
    try {
      expect((getEmployeeDetail(w.ctx.rh, w.e.T1, { source: "page" }) as EmployeeDetailRh).estimation).toEqual({ status: "AUCUN_RUN" });
      expect((getEmployeeDetail(w.ctx.mgr, w.e.T1, { source: "page" }) as EmployeeDetailManager).estimation).toEqual({ status: "AUCUN_RUN" });
      expect(JSON.parse(auditOf(db.sqlite, "employee.view").at(-1)!.detail!).score).toBe(false);
    } finally {
      setSetting(db.sqlite, "current_run_id", String(b0Run));
    }
  });

  it("identité : ancienneté arrêtée à la sortie, fin de CDD prévue, sans manager", () => {
    const t4 = getEmployeeDetail(w.ctx.mgr, w.e.T4, { source: "page" }) as EmployeeDetailManager;
    expect(t4.employee).toMatchObject({ status: "SORTI", exitDate: "2025-03-31", tenureMonths: 110, manager: { id: w.e.MGR } });
    const t5 = getEmployeeDetail(w.ctx.rh, w.e.T5, { source: "page" }) as EmployeeDetailRh;
    expect(t5.employee).toMatchObject({ contract: { type: "CDD", endDate: "2025-12-31" }, cddEndPlanned: "2025-12-31" });
    const dg = getEmployeeDetail(w.ctx.rh, w.e.DG, { source: "page" }) as EmployeeDetailRh;
    expect(dg.employee).toMatchObject({ manager: null, cddEndPlanned: null });
    const x1 = getEmployeeDetail(w.ctx.mgr2, w.e.X1, { source: "page" }) as EmployeeDetailManager;
    expect(x1.employee.contract).toMatchObject({ type: "STAGE" });
    const t6 = w.fx.emp({ matricule: "T6", hire: "2025-06-01", managerId: w.e.MGR, contract: null });
    const d6 = getEmployeeDetail(w.ctx.mgr, t6, { source: "api" }) as EmployeeDetailManager;
    expect(d6.employee).toMatchObject({ contract: null, cddEndPlanned: null, tenureMonths: 0, manager: { id: w.e.MGR, name: "NomMGR PrenomMGR" } });
    expect(d6.estimation).toEqual({ status: "NON_EVALUE", asOf: REF });
    expect(d6.trainings).toEqual([]);
  });
});

describe("profil courant (/api/me)", () => {
  it("manager : salarié rattaché et droits restreints ; RH : droits complets ; salarié disparu : null", () => {
    expect(getMe(w.ctx.mgr)).toEqual({
      login: "mgr",
      role: "MANAGER",
      employee: { id: w.e.MGR, matricule: "MGR", name: "NomMGR PrenomMGR" },
      permissions: { compensation: false, probability: false, individualSignals: false, recommendations: false },
    });
    expect(getMe(w.ctx.rh)).toMatchObject({ employee: null, permissions: { compensation: true, probability: true, individualSignals: true, recommendations: true } });
    expect(getMe({ ...w.ctx.mgr, employeeId: 999_999 }).employee).toBeNull();
  });
});

describe("paramètres de requête", () => {
  it("URLSearchParams : première valeur retenue, valeurs vides ignorées", () => {
    const sp = new URLSearchParams("tri=nom&tri=matricule&q=%20%20&page=2");
    const data = parseQuery(employeeListSchema, sp, "strict").data;
    expect(data).toMatchObject({ tri: "nom", page: 2 });
    expect(data.q).toBeUndefined();
    expect(parseQuery(employeeListSchema, { tri: ["matricule", "nom"], niveau: undefined }, "strict").data.tri).toBe("matricule");
  });

  it("strict : ZodError ; tolérant : chaque clé invalide est retirée et signalée", () => {
    expect(() => parseQuery(employeeListSchema, { niveau: "ROUGE" }, "strict")).toThrow(ZodError);
    const r = parseQuery(employeeListSchema, { niveau: "ROUGE", page: "0", tri: "salaire", q: "ok", departement: "-3" }, "lenient");
    expect(new Set(r.ignored)).toEqual(new Set(["niveau", "page", "tri", "departement"]));
    expect(r.data).toMatchObject({ q: "ok", tri: "risque", page: 1 });
  });
});

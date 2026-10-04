import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import {
  closePrivacyRequest,
  createPrivacyRequest,
  exportAccessData,
  getOppositionFlag,
  getPrivacySubject,
  liftEmployeeOpposition,
  listPrivacyRequests,
  searchPrivacySubjects,
} from "@/lib/dal/privacy";
import { runWhatIf } from "@/lib/dal/whatif";
import { getEmployeeDetail } from "@/lib/dal/employees";
import { FEATURES } from "@/lib/features/spec";
import { OPPOSITION_LABEL } from "@/lib/privacy";
import { auditOf, buildWorld, expectHttp, openDalDb, publishRun, REF } from "../fixtures/unit/dal-world";
import { readZip } from "./helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({
  readSession: async () => session.current,
  clientIp: (h: Headers) => h.get("x-forwarded-for") ?? "local",
}));

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
let T1: number;
const api = { source: "api" as const, ip: "10.0.0.9" };
const count = (sql: string, ...p: unknown[]) => (db.sqlite.prepare(sql).get(...p) as { n: number }).n;

beforeAll(() => {
  db = openDalDb("privacy");
  w = buildWorld(db.sqlite);
  const { fx, e } = w;
  T1 = e.T1;
  fx.payroll(T1, "2025-01", "2025-06", 1850.5);
  fx.absence(T1, "2025-02-03", "2025-02-04", "MALADIE");
  fx.absence(T1, "2025-03-10", "2025-03-10", "ABSENCE_INJUSTIFIEE");
  fx.training(T1, { status: "TERMINEE", start: "2025-01-10", end: "2025-01-12", hours: 14 });
  fx.attendance(T1, "2025-06-01", "2025-06-30");
  db.sqlite.prepare("INSERT INTO evaluation (employee_id, eval_date, score, recorded_at) VALUES (?, '2024-12-15', 3.5, '2025-01-10')").run(T1);
  db.sqlite
    .prepare("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, ?, 'v1', ?)")
    .run(T1, REF, JSON.stringify(FEATURES.map((f) => f.impute)));
  publishRun(db.sqlite, "LOGREG", REF, [
    { employeeId: T1, level: "ELEVE", prob6: 0.4321, lift: 5.2, factors: [{ group: "REMUNERATION", phraseRh: "Salaire à 82 % de la médiane", phraseManager: "Rémunération" }] },
    { employeeId: e.T2, level: "FAIBLE", prob6: 0.02, lift: 0.3 },
  ]);
  const pid = (db.sqlite.prepare("SELECT id FROM prediction WHERE employee_id = ?").get(T1) as { id: number }).id;
  const reco = db.sqlite.prepare("INSERT INTO recommendation (employee_id, prediction_id, action_code, trigger_group, status, comment) VALUES (?, ?, ?, ?, ?, ?)");
  reco.run(T1, pid, "ENTRETIEN", "NIVEAU_ELEVE", "PROPOSEE", null);
  reco.run(T1, pid, "PLAN_FORMATION", "FORMATION_EVAL", "REALISEE", "=HYPERLINK(\"http://x\")");
  db.sqlite
    .prepare("INSERT INTO alert (type, severity, audience, employee_id, title, message, dedup_key) VALUES ('TURNOVER', 'ATTENTION', 'MANAGER', ?, 'Risque', 'Risque élevé', ?)")
    .run(T1, `turnover:${T1}:${REF}`);
  getEmployeeDetail(w.ctx.rh, T1, { source: "page" });
});
afterAll(() => db.close());

describe("contrôle d'accès : RH seule", () => {
  it("MANAGER et ADMIN : 403 audité sur la recherche, le registre, le dossier, les demandes et l'export", () => {
    for (const ctx of [w.ctx.mgr, w.ctx.admin]) {
      expectHttp(() => searchPrivacySubjects(ctx, "T1"), 403);
      expectHttp(() => listPrivacyRequests(ctx), 403);
      expectHttp(() => getPrivacySubject(ctx, T1), 403);
      expectHttp(() => createPrivacyRequest(ctx, { employeeId: T1, type: "ACCES" }), 403);
      expectHttp(() => closePrivacyRequest(ctx, 1, { status: "TRAITEE" }), 403);
      expectHttp(() => liftEmployeeOpposition(ctx, T1, { note: "retrait" }), 403);
      expectHttp(() => exportAccessData(ctx, 1, "zip", api), 403);
      expect(getOppositionFlag(ctx, T1)).toBeNull();
    }
    const refused = auditOf(db.sqlite, "privacy.export").filter((a) => a.outcome === "REFUSE");
    expect(refused.map((a) => a.userId)).toEqual([w.users.mgr, w.users.admin]);
    expect(refused[0]).toMatchObject({ ip: "10.0.0.9", targetType: "privacy_request" });
    expect(auditOf(db.sqlite, "privacy.view").every((a) => a.outcome === "REFUSE")).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM privacy_request")).toBe(0);
  });

  it("recherche par matricule ou par nom, caractères spéciaux neutralisés, 2 caractères au moins", () => {
    const r = searchPrivacySubjects(w.ctx.rh, "T1");
    expect(r[0]).toMatchObject({ id: T1, matricule: "T1", opposed: false, openRequests: 0 });
    expect(searchPrivacySubjects(w.ctx.rh, "Ben_").map((x) => x.matricule)).toEqual(["T2"]);
    expect(searchPrivacySubjects(w.ctx.rh, "%%")).toEqual([]);
    expect(() => searchPrivacySubjects(w.ctx.rh, "T")).toThrow(ZodError);
  });
});

describe("droit d'accès : export complet, lisible et audité", () => {
  let requestId: number;
  beforeAll(() => {
    requestId = createPrivacyRequest(w.ctx.rh, { employeeId: T1, type: "ACCES", note: "Courrier reçu le 01/07" }).id;
  });

  it("JSON : toutes les rubriques, libellés en français, journal sans identifiant ni IP", () => {
    const f = exportAccessData(w.ctx.rh, requestId, "json", api);
    expect(f).toMatchObject({ contentType: "application/json; charset=utf-8", filename: expect.stringMatching(/^acces-T1-\d{8}\.json$/) });
    const x = JSON.parse(f.body.toString("utf8"));
    const R = x.rubriques;
    expect(Object.keys(R)).toEqual(
      expect.arrayContaining(["identite", "contrats", "paie", "pointages", "absences", "absences_par_categorie", "formations", "evaluations", "variables", "predictions", "facteurs", "recommandations", "alertes", "journal", "demandes", "opposition"]),
    );
    expect(x.salarie).toEqual({ matricule: "T1", nom: "NomT1", prenom: "PrenomT1" });
    expect(R.identite.lignes[0]).toMatchObject({ Matricule: "T1", "Date d'embauche": "2023-09-15", "Matricule du manager": "MGR" });
    expect(R.paie.lignes).toHaveLength(6);
    expect(R.paie.lignes[0]).toMatchObject({ Mois: "2025-01", "Salaire de base (TND)": 1850.5 });
    expect(R.absences.lignes.find((a: Record<string, unknown>) => a.Catégorie === "Maladie")).toMatchObject({ "Exclue des calculs (santé)": "oui", Jours: 2 });
    expect(R.absences_par_categorie.lignes).toHaveLength(2);
    expect(R.pointages.lignes.length).toBeGreaterThan(15);
    expect(R.formations.lignes[0]).toMatchObject({ Heures: 14, Statut: "TERMINEE" });
    expect(R.evaluations.lignes[0]).toMatchObject({ Note: 3.5 });
    expect(R.variables.lignes).toHaveLength(FEATURES.length);
    expect(R.predictions.lignes[0]).toMatchObject({ Valeur: 0.4321, Niveau: "Élevé", "Type d'estimation": "Probabilité à 6 mois", "Calcul affiché actuellement": "oui" });
    expect(R.facteurs.lignes[0]).toMatchObject({ Groupe: "Rémunération", "Explication (RH)": "Salaire à 82 % de la médiane" });
    expect(R.recommandations.lignes).toHaveLength(2);
    expect(R.alertes.lignes).toHaveLength(1);
    expect(R.demandes.lignes[0]).toMatchObject({ Type: "Accès", Statut: "Ouverte" });
    expect(R.journal.lignes).toEqual(
      expect.arrayContaining([
        { Date: expect.any(String), Opération: "Consultation de la fiche", Résultat: "effectuée", "Rôle de l'auteur": "RH" },
        expect.objectContaining({ Opération: "Enregistrement d'une demande" }),
      ]),
    );
    expect(JSON.stringify(R.journal)).not.toMatch(/"rh"|10\.0\.0\.9/);

    const a = auditOf(db.sqlite, "privacy.export").at(-1)!;
    expect(a).toMatchObject({ userId: w.users.rh, outcome: "OK", targetType: "employee", targetId: String(T1), ip: "10.0.0.9" });
    expect(JSON.parse(a.detail!)).toMatchObject({ requestId, format: "json", source: "api", rubriques: { paie: 6, predictions: 1 } });
  });

  it("ZIP : lisez-moi, JSON et un CSV par rubrique (UTF-8 avec BOM, « ; », formules neutralisées)", () => {
    const f = exportAccessData(w.ctx.rh, requestId, "zip", api);
    expect(f.contentType).toBe("application/zip");
    const files = readZip(f.body);
    expect([...files.keys()].slice(0, 2)).toEqual(["LISEZMOI.txt", "donnees.json"]);
    expect(files.size).toBe(2 + f.rubriques);
    const paie = [...files].find(([n]) => n.endsWith("-paie.csv"))![1].toString("utf8");
    expect(paie.charCodeAt(0)).toBe(0xfeff);
    expect(paie.slice(1).split("\r\n")[0]).toBe("Mois;Salaire de base (TND);Salaire brut (TND);Heures supplémentaires;Saisie le");
    const recos = [...files].find(([n]) => n.endsWith("-recommandations.csv"))![1].toString("utf8");
    expect(recos).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect([...files].find(([n]) => n.endsWith("-sorties.csv"))![1].toString("utf8")).toContain("Aucune donnée");
    expect(files.get("LISEZMOI.txt")!.toString("utf8")).toContain("matricule T1");
  });

  it("export refusé hors demande d'accès (409 audité) ; demande inconnue 404", () => {
    const rect = createPrivacyRequest(w.ctx.rh, { employeeId: T1, type: "RECTIFICATION", note: "Date d'embauche erronée" }).id;
    expectHttp(() => exportAccessData(w.ctx.rh, rect, "zip", api), 409, "DEMANDE_INVALIDE");
    expect(auditOf(db.sqlite, "privacy.export").at(-1)).toMatchObject({ outcome: "REFUSE", targetId: String(T1) });
    expectHttp(() => exportAccessData(w.ctx.rh, 999999, "zip", api), 404);
    closePrivacyRequest(w.ctx.rh, rect, { status: "TRAITEE", note: "Corrigée dans AJIR" });
  });
});

describe("opposition au traitement prédictif", () => {
  it("suspension immédiate : prédiction, facteurs, variables, recommandation ouverte et alerte TURNOVER supprimées ; décisions RH conservées", () => {
    const r = createPrivacyRequest(w.ctx.rh, { employeeId: T1, type: "OPPOSITION", note: "Courrier du 02/07" });
    expect(r.opposition!.purged).toMatchObject({ predictions: 1, factors: 1, snapshots: 1, recommendations: 1, alerts: 1 });
    expect(count("SELECT COUNT(*) AS n FROM employee_opposition WHERE employee_id = ? AND request_id = ?", T1, r.id)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM prediction WHERE employee_id = ?", T1)).toBe(0);
    expect(db.sqlite.prepare("SELECT status, prediction_id AS p FROM recommendation WHERE employee_id = ?").all(T1)).toEqual([{ status: "REALISEE", p: null }]);
    expect(count("SELECT COUNT(*) AS n FROM prediction WHERE employee_id = ?", w.e.T2)).toBe(1);
    expect(JSON.parse(auditOf(db.sqlite, "privacy.opposition.record").at(-1)!.detail!)).toMatchObject({ requestId: r.id, purged: { predictions: 1 } });

    expect(getOppositionFlag(w.ctx.rh, T1)).toEqual({ label: OPPOSITION_LABEL, since: expect.any(String) });
    expect(getOppositionFlag(w.ctx.mgr, T1)).toBeNull();
    expect(getPrivacySubject(w.ctx.rh, T1).opposition).toMatchObject({ label: OPPOSITION_LABEL, requestId: r.id, recordedBy: "rh" });
    const detail = getEmployeeDetail(w.ctx.rh, T1, { source: "page" });
    expect(detail.view === "RH" && detail.estimation.status).toBe("NON_EVALUE");
    expect(listPrivacyRequests(w.ctx.rh).counts.oppositions).toBe(1);
    expect(searchPrivacySubjects(w.ctx.rh, "T1")[0]).toMatchObject({ opposed: true, openRequests: 2 });
    expectHttp(() => createPrivacyRequest(w.ctx.rh, { employeeId: T1, type: "OPPOSITION" }), 409, "DEJA_OPPOSE");
  });

  it("what-if : 409 explicite, audité REFUSE", () => {
    expectHttp(() => runWhatIf(w.ctx.rh, T1, { salaryPct: 5 }, api), 409, "OPPOSITION");
    expect(auditOf(db.sqlite, "whatif.run").at(-1)).toMatchObject({ outcome: "REFUSE", targetId: String(T1) });
    expect(JSON.parse(auditOf(db.sqlite, "whatif.run").at(-1)!.detail!)).toMatchObject({ reason: "opposition" });
  });

  it("clôture « traitée » : l'opposition est maintenue ; levée par retrait du salarié : tracée, demandes ouvertes closes", () => {
    const open = listPrivacyRequests(w.ctx.rh, { type: "OPPOSITION", statut: "OUVERTE" }).rows[0];
    expect(closePrivacyRequest(w.ctx.rh, open.id, { status: "TRAITEE" })).toEqual({ lifted: false });
    expect(getOppositionFlag(w.ctx.rh, T1)).not.toBeNull();
    expectHttp(() => closePrivacyRequest(w.ctx.rh, open.id, { status: "TRAITEE" }), 409, "DEJA_CLOTUREE");

    expect(() => liftEmployeeOpposition(w.ctx.rh, T1, { note: "" })).toThrow(ZodError);
    const { requestId } = liftEmployeeOpposition(w.ctx.rh, T1, { note: "Retrait écrit du 15/07" });
    expect(getOppositionFlag(w.ctx.rh, T1)).toBeNull();
    expect(db.sqlite.prepare("SELECT type, status, note FROM privacy_request WHERE id = ?").get(requestId)).toEqual({
      type: "OPPOSITION",
      status: "TRAITEE",
      note: "Levée de l'opposition : Retrait écrit du 15/07",
    });
    expect(auditOf(db.sqlite, "privacy.opposition.lift").at(-1)).toMatchObject({ outcome: "OK", targetId: String(T1) });
    expectHttp(() => liftEmployeeOpposition(w.ctx.rh, T1, { note: "encore" }), 409, "AUCUNE_OPPOSITION");
  });

  it("refus motivé d'une opposition : la suspension est levée", () => {
    const { id } = createPrivacyRequest(w.ctx.rh, { employeeId: w.e.T2, type: "OPPOSITION" });
    expect(getOppositionFlag(w.ctx.rh, w.e.T2)).not.toBeNull();
    expect(() => closePrivacyRequest(w.ctx.rh, id, { status: "REFUSEE" })).toThrow(ZodError);
    expect(closePrivacyRequest(w.ctx.rh, id, { status: "REFUSEE", note: "Aucun motif légitime invoqué" })).toEqual({ lifted: true });
    expect(getOppositionFlag(w.ctx.rh, w.e.T2)).toBeNull();
    expect((db.sqlite.prepare("SELECT note FROM privacy_request WHERE id = ?").get(id) as { note: string }).note).toBe("Clôture (refusée) : Aucun motif légitime invoqué");
  });
});

describe("rectification et registre", () => {
  it("note obligatoire, échéance à un mois, retard signalé, filtres", () => {
    expect(() => createPrivacyRequest(w.ctx.rh, { employeeId: T1, type: "RECTIFICATION" })).toThrow(ZodError);
    expectHttp(() => createPrivacyRequest(w.ctx.rh, { employeeId: 999999, type: "ACCES" }), 404);
    const { id } = createPrivacyRequest(w.ctx.rh, { employeeId: w.e.T3, type: "RECTIFICATION", note: "Grade G3 au lieu de G2" });
    db.sqlite.prepare("UPDATE privacy_request SET created_at = '2025-01-10T09:00:00.000Z' WHERE id = ?").run(id);
    const reg = listPrivacyRequests(w.ctx.rh, { statut: "OUVERTE" });
    expect(reg.rows.find((r) => r.id === id)).toMatchObject({ type: "RECTIFICATION", dueDate: "2025-02-10", overdue: true, employee: { matricule: "T3" }, createdBy: "rh" });
    expect(reg.counts.overdue).toBeGreaterThanOrEqual(1);
    expect(reg.rows.every((r) => r.status === "OUVERTE")).toBe(true);
    expect(() => listPrivacyRequests(w.ctx.rh, { statut: "X" as "OUVERTE" })).toThrow(ZodError);
  });
});

describe("route GET /api/privacy/requests/[id]/export", () => {
  const call = async (id: string, qs = "") => {
    const { GET } = await import("@/app/api/privacy/requests/[id]/export/route");
    return GET(new NextRequest(new URL(`/api/privacy/requests/${id}/export${qs}`, "http://localhost")), { params: Promise.resolve({ id }) });
  };
  const as = (k: "rh" | "mgr" | "admin") => (session.current = { ...w.ctx[k] });
  let accessId: number;
  beforeAll(() => {
    accessId = createPrivacyRequest(w.ctx.rh, { employeeId: w.e.T3, type: "ACCES" }).id;
  });

  it("401 sans session ; 403 MANAGER et ADMIN", async () => {
    session.current = null;
    expect((await call(String(accessId))).status).toBe(401);
    as("mgr");
    expect((await call(String(accessId))).status).toBe(403);
    as("admin");
    const res = await call(String(accessId));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("INTERDIT");
  });

  it("RH : 200, pièce jointe non mise en cache ; format invalide 400 ; identifiant invalide 404", async () => {
    as("rh");
    const zip = await call(String(accessId));
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toMatch(/^attachment; filename="acces-T3-\d{8}\.zip"$/);
    expect(zip.headers.get("cache-control")).toBe("no-store");
    expect(readZip(Buffer.from(await zip.arrayBuffer())).has("donnees.json")).toBe(true);
    const json = await call(String(accessId), "?format=json");
    expect((await json.json()).salarie.matricule).toBe("T3");
    expect((await call(String(accessId), "?format=pdf")).status).toBe(400);
    expect((await call("abc")).status).toBe(404);
    expect(auditOf(db.sqlite, "privacy.export").filter((a) => a.outcome === "OK" && a.targetId === String(w.e.T3))).toHaveLength(2);
  });
});

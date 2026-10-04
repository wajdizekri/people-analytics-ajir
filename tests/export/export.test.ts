import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/session";
import type { AccessContext } from "@/lib/dal/context";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, managerCtx, rhCtx, sensitiveValues, setupSeededDb } from "../pilotage/setup";
import { parseCsv } from "./parse";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({
  readSession: async () => session.current,
  clientIp: (h: Headers) => h.get("x-forwarded-for") ?? "local",
}));

let file = "";
let seed: SeedResult;
let adminUserId = 0;
beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("export"));
  adminUserId = Number(db().prepare("INSERT INTO app_user (login, role, active) VALUES ('admin.test', 'ADMIN', 1)").run().lastInsertRowid);
}, 120_000);
afterAll(() => cleanupDb(file));

const adminCtx = (): AccessContext => ({ userId: adminUserId, login: "admin.test", role: "ADMIN", employeeId: null });
const as = (ctx: AccessContext | null) => (session.current = ctx);
const req = (url: string) => new NextRequest(new URL(url, "http://localhost"));
async function exportRoute(kind: string, qs = "") {
  const { GET } = await import("@/app/api/export/[kind]/route");
  return GET(req(`/api/export/${kind}${qs}`), { params: Promise.resolve({ kind }) });
}
// Octets bruts : Response.text() retirerait le BOM
async function csvOf(res: Response) {
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
  const [head, ...rows] = parseCsv(text);
  return { text, head, rows };
}
const lastAudit = (action: string) =>
  db().prepare("SELECT user_id AS userId, outcome, target_type AS targetType, target_id AS targetId, detail_json AS d FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1").get(action) as
    | { userId: number; outcome: string; targetType: string; targetId: string; d: string }
    | undefined;
const scopeIds = (rootId: number) =>
  new Set(
    (
      db()
        .prepare("WITH RECURSIVE team(id) AS (SELECT id FROM employee WHERE manager_id = ? UNION SELECT e.id FROM employee e JOIN team t ON e.manager_id = t.id) SELECT id FROM team")
        .all(rootId) as { id: number }[]
    ).map((r) => r.id),
  );

const MANAGER_HEADERS = ["Matricule", "Nom", "Prénom", "Poste", "Département", "Contrat", "Ancienneté (mois)", "Niveau de risque"];

describe("GET /api/export/[kind] : accès", () => {
  it("401 sans session, 404 pour un type de liste inconnu", async () => {
    as(null);
    expect((await exportRoute("employees")).status).toBe(401);
    as(rhCtx(seed));
    expect((await exportRoute("salaires")).status).toBe(404);
  });

  it("ADMIN refusé pour les collaborateurs et les recommandations (403 audité), MANAGER refusé pour les recommandations", async () => {
    as(adminCtx());
    const res = await exportRoute("employees");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(lastAudit("access.api")).toMatchObject({ userId: adminUserId, outcome: "REFUSE" });
    expect((await exportRoute("recommendations")).status).toBe(403);
    as(managerCtx(seed));
    expect((await exportRoute("recommendations")).status).toBe(403);
  });

  it("DAL : refus audité « export.csv » même sans passer par la route", async () => {
    const { exportList } = await import("@/lib/dal/export");
    expect(() => exportList(adminCtx(), "employees", {})).toThrow(/Accès refusé/);
    expect(lastAudit("export.csv")).toMatchObject({ userId: adminUserId, outcome: "REFUSE", targetType: "export", targetId: "employees" });
    expect(() => exportList(managerCtx(seed), "recommendations", {})).toThrow(/Accès refusé/);
  });
});

describe("export des collaborateurs", () => {
  it("RH : fichier Excel français, toutes les pages, estimation incluse, nom de fichier daté des données", async () => {
    as(rhCtx(seed));
    const res = await exportRoute("employees");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="collaborateurs-2026-08-31.csv"');
    const { text, head, rows } = await csvOf(res);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(Buffer.from(text, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/"[^"]*"/g, "")).not.toMatch(/[^\r]\n/);
    expect(head).toEqual([...MANAGER_HEADERS, "Probabilité à 6 mois (%)", "Rapport au risque moyen (×)"]);
    const total = (db().prepare("SELECT COUNT(*) AS n FROM employee WHERE status = 'ACTIF'").get() as { n: number }).n;
    expect(total).toBeGreaterThan(25);
    expect(rows).toHaveLength(total);
    expect(res.headers.get("x-export-rows")).toBe(String(total));
    expect(res.headers.get("x-export-truncated")).toBe("0");
    const probs = rows.map((r) => r[8]).filter(Boolean);
    expect(probs.length).toBeGreaterThan(0);
    expect(probs.every((p) => /^\d+,\d$/.test(p))).toBe(true);
  });

  it("mêmes filtres que la page (niveau, département, recherche) et audit sans le texte recherché", async () => {
    as(rhCtx(seed));
    const { listEmployees, employeeListSchema } = await import("@/lib/dal/employees");
    const high = await csvOf(await exportRoute("employees", "?niveau=ELEVE&tri=nom"));
    const expected = listEmployees(rhCtx(seed), employeeListSchema.parse({ niveau: "ELEVE", tri: "nom" }));
    expect(high.rows.length).toBe(expected.total);
    expect(high.rows.every((r) => r[7] === "Élevé")).toBe(true);
    expect(high.rows.slice(0, expected.rows.length).map((r) => r[0])).toEqual(expected.rows.map((r) => r.matricule));

    const someone = db().prepare("SELECT last_name AS n, department_id AS d FROM employee WHERE status = 'ACTIF' LIMIT 1").get() as { n: string; d: number };
    const found = await csvOf(await exportRoute("employees", `?q=${encodeURIComponent(someone.n)}&departement=${someone.d}&page=3&retour=/dashboard`));
    expect(found.rows.length).toBeGreaterThan(0);
    expect(found.rows.every((r) => r[1].includes(someone.n) || r[2].includes(someone.n) || r[0].includes(someone.n))).toBe(true);
    const a = lastAudit("export.csv")!;
    expect(a).toMatchObject({ outcome: "OK", targetType: "export", targetId: "employees" });
    const d = JSON.parse(a.d);
    expect(d).toMatchObject({ format: "csv", rows: found.rows.length, total: found.rows.length, truncated: false, view: "RH", filters: { q: true, departement: someone.d } });
    expect(a.d).not.toContain(someone.n);
  });

  it("filtre invalide ignoré comme sur la page (pas d'erreur 400)", async () => {
    as(rhCtx(seed));
    const res = await exportRoute("employees", "?niveau=TRES_HAUT&contrat=CDI");
    expect(res.status).toBe(200);
    const { rows } = await csvOf(res);
    expect(rows.every((r) => r[5] === "CDI")).toBe(true);
    expect(JSON.parse(lastAudit("export.csv")!.d)).toMatchObject({ ignored: ["niveau"], filters: { contrat: "CDI" } });
  });

  it("MANAGER : son périmètre seulement, aucune colonne ni valeur sensible, même avec tri=probabilite", async () => {
    as(managerCtx(seed));
    const res = await exportRoute("employees", "?tri=probabilite");
    expect(res.status).toBe(200);
    const { text, head, rows } = await csvOf(res);
    expect(head).toEqual(MANAGER_HEADERS);
    const scope = scopeIds(seed.managerEmployeeId);
    const active = (db().prepare("SELECT id, matricule FROM employee WHERE status = 'ACTIF'").all() as { id: number; matricule: string }[]).filter((e) => scope.has(e.id));
    expect(rows.map((r) => r[0]).sort()).toEqual(active.map((e) => e.matricule).sort());
    expect(rows.every((r) => r.length === MANAGER_HEADERS.length)).toBe(true);
    expect(text).not.toMatch(/Probabilit|Rapport au risque|Score à règles|salaire|TND/i);
    const s = sensitiveValues(active.map((e) => e.id));
    for (const phrase of s.strings) expect(text).not.toContain(phrase);
    expect(JSON.parse(lastAudit("export.csv")!.d)).toMatchObject({ view: "MANAGER" });
  });
});

describe("export des alertes", () => {
  let ids: Record<string, number> = {};
  beforeAll(() => {
    const inScope = db().prepare("SELECT id FROM employee WHERE manager_id = ? AND status = 'ACTIF' LIMIT 1").get(seed.managerEmployeeId) as { id: number };
    const scope = scopeIds(seed.managerEmployeeId);
    const outside = (db().prepare("SELECT id FROM employee WHERE status = 'ACTIF'").all() as { id: number }[]).find((e) => !scope.has(e.id) && e.id !== seed.managerEmployeeId)!;
    const ins = db().prepare(
      "INSERT INTO alert (type, severity, status, audience, manager_id, employee_id, title, message, dedup_key, created_at) VALUES (@type, @severity, @status, @audience, @managerId, @employeeId, @title, @message, @key, '2026-08-31T23:30:00.000Z')",
    );
    const add = (key: string, a: { type: string; severity?: string; status?: string; audience: string; managerId?: number | null; employeeId?: number | null; title: string; message?: string }) =>
      (ids[key] = Number(
        ins.run({ severity: "ATTENTION", status: "NOUVELLE", managerId: null, employeeId: null, message: "Message de test.", ...a, key: `export-test-${key}` }).lastInsertRowid,
      ));
    ids = {};
    add("turnoverEquipe", { type: "TURNOVER", audience: "MANAGER", employeeId: inScope.id, title: '=HYPERLINK("http://evil";"clic")', message: "Ligne 1\nLigne 2; suite" });
    add("absIndividuelle", { type: "ABSENTEISME", audience: "MANAGER", employeeId: inScope.id, title: "Signal individuel d'absentéisme" });
    add("absEquipe", { type: "ABSENTEISME", audience: "MANAGER", managerId: seed.managerEmployeeId, title: "Absentéisme collectif de l'équipe", status: "EN_COURS" });
    add("horsPerimetre", { type: "TURNOVER", audience: "MANAGER", employeeId: outside.id, title: "Alerte hors périmètre" });
    add("rh", { type: "ABSENTEISME", audience: "RH", employeeId: inScope.id, title: "Alerte RH nominative", severity: "CRITIQUE" });
    add("systeme", { type: "SYSTEME", audience: "ADMIN", title: "Service de calcul arrêté" });
  });

  const titles = (rows: string[][]) => rows.map((r) => r[4]);

  it("MANAGER : alertes de son équipe, jamais de signal individuel d'absentéisme ; injection de formule neutralisée", async () => {
    as(managerCtx(seed));
    const res = await exportRoute("alerts");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="alertes-2026-08-31.csv"');
    const { text, head, rows } = await csvOf(res);
    expect(head).toEqual(["Gravité", "Type", "Statut", "Créée le", "Titre", "Description", "Concerne", "Action proposée"]);
    expect(titles(rows)).toContain(`'=HYPERLINK("http://evil";"clic")`);
    expect(titles(rows)).toContain("Absentéisme collectif de l'équipe");
    expect(titles(rows)).not.toContain("Signal individuel d'absentéisme");
    expect(titles(rows)).not.toContain("Alerte hors périmètre");
    expect(titles(rows)).not.toContain("Alerte RH nominative");
    expect(titles(rows)).not.toContain("Service de calcul arrêté");
    expect(text).not.toMatch(/(^|;)=HYPERLINK/m);
    const turnover = rows.find((r) => r[4].includes("HYPERLINK"))!;
    expect(turnover[3]).toBe("01/09/2026 00:30");
    expect(turnover[5]).toBe("Ligne 1\nLigne 2; suite");
    expect(turnover.slice(0, 3)).toEqual(["Attention", "Risque de départ", "Nouvelle"]);
  });

  it("RH : toutes sauf l'audience ADMIN ; ADMIN : seulement les alertes techniques ; filtres de la page appliqués", async () => {
    as(rhCtx(seed));
    const rh = await csvOf(await exportRoute("alerts"));
    expect(titles(rh.rows)).toEqual(expect.arrayContaining(["Alerte RH nominative", "Signal individuel d'absentéisme", "Alerte hors périmètre"]));
    expect(titles(rh.rows)).not.toContain("Service de calcul arrêté");
    const critical = await csvOf(await exportRoute("alerts", "?severity=CRITIQUE"));
    expect(critical.rows.length).toBeGreaterThan(0);
    expect(critical.rows.every((r) => r[0] === "Critique")).toBe(true);
    const inProgress = await csvOf(await exportRoute("alerts", "?status=EN_COURS&type=ABSENTEISME"));
    expect(titles(inProgress.rows)).toEqual(["Absentéisme collectif de l'équipe"]);
    // Comme la page : un filtre invalide fait ignorer tous les filtres
    const invalid = await csvOf(await exportRoute("alerts", "?status=EN_COURS&type=INCONNU"));
    expect(invalid.rows.length).toBe(rh.rows.length);

    as(adminCtx());
    const admin = await csvOf(await exportRoute("alerts"));
    expect(titles(admin.rows)).toEqual(["Service de calcul arrêté"]);
    expect(admin.rows[0][6]).toBe("L'outil (alerte technique)");
    expect(JSON.parse(lastAudit("export.csv")!.d)).toMatchObject({ view: "ADMIN", rows: 1, total: 1 });
  });
});

describe("export des recommandations", () => {
  it("RH : toutes les recommandations filtrées, colonnes de la page", async () => {
    as(rhCtx(seed));
    const { listRecommendations, recommendationListSchema } = await import("@/lib/dal/recommendations");
    const all = await csvOf(await exportRoute("recommendations"));
    expect(all.head).toEqual([
      "Statut",
      "Priorité",
      "Émise le",
      "Matricule",
      "Collaborateur",
      "Département",
      "Niveau de risque actuel",
      "Facteur associé",
      "Action recommandée",
      "Décidée le",
      "Intervention le",
      "Commentaire ou motif",
      "Avis",
    ]);
    expect(all.rows.length).toBe(listRecommendations(rhCtx(seed), recommendationListSchema.parse({})).total);
    expect(all.rows.every((r) => /^\d{2}\/\d{2}\/\d{4}$/.test(r[2]))).toBe(true);
    const proposed = await csvOf(await exportRoute("recommendations", "?statut=PROPOSEE"));
    expect(proposed.rows.length).toBe(listRecommendations(rhCtx(seed), recommendationListSchema.parse({ statut: "PROPOSEE" })).total);
    expect(proposed.rows.every((r) => r[0] === "Proposée" && ["Haute", "Moyenne", "Basse"].includes(r[1]) && r[9] === "")).toBe(true);
    expect(lastAudit("export.csv")).toMatchObject({ outcome: "OK", targetId: "recommendations" });
  });
});

describe("plafond de 10 000 lignes", () => {
  it("export tronqué et signalé (en-têtes, audit)", async () => {
    const { EXPORT_MAX_ROWS } = await import("@/lib/export/kinds");
    const ins = db().prepare("INSERT INTO alert (type, severity, status, audience, title, message, dedup_key) VALUES ('DONNEES', 'INFO', 'TRAITEE', 'RH', ?, 'Volume', ?)");
    db().transaction(() => {
      for (let i = 0; i < EXPORT_MAX_ROWS + 5; i++) ins.run(`Volume ${i}`, `export-volume-${i}`);
    })();
    as(rhCtx(seed));
    const res = await exportRoute("alerts", "?status=TRAITEE");
    const { rows } = await csvOf(res);
    expect(rows).toHaveLength(EXPORT_MAX_ROWS);
    expect(res.headers.get("x-export-truncated")).toBe("1");
    expect(Number(res.headers.get("x-export-total"))).toBeGreaterThan(EXPORT_MAX_ROWS);
    expect(JSON.parse(lastAudit("export.csv")!.d)).toMatchObject({ rows: EXPORT_MAX_ROWS, truncated: true });
  });
});

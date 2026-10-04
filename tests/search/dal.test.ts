import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZodError } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { visibleEmployeeIds, type AccessContext } from "@/lib/dal/context";
import { SEARCH_EMPLOYEE_LIMIT, searchAll } from "@/lib/dal/search";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, findLeaks, managerCtx, rhCtx, sensitiveValues, setupSeededDb } from "../pilotage/setup";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let file = "";
let seed: SeedResult;
let adminUserId = 0;
type Emp = { id: number; matricule: string; first_name: string; last_name: string };
let inScope: Emp;
let outOfScope: Emp;
let exited: Emp;

const adminCtx = (): AccessContext => ({ userId: adminUserId, login: "admin.test", role: "ADMIN", employeeId: null });

function addAlert(a: { type: string; audience: string; status?: string; employeeId?: number | null; managerId?: number | null; title: string }) {
  db()
    .prepare(
      `INSERT INTO alert (type, severity, status, audience, employee_id, manager_id, title, message, dedup_key)
       VALUES (@type, 'ATTENTION', @status, @audience, @employeeId, @managerId, @title, 'Message de test', @key)`,
    )
    .run({ status: "NOUVELLE", employeeId: null, managerId: null, ...a, key: `test-${Math.random()}` });
}

beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("search"));
  const s = db();
  adminUserId = Number(s.prepare("INSERT INTO app_user (login, role, active) VALUES ('admin.test', 'ADMIN', 1)").run().lastInsertRowid);
  const scope = JSON.stringify(visibleEmployeeIds(managerCtx(seed)));
  const cols = "id, matricule, first_name, last_name";
  inScope = s.prepare(`SELECT ${cols} FROM employee WHERE status = 'ACTIF' AND id IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT 1`).get(scope) as Emp;
  outOfScope = s
    .prepare(`SELECT ${cols} FROM employee WHERE status = 'ACTIF' AND id NOT IN (SELECT value FROM json_each(?)) AND id <> ? ORDER BY id LIMIT 1`)
    .get(scope, seed.managerEmployeeId) as Emp;
  exited = s.prepare(`SELECT ${cols} FROM employee WHERE status = 'SORTI' ORDER BY id LIMIT 1`).get() as Emp;

  addAlert({ type: "TURNOVER", audience: "MANAGER", employeeId: inScope.id, title: `Risque de départ élevé : ${inScope.first_name} ${inScope.last_name}` });
  addAlert({ type: "TURNOVER", audience: "MANAGER", employeeId: outOfScope.id, title: `Risque de départ élevé : ${outOfScope.first_name} ${outOfScope.last_name}` });
  addAlert({ type: "TURNOVER", audience: "MANAGER", status: "TRAITEE", employeeId: inScope.id, title: "Risque de départ élevé : alerte close" });
  addAlert({ type: "ABSENTEISME", audience: "MANAGER", employeeId: inScope.id, title: "Absentéisme inhabituel : signal individuel" });
  addAlert({ type: "SYSTEME", audience: "ADMIN", title: "Échec du calcul mensuel" });
  addAlert({ type: "DONNEES", audience: "RH", title: "Qualité des données : lot partiellement rejeté" });
});
afterAll(() => cleanupDb(file));

describe("DAL search", () => {
  it("refuse une saisie de moins de 2 ou de plus de 100 caractères", () => {
    for (const q of ["", "a", "  a  ", "x".repeat(101), null, undefined]) expect(() => searchAll(rhCtx(seed), q)).toThrow(ZodError);
    expect(searchAll(rhCtx(seed), "  ab ").q).toBe("ab");
  });

  it("manager : uniquement sa hiérarchie ; la RH trouve aussi hors de l'équipe", () => {
    const ids = new Set(visibleEmployeeIds(managerCtx(seed)));
    const mine = searchAll(managerCtx(seed), "A0");
    expect(mine.employees.length).toBeGreaterThan(0);
    expect(mine.employees.every((e) => ids.has(e.id))).toBe(true);
    expect(searchAll(managerCtx(seed), outOfScope.matricule).employees).toEqual([]);
    expect(searchAll(managerCtx(seed), inScope.matricule).employees.map((e) => e.id)).toEqual([inScope.id]);
    expect(searchAll(rhCtx(seed), outOfScope.matricule).employees.map((e) => e.id)).toEqual([outOfScope.id]);
  });

  it("nom, prénom (dans les deux ordres) ou matricule, actifs seulement, comme la liste /employees", () => {
    const rh = rhCtx(seed);
    const hit = (q: string) => searchAll(rh, q).employees.some((e) => e.id === inScope.id);
    expect(hit(`${inScope.first_name} ${inScope.last_name}`.toLowerCase())).toBe(true);
    expect(hit(`${inScope.last_name} ${inScope.first_name}`.toUpperCase())).toBe(true);
    expect(searchAll(rh, exited.matricule).employees).toEqual([]);
    expect(searchAll(rh, "%%").employees).toEqual([]);
  });

  it("8 collaborateurs au plus, signale la suite, matricule exact en tête", () => {
    const r = searchAll(rhCtx(seed), "A0");
    expect(r.employees).toHaveLength(SEARCH_EMPLOYEE_LIMIT);
    expect(r.moreEmployees).toBe(true);
    const exact = searchAll(rhCtx(seed), inScope.matricule.toLowerCase());
    expect(exact.employees[0].id).toBe(inScope.id);
  });

  it("aucun champ sensible : nom, matricule, département et poste seulement", () => {
    for (const ctx of [rhCtx(seed), managerCtx(seed)]) {
      const r = searchAll(ctx, "A0");
      for (const e of r.employees) expect(Object.keys(e).sort()).toEqual(["department", "firstName", "id", "jobTitle", "lastName", "matricule"]);
      const s = sensitiveValues(r.employees.map((e) => e.id));
      expect(findLeaks(r, s.numbers, s.strings)).toEqual([]);
    }
  });

  it("alertes ouvertes filtrées comme /alerts, recherche sans accents", () => {
    const rh = searchAll(rhCtx(seed), "depart eleve").alerts.map((a) => a.title);
    expect(rh).toHaveLength(2);
    expect(rh.every((t) => !t.includes("close"))).toBe(true);
    const mgr = searchAll(managerCtx(seed), "RISQUE DE DÉPART").alerts;
    expect(mgr.map((a) => a.title)).toEqual([`Risque de départ élevé : ${inScope.first_name} ${inScope.last_name}`]);
    expect(Object.keys(mgr[0]).sort()).toEqual(["id", "severity", "status", "title"]);
    expect(searchAll(managerCtx(seed), "absenteisme").alerts).toEqual([]);
    expect(searchAll(rhCtx(seed), "absenteisme").alerts).toHaveLength(1);
    expect(searchAll(rhCtx(seed), "calcul mensuel").alerts).toEqual([]);
  });

  it("ADMIN : aucun collaborateur ni alerte RH, seulement ses alertes d'administration", () => {
    const admin = adminCtx();
    expect(searchAll(admin, inScope.matricule).employees).toEqual([]);
    expect(searchAll(admin, "A0").employees).toEqual([]);
    expect(searchAll(admin, "risque").alerts).toEqual([]);
    expect(searchAll(admin, "absenteisme").alerts).toEqual([]);
    expect(searchAll(admin, "calcul").alerts.map((a) => a.title)).toEqual(["Échec du calcul mensuel"]);
    expect(searchAll(admin, "qualite des donnees").alerts).toHaveLength(1);
  });
});

describe("GET /api/search", () => {
  const req = (q: string | null) => new NextRequest(new URL(q === null ? "/api/search" : `/api/search?q=${encodeURIComponent(q)}`, "http://localhost"));
  const call = async (q: string | null) => (await import("@/app/api/search/route")).GET(req(q), undefined);

  it("401 sans session, 400 si la saisie est trop courte ou absente", async () => {
    session.current = null;
    expect((await call("ab")).status).toBe(401);
    session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null };
    expect((await call("a")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
  });

  it("200 non mis en cache, périmètre du rôle", async () => {
    session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId };
    const res = await call(outOfScope.matricule);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).employees).toEqual([]);
    session.current = { userId: adminUserId, login: "admin.test", role: "ADMIN", employeeId: null };
    const admin = await (await call(inScope.matricule)).json();
    expect(admin).toMatchObject({ employees: [], moreEmployees: false, alerts: [] });
  });
});

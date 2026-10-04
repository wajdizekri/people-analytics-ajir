import { beforeAll, describe, expect, it } from "vitest";
import { fullNames, loadFixtures, makeSession, req, scanLeaks, userId, type Fixtures } from "./helpers";

// Matrice d'autorisation HTTP : anonyme / ADMIN / RH / MANAGER (dans et hors périmètre).
// Contrôle des codes HTTP attendus ET de l'absence de fuite de données sensibles dans les corps de réponse.

let fx: Fixtures;
let anon: undefined;
let admin: string;
let rh: string;
let mgr: string;
let sensitiveNumbers: number[];
let phrases: string[];
let mgrNameLeaks: string[];

beforeAll(async () => {
  fx = loadFixtures();
  admin = makeSession(userId("admin"));
  rh = makeSession(userId("rh.demo"));
  mgr = makeSession(userId("mgr.M10451"));
  sensitiveNumbers = fx.sensitiveNumbers;
  phrases = fx.phrases;
  const inSet = new Set(fullNames(fx.inNames));
  mgrNameLeaks = fullNames(fx.outNames).filter((n) => !inSet.has(n));
});

const sess = () => ({ anon, admin, rh, mgr });

describe("Serveur de test joignable", () => {
  it("répond sur /api/health", async () => {
    const r = await req("GET", "/api/health");
    expect([200, 503]).toContain(r.status);
  });
});

describe("Matrice API — codes HTTP par rôle", () => {
  // /api/health : 503 si le worker est hors service (campagne lancée sans worker), même code pour tous les rôles
  type Code = number | number[];
  const UP = [200, 503];
  const cases: { name: string; method: string; path: () => string; expect: { anon: Code; admin: Code; rh: Code; mgr: Code } }[] = [
    { name: "GET /api/health", method: "GET", path: () => "/api/health", expect: { anon: UP, admin: UP, rh: UP, mgr: UP } },
    { name: "GET /api/me", method: "GET", path: () => "/api/me", expect: { anon: 401, admin: 200, rh: 200, mgr: 200 } },
    { name: "GET /api/dashboard", method: "GET", path: () => "/api/dashboard", expect: { anon: 401, admin: 403, rh: 200, mgr: 200 } },
    { name: "GET /api/employees", method: "GET", path: () => "/api/employees", expect: { anon: 401, admin: 403, rh: 200, mgr: 200 } },
    { name: "GET /api/employees/[inScope]", method: "GET", path: () => `/api/employees/${fx.inScopeScored}`, expect: { anon: 401, admin: 403, rh: 200, mgr: 200 } },
    { name: "GET /api/employees/[outScope]", method: "GET", path: () => `/api/employees/${fx.scoredOut}`, expect: { anon: 401, admin: 403, rh: 200, mgr: 403 } },
    { name: "GET /api/employees/[inexistant]", method: "GET", path: () => `/api/employees/9999999`, expect: { anon: 401, admin: 404, rh: 404, mgr: 404 } },
    { name: "GET /api/alerts", method: "GET", path: () => "/api/alerts", expect: { anon: 401, admin: 200, rh: 200, mgr: 200 } },
    { name: "GET /api/imports", method: "GET", path: () => "/api/imports", expect: { anon: 401, admin: 200, rh: 200, mgr: 403 } },
    { name: "GET /api/admin/users", method: "GET", path: () => "/api/admin/users", expect: { anon: 401, admin: 200, rh: 403, mgr: 403 } },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const s = sess();
      for (const role of ["anon", "admin", "rh", "mgr"] as const) {
        const r = await req(c.method, c.path(), { token: s[role] });
        const want = c.expect[role];
        expect(Array.isArray(want) ? want : [want], `${c.name} [${role}] attendu ${want}, obtenu ${r.status} — ${r.text.slice(0, 200)}`).toContain(r.status);
      }
    });
  }

  it("POST /api/employees/[id]/what-if : RH autorisé, ADMIN/MANAGER 403, anon 401", async () => {
    const p = `/api/employees/${fx.inScopeScored}/what-if`;
    const body = JSON.stringify({ salaryPct: 5 });
    const h = { "Content-Type": "application/json" };
    expect((await req("POST", p, { headers: h, body })).status).toBe(401);
    expect((await req("POST", p, { token: admin, headers: h, body })).status).toBe(403);
    expect((await req("POST", p, { token: mgr, headers: h, body })).status).toBe(403);
    expect([200, 409]).toContain((await req("POST", p, { token: rh, headers: h, body })).status);
  });

  it("POST /api/predictions/run : rôle contrôlé avant validation (MGR 403, RH/ADMIN passent le rôle)", async () => {
    const bad = JSON.stringify({ asOf: "pas-une-date" });
    const h = { "Content-Type": "application/json" };
    expect((await req("POST", "/api/predictions/run", { headers: h, body: bad })).status).toBe(401);
    expect((await req("POST", "/api/predictions/run", { token: mgr, headers: h, body: bad })).status).toBe(403);
    // rôle OK => la validation zod prend le relais (400), aucune mise en file
    expect((await req("POST", "/api/predictions/run", { token: rh, headers: h, body: bad })).status).toBe(400);
    expect((await req("POST", "/api/predictions/run", { token: admin, headers: h, body: bad })).status).toBe(400);
  });

  it("POST /api/admin/users : ADMIN passe le rôle (400 sur corps invalide), RH/MGR 403", async () => {
    const bad = JSON.stringify({ login: "a", role: "ZZZ" });
    const h = { "Content-Type": "application/json" };
    expect((await req("POST", "/api/admin/users", { headers: h, body: bad })).status).toBe(401);
    expect((await req("POST", "/api/admin/users", { token: rh, headers: h, body: bad })).status).toBe(403);
    expect((await req("POST", "/api/admin/users", { token: mgr, headers: h, body: bad })).status).toBe(403);
    expect((await req("POST", "/api/admin/users", { token: admin, headers: h, body: bad })).status).toBe(400);
  });

  it("POST /api/imports : ADMIN passe le rôle, RH/MGR 403", async () => {
    // fichier hors contrat => rejeté après contrôle de rôle
    const mk = (name: string, content: string) => {
      const fd = new FormData();
      fd.append("files", new Blob([content], { type: "text/csv" }), name);
      return fd;
    };
    expect((await req("POST", "/api/imports", { token: rh, body: mk("employees.csv", "a;b\n") })).status).toBe(403);
    expect((await req("POST", "/api/imports", { token: mgr, body: mk("employees.csv", "a;b\n") })).status).toBe(403);
    // ADMIN + nom hors contrat => 400 (validation), preuve que le rôle est passé
    expect((await req("POST", "/api/imports", { token: admin, body: mk("evil.exe", "a;b\n") })).status).toBe(400);
  });
});

describe("Matrice PAGES — accès par rôle", () => {
  // Une page est « refusée » si : redirection 3xx vers /login ou /interdit, OU 200 avec redirection diffusée (loading.tsx) vers /interdit.
  async function get(path: string, token?: string) {
    const r = await req("GET", path, { token });
    return r;
  }
  function denied(r: { status: number; headers: Headers; text: string }, to: "login" | "interdit"): boolean {
    const loc = r.headers.get("location") || "";
    if (r.status >= 300 && r.status < 400) return loc.includes(`/${to}`);
    if (r.status === 200) return r.text.includes(`/${to}`);
    return false;
  }
  // Une page est « autorisée » si 200 sans redirection diffusée vers /interdit.
  function allowed(r: { status: number; text: string }): boolean {
    return r.status === 200 && !r.text.includes("/interdit");
  }

  const pilotage = ["/dashboard", "/employees", "/absenteeism"];
  const rhOnly = ["/backtesting", "/recommendations"];
  const adminRh = ["/transparency", "/data-health"];
  const adminOnly = ["/admin/users", "/admin/settings", "/admin/audit"];
  const anyAuth = ["/alerts", "/compte"];

  it("anonyme : toutes les pages protégées redirigent vers /login", async () => {
    for (const p of [...pilotage, ...rhOnly, ...adminRh, ...adminOnly, ...anyAuth, "/employees/1", "/"]) {
      const r = await get(p);
      expect(denied(r, "login"), `${p} anon => ${r.status} ${r.headers.get("location")}`).toBe(true);
    }
  });

  it("pilotage (dashboard/employees/absenteeism) : RH+MGR autorisés, ADMIN vers /interdit", async () => {
    for (const p of pilotage) {
      expect(allowed(await get(p, rh)), `${p} RH`).toBe(true);
      expect(allowed(await get(p, mgr)), `${p} MGR`).toBe(true);
      expect(denied(await get(p, admin), "interdit"), `${p} ADMIN`).toBe(true);
    }
  });

  it("RH seul (backtesting/recommendations) : RH autorisé, ADMIN+MGR vers /interdit", async () => {
    for (const p of rhOnly) {
      expect(allowed(await get(p, rh)), `${p} RH`).toBe(true);
      expect(denied(await get(p, admin), "interdit"), `${p} ADMIN`).toBe(true);
      expect(denied(await get(p, mgr), "interdit"), `${p} MGR`).toBe(true);
    }
  });

  it("ADMIN+RH (transparency/data-health) : MGR vers /interdit", async () => {
    for (const p of adminRh) {
      expect(allowed(await get(p, admin)), `${p} ADMIN`).toBe(true);
      expect(allowed(await get(p, rh)), `${p} RH`).toBe(true);
      expect(denied(await get(p, mgr), "interdit"), `${p} MGR`).toBe(true);
    }
  });

  it("ADMIN seul (/admin/*) : RH+MGR vers /interdit", async () => {
    for (const p of adminOnly) {
      expect(allowed(await get(p, admin)), `${p} ADMIN`).toBe(true);
      expect(denied(await get(p, rh), "interdit"), `${p} RH`).toBe(true);
      expect(denied(await get(p, mgr), "interdit"), `${p} MGR`).toBe(true);
    }
  });

  it("fiche employé : RH partout, MGR dans le périmètre seulement, hors périmètre vers /interdit", async () => {
    expect(allowed(await get(`/employees/${fx.inScopeScored}`, rh)), "RH in").toBe(true);
    expect(allowed(await get(`/employees/${fx.scoredOut}`, rh)), "RH out (RH voit tout)").toBe(true);
    expect(allowed(await get(`/employees/${fx.inScopeScored}`, mgr)), "MGR in").toBe(true);
    expect(denied(await get(`/employees/${fx.scoredOut}`, mgr), "interdit"), "MGR out").toBe(true);
    expect(denied(await get(`/employees/${fx.inScopeScored}`, admin), "interdit"), "ADMIN").toBe(true);
  });
});

describe("IDOR — /api/employees/[id]", () => {
  it("MANAGER : ids hors périmètre => 403, inexistants => 404, ids invalides => 404", async () => {
    for (const id of fx.outScope) {
      expect((await req("GET", `/api/employees/${id}`, { token: mgr })).status, `out ${id}`).toBe(403);
    }
    for (const id of ["9999999", `${fx.maxEmp + 1000}`]) {
      expect((await req("GET", `/api/employees/${id}`, { token: mgr })).status, `inexistant ${id}`).toBe(404);
    }
    for (const id of ["0", "-1", "abc", "1.5", "%27", "1e9999"]) {
      expect((await req("GET", `/api/employees/${id}`, { token: mgr })).status, `invalide ${id}`).toBe(404);
    }
  });

  it("MANAGER : ids du périmètre => 200 vue MANAGER", async () => {
    for (const id of fx.inScope) {
      const r = await req("GET", `/api/employees/${id}`, { token: mgr });
      expect(r.status, `in ${id}`).toBe(200);
      expect((r.json as { view?: string }).view).toBe("MANAGER");
    }
  });
});

describe("Fuites de données — corps de réponse", () => {
  it("MANAGER /api/employees/[id] : ni salaire, ni probabilité, ni lift, ni phrase RH, ni nom hors périmètre", async () => {
    const r = await req("GET", `/api/employees/${fx.inScopeScored}`, { token: mgr });
    expect(r.status).toBe(200);
    const leaks = scanLeaks(r.json, sensitiveNumbers, [...phrases, ...mgrNameLeaks]);
    expect(leaks, `fuites: ${leaks.join(" | ")}`).toEqual([]);
  });

  it("MANAGER /api/employees (liste) : aucune donnée sensible", async () => {
    const r = await req("GET", "/api/employees", { token: mgr });
    expect(r.status).toBe(200);
    const leaks = scanLeaks(r.json, sensitiveNumbers, [...phrases, ...mgrNameLeaks]);
    expect(leaks, `fuites: ${leaks.join(" | ")}`).toEqual([]);
  });

  it("MANAGER /api/dashboard : ni masse salariale, ni lift, ni version de modèle", async () => {
    const r = await req("GET", "/api/dashboard", { token: mgr });
    expect(r.status).toBe(200);
    const leaks = scanLeaks(r.json, sensitiveNumbers, phrases);
    expect(leaks, `fuites: ${leaks.join(" | ")}`).toEqual([]);
  });

  it("MANAGER /api/alerts : aucun signal d'absentéisme individuel ni donnée sensible", async () => {
    const r = await req("GET", "/api/alerts", { token: mgr });
    expect(r.status).toBe(200);
    const leaks = scanLeaks(r.json, sensitiveNumbers, [...phrases, ...mgrNameLeaks]);
    expect(leaks, `fuites: ${leaks.join(" | ")}`).toEqual([]);
    const alerts = (r.json as { alerts?: { type: string; employeeName: string | null }[] }).alerts ?? [];
    // aucun signal ABSENTEISME nominatif
    expect(alerts.filter((a) => a.type === "ABSENTEISME" && a.employeeName)).toEqual([]);
  });

  it("ADMIN : /api/me, /api/imports, /api/alerts sans salaire/probabilité/phrase", async () => {
    for (const p of ["/api/me", "/api/imports", "/api/alerts"]) {
      const r = await req("GET", p, { token: admin });
      expect(r.status).toBe(200);
      const leaks = scanLeaks(r.json, sensitiveNumbers, phrases);
      expect(leaks, `${p} fuites: ${leaks.join(" | ")}`).toEqual([]);
    }
  });
});

describe("Paramètres manipulés & validation", () => {
  it("MANAGER : filtres réservés (contrat/âge/ancienneté) ignorés et signalés, pas de 400", async () => {
    const r = await req("GET", "/api/dashboard?contrat=CDI&age=30-39&anciennete=5-10", { token: mgr });
    expect(r.status).toBe(200);
    const ignored = (r.json as { ignored?: string[] }).ignored ?? [];
    for (const k of ["contrat", "age", "anciennete"]) expect(ignored, `${k} ignoré`).toContain(k);
  });

  it("types invalides => 400", async () => {
    const bad = [
      "/api/employees?departement=abc",
      "/api/employees?page=-5",
      "/api/employees?tri=xxx",
      "/api/employees?niveau=SUPER",
      "/api/dashboard?periode=99z",
      "/api/dashboard?departement=1.5",
      "/api/alerts?type=INEXISTANT",
      "/api/alerts?limit=100000",
      "/api/alerts?severity=ROUGE",
    ];
    for (const p of bad) {
      const r = await req("GET", p, { token: rh });
      expect(r.status, `${p} => ${r.status}`).toBe(400);
      expect((r.json as { error?: { code?: string } })?.error?.code).toBe("VALIDATION");
    }
  });

  it("pagination extrême : page haute clampée (200), au-delà de la borne => 400", async () => {
    expect((await req("GET", "/api/employees?page=100000", { token: rh })).status).toBe(200);
    expect((await req("GET", "/api/employees?page=100001", { token: rh })).status).toBe(400);
  });

  it("paramètre inconnu ignoré (200)", async () => {
    expect((await req("GET", "/api/employees?foo=bar&xyz=1", { token: rh })).status).toBe(200);
  });
});

describe("Méthodes HTTP non prévues", () => {
  it("méthodes non définies => 405", async () => {
    const cases: [string, string][] = [
      ["POST", "/api/dashboard"],
      ["DELETE", "/api/employees"],
      ["PUT", "/api/me"],
      ["GET", `/api/employees/${fx.inScopeScored}/what-if`],
      ["DELETE", "/api/admin/users"],
      ["PUT", `/api/alerts/${fx.anyAlert}`],
    ];
    for (const [m, p] of cases) {
      const r = await req(m, p, { token: rh });
      expect(r.status, `${m} ${p} => ${r.status}`).toBe(405);
    }
  });
});

import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BASE,
  cookieToken,
  deleteSession,
  loadFixtures,
  login,
  logoutViaPage,
  makeSession,
  rawDb,
  req,
  sha256,
  submitForm,
  userId,
  type Fixtures,
} from "./helpers";

// Attaques ciblées : injection SQL, XSS (réfléchi/stocké), CSRF, cycle de vie de session,
// cookie, énumération/verrouillage, jeton d'activation, téléversement, en-têtes, /api/health, hygiène des erreurs.

let fx: Fixtures;
let admin: string;
let rh: string;
const EVIL = "https://attacker.example";
const SAME = BASE.replace(/\/$/, "");
const created: { alertIds: number[]; userLogins: string[] } = { alertIds: [], userLogins: [] };

function insertAlert(fields: Record<string, string | number | null>): number {
  const d = rawDb();
  const cols = Object.keys(fields);
  const stmt = d.prepare(`INSERT INTO alert (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`);
  const id = Number(stmt.run(fields).lastInsertRowid);
  d.close();
  created.alertIds.push(id);
  return id;
}

function insertUser(login: string, cols: Record<string, string | number | null>): number {
  const d = rawDb();
  const all = { login, ...cols };
  const keys = Object.keys(all);
  const id = Number(d.prepare(`INSERT INTO app_user (${keys.join(",")}) VALUES (${keys.map((k) => `@${k}`).join(",")})`).run(all).lastInsertRowid);
  d.close();
  created.userLogins.push(login);
  return id;
}

beforeAll(() => {
  fx = loadFixtures();
  admin = makeSession(userId("admin"));
  rh = makeSession(userId("rh.demo"));
  // Nettoyage d'éventuels résidus d'une exécution précédente
  const d = rawDb();
  d.prepare("DELETE FROM app_user WHERE login LIKE 'sectest.%'").run();
  d.prepare("DELETE FROM alert WHERE dedup_key LIKE 'sectest-%'").run();
  d.close();
});

afterAll(() => {
  const d = rawDb();
  for (const id of created.alertIds) d.prepare("DELETE FROM alert WHERE id = ?").run(id);
  d.prepare("DELETE FROM app_user WHERE login LIKE 'sectest.%'").run();
  d.close();
});

const NO_INTERNAL = (t: string) => {
  const lower = t.toLowerCase();
  for (const marker of ["sqlite", "syntax error", "no such column", "no such table", "unrecognized token", "at object.", ".ts:", "\\people-analytics\\", "c:\\users", "econnrefused", "stacktrace"]) {
    expect(lower.includes(marker), `réponse contient un marqueur interne « ${marker} » : ${t.slice(0, 200)}`).toBe(false);
  }
};

describe("Injection SQL", () => {
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE employee;--",
    "1) OR (1=1",
    "\" OR \"\"=\"",
    "1; SELECT 1",
    "%27%20OR%201=1",
    "' UNION SELECT password_hash FROM app_user--",
    "admin'--",
    "\\",
  ];

  it("recherche/filtre/tri employés : jamais de 500 ni d'erreur SQL", async () => {
    for (const p of payloads) {
      const enc = encodeURIComponent(p);
      for (const url of [
        `/api/employees?q=${enc}`,
        `/api/employees?tri=${enc}`,
        `/api/employees?ordre=${enc}`,
        `/api/employees?niveau=${enc}`,
        `/api/employees?manager=${enc}`,
        `/api/employees?departement=${enc}`,
      ]) {
        const r = await req("GET", url, { token: rh });
        expect(r.status, `${url} => ${r.status}`).not.toBe(500);
        expect([200, 400]).toContain(r.status);
        NO_INTERNAL(r.text);
      }
    }
  });

  it("filtres d'alertes et de tableau de bord : jamais de 500 ni d'erreur SQL", async () => {
    for (const p of payloads) {
      const enc = encodeURIComponent(p);
      for (const url of [`/api/alerts?type=${enc}`, `/api/alerts?status=${enc}`, `/api/alerts?severity=${enc}`, `/api/alerts?limit=${enc}`, `/api/dashboard?periode=${enc}`, `/api/dashboard?departement=${enc}`]) {
        const r = await req("GET", url, { token: rh });
        expect(r.status, `${url} => ${r.status}`).not.toBe(500);
        NO_INTERNAL(r.text);
      }
    }
  });

  it("injection dans q : n'élargit pas le résultat (LIKE échappé)", async () => {
    const base = (await req("GET", "/api/employees", { token: rh }).then((r) => r.json)) as { total: number };
    const inj = (await req("GET", `/api/employees?q=${encodeURIComponent("' OR '1'='1")}`, { token: rh }).then((r) => r.json)) as { total: number };
    expect(inj.total).toBeLessThanOrEqual(base.total);
    // un caractère joker doit être traité littéralement, pas comme « tout »
    const pct = (await req("GET", `/api/employees?q=${encodeURIComponent("%")}`, { token: rh }).then((r) => r.json)) as { total: number };
    expect(pct.total).toBeLessThanOrEqual(base.total);
  });
});

describe("XSS", () => {
  it("réfléchi : réponses API en application/json (non exécutable)", async () => {
    const xss = encodeURIComponent("<script>alert(1)</script>");
    const r = await req("GET", `/api/employees?q=${xss}`, { token: rh });
    expect(r.headers.get("content-type") ?? "").toContain("application/json");
    expect(r.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("réfléchi : la page /employees n'injecte pas le script en clair", async () => {
    const r = await req("GET", `/employees?q=${encodeURIComponent("<script>alert(1)</script>")}`, { token: rh });
    expect(r.text.includes("<script>alert(1)</script>")).toBe(false);
  });

  it("stocké : titre/message/commentaire d'alerte échappés en HTML, sûrs en JSON", async () => {
    const payload = "<img src=x onerror=alert(73)>__SECXSS__";
    const id = insertAlert({
      type: "SYSTEME",
      severity: "INFO",
      status: "NOUVELLE",
      audience: "RH",
      title: payload,
      message: payload,
      comment: payload,
      dedup_key: `sectest-xss-${Date.now()}`,
    });
    // Page HTML : le payload ne doit jamais apparaître non échappé
    const page = await req("GET", "/alerts", { token: rh });
    expect(page.text.includes("<img src=x onerror=alert(73)>"), "payload brut dans le HTML").toBe(false);
    // API JSON : présent comme donnée, servi en application/json (donc non exécuté par le navigateur)
    const api = await req("GET", "/api/alerts?type=SYSTEME&limit=500", { token: rh });
    expect(api.headers.get("content-type") ?? "").toContain("application/json");
    const found = ((api.json as { alerts?: { id: number; title: string }[] }).alerts ?? []).find((a) => a.id === id);
    expect(found?.title).toBe(payload);
  });

  it("liens d'alerte dangereux neutralisés (javascript:, //evil) => null", async () => {
    const idJs = insertAlert({ type: "SYSTEME", severity: "INFO", audience: "RH", title: "t", message: "m", link: "javascript:alert(1)", dedup_key: `sectest-linkjs-${Date.now()}` });
    const idProto = insertAlert({ type: "SYSTEME", severity: "INFO", audience: "RH", title: "t", message: "m", link: "//attacker.example/x", dedup_key: `sectest-linkproto-${Date.now()}` });
    const api = await req("GET", "/api/alerts?type=SYSTEME&limit=500", { token: rh });
    const alerts = (api.json as { alerts?: { id: number; link: string | null }[] }).alerts ?? [];
    expect(alerts.find((a) => a.id === idJs)?.link).toBeNull();
    expect(alerts.find((a) => a.id === idProto)?.link).toBeNull();
  });
});

describe("CSRF — contrôle d'origine sur les Route Handlers mutants", () => {
  const mutating: { name: string; method: string; path: () => string; token: () => string; body?: () => BodyInit; ct?: string }[] = [
    { name: "PATCH /api/alerts/[id]", method: "PATCH", path: () => `/api/alerts/${fx.anyAlert}`, token: () => rh, body: () => JSON.stringify({ status: "EN_COURS" }), ct: "application/json" },
    { name: "POST /api/predictions/run", method: "POST", path: () => "/api/predictions/run", token: () => rh, body: () => "{}", ct: "application/json" },
    { name: "POST /api/employees/[id]/what-if", method: "POST", path: () => `/api/employees/${fx.inScopeScored}/what-if`, token: () => rh, body: () => JSON.stringify({ salaryPct: 1 }), ct: "application/json" },
    { name: "POST /api/admin/users", method: "POST", path: () => "/api/admin/users", token: () => admin, body: () => JSON.stringify({ login: "x" }), ct: "application/json" },
  ];

  it("origine étrangère => 403 ORIGINE_INVALIDE", async () => {
    for (const m of mutating) {
      const r = await req(m.method, m.path(), { token: m.token(), origin: EVIL, headers: m.ct ? { "Content-Type": m.ct } : {}, body: m.body?.() });
      expect(r.status, `${m.name} origine étrangère => ${r.status}`).toBe(403);
      expect((r.json as { error?: { code?: string } })?.error?.code, m.name).toBe("ORIGINE_INVALIDE");
    }
  });

  it("même origine => pas de rejet ORIGINE_INVALIDE (la logique métier prend le relais)", async () => {
    for (const m of mutating) {
      const r = await req(m.method, m.path(), { token: m.token(), origin: SAME, headers: m.ct ? { "Content-Type": m.ct } : {}, body: m.body?.() });
      expect((r.json as { error?: { code?: string } })?.error?.code, `${m.name} => ${r.status}`).not.toBe("ORIGINE_INVALIDE");
    }
  });

  it("GET n'est pas soumis au contrôle d'origine", async () => {
    const r = await req("GET", "/api/employees", { token: rh, origin: EVIL });
    expect(r.status).toBe(200);
  });

  it("Server Action /login avec origine étrangère : aucune session émise", async () => {
    const r = await submitForm("/login", { login: "rh.demo", password: "RhDemo2026pfe" }, undefined, { origin: EVIL });
    expect(cookieToken(r.setCookies), "aucun cookie de session ne doit être posé").toBeNull();
  });
});

describe("Session & cookie", () => {
  it("cookie de session : HttpOnly, SameSite=Lax, Secure (production)", async () => {
    const r = await login("rh.demo", "RhDemo2026pfe");
    const c = r.setCookies.find((x) => x.startsWith("pa_session=")) ?? "";
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Secure/i);
  });

  it("réutilisation après déconnexion => 401", async () => {
    const r = await login("rh.demo", "RhDemo2026pfe");
    const token = cookieToken(r.setCookies)!;
    expect(token).toBeTruthy();
    expect((await req("GET", "/api/me", { token })).status).toBe(200);
    const out = await logoutViaPage("/dashboard", token);
    expect(out.status).toBe(303);
    expect((await req("GET", "/api/me", { token })).status).toBe(401);
  });

  it("session supprimée / jeton falsifié / expiré => 401", async () => {
    const token = makeSession(userId("rh.demo"));
    expect((await req("GET", "/api/me", { token })).status).toBe(200);
    deleteSession(token);
    expect((await req("GET", "/api/me", { token })).status).toBe(401);
    expect((await req("GET", "/api/me", { token: "jeton-inexistant-falsifie" })).status).toBe(401);
    // session expirée
    const d = rawDb();
    const bad = "expired-" + Math.random().toString(36).slice(2);
    d.prepare("INSERT INTO session (id, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)").run(sha256(bad), userId("rh.demo"), new Date(Date.now() - 3600_000).toISOString(), "c", "c");
    d.close();
    expect((await req("GET", "/api/me", { token: bad })).status).toBe(401);
    deleteSession(bad);
  });

  it("pas de fixation : un jeton choisi par l'attaquant n'est pas validé et login émet un nouveau jeton", async () => {
    const attacker = "attacker-fixed-token-value";
    expect((await req("GET", "/api/me", { token: attacker })).status).toBe(401);
    const r = await submitForm("/login", { login: "rh.demo", password: "RhDemo2026pfe" }, attacker);
    const issued = cookieToken(r.setCookies);
    expect(issued).toBeTruthy();
    expect(issued).not.toBe(attacker);
  });
});

describe("Énumération de comptes & verrouillage", () => {
  const LOCKED = "Compte temporairement verrouillé";
  it("utilisateur inconnu et mauvais mot de passe : message générique identique", async () => {
    insertUser("sectest.enum", { role: "RH", active: 1, password_hash: "notarealhash" });
    const unknown = await login("compte.qui.nexiste.pas.xyz", "MauvaisMotDePasse1");
    const wrong = await login("sectest.enum", "MauvaisMotDePasse1");
    const GENERIC = "Identifiant ou mot de passe incorrect.";
    expect(unknown.status).toBe(200);
    expect(wrong.status).toBe(200);
    expect(unknown.text.includes(GENERIC)).toBe(true);
    expect(wrong.text.includes(GENERIC)).toBe(true);
    // ni l'un ni l'autre ne révèle l'existence du compte (message de verrouillage, pas l'aide « Compte oublié ou verrouillé ? »)
    expect(unknown.text.includes(LOCKED)).toBe(false);
    expect(wrong.text.includes(LOCKED)).toBe(false);
  });

  it("verrouillage progressif après 5 tentatives", async () => {
    insertUser("sectest.lock", { role: "RH", active: 1, password_hash: "notarealhash" });
    let locked = false;
    for (let i = 0; i < 7; i++) {
      const r = await login("sectest.lock", "MauvaisMotDePasse1");
      if (r.text.includes(LOCKED)) locked = true;
    }
    expect(locked, "le compte doit finir verrouillé").toBe(true);
    // compteur reflété côté base
    const d = rawDb();
    const u = d.prepare("SELECT failed_attempts, locked_until FROM app_user WHERE login = 'sectest.lock'").get() as { failed_attempts: number; locked_until: string | null };
    d.close();
    expect(u.failed_attempts).toBeGreaterThanOrEqual(5);
    expect(u.locked_until).toBeTruthy();
  });
});

describe("Jeton d'activation", () => {
  const tok = () => crypto.randomBytes(32).toString("base64url"); // 43 caractères [A-Za-z0-9_-]

  it("jeton aléatoire (bon format) / mal formé => aucun formulaire, lien invalide", async () => {
    const random43 = tok();
    const r1 = await req("GET", "/activation?token=" + random43);
    expect(r1.text.includes("invalide")).toBe(true);
    expect(r1.text.includes('name="password"'), "aucun formulaire de mot de passe").toBe(false);
    const malformed = "trop-court";
    const r2 = await req("GET", "/activation?token=" + malformed);
    expect(r2.text.includes("invalide")).toBe(true);
  });

  it("jeton valide : activation unique, réutilisation refusée", async () => {
    const token = tok();
    const id = insertUser("sectest.activ", { role: "RH", active: 1, password_hash: null });
    const d = rawDb();
    d.prepare("UPDATE app_user SET activation_token_hash = ?, activation_expires_at = ? WHERE id = ?").run(sha256(token), new Date(Date.now() + 86_400_000).toISOString(), id);
    d.close();
    await submitForm("/activation?token=" + token, { token, password: "NouveauMdp123", confirm: "NouveauMdp123" });
    // Effet authentique en base (le rendu sans JS re-vérifie le jeton déjà consommé : on s'appuie sur l'état persistant)
    const d2 = rawDb();
    const u = d2.prepare("SELECT password_hash, activation_token_hash FROM app_user WHERE id = ?").get(id) as { password_hash: string | null; activation_token_hash: string | null };
    d2.close();
    expect(u.password_hash, "mot de passe défini => activation réussie").toBeTruthy();
    expect(u.activation_token_hash, "jeton consommé (mis à null)").toBeNull();
    // réutilisation du même jeton => plus de compte correspondant (consommé) => lien invalide
    const reuse = await req("GET", "/activation?token=" + token);
    expect(reuse.text.includes("invalide")).toBe(true);
  });

  it("jeton expiré => refusé", async () => {
    const token = tok();
    const id = insertUser("sectest.expired", { role: "RH", active: 1, password_hash: null });
    const d = rawDb();
    d.prepare("UPDATE app_user SET activation_token_hash = ?, activation_expires_at = ? WHERE id = ?").run(sha256(token), new Date(Date.now() - 3600_000).toISOString(), id);
    d.close();
    const r = await req("GET", "/activation?token=" + token);
    expect(r.text.includes("invalide")).toBe(true);
  });
});

describe("Téléversement (/api/imports)", () => {
  const upload = (token: string, name: string, content: string, type = "text/csv") => {
    const fd = new FormData();
    fd.append("files", new Blob([content], { type }), name);
    return req("POST", "/api/imports", { token, body: fd });
  };

  it("réservé à l'ADMIN (RH => 403)", async () => {
    expect((await upload(rh, "employees.csv", "a;b\n")).status).toBe(403);
  });

  it("nom de fichier hors contrat / traversée de chemin => 400", async () => {
    for (const name of ["../../../etc/passwd", "..\\..\\windows\\system32\\cfg", "evil.exe", "employees.csv.exe", "shell.php", "employees.CSV"]) {
      const r = await upload(admin, name, "a;b\n");
      expect(r.status, `${name} => ${r.status}`).toBe(400);
    }
  });

  it("en-tête sans séparateur « ; » => 422", async () => {
    const r = await upload(admin, "payroll.csv", "colonne_sans_point_virgule\nvaleur\n");
    expect(r.status).toBe(422);
    expect((r.json as { error?: { code?: string } })?.error?.code).toBe("EN_TETE_INVALIDE");
  });

  it("dépassement de taille => 413", async () => {
    const big = "matricule;month\n" + "x".repeat(9 * 1024 * 1024 + 200 * 1024);
    const r = await upload(admin, "payroll.csv", big);
    expect(r.status).toBe(413);
  });
});

describe("En-têtes de sécurité & divulgation", () => {
  it("en-têtes présents sur page et API, pas de X-Powered-By", async () => {
    for (const p of ["/login", "/api/health"]) {
      const r = await req("GET", p);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect((r.headers.get("referrer-policy") ?? "").toLowerCase()).toContain("same-origin");
      expect(r.headers.get("x-powered-by")).toBeNull();
    }
  });

  it("/api/health ne divulgue aucune donnée sensible", async () => {
    const r = await req("GET", "/api/health");
    expect([200, 503]).toContain(r.status);
    const keys = Object.keys(r.json as object).sort();
    expect(keys).toEqual(["database", "model", "status", "worker"]);
    NO_INTERNAL(r.text);
    expect(r.text.toLowerCase()).not.toContain("data/");
    expect(r.text.toLowerCase()).not.toContain(".db");
  });

  it("messages d'erreur sans pile ni SQL, avec correlationId", async () => {
    // corps JSON invalide
    const bad = await req("POST", `/api/employees/${fx.inScopeScored}/what-if`, { token: rh, headers: { "Content-Type": "application/json" }, body: "{ceci n'est pas du json" });
    expect(bad.status).toBe(400);
    expect((bad.json as { error?: { correlationId?: string } })?.error?.correlationId).toBeTruthy();
    NO_INTERNAL(bad.text);
    // 404
    const nf = await req("GET", "/api/employees/9999999", { token: rh });
    expect(nf.status).toBe(404);
    NO_INTERNAL(nf.text);
    // validation
    const val = await req("GET", "/api/employees?page=-5", { token: rh });
    expect(val.status).toBe(400);
    NO_INTERNAL(val.text);
  });
});

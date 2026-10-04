import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { withApi } from "@/lib/api";
import { HttpError } from "@/lib/dal/errors";
import { auditSqlite } from "@/lib/engine/alerts";
import { openDalDb } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
beforeAll(() => (db = openDalDb("audit-api")));
afterAll(() => db.close());

const rows = () => getDb().sqlite.prepare("SELECT user_id AS u, action, target_type AS tt, target_id AS ti, outcome, detail_json AS d, ip FROM audit_log ORDER BY id").all();

describe("journal d'audit en ajout seul", () => {
  it("écriture : cible numérique convertie en texte, champs optionnels à NULL, résultat OK par défaut", () => {
    audit(7, "employee.view", { type: "employee", id: 42 }, undefined, { source: "page" }, "10.0.0.1");
    audit(null, "auth.login", { type: "user", id: null }, "REFUSE");
    audit(8, "export.csv");
    auditSqlite(getDb().sqlite, 9, "model.promote", { type: "model_version", id: "lr-v2" }, "ECHEC", { errors: ["x"] });
    auditSqlite(getDb().sqlite, null, "batch.run");
    expect(rows()).toEqual([
      { u: 7, action: "employee.view", tt: "employee", ti: "42", outcome: "OK", d: '{"source":"page"}', ip: "10.0.0.1" },
      { u: null, action: "auth.login", tt: "user", ti: null, outcome: "REFUSE", d: null, ip: null },
      { u: 8, action: "export.csv", tt: null, ti: null, outcome: "OK", d: null, ip: null },
      { u: 9, action: "model.promote", tt: "model_version", ti: "lr-v2", outcome: "ECHEC", d: '{"errors":["x"]}', ip: null },
      { u: null, action: "batch.run", tt: null, ti: null, outcome: "OK", d: null, ip: null },
    ]);
  });

  it("modification et suppression refusées par la base, y compris en transaction et en masse", () => {
    const s = getDb().sqlite;
    expect(() => s.prepare("UPDATE audit_log SET outcome = 'OK' WHERE outcome = 'REFUSE'").run()).toThrow(/ajout seul/);
    expect(() => s.prepare("DELETE FROM audit_log WHERE id = 1").run()).toThrow(/ajout seul/);
    expect(() => s.prepare("DELETE FROM audit_log").run()).toThrow(/ajout seul/);
    expect(() => s.transaction(() => s.prepare("UPDATE audit_log SET detail_json = NULL").run())()).toThrow(/ajout seul/);
    expect(() => s.prepare("INSERT INTO audit_log (id, action) VALUES (1, 'doublon')").run()).toThrow(/ajout seul|UNIQUE|PRIMARY KEY/);
    expect(rows()).toHaveLength(5);
    expect((rows()[0] as { action: string }).action).toBe("employee.view");
  });

  // B3 (docs/qa/COUVERTURE.md), corrigé par drizzle/0006_audit_hardening.sql : la suppression implicite d'un REPLACE
  // ne déclenche pas audit_log_no_delete ; le trigger BEFORE INSERT refuse tout id déjà présent.
  it("réécriture d'une entrée existante par INSERT OR REPLACE / REPLACE INTO / INSERT OR IGNORE refusée", () => {
    const s = getDb().sqlite;
    for (const verb of ["INSERT OR REPLACE", "REPLACE", "INSERT OR IGNORE"]) {
      expect(() => s.prepare(`${verb} INTO audit_log (id, action, outcome) VALUES (1, 'falsifie', 'OK')`).run()).toThrow(/ajout seul/);
    }
    expect((rows()[0] as { action: string }).action).toBe("employee.view");
    expect(rows()).toHaveLength(5);
  });
});

describe("enveloppe des Route Handlers", () => {
  const call = async (handler: () => Promise<Response>, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const req = new NextRequest("http://app.local/api/test", { method: init.method ?? "GET", headers: init.headers });
    const res = await withApi<unknown>(async () => handler())(req, {});
    return { status: res.status, body: (await res.json()) as { error?: { code: string; message: string; correlationId: string; issues?: unknown[] } } };
  };

  it("erreur métier : statut et code conservés, identifiant de corrélation", async () => {
    const r = await call(async () => {
      throw new HttpError(409, "DEJA_TRAITEE", "Déjà traitée.");
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "DEJA_TRAITEE", message: "Déjà traitée." });
    expect(r.body.error!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("validation : 400 avec le détail des champs", async () => {
    const r = await call(async () => {
      z.object({ page: z.number() }).parse({ page: "x" });
      return new Response(null);
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "VALIDATION", issues: [{ path: ["page"], message: expect.any(String) }] });
  });

  it("erreur inattendue : 500 générique, sans message interne", async () => {
    const r = await call(async () => {
      throw new Error("SQLITE_CORRUPT: détail interne");
    });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatchObject({ code: "ERREUR_INTERNE", message: "Erreur inattendue du serveur. Réessayez dans un instant ; si le problème persiste, signalez-le à l'administrateur de l'outil." });
    expect(JSON.stringify(r.body)).not.toContain("SQLITE");
  });

  it("contrôle d'origine sur les méthodes mutantes : origine étrangère 403, même hôte ou proxy accepté, GET libre", async () => {
    const ok = async () => Response.json({ ok: true });
    expect((await call(ok, { method: "POST", headers: { origin: "https://evil.example", host: "app.local" } })).body.error?.code).toBe("ORIGINE_INVALIDE");
    expect((await call(ok, { method: "DELETE", headers: { origin: "https://evil.example", host: "app.local" } })).status).toBe(403);
    expect((await call(ok, { method: "POST", headers: { origin: "http://app.local", host: "app.local" } })).status).toBe(200);
    expect((await call(ok, { method: "PATCH", headers: { origin: "https://pa.example", host: "127.0.0.1:3000", "x-forwarded-host": "pa.example" } })).status).toBe(200);
    expect((await call(ok, { method: "POST", headers: { host: "app.local" } })).status).toBe(200);
    expect((await call(ok, { method: "GET", headers: { origin: "https://evil.example", host: "app.local" } })).status).toBe(200);
  });
});

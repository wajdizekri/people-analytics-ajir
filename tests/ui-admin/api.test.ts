import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { setSetting } from "@/lib/settings";
import { listAlerts } from "@/lib/dal/alerts";
import { getDataHealth } from "@/lib/dal/imports";
import { setupDb, teardownDb } from "./helpers";

const state = vi.hoisted(() => ({ session: null as SessionUser | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  readSession: async () => state.session,
}));

import * as usersRoute from "@/app/api/admin/users/route";
import * as alertsRoute from "@/app/api/alerts/route";
import * as alertRoute from "@/app/api/alerts/[id]/route";
import * as importsRoute from "@/app/api/imports/route";
import * as healthRoute from "@/app/api/health/route";
import * as runRoute from "@/app/api/predictions/run/route";

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("api");
});
afterAll(() => teardownDb(fx.file));

const as = (who: "admin" | "rh" | "mgr" | null) => {
  state.session = who ? { ...fx.ctx[who] } : null;
};
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);
const noParams = { params: Promise.resolve({}) };

describe("/api/admin/users", () => {
  it("401 sans session, 403 pour RH et MANAGER, 200 pour ADMIN", async () => {
    as(null);
    expect((await usersRoute.GET(req("/api/admin/users"), noParams)).status).toBe(401);
    as("rh");
    const res = await usersRoute.GET(req("/api/admin/users"), noParams);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("INTERDIT");
    expect(
      (await usersRoute.POST(req("/api/admin/users", { method: "POST", body: JSON.stringify({ login: "pirate", role: "ADMIN" }) }), noParams)).status,
    ).toBe(403);
    as("mgr");
    expect((await usersRoute.GET(req("/api/admin/users"), noParams)).status).toBe(403);
    as("admin");
    const ok = await usersRoute.GET(req("/api/admin/users"), noParams);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.users.map((u: { login: string }) => u.login)).toContain("rh");
    expect(JSON.stringify(body)).not.toMatch(/password_?hash|token/i);
  });

  it("POST ADMIN : 201, validation 400, origine étrangère 403", async () => {
    as("admin");
    const created = await usersRoute.POST(
      req("/api/admin/users", { method: "POST", body: JSON.stringify({ login: "rh2", role: "RH", email: "rh2@ajir.tn" }) }),
      noParams,
    );
    expect(created.status).toBe(201);
    const bad = await usersRoute.POST(req("/api/admin/users", { method: "POST", body: JSON.stringify({ login: "m", role: "MANAGER" }) }), noParams);
    expect(bad.status).toBe(400);
    const cross = await usersRoute.POST(
      req("/api/admin/users", { method: "POST", body: "{}", headers: { origin: "https://evil.example", host: "localhost" } }),
      noParams,
    );
    expect(cross.status).toBe(403);
  });
});

describe("/api/alerts", () => {
  it("un manager ne reçoit que ses alertes ; PATCH hors périmètre 403, inexistant 404", async () => {
    const { sqlite } = getDb();
    const ins = sqlite.prepare(
      "INSERT INTO alert (type, severity, audience, manager_id, employee_id, title, message, dedup_key) VALUES (?, 'INFO', ?, ?, ?, ?, 'm', ?)",
    );
    const mine = Number(ins.run("TURNOVER", "MANAGER", fx.emp.MGR, fx.emp.E1, "mine", "k1").lastInsertRowid);
    const rhOnly = Number(ins.run("ABSENTEISME", "RH", fx.emp.MGR, fx.emp.E1, "rhOnly", "k2").lastInsertRowid);
    as("mgr");
    const list = await (await alertsRoute.GET(req("/api/alerts"), noParams)).json();
    expect(list.alerts.map((a: { id: number }) => a.id)).toEqual([mine]);
    expect((await alertsRoute.GET(req("/api/alerts?status=INCONNU"), noParams)).status).toBe(400);

    const patch = (id: number | string, body: unknown) =>
      alertRoute.PATCH(req(`/api/alerts/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
    expect((await patch(rhOnly, { status: "EN_COURS" })).status).toBe(403);
    expect((await patch(424242, { status: "EN_COURS" })).status).toBe(404);
    expect((await patch(mine, { status: "REJETEE" })).status).toBe(400);
    const ok = await patch(mine, { status: "EN_COURS" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).alert.status).toBe("EN_COURS");
  });
});

describe("/api/imports, /api/predictions/run, /api/health", () => {
  it("imports : RH lit, MANAGER 403, téléversement réservé à l'ADMIN", async () => {
    as("mgr");
    expect((await importsRoute.GET(req("/api/imports"), noParams)).status).toBe(403);
    as("rh");
    expect((await importsRoute.GET(req("/api/imports"), noParams)).status).toBe(200);
    const form = new FormData();
    form.append("files", new File(["code;name\nPROD;Production\n"], "departments.csv"));
    expect((await importsRoute.POST(req("/api/imports", { method: "POST", body: form }), noParams)).status).toBe(403);
  });

  it("téléversement ADMIN : nom de fichier hors contrat refusé, export valide mis en file", async () => {
    as("admin");
    const badForm = new FormData();
    badForm.append("files", new File(["a;b\n1;2\n"], "salaires.csv"));
    expect((await importsRoute.POST(req("/api/imports", { method: "POST", body: badForm }), noParams)).status).toBe(400);

    const form = new FormData();
    form.append("files", new File(["code;name\nPROD;Production\n"], "departments.csv"));
    form.append("files", new File(["login;matricule;role;email;active\n"], "users.csv"));
    const res = await importsRoute.POST(req("/api/imports", { method: "POST", body: form }), noParams);
    expect(res.status).toBe(202);
    const body = await res.json();
    const job = getDb().sqlite.prepare("SELECT type, status, payload_json FROM app_job WHERE id = ?").get(body.jobId) as {
      type: string;
      status: string;
      payload_json: string;
    };
    expect(job).toMatchObject({ type: "IMPORT", status: "EN_FILE" });
    const dir = JSON.parse(job.payload_json).dir as string;
    const fs = await import("node:fs");
    expect(fs.readdirSync(dir).sort()).toEqual(["departments.csv", "users.csv"]);
    const again = await importsRoute.POST(req("/api/imports", { method: "POST", body: form }), noParams);
    expect(again.status).toBe(409);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("téléversement sans Content-Length (envoi par blocs) : lecture interrompue au-delà du plafond, 413", async () => {
    as("admin");
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 64) c.enqueue(chunk);
        else c.close();
      },
    });
    const res = await importsRoute.POST(
      req("/api/imports", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=x" }, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]),
      noParams,
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("TROP_VOLUMINEUX");
    expect(sent).toBeLessThan(20);
  });

  it("predictions/run : MANAGER 403, RH 202, bloqué (409) si le dernier import est BLOQUE", async () => {
    as("mgr");
    expect((await runRoute.POST(req("/api/predictions/run", { method: "POST" }), noParams)).status).toBe(403);
    as("rh");
    const { sqlite } = getDb();
    const run = (asOf: string) => runRoute.POST(req("/api/predictions/run", { method: "POST", body: JSON.stringify({ asOf }) }), noParams);
    setSetting(sqlite, "data_end_date", "2026-08-31");
    const res = await run("2026-08-31");
    expect(res.status).toBe(202);
    expect((await run("2026-08-15")).status).toBe(400);

    const future = await run("2026-09-30");
    expect(future.status).toBe(409);
    expect((await future.json()).error.code).toBe("MOIS_NON_COUVERT");
    const model = Number(sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('b0-api', 'B0', 'CANDIDAT', 'v1')").run().lastInsertRowid);
    const current = Number(sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status) VALUES ('2026-08-31', ?, 'PUBLIE')").run(model).lastInsertRowid);
    setSetting(sqlite, "current_run_id", String(current));
    const older = await run("2025-01-31");
    expect(older.status).toBe(409);
    expect((await older.json()).error.code).toBe("MOIS_ANTERIEUR");
    setSetting(sqlite, "current_run_id", "");

    sqlite.prepare("UPDATE app_job SET status = 'TERMINE' WHERE type = 'SCORING'").run();
    sqlite.prepare("INSERT INTO import_batch (source, status, finished_at) VALUES ('test', 'BLOQUE', '2026-09-05')").run();
    expect((await runRoute.POST(req("/api/predictions/run", { method: "POST" }), noParams)).status).toBe(409);
  });

  it("health : accessible sans session, sans donnée sensible", async () => {
    as(null);
    const res = await healthRoute.GET(req("/api/health"), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "degrade", database: "ok", worker: { state: "ABSENT", heartbeatAgeSeconds: null }, model: { championLoaded: false } });
  });

  it("heartbeat du worker de plus de 10 min : alerte SYSTEME (ADMIN) créée par /api/health ou /data-health, dédupliquée", async () => {
    as(null);
    const { sqlite } = getDb();
    const systemAlerts = () => sqlite.prepare("SELECT audience, severity, link, dedup_key AS k FROM alert WHERE type = 'SYSTEME' ORDER BY id").all() as { audience: string; k: string }[];
    const beatAgo = (min: number) => {
      const at = new Date(Date.now() - min * 60_000).toISOString();
      setSetting(sqlite, "worker_heartbeat", at);
      return at;
    };
    beatAgo(9);
    expect((await (await healthRoute.GET(req("/api/health"), noParams)).json()).worker.state).toBe("EN_RETARD");
    getDataHealth(fx.ctx.rh);
    expect(systemAlerts()).toEqual([]);

    const first = beatAgo(11);
    const body = await (await healthRoute.GET(req("/api/health"), noParams)).json();
    expect(body.worker.state).toBe("PERIME");
    expect(JSON.stringify(body)).not.toContain("alert");
    await healthRoute.GET(req("/api/health"), noParams);
    expect(getDataHealth(fx.ctx.rh).worker.state).toBe("PERIME");
    expect(systemAlerts()).toEqual([{ audience: "ADMIN", severity: "CRITIQUE", link: "/data-health", k: `systeme:worker-perime:${first}` }]);
    expect(listAlerts(fx.ctx.admin, { type: "SYSTEME" }).map((a) => a.title)).toEqual(["Service de calcul arrêté"]);
    expect(listAlerts(fx.ctx.rh, { type: "SYSTEME" })).toEqual([]);

    const second = beatAgo(30);
    getDataHealth(fx.ctx.admin);
    expect(systemAlerts().map((a) => a.k)).toEqual([`systeme:worker-perime:${first}`, `systeme:worker-perime:${second}`]);
  });
});

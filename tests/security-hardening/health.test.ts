import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { setSetting } from "@/lib/settings";
import * as healthRoute from "@/app/api/health/route";
import { openDalDb } from "../fixtures/unit/dal-world";

// Point 2 : /api/health renvoie 503 si la base est inaccessible ou le worker hors service, avec un corps minimal.
let db: ReturnType<typeof openDalDb>;
beforeAll(() => {
  db = openDalDb("sh-health");
  db.sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('b0-sans-chemin', 'B0', 'CHAMPION', 'v1')").run();
});
afterAll(() => db.close());

const call = async () => {
  const res = await healthRoute.GET(new NextRequest("http://localhost/api/health"), { params: Promise.resolve({}) });
  return { status: res.status, cache: res.headers.get("cache-control"), body: (await res.json()) as Record<string, unknown>, text: "" };
};
const beat = (minutesAgo: number) => setSetting(db.sqlite, "worker_heartbeat", new Date(Date.now() - minutesAgo * 60_000).toISOString());

describe("/api/health", () => {
  it("worker jamais démarré (installation neuve) : 200 dégradé", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "degrade", worker: { state: "ABSENT" } });
  });

  it("tout va bien : 200 ok ; worker en retard (< 10 min) : 200 dégradé", async () => {
    beat(0.5);
    expect(await call()).toMatchObject({ status: 200, cache: "no-store", body: { status: "ok", database: "ok" } });
    beat(5);
    expect(await call()).toMatchObject({ status: 200, body: { status: "degrade", worker: { state: "EN_RETARD" } } });
  });

  it("worker hors service (aucun signal depuis plus de 10 min) : 503, corps sans donnée sensible", async () => {
    beat(11);
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.cache).toBe("no-store");
    expect(Object.keys(r.body).sort()).toEqual(["database", "model", "status", "worker"]);
    expect(r.body).toMatchObject({ database: "ok", worker: { state: "PERIME" } });
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/\.db|data\/|models\/|version|alert|SQLITE|stack/i);
  });

  it("base inaccessible : 503 « erreur », sans détail interne", async () => {
    const g = globalThis as { __paDb?: { sqlite: { close(): void } } };
    g.__paDb!.sqlite.close();
    try {
      const r = await call();
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ status: "erreur", database: "erreur", worker: { state: "ABSENT", heartbeatAgeSeconds: null }, model: { championLoaded: false } });
    } finally {
      g.__paDb = undefined;
    }
  });
});

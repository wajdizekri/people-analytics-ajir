import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { safeInternalLink } from "@/lib/dal/alerts";

// Point 5 (B3 sur base vierge, B4) et point 8 (contrôle d'origine de withApi).
describe("B3 : migration 0006 sur une base vierge", () => {
  let dir: string;
  let sqlite: Database.Database;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-sh-migr-"));
    sqlite = new Database(path.join(dir, "vierge.db"));
    migrate(drizzle(sqlite), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  });
  afterAll(() => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("toutes les migrations passent ; trigger présent ; insertions normales inchangées", () => {
    const triggers = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
    expect(triggers).toEqual(["audit_log_no_delete", "audit_log_no_replace", "audit_log_no_update"]);
    const ins = sqlite.prepare("INSERT INTO audit_log (action, outcome) VALUES (?, 'OK')");
    expect(Number(ins.run("a").lastInsertRowid)).toBe(1);
    expect(Number(ins.run("b").lastInsertRowid)).toBe(2);
    expect(sqlite.prepare("INSERT INTO audit_log (id, action) VALUES (10, 'id-explicite-libre')").run().changes).toBe(1);
  });

  it("id existant refusé quel que soit le verbe (OR REPLACE, REPLACE, OR IGNORE, UPSERT) ; journal intact", () => {
    const before = sqlite.prepare("SELECT id, action FROM audit_log ORDER BY id").all();
    for (const sql of [
      "INSERT OR REPLACE INTO audit_log (id, action) VALUES (1, 'falsifie')",
      "REPLACE INTO audit_log (id, action) VALUES (1, 'falsifie')",
      "INSERT OR IGNORE INTO audit_log (id, action) VALUES (1, 'falsifie')",
      "INSERT INTO audit_log (id, action) VALUES (1, 'falsifie') ON CONFLICT(id) DO UPDATE SET action = excluded.action",
    ]) {
      expect(() => sqlite.prepare(sql).run(), sql).toThrow(/ajout seul/);
    }
    expect(sqlite.prepare("SELECT id, action FROM audit_log ORDER BY id").all()).toEqual(before);
  });
});

describe("B4 : liens d'alerte internes uniquement", () => {
  it("chemins internes conservés tels quels", () => {
    for (const ok of ["/employees/12", "/data-health", "/employees/12?tab=facteurs#reco", "/admin/audit?action=model."]) expect(safeInternalLink(ok)).toBe(ok);
  });

  it("redirections ouvertes et formes ambiguës neutralisées", () => {
    for (const bad of [
      null,
      "",
      "/",
      "//evil.example",
      "/\\evil.example/login",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/ /evil.example",
      "/a\\b",
      "/..//evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example/x",
      "/" + "a".repeat(2001),
    ]) {
      expect(safeInternalLink(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("withApi : contrôle d'origine des mutations", () => {
  const call = async (headers: Record<string, string>) => {
    const res = await withApi<unknown>(async () => NextResponse.json({ ok: true }))(new NextRequest("http://app.local/api/x", { method: "POST", headers }), {});
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: { code: string } } };
  };

  it("Origin « null » ou illisible : 403 ORIGINE_INVALIDE (et non 500)", async () => {
    for (const origin of ["null", "pas une url"]) expect(await call({ origin, host: "app.local" })).toMatchObject({ status: 403, body: { error: { code: "ORIGINE_INVALIDE" } } });
  });

  it("origine étrangère refusée, même origine acceptée", async () => {
    expect((await call({ origin: "https://evil.example", host: "app.local" })).status).toBe(403);
    expect(await call({ origin: "http://app.local", host: "app.local" })).toEqual({ status: 200, body: { ok: true } });
  });
});

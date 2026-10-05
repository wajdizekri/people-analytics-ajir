import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import type { AccessContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { parsePowerBiLink, powerBiSettingKey } from "@/lib/powerbi";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, managerCtx, rhCtx, setupSeededDb } from "../pilotage/setup";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const RH_URL = "https://app.powerbi.com/reportEmbed?reportId=11111111-2222-3333-4444-555555555555&autoAuth=true&ctid=aaaa";
const MGR_URL = "https://app.powerbi.com/reportEmbed?reportId=99999999-8888-7777-6666-555555555555&autoAuth=true&ctid=aaaa";

describe("lien Power BI", () => {
  it("accepte le lien « Site web ou portail » et le code <iframe> complet", () => {
    expect(parsePowerBiLink(`  ${RH_URL}  `)).toEqual({ ok: true, url: RH_URL, kind: "SERVICE" });
    const iframe = `<iframe title="Turnover" width="1140" height="541" src="${RH_URL.replace(/&/g, "&amp;")}" frameborder="0" allowFullScreen="true"></iframe>`;
    expect(parsePowerBiLink(iframe)).toEqual({ ok: true, url: RH_URL, kind: "SERVICE" });
    expect(parsePowerBiLink(`${RH_URL}#section`)).toMatchObject({ ok: true, url: RH_URL });
  });

  it("refuse les liens publics, non intégrables, hors Power BI ou non chiffrés", () => {
    const refused = [
      ["https://app.powerbi.com/view?r=eyJrIjoi", /Publier sur le web/],
      ["https://app.powerbi.com/groups/me/reports/1111/ReportSection", /non intégrable/],
      ["https://app.powerbi.com/reportEmbed?autoAuth=true", /reportId/],
      ["http://app.powerbi.com/reportEmbed?reportId=1", /https/],
      ["https://user:pwd@app.powerbi.com/reportEmbed?reportId=1", /identifiant/],
      ["https://app.powerbi.com.evil.example/reportEmbed?reportId=1", /Origine non autorisée/],
      ["javascript:alert(1)", /https/],
      ["pas un lien", /Lien invalide/],
    ] as const;
    for (const [url, msg] of refused) {
      const r = parsePowerBiLink(url, {});
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.error, url).toMatch(msg);
    }
  });

  it("Report Server sur site : accepté seulement s'il est déclaré, affichage intégré forcé", () => {
    const url = "https://bi.ajir.local/reports/powerbi/RH/Turnover";
    expect(parsePowerBiLink(url, {}).ok).toBe(false);
    const env = { POWERBI_REPORT_SERVER_ORIGIN: "https://bi.ajir.local/" };
    expect(parsePowerBiLink(url, env)).toEqual({ ok: true, url: `${url}?rs:embed=true`, kind: "REPORT_SERVER" });
    expect(parsePowerBiLink(`${url}?rs:embed=true`, env)).toMatchObject({ url: `${url}?rs:embed=true` });
    expect(parsePowerBiLink(url, { POWERBI_REPORT_SERVER_ORIGIN: "http://bi.ajir.local" }).ok).toBe(false);
  });
});

let file = "";
let seed: SeedResult;
let admin: AccessContext;
beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("powerbi"));
  const id = Number(db().prepare("INSERT INTO app_user (login, role, active) VALUES ('admin.pbi', 'ADMIN', 1)").run().lastInsertRowid);
  admin = { userId: id, login: "admin.pbi", role: "ADMIN", employeeId: null };
});
afterAll(() => cleanupDb(file));

const lastAudit = (action: string) =>
  db().prepare("SELECT outcome, target_id AS targetId, detail_json AS detail FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1").get(action) as
    | { outcome: string; targetId: string; detail: string }
    | undefined;

describe("configuration et lecture par rôle", () => {
  it("seul l'ADMIN configure ; refus audité", async () => {
    const { updatePowerBiConfig, getPowerBiConfig } = await import("@/lib/dal/powerbi");
    for (const ctx of [rhCtx(seed), managerCtx(seed)]) {
      expect(() => updatePowerBiConfig(ctx, { RH: RH_URL, MANAGER: "", ADMIN: "" })).toThrow(HttpError);
      expect(() => getPowerBiConfig(ctx)).toThrow(HttpError);
    }
    expect(lastAudit("powerbi.config.update")?.outcome).toBe("REFUSE");
    expect(db().prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key LIKE 'powerbi_url_%'").get()).toEqual({ n: 0 });
  });

  it("lien refusé : rien n'est écrit, l'erreur est rattachée au bon champ", async () => {
    const { updatePowerBiConfig } = await import("@/lib/dal/powerbi");
    const res = updatePowerBiConfig(admin, { RH: RH_URL, MANAGER: "https://app.powerbi.com/view?r=abc", ADMIN: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.fieldErrors)).toEqual(["MANAGER"]);
    expect(db().prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key LIKE 'powerbi_url_%'").get()).toEqual({ n: 0 });
  });

  it("chaque rôle reçoit son propre rapport, jamais celui d'un autre ; ajout, modification et retrait audités", async () => {
    const { updatePowerBiConfig, getPowerBiReport, getPowerBiConfig } = await import("@/lib/dal/powerbi");
    expect(updatePowerBiConfig(admin, { RH: RH_URL, MANAGER: MGR_URL, ADMIN: "" })).toEqual({ ok: true, changed: ["RH", "MANAGER"] });
    expect(JSON.parse(lastAudit("powerbi.config.update")!.detail)).toEqual({ changes: { RH: "AJOUT", MANAGER: "AJOUT" } });

    expect(getPowerBiReport(rhCtx(seed))).toEqual({ role: "RH", url: RH_URL, kind: "SERVICE", invalid: false });
    const mgr = getPowerBiReport(managerCtx(seed));
    expect(mgr.url).toBe(MGR_URL);
    expect(JSON.stringify(mgr)).not.toContain(RH_URL);
    expect(getPowerBiReport(admin)).toMatchObject({ role: "ADMIN", url: null });
    expect(lastAudit("powerbi.view")).toMatchObject({ outcome: "OK", targetId: "ADMIN" });

    expect(updatePowerBiConfig(admin, { RH: RH_URL, MANAGER: "", ADMIN: "" })).toEqual({ ok: true, changed: ["MANAGER"] });
    expect(JSON.parse(lastAudit("powerbi.config.update")!.detail)).toEqual({ changes: { MANAGER: "RETRAIT" } });
    expect(getPowerBiReport(managerCtx(seed)).url).toBeNull();
    expect(getPowerBiConfig(admin).map((r) => [r.role, r.status])).toEqual([["RH", "OK"], ["MANAGER", "ABSENT"], ["ADMIN", "ABSENT"]]);
    expect(updatePowerBiConfig(admin, { RH: RH_URL, MANAGER: "", ADMIN: "" })).toEqual({ ok: true, changed: [] });
  });

  it("un lien stocké devenu non autorisé n'est jamais intégré", async () => {
    const { getPowerBiReport, getPowerBiConfig } = await import("@/lib/dal/powerbi");
    db().prepare("INSERT INTO app_setting (key, value) VALUES (?, ?)").run(powerBiSettingKey("ADMIN"), "https://evil.example/report");
    expect(getPowerBiReport(admin)).toMatchObject({ url: null, invalid: true });
    expect(getPowerBiConfig(admin).find((r) => r.role === "ADMIN")).toMatchObject({ status: "INVALIDE" });
    db().prepare("DELETE FROM app_setting WHERE key = ?").run(powerBiSettingKey("ADMIN"));
  });
});

describe("page /powerbi", () => {
  const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
  const render = async () => html(await (await import("@/app/(app)/powerbi/page")).default());

  it("RH : rapport intégré dans la zone dédiée, avec ses commandes", async () => {
    session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null };
    const m = await render();
    expect(m).toContain(`<iframe src="${RH_URL.replace(/&/g, "&amp;")}" title="Rapport RH"`);
    for (const t of ["Recharger", "Plein écran", "Ouvrir dans Power BI", "Connecté"]) expect(m).toContain(t);
    expect(m).not.toContain("Liens des rapports");
  });

  it("manager sans rapport : espace réservé, sans formulaire ni lien d'un autre rôle", async () => {
    session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId };
    const m = await render();
    expect(m).toContain("Espace du rapport Power BI");
    expect(m).toContain("Lien à ajouter par l&#x27;administrateur");
    expect(m).not.toContain("<iframe");
    expect(m).not.toContain("<form");
    expect(m).not.toContain("reportEmbed");
  });

  it("ADMIN : formulaire des trois liens, sans aperçu des rapports RH ou manager", async () => {
    session.current = { userId: admin.userId, login: "admin.pbi", role: "ADMIN", employeeId: null };
    const m = await render();
    expect(m).toContain("Liens des rapports");
    for (const role of ["RH", "MANAGER", "ADMIN"]) expect(m).toContain(`name="${role}"`);
    expect(m).toContain('href="#liens"');
    expect(m).not.toContain("<iframe");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { getAdminMonitoring } from "@/lib/dal/monitoring";
import { authDailyChart, jobsChart, refusalsChart } from "@/components/monitoring/admin-options";
import { auditRows, setupDb, teardownDb } from "./helpers";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<object>()), readSession: async () => session.current }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("monitoring");
});
afterAll(() => teardownDb(fx.file));

const DAY = 86_400_000;
const utcDay = (offset: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - offset * DAY).toISOString().slice(0, 10);
};
const noon = (offset: number) => `${utcDay(offset)}T12:00:00.000Z`;

function event(offset: number, action: string, outcome: "OK" | "REFUSE", userId: number | null, times = 1) {
  const stmt = getDb().sqlite.prepare("INSERT INTO audit_log (at, user_id, action, outcome) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < times; i++) stmt.run(noon(offset), userId, action, outcome);
}

function job(offset: number, type: string, status: string, durationS: number | null, target: string | null = null) {
  const created = noon(offset);
  const started = durationS == null ? null : created;
  const finished = durationS == null ? null : new Date(Date.parse(created) + durationS * 1000).toISOString();
  getDb()
    .sqlite.prepare("INSERT INTO app_job (type, target, status, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(type, target, status, created, started, finished);
}

describe("getAdminMonitoring : contrôle d'accès", () => {
  it.each(["rh", "mgr"] as const)("%s → 403 audité", (who) => {
    expect(() => getAdminMonitoring(fx.ctx[who])).toThrowError(expect.objectContaining({ status: 403 }));
    const last = auditRows("admin.monitoring").at(-1);
    expect(last).toMatchObject({ user_id: fx.users[who], outcome: "REFUSE" });
  });
});

describe("getAdminMonitoring : séries et comptages", () => {
  it("séries de longueur `days`, jours consécutifs jusqu'à aujourd'hui, jours vides à 0", () => {
    for (const days of [7, 30]) {
      const m = getAdminMonitoring(fx.ctx.admin, days);
      expect(m.daily).toHaveLength(days);
      expect(m.from).toBe(utcDay(days - 1));
      expect(m.to).toBe(utcDay(0));
      expect(m.daily.map((d) => d.date)).toEqual(Array.from({ length: days }, (_, i) => utcDay(days - 1 - i)));
      for (const d of m.daily.slice(0, -1)) expect(d).toEqual({ date: d.date, logins: 0, failedLogins: 0, refusals: 0 });
    }
    expect(getAdminMonitoring(fx.ctx.admin).daily).toHaveLength(30);
  });

  it("compte les événements insérés par jour, sur 7 j glissants et par action", () => {
    const { admin, rh, mgr } = fx.users;
    event(2, "auth.login", "OK", rh, 3);
    event(2, "auth.login", "REFUSE", mgr);
    event(2, "employee.view", "REFUSE", mgr, 2);
    event(2, "settings.update", "REFUSE", rh);
    event(2, "user.create", "OK", admin);
    event(9, "auth.login", "OK", rh, 2);
    event(9, "employee.view", "REFUSE", mgr);
    event(40, "auth.login", "OK", rh, 5);
    event(40, "export.csv", "REFUSE", mgr, 4);
    const refusedToday = auditRows("admin.monitoring").filter((r) => r.outcome === "REFUSE").length;

    const m = getAdminMonitoring(fx.ctx.admin, 30);
    const at = (offset: number) => m.daily.find((d) => d.date === utcDay(offset));
    expect(at(2)).toEqual({ date: utcDay(2), logins: 3, failedLogins: 1, refusals: 3 });
    expect(at(9)).toEqual({ date: utcDay(9), logins: 2, failedLogins: 0, refusals: 1 });
    expect(at(5)).toEqual({ date: utcDay(5), logins: 0, failedLogins: 0, refusals: 0 });
    expect(at(0)?.refusals).toBe(refusedToday);
    expect(m.daily.reduce((s, d) => s + d.logins, 0)).toBe(5);

    expect(m.week).toEqual({
      logins: { current: 3, previous: 2 },
      failedLogins: { current: 1, previous: 0 },
      refusals: { current: 3 + refusedToday, previous: 1 },
    });
    expect(m.refusalsByAction).toEqual([
      { action: "employee.view", count: 3 },
      { action: "admin.monitoring", count: refusedToday },
      { action: "settings.update", count: 1 },
    ]);
    expect(auditRows("admin.monitoring").filter((r) => r.user_id === admin)).toHaveLength(0);
  });

  it("jobs par type et statut sur la fenêtre, durée moyenne des jobs terminés", () => {
    job(1, "IMPORT", "TERMINE", 30);
    job(3, "IMPORT", "TERMINE", 90);
    job(1, "SCORING", "ECHEC", 5);
    job(0, "SCORING", "EN_FILE", null, "2026-08");
    job(45, "ANOMALIES", "TERMINE", 10);
    const { jobs } = getAdminMonitoring(fx.ctx.admin, 30);
    expect(jobs).toEqual([
      { type: "IMPORT", counts: { EN_FILE: 0, EN_COURS: 0, TERMINE: 2, ECHEC: 0 }, total: 2, avgDurationSeconds: 60 },
      { type: "SCORING", counts: { EN_FILE: 1, EN_COURS: 0, TERMINE: 0, ECHEC: 1 }, total: 2, avgDurationSeconds: null },
    ]);
  });
});

describe("options ECharts et page /admin", () => {
  it("visuels sérialisables (aucune fonction), construits depuis le DTO", () => {
    const m = getAdminMonitoring(fx.ctx.admin, 30);
    const specs = [authDailyChart(m.daily), refusalsChart(m.refusalsByAction), jobsChart(m.jobs)];
    for (const s of specs) expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const series = jobsChart(m.jobs).option.series as { name: string; data: { value: number }[] }[];
    const values = (name: string) => series.find((s) => s.name === name)?.data.map((d) => d.value);
    expect(values("Terminé")).toEqual([2, 0]);
    expect(values("En file ou en cours")).toEqual([0, 1]);
    expect(values("Échec")).toEqual([0, 1]);
  });

  it("rendu ADMIN sans donnée RH nominative ; RH redirigé", async () => {
    const Page = (await import("@/app/(app)/admin/page")).default;
    session.current = { userId: fx.users.admin, login: "admin", role: "ADMIN", employeeId: null } as SessionUser;
    const html = renderToStaticMarkup((await Page()) as ReactElement);
    for (const text of ["Console d&#x27;administration", "Connexions par jour", "Refus d&#x27;accès par action", "Comptes actifs par rôle", "Derniers refus d&#x27;accès", "/admin/audit?outcome=REFUSE"])
      expect(html).toContain(text);
    expect(html).not.toMatch(/Nom (DG|MGR|E\d)/);
    session.current = { userId: fx.users.rh, login: "rh", role: "RH", employeeId: null } as SessionUser;
    await expect(Page()).rejects.toThrow("REDIRECT:/interdit");
  });
});

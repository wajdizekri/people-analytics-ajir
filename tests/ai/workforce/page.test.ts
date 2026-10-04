import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { runStep } from "@/lib/ai/workforce/step";
import type { SeedResult } from "../../../scripts/seed-dev-ui";
import { cleanupDb, db, setupWorkforceDb } from "./setup";

// Rendu serveur de /previsions sans runtime Next (mêmes substitutions que les tests de pages de pilotage)
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

let file = "";
let seed: SeedResult;
beforeAll(async () => {
  ({ file, seed } = await setupWorkforceDb("page"));
  runStep(db(), "2026-08-31");
});
afterAll(() => cleanupDb(file));

const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const page = async () => (await import("@/app/(app)/previsions/page")).default;

describe("page /previsions", () => {
  it("RH : projection de référence, graphiques, tableau par département, recommandations et mention indicative", async () => {
    session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null };
    const html = renderToStaticMarkup((await (await page())(sp())) as ReactElement);
    expect(html).toContain("Projection indicative");
    expect(html).toContain("Effectif observé et projeté à 12 mois");
    expect(html).toContain("Masse salariale brute observée et projetée");
    expect(html).toContain("Projection par département");
    expect(html).toContain("Recommandations RH");
    expect(html).toContain('name="embauches"');
    expect(html).toMatch(/Effectif prévu dans 12 mois : <strong[^>]*>[\d\s ]+<\/strong> \(fourchette /);
    expect(html).toContain("Recalculer la projection");
    expect(html).toContain("Fourchette probable à 80 %");
    for (const code of (db().prepare("SELECT code FROM department").all() as { code: string }[]).map((d) => d.code)) expect(html).toContain(code);
  });

  it("RH : un scénario modifié est signalé et comparé au scénario de référence", async () => {
    session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null };
    const html = renderToStaticMarkup((await (await page())(sp({ embauches: "50", hausse: "3" }))) as ReactElement);
    expect(html).toContain("scénario simulé : embauches à 50 % du rythme");
  });

  it("MANAGER et ADMIN sont redirigés vers /interdit", async () => {
    for (const current of [
      { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER" as const, employeeId: seed.managerEmployeeId },
      { userId: seed.rhUserId, login: "admin.demo", role: "ADMIN" as const, employeeId: null },
    ]) {
      session.current = current;
      await expect((await page())(sp())).rejects.toThrow("REDIRECT:/interdit");
    }
  });
});

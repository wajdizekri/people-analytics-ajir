import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { cleanupFixture, createFixture, type Fixture } from "../retention/fixture";

// Page Rétention complète (sans runtime Next) : la section « Profils de départs » n'apparaît que pour la RH
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

let fx: Fixture;
beforeAll(() => {
  fx = createFixture("typologie-page");
});
afterAll(() => cleanupFixture(fx.file));

const as = (role: "RH" | "MANAGER", employeeId: number | null = null) => (session.current = { userId: 9, login: `${role.toLowerCase()}.test`, role, employeeId } as SessionUser);
const render = async (params: Record<string, string> = {}) => {
  const Page = (await import("@/app/(app)/retention/page")).default;
  return renderToStaticMarkup((await Page({ searchParams: Promise.resolve(params) })) as ReactElement);
};

describe("page Rétention : section Profils de départs", () => {
  it("RH : section présente après les courbes ; base sans variables à la veille du départ : état vide explicite", async () => {
    as("RH");
    const html = await render();
    expect(html).toContain('id="profils-departs"');
    expect(html.indexOf("Courbe de maintien en escalier")).toBeLessThan(html.indexOf('id="profils-departs"'));
    expect(html).toContain("Trop peu de départs volontaires pour décrire des profils");
    expect(html).toContain("0 départ classé · 30 requis");
  });

  it("manager : aucune section Profils de départs", async () => {
    as("MANAGER", fx.ids.M);
    const html = await render({ segment: "departement" });
    expect(html).toContain("Votre périmètre");
    expect(html).not.toContain("Profils de départs");
    expect(html).not.toContain("profils-departs");
  });
});

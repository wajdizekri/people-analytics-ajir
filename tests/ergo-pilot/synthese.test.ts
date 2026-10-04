import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { createFixture, destroyFixture, type Fixture } from "../insights/fixture";

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
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

let f: Fixture;
beforeAll(() => {
  f = createFixture("ergo-pilot");
});
afterAll(() => destroyFixture(f));

const as = (role: "RH" | "MANAGER") =>
  (session.current = { userId: role === "RH" ? f.users.rh : f.users.manager, login: role.toLowerCase(), role, employeeId: role === "MANAGER" ? f.ids.R : null } as SessionUser);
const render = async () => renderToStaticMarkup((await (await import("@/app/(app)/synthese/page")).default()) as ReactElement);

describe("synthèse du mois", () => {
  it("listes nominatives : la fiche s'ouvre avec un retour vers la liste de la synthèse", async () => {
    as("RH");
    const out = await render();
    expect(out).toMatch(/href="\/employees\/\d+\?retour=%2Fsynthese%23nouveaux-eleves"/);
    expect(out).not.toMatch(/href="\/employees\/\d+"/);
  });

  it("ordre de lecture et actions : priorités avant chiffres clés, impression et tableau de bord en tête, cartes reliées à leur détail", async () => {
    as("RH");
    const out = await render();
    expect(out.indexOf("Imprimer la synthèse")).toBeLessThan(out.indexOf("À traiter en priorité"));
    expect(out.indexOf("À traiter en priorité")).toBeLessThan(out.indexOf("Chiffres clés"));
    expect(out).toContain('href="/dashboard"');
    expect(out).toContain("Voir la liste (tous contrats)");
    expect(out).toContain('href="/employees?retour=%2Fsynthese"');
    // titres seuls : ni encart d'explication, mention de traçabilité en pastille
    expect(out).not.toContain("page-intro-titre");
    expect(out).toContain("Consultation tracée");
  });

  it("manager : retour vers la synthèse aussi, ni probabilité ni rémunération, rappel des groupes masqués", async () => {
    as("MANAGER");
    const out = await render();
    expect(out).not.toMatch(/TND|Probabilité (à|6)|Masse salariale/i);
    expect(out).not.toMatch(/href="\/employees\/\d+"/);
    expect(out).toContain("Petits groupes masqués");
    expect(out).toContain("groupe de moins de 5 personnes");
  });
});

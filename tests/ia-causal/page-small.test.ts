import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getMatchedComparison } from "@/lib/dal/intervention-impact";
import { INSUFFICIENT_LABEL, MATCHING_TITLE } from "@/app/(app)/interventions/matched-comparison";
import { createFixture, ctxOf, destroyFixture, type Fixture } from "../insights/fixture";

// Petite base des tests insights (un entretien, un plan de formation) : la section s'affiche avec « effectif insuffisant »
// pour chaque type, sans aucun chiffre d'écart ni de fourchette.

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
  f = createFixture("causal-small");
});
afterAll(() => destroyFixture(f));

const text = (el: unknown) =>
  renderToStaticMarkup(el as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

describe("petits effectifs", () => {
  it("DAL : chaque type sous le seuil, aucun chiffre", () => {
    const d = getMatchedComparison(ctxOf(f).rh);
    expect(d.actions.map((a) => [a.actionCode, a.status, a.actions])).toEqual([
      ["ENTRETIEN", "INSUFFISANT", 1],
      ["PLAN_FORMATION", "INSUFFISANT", 1],
    ]);
    for (const a of d.actions) for (const o of a.outcomes) expect([o.diff, o.low, o.high, o.treatedRate, o.naiveDiff]).toEqual([null, null, null, null, null]);
  });

  it("page RH : section affichée, effectif insuffisant, avant / après inchangé", async () => {
    session.current = { userId: f.users.rh, login: "rh.test", role: "RH", employeeId: null } as SessionUser;
    const page = (await import("@/app/(app)/interventions/page")).default;
    const s = text(await page({ searchParams: Promise.resolve({}) }));
    expect(s).toContain(MATCHING_TITLE);
    expect(s).toContain(INSUFFICIENT_LABEL);
    expect(s).toMatch(/\/ 20 (paires|requis)/);
    expect(s).not.toContain("Écart : ");
    expect(s).toContain("Observation non causale");
    expect(s).toContain("Avant / après par type d'action");
    expect(s).not.toMatch(/évit/i);
  });
});

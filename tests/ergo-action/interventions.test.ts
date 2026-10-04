import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getEmployeeInterventionEffects } from "@/lib/dal/interventions";
import { InterventionEffects } from "@/components/insights";
import { createFixture, ctxOf, destroyFixture, meta, type Fixture } from "../insights/fixture";

// Interventions : avant / après lisible (sens écrit, pas seulement coloré), états vides utiles, pluriels accordés
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
  f = createFixture("ergo-action");
});
afterAll(() => destroyFixture(f));

const asRh = () => (session.current = { userId: f.users.rh, login: "rh", role: "RH", employeeId: null } as SessionUser);
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const text = (el: unknown) =>
  renderToStaticMarkup(el as ReactElement)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("interventions : lisibilité avant / après", () => {
  it("écarts collaborateur par collaborateur avec leur sens en mots ; pluriels accordés", async () => {
    asRh();
    const page = (await import("@/app/(app)/interventions/page")).default;
    const el = await page(sp());
    expect(renderToStaticMarkup(el as ReactElement)).toContain(`href="/employees/${f.ids.B1}?retour=%2Finterventions"`);
    const s = text(el);
    expect(s).toMatch(/pt, en baisse/);
    expect(s).toMatch(/h, en baisse/);
    expect(s).toContain("1 / 1 mesuré");
    expect(s).not.toContain("(s)");
    expect(s).toContain("Recul complet (3 mois)");
    expect(s).toContain("Recul partiel : 0 mois sur 3");
    for (const k of ["Observation non causale", "Avant / après par type d'action", "Toutes les actions"]) expect(s).toContain(k);
  });

  it("type d'action sans réalisation : titre seul et bouton pour tout afficher", async () => {
    asRh();
    const page = (await import("@/app/(app)/interventions/page")).default;
    const s = text(await page(sp({ action: "CHARGE_TRAVAIL" })));
    expect(s).toContain("Aucune action réalisée de ce type");
    expect(s).not.toContain("Aucune recommandation de ce type n'a encore été marquée « réalisée ».");
    expect(s).toContain("Afficher tous les types d'action");
  });

  it("fiche : avertissement de causalité en note neutre (même ton que la page Interventions)", () => {
    const m = renderToStaticMarkup(createElement(InterventionEffects, { data: getEmployeeInterventionEffects(ctxOf(f).rh, f.ids.B1, meta) }) as ReactElement);
    expect(m).toContain("Observation, pas un effet causal");
    expect(m).not.toContain("bg-warning-soft");
  });
});

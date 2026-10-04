import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { runStep } from "@/lib/ai/training/step";
import { REF } from "../fixtures/unit/dal-world";
import { promoteBundle, trainingWorld } from "../ai/training/world";

// /formations : accès direct à la fiche depuis les deux tableaux du détail, pour la RH comme pour le manager (sa hiérarchie)
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh: () => undefined }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

let world: ReturnType<typeof trainingWorld>;
beforeAll(() => {
  world = trainingWorld("ergo-ia-formations");
  promoteBundle(world.db.sqlite);
  runStep(world.db.sqlite, REF);
});
afterAll(() => world.db.close());

const render = async () => {
  const Page = (await import("@/app/(app)/formations/page")).default;
  return renderToStaticMarkup((await Page()) as ReactElement);
};
const as = (k: "rh" | "mgr") => (session.current = world.w.ctx[k] as SessionUser);
const AT_RISK = /href="\/employees\/\d+\?retour=%2Fformations%23a-risque"/;
const LATE = /href="\/employees\/\d+\?retour=%2Fformations%23retards"/;

describe("/formations : liens vers la fiche", () => {
  it("RH : formations à risque et en retard mènent à la fiche, retour à la section", async () => {
    as("rh");
    const m = await render();
    expect(m).toMatch(AT_RISK);
    expect(m).toMatch(LATE);
  });

  it("manager : mêmes liens pour sa hiérarchie, sans probabilité ; sous-titres avec le périmètre", async () => {
    as("mgr");
    const m = await render();
    expect(m).toMatch(AT_RISK);
    expect(m).toMatch(LATE);
    expect(m).not.toMatch(/Probabilit/);
    expect(m).toContain("par mois d&#x27;échéance (nombre) · Votre équipe");
  });
});

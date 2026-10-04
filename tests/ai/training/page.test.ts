import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { runStep } from "@/lib/ai/training/step";
import { REF } from "../../fixtures/unit/dal-world";
import { promoteBundle, trainingWorld } from "./world";

// Rendu serveur de /formations sans runtime Next (même approche que tests/ai/workload/page.test.ts)
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh: () => undefined }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

let world: ReturnType<typeof trainingWorld>;
beforeAll(() => {
  world = trainingWorld("ai-training-page");
  promoteBundle(world.db.sqlite);
  runStep(world.db.sqlite, REF);
});
afterAll(() => world.db.close());

const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = async () => {
  const Page = (await import("@/app/(app)/formations/page")).default;
  return renderToStaticMarkup((await Page()) as ReactElement);
};
const as = (k: "rh" | "mgr" | "admin") => (session.current = world.w.ctx[k] as SessionUser);

describe("page /formations", () => {
  it("RH : synthèse, verdict, indicateurs, visuels, relances avec boutons verbe + objet, probabilité estimée", async () => {
    as("rh");
    const t = text(await render());
    expect(t).toContain("Risque de retard des formations");
    expect(t).toMatch(/Relances urgentes|Relances à prévoir|Retards à rattraper|Dans les temps/);
    for (const s of ["Formations à risque", "Déjà en retard", "Échéances à venir", "Réalisées à l'échéance", "Relances proposées", "Probabilité estimée", "Estimation, pas un constat"])
      expect(t).toContain(s);
    expect(t).toContain("Marquer comme réalisée");
    expect(t).toContain("Rejeter la recommandation");
    expect(t).not.toMatch(/\bEnregistrer\b/);
  });

  it("manager : son équipe, niveau et catégories de facteurs, jamais de probabilité", async () => {
    as("mgr");
    const t = text(await render());
    expect(t).toContain("Votre équipe");
    expect(t).toContain("Catégories de facteurs");
    expect(t).not.toMatch(/Probabilit/);
  });

  it("ADMIN : redirigé vers /interdit", async () => {
    as("admin");
    await expect(render()).rejects.toThrow("REDIRECT:/interdit");
  });
});

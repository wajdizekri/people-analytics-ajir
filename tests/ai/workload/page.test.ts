import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { runStep } from "@/lib/ai/workload/step";
import { AS_OF, cleanupWorkloadDb, setupWorkloadDb, type Fixture } from "./setup";

// Rendu serveur de /charge sans runtime Next (même approche que tests/pilotage/pages.test.ts)
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

let fx: Fixture;
beforeAll(() => {
  fx = setupWorkloadDb("page");
});
afterAll(() => cleanupWorkloadDb(fx.file));

const render = async () => {
  const Page = (await import("@/app/(app)/charge/page")).default;
  return renderToStaticMarkup((await Page()) as ReactElement);
};
const nameOf = (id: number) => (getDb().sqlite.prepare("SELECT first_name || ' ' || last_name AS n FROM employee WHERE id = ?").get(id) as { n: string }).n;

describe("page /charge", () => {
  it("affiche un état vide tant qu'aucune prévision n'a été calculée", async () => {
    session.current = { userId: 1, login: "rh", role: "RH", employeeId: null };
    expect(await render()).toContain("Aucune prévision de charge disponible");
  });

  it("RH : départements, équipes en tension, surcharges individuelles et recommandations modifiables", async () => {
    runStep(getDb().sqlite, AS_OF);
    session.current = { userId: 1, login: "rh", role: "RH", employeeId: null };
    const html = await render();
    expect(html).toContain("Quelles équipes sont en surcharge ?");
    expect(html).toContain("prévu sur 3 mois, par département");
    expect(html).toContain("Direction A");
    expect(html).toContain("Surcharges individuelles soutenues");
    expect(html).toContain(nameOf(fx.overloaded));
    expect(html).not.toContain(nameOf(fx.opposed));
    expect(html).toContain("Marquer comme réalisée");
    expect(html).toContain("Rejeter la recommandation");
    expect(html).toContain("Tension");
  });

  it("MANAGER : équipes agrégées et recommandations collectives seulement", async () => {
    session.current = { userId: 3, login: "mgr", role: "MANAGER", employeeId: fx.head };
    const html = await render();
    expect(html).toContain("Vos équipes sont-elles en surcharge ?");
    expect(html).toContain("Recommandations pour vos équipes");
    expect(html).not.toContain("Surcharges individuelles");
    expect(html).not.toContain(nameOf(fx.overloaded));
    expect(html).toContain("non affichée(s)");
  });

  it("ADMIN : redirigé vers /interdit", async () => {
    session.current = { userId: 2, login: "admin", role: "ADMIN", employeeId: null };
    await expect(render()).rejects.toThrow("REDIRECT:/interdit");
  });
});

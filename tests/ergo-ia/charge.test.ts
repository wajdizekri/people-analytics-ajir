import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { runStep } from "@/lib/ai/workload/step";
import { AS_OF, cleanupWorkloadDb, setupWorkloadDb, type Fixture } from "../ai/workload/setup";

// /charge : sous-titre avec périmètre et horizon, incertitude des prévisions signalée côté manager
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

let fx: Fixture;
beforeAll(() => {
  fx = setupWorkloadDb("ergo-ia");
  runStep(getDb().sqlite, AS_OF);
});
afterAll(() => cleanupWorkloadDb(fx.file));

const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const render = async () => {
  const Page = (await import("@/app/(app)/charge/page")).default;
  return text(renderToStaticMarkup((await Page()) as ReactElement));
};

describe("/charge", () => {
  it("RH : le visuel des équipes dit son périmètre et son horizon", async () => {
    session.current = { userId: 1, login: "rh", role: "RH", employeeId: null };
    expect(await render()).toMatch(/par équipe désignée par son manager · toute l'entreprise, d'ici \S+ \d{4}/);
  });

  it("manager : fourchette probable à 80 % mentionnée, équipe la plus chargée qualifiée en mots", async () => {
    session.current = { userId: 3, login: "mgr", role: "MANAGER", employeeId: fx.head };
    const t = await render();
    expect(t).toMatch(/[Ff]ourchette probable à 80 %/);
    if (t.includes("Équipe la plus chargée")) expect(t).toMatch(/Équipe la plus chargée.*(Sous le seuil|Tension probable|Tension possible)/);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { runStep as runWorkload } from "@/lib/ai/workload/step";
import { runStep as runWorkforce } from "@/lib/ai/workforce/step";
import { AS_OF, cleanupWorkloadDb, setupWorkloadDb, type Fixture } from "../ai/workload/setup";
import { cleanupDb, setupWorkforceDb } from "../ai/workforce/setup";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { conformalDir } from "./helpers";

// Rendu serveur de /charge et /previsions avec les versions calibrées (enregistrées par les mêmes bases de test que
// tests/ai) : la phrase de couverture apparaît sous les prévisions, pour la RH comme pour le manager.
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh: () => undefined }));
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

const PHRASE = /Fourchette calibrée : sur les \d+ derniers mois de test, [\d,]+ % des valeurs observées y sont tombées/;
const count = (html: string) => html.match(new RegExp(PHRASE.source, "g"))?.length ?? 0;

describe.skipIf(!conformalDir("workload", "workload-"))("/charge avec la version calibrée", () => {
  let fx: Fixture;
  beforeAll(() => {
    fx = setupWorkloadDb("conforme");
    runWorkload(getDb().sqlite, AS_OF);
  });
  afterAll(() => cleanupWorkloadDb(fx.file));
  const render = async () => renderToStaticMarkup((await (await import("@/app/(app)/charge/page")).default()) as ReactElement);

  it("RH : une phrase sous les équipes et une sous les départements", async () => {
    session.current = { userId: 1, login: "rh", role: "RH", employeeId: null };
    const html = await render();
    expect(count(html)).toBe(2);
    expect(html).toContain("Définition : Fourchette calibrée");
  });

  it("MANAGER : une phrase sous le graphique de ses équipes", async () => {
    session.current = { userId: 3, login: "mgr", role: "MANAGER", employeeId: fx.head };
    expect(count(await render())).toBe(1);
  });
});

describe.skipIf(!conformalDir("workforce", "effectif-") || !conformalDir("workforce", "masse-"))("/previsions avec les versions calibrées", () => {
  let file = "";
  let seed: SeedResult;
  beforeAll(async () => {
    ({ file, seed } = await setupWorkforceDb("conforme"));
    runWorkforce(getDb().sqlite, "2026-08-31");
  });
  afterAll(() => cleanupDb(file));
  const render = async (q: Record<string, string> = {}) =>
    renderToStaticMarkup((await (await import("@/app/(app)/previsions/page")).default({ searchParams: Promise.resolve(q) })) as ReactElement);

  it("une phrase sous l'effectif et une sous la masse salariale ; scénario simulé signalé", async () => {
    session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null };
    const html = await render();
    expect(count(html)).toBe(2);
    expect(html).not.toContain("Mesure faite pour le scénario de référence.");
    expect(await render({ embauches: "50" })).toContain("Mesure faite pour le scénario de référence.");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { runStep } from "@/lib/ai/workforce/step";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, setupWorkforceDb } from "../ai/workforce/setup";

// Rendu serveur de /previsions et /absenteeism (base de démonstration + modèles d'effectif) : messages, sous-titres et tableaux de données
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {} }),
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
  ({ file, seed } = await setupWorkforceDb("ergo-ia"));
  runStep(db(), "2026-08-31");
});
afterAll(() => cleanupDb(file));

const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const asRh = () => (session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
const asManager = () => (session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId });

describe("/previsions", () => {
  it("valeur de scénario invalide : nom en clair, plage admise et marche à suivre", async () => {
    asRh();
    const Page = (await import("@/app/(app)/previsions/page")).default;
    const t = text(renderToStaticMarkup((await Page(sp({ embauches: "999" }))) as ReactElement));
    expect(t).toContain("Hypothèse non prise en compte");
    expect(t).toContain("rythme des embauches (de 0 à 300 %)");
    expect(t).toContain("Corrigez la valeur dans « Tester un autre scénario »");
    expect(t).not.toMatch(/invalides? : embauches/);
  });

  it("« Voir les données » reprend toutes les séries du graphique (observé, projection, fourchette, référence si simulé)", async () => {
    asRh();
    const Page = (await import("@/app/(app)/previsions/page")).default;
    const ref = renderToStaticMarkup((await Page(sp())) as ReactElement);
    expect(ref).toContain("Effectif observé et projeté par mois");
    expect(ref).toMatch(/<th[^>]*>Observé<\/th>/);
    expect(ref).toContain("Fourchette probable à 80 % : basse");
    expect(ref).not.toMatch(/<th[^>]*>Scénario de référence<\/th>/);
    const sim = renderToStaticMarkup((await Page(sp({ embauches: "50" }))) as ReactElement);
    expect(sim).toMatch(/<th[^>]*>Scénario de référence<\/th>/);
  });
});

describe("/absenteeism", () => {
  it("RH : sous-titres des visuels avec la période, variation du taux avec sa référence", async () => {
    asRh();
    const Page = (await import("@/app/(app)/absenteeism/page")).default;
    const t = text(renderToStaticMarkup((await Page(sp({ granularite: "mois" }))) as ReactElement));
    expect(t).toMatch(/Taux d'absence par mois \(% des jours ouvrables\) · .+ · \d+ derniers mois/);
    expect(t).toContain("vs les mois précédents");
  });

  it("manager : jamais de signal individuel", async () => {
    asManager();
    const Page = (await import("@/app/(app)/absenteeism/page")).default;
    const t = text(renderToStaticMarkup((await Page(sp())) as ReactElement));
    expect(t).not.toContain("Signaux individuels");
    expect(t).toContain("est-il sous contrôle ?");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getTeams } from "@/lib/dal/teams";
import { reasonSentence, tensionReasons } from "@/components/insights/teams";
import { createFixture, ctxOf, destroyFixture, meta, type Fixture } from "./fixture";

// Écrans Équipes et Interventions : raison du niveau de tension en mots, lecture de la carte, avant / après lisible
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
  f = createFixture("teams-ui");
});
afterAll(() => destroyFixture(f));

const as = (role: "RH" | "MANAGER") =>
  (session.current = { userId: role === "RH" ? f.users.rh : f.users.manager, login: role.toLowerCase(), role, employeeId: role === "MANAGER" ? f.ids.R : null } as SessionUser);
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const text = (el: unknown) =>
  renderToStaticMarkup(el as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("équipes : raison du niveau en mots", () => {
  it("une phrase par signal, avec la valeur de l'équipe", () => {
    const t = getTeams(ctxOf(f).rh, {}, meta);
    const r = t.teams.find((x) => x.managerId === f.ids.R)!;
    const s = reasonSentence(tensionReasons(r, t.total, "entreprise"));
    expect(s).toBe("3 collaborateurs sur 6 en risque de départ élevé ou moyen (dont 2 élevé) ; 2 recommandations en attente de décision.");
    expect(reasonSentence([])).toBe("Aucun signal de difficulté.");
  });

  it("RH : tableau trié avec la colonne « Pourquoi » et carte expliquée", async () => {
    as("RH");
    const page = (await import("@/app/(app)/equipes/page")).default;
    const s = text(await page(sp()));
    expect(s).toContain("Équipes triées par niveau de tension");
    expect(s).toContain("Pourquoi");
    expect(s).toContain("2 recommandations en attente de décision");
    expect(s).toContain("Comment lire la carte : 1 rectangle = 1 équipe · surface = effectif · couleur = niveau de tension");
    expect(s).toContain("3 équipes sur 3 présentent au moins un signal de difficulté");
  });

  it("MANAGER : indicateurs masqués, aucune rémunération", async () => {
    as("MANAGER");
    const page = (await import("@/app/(app)/equipes/page")).default;
    const s = text(await page(sp()));
    expect(s).toContain("Mes équipes");
    expect(s).toContain("Masqué");
    expect(s).not.toMatch(/TND|Masse salariale|Probabilité/);
  });
});

describe("interventions : avant / après lisible", () => {
  it("RH : avertissement sobre, statut des recommandations et effets par type d'action", async () => {
    as("RH");
    const page = (await import("@/app/(app)/interventions/page")).default;
    const s = text(await page(sp()));
    expect(s).toContain("Observation, pas un effet causal.");
    expect(s).toContain("Statut des recommandations par type d'action");
    expect(s).toContain("Ce qui change après l'action, par type d'action");
    expect(s).toContain("Entretien de rétention");
    expect(s).toContain("Niveau en baisse");
  });
});

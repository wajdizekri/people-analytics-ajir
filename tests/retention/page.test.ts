import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { cleanupFixture, createFixture, type Fixture } from "./fixture";

// Rendu serveur de la page (sans runtime Next) : liens, formulaire et graphique remplacés par des éléments simples
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
}));

let fx: Fixture;
beforeAll(() => {
  fx = createFixture("page");
});
afterAll(() => cleanupFixture(fx.file));

const as = (role: "RH" | "MANAGER" | "ADMIN", employeeId: number | null = null) => (session.current = { userId: 9, login: `${role.toLowerCase()}.test`, role, employeeId } as SessionUser);
const render = async (params: Record<string, string> = {}) => {
  const Page = (await import("@/app/(app)/retention/page")).default;
  return renderToStaticMarkup((await Page({ searchParams: Promise.resolve(params) })) as ReactElement);
};

describe("page Rétention", () => {
  it("ADMIN redirigé vers /interdit", async () => {
    as("ADMIN");
    await expect(render()).rejects.toThrow("REDIRECT:/interdit");
  });

  it("RH : réponse, 4 indicateurs, courbe, encarts Comment lire et Limites", async () => {
    as("RH");
    const html = await render();
    for (const s of ["Quelle part des embauchés est encore là ?", "Rétention à 12 mois", "Rétention à 24 mois", "Durée médiane de présence", "Embauches suivies", "Comment lire", "Limites"])
      expect(html).toContain(s);
    expect(html).toContain("Toute l&#x27;entreprise — 24 embauches suivies");
    expect(html).toContain("L&#x27;historique AJIR commence le 01/01/2024. 4 collaborateurs embauchés avant ne sont pas suivis");
    expect(html).toContain("Courbe de maintien en escalier");
    expect(html).toContain('name="mode"');
    expect(html).toContain('name="segment"');
  });

  it("RH par département, départs volontaires : détail par groupe, log-rank, mention des risques concurrents", async () => {
    as("RH");
    const html = await render({ segment: "departement", mode: "volontaires" });
    expect(html).toContain("Détail par département");
    expect(html).toContain("Test du log-rank");
    expect(html).toContain("Moins de 5 personnes suivies");
    expect(html).toContain("risques concurrents");
  });

  it("manager : groupes masqués signalés ; équipe trop petite : état vide explicite ; paramètre invalide signalé", async () => {
    as("MANAGER", fx.ids.M);
    const html = await render({ segment: "departement" });
    expect(html).toContain("Votre périmètre — 15 embauches suivies");
    expect(html).toContain("2 groupes ne sont pas affichés");
    expect(html).toContain("Non affiché : petit groupe");
    as("MANAGER", fx.ids.Z);
    const small = await render({ segment: "xx" });
    expect(small).toContain("Périmètre trop petit pour une courbe de maintien");
    expect(small).toContain("invalide(s) ignoré(s) : segment");
  });
});

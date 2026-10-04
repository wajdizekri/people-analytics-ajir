import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { getEmployeeJourney, getEmployeeNews } from "@/lib/dal/synthesis";
import { getEmployeeInterventionEffects } from "@/lib/dal/interventions";
import { InterventionEffects, Journey, WhatsNew } from "@/components/insights";
import { createFixture, ctxOf, destroyFixture, meta, type Fixture } from "./fixture";

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
  f = createFixture("pages");
});
afterAll(() => destroyFixture(f));

const as = (role: "RH" | "ADMIN" | "MANAGER") =>
  (session.current = {
    userId: role === "RH" ? f.users.rh : role === "ADMIN" ? f.users.admin : f.users.manager,
    login: role.toLowerCase(),
    role,
    employeeId: role === "MANAGER" ? f.ids.R : null,
  } as SessionUser);
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function pages() {
  return {
    synthese: (await import("@/app/(app)/synthese/page")).default,
    equipes: (await import("@/app/(app)/equipes/page")).default,
    interventions: (await import("@/app/(app)/interventions/page")).default,
    derive: (await import("@/app/(app)/derive/page")).default,
  };
}

describe("pages insights", () => {
  it("RH : les quatre pages se rendent avec leur encart d'aide", async () => {
    as("RH");
    const p = await pages();
    const s = text(html(await p.synthese()));
    expect(s).toContain("Synthèse du mois");
    expect(s).toContain("À quoi sert cette page");
    expect(s).toContain("2 collaborateurs de Production sont passés en risque élevé");
    expect(s).toContain("Passés en risque élevé");
    // résumé exécutif : priorités avec action « verbe + objet », puis chiffres clés, pluriels accordés
    expect(s.indexOf("À traiter en priorité")).toBeGreaterThan(-1);
    expect(s.indexOf("À traiter en priorité")).toBeLessThan(s.indexOf("Chiffres clés"));
    expect(s).toContain("Voir les collaborateurs concernés");
    expect(s).not.toContain("(s)");
    const e = text(html(await p.equipes(sp({ tension: "oui", departement: "abc" }))));
    expect(e).toContain("Carte des équipes");
    expect(e).toContain("Tension");
    expect(e).toMatch(/ignoré\(s\) : d[ée]partement/);
    const i = text(html(await p.interventions(sp())));
    expect(i).toContain("Observation, pas un effet causal");
    expect(i).toContain("Entretien de rétention");
    const d = text(html(await p.derive()));
    expect(d).toContain("Envisager un réentraînement du modèle");
    expect(d).toContain("Que faire : prévenez l'administrateur de l'outil.");
    expect(d).not.toContain("console d'administration");
    expect(d).toContain("Contrat CDD");
    expect(d).toContain("Taux de démission observé et prévu");
    expect(d).toContain("Feu tricolore par variable");
    expect(d).toMatch(/Ce qui a changé : .+ des collaborateurs en .+, contre .+/);
    expect(d).toContain("Que faire :");
  });

  it("MANAGER : synthèse et équipes sans probabilité ; interventions et dérive redirigées", async () => {
    as("MANAGER");
    const p = await pages();
    const s = html(await p.synthese());
    expect(s).not.toMatch(/TND|lift|Probabilité (à|6)|Masse salariale/i);
    expect(s).toContain("Aucune probabilité ni rémunération");
    const e = text(html(await p.equipes(sp())));
    expect(e).toContain("Mes équipes");
    expect(e).toContain("Masqué");
    await expect(p.interventions(sp())).rejects.toThrow("REDIRECT:/interdit");
    await expect(p.derive()).rejects.toThrow("REDIRECT:/interdit");
  });

  it("ADMIN : dérive agrégée seulement, sans taux de démission ; autres pages redirigées", async () => {
    as("ADMIN");
    const p = await pages();
    const d = text(html(await p.derive()));
    expect(d).toContain("Rapport observé / prévu des démissions");
    expect(d).toContain("La mise en service se fait hors de l'interface, par une procédure tracée.");
    expect(d).toContain("Feu tricolore par variable");
    expect(d).not.toContain("Taux observé");
    expect(d).not.toMatch(/Nom[A-Z]/);
    await expect(p.synthese()).rejects.toThrow("REDIRECT:/interdit");
    await expect(p.equipes(sp())).rejects.toThrow("REDIRECT:/interdit");
    await expect(p.interventions(sp())).rejects.toThrow("REDIRECT:/interdit");
  });

  it("composants de fiche (non branchés) : rendu RH et manager", () => {
    const c = ctxOf(f);
    const rhNews = text(html(createElement(WhatsNew, { data: getEmployeeNews(c.rh, f.ids.A1, meta) })));
    expect(rhNews).toContain("Quoi de neuf");
    expect(rhNews).toContain("Augmentation");
    expect(rhNews).toContain("Absences hors santé non planifiées");
    const mgrNews = text(html(createElement(WhatsNew, { data: getEmployeeNews(c.manager, f.ids.A1, meta) })));
    expect(mgrNews).toContain("Promotion");
    expect(mgrNews).not.toMatch(/Augmentation|TND|Absences hors santé non|Heures supplémentaires pointées/);
    const journey = text(html(createElement(Journey, { data: getEmployeeJourney(c.rh, f.ids.A1, meta) })));
    expect(journey).toContain("Parcours");
    expect(journey).toContain("Changement de manager");
    expect(journey).toContain("Congé sans solde de 10");
    expect(journey).not.toContain("Maladie");
    const effects = text(html(createElement(InterventionEffects, { data: getEmployeeInterventionEffects(c.rh, f.ids.B1, meta) })));
    expect(effects).toContain("Observation, pas un effet causal");
    expect(effects).toContain("Niveau en baisse");
    const mgrEffects = text(html(createElement(InterventionEffects, { data: getEmployeeInterventionEffects(c.manager, f.ids.B1, meta) })));
    expect(mgrEffects).toContain("avr. 2026");
    expect(mgrEffects).not.toContain("Absentéisme");
  });
});

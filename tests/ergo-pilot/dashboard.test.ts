import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, setupSeededDb } from "../pilotage/setup";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}));
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

let file = "";
let seed: SeedResult;
beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("ergo-pilot"));
});
afterAll(() => cleanupDb(file));

const asRh = () => (session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null });
const asManager = () => (session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId });
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const render = async (o: Record<string, string> = {}) => html(await (await import("@/app/(app)/dashboard/page")).default(sp(o)));
const selectCls = (out: string, name: string) => new RegExp(`<select id="f-${name}"[^>]*class="([^"]*)"`).exec(out)?.[1] ?? "";

describe("tableau de bord : lecture en 5 secondes", () => {
  it("RH : en-tête → « À traiter » → filtres → filtres actifs → indicateurs → visuels → détail", async () => {
    asRh();
    const out = await render();
    const at = (s: string) => {
      const i = out.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      "<h1",
      'aria-label="À traiter"',
      'aria-label="Filtres"',
      "Filtres actifs :",
      'id="indicateurs-titre"',
      'id="risques-titre"',
      'id="evolution-titre"',
      'id="detail-titre"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(out).toContain('href="/synthese"');
    // titres seuls : plus d'encart « À quoi sert cette page »
    expect(out).not.toContain("page-intro-titre");
    expect(out).not.toContain("À quoi sert cette page");
  });

  it("filtres : un seul repli sous 640 px, période par défaut ni surlignée ni comptée, boutons repliés avec les listes", async () => {
    asRh();
    const out = await render();
    expect(out.split("Afficher les filtres").length - 1).toBe(1);
    expect(out).not.toContain('class="hidden sm:block"');
    expect(out).toMatch(/Afficher les filtres<\/span>/);
    expect(selectCls(out, "periode")).not.toContain("border-primary!");
    expect(out).toMatch(/class="hidden sm:flex col-span-full[^"]*"[^>]*>.*Appliquer les filtres/);
    expect(out).toMatch(/Filtres actifs :<\/span><span>aucun<\/span>/);
    expect(out).not.toContain("Réinitialiser les filtres");
  });

  it("période modifiée : puce retirable, liste surlignée et comptée, lien « Réinitialiser les filtres » unique", async () => {
    asRh();
    const out = await render({ periode: "18m" });
    expect(out).toContain("Retirer le filtre Période");
    expect(out).toMatch(/Période :<\/span> <span class="font-semibold">18 derniers mois<\/span><a href="\/dashboard"/);
    expect(selectCls(out, "periode")).toContain("border-primary!");
    expect(out).toContain("Afficher les filtres (1 actif)");
    expect(out.split("Réinitialiser les filtres").length - 1).toBe(1);
  });

  it("indicateurs : lien « Voir le détail » sur chaque carte qui a une page d'analyse", async () => {
    asRh();
    const out = await render();
    expect(out).toContain('href="/formations"');
    expect(out).toContain("Voir les formations à risque de retard");
    expect(out).toContain('href="/retention"');
    expect(out).toMatch(/href="\/absenteeism\?granularite=mois&amp;retour=%2Fdashboard"/);
    expect(out).toMatch(/href="\/employees\?niveau=ELEVE&amp;retour=%2Fdashboard"/);
  });

  it("« À traiter » : alertes et recommandations pour la RH, en lien seulement s'il y a quelque chose", async () => {
    asRh();
    const out = await render();
    const bar = /<nav aria-label="À traiter"[\s\S]*?<\/nav>/.exec(out)?.[0] ?? "";
    expect(bar).toMatch(/href="\/alerts\?status=NOUVELLE"|Aucune nouvelle alerte/);
    expect(bar).toMatch(/href="\/recommendations\?statut=PROPOSEE"|Aucune recommandation à décider/);
    expect(bar).not.toMatch(/<a [^>]*>\s*<span[^>]*>0<\/span>/);
  });

  it("manager : mêmes repères, alertes seulement, aucun filtre réservé à la RH", async () => {
    asManager();
    const out = await render();
    const bar = /<nav aria-label="À traiter"[\s\S]*?<\/nav>/.exec(out)?.[0] ?? "";
    expect(bar).toMatch(/href="\/alerts\?status=NOUVELLE"|Aucune nouvelle alerte/);
    expect(bar).not.toContain("recommandation");
    expect(out.indexOf('aria-label="À traiter"')).toBeLessThan(out.indexOf('aria-label="Filtres"'));
    expect(out.split("Afficher les filtres").length - 1).toBe(1);
    for (const f of ["contrat", "age", "anciennete"]) expect(out).not.toContain(`name="${f}"`);
    expect(out).toContain('href="/formations"');
    expect(out).not.toMatch(/TND|Masse salariale/);
  });
});

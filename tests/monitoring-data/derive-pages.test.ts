import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { clearDriftCache } from "@/lib/dal/drift";
import { SEMANTIC } from "@/components/charts/theme";
import { createFixture, destroyFixture, type Fixture } from "../insights/fixture";
import { charts, html, inOrder, longSentences, text, type Any } from "./render";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", async () => ({ EChart: (await import("./render")).EChartStub }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

// Jeu d'essai des écrans d'analyse : 16 collaborateurs suivis, part de CDD passée de 25 % à 75 % le dernier mois (dérive forte),
// ancienneté inchangée ; cohortes d'août 2025 à février 2026 suivies 6 mois
let f: Fixture;
beforeAll(() => {
  f = createFixture("monitoring-data-derive");
  clearDriftCache();
});
afterAll(() => destroyFixture(f));

async function drift(role: "RH" | "ADMIN") {
  session.current = { userId: role === "RH" ? f.users.rh : f.users.admin, login: role.toLowerCase(), role, employeeId: null } as SessionUser;
  const page = (await import("@/app/(app)/derive/page")).default;
  const markup = html(await page());
  return { markup, s: text(markup), charts: charts(markup) };
}

describe("Dérive des données", () => {
  it("RH : verdict, tuiles par état, indice par variable dans ses zones de seuil, variables groupées par état", async () => {
    const { s, charts: figs, markup } = await drift("RH");
    expect(s).toContain("Envisager un réentraînement du modèle.");
    expect(s).toContain("1 variable a fortement changé : contrat CDD.");
    expect(inOrder(s, ["Variables en dérive forte Feu rouge 1", "Variables à surveiller Aucune 0", "Variables stables Feu vert 24 sur 25", "Démissions observées / prévues Hors cible 6 dernières cohortes 0,52"])).toBe(true);
    expect(s).not.toContain("logreg-test");

    const bars = figs.find((c) => c.label.startsWith("Barres triées : indice de changement"))!;
    expect(bars.label).toContain("1 en dérive forte, 0 à surveiller, 24 stables");
    const o = bars.option;
    expect(o.yAxis.data[0]).toBe("Contrat CDD");
    const first = o.series[0].data[0];
    expect(first.itemStyle.color).toBe(SEMANTIC.defavorable);
    expect([first.label.show, first.label.formatter]).toEqual([true, "1,10"]);
    expect(first.value).toBeGreaterThanOrEqual(2);
    expect(o.series[0].data.slice(1).every((b: Any) => b.itemStyle.color === SEMANTIC.favorable && b.value < 1 && !b.label.show)).toBe(true);
    expect(o.series[0].markArea.data.map((z: Any) => z[0].name)).toEqual(["Stable\n< 0,10", "À surveiller\n0,10 à 0,25", "Dérive\n≥ 0,25"]);

    expect(inOrder(s, ["Dérive forte 1 variable", "Que faire : Vérifier dans AJIR", "Contrat CDD", "Ce qui a changé : Réponse « Non » : 25,0 % des collaborateurs en août 2026, contre 75,0 %"])).toBe(true);
    expect(s).toContain("Voir les 24 variables stables (aucune action)");
    expect(longSentences(markup)).toEqual([]);
  });

  it("RH : taux observé et prévu, puis rapport observé / prévu avec zone cible nommée", async () => {
    const { s, charts: figs } = await drift("RH");
    expect(s).toContain("2,1 % de démissions observées pour 4,0 % prévues");
    expect(s).toContain("Moins de démissions que prévu sur les dernières cohortes");
    const rates = figs.find((c) => c.label.startsWith("Courbes : taux de démission observé et prévu"))!;
    expect(rates.option.series.map((x: Any) => x.name)).toEqual(["Taux observé", "Taux prévu par le modèle"]);
    const ratio = figs.find((c) => c.label.startsWith("Courbe du rapport observé sur prévu"))!;
    expect(ratio.option.series[0].markArea.label.formatter).toBe("Zone cible\n0,80 à 1,25");
    expect(ratio.option.series[0].data.at(-1).label.show).toBe(true);
    expect(s).toContain("Dernière cohorte suivie 6 mois complets : 28/02/2026.");
  });

  it("ADMIN : rapport observé / prévu seulement, sans taux de démission ni nom", async () => {
    const { s, charts: figs, markup } = await drift("ADMIN");
    expect(s).toContain("Rapport observé / prévu des démissions par cohorte mensuelle");
    expect(figs.map((c) => c.label.split(" :")[0])).toEqual(["Barres triées", "Courbe du rapport observé sur prévu par cohorte mensuelle, zone cible de 0,80 à 1,25."]);
    expect(s).not.toMatch(/Taux observé|Taux de démission|démissions observées pour/);
    expect(s).not.toMatch(/Nom[A-Z]|Prenom[A-Z]|TND/);
    expect(longSentences(markup)).toEqual([]);
  });
});

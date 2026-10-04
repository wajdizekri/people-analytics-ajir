import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
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
    expect(s).toContain("Dérive Réentraînement recommandé Dérive forte : Contrat CDD Observé / prévu : 0,52 (cible 0,80 à 1,25) Action : Prévenir l'administrateur");
    expect(s).toContain("Données agrégées");
    expect(s).not.toContain("À quoi sert cette page");
    expect(s).not.toContain("console d'administration");
    expect(inOrder(s, ["Variables en dérive forte Feu rouge 1", "Variables à surveiller Aucune 0", "Variables stables Feu vert 24 sur 25", "Démissions observées / prévues Hors cible 0,52"])).toBe(true);
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

    expect(inOrder(s, ["Dérive par variable (PSI)", "Indice PSI par variable", "Dérive forte 1 variable", "Action : Vérifier la saisie dans AJIR", "PSI 1,10", "Écart principal : « Non » · 75,0 % → 25,0 %"])).toBe(true);
    expect(s).toContain("Variables stables (24)");
    expect(longSentences(markup)).toEqual([]);
  });

  it("RH : taux observé et prévu, puis rapport observé / prévu avec zone cible nommée", async () => {
    const { s, charts: figs } = await drift("RH");
    expect(s).toContain("Taux de démission à 6 mois (%)");
    expect(s).toContain("Moyenne des 6 dernières cohortes : 2,1 % observé · 4,0 % prévu");
    expect(s).toContain("Observé / prévu par cohorte Hors cible");
    const rates = figs.find((c) => c.label.startsWith("Courbes : taux de démission observé et prévu"))!;
    expect(rates.option.series.map((x: Any) => x.name)).toEqual(["Taux observé", "Taux prévu par le modèle"]);
    const ratio = figs.find((c) => c.label.startsWith("Courbe du rapport observé sur prévu"))!;
    expect(ratio.option.series[0].markArea.label.formatter).toBe("Zone cible\n0,80 à 1,25");
    expect(ratio.option.series[0].data.at(-1).label.show).toBe(true);
    expect(s).toContain("Dernière cohorte complète : 28/02/2026");
  });

  it("ADMIN : rapport observé / prévu seulement, sans taux de démission ni nom", async () => {
    const { s, charts: figs, markup } = await drift("ADMIN");
    expect(s).toContain("Dérive Réentraînement recommandé Dérive forte : Contrat CDD Observé / prévu : 0,52 (cible 0,80 à 1,25) Action : Demander un réentraînement");
    expect(s).toContain("Observé / prévu par cohorte Hors cible");
    expect(figs.map((c) => c.label.split(" :")[0])).toEqual(["Barres triées", "Courbe du rapport observé sur prévu par cohorte mensuelle, zone cible de 0,80 à 1,25."]);
    expect(s).not.toMatch(/Taux observé|Taux de démission|démissions observées pour/);
    expect(s).not.toMatch(/Nom[A-Z]|Prenom[A-Z]|TND/);
    expect(longSentences(markup)).toEqual([]);
  });

  it("RH : dérive des variables mais démissions observées / prévues dans la cible, verdict ambre sans réentraînement", async () => {
    const sqlite = getDb().sqlite;
    sqlite.prepare("UPDATE model_version SET status = 'CANDIDAT' WHERE id = ?").run(f.modelId);
    clearDriftCache();
    try {
      const { s, markup } = await drift("RH");
      expect(s).toContain("À surveiller Dérive de variables Dérive forte : Contrat CDD Observé / prévu : 1,17 (cible 0,80 à 1,25) Action : Vérifier la saisie dans AJIR");
      expect(s).not.toMatch(/Réentraînement recommandé|Demander un réentraînement/);
      expect(longSentences(markup)).toEqual([]);
    } finally {
      sqlite.prepare("UPDATE model_version SET status = 'CHAMPION' WHERE id = ?").run(f.modelId);
      clearDriftCache();
    }
  });
});

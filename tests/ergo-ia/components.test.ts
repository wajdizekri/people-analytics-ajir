import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Composants du domaine IA rendus seuls (formulaire de scénario, liste de recommandations, légende de projection)
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => h("form", rest, children) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => {} }), usePathname: () => "/previsions" }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => h("div", { role: "img", "aria-label": ariaLabel }) }));

const html = (el: unknown) => renderToStaticMarkup(el as Parameters<typeof renderToStaticMarkup>[0]);

describe("formulaire de scénario (/previsions)", () => {
  it("budget : montant rond accepté (step any), aide associée ; plages de valeurs écrites", async () => {
    const { WorkforceScenarioForm } = await import("@/components/ai/workforce/scenario-form");
    const m = html(h(WorkforceScenarioForm, { values: {}, raiseDefaultPct: 3, budgetYear: 2026, departments: [{ id: 1, label: "Production" }], baseHires12: 40 }));
    const budget = /<input[^>]*id="wf-budget"[^>]*>/.exec(m)?.[0] ?? "";
    expect(budget).toContain('step="any"');
    expect(budget).toContain('aria-describedby="wf-budget-aide"');
    expect(m).toContain('id="wf-budget-aide"');
    expect(m).toContain("de 0 à 300 %");
    expect(/<input[^>]*name="embauches"[^>]*>/.exec(m)?.[0]).toContain('step="1"');
    // Curseur gradué jusqu'à la borne écrite et validée par le serveur (300 %), pas 200 %
    const slider = /<input[^>]*type="range"[^>]*aria-label="Rythme des embauches[^>]*>/.exec(m)?.[0] ?? "";
    expect(slider).toContain('max="300"');
    expect(m).toMatch(/<span class="absolute right-0">300 %<\/span>/);
    expect(m).not.toContain(">200 %<");
    expect(m).toContain("Recalculer la projection");
  });
});

describe("liste de recommandations (/absenteeism, /charge, /formations)", () => {
  const base = { priority: 1, rationale: "Hausse prévue.", scopeLabel: "Équipe", target: "Équipe de A. Ben Ali", createdOn: "01/09/2026", updatedOn: null, comment: null };
  it("boutons verbe + objet, rejet confirmé, recommandations traitées repliées", async () => {
    const { RecoBoard } = await import("@/components/ai/workload/reco-status-form");
    const action = async () => ({ ok: "ok" });
    const m = html(
      h(RecoBoard, {
        action,
        emptyTitle: "Aucune action",
        items: [
          { ...base, id: 1, status: "PROPOSEE", title: "Renforcer l'équipe", allowed: ["REALISEE", "REJETEE"] },
          { ...base, id: 2, status: "REALISEE", title: "Revoir les plannings", allowed: ["PROPOSEE"] },
        ],
      }),
    );
    for (const s of ["Marquer comme réalisée", "Rejeter la recommandation", "Priorité haute", "Afficher les recommandations déjà traitées (1)"]) expect(m).toContain(s);
    expect(m).not.toContain("Revoir les plannings");
  });
});

describe("visuels de projection (/previsions)", () => {
  it("couleurs prises dans le kit (aucun hex de palette en dur) ; bande de la légende en style calculé", async () => {
    const { projectionOption } = await import("@/components/ai/workforce/chart-options");
    const { AXIS } = await import("@/components/charts/pbi");
    const o = projectionOption({ observed: [{ month: "2026-07", value: 10 }], projected: [{ month: "2026-08", value: 11, lower: 9, upper: 13 }], axisName: "Collaborateurs" }) as {
      yAxis: { nameTextStyle: { color: string } };
    };
    expect(o.yAxis.nameTextStyle.color).toBe(AXIS.axisLabel.color);
    const { ProjectionLegend } = await import("@/components/ai/workforce/projection-chart");
    const m = html(h(ProjectionLegend, { observedMonths: 24, simulated: false }));
    expect(m).toContain("Fourchette probable à 80 %");
    expect(m).not.toContain("rgba(91,107,130");
  });
});

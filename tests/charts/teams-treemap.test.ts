import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection de l'option ECharts passée au wrapper */
type Any = any;
const seen: Any[] = [];
vi.mock("@/components/charts/echart", () => ({
  EChart: (props: Any) => {
    seen.push(props.option);
    return createElement("div", { role: "img", "aria-label": props.ariaLabel });
  },
}));

const { TeamsTreemap } = await import("@/components/insights/teams-treemap");

const team = (name: string, href?: string) => ({ name, label: `Équipe de ${name}`, headcount: 6, tension: "TENSION" as const, reason: "2 signaux", href });

describe("carte des équipes cliquable", () => {
  it("équipe et département : href, curseur et mention dans l'infobulle seulement quand une cible existe", () => {
    renderToStaticMarkup(
      createElement(TeamsTreemap, {
        departments: [
          { name: "Production", href: "/equipes?departement=1", teams: [team("Ben Ali", "/employees?manager=7"), team("Trabelsi")] },
          { name: "Finance", teams: [team("Zribi", "/employees?manager=9")] },
        ],
        height: 300,
        ariaLabel: "Carte des équipes",
      }),
    );
    const option = seen.at(-1);
    const [prod, fin] = option.series[0].data;
    expect(prod).toMatchObject({ name: "Production", href: "/equipes?departement=1", cursor: "pointer" });
    expect(fin.href).toBeUndefined();
    expect(fin.cursor).toBe("default");
    const [linked, plain] = prod.children;
    expect(linked).toMatchObject({ href: "/employees?manager=7", drillHint: "Cliquer pour voir les collaborateurs de l'équipe", cursor: "pointer" });
    expect(plain.href).toBeUndefined();
    expect(plain.cursor).toBe("default");

    const tip = option.tooltip.formatter;
    expect(tip({ data: linked })).toContain("Cliquer pour voir les collaborateurs de l'équipe");
    expect(tip({ data: plain })).not.toContain("Cliquer");
    expect(tip({ data: prod })).toContain("Cliquer pour voir les équipes du département");
    expect(tip({ data: fin })).toBe("<strong>Finance</strong>");
  });
});

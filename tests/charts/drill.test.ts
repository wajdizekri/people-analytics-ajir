import { describe, expect, it } from "vitest";
import { localizeOption } from "@/components/charts/echart";
import { barChart, donutChart, stackedBarChart } from "@/components/charts/builders";
import { DRILL_HINT, absenteeismHref, drillPoint, employeesHref, levelFromLabel, teamsHref, withDrill, withDrillSpec } from "@/components/charts/drill";
import { RISK_LEVELS, riskByDepartmentOption } from "@/components/pilotage/chart-options";
import { employeeListSchema } from "@/lib/dal/employees";
import { absenteeismQuerySchema } from "@/lib/dal/absenteeism";
import { teamsQuerySchema } from "@/lib/dal/teams";

/* eslint-disable @typescript-eslint/no-explicit-any -- inspection des options ECharts produites */
type Any = any;
const data = (o: Any, k = 0): Any[] => [o.series].flat()[k].data;
const query = (href: string) => Object.fromEntries(new URL(href, "http://localhost").searchParams);

describe("withDrill : cible portée par les points de données", () => {
  const ids: Record<string, number> = { Production: 3, Finance: 5 };
  const target = (name: string) => (ids[name] ? employeesHref({ departement: ids[name] }) : undefined);

  it("barres : href, mention et curseur pointeur sur les points résolus, curseur normal sur les autres", () => {
    const spec = barChart({
      rows: [
        { name: "Production", value: 12, tip: "12 collaborateurs" },
        { name: "Finance", value: 4 },
        { name: "Moyenne", value: 8, tone: "reference" },
      ],
      measure: "Effectif",
      unit: "collaborateurs",
    });
    const o = withDrill(spec.option, target, "Cliquer pour voir les collaborateurs du département");
    const [prod, avg, fin] = data(o);
    expect(prod).toMatchObject({ value: 12, tip: "12 collaborateurs", href: "/employees?departement=3", drillHint: "Cliquer pour voir les collaborateurs du département", cursor: "pointer" });
    expect(prod.itemStyle).toEqual(data(spec.option)[0].itemStyle);
    expect(fin.href).toBe("/employees?departement=5");
    expect(avg.href).toBeUndefined();
    expect(avg.cursor).toBe("default");
    expect(data(spec.option)[0].href).toBeUndefined();
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });

  it("valeurs nues et séries multiples : point converti en { value, href }, nom de série transmis", () => {
    const calls: [string, string | undefined][] = [];
    const rows = [
      { name: "Direction de la production", ELEVE: 2, MOYEN: 3 },
      { name: "Direction financière", ELEVE: 0, MOYEN: 1 },
    ];
    const short: Record<string, number> = { Production: 3, Financière: 5 };
    const o = withDrill(riskByDepartmentOption(rows), (name, series) => {
      calls.push([name, series]);
      return short[name] ? employeesHref({ departement: short[name], niveau: levelFromLabel(series) }) : undefined;
    });
    expect(calls).toContainEqual(["Production", "Élevé"]);
    expect(calls).toContainEqual(["Financière", "Moyen"]);
    expect(data(o, 0)[0]).toMatchObject({ value: 2, href: "/employees?departement=3&niveau=ELEVE", drillHint: DRILL_HINT });
    expect(data(o, 1)[1]).toMatchObject({ value: 1, href: "/employees?departement=5&niveau=MOYEN" });
  });

  it("anneau : nom du secteur ; séries silencieuses et valeurs absentes laissées telles quelles", () => {
    const donut = withDrill(donutChart({ parts: [{ name: "Production", value: 3 }, { name: "Autre", value: 1 }], measure: "Effectif" }).option, target);
    expect(data(donut)[0].href).toBe("/employees?departement=3");
    expect(data(donut)[1].cursor).toBe("default");

    const stacked = stackedBarChart({ rows: [{ name: "Production", values: [1, 2] }], parts: [{ label: "A" }, { label: "B" }], measure: "Effectif" });
    const so = withDrill(stacked.option, target);
    const total = [(so as Any).series].flat().find((s: Any) => s.name === "Total");
    expect(total.data[0].href).toBeUndefined();
    expect(data(so, 0)[0].href).toBe("/employees?departement=3");

    const withNull = withDrill(barChart({ rows: [{ name: "Production", value: null }], measure: "Taux" }).option, target);
    expect(data(withNull)[0].href).toBeUndefined();
  });

  it("compatible avec le wrapper EChart : localizeOption conserve href et mention", () => {
    const spec = barChart({ rows: [{ name: "Production", value: 12 }], measure: "Effectif", unit: "collaborateurs" });
    const shown = localizeOption(withDrill(spec.option, target), spec.format) as Any;
    expect(data(shown)[0]).toMatchObject({ href: "/employees?departement=3", cursor: "pointer" });
  });

  it("withDrillSpec : liens du tableau « Voir les données » alignés sur ses lignes", () => {
    const spec = barChart({ rows: [{ name: "Finance", value: 4 }, { name: "Production", value: 12 }, { name: "Moyenne", value: 8 }], measure: "Effectif" });
    const d = withDrillSpec(spec, target);
    expect(d.table.rows.map((r) => r[0])).toEqual(["Production", "Moyenne", "Finance"]);
    expect(d.table.hrefs).toEqual(["/employees?departement=3", undefined, "/employees?departement=5"]);
    expect(data(d.option)[0].href).toBe("/employees?departement=3");
    expect(withDrillSpec(spec, () => undefined).table.hrefs).toBeUndefined();
  });

  it("drillPoint : pointeur seulement avec une cible", () => {
    expect(drillPoint("/equipes?departement=2", "Voir")).toEqual({ href: "/equipes?departement=2", drillHint: "Voir", cursor: "pointer" });
    expect(drillPoint(undefined)).toEqual({ cursor: "default" });
  });
});

describe("cibles : noms des paramètres lus par les pages", () => {
  it("liste des collaborateurs : URL acceptée telle quelle par employeeListSchema", () => {
    const href = employeesHref({ departement: 3, niveau: "NON_EVALUE", manager: null, contrat: undefined, retour: "/dashboard?periode=6m" });
    expect(href).toBe("/employees?departement=3&niveau=NON_EVALUE&retour=%2Fdashboard%3Fperiode%3D6m");
    const { retour, ...rest } = query(href);
    expect(retour).toBe("/dashboard?periode=6m");
    expect(employeeListSchema.parse(rest)).toMatchObject({ departement: 3, niveau: "NON_EVALUE" });
    expect(employeeListSchema.parse(query(employeesHref({ manager: 42 })))).toMatchObject({ manager: 42 });
    expect(employeesHref({})).toBe("/employees");
  });

  it("absentéisme et équipes : URL acceptées par leurs schémas", () => {
    const abs = absenteeismHref({ granularite: "mois", axe: "equipe", departement: 4 });
    expect(absenteeismQuerySchema.strict().parse(query(abs))).toEqual({ granularite: "mois", axe: "equipe", departement: 4 });
    expect(absenteeismHref({ departement: 4, retour: "/dashboard" })).toBe("/absenteeism?departement=4&retour=%2Fdashboard");
    const teams = teamsHref({ departement: 2, tension: "oui" });
    expect(teamsQuerySchema.strict().parse(query(teams))).toEqual({ departement: 2, tension: "oui" });
    expect(teamsHref({ departement: null })).toBe("/equipes");
  });

  it("niveaux : chaque libellé de RISK_LEVELS a sa valeur de filtre", () => {
    expect(RISK_LEVELS.map((l) => levelFromLabel(l.label))).toEqual(["ELEVE", "MOYEN", "FAIBLE", "NON_EVALUE"]);
    expect(levelFromLabel("Moyenne")).toBeUndefined();
    expect(levelFromLabel(undefined)).toBeUndefined();
  });
});

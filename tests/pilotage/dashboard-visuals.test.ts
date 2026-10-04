import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import { dashboardQuerySchema, getDashboard, toManagerDashboardDto, type DashboardRh } from "@/lib/dal/dashboard";
import { RISK_LEVELS, rateLinesOption, riskByDepartmentOption, shortDepartment } from "@/components/pilotage/chart-options";
import { SEMANTIC } from "@/components/charts/pbi";
import { withFrenchFormat } from "@/components/insights/fr-chart";
import { absenteeismTitle, countDelta, headcountTitle, rateDelta, riskByDepartmentTitle, riskTitle, turnoverTitle } from "@/app/(app)/dashboard/messages";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, findLeaks, managerCtx, rhCtx, sensitiveValues, setupSeededDb } from "./setup";
import { visibleEmployeeIds } from "@/lib/dal/context";

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({
  CHART_COLORS: [],
  EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }),
}));
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
  ({ file, seed } = await setupSeededDb("visuals"));
});
afterAll(() => cleanupDb(file));

const rhDash = (raw: Record<string, string | number> = {}) => getDashboard(rhCtx(seed), dashboardQuerySchema.parse(raw)) as DashboardRh;
const RH_ONLY_KEYS = ["departments", "payroll"];

describe("tableau de bord RH : données des nouveaux visuels", () => {
  it("agrégats : effectif par département cohérent avec le total, absentéisme aligné sur la série, masse salariale mensuelle", () => {
    const d = rhDash({ periode: "12m" });
    expect(d.view).toBe("RH");
    expect(d.source).toBe("AGREGATS");
    expect(d.departments.length).toBeGreaterThan(1);
    expect(d.departments.reduce((n, x) => n + x.headcount, 0)).toBe(d.kpis.headcount);
    for (const x of d.departments) expect(x.absenteeismRates).toHaveLength(d.series.length);
    expect(d.departments.some((x) => x.absenteeismRate != null && x.absenteeismRate > 0)).toBe(true);
    expect(d.payroll.monthly).toHaveLength(d.series.length);
    expect(d.payroll.monthly[d.payroll.monthly.length - 1]).toBeCloseTo(d.payroll.lastMonth, 6);
    expect(d.payroll.monthly.reduce((a, b) => a + b, 0)).toBeCloseTo(d.payroll.periodTotal, 6);
  });

  it("calcul détaillé (filtre contrat) : ventilation par département sur la population filtrée", () => {
    const d = rhDash({ periode: "6m", contrat: "CDI" });
    expect(d.source).toBe("DETAIL");
    expect(d.departments.length).toBeGreaterThan(0);
    expect(d.departments.reduce((n, x) => n + x.headcount, 0)).toBe(d.kpis.headcount);
    for (const x of d.departments) expect(x.absenteeismRates).toHaveLength(6);
  });

  it("filtre département : une seule ligne", () => {
    const all = rhDash();
    const target = all.departments[0];
    const d = rhDash({ departement: target.departmentId! });
    expect(d.departments.map((x) => x.departmentId)).toEqual([target.departmentId]);
    expect(d.departments[0].headcount).toBe(target.headcount);
  });
});

describe("tableau de bord manager : aucun nouveau champ RH", () => {
  it("le DTO manager n'a ni ventilation par département ni masse salariale, et aucune valeur sensible", () => {
    const s = sensitiveValues(visibleEmployeeIds(managerCtx(seed))!);
    for (const raw of [{}, { periode: "24m" }, { periode: "3m" }]) {
      const m = getDashboard(managerCtx(seed), dashboardQuerySchema.parse(raw));
      expect(m.view).toBe("MANAGER");
      for (const key of RH_ONLY_KEYS) expect(key in m).toBe(false);
      expect(findLeaks(m, s.numbers, s.strings)).toEqual([]);
      expect(JSON.stringify(m)).not.toMatch(/absenteeismRates|payroll|monthly/);
    }
  });

  it("le mappeur manager écarte les champs RH même s'ils sont présents dans les données brutes", () => {
    const rh = rhDash();
    const raw = {
      ...rh,
      run: { asOf: rh.risk!.asOf, modelVersion: rh.risk!.modelVersion, modelKind: rh.risk!.modelKind },
      riskRows: rh.risk!.byDepartment,
    } as unknown as Parameters<typeof toManagerDashboardDto>[0];
    const m = toManagerDashboardDto(raw);
    expect(m.view).toBe("MANAGER");
    for (const key of RH_ONLY_KEYS) expect(key in m).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/avgLift|modelVersion|modelKind|absenteeismRates|payroll/);
  });
});

// Aucune fonction dans l'option : elle traverse la frontière serveur -> client
const hasFunction = (v: unknown): boolean =>
  typeof v === "function" || (Array.isArray(v) ? v.some(hasFunction) : v != null && typeof v === "object" ? Object.values(v).some(hasFunction) : false);
const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

describe("options ECharts du tableau de bord", () => {
  const months = ["juin", "juil.", "août"];
  const options = {
    lines: rateLinesOption(months, [
      { name: "Turnover 12 mois (%)", rates: [0.1, null, 0.12] },
      { name: "dont volontaire (%)", rates: [0.05, 0.06, 0.07] },
    ]),
    single: rateLinesOption(months, [{ name: "Taux d'absence (%)", rates: [0.01, 0.02, 0.03] }]),
    risk: riskByDepartmentOption([
      { name: "Direction de la production", ELEVE: 6, MOYEN: 8 },
      { name: "Direction qualité", ELEVE: 0, MOYEN: 1 },
    ]),
  };
  const NNBSP = " ";
  const NBSP = " ";

  it("sérialisables, un seul axe Y, légende dès deux séries", () => {
    for (const [name, o] of Object.entries(options)) {
      expect(hasFunction(o), name).toBe(false);
      expect(JSON.parse(JSON.stringify(o)), name).toEqual(o);
      expect(asArray(o.yAxis).length, name).toBe(1);
      const series = asArray(o.series);
      if (series.length >= 2) expect(o.legend, name).toBeDefined();
    }
    expect(options.single.legend).toBeUndefined();
    for (const s of asArray(options.lines.series)) expect((s as { lineStyle: { width: number } }).lineStyle.width).toBe(2);
  });

  it("risque par département : Élevé et Moyen seulement, couleurs de la charte, départements abrégés sur l'axe", () => {
    const series = asArray(options.risk.series) as { name: string; data: number[]; itemStyle: { color: string } }[];
    expect(series.map((s) => s.name)).toEqual(["Élevé", "Moyen"]);
    expect(series[0].data).toEqual([6, 0]);
    expect(series[0].itemStyle.color).toBe(SEMANTIC.defavorable);
    expect(series[1].itemStyle.color).toBe(SEMANTIC.attention);
    expect((options.risk.yAxis as { data: string[] }).data).toEqual(["Production", "Qualité"]);
    expect(RISK_LEVELS.map((l) => l.tone)).toEqual(["defavorable", "attention", "favorable", "contexte"]);
    expect(shortDepartment("Direction administrative et financière")).toBe("Administrative et financière");
    expect(shortDepartment("Direction des systèmes d'information")).toBe("Systèmes d'information");
    expect(shortDepartment("Atelier")).toBe("Atelier");
  });

  it("FrChart (repli local, encore utilisé ailleurs) : axes, infobulles et étiquettes au format français", () => {
    const o = withFrenchFormat(
      { tooltip: { trigger: "axis" }, xAxis: { type: "category", data: months }, yAxis: { type: "value" }, series: [{ type: "line", data: [1078, 1069], endLabel: { show: true } }] },
      "int",
    ) as unknown as {
      yAxis: { axisLabel: { formatter: (v: number) => string } }[];
      tooltip: { valueFormatter: (v: number) => string };
      series: { endLabel: { formatter: (p: { value: number }) => string } }[];
    };
    expect(o.yAxis[0].axisLabel.formatter(1200)).toBe(`1${NNBSP}200`);
    expect(o.tooltip.valueFormatter(1069)).toBe(`1${NNBSP}069`);
    expect(o.series[0].endLabel.formatter({ value: 1069 })).toBe(`1${NNBSP}069`);
    const p = withFrenchFormat(options.single, "pct2") as unknown as { yAxis: { axisLabel: { formatter: (v: number) => string } }[] };
    expect(p.yAxis[0].axisLabel.formatter(0.8)).toBe(`0,8${NBSP}%`);
  });
});

describe("titres-messages et variations", () => {
  const NBSP = " ";

  it("le titre dit ce qu'il faut retenir", () => {
    expect(headcountTitle(1078, 1069, "depuis fin sept. 2025")).toBe("L'effectif recule de 9 personnes depuis fin sept. 2025");
    expect(headcountTitle(7, 7, "depuis fin sept. 2025")).toBe("L'effectif est stable depuis fin sept. 2025 : 7 collaborateurs");
    expect(turnoverTitle(0.111, 0.109, "sept. 2025")).toBe(`Le turnover reste stable, autour de 10,9${NBSP}%`);
    expect(turnoverTitle(0, 0.145, "sept. 2025")).toBe(`Le turnover augmente : 14,5${NBSP}% contre 0,0${NBSP}% en sept. 2025`);
    expect(absenteeismTitle(0.006, 0.008, "août 2026")).toBe(`En août 2026, l'absentéisme (0,6${NBSP}%) est sous la moyenne de la période`);
    expect(riskTitle({ ELEVE: 19, MOYEN: 30, FAIBLE: 938, nonScored: 181 })).toBe(`19 collaborateurs en risque élevé, soit 1,9${NBSP}% des évalués`);
    expect(riskTitle({ ELEVE: 0, MOYEN: 0, FAIBLE: 6, nonScored: 3 })).toBe("Aucun collaborateur en risque élevé");
    expect(riskByDepartmentTitle([{ name: "Production", ELEVE: 6 }, { name: "Achats", ELEVE: 5 }])).toBe("Production compte le plus de risques élevés : 6 sur 11");
    expect(riskByDepartmentTitle([{ name: "Production", ELEVE: 3 }, { name: "Achats", ELEVE: 0 }])).toBe("Production concentre les 3 risques élevés");
    expect(riskByDepartmentTitle([{ name: "Qualité", ELEVE: 0 }])).toBe("Qualité : aucun risque élevé");
  });

  it("variation calculée sur les valeurs affichées (jamais « 0,6 % contre 0,7 % : 0,0 pt »), signe moins typographique", () => {
    expect(rateDelta(0.0066, 0.0055, "vs juil. 2026", "down")).toEqual({ value: -0.1, label: "−0,1 pt vs juil. 2026", good: "down" });
    expect(rateDelta(0.1, 0.12, "depuis sept. 2025", "down")?.label).toBe("+2,0 pt depuis sept. 2025");
    expect(rateDelta(0.0081, 0.0079, "vs juil. 2026", "down")?.value).toBe(0);
    expect(rateDelta(null, 0.1, "vs juil. 2026", "down")).toBeNull();
    expect(countDelta(1078, 1069, "depuis fin sept. 2025", "neutral")).toEqual({ value: -9, label: "−9 depuis fin sept. 2025", good: "neutral" });
    expect(countDelta(6.31, 5.66, "vs juil. 2026", "down", `${NBSP}h`, 1).label).toBe(`−0,6${NBSP}h vs juil. 2026`);
  });
});

describe("rendu de la page", () => {
  const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
  const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });

  it("RH : visuels par département ; manager : ni absentéisme ni effectif par département, ni masse salariale", async () => {
    const page = (await import("@/app/(app)/dashboard/page")).default;
    session.current = { userId: seed.rhUserId, login: "rh.demo", role: "RH", employeeId: null };
    const rh = html(await page(sp()));
    for (const t of ["Effectif fin de mois", "Turnover glissant 12 mois", "Répartition des niveaux de risque", "Effectif par département", "Absentéisme par département", "Masse salariale", "Lire la synthèse du mois"])
      expect(rh).toContain(t);
    // titres-messages : un constat chiffré, pas seulement le nom de la mesure ; pluriels accordés
    expect(rh).toMatch(/collaborateurs? en risque élevé, soit [\d,]+ % des évalués|Aucun collaborateur en risque élevé/);
    expect(rh).toMatch(/L&#x27;effectif (recule|progresse|est stable)/);
    expect(rh).not.toContain("(s)");
    session.current = { userId: seed.managerUserId, login: "mgr.demo", role: "MANAGER", employeeId: seed.managerEmployeeId };
    const m = html(await page(sp()));
    for (const t of ["Effectif fin de mois", "Turnover glissant 12 mois", "Répartition des niveaux de risque", "Votre équipe"]) expect(m).toContain(t);
    for (const t of ["Effectif par département", "Absentéisme par département", "Masse salariale", "TND", "Lift", "Niveaux de risque : modèle"]) expect(m).not.toContain(t);
  });
});

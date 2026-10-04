import type { EChartsOption } from "echarts";
import type { ChartSpec, ChartTable } from "./builders";
import type { AbsenteeismQuery } from "@/lib/dal/absenteeism";
import type { EmployeeListQuery } from "@/lib/dal/employees";
import type { TeamsQuery } from "@/lib/dal/teams";

// Filtrage croisé « Power BI » : la cible d'un clic est portée par le point de données ({ value, href, drillHint }),
// l'option reste sérialisable. EChart suit `href` au clic ; la table « Voir les données » rend les mêmes cibles en liens.
// Le résolveur ne doit renvoyer que des vues déjà accessibles au rôle et jamais un groupe masqué (petits groupes).

export type DrillTarget = (name: string, seriesName?: string) => string | undefined;
export type DrillPoint = { href: string; drillHint: string; cursor: "pointer" } | { cursor: "default" };
export type DrillTable = ChartTable & { hrefs?: (string | undefined)[] };
export type DrillSpec = ChartSpec & { table: DrillTable };

export const DRILL_HINT = "Cliquer pour voir le détail";
const DRILLABLE = new Set(["bar", "pie"]);

export function drillPoint(href: string | undefined, hint = DRILL_HINT): DrillPoint {
  return href ? { href, drillHint: hint, cursor: "pointer" } : { cursor: "default" };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- options ECharts hétérogènes, parcourues sans connaître leur forme exacte */
type Any = any;

// Barres horizontales : catégories sur l'axe Y ; sinon sur l'axe X (catégoriel par défaut)
function categories(o: Any): unknown[] {
  const cat = [o.yAxis].flat().find((a: Any) => a?.type === "category") ?? [o.xAxis].flat().find((a: Any) => a && (a.type ?? "category") === "category");
  return Array.isArray(cat?.data) ? cat.data : [];
}

const catName = (c: unknown) => (c != null && typeof c === "object" ? String((c as { value?: unknown }).value ?? "") : String(c ?? ""));

// Ajoute href + curseur aux points des barres et secteurs d'une option déjà construite (sans la modifier)
export function withDrill(option: EChartsOption, target: DrillTarget, hint = DRILL_HINT): EChartsOption {
  const o: Any = option;
  const cats = categories(o);
  const drill = (s: Any) => {
    if (!s || s.silent || !DRILLABLE.has(s.type) || !Array.isArray(s.data)) return s;
    const data = s.data.map((item: Any, i: number) => {
      if (item == null) return item;
      const obj = typeof item === "object" && !Array.isArray(item);
      if (obj && (item.skip || item.value == null)) return item;
      const name = obj && item.name != null ? String(item.name) : catName(cats[i]);
      return { ...(obj ? item : { value: item }), ...drillPoint(target(name, s.name), hint) };
    });
    return { ...s, data };
  };
  return { ...option, series: Array.isArray(o.series) ? o.series.map(drill) : drill(o.series) } as EChartsOption;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Même chose pour un ChartSpec des helpers : la première colonne du tableau « Voir les données » reçoit les mêmes cibles
export function withDrillSpec(spec: ChartSpec, target: DrillTarget, hint = DRILL_HINT): DrillSpec {
  const hrefs = spec.table.rows.map((r) => target(r[0] ?? ""));
  return {
    ...spec,
    option: withDrill(spec.option, target, hint),
    table: hrefs.some(Boolean) ? { ...spec.table, hrefs } : spec.table,
  };
}

// ---------- Cibles : noms de paramètres repris des schémas zod des pages ----------

type Params = Record<string, string | number | null | undefined>;
function withQuery(path: string, params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

type Nullable<T> = { [K in keyof T]?: T[K] | null };
type EmployeeFilters = Nullable<Pick<EmployeeListQuery, "departement" | "contrat" | "age" | "anciennete" | "niveau" | "manager">>;
export type RiskLevelFilter = NonNullable<EmployeeListQuery["niveau"]>;

export const employeesHref = (p: EmployeeFilters & { retour?: string }) => withQuery("/employees", p);
export const absenteeismHref = (p: Nullable<AbsenteeismQuery> & { retour?: string }) => withQuery("/absenteeism", p);
export const teamsHref = (p: Nullable<TeamsQuery>) => withQuery("/equipes", p);

// Libellés des niveaux (RISK_LEVELS, séries « Élevé » / « Moyen ») → valeur du filtre `niveau` de la liste
const LEVEL_BY_LABEL: Record<string, RiskLevelFilter> = { Élevé: "ELEVE", Moyen: "MOYEN", Faible: "FAIBLE", "Non évalués": "NON_EVALUE", "Non évalué": "NON_EVALUE" };
export const levelFromLabel = (label: string | undefined): RiskLevelFilter | undefined => (label ? LEVEL_BY_LABEL[label] : undefined);

"use client";

import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/echart";
import { TOOLTIP_ITEM } from "@/components/charts/pbi";
import { drillPoint } from "@/components/charts/drill";
import { useTheme } from "@/components/ui/theme";
import type { TensionLevel } from "@/lib/dal/teams";
import { TENSION_COLORS, TENSION_LABELS, TENSION_TEXT } from "./labels";

export type TreemapTeam = { name: string; label: string; headcount: number; tension: TensionLevel; reason: string; href?: string };
type Node = { name?: string; value?: number; team?: TreemapTeam; drillHint?: string };

// Thème sombre : les équipes à regarder (forte tension, tension) restent claires et vives, les autres s'assombrissent.
// Couleurs absentes de DARK_COLORS : EChart ne les remappe pas. Texte ≥ 4,5:1 sur chaque aplat.
const TENSION_COLORS_DARK: Record<TensionLevel, string> = { FORTE: "#f87171", TENSION: "#fb923c", SURVEILLER: "#6b5d12", STABLE: "#1f3b31" };
const TENSION_TEXT_DARK: Record<TensionLevel, string> = { FORTE: "#450a0a", TENSION: "#431407", SURVEILLER: "#fef9c3", STABLE: "#d1fae5" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const people = (n: number) => `${n.toLocaleString("fr-FR")} collaborateur${n > 1 ? "s" : ""}`;

// Carte des équipes : surface = effectif actif, couleur = niveau de tension. Étiquette « nom + effectif » sur les rectangles
// assez grands ; infobulle avec le niveau et la raison en mots. Survol : rectangle souligné, les autres atténués.
// Bordures et bandeau des départements en couleurs claires canoniques : EChart les remplace en thème sombre.
export function TeamsTreemap({ departments, height, ariaLabel }: { departments: { name: string; teams: TreemapTeam[]; href?: string }[]; height: number; ariaLabel: string }) {
  const dark = useTheme().resolvedTheme === "dark";
  const fill = dark ? TENSION_COLORS_DARK : TENSION_COLORS;
  const ink = dark ? TENSION_TEXT_DARK : TENSION_TEXT;
  const total = departments.reduce((s, d) => s + d.teams.reduce((a, t) => a + Math.max(1, t.headcount), 0), 0);
  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP_ITEM,
      formatter: (p: unknown) => {
        const n = (p as { data?: Node }).data;
        const hint = n?.drillHint ? `<br/><em>${esc(n.drillHint)}</em>` : "";
        if (!n?.team) return n?.name ? `<strong>${esc(n.name)}</strong>${hint}` : "";
        const t = n.team;
        return `<strong>${esc(t.label)}</strong><br/>${TENSION_LABELS[t.tension]} · ${people(t.headcount)}<br/><span style="white-space:normal;display:inline-block;max-width:260px">${esc(t.reason)}</span>${hint}`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        emphasis: { focus: "self", itemStyle: { borderColor: "#0f172a", borderWidth: 2 } },
        blur: { itemStyle: { opacity: 0.55 } },
        label: {
          show: true,
          fontSize: 12,
          lineHeight: 15,
          overflow: "truncate",
          formatter: (p: unknown) => {
            const n = (p as { data?: Node }).data;
            if (!n?.team || (n.value ?? 0) / total < 0.006) return "";
            return `${n.team.name}\n${n.team.headcount} pers.`;
          },
        },
        // Formateur explicite : sinon le bandeau du département reprend celui des équipes (vide pour un département)
        upperLabel: { show: true, height: 22, color: "#0f172a", fontSize: 12, fontWeight: 600, overflow: "truncate", formatter: (p: unknown) => (p as { name?: string }).name ?? "" },
        itemStyle: { borderColor: "#ffffff", borderWidth: 1, gapWidth: 1 },
        levels: [
          { itemStyle: { borderColor: "#e2e8f0", borderWidth: 3, gapWidth: 3 }, upperLabel: { show: false } },
          { itemStyle: { borderColor: "#cbd5e1", borderWidth: 2, gapWidth: 2, color: "#e2e8f0" } },
          { itemStyle: { borderColor: "#ffffff", borderWidth: 1, gapWidth: 1 } },
        ],
        data: departments.map((d) => ({
          name: d.name,
          ...drillPoint(d.href, "Cliquer pour voir les équipes du département"),
          children: d.teams.map((t) => ({
            name: t.name,
            value: Math.max(1, t.headcount),
            team: t,
            ...drillPoint(t.href, "Cliquer pour voir les collaborateurs de l'équipe"),
            itemStyle: { color: fill[t.tension] },
            label: { color: ink[t.tension], fontWeight: t.tension === "FORTE" || t.tension === "TENSION" ? 600 : 400 },
          })),
        })),
      },
    ],
  };
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}

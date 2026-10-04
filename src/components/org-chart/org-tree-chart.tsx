"use client";

import ReactECharts from "echarts-for-react";
import type { DefaultLabelFormatterCallbackParams, EChartsOption, TreeSeriesOption } from "echarts";
import { useMemo, useState } from "react";
import { CHART_FONT, escapeHtml } from "@/components/charts/theme";
import { InfoTip } from "@/components/help/info-tip";
import { Button } from "@/components/ui";
import { useTheme } from "@/components/ui/theme";
import type { OrgColorBy, OrgNode } from "@/lib/dal/org-chart";
import { absenteeismText, people, riskText, tierOf, tiersFor, type Reference } from "./scale";

type Item = NonNullable<TreeSeriesOption["data"]>[number] & { key: string; tip: string; labelText: string; children?: Item[] };

const INK = {
  light: { text: "#334155", labelBg: "rgba(255,255,255,0.88)", line: "#94a3b8", border: "#475569", tipBg: "#ffffff", tipBorder: "#cbd5e1", tipText: "#0f172a" },
  dark: { text: "#cbd5e1", labelBg: "rgba(17,26,43,0.88)", line: "#5d6e8a", border: "#cbd5e1", tipBg: "#16223a", tipBorder: "#3a4a66", tipText: "#e6edf7" },
} as const;

const int = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
const symbolSize = (n: number) => Math.round(Math.min(28, 8 + Math.sqrt(n) * 1.1));

function tooltipHtml(n: OrgNode, tier: string): string {
  const meta = [n.jobTitle, n.department].filter(Boolean).join(" · ");
  const rows = [
    `<strong>${escapeHtml(n.name)}</strong>`,
    meta ? escapeHtml(meta) : "",
    `Effectif total : ${escapeHtml(people(n.subtree.headcount))} (équipe directe : ${int(n.team.headcount)})`,
    `Risque élevé ou moyen : ${escapeHtml(riskText(n.subtree))}`,
    `Absentéisme (3 mois) : ${escapeHtml(absenteeismText(n.subtree))}`,
    `Couleur : ${escapeHtml(tier)}`,
    `<em>Clic : détail${n.children.length ? ` · ${int(n.children.length)} équipe${n.children.length > 1 ? "s" : ""}` : ""}</em>`,
  ];
  return rows.filter(Boolean).join("<br/>");
}

export function OrgTreeChart({
  root,
  colorBy,
  reference,
  onSelect,
  narrow,
  nodeCount,
}: {
  root: OrgNode;
  colorBy: OrgColorBy;
  reference: Reference;
  onSelect: (key: string) => void;
  narrow: boolean;
  nodeCount: number;
}) {
  const theme = useTheme().resolvedTheme;
  const [reset, setReset] = useState(0);

  const option = useMemo<EChartsOption>(() => {
    const ink = INK[theme];
    const tiers = new Map(tiersFor(colorBy, reference).map((t) => [t.key, t]));
    const toItem = (n: OrgNode): Item => {
      const tier = tiers.get(tierOf(colorBy, n.subtree, reference))!;
      return {
        name: n.name,
        value: n.subtree.headcount,
        key: n.key,
        labelText: `${n.name} · ${int(n.subtree.headcount)}`,
        tip: tooltipHtml(n, tier.label),
        symbolSize: symbolSize(n.subtree.headcount),
        itemStyle: { color: tier.color[theme], borderColor: ink.border, borderWidth: 1 },
        children: n.children.map(toItem),
      };
    };
    const series: TreeSeriesOption = {
      type: "tree",
      data: [toItem(root)],
      orient: "LR",
      initialTreeDepth: 2,
      expandAndCollapse: true,
      roam: true,
      scaleLimit: { min: 0.3, max: 4 },
      top: 16,
      bottom: 16,
      left: narrow ? 96 : 170,
      right: narrow ? 120 : 200,
      symbol: "circle",
      lineStyle: { color: ink.line, width: 1.2, curveness: 0.5 },
      label: {
        position: "left",
        verticalAlign: "middle",
        align: "right",
        color: ink.text,
        fontSize: 12,
        fontFamily: CHART_FONT,
        backgroundColor: ink.labelBg,
        padding: [2, 4],
        borderRadius: 4,
        width: narrow ? 120 : 190,
        overflow: "truncate",
        formatter: (p: DefaultLabelFormatterCallbackParams) => (p.data as Item).labelText,
      },
      leaves: { label: { position: "right", align: "left" } },
      emphasis: { focus: "relative" },
      animationDuration: 250,
      animationDurationUpdate: 300,
    };
    return {
      backgroundColor: "transparent",
      textStyle: { fontFamily: CHART_FONT },
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: ink.tipBg,
        borderColor: ink.tipBorder,
        textStyle: { color: ink.tipText, fontSize: 13 },
        extraCssText: "max-width:320px;white-space:normal;border-radius:6px;",
        formatter: (p: unknown) => ((p as { data?: Item }).data?.tip ?? ""),
      },
      series: [series],
    };
  }, [root, colorBy, reference, theme, narrow]);

  const onEvents = useMemo(
    () => ({
      click: (p: { data?: { key?: string } }) => {
        if (p.data?.key) onSelect(p.data.key);
      },
    }),
    [onSelect],
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <InfoTip label="Commandes du graphique" prefix="Aide" align="start">
          Clic sur un nœud : détail et dépliage. Molette ou pincement : zoom. Glisser : déplacement.
        </InfoTip>
        <Button size="sm" variant="tertiary" icon="refresh" onClick={() => setReset((r) => r + 1)}>
          Recentrer le graphique
        </Button>
      </div>
      <div
        role="img"
        aria-label={`Organigramme graphique : ${int(nodeCount)} responsables d'équipe, de gauche à droite. La vue Liste en donne le détail, au clavier.`}
        className="w-full min-w-0 overflow-hidden rounded-control border border-line bg-surface"
      >
        <ReactECharts key={`${reset}-${theme}`} option={option} notMerge onEvents={onEvents} style={{ height: narrow ? 460 : 620, width: "100%" }} />
      </div>
    </div>
  );
}

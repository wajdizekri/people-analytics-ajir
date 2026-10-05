import Link from "next/link";
import { Fragment, useId, type ReactNode } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "./echart";
import type { ChartSpec, ChartTable } from "./builders";
import { CHART_INK, NBSP, SEMANTIC, axisName, cssChartColor, escapeHtml, formatShort, formatValue, frNumber, type Tone, type ValueFormat } from "./theme";
import { cardCls } from "@/components/ui/classes";
import { DetailTip } from "@/components/help/info-tip";

// Kit visuel « Power BI » : conteneurs de visuels, cartes KPI à sparkline et options ECharts de base.
// Options sérialisables uniquement (aucune fonction) : construites côté serveur, rendues par le wrapper client
// (qui applique le thème, les formats français et la mise en page mobile).
// Pour un nouveau visuel : un helper de ./builders (lineChart, barChart, shareChart, donutChart, histogramChart) + <ChartCard>.
// Couleurs : SEMANTIC, CHART_PALETTE et CHART_INK seulement (valeurs claires que EChart remplace en thème sombre) ; en HTML, classes de jetons.

export { SEMANTIC, RISK_COLORS, CHART_PALETTE, CHART_INK, CHART_SURFACE, MARK, BAND_LABEL, DARK_COLORS, cssChartColor, darkOption, formatValue, frNumber, axisName, type Tone, type ValueFormat } from "./theme";
export { lineChart, barChart, stackedBarChart, shareChart, donutChart, histogramChart, levelStepChart, toBins, textOn, monthCategories } from "./builders";
export type { ChartSpec, ChartTable, Reference, LineSeries, BarRow, Bin } from "./builders";

// Couleurs de statut (pastilles) : alignées sur SEMANTIC (un seul ambre à l'écran). En HTML, passer par cssChartColor() pour suivre le thème.
export const STATUS_COLORS = { bon: SEMANTIC.favorable, attention: SEMANTIC.attention, critique: SEMANTIC.defavorable, neutre: SEMANTIC.contexte } as const;
export type Status = keyof typeof STATUS_COLORS;

// Un ton de la charte ou un statut ; « neutre » désigne ici le bleu ArabSoft (le gris de contexte se demande par « contexte »)
const toneColor = (t: Tone | Status): string => (t in SEMANTIC ? SEMANTIC[t as Tone] : STATUS_COLORS[t as Status]);

// Réglages communs des options écrites à la main : textes de 12 px en encre de texte, ligne de base et grille fines, pleines, en retrait
export const AXIS = {
  axisLine: { lineStyle: { color: CHART_INK.axis, width: 1 } },
  axisTick: { show: false },
  axisLabel: { color: CHART_INK.muted, fontSize: 12 },
  splitLine: { lineStyle: { color: CHART_INK.grid, width: 1, type: "solid" } },
} as const;

export const GRID = { left: 44, right: 16, top: 36, bottom: 28, containLabel: false } as const;
export const LEGEND = { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 12, itemGap: 16, textStyle: { fontSize: 12, color: CHART_INK.ink } } as const;
export const TOOLTIP_AXIS = { trigger: "axis", backgroundColor: CHART_INK.surface, borderColor: CHART_INK.border, confine: true, textStyle: { color: CHART_INK.fg, fontSize: 13 } } as const;
export const TOOLTIP_ITEM = { trigger: "item", backgroundColor: CHART_INK.surface, borderColor: CHART_INK.border, confine: true, textStyle: { color: CHART_INK.fg, fontSize: 13 } } as const;

/** Légende à partir de deux séries seulement (une série seule : le titre du visuel la nomme). */
export function legendFor(names: string[]) {
  return names.length > 1 ? { ...LEGEND, data: names } : undefined;
}

// Détail d'un visuel (lu dans sa bulle « ? ») : mesure (unité) · périmètre · période
export function chartSubtitle(p: { measure?: string; unit?: string; scope?: ReactNode; period?: ReactNode }): ReactNode {
  const parts: ReactNode[] = [];
  if (p.measure) parts.push(p.unit ? `${p.measure} (${p.unit})` : p.measure);
  if (p.scope) parts.push(p.scope);
  if (p.period) parts.push(p.period);
  if (!parts.length) return null;
  return parts.map((x, i) => (
    <span key={i}>
      {i > 0 && <span aria-hidden="true"> · </span>}
      {i > 0 && <span className="sr-only">, </span>}
      {x}
    </span>
  ));
}

const NUMBER_CELL = /^[+\-−–]?\s?\d/;
// Colonne de nombres (alignée à droite) : chaque cellule renseignée commence par un chiffre ou un signe ; « — » = valeur absente
const numericColumns = (table: ChartTable) => table.headers.map((_, j) => j > 0 && table.rows.every((r) => !r[j] || r[j] === "—" || NUMBER_CELL.test(r[j])));

// Alternative accessible d'un graphique : tableau repliable « Voir les données », nombres alignés à droite, texte à gauche
// `table.hrefs` (withDrillSpec, ./drill.ts) : libellé de ligne en lien vers la vue filtrée (équivalent clavier du clic sur le graphique)
// Impression : replié, rien n'est imprimé ; ouvert, le tableau l'est.
export function ChartData({ table, caption, summary = "Voir les données" }: { table: ChartTable & { hrefs?: (string | undefined)[] }; caption: string; summary?: string }) {
  if (!table.rows.length) return null;
  const numeric = numericColumns(table);
  return (
    <details className="group mt-3 text-sm print:[&:not([open])]:hidden">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control px-1 text-[13px] font-medium text-link transition-colors duration-150 hover:bg-primary-soft [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 5l5 5-5 5" />
        </svg>
        <span className="group-open:hidden">{summary}</span>
        <span className="hidden group-open:inline">Masquer les données</span>
        <span className="sr-only"> : {caption}</span>
      </summary>
      {/* Zone défilante atteignable au clavier (WCAG 2.1.1) */}
      <div className="mt-2 max-h-72 animate-fade-in overflow-auto rounded-control border border-line" tabIndex={0} role="region" aria-label={`Données : ${caption}`}>
        <table className="w-full text-left text-sm text-fg">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-2 text-xs text-fg-muted">
            <tr>
              {table.headers.map((h, j) => (
                <th key={`${j}-${h}`} scope="col" className={`border-b border-line px-3 py-2 align-bottom font-semibold ${numeric[j] ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0 transition-colors duration-150 hover:bg-surface-3">
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-3 py-1.5 font-normal text-fg">
                      {table.hrefs?.[i] ? (
                        <Link href={table.hrefs[i]!} className="text-link underline underline-offset-2 hover:decoration-2">
                          {c}
                        </Link>
                      ) : (
                        c
                      )}
                    </th>
                  ) : (
                    <td key={j} className={numeric[j] ? "whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-fg" : "px-3 py-1.5 text-fg"}>
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// Graphique seul à partir d'un ChartSpec (sans cadre ni tableau)
export function Chart({ spec, ariaLabel, height }: { spec: ChartSpec; ariaLabel?: string; height?: number }) {
  return <EChart option={spec.option} format={spec.format} height={height ?? spec.height} mobileHeight={spec.mobileHeight} ariaLabel={ariaLabel ?? spec.ariaLabel} />;
}

// Cadre d'un visuel : titre seul, groupe nominal qui nomme le contenu (« Effectif par département », « Absentéisme mensuel (%) »).
// Sous-titre, mesure, unité, périmètre, période et note ne sont pas affichés : ils sont lus dans la bulle « ? » après le titre.
// Le titre nomme la section ; avec `chart`, le graphique et le tableau « Voir les données » sont rendus automatiquement.
export function VisualCard({
  title,
  subtitle,
  children,
  className = "",
  actions,
  badge,
  chart,
  measure,
  unit,
  scope,
  period,
  footnote,
  headingLevel = 2,
  id,
}: {
  title: string;
  /** Bulle « ? » (remplace mesure · périmètre · période). */
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Liens ou boutons de l'en-tête : à droite du titre, dessous sous 640 px. */
  actions?: ReactNode;
  /** Mention courte à côté du titre : <StatusBadge tone="warning">Prévision indicative</StatusBadge>. */
  badge?: ReactNode;
  chart?: ChartSpec;
  /** Bulle « ? » : mesure (unité) · périmètre · période. */
  measure?: string;
  unit?: string;
  scope?: ReactNode;
  period?: ReactNode;
  /** Bulle « ? » : source, exclusions, « fourchette probable à 80 % ». */
  footnote?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const headingId = useId();
  const sub = subtitle ?? chartSubtitle({ measure, unit, scope, period });
  // Un tableau d'éléments transmis à un composant client est contrôlé comme une liste : clé obligatoire.
  const details = [sub, footnote].filter(shown).map((d, i) => <Fragment key={i}>{d}</Fragment>);
  const heading = (
    <div className="flex min-w-0 items-start gap-1">
      <Heading id={headingId} className="min-w-0 break-words text-base font-semibold leading-snug text-heading">
        {title}
      </Heading>
      <DetailTip label={title} details={details} className="-mt-px" />
    </div>
  );
  return (
    <section id={id} aria-labelledby={headingId} className={`${cardCls} min-w-0 scroll-mt-4 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        {badge ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {heading}
            {badge}
          </div>
        ) : (
          heading
        )}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 text-[13px]">{actions}</div>}
      </div>
      {chart && <Chart spec={chart} />}
      {children}
      {chart && <ChartData table={chart.table} caption={title} />}
    </section>
  );
}

// Nom explicite pour un visuel construit avec un helper (même composant que VisualCard)
export function ChartCard(props: Parameters<typeof VisualCard>[0] & { chart: ChartSpec }) {
  return <VisualCard {...props} />;
}

/**
 * Variation d'un indicateur. `label` : « +1,2 pt vs mois précédent » ; `good` : sens favorable (« up », « down »)
 * ou « neutral » (alias « none ») quand la hausse n'est ni bonne ni mauvaise (effectif, masse salariale) : flèche grise, sans jugement.
 */
export type Delta = { value: number; label: string; good: "up" | "down" | "none" | "neutral"; reference?: string };

const VERDICT = {
  favorable: { text: "favorable", cls: "border-success/30 bg-success-soft text-success", arrow: "text-success" },
  defavorable: { text: "à surveiller", cls: "border-danger/30 bg-danger-soft text-danger", arrow: "text-danger" },
  stable: { text: "stable", cls: "border-line bg-surface-3 text-fg-muted", arrow: "text-fg-subtle" },
  neutre: { text: "", cls: "", arrow: "text-fg-muted" },
} as const;

export function deltaVerdict(delta: Delta): keyof typeof VERDICT {
  if (delta.value === 0) return "stable";
  if (delta.good === "none" || delta.good === "neutral") return "neutre";
  return (delta.value > 0) === (delta.good === "up") ? "favorable" : "defavorable";
}

// Écart en tête du libellé (« −0,67 pt », « −9 », « −0,6 h ») : insécable avec la flèche ; la suite (période, référence) passe à la ligne
const DELTA_UNIT = /^(?:pts?|%|h|j|×|TND)$/;
function splitDeltaLabel(label: string): [string, string] {
  const words = label.split(" ");
  const n = words.length > 1 && DELTA_UNIT.test(words[1]) ? 2 : 1;
  return [words.slice(0, n).join(" "), words.slice(n).join(" ")];
}

// Variation lisible sans la couleur : forme de la flèche, sens écrit pour les lecteurs d'écran, écart signé, jugement en toutes lettres
// dans une pastille à bordure (la bordure reste visible à l'impression et en contraste forcé)
export function DeltaLine({ delta }: { delta: Delta }) {
  const v = deltaVerdict(delta);
  const s = VERDICT[v];
  const direction = delta.value > 0 ? "En hausse" : delta.value < 0 ? "En baisse" : "Stable";
  const [head, rest] = splitDeltaLabel(delta.label);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] tabular-nums text-fg-muted">
      <span className="min-w-0">
        <span className="whitespace-nowrap">
          <span aria-hidden="true" className={`mr-1.5 font-semibold ${s.arrow}`}>
            {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "▬"}
          </span>
          <span className="sr-only">{direction} : </span>
          {head}
        </span>
        {rest && ` ${rest}`}
        {delta.reference && <span className="text-fg-subtle"> {delta.reference}</span>}
      </span>
      {s.text && <span className={`rounded-full border px-1.5 text-xs font-semibold ${s.cls}`}>{s.text}</span>}
    </p>
  );
}

// Tuile qui demande une action : cadre de 2 px (bordure + anneau intérieur, sans décaler le contenu) et valeur dans le ton
const TILE_TONE: Partial<Record<Status, { frame: string; value: string }>> = {
  critique: { frame: "border-danger! ring-1 ring-inset ring-danger", value: "text-danger" },
  attention: { frame: "border-warning! ring-1 ring-inset ring-warning", value: "text-warning" },
};

const shown = (n: ReactNode) => n != null && n !== false && n !== "";

// Carte KPI : libellé, valeur + unité, variation ; tendance, statut et lien « Voir le détail » en plus.
// Période et aide ne sont pas affichées : elles sont lues dans la bulle « ? » du coin (ajoutées à `tip` s'il est fourni).
// Dans une grille, les cartes d'une rangée ont la même hauteur ; tendance et lien sont calés en pied de carte.
export function KpiCard({
  label,
  value,
  unit,
  period,
  hint,
  delta,
  spark,
  sparkLabel,
  sparkTone,
  status,
  tone,
  href,
  detailHref,
  detailLabel,
  linkLabel,
  tip,
  emptyLabel,
}: {
  label: string;
  /** Valeur déjà formatée. Absente (null) : état « non évalué » (tiret et mention, sans unité, variation ni tendance). */
  value: ReactNode;
  /** Unité écrite après la valeur, en plus petit : « % », « TND », « collaborateurs ». */
  unit?: string;
  /** Bulle « ? » : période ou date de la valeur (« fin août 2026 », « 12 derniers mois »). */
  period?: ReactNode;
  /** Bulle « ? » : précision ou motif (« Aucun calcul publié »). */
  hint?: ReactNode;
  delta?: Delta | null;
  /** Tendance : courbe en retrait, dernier point marqué. */
  spark?: (number | null)[];
  /** Dernière valeur de la tendance, déjà formatée, écrite à sa droite : « 10,9 % en août ». */
  sparkLabel?: ReactNode;
  /** Couleur de toute la mini-courbe quand la série a un sens (échecs : « defavorable »). Défaut : courbe grise, dernier point bleu. */
  sparkTone?: Tone | Status;
  status?: { tone: Status; label: string };
  /** Tuile à traiter : « critique » (cadre et valeur rouges) ou « attention » (ambre). À accompagner d'un `status` (le mot reste visible). */
  tone?: Status;
  /** Toute la carte devient un lien. */
  href?: string;
  /** Lien « Voir le détail » en pied de carte (sans rendre toute la carte cliquable). */
  detailHref?: string;
  /** Texte du lien en pied de carte (href ou detailHref) : « Voir les 19 collaborateurs ». Défaut : « Voir le détail ». */
  detailLabel?: string;
  /** Alias de detailLabel. */
  linkLabel?: string;
  /** Bulle de définition (« ? »), par exemple <TermTip term="turnover" role={role} align="end" /> ; période et aide s'y ajoutent. */
  tip?: ReactNode;
  /** Mention de l'état sans valeur : « Non évalué » (défaut quand value est null), « Masqué », « Aucun import ». */
  emptyLabel?: string;
}) {
  const more = detailLabel ?? linkLabel ?? "Voir le détail";
  const missing = value == null || value === "";
  const empty = missing || value === "—";
  const emptyText = emptyLabel ?? (missing ? "Non évalué" : null);
  const toned = tone ? TILE_TONE[tone] : undefined;
  const trend = !missing && spark && spark.some((v) => v != null) ? spark : null;
  const accent = sparkTone ? toneColor(sparkTone) : toned && tone ? STATUS_COLORS[tone] : SEMANTIC.neutre;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug text-fg-muted">{label}</p>
        {status && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-fg-muted">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: cssChartColor(STATUS_COLORS[status.tone]) }} />
            {status.label}
          </span>
        )}
      </div>
      <p className={`mt-1.5 flex flex-wrap text-2xl font-semibold leading-tight tabular-nums sm:text-[28px] ${empty ? "items-center gap-x-2" : "items-baseline gap-x-1"} ${toned?.value ?? "text-heading"}`}>
        {empty ? (
          <>
            <span aria-hidden={emptyText ? "true" : undefined} className="text-fg-subtle">
              —
            </span>
            {emptyText && <span className="rounded-full border border-line bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-muted">{emptyText}</span>}
          </>
        ) : (
          <>
            <span>{value}</span>
            {unit && <span className="text-sm font-medium text-fg-muted">{unit}</span>}
          </>
        )}
      </p>
      {delta && !missing && <DeltaLine delta={delta} />}
      {(trend || href || detailHref) && (
        <div className="mt-auto pt-2">
          {trend && (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1" aria-hidden="true">
                <EChart option={sparklineOption(trend, accent, sparkTone ? accent : undefined)} height={36} mobileHeight={36} ariaLabel={`Tendance : ${label}`} />
              </div>
              {sparkLabel && <p className="shrink-0 text-xs leading-tight tabular-nums text-fg-muted">{sparkLabel}</p>}
            </div>
          )}
          {href && (
            <span className={`inline-flex items-center gap-1 text-[13px] font-medium text-link underline-offset-2 group-hover:underline ${trend ? "mt-1.5" : ""}`}>
              {more}
              <span aria-hidden="true">›</span>
            </span>
          )}
          {!href && detailHref && (
            <a href={detailHref} className={`inline-flex min-h-8 items-center gap-1 text-[13px] font-medium text-link underline-offset-2 transition-colors duration-150 hover:underline ${trend ? "mt-0.5" : ""}`}>
              {more}
              <span aria-hidden="true">›</span>
              <span className="sr-only"> : {label}</span>
            </a>
          )}
        </div>
      )}
    </>
  );
  const help = shown(tip) || shown(period) || shown(hint);
  const cls = `flex h-full flex-col ${cardCls} min-w-0 p-4 ${help ? "pr-10" : ""} ${toned?.frame ?? ""}`;
  const card = href ? (
    <a href={href} className={`group ${cls} transition duration-200 hover:-translate-y-px ${toned ? "" : "hover:border-primary/50"} hover:shadow-pop active:translate-y-0`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
  if (!help) return card;
  // La bulle est posée à côté du lien, jamais dedans (un bouton ne peut pas être imbriqué dans un lien)
  return (
    <div className="relative h-full">
      {card}
      <span className="absolute right-2 top-2.5">
        <DetailTip label={label} tip={tip} details={[period, hint]} align="end" />
      </span>
    </div>
  );
}

// Grille de pictogrammes (1 carré = 1 personne) : « sur 100 collaborateurs, 14… ». Le sens est écrit dans `label` et le texte voisin.
export function IconArray({
  segments,
  total,
  label,
  columns = 10,
}: {
  segments: { n: number; color?: string; tone?: Tone }[];
  total?: number;
  label: string;
  columns?: number;
}) {
  const filled = segments.flatMap((s) => Array.from({ length: Math.max(0, Math.round(s.n)) }, () => cssChartColor(s.color ?? SEMANTIC[s.tone ?? "neutre"])));
  const size = Math.max(total ?? 0, filled.length);
  return (
    <div role="img" aria-label={label} className="grid w-fit gap-0.5" style={{ gridTemplateColumns: `repeat(${columns}, 0.75rem)` }}>
      {Array.from({ length: size }, (_, i) => (
        <span key={i} className={`h-3 w-3 rounded-[2px] ${filled[i] ? "" : "border border-line bg-surface-3"}`} style={filled[i] ? { background: filled[i] } : undefined} />
      ))}
    </div>
  );
}

// Tendance d'une carte KPI : courbe de 2 px en retrait (gris de contexte), lavis à 10 %, dernier point de 8 px en couleur d'accent,
// cerclé de la couleur de surface. `trend` colore toute la courbe quand la série a un sens (échecs en rouge).
export function sparklineOption(values: (number | null)[], color: string = SEMANTIC.neutre, trend: string = SEMANTIC.contexte): EChartsOption {
  let last = values.length - 1;
  while (last >= 0 && values[last] == null) last--;
  return {
    animation: false,
    grid: { left: 2, right: 6, top: 6, bottom: 6 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, scale: true },
    tooltip: { show: false },
    series: [
      {
        type: "line",
        silent: true,
        symbol: "none",
        data: values.map((v, i) => (i === last ? { value: v, symbol: "circle", symbolSize: 8, itemStyle: { color, borderColor: CHART_INK.surface, borderWidth: 2 } } : v)),
        lineStyle: { width: 2, color: trend, join: "round", cap: "round" },
        areaStyle: { color: trend, opacity: 0.1 },
      },
    ],
  };
}

type DonutItem = { name: string; value: number; color?: string };

// Part d'un tout : 4 parts au plus (charte § 5) ; au-delà, les plus petites sont regroupées dans « Autres » (gris de contexte)
function donutParts(items: DonutItem[]): DonutItem[] {
  const shown = items.length > 4 ? items.filter((p) => p.value > 0) : items;
  if (shown.length <= 4) return shown;
  const sorted = [...shown].sort((a, b) => b.value - a.value);
  return [...sorted.slice(0, 3), { name: "Autres", value: sorted.slice(3).reduce((a, p) => a + p.value, 0), color: SEMANTIC.contexte }];
}

/** Valeurs à écrire après chaque entrée de légende d'un anneau (« 19 (2 %) ») : `<EChart option={donutOption(items)} format={{ legendValues: donutLegendValues(items) }} />`. */
export function donutLegendValues(items: DonutItem[]): Record<string, string> {
  const parts = donutParts(items);
  const total = parts.reduce((a, p) => a + p.value, 0);
  return Object.fromEntries(parts.map((p) => [p.name, `${frNumber(p.value)} (${frNumber(total > 0 ? (p.value / total) * 100 : 0, 0)}${NBSP}%)`]));
}

/** @deprecated Préférer donutChart (valeurs dans la légende, résumé et tableau « Voir les données »). */
export function donutOption(items: DonutItem[], center?: { value: string; label: string }): EChartsOption {
  const parts = donutParts(items);
  return {
    animation: false,
    tooltip: { ...TOOLTIP_ITEM, formatter: "{b} : {c} ({d} %)" },
    legend: { ...LEGEND, top: "bottom", left: "center", data: parts.map((p) => p.name) },
    title: center
      ? { text: center.value, subtext: center.label, left: "center", top: "34%", itemGap: 4, textStyle: { fontSize: 22, fontWeight: 600, color: CHART_INK.fg }, subtextStyle: { fontSize: 12, color: CHART_INK.muted } }
      : undefined,
    series: [
      {
        type: "pie",
        radius: ["56%", "72%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: CHART_INK.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: false },
        data: parts.map((p) => ({ name: p.name, value: p.value, itemStyle: p.color ? { color: p.color } : undefined })),
      },
    ],
  };
}

/**
 * @deprecated Une demi-jauge se lit mal (angles, place perdue) : préférer bulletChart / bulletOption. Conservée pour compatibilité.
 * Bandes de statut (bon / attention / critique) ; `higherIsBetter` inverse l'ordre des bandes ; le statut est écrit sous la valeur.
 */
export function gaugeOption(
  value: number | null,
  opts: { min?: number; max?: number; warn: number; crit: number; higherIsBetter?: boolean; unit?: string; labels?: Partial<Record<"bon" | "attention" | "critique", string>> },
): EChartsOption {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const at = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const order: readonly ("bon" | "attention" | "critique")[] = opts.higherIsBetter ? ["critique", "attention", "bon"] : ["bon", "attention", "critique"];
  const stops = opts.higherIsBetter ? [at(opts.crit), at(opts.warn), 1] : [at(opts.warn), at(opts.crit), 1];
  const labels = { bon: "Bon", attention: "À surveiller", critique: "Critique", ...opts.labels };
  const position = value == null ? null : at(value);
  const status = position == null ? null : (order[stops.findIndex((s) => position < s)] ?? order[2]);
  return {
    series: [
      {
        type: "gauge",
        min,
        max,
        startAngle: 200,
        endAngle: -20,
        radius: "95%",
        center: ["50%", "62%"],
        splitNumber: 4,
        axisLine: { lineStyle: { width: 10, color: order.map((s, k): [number, string] => [stops[k], STATUS_COLORS[s]]) } },
        pointer: { show: value != null, width: 4, length: "46%", itemStyle: { color: CHART_INK.ink } },
        anchor: { show: value != null, size: 8, itemStyle: { color: CHART_INK.ink } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { distance: 16, fontSize: 12, color: CHART_INK.muted },
        title: { show: true, offsetCenter: [0, "58%"], fontSize: 12, color: CHART_INK.muted },
        detail: { valueAnimation: false, fontSize: 22, fontWeight: 600, color: CHART_INK.fg, offsetCenter: [0, "30%"], formatter: value == null ? "—" : `{value}${opts.unit ? `${NBSP}${opts.unit.trim()}` : ""}` },
        data: [{ value: value ?? min, name: status ? labels[status] : "Non évalué" }],
      },
    ],
  };
}

export type BulletBand = {
  /** Borne haute de la zone (exclue) ; la zone part de la borne de la précédente, ou de `min`. */
  to: number;
  tone: Tone | Status;
  /** Nom de la zone, écrit sous la valeur quand elle s'y trouve : « À surveiller ». */
  label?: string;
};
export type BulletOptions = {
  /** Repère vertical étiqueté : 90 ou { value: 90, label: "Objectif" } (« Cible » par défaut). */
  target?: number | { value: number; label?: string };
  /** Zones de lecture : fond teinté, borne graduée et étiquetée ; la barre prend le ton de la zone où se trouve la valeur. */
  bands?: BulletBand[];
  min?: number;
  max?: number;
  unit?: string;
  digits?: number;
  /** Ton de la barre quand aucune zone n'est donnée (défaut : bleu neutre). */
  tone?: Tone | Status;
  /** Nom de la mesure dans l'infobulle : « Score qualité ». */
  name?: string;
  /** Mention écrite à la place de la valeur absente (défaut : « Non évalué »). */
  emptyLabel?: string;
};

function niceCeil(v: number) {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].find((k) => k * p >= v)! * p;
}

function bulletModel(v: number | null, o: BulletOptions) {
  const value = v;
  const f: ValueFormat = { unit: o.unit, digits: o.digits };
  const min = o.min ?? 0;
  const target = o.target == null ? null : typeof o.target === "number" ? { value: o.target, label: "Cible" } : { value: o.target.value, label: o.target.label ?? "Cible" };
  const bands = [...(o.bands ?? [])].sort((a, b) => a.to - b.to);
  const reach = Math.max(value ?? min, target?.value ?? min);
  const lastTo = bands.length ? bands[bands.length - 1].to : null;
  const auto = lastTo != null && reach <= lastTo ? lastTo : o.unit === "%" && reach <= 100 ? 100 : niceCeil(reach);
  const max = o.max ?? (auto > min ? auto : min + 1);
  const zones = bands.map((b, k) => ({ from: k === 0 ? min : bands[k - 1].to, to: k === bands.length - 1 ? Math.max(b.to, max) : b.to, color: toneColor(b.tone), label: b.label }));
  const zone = value == null ? null : (zones.find((z) => value < z.to) ?? zones[zones.length - 1] ?? null);
  return {
    f,
    min,
    max,
    target,
    zones,
    zone,
    /** Borne ou cible : sans décimale inutile (« 90 % », « 4,5 % »). */
    bound: (x: number) => formatValue(x, { unit: o.unit, digits: Number.isInteger(x) ? 0 : o.digits }),
    color: zone?.color ?? toneColor(o.tone ?? "neutre"),
    shown: value == null ? null : Math.min(max, Math.max(min, value)),
    short: value == null ? "—" : formatShort(value, f),
    full: value == null ? (o.emptyLabel ?? "Non évalué") : formatValue(value, f),
    note: value == null ? (o.emptyLabel ?? "Non évalué") : zone?.label,
  };
}

/**
 * Barre de niveau : la valeur face à ses seuils et à sa cible, sur une seule échelle (remplace la demi-jauge).
 * Valeur et zone écrites à gauche, cible étiquetée au-dessus, bornes graduées dessous. Hauteur : 76 px avec cible, 58 px sans.
 * `bulletOption(72.5, { unit: "%", target: 90, bands: [{ to: 60, tone: "critique", label: "Critique" }, { to: 80, tone: "attention", label: "À surveiller" }, { to: 100, tone: "bon", label: "Bon" }] })`
 */
export function bulletOption(value: number | null, opts: BulletOptions = {}): EChartsOption {
  const m = bulletModel(value, opts);
  const name = opts.name ?? "Valeur";
  const left = Math.min(132, Math.max(56, Math.round(Math.max(m.short.length * 9.2, (m.note?.length ?? 0) * 6.6)) + 14));
  const ticks = [...new Set([m.min, ...m.zones.slice(0, -1).map((z) => z.to), m.max])].filter((t) => t >= m.min && t <= m.max);
  const areas: [{ xAxis: number; itemStyle: { color: string; opacity?: number } }, { xAxis: number }][] = m.zones.length
    ? m.zones.map((z) => [{ xAxis: z.from, itemStyle: { color: z.color, opacity: 0.18 } }, { xAxis: z.to }])
    : [[{ xAxis: m.min, itemStyle: { color: CHART_INK.grid } }, { xAxis: m.max }]];
  const tip = [
    `${escapeHtml(name)} : <strong>${escapeHtml(m.full)}</strong>`,
    ...(value != null && m.zone?.label ? [escapeHtml(m.zone.label)] : []),
    ...(m.target ? [`${escapeHtml(m.target.label)} : ${escapeHtml(m.bound(m.target.value))}`] : []),
  ].join("<br/>");
  return {
    animation: false,
    grid: { left, right: 44, top: m.target ? 24 : 6, height: 20 },
    tooltip: { ...TOOLTIP_ITEM, formatter: tip },
    xAxis: {
      type: "value",
      min: m.min,
      max: m.max,
      axisLine: { show: false },
      splitLine: { show: false },
      axisTick: { show: true, customValues: ticks, length: 4, lineStyle: { color: CHART_INK.axis } },
      axisLabel: { customValues: ticks, showMinLabel: true, showMaxLabel: true, hideOverlap: true, color: CHART_INK.muted, fontSize: 12, formatter: opts.unit === "%" ? `{value}${NBSP}%` : undefined },
    },
    yAxis: {
      type: "category",
      data: [name],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        margin: 12,
        formatter: m.note ? `{v|${m.short}}\n{n|${m.note}}` : `{v|${m.short}}`,
        rich: { v: { color: CHART_INK.fg, fontSize: 15, fontWeight: 600, lineHeight: 18 }, n: { color: CHART_INK.muted, fontSize: 12, lineHeight: 15 } },
      },
    },
    series: [
      {
        type: "bar",
        name,
        data: [{ value: m.shown, itemStyle: { color: m.color } }],
        barWidth: 8,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        z: 3,
        markArea: { silent: true, data: areas },
        markLine: m.target
          ? {
              silent: true,
              symbol: ["none", "none"],
              data: [
                {
                  xAxis: m.target.value,
                  lineStyle: { color: CHART_INK.ink, width: 2, type: "solid" },
                  label: { formatter: `${m.target.label} ${m.bound(m.target.value)}`, position: "end", distance: 4, color: CHART_INK.muted, fontSize: 12 },
                },
              ],
            }
          : undefined,
      },
    ],
  };
}

/** Barre de niveau prête pour <ChartCard> : option, hauteur, résumé pour lecteur d'écran et tableau « Voir les données ». */
export function bulletChart(i: BulletOptions & { value: number | null; measure: string }): ChartSpec {
  const opts = { ...i, name: i.name ?? i.measure };
  const m = bulletModel(i.value, opts);
  const span = (z: { from: number; to: number }, k: number) =>
    k === 0 ? `moins de ${m.bound(z.to)}` : k === m.zones.length - 1 ? `${m.bound(z.from)} et plus` : `de ${m.bound(z.from)} à ${m.bound(z.to)}`;
  const zones = m.zones.map((z, k) => ({ name: z.label ?? `Zone ${k + 1}`, span: span(z, k) }));
  return {
    option: bulletOption(i.value, opts),
    format: m.f,
    height: m.target ? 76 : 58,
    ariaLabel: `Barre de niveau : ${axisName(i.measure, i.unit)}. Valeur : ${m.full}${i.value != null && m.zone?.label ? ` (${m.zone.label})` : ""}.${
      m.target ? ` ${m.target.label} : ${m.bound(m.target.value)}.` : ""
    }${zones.length ? ` Zones : ${zones.map((z) => `${z.name}, ${z.span}`).join(" ; ")}.` : ""}`,
    table: {
      headers: ["Repère", axisName(i.measure, i.unit)],
      rows: [["Valeur", m.full], ...(m.target ? [[m.target.label, m.bound(m.target.value)]] : []), ...zones.map((z) => [z.name, z.span])],
    },
  };
}

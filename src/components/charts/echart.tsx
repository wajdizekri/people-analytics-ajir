"use client";

import ReactECharts from "echarts-for-react";
import { format as echartsFormat, type EChartsOption } from "echarts";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps, type RefObject } from "react";
import { useTheme } from "@/components/ui/theme";
import { hasIsolatedPoint } from "./builders";
import { CHART_FONT, CHART_INK, CHART_PALETTE, DARK_COLORS, darkOption, defaultDigits, escapeHtml, formatShort, formatValue, frNumber, type ValueFormat } from "./theme";

// Palette catégorielle par défaut (bleu ArabSoft d'abord). Conservée pour compatibilité ; préférer SEMANTIC / CHART_PALETTE de ./theme.
export const CHART_COLORS: string[] = [...CHART_PALETTE];

// Jetons lus dans le thème courant (globals.css) ; valeurs claires en repli (rendu serveur, tests) : celles de CHART_INK, source unique
export type ChartTokens = { fg: string; muted: string; ink: string; axis: string; grid: string; surface: string; border: string };
export const LIGHT_TOKENS: ChartTokens = { ...CHART_INK };
export function readChartTokens(dark: boolean): ChartTokens {
  const base = dark ? (Object.fromEntries(Object.entries(LIGHT_TOKENS).map(([k, v]) => [k, DARK_COLORS[v] ?? v])) as ChartTokens) : LIGHT_TOKENS;
  if (typeof window === "undefined") return base;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { ...base, fg: v("--pa-fg", base.fg), muted: v("--pa-fg-muted", base.muted), grid: v("--pa-line", base.grid), surface: v("--pa-surface", base.surface) };
}

// Thème commun : textes ≥ 12 px, axes discrets, grille légère, infobulle confinée au graphique (aucun débordement sur mobile ;
// plus étroite sous 640 px pour laisser voir le point survolé)
export function chartTheme(t: ChartTokens, dark = false, narrow = false) {
  const axisText = { color: t.muted, fontSize: 12 };
  const label = { color: t.ink };
  return {
    color: dark ? CHART_COLORS.map((c) => DARK_COLORS[c] ?? c) : CHART_COLORS,
    backgroundColor: "transparent",
    darkMode: dark,
    textStyle: { fontFamily: CHART_FONT, color: t.ink, fontSize: 12 },
    title: { textStyle: { color: t.fg, fontSize: 14, fontWeight: 600 }, subtextStyle: { color: t.muted, fontSize: 12 } },
    legend: { textStyle: { color: t.ink, fontSize: 12 }, itemWidth: 12, itemHeight: 12, itemGap: 16, inactiveColor: dark ? "#4b5b78" : "#c3ccd8" },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.fg, fontSize: 13 },
      extraCssText: `box-shadow:0 10px 30px -10px rgba(${dark ? "0,0,0,.6" : "0,44,82,.25"});border-radius:8px;max-width:${narrow ? 260 : 320}px;white-space:normal;`,
      confine: true,
    },
    categoryAxis: {
      axisLine: { show: true, lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { ...axisText, hideOverlap: true },
      splitLine: { show: false },
      nameTextStyle: axisText,
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: axisText,
      splitLine: { show: true, lineStyle: { color: t.grid } },
      nameTextStyle: axisText,
    },
    // Courbe de 2 px ; repère plein de 8 px au survol seulement (localizeOption le garde visible si la série le demande ou a un point isolé)
    line: { symbol: "circle", symbolSize: 8, showSymbol: false, lineStyle: { width: 2 }, label },
    bar: { label },
    pie: { label },
    scatter: { label },
  };
}

const NARROW = "(max-width: 639px)";
function subscribe(cb: () => void) {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const useNarrow = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
const noop = () => () => {};
// Le canevas n'est créé qu'après l'hydratation : il naît directement dans le bon thème (pas de double initialisation)
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

/* eslint-disable @typescript-eslint/no-explicit-any -- options ECharts hétérogènes, transformées sans connaître leur forme exacte */
type Any = any;
const mapOne = (x: Any, fn: (v: Any) => Any) => (x == null ? x : Array.isArray(x) ? x.map(fn) : fn(x));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Valeur numérique d'un point (nombre, tableau [x, y, v] avec encode, ou objet { value })
function pointValue(p: Any): unknown {
  const v = p?.value;
  if (Array.isArray(v)) {
    const dim = p?.encode?.tooltip?.[0] ?? p?.encode?.x?.[0] ?? v.length - 1;
    return v[dim];
  }
  return v;
}

// Gabarits ECharts ({a} série, {b} nom, {c} valeur, {d} pourcentage, avec indice pour les infobulles d'axe) rendus au format français.
// {c} reste un nombre nu : l'unité éventuelle est déjà écrite dans le gabarit (« {c} % »).
function templateFn(tpl: string, numText: (v: unknown) => string, html = true) {
  if (!/\{[abcd]\d*\}/.test(tpl)) return tpl;
  const esc = html ? escapeHtml : (v: unknown) => String(v ?? "");
  return (params: Any) => {
    const list = Array.isArray(params) ? params : [params];
    return tpl.replace(/\{([abcd])(\d*)\}/g, (_m, k: string, i: string) => {
      const p = list[i === "" ? 0 : Number(i)];
      if (!p) return "";
      if (k === "a") return esc(p.seriesName);
      if (k === "b") return esc(p.name);
      if (k === "c") return numText(pointValue(p));
      return isNum(p.percent) ? frNumber(p.percent, 1) : "";
    });
  };
}

function axisTemplate(tpl: string) {
  return (v: unknown) => tpl.replace("{value}", isNum(v) ? frNumber(v) : String(v));
}

// Mention « Cliquer pour voir … » des points qui mènent à une vue filtrée (withDrill, ./drill.ts)
const drillHint = (list: Any[]) => {
  const hint = list.find((p) => typeof p?.data?.drillHint === "string")?.data.drillHint;
  return hint ? `<div style="margin-top:6px;font-size:12px">${escapeHtml(hint)}</div>` : "";
};

// Infobulle d'axe des graphiques construits par les helpers : texte précalculé (data.tip) prioritaire, points marqués skip ignorés
function axisTooltip(valueText: (v: unknown) => string) {
  return (params: Any) => {
    const list: Any[] = Array.isArray(params) ? params : [params];
    const head = list[0]?.axisValueLabel ?? list[0]?.name ?? "";
    const rows = list
      .filter((p) => !p?.data?.skip && pointValue(p) != null)
      .map((p) => {
        const text = p?.data?.tip != null ? escapeHtml(p.data.tip) : valueText(pointValue(p));
        return `<div style="display:flex;gap:12px;justify-content:space-between;align-items:baseline"><span>${p.marker ?? ""}${escapeHtml(p.seriesName)}</span><strong style="font-variant-numeric:tabular-nums">${text}</strong></div>`;
      });
    return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(head)}</div>${rows.join("")}${drillHint(list)}`;
  };
}

function itemTooltip(valueText: (v: unknown) => string) {
  return (p: Any) => {
    const text = p?.data?.tip != null ? escapeHtml(p.data.tip) : valueText(pointValue(p));
    const pct = p?.data?.tip == null && isNum(p?.percent) ? ` (${frNumber(p.percent, 1)} %)` : "";
    const name = p?.name || p?.seriesName;
    return `${p.marker ?? ""}${escapeHtml(name)} : <strong>${text}${pct}</strong>${drillHint([p])}`;
  };
}

/** Texte coupé en deux lignes au plus (entre deux mots) dans `width` px ; au-delà, la seconde ligne finit par « … ». */
export function twoLineLabel(text: string, width: number, font: string): string {
  const cut = (s: string) => echartsFormat.truncateText(s, width, font, "…");
  const words = text.trim().split(/\s+/);
  let first = words[0] ?? "";
  let k = 1;
  while (k < words.length && cut(`${first} ${words[k]}`) === `${first} ${words[k]}`) first = `${first} ${words[k++]}`;
  const rest = words.slice(k).join(" ");
  return rest ? `${cut(first)}\n${cut(rest)}` : cut(first);
}

const MOBILE_LABEL_WIDTH = 112;

function localizeAxis(axis: Any, defaultType: "category" | "value", narrow: boolean) {
  return mapOne(axis, (a: Any) => {
    const type = a?.type ?? defaultType;
    let axisLabel = a?.axisLabel;
    if (type === "value") {
      const f = axisLabel?.formatter;
      if (f == null) axisLabel = { ...axisLabel, formatter: (v: unknown) => (isNum(v) ? frNumber(v) : String(v)) };
      else if (typeof f === "string" && f.includes("{value}")) axisLabel = { ...axisLabel, formatter: axisTemplate(f) };
    } else if (type === "category" && narrow && isNum(axisLabel?.width) && axisLabel.width > 96) {
      // Mobile : libellés longs (départements) sur deux lignes au plus plutôt que tronqués à quelques lettres ; plus long encore,
      // « … » en fin de seconde ligne (le texte entier reste dans l'infobulle et le tableau). Libellés enrichis (rich) : inchangés.
      const f = axisLabel.formatter;
      const font = `${isNum(axisLabel.fontSize) ? axisLabel.fontSize : 12}px ${CHART_FONT}`;
      const raw = (v: unknown, i: number) => String(typeof f === "function" ? f(v, i) : typeof f === "string" ? f.replace("{value}", String(v)) : (v ?? ""));
      axisLabel = {
        ...axisLabel,
        width: MOBILE_LABEL_WIDTH,
        overflow: "break",
        lineHeight: 14,
        height: 28,
        lineOverflow: "truncate",
        ...(axisLabel.rich ? {} : { formatter: (v: unknown, i: number) => twoLineLabel(raw(v, i), MOBILE_LABEL_WIDTH, font) }),
      };
    }
    // Mobile : barres horizontales, un nom par barre (jamais une étiquette sur deux) ; axe de valeurs à 4 graduations au plus
    // (hideOverlap coupé : la boîte d'étiquette sur deux lignes déborde sur la barre voisine et ECharts en masquait une sur deux)
    if (narrow && type === "category" && defaultType === "value" && axisLabel?.interval == null) axisLabel = { ...axisLabel, interval: 0, hideOverlap: axisLabel?.hideOverlap ?? false };
    if (narrow && type === "value" && a?.splitNumber == null) return { ...a, axisLabel, splitNumber: 4 };
    return axisLabel === a?.axisLabel ? a : { ...a, axisLabel };
  });
}

// Séries dont l'étiquette par défaut est la valeur (les autres, comme les secteurs, affichent un nom : laissées telles quelles)
const VALUE_LABEL = new Set(["bar", "line", "scatter", "heatmap", "markLine"]);

const visibleSymbol = (v: unknown) => v != null && v !== "none";
const declaresSymbol = (s: Any) =>
  visibleSymbol(s.symbol) || s.symbolSize != null || (Array.isArray(s.data) && s.data.some((d: Any) => d && typeof d === "object" && !Array.isArray(d) && visibleSymbol(d.symbol)));

function localizeLabel(label: Any, numText: (v: unknown) => string, shortText: (v: unknown) => string, type = "bar") {
  if (!label || label.show === false) return label;
  const f = label.formatter;
  if (f == null && !VALUE_LABEL.has(type)) return label;
  if (f == null) return { ...label, formatter: (p: Any) => (p?.data?.labelText != null ? String(p.data.labelText) : shortText(pointValue(p))) };
  if (typeof f === "string") return { ...label, formatter: templateFn(f, numText, false) };
  return label;
}

// Transforme une option sérialisable en option affichée : formats français, infobulles lisibles, adaptation mobile
export function localizeOption(option: EChartsOption, format?: ValueFormat, narrow = false): EChartsOption {
  const o: Any = { ...option };
  const valueText = (v: unknown) => (isNum(v) ? (format ? formatValue(v, format) : frNumber(v)) : v == null ? "—" : escapeHtml(v));
  const shortText = (v: unknown) => (isNum(v) ? (format ? formatShort(v, format) : frNumber(v)) : "");
  const numText = (v: unknown) => (isNum(v) ? frNumber(v, format ? (format.digits ?? defaultDigits(format.unit)) : undefined) : String(v ?? ""));

  o.tooltip = mapOne(o.tooltip, (t: Any) => {
    if (typeof t?.formatter === "string") return { ...t, formatter: templateFn(t.formatter, numText) };
    if (t?.formatter != null) return t;
    if (format) return { ...t, formatter: t?.trigger === "axis" ? axisTooltip(valueText) : itemTooltip(valueText) };
    return t?.valueFormatter != null ? t : { ...t, valueFormatter: (v: unknown) => (Array.isArray(v) ? v.map(valueText).join(" – ") : valueText(v)) };
  });
  o.xAxis = localizeAxis(o.xAxis, "category", narrow);
  o.yAxis = localizeAxis(o.yAxis, "value", narrow);

  o.series = mapOne(o.series, (s: Any) => {
    const next: Any = { ...s };
    // Repères masqués par défaut (thème) : gardés pour une série qui les règle (symbol, symbolSize, repère propre à un point)
    // ou qui a un point isolé, invisible sans repère
    if (s?.type === "line" && s.showSymbol == null && (declaresSymbol(s) || hasIsolatedPoint(s.data))) next.showSymbol = true;
    next.label = localizeLabel(s?.label, numText, shortText, s?.type ?? "line");
    if (typeof s?.endLabel?.formatter === "string") next.endLabel = localizeLabel(s.endLabel, numText, shortText);
    if (s?.markLine) next.markLine = { ...s.markLine, label: localizeLabel({ show: true, ...s.markLine.label }, numText, shortText, "markLine") };
    if (s?.type === "gauge" && typeof s?.detail?.formatter === "string") next.detail = { ...s.detail, formatter: axisTemplate(s.detail.formatter) };
    return next;
  });

  // Légende en haut + nom d'axe vertical au-dessus de l'axe : la grille descend pour qu'ils ne se chevauchent pas
  const legendOnTop = [o.legend].flat().some((l: Any) => l && l.show !== false && l.bottom == null && l.orient !== "vertical" && (l.top == null || l.top === 0 || l.top === "top"));
  const yNamedOnTop = [o.yAxis].flat().some((a: Any) => a?.name && (a.nameLocation ?? "end") === "end");
  if (!narrow && legendOnTop && yNamedOnTop) o.grid = mapOne(o.grid, (g: Any) => (isNum(g?.top) && g.top < 60 ? { ...g, top: 60 } : g));

  const lv = format?.legendValues;
  if (lv) o.legend = mapOne(o.legend, (l: Any) => (l?.formatter != null ? l : { ...l, formatter: (name: string) => (lv[name] ? `${name}  ${lv[name]}` : name) }));

  if (narrow) {
    // Légende en bas, sur plusieurs lignes si besoin (estimation : 7 px par caractère, 340 px utiles) ; la grille s'ajuste
    let moved = 0;
    const seriesNames = [o.series].flat().map((x: Any) => x?.name).filter(Boolean);
    o.legend = mapOne(o.legend, (l: Any) => {
      if (!l || l.show === false || l.bottom != null || l.top === "bottom") return l;
      const names: string[] = (Array.isArray(l.data) ? l.data.map((d: Any) => (typeof d === "string" ? d : d?.name)) : seriesNames).filter(Boolean);
      const width = names.reduce((w, n) => w + String(n).length * 7 + (lv?.[n] ? lv[n].length * 7 : 0) + 34, 0);
      const lines = Math.min(3, Math.max(1, Math.ceil(width / 340)));
      moved = lines * 22 + 6;
      return { ...l, top: undefined, bottom: 0, left: "center", right: undefined, orient: "horizontal", type: "plain" };
    });
    if (moved)
      o.grid = mapOne(o.grid, (g: Any) => ({
        ...g,
        top: isNum(g?.top) ? Math.max(16, g.top - 28) : g?.top,
        bottom: (isNum(g?.bottom) ? g.bottom : 28) + moved,
      }));
  }
  return o;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Filtrage croisé : un point qui porte un href interne (withDrill) ouvre la vue filtrée
const internalHref = (v: unknown): v is string => typeof v === "string" && v.startsWith("/") && !v.startsWith("//");
/* eslint-disable @typescript-eslint/no-explicit-any -- séries ECharts hétérogènes */
// Nœuds imbriqués compris (carte des équipes : href portés par les équipes, dans `children`)
const nodeHasDrill = (d: any): boolean => !!d && typeof d === "object" && (internalHref(d.href) || (Array.isArray(d.children) && d.children.some(nodeHasDrill)));
const hasDrill = (o: EChartsOption) => [o.series].flat().some((s: any) => Array.isArray(s?.data) && s.data.some(nodeHasDrill));
/* eslint-enable @typescript-eslint/no-explicit-any */

// Routeur monté seulement pour un graphique cliquable : les autres graphiques n'en dépendent pas (rendu hors App Router, tests)
function DrillRouter({ targetRef }: { targetRef: RefObject<((href: string) => void) | null> }) {
  const router = useRouter();
  useEffect(() => {
    targetRef.current = (href) => router.push(href);
    return () => {
      targetRef.current = null;
    };
  }, [router, targetRef]);
  return null;
}

const horizontal = (o: EChartsOption) => [o.yAxis].flat().some((a) => (a as { type?: string } | undefined)?.type === "category");

export function EChart({
  option,
  height = 280,
  mobileHeight,
  ariaLabel,
  format,
  onEvents,
}: {
  option: EChartsOption;
  height?: number;
  /** Hauteur sous 640 px ; par défaut 85 % sans descendre sous 240 px (barres horizontales : inchangée, chaque ligne garde sa place). */
  mobileHeight?: number;
  ariaLabel: string;
  /** Format des valeurs (unité, décimales) des infobulles et étiquettes ; rempli par les helpers de pbi.tsx. */
  format?: ValueFormat;
  /** Événements ECharts (composant client uniquement) : `onEvents={{ click: (p) => … }}`. */
  onEvents?: ComponentProps<typeof ReactECharts>["onEvents"];
}) {
  const narrow = useNarrow();
  const hydrated = useHydrated();
  const dark = useTheme().resolvedTheme === "dark";
  const theme = useMemo(() => (hydrated ? chartTheme(readChartTokens(dark), dark, narrow) : null), [hydrated, dark, narrow]);
  const shown = useMemo(() => localizeOption(dark ? darkOption(option) : option, format, narrow), [option, format, narrow, dark]);
  const drillable = useMemo(() => hasDrill(option), [option]);
  const pushRef = useRef<((href: string) => void) | null>(null);
  // Objet mémoïsé : echarts-for-react relie de nouveau les événements à chaque changement de référence
  const events = useMemo(() => {
    const drill = (p: { data?: { href?: unknown } }) => {
      const href = p?.data?.href;
      if (!internalHref(href)) return;
      if (pushRef.current) pushRef.current(href);
      else window.location.assign(href);
    };
    return {
      ...onEvents,
      click: (p: { data?: { href?: unknown } }, chart: unknown) => {
        onEvents?.click?.(p, chart);
        drill(p);
      },
    };
  }, [onEvents]);
  // Mobile : hauteur légèrement réduite (pas en dessous de 240 px, la légende passe en bas et prend de la place)
  const h = narrow ? (mobileHeight ?? (horizontal(option) ? height : Math.min(height, Math.max(240, Math.round(height * 0.85))))) : height;
  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0 overflow-hidden">
      {drillable && <DrillRouter targetRef={pushRef} />}
      {theme ? (
        <ReactECharts key={dark ? "sombre" : "clair"} option={shown} theme={theme} style={{ height: h, width: "100%" }} notMerge onEvents={events} />
      ) : (
        <div aria-hidden="true" className="animate-pulse rounded-control bg-surface-3" style={{ height: h }} />
      )}
    </div>
  );
}

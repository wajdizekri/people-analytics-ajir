import type { EChartsOption } from "echarts";
import { AXIS, GRID, LEGEND, TOOLTIP_AXIS, bulletChart, type ChartSpec, type Status } from "@/components/charts/pbi";
import { CHART_INK, RISK_COLORS, SEMANTIC, frNumber } from "@/components/charts/theme";
import type {
  EstimateBinDTO,
  ImportPointDTO,
  JobTypeStatsDTO,
  RuleRejectionDTO,
  RunPointDTO,
} from "@/lib/dal/data-monitoring";

// Options sérialisables (aucune fonction) construites côté serveur ; formats français posés par EChart (prop format)
// ou précalculés dans les étiquettes. Couleurs : sémantique fixe de la charte (theme.ts), écrites pour le thème clair ;
// EChart les remplace en thème sombre (DARK_COLORS de theme.ts) : n'employer ici que des couleurs de cette table
// (un aplat translucide s'écrit couleur + opacity, jamais en rgba).

type JobStatus = keyof JobTypeStatsDTO["byStatus"];
type Tone = { tone: Status; label: string };

export const nf = (n: number, digits = 1) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
const NBSP = " ";
const INK = CHART_INK.ink;
// Espace insécable des textes repris dans les infobulles (HTML) : un nombre n'y est jamais séparé de son unité
const NB = String.fromCharCode(160);
const pctText = (ratio: number, digits = 1) => `${frNumber(ratio * 100, digits)}${NB}%`;

export const JOB_TYPE_LABEL: Record<string, string> = {
  IMPORT: "Import",
  AGGREGATE: "Agrégats",
  FEATURES: "Variables",
  SCORING: "Calcul des risques",
  ANOMALIES: "Anomalies",
  BATCH_MENSUEL: "Calcul mensuel",
};

// Mêmes couleurs que la console d'administration : terminé en neutre, attente et exécution en attention, échec en défavorable
// (un vert et un rouge qui se touchent dans une barre empilée ne se distinguent pas pour un lecteur daltonien)
export const JOB_STATUS_STYLE: Record<JobStatus, { label: string; color: string }> = {
  TERMINE: { label: "Terminé", color: SEMANTIC.neutre },
  ECHEC: { label: "Échec", color: SEMANTIC.defavorable },
  EN_COURS: { label: "En cours", color: SEMANTIC.attention },
  EN_FILE: { label: "En file", color: SEMANTIC.attention },
};
// Segments de la barre empilée, du bas vers le haut ; le détail des quatre statuts reste dans le tableau « Voir les données »
export const JOB_PARTS: { label: string; color: string; statuses: JobStatus[] }[] = [
  { label: "Terminé", color: SEMANTIC.neutre, statuses: ["TERMINE"] },
  { label: "En file ou en cours", color: SEMANTIC.attention, statuses: ["EN_FILE", "EN_COURS"] },
  { label: "Échec", color: SEMANTIC.defavorable, statuses: ["ECHEC"] },
];

// Effet d'un contrôle sur la ligne : rejet en défavorable, correction en attention, avertissement en gris de référence
export const SEVERITY_STYLE: Record<RuleRejectionDTO["severity"], { label: string; color: string }> = {
  REJET: { label: "Rejet (ligne écartée)", color: SEMANTIC.defavorable },
  CORRECTION: { label: "Correction (ligne corrigée)", color: SEMANTIC.attention },
  AVERTISSEMENT: { label: "Avertissement (ligne importée)", color: SEMANTIC.reference },
};
const OTHER_SEVERITY = { label: "Autre contrôle", color: SEMANTIC.contexte };
export const severityStyle = (severity: string): { label: string; color: string } =>
  (SEVERITY_STYLE as Record<string, { label: string; color: string } | undefined>)[severity] ?? OTHER_SEVERITY;

export const IMPORT_STATUS: Record<ImportPointDTO["status"], { label: string; tone: "success" | "danger" | "info" }> = {
  OK: { label: "Conforme", tone: "success" },
  BLOQUE: { label: "Bloqué", tone: "danger" },
  ECHEC: { label: "Échec", tone: "danger" },
  EN_COURS: { label: "En cours", tone: "info" },
};

export const LEVEL_STYLE = [
  { key: "ELEVE", label: "Élevé", color: RISK_COLORS.ELEVE },
  { key: "MOYEN", label: "Moyen", color: RISK_COLORS.MOYEN },
  { key: "FAIBLE", label: "Faible", color: RISK_COLORS.FAIBLE },
] as const;

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const importLabel = (i: ImportPointDTO) => `${i.startedAt.slice(8, 10)}/${i.startedAt.slice(5, 7)} · n° ${i.id}`;
// Libellé d'axe sur deux lignes (date puis numéro) : assez étroit pour que chaque import garde le sien
const importAxisLabel = (i: ImportPointDTO) => `${i.startedAt.slice(8, 10)}/${i.startedAt.slice(5, 7)}\nn° ${i.id}`;
export const runLabel = (r: RunPointDTO) => `${MONTHS[Number(r.asOf.slice(5, 7)) - 1]} ${r.asOf.slice(0, 4)}`;
export const binLabel = (b: EstimateBinDTO) =>
  b.to == null ? `${nf(b.from * 100)} % et plus` : `${nf(b.from * 100)} à ${nf(b.to * 100)} %`;

export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 90) return `${nf(sec, 0)} s`;
  if (sec < 5400) return `${nf(sec / 60)} min`;
  return `${nf(sec / 3600)} h`;
}

// Bandes : sous le seuil = critique ; entre le seuil et la mi-distance à 100 % = attention ; au-delà = bon
export function qualityBands(threshold: number) {
  const crit = Math.round(threshold * 1000) / 10;
  return { crit, warn: Math.round((crit + (100 - crit) / 2) * 10) / 10 };
}

export function qualityStatus(score: number | null, threshold: number, status?: ImportPointDTO["status"]): Tone | undefined {
  if (status === "ECHEC") return { tone: "critique", label: "Échec" };
  if (score == null) return undefined;
  const { crit, warn } = qualityBands(threshold);
  const v = score * 100;
  return v < crit ? { tone: "critique", label: "Sous le seuil" } : v < warn ? { tone: "attention", label: "Proche du seuil" } : { tone: "bon", label: "Conforme" };
}

const valueAxis = (name?: string) => ({
  type: "value" as const,
  ...AXIS,
  ...(name ? { name, nameLocation: "middle" as const, nameGap: 34, nameTextStyle: { color: CHART_INK.muted, fontSize: 11 } } : {}),
});
const pctAxis = () => ({ ...valueAxis(), axisLabel: { ...AXIS.axisLabel, formatter: "{value} %" } });
const categoryAxis = (data: string[]) => ({
  type: "category" as const,
  data,
  ...AXIS,
  axisLabel: { ...AXIS.axisLabel, hideOverlap: true },
});

// Arrondi 4 px sur le segment non nul le plus haut de chaque pile (côté valeur)
function stackTop(values: number[][], radius: [number, number, number, number]) {
  const top = values[0].map((_, i) => values.reduce((t, s, k) => (s[i] > 0 ? k : t), -1));
  return values.map((s, k) => s.map((v, i) => (k === top[i] ? { value: v, itemStyle: { borderRadius: radius } } : v)));
}

// Arrondi « agréable » vers le haut : 1, 2, 2,5 ou 5 × 10^n
function niceCeil(v: number) {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((k) => k * p >= v) ?? 10) * p;
}

const lastIndex = (values: (number | null)[]) => values.reduce<number>((last, v, k) => (v != null ? k : last), -1);
// Étiquette à liseré de la couleur du fond : reste lisible quand elle croise une courbe ou une limite de zone
const HALO = { color: INK, fontSize: 11, textBorderColor: CHART_INK.surface, textBorderWidth: 3 };
const scorePct = (score: number) => Math.round(score * 1000) / 10;

// ---------- Santé des données : qualité des imports ----------

// En dessous de 3 imports, une courbe n'a pas de sens : la page affiche une barre de niveau par import (qualityMarks)
export const TREND_MIN_IMPORTS = 3;

// Échelle du score qualité : bornes rondes qui encadrent le seuil et la plus basse valeur (90 à 100 % le plus souvent)
export function qualityScale(scores: (number | null)[], threshold: number) {
  const t = scorePct(threshold);
  const low = Math.min(t, ...scores.filter((v): v is number => v != null).map(scorePct));
  return { min: Math.max(0, Math.floor((low - 2) / 5) * 5), max: 100, threshold: t };
}

// Score qualité (%) par import : dernier point étiqueté, imports sous le seuil en rouge, seuil annoté en bout de ligne (hors du tracé).
// L'étiquette du dernier point et celle du seuil sont posées de part et d'autre de la ligne de seuil : elles ne se chevauchent jamais.
export function qualityTrendOption(imports: ImportPointDTO[], threshold: number): EChartsOption {
  const scale = qualityScale(imports.map((i) => i.qualityScore), threshold);
  const values = imports.map((i) => (i.qualityScore == null ? null : scorePct(i.qualityScore)));
  const last = lastIndex(values);
  const below = last >= 0 && (values[last] ?? 0) < scale.threshold;
  return {
    grid: { ...GRID, left: 56, right: 116, top: 20, bottom: 44 },
    tooltip: TOOLTIP_AXIS,
    xAxis: { ...categoryAxis(imports.map(importAxisLabel)), boundaryGap: false },
    // Pas de graduation qui divise l'étendue : 100 % tombe sur une graduation (pas de libellés superposés en haut d'axe)
    yAxis: { ...pctAxis(), min: scale.min, max: scale.max, interval: (scale.max - scale.min) / 5 },
    series: [
      {
        name: "Score qualité",
        type: "line",
        connectNulls: false,
        symbol: "circle",
        symbolSize: 10,
        lineStyle: { width: 2, color: SEMANTIC.neutre },
        itemStyle: { color: SEMANTIC.neutre, borderColor: CHART_INK.surface, borderWidth: 2 },
        data: values.map((v, k) =>
          v == null
            ? null
            : {
                value: v,
                ...(v < scale.threshold ? { itemStyle: { color: SEMANTIC.defavorable, borderColor: CHART_INK.surface, borderWidth: 2 } } : {}),
                ...(k === last ? { label: { show: true, position: below ? ("bottom" as const) : ("top" as const), ...HALO, formatter: `${frNumber(v, 1)}${NB}%` } } : {}),
              },
        ),
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { type: "dashed", width: 1.5, color: SEMANTIC.defavorable },
          label: {
            formatter: `Seuil de blocage : ${nf(scale.threshold)}${NB}%`,
            position: "end",
            distance: 6,
            width: 100,
            overflow: "break",
            lineHeight: 14,
            verticalAlign: below ? "bottom" : "top",
            color: INK,
            fontSize: 11,
          },
          data: [{ yAxis: scale.threshold }],
        },
      },
    ],
  };
}

// Part des lignes rejetées (%) par import : lisible même quand les volumes sont très inégaux
export function rejectedShareOption(imports: ImportPointDTO[]): EChartsOption {
  return {
    grid: { ...GRID, left: 56, right: 24, top: 20, bottom: 44 },
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: categoryAxis(imports.map(importAxisLabel)),
    yAxis: { ...pctAxis(), min: 0 },
    series: [
      {
        name: "Lignes rejetées",
        type: "bar",
        barMaxWidth: 24,
        itemStyle: { color: SEMANTIC.neutre, borderRadius: [4, 4, 0, 0] },
        label: { show: imports.length <= 12, position: "top", color: INK, fontSize: 11 },
        data: imports.map((i) => (i.rowsOk + i.rowsRejected ? Math.round((i.rowsRejected / (i.rowsOk + i.rowsRejected)) * 10000) / 100 : null)),
      },
    ],
  };
}

export type QualityMark = { id: number; startedAt: string; spec: ChartSpec; rejected: number; read: number };

// Moins de 3 imports : une barre de niveau par import (score face au seuil de blocage, sur l'échelle de la courbe et avec
// les zones de qualityStatus), du plus récent au plus ancien
export function qualityMarks(imports: ImportPointDTO[], threshold: number): QualityMark[] {
  const scale = qualityScale(imports.map((i) => i.qualityScore), threshold);
  const { crit, warn } = qualityBands(threshold);
  return [...imports].reverse().map((i) => ({
    id: i.id,
    startedAt: i.startedAt,
    spec: bulletChart({
      value: i.qualityScore == null ? null : scorePct(i.qualityScore),
      measure: "Score qualité",
      unit: "%",
      digits: 1,
      min: scale.min,
      max: scale.max,
      target: { value: scale.threshold, label: "Seuil de blocage" },
      bands: [
        { to: crit, tone: "critique", label: "Sous le seuil" },
        { to: warn, tone: "attention", label: "Proche du seuil" },
        { to: scale.max, tone: "bon", label: "Conforme" },
      ],
      emptyLabel: "Import sans score",
    }),
    rejected: i.rowsRejected,
    read: i.rowsOk + i.rowsRejected,
  }));
}

// ---------- Santé des données : contrôles ----------

export type ControlRow = { rule: string; label: string; severity: string; n: number };
export type ControlShare = ControlRow & { share: number };

// Contrôles du plus signalé au moins signalé, avec leur part des lignes signalées
export function controlShares(rows: ControlRow[]): ControlShare[] {
  const total = rows.reduce((s, r) => s + r.n, 0);
  return [...rows].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "fr")).map((r) => ({ ...r, share: total ? r.n / total : 0 }));
}

export const PARETO_BARS = 10;

// Pareto des contrôles : barres horizontales triées, couleur = effet sur la ligne, nombre et part écrits au bout de chaque barre.
// Au-delà de PARETO_BARS contrôles, les moins signalés sont regroupés (le tableau des contrôles garde le détail).
export function controlsParetoOption(rows: ControlRow[]): EChartsOption {
  const shares = controlShares(rows);
  const head = shares.length > PARETO_BARS ? shares.slice(0, PARETO_BARS - 1) : shares;
  const tail = shares.slice(head.length);
  const bars = head.map((r) => ({ name: r.label, n: r.n, share: r.share, ...severityStyle(r.severity) }));
  if (tail.length)
    bars.push({
      name: `${tail.length} autres contrôles`,
      n: tail.reduce((s, r) => s + r.n, 0),
      share: tail.reduce((s, r) => s + r.share, 0),
      label: "Effets divers",
      color: SEMANTIC.contexte,
    });
  return {
    grid: { left: 8, right: 112, top: 4, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: { ...valueAxis(), show: false, min: 0 },
    yAxis: {
      type: "category",
      data: bars.map((b) => b.name),
      inverse: true,
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, color: INK, width: 230, overflow: "break", lineHeight: 15, interval: 0 },
      splitLine: { show: false },
    },
    series: [
      {
        name: "Lignes signalées",
        type: "bar",
        barMaxWidth: 18,
        data: bars.map((b) => {
          const text = `${frNumber(b.n, 0)} (${pctText(b.share)})`;
          return {
            value: b.n,
            itemStyle: { color: b.color, borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: "right" as const, color: INK, fontSize: 11, formatter: text },
            tip: `${text} · ${b.label}`,
          };
        }),
      },
    ],
  };
}

// Cumul sur 90 jours : même lecture que le Pareto d'un import
export const rejectionsByRuleOption = (rows: RuleRejectionDTO[]): EChartsOption => controlsParetoOption(rows);

// ---------- Santé des données : traitements ----------

export function jobsByStatusOption(jobs: JobTypeStatsDTO[]): EChartsOption {
  const count = (j: JobTypeStatsDTO, statuses: JobStatus[]) => statuses.reduce((s, status) => s + j.byStatus[status], 0);
  const parts = JOB_PARTS.filter((p) => jobs.some((j) => count(j, p.statuses) > 0));
  const data = stackTop(parts.map((p) => jobs.map((j) => count(j, p.statuses))), [4, 4, 0, 0]);
  return {
    grid: GRID,
    legend: LEGEND,
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: categoryAxis(jobs.map((j) => JOB_TYPE_LABEL[j.type] ?? j.type)),
    yAxis: { ...valueAxis(), minInterval: 1 },
    series: parts.map((p, k) => ({
      name: p.label,
      type: "bar",
      stack: "jobs",
      barMaxWidth: 24,
      itemStyle: { color: p.color, borderColor: CHART_INK.surface, borderWidth: 1 },
      data: data[k],
    })),
  };
}

export function jobDurationOption(jobs: JobTypeStatsDTO[]): EChartsOption {
  const rows = jobs.filter((j) => j.avgDurationSec != null);
  const inMinutes = rows.some((j) => j.avgDurationSec! >= 120);
  const unit = inMinutes ? "min" : "s";
  return {
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: { ...valueAxis(), show: false },
    yAxis: { type: "category", data: rows.map((j) => JOB_TYPE_LABEL[j.type] ?? j.type), inverse: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, interval: 0 }, splitLine: { show: false } },
    series: [
      {
        name: `Durée moyenne (${unit})`,
        type: "bar",
        barMaxWidth: 18,
        itemStyle: { color: SEMANTIC.neutre, borderRadius: [0, 4, 4, 0] },
        data: rows.map((j) => {
          const v = Math.round((inMinutes ? j.avgDurationSec! / 60 : j.avgDurationSec!) * 10) / 10;
          return { value: v, label: { show: true, position: "right", color: INK, fontSize: 11, formatter: `${frNumber(v, inMinutes ? 1 : 0)}${NBSP}${unit}` } };
        }),
      },
    ],
  };
}

// ---------- Dérive des données ----------

type DriftTone = "bon" | "attention" | "critique";
type ZoneArea = [{ name: string; xAxis: number; itemStyle: { color: string; opacity: number } }, { xAxis: number }];
const DRIFT_COLOR: Record<DriftTone, string> = { bon: SEMANTIC.favorable, attention: SEMANTIC.attention, critique: SEMANTIC.defavorable };
export const psiText = (psi: number) => frNumber(psi, psi >= 10 ? 1 : 2);

// Échelle en trois zones de même largeur : stable (0 à 1), à surveiller (1 à 2), dérive forte (2 à 3).
// Un indice est linéaire dans sa zone ; les seuils restent lisibles même quand une variable atteint 4 ou 5 (seuil fort : 0,25).
export function driftZoneScale(thresholds: { moderate: number; strong: number }, maxPsi: number) {
  const top = Math.max(thresholds.strong * 2, niceCeil(maxPsi));
  const at = (psi: number) =>
    psi < thresholds.moderate
      ? Math.max(0, psi) / thresholds.moderate
      : psi < thresholds.strong
        ? 1 + (psi - thresholds.moderate) / (thresholds.strong - thresholds.moderate)
        : 2 + Math.min(1, (psi - thresholds.strong) / (top - thresholds.strong));
  return { top, at };
}

// Dérive : indice de changement (PSI) par variable, trié ; zones de seuil nommées, couleur du statut, valeur écrite si la variable a changé
export function driftBarsOption(
  rows: { label: string; psi: number; tone: DriftTone; status: string }[],
  thresholds: { moderate: number; strong: number },
): EChartsOption {
  const sorted = [...rows].sort((a, b) => b.psi - a.psi || a.label.localeCompare(b.label, "fr"));
  const { at } = driftZoneScale(thresholds, Math.max(0, ...sorted.map((r) => r.psi)));
  const zone = (name: string, from: number, color: string): ZoneArea => [{ name, xAxis: from, itemStyle: { color, opacity: 0.1 } }, { xAxis: from + 1 }];
  return {
    grid: { left: 8, right: 34, top: 42, bottom: 8, containLabel: true },
    tooltip: { ...TOOLTIP_AXIS, axisPointer: { type: "shadow" } },
    xAxis: { type: "value", min: 0, max: 3, interval: 1, show: false },
    yAxis: {
      type: "category",
      data: sorted.map((r) => r.label),
      inverse: true,
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, color: INK, width: 210, overflow: "break", lineHeight: 14, interval: 0 },
      splitLine: { show: false },
    },
    series: [
      {
        name: "Indice de changement",
        type: "bar",
        barMaxWidth: 12,
        data: sorted.map((r) => ({
          value: Math.round(at(r.psi) * 1000) / 1000,
          itemStyle: { color: DRIFT_COLOR[r.tone], borderRadius: [0, 3, 3, 0] },
          label: { show: r.tone !== "bon", position: "right" as const, ...HALO, formatter: psiText(r.psi) },
          tip: `Indice ${psiText(r.psi)} · ${r.status}`,
        })),
        markArea: {
          silent: true,
          label: { position: "top", distance: 6, color: INK, fontSize: 11, lineHeight: 14 },
          data: [
            zone(`Stable\n< ${psiText(thresholds.moderate)}`, 0, SEMANTIC.favorable),
            zone(`À surveiller\n${psiText(thresholds.moderate)} à ${psiText(thresholds.strong)}`, 1, SEMANTIC.attention),
            zone(`Dérive\n≥ ${psiText(thresholds.strong)}`, 2, SEMANTIC.defavorable),
          ],
        },
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { type: "dashed", width: 1, color: SEMANTIC.reference },
          label: { show: false },
          data: [{ xAxis: 1 }, { xAxis: 2 }],
        },
      },
    ],
  };
}

// ---------- Dérive : démissions observées et prévues ----------

// Dérive (vue RH) : taux de démission observé contre taux prévu, par cohorte mensuelle (valeurs en %)
export function observedExpectedOption(labels: string[], observed: (number | null)[], expected: (number | null)[], expectedName: string): EChartsOption {
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);
  return {
    grid: { ...GRID, left: 48, right: 24 },
    legend: LEGEND,
    tooltip: TOOLTIP_AXIS,
    xAxis: { ...categoryAxis(labels), boundaryGap: false },
    yAxis: { ...pctAxis(), min: 0 },
    series: [
      {
        name: "Taux observé",
        type: "line",
        data: observed.map(pct),
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: SEMANTIC.neutre },
        itemStyle: { color: SEMANTIC.neutre },
      },
      {
        name: expectedName,
        type: "line",
        data: expected.map(pct),
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, type: "dashed", color: SEMANTIC.reference },
        itemStyle: { color: SEMANTIC.reference },
      },
    ],
  };
}

// Dérive : rapport observé / prévu par cohorte, zone cible nommée (aplat vert), cohortes hors cible en ambre, 1 = autant que prévu
export function oeTargetOption(labels: string[], oe: (number | null)[], target: [number, number]): EChartsOption {
  const values = oe.map((v) => (v == null ? null : Math.round(v * 100) / 100));
  const known = values.filter((v): v is number => v != null);
  const low = Math.min(target[0], ...known);
  const high = Math.max(target[1], ...known);
  const step = high - low <= 1.5 ? 0.25 : high - low <= 3 ? 0.5 : 1;
  const last = lastIndex(values);
  // Étiquette du dernier point posée du côté opposé au segment qui y arrive
  const falling = last > 0 && (values[last - 1] ?? 0) > (values[last] ?? 0);
  const inTarget = (v: number) => v >= target[0] && v <= target[1];
  return {
    grid: { ...GRID, left: 48, right: 112, top: 20 },
    tooltip: TOOLTIP_AXIS,
    xAxis: { ...categoryAxis(labels), boundaryGap: false },
    yAxis: { ...valueAxis(), min: Math.max(0, Math.floor((low - 0.1) / step) * step), max: Math.ceil((high + 0.1) / step) * step, interval: step },
    series: [
      {
        name: "Observé / prévu",
        type: "line",
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2, color: SEMANTIC.neutre },
        itemStyle: { color: SEMANTIC.neutre },
        data: values.map((v, k) =>
          v == null
            ? null
            : {
                value: v,
                tip: `${frNumber(v, 2)} · ${inTarget(v) ? "dans la zone cible" : "hors de la zone cible"}`,
                ...(inTarget(v) ? {} : { itemStyle: { color: SEMANTIC.attention } }),
                ...(k === last ? { label: { show: true, position: falling ? ("bottom" as const) : ("top" as const), ...HALO, formatter: frNumber(v, 2) } } : {}),
              },
        ),
        markArea: {
          silent: true,
          itemStyle: { color: SEMANTIC.favorable, opacity: 0.12 },
          label: {
            show: true,
            position: "right",
            distance: 20,
            color: INK,
            fontSize: 11,
            lineHeight: 14,
            formatter: `Zone cible\n${frNumber(target[0], 2)} à ${frNumber(target[1], 2)}`,
          },
          data: [[{ yAxis: target[0] }, { yAxis: target[1] }]],
        },
        markLine: { symbol: "none", silent: true, lineStyle: { type: "dashed", width: 1, color: SEMANTIC.reference }, label: { show: false }, data: [{ yAxis: 1 }] },
      },
    ],
  };
}

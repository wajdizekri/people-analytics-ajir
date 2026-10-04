import type { LineSeriesOption } from "echarts";
import type { Role } from "@/db/schema";
import type { AdminMonitoringDTO, DailyActivity, JobStats, JobStatus, JobType } from "@/lib/dal/monitoring";
import { SEMANTIC, barChart, frNumber, lineChart, stackedBarChart, type ChartSpec, type Tone } from "@/components/charts/pbi";
import { CHART_INK } from "@/components/charts/theme";
import { withDrillSpec, type DrillSpec } from "@/components/charts/drill";
import { actionLabel } from "@/components/admin/audit-labels";

// Visuels de la console d'administration : ChartSpec sérialisables (aucune fonction) construits avec les helpers du kit.
// Aucune couleur écrite ici : tons sémantiques, encre et surface du kit, remappés en sombre par darkOption.

export const plural = (n: number, one: string, many: string) => `${frNumber(n)} ${n > 1 ? many : one}`;

const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fullDay = (iso: string) => `${dayLabel(iso)}/${iso.slice(0, 4)}`;

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toLocaleString("fr-FR", { maximumFractionDigits: seconds < 10 ? 1 : 0 })} s`;
  const s = Math.round(seconds);
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

const ROLE_WORDS: Record<Role, [one: string, many: string]> = {
  MANAGER: ["manager", "managers"],
  RH: ["responsable RH", "responsables RH"],
  ADMIN: ["administrateur", "administrateurs"],
};

// Comptes par rôle en une ligne de chiffres, du plus nombreux au moins nombreux (trois valeurs ne justifient pas un graphique)
export function roleCounts(active: Record<Role, number>): string[] {
  return (Object.keys(ROLE_WORDS) as Role[]).sort((a, b) => active[b] - active[a]).map((r) => plural(active[r], ...ROLE_WORDS[r]));
}

export const AUTH_SERIES = { logins: "Connexions réussies", failed: "Échecs de connexion" } as const;

type Peak = { index: number; value: number };

function peakOf(values: number[]): Peak | null {
  const value = Math.max(0, ...values);
  return value > 0 ? { index: values.lastIndexOf(value), value } : null;
}

// Étiquette directe du maximum d'une série : pastille à anneau de surface, valeur au-dessus, détourée pour rester lisible sur une courbe ;
// les autres jours se lisent sur l'axe, l'infobulle et le tableau
const peakMark = (p: Peak, tone: Tone) => ({
  symbol: "circle",
  symbolSize: 10,
  silent: true,
  itemStyle: { color: SEMANTIC[tone], borderColor: CHART_INK.surface, borderWidth: 2 },
  label: { show: true, position: "top" as const, distance: 6, color: CHART_INK.ink, fontSize: 12, fontWeight: 600, textBorderColor: CHART_INK.surface, textBorderWidth: 3, formatter: frNumber(p.value) },
  data: [{ name: "Maximum", coord: [p.index, p.value] }],
});

export function authDailyChart(daily: DailyActivity[]): ChartSpec {
  const logins = daily.map((d) => d.logins);
  const failed = daily.map((d) => d.failedLogins);
  const top = peakOf(logins);
  const topFailed = peakOf(failed);
  // Deux maximums voisins et de même hauteur : leurs étiquettes se chevaucheraient, celle des réussites suffit
  const collide = !!top && !!topFailed && Math.abs(top.index - topFailed.index) <= 1 && Math.abs(top.value - topFailed.value) <= 0.15 * Math.max(top.value, topFailed.value);
  const marks: Record<string, ReturnType<typeof peakMark> | undefined> = {
    [AUTH_SERIES.logins]: top ? peakMark(top, "neutre") : undefined,
    [AUTH_SERIES.failed]: topFailed && !collide ? peakMark(topFailed, "defavorable") : undefined,
  };
  const spec = lineChart({
    categories: daily.map((d) => dayLabel(d.date)),
    series: [
      { name: AUTH_SERIES.logins, values: logins, tone: "neutre", area: true },
      { name: AUTH_SERIES.failed, values: failed, tone: "defavorable" },
    ],
    measure: "Connexions par jour",
    categoryName: "Jour",
  });
  const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
  const first = daily[0]?.date ?? "";
  const last = daily[daily.length - 1]?.date ?? "";
  return {
    ...spec,
    option: {
      ...spec.option,
      // Marge au-dessus du maximum : son étiquette ne touche ni le nom de l'axe ni la légende
      yAxis: { ...(spec.option.yAxis as object), minInterval: 1, boundaryGap: [0, "12%"] as [number, string] },
      series: (spec.option.series as LineSeriesOption[]).map((s) => {
        const markPoint = marks[String(s.name)];
        return markPoint ? { ...s, markPoint } : s;
      }),
    },
    ariaLabel: `Courbes par jour du ${fullDay(first)} au ${fullDay(last)} : ${plural(sum(logins), "connexion réussie", "connexions réussies")} et ${plural(sum(failed), "échec de connexion", "échecs de connexion")}.${
      top ? ` Maximum : ${plural(top.value, "connexion réussie", "connexions réussies")} le ${fullDay(daily[top.index].date)}.` : ""
    }`,
    table: {
      headers: ["Jour", AUTH_SERIES.logins, AUTH_SERIES.failed, "Refus d'accès"],
      rows: daily.map((d) => [fullDay(d.date), frNumber(d.logins), frNumber(d.failedLogins), frNumber(d.refusals)]),
    },
  };
}

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  IMPORT: "Import",
  AGGREGATE: "Agrégats",
  FEATURES: "Variables",
  SCORING: "Calcul des risques",
  ANOMALIES: "Anomalies",
  BATCH_MENSUEL: "Calcul mensuel",
};

const JOB_STATUS_LABEL: Record<JobStatus, string> = { TERMINE: "Terminé", EN_COURS: "En cours", EN_FILE: "En file", ECHEC: "Échec" };
const JOB_TABLE_STATUSES: JobStatus[] = ["TERMINE", "EN_COURS", "EN_FILE", "ECHEC"];

// Trois parts, sans vert : un vert et un rouge voisins se confondent pour un lecteur daltonien (validateur dataviz : ΔE 4,2).
// Terminé en neutre et échec en défavorable, comme les connexions ; le détail des quatre statuts reste dans le tableau.
export const JOB_PARTS: { label: string; tone: Tone; statuses: JobStatus[] }[] = [
  { label: "Terminé", tone: "neutre", statuses: ["TERMINE"] },
  { label: "En file ou en cours", tone: "attention", statuses: ["EN_FILE", "EN_COURS"] },
  { label: "Échec", tone: "defavorable", statuses: ["ECHEC"] },
];

export function jobsChart(jobs: JobStats[]): ChartSpec {
  const spec = stackedBarChart({
    rows: jobs.map((j) => ({ name: JOB_TYPE_LABEL[j.type], values: JOB_PARTS.map((p) => p.statuses.reduce((s, status) => s + j.counts[status], 0)) })),
    parts: JOB_PARTS.map(({ label, tone }) => ({ label, tone })),
    measure: "Nombre de traitements",
    sort: "none",
    categoryName: "Type de traitement",
  });
  return {
    ...spec,
    ariaLabel: `Barres empilées des traitements par type et statut : ${jobs.map((j) => `${JOB_TYPE_LABEL[j.type]} ${frNumber(j.total)}, dont ${frNumber(j.counts.ECHEC)} en échec`).join(" ; ")}.`,
    table: {
      headers: ["Type de traitement", ...JOB_TABLE_STATUSES.map((s) => JOB_STATUS_LABEL[s]), "Total", "Durée moyenne (terminés)"],
      rows: jobs.map((j) => [JOB_TYPE_LABEL[j.type], ...JOB_TABLE_STATUSES.map((s) => frNumber(j.counts[s])), frNumber(j.total), formatDuration(j.avgDurationSeconds)]),
    },
  };
}

export const auditRefusalsHref = (action?: string) => `/admin/audit?${new URLSearchParams({ outcome: "REFUSE", ...(action ? { action } : {}) })}`;

// Barres triées, une seule couleur ; un clic sur une barre (ou le lien du tableau) ouvre le journal filtré sur l'action
export function refusalsChart(rows: AdminMonitoringDTO["refusalsByAction"]): DrillSpec {
  const hrefs = new Map<string, string>();
  const bars = rows.map((r) => {
    const name = actionLabel(r.action);
    if (!hrefs.has(name)) hrefs.set(name, auditRefusalsHref(r.action));
    return { name, value: r.count };
  });
  const spec = barChart({ rows: bars, measure: "Nombre de refus", categoryName: "Action refusée", height: Math.max(140, bars.length * 44 + 56) });
  const y = spec.option.yAxis as { axisLabel?: object };
  // Libellés d'action sur deux lignes plutôt que tronqués
  const wrapped: ChartSpec = { ...spec, option: { ...spec.option, yAxis: { ...y, axisLabel: { ...y.axisLabel, overflow: "break" as const, lineHeight: 14 } } } };
  return withDrillSpec(wrapped, (name) => hrefs.get(name), "Cliquer pour voir ces refus dans le journal");
}

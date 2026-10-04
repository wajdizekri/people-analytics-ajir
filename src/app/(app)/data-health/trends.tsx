import type { ReactNode } from "react";
import { ColorLegend, EmptyState, fmt } from "@/components/ui";
import { Chart, VisualCard } from "@/components/charts/pbi";
import { EChart } from "@/components/charts/echart";
import { TermTip } from "@/components/help";
import { DataDetails } from "@/components/pilotage/data-details";
import {
  IMPORT_STATUS,
  JOB_STATUS_STYLE,
  JOB_TYPE_LABEL,
  TREND_MIN_IMPORTS,
  formatDuration,
  jobDurationOption,
  jobsByStatusOption,
  qualityMarks,
  qualityTrendOption,
  rejectedShareOption,
  rejectionsByRuleOption,
  severityStyle,
} from "@/components/monitoring/data-options";
import { MONITORING, type DataMonitoringDTO, type ImportPointDTO } from "@/lib/dal/data-monitoring";

// Tendances d'un import à l'autre. Une courbe à un ou deux points ressemble à un graphique cassé : en dessous de
// TREND_MIN_IMPORTS imports, chaque score est montré par une barre de niveau, face au seuil de blocage.

const plural = (n: number, word: string) => `${fmt.int(n)} ${word}${n > 1 ? "s" : ""}`;
const share = (i: ImportPointDTO) => (i.rowsOk + i.rowsRejected ? i.rowsRejected / (i.rowsOk + i.rowsRejected) : null);

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-[13px] font-medium text-fg">{caption}</figcaption>
      {children}
    </figure>
  );
}

function QualityMarks({ imports, threshold }: { imports: ImportPointDTO[]; threshold: number }) {
  return (
    <ul className="max-w-3xl space-y-4">
      {qualityMarks(imports, threshold).map((m) => (
        <li key={m.id}>
          <p className="text-sm font-medium text-fg">
            Import n° {m.id} du {fmt.date(m.startedAt)}
          </p>
          <Chart spec={m.spec} ariaLabel={`Import n° ${m.id}. ${m.spec.ariaLabel}`} />
          {m.read > 0 && (
            <p className="text-xs text-fg-muted">
              {fmt.pct(m.rejected / m.read, 1)} des lignes lues écartées ({fmt.int(m.rejected)} sur {fmt.int(m.read)}).
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function QualityCard({ mon }: { mon: DataMonitoringDTO }) {
  const scored = mon.imports.filter((i) => i.qualityScore != null);
  const last = scored.at(-1);
  const n = mon.imports.length;
  const threshold = fmt.pct(mon.qualityThreshold, 0);
  if (!last)
    return (
      <VisualCard headingLevel={3} title="Qualité des imports" subtitle="Score qualité et part des lignes écartées par import">
        <EmptyState compact title="Aucun score qualité disponible">
          Le score apparaît après le premier import terminé.
        </EmptyState>
      </VisualCard>
    );
  if (scored.length < TREND_MIN_IMPORTS)
    return (
      <VisualCard
        headingLevel={3}
        title={`${scored.length === 1 ? "Un seul import" : "Deux imports"} : la tendance apparaîtra au ${TREND_MIN_IMPORTS}e import`}
        subtitle={`Score qualité de chaque import, situé face au seuil de blocage (${threshold})`}
        actions={<TermTip term="scoreQualite" align="end" />}
      >
        <QualityMarks imports={scored} threshold={mon.qualityThreshold} />
      </VisualCard>
    );
  const ok = (last.qualityScore ?? 0) >= mon.qualityThreshold;
  return (
    <VisualCard
      headingLevel={3}
      title={`Qualité de ${fmt.pct(last.qualityScore, 1)} au dernier import, ${ok ? "au-dessus du" : "sous le"} seuil de blocage`}
      subtitle={`Score qualité et part des lignes écartées (%), ${n} derniers imports terminés`}
      actions={<TermTip term="scoreQualite" align="end" />}
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 xl:grid-cols-2">
        <Figure caption="Score qualité par import (%)">
          <EChart
            format={{ unit: "%", digits: 1 }}
            option={qualityTrendOption(mon.imports, mon.qualityThreshold)}
            height={240}
            ariaLabel={`Courbe du score qualité sur les ${n} derniers imports, comparé au seuil de blocage de ${threshold}. Dernier import : ${fmt.pct(last.qualityScore, 1)}.`}
          />
        </Figure>
        <Figure caption="Part des lignes écartées par import (%)">
          <EChart format={{ unit: "%", digits: 1 }} option={rejectedShareOption(mon.imports)} height={240} ariaLabel={`Barres : part des lignes écartées pour les ${n} derniers imports.`} />
        </Figure>
      </div>
      <DataDetails
        summary="Voir les données par import"
        caption="Score qualité et lignes écartées par import"
        numeric
        headers={["Import", "Score qualité", "Importées", "Écartées", "Part écartée"]}
        rows={[...mon.imports].reverse().map((i) => [
          `n° ${i.id} · ${fmt.dateTime(i.startedAt)} · ${IMPORT_STATUS[i.status].label}`,
          fmt.pct(i.qualityScore, 1),
          fmt.int(i.rowsOk),
          fmt.int(i.rowsRejected),
          fmt.pct(share(i), 1),
        ])}
      />
    </VisualCard>
  );
}

// Cumul des contrôles sur 90 jours : affiché seulement s'il diffère du Pareto de l'import (au moins deux imports sur la période)
function RecurringControls({ mon }: { mon: DataMonitoringDTO }) {
  const rows = mon.rejectionsByRule;
  if (mon.rejectionImports < 2 || !rows.length) return null;
  const severities = ["REJET", "CORRECTION", "AVERTISSEMENT"].filter((s) => rows.some((r) => r.severity === s));
  return (
    <VisualCard
      headingLevel={3}
      title={`« ${rows[0].label} » : contrôle le plus signalé sur ${MONITORING.rejectionDays} jours`}
      subtitle={`Lignes signalées par contrôle, cumul des ${mon.rejectionImports} imports des ${MONITORING.rejectionDays} derniers jours`}
      actions={<TermTip term="gravite" align="end" />}
    >
      <ColorLegend items={severities.map(severityStyle)} />
      <EChart
        format={{ digits: 0 }}
        option={rejectionsByRuleOption(rows)}
        height={Math.max(96, 36 * rows.length + 16)}
        mobileHeight={Math.max(120, 46 * rows.length + 16)}
        ariaLabel={`Barres horizontales triées : lignes signalées par contrôle sur ${MONITORING.rejectionDays} jours, couleur selon l'effet sur la ligne.`}
      />
      <DataDetails
        summary="Voir les données par contrôle"
        caption={`Lignes signalées par contrôle sur ${MONITORING.rejectionDays} jours`}
        numeric
        headers={["Contrôle", "Effet", "Lignes signalées"]}
        rows={rows.map((r) => [r.label, severityStyle(r.severity).label, fmt.int(r.n)])}
      />
    </VisualCard>
  );
}

function JobsCard({ mon }: { mon: DataMonitoringDTO }) {
  const done = mon.jobs.filter((j) => j.avgDurationSec != null);
  const total = mon.jobs.reduce((s, j) => s + j.total, 0);
  const failed = mon.jobs.reduce((s, j) => s + j.byStatus.ECHEC, 0);
  const statuses = Object.keys(JOB_STATUS_STYLE) as (keyof typeof JOB_STATUS_STYLE)[];
  return (
    <VisualCard
      headingLevel={3}
      title={
        total
          ? `${plural(total, "traitement")} en ${MONITORING.jobDays} jours, ${failed ? `dont ${fmt.int(failed)} en échec` : "aucun en échec"}`
          : `Traitements des ${MONITORING.jobDays} derniers jours`
      }
      subtitle="Imports et calculs exécutés par le service de calcul, par type"
      actions={<TermTip term="traitements" align="end" />}
    >
      {mon.jobs.length ? (
        <>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 xl:grid-cols-2">
            <Figure caption="Nombre de traitements par type et par statut">
              <EChart option={jobsByStatusOption(mon.jobs)} height={240} ariaLabel={`Barres empilées : nombre de traitements sur ${MONITORING.jobDays} jours par type et par statut.`} />
            </Figure>
            <Figure caption="Durée moyenne des traitements terminés">
              {done.length ? (
                <EChart
                  option={jobDurationOption(mon.jobs)}
                  height={Math.max(120, 40 + done.length * 32)}
                  ariaLabel="Barres horizontales : durée moyenne d'exécution des traitements terminés, par type."
                />
              ) : (
                <p className="text-sm text-fg-muted">Aucun traitement terminé : la durée moyenne s&apos;affichera après le premier.</p>
              )}
            </Figure>
          </div>
          <DataDetails
            summary="Voir les données par traitement"
            caption={`Traitements des ${MONITORING.jobDays} derniers jours par type`}
            numeric
            headers={["Type", ...statuses.map((s) => JOB_STATUS_STYLE[s].label), "Durée moyenne"]}
            rows={mon.jobs.map((j) => [JOB_TYPE_LABEL[j.type] ?? j.type, ...statuses.map((s) => fmt.int(j.byStatus[s])), formatDuration(j.avgDurationSec)])}
          />
        </>
      ) : (
        <EmptyState compact title={`Aucun traitement sur ${MONITORING.jobDays} jours`}>
          Les imports et calculs mensuels lancés apparaîtront ici.
        </EmptyState>
      )}
    </VisualCard>
  );
}

export function Trends({ mon }: { mon: DataMonitoringDTO }) {
  return (
    <div className="space-y-4">
      <QualityCard mon={mon} />
      <RecurringControls mon={mon} />
      <JobsCard mon={mon} />
    </div>
  );
}

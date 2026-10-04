import { Notice, RiskBadge, StatusBadge } from "@/components/ui";
import { InfoTip } from "@/components/help";
import { actionLabel, formatDate, formatRate } from "@/components/pilotage/labels";
import type { EffectMeasure, EmployeeEffectsDto } from "@/lib/dal/interventions";
import { LEVEL_CHANGE_LABELS, formatHours, shortMonth } from "./labels";
import { BeforeAfter, InsightZone } from "./ui";

export const CAUSALITY_NOTICE =
  "Observation, pas un effet causal : aucune comparaison avec des collaborateurs sans action, et un niveau élevé a tendance à redescendre de lui-même le mois suivant.";

const CHANGE_TONE = { BAISSE: "success", HAUSSE: "danger", STABLE: "neutral" } as const;

function Levels({ before, after, change }: { before: EffectMeasure["levelBefore"]; after: EffectMeasure["levelAfter"]; change: EffectMeasure["levelChange"] }) {
  return (
    <div className="rounded-control bg-surface-2 px-2.5 py-2 ring-1 ring-inset ring-line">
      <p className="text-xs font-medium text-fg-muted">Niveau de risque</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
        <RiskBadge level={before} /> <span aria-hidden="true">→</span>
        <span className="sr-only">puis</span> <RiskBadge level={after} />
      </p>
      {change && (
        <p className="mt-1">
          <StatusBadge tone={CHANGE_TONE[change]}>{LEVEL_CHANGE_LABELS[change]}</StatusBadge>
        </p>
      )}
    </div>
  );
}

function Measure({ m, window }: { m: EffectMeasure; window: number }) {
  const absDelta = m.absenteeismBefore != null && m.absenteeismAfter != null ? m.absenteeismAfter - m.absenteeismBefore : null;
  const otDelta = m.overtimeBefore != null && m.overtimeAfter != null ? m.overtimeAfter - m.overtimeBefore : null;
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        <Levels before={m.levelBefore} after={m.levelAfter} change={m.levelChange} />
        <BeforeAfter label="Absentéisme hors santé" before={formatRate(m.absenteeismBefore)} after={formatRate(m.absenteeismAfter)} delta={absDelta} better="down" />
        <BeforeAfter label="Heures supplémentaires par mois" before={formatHours(m.overtimeBefore)} after={formatHours(m.overtimeAfter)} delta={otDelta} better="down" />
      </div>
      {!m.complete && (
        <p className="mt-1.5 text-xs text-warning">
          Recul partiel : {m.monthsAfter} mois observé{m.monthsAfter > 1 ? "s" : ""} sur {window} après l&apos;action.
        </p>
      )}
    </>
  );
}

// « Avant / après intervention » (données de getEmployeeInterventionEffects) : RH mesure complète, manager niveaux de risque seulement
export function InterventionEffects({ data, className = "" }: { data: EmployeeEffectsDto; className?: string }) {
  const w = data.windowMonths;
  return (
    <InsightZone
      id="avant-apres"
      title="Avant / après intervention"
      icon="effect"
      hint={`${w} mois avant et ${w} mois après le mois de chaque action réalisée`}
      className={className}
      aside={
        <InfoTip label="Avant / après" align="end">
          Niveau de risque au dernier calcul publié avant l&apos;action puis {w} mois après
          {data.view === "RH" ? `, absentéisme hors santé non planifié et heures supplémentaires pointées sur les ${w} mois civils de part et d'autre du mois de l'action` : ""}.{" "}
          {CAUSALITY_NOTICE}
        </InfoTip>
      }
    >
      {data.items.length === 0 ? (
        <p className="text-sm text-fg-muted">Aucune action réalisée pour ce collaborateur.</p>
      ) : (
        <div className="space-y-3">
          <Notice tone="neutral">{CAUSALITY_NOTICE}</Notice>
          {data.opposed && <Notice>Opposition au traitement prédictif : les niveaux de risque ne sont pas calculés pour ce collaborateur.</Notice>}
          <ul className="space-y-3">
            {data.view === "RH"
              ? data.items.map((i) => (
                  <li key={i.key} className="rounded-control bg-surface p-3 ring-1 ring-inset ring-line">
                    <p className="mb-2 text-sm font-semibold text-heading">
                      {actionLabel(i.actionCode)} <span className="font-normal text-fg-muted">· réalisée le {formatDate(i.date)}</span>
                      {i.source === "RECOMMANDATION" && <span className="font-normal text-fg-muted"> (date de décision, aucune intervention datée)</span>}
                    </p>
                    {i.measure ? <Measure m={i.measure} window={w} /> : <p className="text-sm text-fg-muted">Mesure non calculée (opposition au traitement prédictif).</p>}
                  </li>
                ))
              : data.items.map((i) => (
                  <li key={i.key} className="rounded-control bg-surface p-3 ring-1 ring-inset ring-line">
                    <p className="mb-2 text-sm font-semibold text-heading">
                      {actionLabel(i.actionCode)} <span className="font-normal text-fg-muted">· {shortMonth(i.month)}</span>
                    </p>
                    <Levels before={i.levelBefore} after={i.levelAfter} change={i.levelChange} />
                    {!i.complete && <p className="mt-1.5 text-xs text-warning">Recul inférieur à {w} mois : mesure provisoire.</p>}
                  </li>
                ))}
          </ul>
        </div>
      )}
    </InsightZone>
  );
}

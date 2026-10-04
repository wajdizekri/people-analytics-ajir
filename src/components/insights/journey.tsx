import type { ReactNode } from "react";
import { fmt } from "@/components/ui";
import { InfoTip } from "@/components/help";
import { ABSENCE_LABELS, CONTRACT_LABELS, RECO_STATUS_LABELS, actionLabel, formatDate } from "@/components/pilotage/labels";
import type { EmployeeJourneyDto, JourneyEvent, JourneyKind } from "@/lib/dal/synthesis";
import { EXIT_REASON_LABELS, INSIGHT_ICONS, formatDays } from "./labels";
import { InsightZone } from "./ui";

const VISIBLE = 12;

const DOT: Record<JourneyKind, string> = {
  EMBAUCHE: "bg-fg",
  CONTRAT: "bg-fg-muted",
  PROMOTION: "bg-accent",
  AUGMENTATION: "bg-success",
  MUTATION: "bg-info",
  CHANGEMENT_MANAGER: "bg-primary",
  CHANGEMENT_POSTE: "bg-primary",
  ABSENCE_LONGUE: "bg-fg-subtle",
  FORMATION: "bg-link",
  FORMATION_RETARD: "bg-warning",
  RECOMMANDATION: "border-2 border-primary bg-surface",
  INTERVENTION: "bg-success",
  SORTIE: "bg-danger",
};

const change = (e: JourneyEvent) => (e.from || e.to ? <span className="text-fg-muted"> ({e.from ?? "—"} → {e.to ?? "—"})</span> : null);

function title(e: JourneyEvent): ReactNode {
  switch (e.kind) {
    case "EMBAUCHE":
      return "Embauche";
    case "CONTRAT":
      return e.from ? (
        <>
          Passage de {CONTRACT_LABELS[e.from] ?? e.from} à {CONTRACT_LABELS[e.to ?? ""] ?? e.to}
        </>
      ) : (
        <>Contrat {CONTRACT_LABELS[e.label ?? ""] ?? e.label}</>
      );
    case "PROMOTION":
      return <>Promotion{change(e)}</>;
    case "AUGMENTATION":
      return (
        <>
          Augmentation{" "}
          <span className="text-fg-muted">
            ({fmt.tnd(Number(e.from))} → {fmt.tnd(Number(e.to))})
          </span>
        </>
      );
    case "MUTATION":
      return <>Mutation{change(e)}</>;
    case "CHANGEMENT_MANAGER":
      return <>Changement de manager{change(e)}</>;
    case "CHANGEMENT_POSTE":
      return <>Changement de poste{change(e)}</>;
    case "ABSENCE_LONGUE":
      return (
        <>
          {ABSENCE_LABELS[e.label ?? ""] ?? e.label} de {formatDays(e.days)}
          {e.endDate && <span className="text-fg-muted"> (jusqu&apos;au {formatDate(e.endDate)})</span>}
        </>
      );
    case "FORMATION":
      return (
        <>
          Formation terminée : {e.label}
          {e.hours != null && <span className="text-fg-muted"> ({fmt.int(e.hours)} h)</span>}
        </>
      );
    case "FORMATION_RETARD":
      return <>Formation obligatoire en retard : {e.label}</>;
    case "RECOMMANDATION":
      return (
        <>
          Recommandation : {actionLabel(e.label ?? "")}
          {e.status && <span className="text-fg-muted"> ({(RECO_STATUS_LABELS[e.status] ?? e.status).toLowerCase()})</span>}
        </>
      );
    case "INTERVENTION":
      return <>Action réalisée : {actionLabel(e.label ?? "")}</>;
    case "SORTIE":
      return <>Sortie de l&apos;entreprise{e.label && <span className="text-fg-muted"> ({EXIT_REASON_LABELS[e.label] ?? e.label})</span>}</>;
  }
}

function Item({ e }: { e: JourneyEvent }) {
  return (
    <li className="relative pb-3 pl-5 last:pb-0">
      <span aria-hidden="true" className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ring-2 ring-surface ${DOT[e.kind]}`} />
      <p className="text-sm text-fg">
        <span className="mr-2 inline-block text-xs tabular-nums text-fg-muted">{formatDate(e.date)}</span>
        {title(e)}
      </p>
    </li>
  );
}

// « Parcours » : frise chronologique, la plus récente en premier (données de getEmployeeJourney, DTO par rôle)
export function Journey({ data, className = "" }: { data: EmployeeJourneyDto; className?: string }) {
  const first = data.events.slice(0, VISIBLE);
  const rest = data.events.slice(VISIBLE);
  return (
    <InsightZone
      id="parcours"
      title="Parcours"
      icon="journey"
      hint={`${data.events.length} évènement${data.events.length > 1 ? "s" : ""}`}
      className={className}
      aside={
        <InfoTip label="Parcours" align="end">
          Embauche, contrats, promotions, changements de manager ou de poste, formations et recommandations
          {data.view === "RH"
            ? `, augmentations, actions réalisées et absences longues hors santé (${data.longAbsenceDays} jours ou plus, hors congés annuels)`
            : ""}
          . Les absences pour maladie ou maternité n&apos;apparaissent jamais.
        </InfoTip>
      }
    >
      {data.events.length === 0 ? (
        <p className="text-sm text-fg-muted">Aucun évènement enregistré</p>
      ) : (
        <>
          <ol className="ml-1.5 border-l-2 border-line">
            {first.map((e, i) => (
              <Item key={i} e={e} />
            ))}
          </ol>
          {rest.length > 0 && (
            <details className="group mt-2">
              <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-control pr-2 text-sm font-medium text-link transition-colors hover:bg-primary-soft hover:underline [&::-webkit-details-marker]:hidden">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={INSIGHT_ICONS.chevron} />
                </svg>
                <span className="group-open:hidden">Voir les {rest.length} évènements plus anciens</span>
                <span className="hidden group-open:inline">Masquer les évènements plus anciens</span>
              </summary>
              <ol className="ml-1.5 mt-2 border-l-2 border-line">
                {rest.map((e, i) => (
                  <Item key={i} e={e} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </InsightZone>
  );
}

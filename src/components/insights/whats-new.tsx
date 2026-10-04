import type { ReactNode } from "react";
import { RiskBadge, fmt } from "@/components/ui";
import { InfoTip } from "@/components/help";
import { CAREER_LABELS, LEVEL_LABELS, actionLabel, formatDate } from "@/components/pilotage/labels";
import type { EmployeeNewsDto, NewsItem } from "@/lib/dal/synthesis";
import { formatDays, formatHours, shortMonth } from "./labels";
import { InsightZone } from "./ui";

const score = (n: number) => `${n.toLocaleString("fr-FR")}/5`;

function career(i: Extract<NewsItem, { kind: "CARRIERE" }>): ReactNode {
  const label = CAREER_LABELS[i.type] ?? i.type;
  const values = i.type === "AUGMENTATION" ? [fmt.tnd(Number(i.from)), fmt.tnd(Number(i.to))] : [i.from ?? "—", i.to ?? "—"];
  return (
    <>
      {label} le {formatDate(i.date)} {(i.from || i.to) && <span className="text-fg-muted">({values[0]} → {values[1]})</span>}
    </>
  );
}

function text(i: NewsItem, d: EmployeeNewsDto): ReactNode {
  const M = shortMonth(d.month);
  const P = shortMonth(d.previousMonth);
  switch (i.kind) {
    case "OPPOSITION":
      return "Opposition au traitement prédictif : non évalué";
    case "RISQUE":
      if (i.before && i.after && i.before === i.after)
        return (
          <>
            Inchangé depuis {P} : <RiskBadge level={i.after} />
          </>
        );
      if (!i.after) return <>Non évalué en {M} (avant : {LEVEL_LABELS[i.before!]})</>;
      if (!i.before)
        return (
          <>
            Premier niveau ({M}) : <RiskBadge level={i.after} />
          </>
        );
      return (
        <>
          {LEVEL_LABELS[i.before]} ({P}) <span aria-hidden="true">→</span>
          <span className="sr-only">puis</span> <RiskBadge level={i.after} /> ({M})
        </>
      );
    case "FACTEUR":
      return <>Nouveau facteur associé : {i.text}</>;
    case "CARRIERE":
      return career(i);
    case "FORMATION":
      return i.status === "TERMINEE" ? (
        <>
          Formation terminée le {formatDate(i.date)} : {i.title}
        </>
      ) : (
        <>
          Échéance dépassée le {formatDate(i.date)} : {i.title}
        </>
      );
    case "EVALUATION":
      return (
        <>
          Nouvelle évaluation le {formatDate(i.date)} : {score(i.score)}
          {i.previousScore != null && <span className="text-fg-muted"> (précédente : {score(i.previousScore)})</span>}
        </>
      );
    case "ABSENCE":
      return (
        <>
          Absences hors santé : {formatDays(i.before)} ({P}) → {formatDays(i.now)} ({M})
        </>
      );
    case "HEURES_SUP":
      return (
        <>
          Heures supplémentaires : {formatHours(i.before)} ({P}) → {formatHours(i.now)} ({M})
        </>
      );
    case "RECOMMANDATION":
      return (
        <>
          Nouvelle recommandation le {formatDate(i.date)} : {actionLabel(i.actionCode)}
        </>
      );
    case "INTERVENTION":
      return (
        <>
          Action réalisée le {formatDate(i.date)} : {actionLabel(i.actionCode)}
        </>
      );
  }
}

const DOT: Record<NewsItem["kind"], string> = {
  OPPOSITION: "bg-fg-subtle",
  RISQUE: "bg-danger",
  FACTEUR: "bg-warning",
  CARRIERE: "bg-accent",
  FORMATION: "bg-primary",
  EVALUATION: "bg-info",
  ABSENCE: "bg-fg-subtle",
  HEURES_SUP: "bg-fg-subtle",
  RECOMMANDATION: "border-2 border-primary",
  INTERVENTION: "bg-success",
};

// Catégorie en mots devant chaque ligne : la liste se parcourt d'un coup d'œil, sans dépendre de la couleur de la pastille
const KIND_LABEL: Record<NewsItem["kind"], string> = {
  OPPOSITION: "Confidentialité",
  RISQUE: "Risque",
  FACTEUR: "Facteur",
  CARRIERE: "Carrière",
  FORMATION: "Formation",
  EVALUATION: "Évaluation",
  ABSENCE: "Absences",
  HEURES_SUP: "Temps de travail",
  RECOMMANDATION: "Suggestion",
  INTERVENTION: "Action",
};

// Changement de niveau de risque : sens écrit (« en hausse ») et pastille sémantique (rouge = défavorable, vert = favorable)
const LEVEL_RANK = { ELEVE: 3, MOYEN: 2, FAIBLE: 1 } as const;
const riskTrend = (i: NewsItem) =>
  i.kind !== "RISQUE" || !i.before || !i.after || i.before === i.after ? null : LEVEL_RANK[i.after] > LEVEL_RANK[i.before] ? "hausse" : "baisse";
const dotCls = (i: NewsItem) => (i.kind !== "RISQUE" ? DOT[i.kind] : { hausse: "bg-danger", baisse: "bg-success", none: "bg-fg-subtle" }[riskTrend(i) ?? "none"]);
const kindLabel = (i: NewsItem) => {
  const trend = riskTrend(i);
  return trend ? `${KIND_LABEL[i.kind]} en ${trend}` : KIND_LABEL[i.kind];
};

// « Quoi de neuf » : changements pour ce collaborateur depuis le calcul publié précédent (données de getEmployeeNews, DTO par rôle)
export function WhatsNew({ data, className = "" }: { data: EmployeeNewsDto; className?: string }) {
  return (
    <InsightZone
      id="quoi-de-neuf"
      title="Quoi de neuf"
      icon="news"
      hint={`${formatDate(data.window.from)} – ${formatDate(data.window.to)}`}
      className={className}
      aside={
        <InfoTip label="Quoi de neuf" align="end">
          Ce qui a changé depuis le calcul publié de {shortMonth(data.previousMonth)} : niveau de risque, carrière, formations, évaluation et recommandations
          {data.view === "RH" ? ", ainsi que les absences hors santé et les heures supplémentaires du mois" : ""}. Les absences pour maladie ou maternité ne sont
          jamais prises en compte.
        </InfoTip>
      }
    >
      {data.items.length === 0 ? (
        <p className="text-sm text-fg-muted">Aucun changement depuis {shortMonth(data.previousMonth)}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.items.map((i, k) => (
            <li key={k} className="flex flex-col gap-0.5 py-1.5 text-sm text-fg first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-3">
              <span className="inline-flex w-36 shrink-0 items-center gap-2 text-xs font-semibold text-fg-muted sm:pt-0.5">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotCls(i)}`} />
                {kindLabel(i)}
                <span className="sr-only"> : </span>
              </span>
              <span className="min-w-0">{text(i, data)}</span>
            </li>
          ))}
        </ul>
      )}
    </InsightZone>
  );
}

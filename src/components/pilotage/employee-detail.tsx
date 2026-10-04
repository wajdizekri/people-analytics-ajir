import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, EmptyState, Initials, Notice, RiskBadge, StatusBadge, cardCls, fmt } from "@/components/ui";
import { Chart, ChartData, levelStepChart, lineChart } from "@/components/charts/pbi";
import { TermTip } from "@/components/help";
import type { EmployeeDetailDto, EmployeeDetailRh, EstimationManager, EstimationRh } from "@/lib/dal/employees";
import {
  ABSENCE_LABELS,
  CONTRACT_LABELS,
  FEEDBACK_LABELS,
  LEVEL_LABELS,
  RECO_STATUS_LABELS,
  TRAINING_STATUS_LABELS,
  actionLabel,
  formatDate,
  formatLiftWords,
  formatMonth,
  formatPoints,
  formatProb,
  formatTenure,
  joinFr,
  lcFirst,
} from "./labels";
import { RecommendationActions } from "./recommendation-forms";

type Action = (state: { ok?: string; error?: string }, form: FormData) => Promise<{ ok?: string; error?: string }>;
type Level = "FAIBLE" | "MOYEN" | "ELEVE";

const ICONS = {
  clock: "M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
  contract: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h4",
  grade: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12 M8.5 13.5 7 21l5-3 5 3-1.5-7.5",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  briefcase: "M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3 M4 13h16",
  calendar: "M8 2v4 M16 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  money: "M3 6h18v12H3z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M6 9v.01 M18 15v.01",
  absence: "M8 2v4 M16 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M10 13l4 4 M14 13l-4 4",
  training: "M22 10 12 5 2 10l10 5 10-5z M6 12v5c3 2 9 2 12 0v-5",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z",
  history: "M3 3v18h18 M7 14l4-4 4 4 5-5",
  factors: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  up: "M12 19V5 M5 12l7-7 7 7",
  down: "M12 5v14 M19 12l-7 7-7-7",
  chevron: "M6 9l6 6 6-6",
  bulb: "M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 9h8 M8 13h5",
  gauge: "M12 21a9 9 0 1 1 9-9 M12 12l4-4 M3 12h2 M12 3v2 M19 12h2",
  flask: "M9 3h6 M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3 M7.5 15h9",
} as const;

function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

// Les trois zones de la fiche : ce qui est enregistré, ce que le calcul estime, ce que l'on peut faire
const ZONES = {
  1: { id: "faits", title: "Faits" },
  2: { id: "estimation", title: "Estimation" },
  3: { id: "suggestions", title: "Suggestions" },
} as const;

function Zone({ n, hint, aside, children, className = "" }: { n: 1 | 2 | 3; hint: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  const z = ZONES[n];
  return (
    <section id={z.id} aria-labelledby={`zone-${n}`} className={`${cardCls} @container min-w-0 scroll-mt-4 p-4 sm:p-5 ${className}`}>
      <header className="mb-4 flex items-start gap-3 border-b border-line pb-3">
        <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`zone-${n}`} className="text-lg font-semibold leading-8 text-heading">
            <span className="sr-only">{n}. </span>
            {z.title}
          </h2>
          <p className="text-sm text-fg-muted">{hint}</p>
        </div>
        {aside}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Sub({ title, icon, aside, intro, children }: { title: string; icon: keyof typeof ICONS; aside?: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-base font-semibold text-heading">
          <Icon name={icon} className="h-4 w-4 shrink-0 text-link" />
          {title}
        </h3>
        {aside && <div className="text-xs text-fg-muted">{aside}</div>}
      </div>
      {intro && <p className="-mt-1 mb-2 text-xs text-fg-muted">{intro}</p>}
      {children}
    </div>
  );
}

const summaryCls =
  "inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-control pr-2 text-sm font-medium text-link transition-colors hover:bg-primary-soft hover:underline [&::-webkit-details-marker]:hidden";

function More({ count, singular, plural, children }: { count: number; singular: string; plural: string; children: ReactNode }) {
  const what = count > 1 ? `les ${count} autres ${plural}` : `1 autre ${singular}`;
  return (
    <details className="group mt-2">
      <summary className={summaryCls}>
        <Icon name="chevron" className="h-4 w-4 transition-transform group-open:rotate-180" />
        <span className="group-open:hidden">Voir {what}</span>
        <span className="hidden group-open:inline">Masquer {what}</span>
      </summary>
      {children}
    </details>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-fg-muted">{children}</p>;
const plural = (n: number, word: string) => `${word}${n > 1 ? "s" : ""}`;

// Un div par paire dt/dd (liste de définitions valide) ; l'icône est dans le dt, sans positionnement absolu
function Fact({ icon, label, value, detail }: { icon: keyof typeof ICONS; label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-control bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-line">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <Icon name={icon} className="h-3.5 w-3.5 shrink-0 text-link" />
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-heading">{value}</dd>
      {detail && <dd className="text-xs text-fg-muted">{detail}</dd>}
    </div>
  );
}

export function EmployeeHeader({ d }: { d: EmployeeDetailDto }) {
  const e = d.employee;
  return (
    <section aria-labelledby="fiche-nom" className={`${cardCls} mt-3 overflow-hidden`}>
      <div aria-hidden="true" className="h-1 bg-linear-to-r from-primary via-primary to-accent" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Initials name={`${e.firstName} ${e.lastName}`} className="size-14! bg-primary! text-lg! text-primary-fg! ring-0! shadow-[0_0_0_4px_var(--color-primary-soft)]" />
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Fiche collaborateur</p>
            <h1 id="fiche-nom" className="text-2xl font-semibold leading-tight text-heading sm:text-[26px]">
              {e.lastName} {e.firstName}
            </h1>
            <p className="mt-0.5 text-sm text-fg-muted">{[e.jobTitle, e.department].filter(Boolean).join(" · ") || "Poste non renseigné"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>
              Matricule <span className="ml-1 tabular-nums">{e.matricule}</span>
            </Badge>
            {e.status === "SORTI" && <StatusBadge tone="warning">Sorti le {formatDate(e.exitDate)}</StatusBadge>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))]">
          <Fact icon="clock" label="Ancienneté" value={formatTenure(e.tenureMonths)} detail={`Entrée le ${formatDate(e.hireDate)}`} />
          <Fact
            icon="contract"
            label="Contrat"
            value={e.contract ? (CONTRACT_LABELS[e.contract.type] ?? e.contract.type) : "—"}
            detail={e.contract ? `depuis le ${formatDate(e.contract.startDate)}` : undefined}
          />
          {e.cddEndPlanned && <Fact icon="calendar" label="Fin de CDD prévue" value={formatDate(e.cddEndPlanned)} />}
          <Fact icon="grade" label="Grade" value={e.grade ?? "—"} />
          <Fact
            icon="users"
            label="Manager"
            value={e.manager?.name ?? "—"}
            detail={
              e.manager && e.status === "ACTIF" ? (
                <Link href={`/employees?manager=${e.manager.id}`} className="inline-flex min-h-6 items-center text-link underline underline-offset-2 hover:decoration-2">
                  Voir l&apos;équipe<span className="sr-only"> de {e.manager.name}</span>
                </Link>
              ) : undefined
            }
          />
          <Fact icon="briefcase" label="Famille de métier" value={e.jobFamily ?? "—"} />
        </dl>
      </div>
    </section>
  );
}

const SUMMARY_TONE: Record<Level | "NONE", { border: string; icon: string }> = {
  ELEVE: { border: "border-l-danger", icon: "bg-danger-soft text-danger" },
  MOYEN: { border: "border-l-warning", icon: "bg-warning-soft text-warning" },
  FAIBLE: { border: "border-l-success", icon: "bg-success-soft text-success" },
  NONE: { border: "border-l-line-strong", icon: "bg-surface-3 text-fg-muted" },
};

// Raccourcis vers les zones : pastilles numérotées comme les zones
const jumpCls =
  "group/jump inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1.5 pr-3.5 text-sm font-medium text-fg transition-colors hover:border-primary hover:bg-primary-soft hover:text-link active:translate-y-px";
const jumpNum =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-3 px-1 text-xs font-bold text-fg-muted transition-colors group-hover/jump:bg-primary group-hover/jump:text-primary-fg";

// Résumé en tête de fiche : le niveau, les facteurs principaux et la suite (zones, décisions, simulation)
export function EmployeeSummary({ d, opposition = null, simulation = false }: { d: EmployeeDetailDto; opposition?: OppositionFlag; simulation?: boolean }) {
  const est = d.estimation;
  const pending = d.recommendations.filter((r) => r.status === "PROPOSEE").length;
  let level: Level | null = null;
  let headline: ReactNode;
  let detail: ReactNode = null;
  if (opposition) {
    headline = "Aucune estimation : opposition au traitement prédictif";
    detail = `Enregistrée le ${fmt.date(opposition.since)}. Ce collaborateur est exclu du calcul du risque et de la simulation.`;
  } else if (est.status === "AUCUN_RUN") {
    headline = "Aucune estimation : aucun calcul de risque publié";
  } else if (est.status === "NON_EVALUE") {
    headline = `Non évalué au ${formatDate(est.asOf)}`;
    detail = "Hors du calcul : stage ou SIVP, CDD court, arrivée récente, départ à la retraite proche, démission connue ou opposition au calcul.";
  } else {
    level = est.level;
    const names =
      d.view === "RH"
        ? d.estimation.status === "OK"
          ? d.estimation.factors.filter((f) => f.direction === "HAUSSE").slice(0, 3).map((f) => lcFirst(f.label))
          : []
        : d.estimation.status === "OK"
          ? d.estimation.factors.slice(0, 3).map((f) => lcFirst(f.phrase))
          : [];
    headline = (
      <>
        Risque {LEVEL_LABELS[est.level]} —{" "}
        {names.length > 0
          ? `${names.length} ${plural(names.length, "facteur")} ${names.length > 1 ? "principaux" : "principal"} : ${joinFr(names)}`
          : "aucun facteur ne fait nettement monter le risque"}
      </>
    );
    if (d.view === "RH" && d.estimation.status === "OK") {
      const e = d.estimation.estimate;
      detail =
        e.type === "PROBABILITE"
          ? `Probabilité estimée d'un départ volontaire d'ici 6 mois : ${formatProb(e.prob6)}, soit ${formatLiftWords(e.lift)}. Calcul au ${formatDate(est.asOf)}.`
          : `${formatPoints(e.points)} : conditions de risque remplies. Calcul au ${formatDate(est.asOf)}.`;
    } else detail = `Calcul au ${formatDate(est.asOf)}. C'est une estimation, pas une certitude ; le détail chiffré est réservé à la RH.`;
  }
  const tone = SUMMARY_TONE[level ?? "NONE"];
  const pendingLabel = pending > 0 ? (d.view === "RH" ? `${pending} à décider` : `${pending} en attente`) : null;
  const links: { href: string; num: ReactNode; label: string; badge?: string | null }[] = [
    { href: "#faits", num: 1, label: "Faits" },
    { href: "#estimation", num: 2, label: "Estimation" },
    { href: "#suggestions", num: 3, label: "Suggestions", badge: pendingLabel },
    ...(simulation ? [{ href: "#simulation", num: <Icon name="flask" className="h-3.5 w-3.5" />, label: "Simulation « et si ? »" }] : []),
  ];
  return (
    <section aria-labelledby="fiche-resume" className={`${cardCls} mt-4 border-l-4 p-4 sm:p-5 ${tone.border}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone.icon}`}>
          <Icon name="gauge" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="fiche-resume" className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            En bref
          </h2>
          <p className="mt-0.5 text-lg font-semibold leading-snug text-heading">{headline}</p>
          {detail && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{detail}</p>}
        </div>
      </div>
      <nav aria-label="Sur cette fiche" className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="mr-1 text-xs font-semibold text-fg-muted">Aller à :</span>
        {links.map((l) => (
          <a key={l.href} href={l.href} className={jumpCls}>
            <span aria-hidden="true" className={jumpNum}>
              {l.num}
            </span>
            {l.label}
            {l.badge && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-fg">
                <span className="sr-only"> : </span>
                {l.badge}
              </span>
            )}
          </a>
        ))}
      </nav>
    </section>
  );
}

const TRAINING_DOT: Record<string, string> = { TERMINEE: "bg-success", EN_COURS: "bg-primary", PLANIFIEE: "border-2 border-primary", ABANDONNEE: "bg-fg-subtle" };
const VISIBLE_TRAININGS = 5;
const score5 = (n: number) => `${n.toLocaleString("fr-FR")}/5`;

function evaluationTrend(evals: EmployeeDetailDto["evaluations"]): string | null {
  const [last, prev] = evals;
  if (!last) return null;
  const head = `Dernière évaluation : ${score5(last.score)} le ${formatDate(last.date)}`;
  if (!prev) return `${head}.`;
  const trend = last.score > prev.score ? "en hausse" : last.score < prev.score ? "en baisse" : "stable";
  return `${head}, ${trend} par rapport à la précédente (${score5(prev.score)}).`;
}

export function FactsZone({ d, className = "" }: { d: EmployeeDetailDto; className?: string }) {
  const trainings = d.trainings;
  const overdue = (t: EmployeeDetailDto["trainings"][number]) => t.mandatory && t.status !== "TERMINEE" && t.dueDate != null && t.dueDate < d.referenceDate;
  const nOverdue = trainings.filter(overdue).length;
  const nDone = trainings.filter((t) => t.status === "TERMINEE").length;
  const trend = evaluationTrend(d.evaluations);

  const trainingItem = (t: EmployeeDetailDto["trainings"][number], i: number) => (
    <li key={i} className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">
          {t.title}{" "}
          {t.mandatory && (
            <StatusBadge tone="info" dot={false}>
              Obligatoire
            </StatusBadge>
          )}{" "}
          {overdue(t) && <StatusBadge tone="warning">En retard</StatusBadge>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TRAINING_DOT[t.status] ?? "bg-fg-subtle"}`} />
          <span>
            {TRAINING_STATUS_LABELS[t.status] ?? t.status}
            {t.endDate ? ` le ${formatDate(t.endDate)}` : ""}
          </span>
          {t.dueDate && <span>· échéance le {formatDate(t.dueDate)}</span>}
        </p>
      </div>
      <span className="shrink-0 whitespace-nowrap rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">{fmt.int(t.hours)} h</span>
    </li>
  );

  return (
    <Zone n={1} hint={`Ce qui est enregistré dans AJIR au ${formatDate(d.referenceDate)}`} className={className}>
      {d.view === "RH" && <RhFacts d={d} />}

      <Sub
        title="Formations"
        icon="training"
        aside={
          trainings.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {trainings.length} au total, dont {nDone} {plural(nDone, "terminée")}
              {nOverdue > 0 && (
                <StatusBadge tone="warning">
                  {nOverdue} {plural(nOverdue, "obligatoire")} en retard
                </StatusBadge>
              )}
            </span>
          )
        }
      >
        {trainings.length === 0 ? (
          <Empty>Aucune formation enregistrée.</Empty>
        ) : (
          <>
            <ul className="divide-y divide-line">{trainings.slice(0, VISIBLE_TRAININGS).map(trainingItem)}</ul>
            {trainings.length > VISIBLE_TRAININGS && (
              <More count={trainings.length - VISIBLE_TRAININGS} singular="formation" plural="formations">
                <ul className="divide-y divide-line border-t border-line">{trainings.slice(VISIBLE_TRAININGS).map((t, i) => trainingItem(t, i + VISIBLE_TRAININGS))}</ul>
              </More>
            )}
          </>
        )}
      </Sub>

      <Sub title="Évaluations annuelles" icon="star" aside={d.evaluations.length > 0 && "Note sur 5, la plus récente à gauche"} intro={trend}>
        {d.evaluations.length === 0 ? (
          <Empty>Aucune évaluation enregistrée.</Empty>
        ) : (
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5">
            {d.evaluations.map((ev, i) => (
              <li key={ev.date} className={`rounded-control px-2 py-2 ring-1 ring-inset ${i === 0 ? "bg-primary-soft ring-primary" : "bg-surface ring-line"}`}>
                <p className="text-xs tabular-nums text-fg-muted">{formatDate(ev.date)}</p>
                <p className="text-lg font-semibold leading-tight tabular-nums text-heading">
                  {ev.score.toLocaleString("fr-FR")}
                  <span className="text-xs font-medium text-fg-muted">/5</span>
                </p>
                <span aria-hidden="true" className="mt-1 flex max-w-16 gap-0.5">
                  {[1, 2, 3, 4, 5].map((k) => (
                    <span key={k} className={`h-1.5 flex-1 rounded-full ${k <= Math.round(ev.score) ? "bg-accent" : "bg-surface-3 ring-1 ring-inset ring-line"}`} />
                  ))}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Sub>
    </Zone>
  );
}

const panelCls = "rounded-control bg-surface-2 p-3.5 ring-1 ring-inset ring-line";
const compactTh = "px-2 py-1.5 font-semibold";
const compactTd = "px-2 py-1.5 tabular-nums";

function RhFacts({ d }: { d: EmployeeDetailRh }) {
  const c = d.compensation;
  return (
    <div>
      <div className="grid gap-3 @xl:grid-cols-2">
        <div className={panelCls}>
          <Sub title="Rémunération" icon="money">
            {c.current ? (
              <>
                <p className="text-xs text-fg-muted">Salaire de base</p>
                <p className="text-2xl font-semibold leading-tight tabular-nums text-heading">
                  {fmt.tnd(c.current.baseSalary)}
                  <span className="text-sm font-normal text-fg-muted"> par mois</span>
                </p>
                <p className="mt-1 text-sm text-fg-muted">
                  Salaire brut <span className="font-medium tabular-nums text-fg">{fmt.tnd(c.current.grossSalary)}</span>
                  <span> en {formatMonth(c.current.month)}</span>
                </p>
              </>
            ) : (
              <Empty>Aucune paie enregistrée.</Empty>
            )}
          </Sub>
        </div>
        <div className={panelCls}>
          <Sub title="Absences hors santé, 12 derniers mois" icon="absence">
            {d.absences.byCategory.length === 0 ? (
              <Empty>Aucune absence hors santé.</Empty>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.absences.byCategory.map((a) => (
                  <li key={a.category} className="flex items-baseline justify-between gap-3">
                    <span className="text-fg-muted">{ABSENCE_LABELS[a.category] ?? a.category}</span>
                    <span className="whitespace-nowrap">
                      <span className="font-semibold tabular-nums text-heading">
                        {fmt.int(a.days)} {plural(a.days, "jour")}
                      </span>{" "}
                      <span className="text-xs text-fg-muted">
                        en {a.episodes} fois
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 border-t border-line pt-2 text-xs text-fg-muted">
              Absences pour raison de santé : {fmt.int(d.absences.healthDays)} {plural(d.absences.healthDays, "jour")} (jamais utilisées dans l&apos;estimation)
            </p>
          </Sub>
        </div>
      </div>
      {c.payroll.length > 0 && (
        <details className="group mt-2 text-sm">
          <summary className={summaryCls}>
            <Icon name="chevron" className="h-4 w-4 transition-transform group-open:rotate-180" />
            Voir la paie des 12 derniers mois
          </summary>
          <div className="mt-2 overflow-x-auto rounded-control ring-1 ring-inset ring-line">
            <table className="w-full text-left text-xs text-fg">
              <caption className="sr-only">Paie des 12 derniers mois</caption>
              <thead className="border-b border-line bg-surface-2 text-xs text-fg-muted">
                <tr>
                  <th scope="col" className={compactTh}>Mois</th>
                  <th scope="col" className={`${compactTh} text-right`}>Salaire de base (TND)</th>
                  <th scope="col" className={`${compactTh} text-right`}>Salaire brut (TND)</th>
                  <th scope="col" className={`${compactTh} text-right`}>Heures supplémentaires</th>
                </tr>
              </thead>
              <tbody>
                {c.payroll.map((p) => (
                  <tr key={p.month} className="border-b border-line transition-colors last:border-0 hover:bg-surface-3">
                    <th scope="row" className={`${compactTd} whitespace-nowrap font-normal`}>{formatMonth(p.month)}</th>
                    <td className={`${compactTd} whitespace-nowrap text-right`}>{fmt.int(p.baseSalary)}</td>
                    <td className={`${compactTd} whitespace-nowrap text-right`}>{fmt.int(p.grossSalary)}</td>
                    <td className={`${compactTd} whitespace-nowrap text-right`}>{fmt.int(p.overtimeHours)} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

const MENTION = "Estimation, pas une certitude. Facteurs associés, pas des causes.";

export type OppositionFlag = { label: string; since: string } | null;

// opposition : RH seule (getOppositionFlag) ; le manager ne voit que l'absence d'estimation, sans la raison
export function EstimationZone({ d, opposition = null, className = "" }: { d: EmployeeDetailDto; opposition?: OppositionFlag; className?: string }) {
  return (
    <Zone n={2} hint="Ce que le calcul statistique estime : le risque de départ volontaire dans les 6 mois" aside={<TermTip term="niveauRisque" role={d.view} align="end" />} className={className}>
      <Notice>{MENTION}</Notice>
      {opposition ? (
        <EmptyState title={opposition.label}>
          Enregistrée le {fmt.date(opposition.since)} : ce collaborateur est exclu du calcul du risque et de la simulation. Suivi dans{" "}
          <a href="/confidentialite" className="text-link underline underline-offset-2 hover:no-underline">
            Droit d&apos;accès
          </a>
          .
        </EmptyState>
      ) : d.view === "RH" ? (
        <RhEstimation e={d.estimation} />
      ) : (
        <ManagerEstimation e={d.estimation} />
      )}
    </Zone>
  );
}

function NoEstimate({ e }: { e: { status: "AUCUN_RUN" } | { status: "NON_EVALUE"; asOf: string } }) {
  return e.status === "AUCUN_RUN" ? (
    <EmptyState title="Aucun calcul de risque publié">Le niveau de risque apparaîtra après le prochain calcul mensuel.</EmptyState>
  ) : (
    <EmptyState title={`Non évalué au ${formatDate(e.asOf)}`}>
      Hors du calcul : stage ou SIVP, CDD court, arrivée récente, départ à la retraite proche, démission connue ou opposition au calcul.
    </EmptyState>
  );
}

// Échelle à trois crans : le cran actif est plein (fond doux, bordure et texte du statut), les autres en retrait
const SCALE: { level: Level; on: string }[] = [
  { level: "FAIBLE", on: "bg-success-soft text-success ring-2 ring-success" },
  { level: "MOYEN", on: "bg-warning-soft text-warning ring-2 ring-warning" },
  { level: "ELEVE", on: "bg-danger-soft text-danger ring-2 ring-danger" },
];

function LevelScale({ level }: { level: Level }) {
  return (
    <div aria-hidden="true" className="mt-3 grid grid-cols-3 gap-1.5">
      {SCALE.map((s) => (
        <span
          key={s.level}
          className={`rounded-control px-1 py-1.5 text-center text-xs font-semibold ring-inset ${s.level === level ? s.on : "bg-surface text-fg-subtle ring-1 ring-line"}`}
        >
          {LEVEL_LABELS[s.level]}
        </span>
      ))}
    </div>
  );
}

const LEVEL_RANK: Record<Level, number> = { FAIBLE: 0, MOYEN: 1, ELEVE: 2 };
const monthOf = (asOf: string) => formatMonth(asOf.slice(0, 7));

// Titre = le message : dernier changement de niveau, ou stabilité
function levelTrendMessage(points: { asOf: string; level: Level }[]): string {
  const last = points[points.length - 1];
  let k = points.length - 1;
  while (k > 0 && points[k - 1].level === last.level) k--;
  if (k === 0) return points.length > 1 ? `Niveau ${LEVEL_LABELS[last.level]} stable depuis ${monthOf(points[0].asOf)}` : `Niveau ${LEVEL_LABELS[last.level]} au premier calcul`;
  const prev = points[k - 1].level;
  const dir = LEVEL_RANK[last.level] > LEVEL_RANK[prev] ? "en hausse" : "en baisse";
  return `Niveau ${dir} : passé de ${LEVEL_LABELS[prev]} à ${LEVEL_LABELS[last.level]} en ${monthOf(points[k].asOf)}`;
}

// Escalier sur trois crans (Faible, Moyen, Élevé) : se lit sans connaître la probabilité, donc lisible par le manager.
// Helper partagé levelStepChart : couleurs sémantiques du thème (clair / sombre)
function LevelTrend({ points, values }: { points: { asOf: string; level: Level }[]; values?: { header: string; cells: string[] } }) {
  if (points.length === 0) return null;
  const message = levelTrendMessage(points);
  const spec = levelStepChart({
    categories: points.map((p) => monthOf(p.asOf)),
    levels: points.map((p) => LEVEL_LABELS[p.level]),
    order: [LEVEL_LABELS.FAIBLE, LEVEL_LABELS.MOYEN, LEVEL_LABELS.ELEVE],
  });
  return (
    <Sub title={message} icon="history" intro={`Niveau de risque à chaque calcul mensuel publié (${points.length} ${plural(points.length, "calcul")} sur 12 mois)`}>
      <Chart spec={spec} height={170} ariaLabel={`Évolution du niveau de risque sur 12 mois. ${message}.`} />
      <ChartData
        caption="Niveau de risque par mois"
        table={{
          headers: ["Mois", "Niveau de risque", ...(values ? [values.header] : [])],
          rows: points.map((p, i) => [monthOf(p.asOf), LEVEL_LABELS[p.level], ...(values ? [values.cells[i]] : [])]),
        }}
      />
    </Sub>
  );
}

function RhEstimation({ e }: { e: EstimationRh }) {
  if (e.status !== "OK") return <NoEstimate e={e} />;
  const max = Math.max(...e.factors.map((f) => Math.abs(f.contribution)), 1e-9);
  const probPoints = e.history.filter((h) => h.estimate.type === "PROBABILITE");
  const estimateText = (x: (typeof e.history)[number]["estimate"]) => (x.type === "PROBABILITE" ? formatProb(x.prob6) : formatPoints(x.points));
  return (
    <>
      <div className={panelCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <RiskBadge level={e.level} />
          <span className="text-xs text-fg-muted">Calcul au {formatDate(e.asOf)}</span>
        </div>
        <LevelScale level={e.level} />
        {e.estimate.type === "PROBABILITE" ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-fg-muted">Probabilité à 6 mois</p>
            <p className="text-3xl font-semibold leading-tight tabular-nums text-heading">{formatProb(e.estimate.prob6)}</p>
            <p className="text-sm text-fg-muted">
              Probabilité estimée d&apos;un départ volontaire d&apos;ici 6 mois, soit {formatLiftWords(e.estimate.lift)} des collaborateurs évalués.
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-lg font-semibold text-heading">{formatPoints(e.estimate.points)}</p>
            <p className="text-sm text-fg-muted">Nombre de points des conditions de risque remplies : ce n&apos;est pas un pourcentage.</p>
          </div>
        )}
        <p className="mt-2 text-xs text-fg-subtle">
          Estimation calculée avec le {fmt.model(e.modelVersion)}
          {e.computedAt ? `, publiée le ${fmt.date(e.computedAt)}` : ""}
        </p>
      </div>

      <LevelTrend points={e.history} values={{ header: "Estimation", cells: e.history.map((h) => estimateText(h.estimate)) }} />
      {probPoints.length > 1 && (
        <Sub
          title={`Probabilité estimée : ${estimateText(probPoints[0].estimate)} en ${monthOf(probPoints[0].asOf)}, ${estimateText(probPoints[probPoints.length - 1].estimate)} en ${monthOf(probPoints[probPoints.length - 1].asOf)}`}
          icon="history"
          intro="Probabilité à 6 mois à chaque calcul publié avec le modèle statistique"
        >
          <Chart
            height={180}
            spec={lineChart({
              categories: probPoints.map((h) => monthOf(h.asOf)),
              series: [{ name: "Probabilité à 6 mois", values: probPoints.map((h) => (h.estimate.type === "PROBABILITE" ? Math.round(h.estimate.prob6 * 1000) / 10 : null)) }],
              measure: "Probabilité à 6 mois",
              unit: "%",
            })}
          />
        </Sub>
      )}

      <Sub
        title="Principaux facteurs associés"
        icon="factors"
        aside={<TermTip term="facteursAssocies" role="RH" align="end" />}
        intro={e.factors.length > 0 && "Du plus au moins important. La barre montre le poids du facteur dans l'estimation."}
      >
        {e.factors.length === 0 ? (
          <Empty>Aucun facteur disponible.</Empty>
        ) : (
          <ol className="space-y-2">
            {e.factors.map((f) => {
              const up = f.direction === "HAUSSE";
              const share = Math.abs(f.contribution) / max;
              const weight = share >= 0.66 ? "fort" : share >= 0.33 ? "moyen" : "faible";
              return (
                <li key={f.group} className={`rounded-control border-l-4 bg-surface p-3 ring-1 ring-inset ring-line ${up ? "border-l-danger" : "border-l-success"}`}>
                  <p className="text-sm font-medium text-fg">{f.phrase}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                    <span className={`inline-flex items-center gap-1 font-semibold ${up ? "text-danger" : "text-success"}`}>
                      <Icon name={up ? "up" : "down"} className="h-3.5 w-3.5" />
                      {up ? "Fait monter le risque" : "Fait baisser le risque"}
                    </span>
                    <span className="text-fg-muted">
                      · {f.label} · poids {weight}
                    </span>
                  </p>
                  <div className="mt-1.5 h-2 rounded-full bg-surface-3" aria-hidden="true">
                    <div className={`h-2 rounded-full ${up ? "bg-danger" : "bg-success"}`} style={{ width: `${Math.max(4, Math.round(share * 100))}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Sub>
    </>
  );
}

function ManagerEstimation({ e }: { e: EstimationManager }) {
  if (e.status !== "OK") return <NoEstimate e={e} />;
  return (
    <>
      <div className={panelCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <RiskBadge level={e.level} />
          <span className="text-xs text-fg-muted">Calcul au {formatDate(e.asOf)}</span>
        </div>
        <LevelScale level={e.level} />
      </div>
      <LevelTrend points={e.history} />
      <Sub
        title="Catégories de facteurs associés"
        icon="factors"
        aside={<TermTip term="facteursAssocies" role="MANAGER" align="end" />}
        intro={e.factors.length > 0 && "Domaines qui pèsent le plus dans l'estimation, du plus au moins important. Le détail est réservé à la RH."}
      >
        {e.factors.length === 0 ? (
          <Empty>Aucun facteur disponible.</Empty>
        ) : (
          <ul className="space-y-2">
            {e.factors.map((f, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-control bg-surface p-2.5 text-sm font-medium text-fg ring-1 ring-inset ring-line">
                <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
                  <Icon name="factors" className="h-3.5 w-3.5" />
                </span>
                {f.phrase}
              </li>
            ))}
          </ul>
        )}
      </Sub>
    </>
  );
}

const ACTION_ICON: Record<string, keyof typeof ICONS> = { ENTRETIEN: "chat", REVISION_SALARIALE: "money", CHARGE_TRAVAIL: "clock", PLAN_FORMATION: "training" };
const TRIGGER_LABELS: Record<string, string> = { NIVEAU_ELEVE: "Niveau de risque Élevé" };

export function SuggestionsZone({
  d,
  decideAction,
  feedbackAction,
  today,
  className = "",
}: {
  d: EmployeeDetailDto;
  decideAction: Action;
  feedbackAction: Action;
  today: string;
  className?: string;
}) {
  const pending = d.recommendations.filter((r) => r.status === "PROPOSEE").length;
  return (
    <Zone
      n={3}
      hint={
        d.view === "RH"
          ? "Ce que vous pouvez faire : actions proposées par l'outil, à décider par la RH. Une aide à la décision, pas une obligation."
          : "Actions proposées pour ce collaborateur. La décision revient à la RH."
      }
      aside={pending > 0 && <StatusBadge tone="info">{d.view === "RH" ? `${pending} à décider` : `${pending} en attente`}</StatusBadge>}
      className={className}
    >
      {d.recommendations.length === 0 ? (
        <EmptyState title="Aucune recommandation pour ce collaborateur">Les suggestions sont proposées à chaque calcul mensuel, selon le niveau de risque et les facteurs associés.</EmptyState>
      ) : (
        <ul className="grid items-start gap-3 @3xl:grid-cols-2">
          {d.view === "RH"
            ? d.recommendations.map((r) => (
                <RecoCard key={r.id} actionCode={r.actionCode} triggerGroup={r.triggerGroup} triggerLabel={r.triggerLabel} status={r.status} createdAt={r.createdAt}>
                  {(r.interventionDate || r.comment || r.feedback) && (
                    <ul className="mt-2 space-y-0.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-fg-muted ring-1 ring-inset ring-line">
                      {r.interventionDate && <li>Intervention réalisée le {formatDate(r.interventionDate)}.</li>}
                      {r.comment && (
                        <li>
                          {r.status === "REJETEE" ? "Motif du rejet" : "Commentaire"} : {r.comment}
                        </li>
                      )}
                      {r.feedback && <li>Pertinence : {FEEDBACK_LABELS[r.feedback]}.</li>}
                    </ul>
                  )}
                  <RecommendationActions
                    recommendationId={r.id}
                    status={r.status}
                    feedback={r.feedback}
                    decideAction={decideAction}
                    feedbackAction={feedbackAction}
                    today={today}
                    mode="buttons"
                  />
                </RecoCard>
              ))
            : d.recommendations.map((r) => (
                <RecoCard key={r.id} actionCode={r.actionCode} triggerGroup={r.triggerGroup} triggerLabel={r.triggerLabel} status={r.status} createdAt={r.createdAt} />
              ))}
        </ul>
      )}
    </Zone>
  );
}

function RecoCard({
  actionCode,
  triggerGroup,
  triggerLabel,
  status,
  createdAt,
  children,
}: {
  actionCode: string;
  triggerGroup: string;
  triggerLabel: string;
  status: string;
  createdAt: string;
  children?: ReactNode;
}) {
  const tone = status === "REALISEE" ? "success" : status === "REJETEE" ? "neutral" : "info";
  const open = status === "PROPOSEE";
  return (
    <li
      className={`flex items-start gap-3 rounded-control p-3.5 ring-1 ring-inset transition-shadow ${open ? "bg-surface shadow-card ring-line hover:ring-line-strong" : "bg-surface-2 ring-line"}`}
    >
      <span aria-hidden="true" className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control ${open ? "bg-primary-soft text-link" : "bg-surface-3 text-fg-muted"}`}>
        <Icon name={ACTION_ICON[actionCode] ?? "bulb"} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-heading">{actionLabel(actionCode)}</span>
          <StatusBadge tone={tone}>{RECO_STATUS_LABELS[status] ?? status}</StatusBadge>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">
          Déclenchée par : {TRIGGER_LABELS[triggerGroup] ?? triggerLabel} · proposée le {formatDate(createdAt.slice(0, 10))}
        </p>
        {children}
      </div>
    </li>
  );
}

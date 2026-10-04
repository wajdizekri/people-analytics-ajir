import type { ReactNode } from "react";
import { InfoTip } from "@/components/help/info-tip";
import { Icon, type IconName } from "./icons";
import { SectionHeader } from "./index";
import { cardCls } from "./classes";
import { cssChartColor } from "@/components/charts/theme";

// Blocs de lecture rapide : verdict en une phrase, question → réponse, sections, étapes, légendes.
// Le verdict est toujours écrit en mots ; la couleur et l'icône ne font que le doubler.

export type Verdict = "bon" | "attention" | "critique" | "neutre";

const VERDICT: Record<Verdict, { border: string; text: string; bg: string; dot: string; icon: IconName }> = {
  bon: { border: "border-l-success", text: "text-success", bg: "bg-success-soft", dot: "bg-success", icon: "check" },
  attention: { border: "border-l-warning", text: "text-warning", bg: "bg-warning-soft", dot: "bg-warning", icon: "warning" },
  critique: { border: "border-l-danger", text: "text-danger", bg: "bg-danger-soft", dot: "bg-danger", icon: "error" },
  neutre: { border: "border-l-line-strong", text: "text-fg-muted", bg: "bg-surface-3", dot: "bg-fg-subtle", icon: "info" },
};

// Pastille de verdict : mot + point de couleur
export function StatusPill({ tone, label }: { tone: Verdict; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-fg ring-1 ring-inset ring-line-strong/50">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${VERDICT[tone].dot}`} />
      {label}
    </span>
  );
}

// Bandeau « état en une phrase » : verdict (mot + couleur + icône), phrase de synthèse en gras, points d'attention, contenu libre
export function StatusSummary({
  tone,
  label,
  title,
  points,
  children,
  ariaLabel = "État en un coup d'œil",
  className = "",
}: {
  tone: Verdict;
  /** Verdict en un mot : « Bon », « À surveiller », « Critique ». */
  label: string;
  /** Phrase de synthèse : « Les données du 31/08/2026 sont exploitables. » */
  title: ReactNode;
  points?: ReactNode[];
  children?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const t = VERDICT[tone];
  return (
    <section aria-label={ariaLabel} className={`${cardCls} mb-4 border-l-4 ${t.border} p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.bg} ${t.text}`}>
          <Icon name={t.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold uppercase tracking-wide ${t.text}`}>{label}</p>
          <p className="mt-0.5 text-base font-semibold leading-snug text-heading">{title}</p>
          {points && points.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              {points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}

// Haut de page : la question que se pose le RH (h2), la réponse en une phrase avec verdict, périmètre / période, puis 3 ou 4 KpiCard
export function QuestionAnswer({
  id,
  question,
  verdict,
  scope,
  method,
  children,
}: {
  id: string;
  question: string;
  verdict: { tone: Verdict; label: string; text: ReactNode };
  /** Périmètre et période de la réponse. */
  scope: ReactNode;
  /** Contenu de la bulle « Méthode ». */
  method?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-6">
      <div className={`${cardCls} border-l-4 px-4 py-3 ${VERDICT[verdict.tone].border}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={id} className="text-base font-semibold text-heading">
            {question}
          </h2>
          <StatusPill tone={verdict.tone} label={verdict.label} />
          {method && (
            <InfoTip label="Méthode" prefix="Aide" align="start">
              {method}
            </InfoTip>
          )}
        </div>
        <p className="mt-1.5 text-[15px] leading-snug text-fg">{verdict.text}</p>
        <p className="mt-1 text-[13px] text-fg-muted">{scope}</p>
      </div>
      {children && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>}
    </section>
  );
}

// Section de page : <section id aria-labelledby> + SectionHeader (titre, bulle « ? », actions)
export function Section({
  id,
  title,
  intro,
  description,
  actions,
  tip,
  level = 2,
  children,
  className = "",
}: {
  id: string;
  title: string;
  /** Bulle « ? » du titre. */
  intro?: ReactNode;
  /** Alias de intro. */
  description?: ReactNode;
  actions?: ReactNode;
  tip?: ReactNode;
  level?: 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className={`mb-8 scroll-mt-4 ${className}`}>
      <SectionHeader id={`${id}-titre`} title={title} description={intro ?? description} actions={actions} tip={tip} level={level} />
      {children}
    </section>
  );
}

export type StepStatus = "todo" | "current" | "done" | "error";
const STEP_TEXT: Record<StepStatus, string> = { todo: "à faire", current: "en cours", done: "terminée", error: "en erreur" };
const STEP_STYLE: Record<StepStatus, { circle: string; title: string }> = {
  todo: { circle: "border-2 border-line-strong bg-surface text-fg-muted", title: "text-fg-muted" },
  current: { circle: "border-2 border-primary bg-primary text-primary-fg", title: "font-semibold text-heading" },
  done: { circle: "border-2 border-success bg-success text-surface", title: "text-fg" },
  error: { circle: "border-2 border-danger-solid bg-danger-solid text-white", title: "font-semibold text-danger" },
};

// Étapes numérotées d'un parcours guidé (import en 3 étapes) : numéro, titre, état écrit, trait de liaison
export function Steps({ steps, label = "Étapes", className = "" }: { steps: { title: string; status: StepStatus; description?: ReactNode }[]; label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={`flex flex-col gap-3 sm:flex-row sm:gap-0 ${className}`}>
      {steps.map((s, i) => {
        const st = STEP_STYLE[s.status];
        return (
          <li key={i} aria-current={s.status === "current" ? "step" : undefined} className="flex min-w-0 flex-1 items-start gap-2.5 sm:pr-3">
            <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${st.circle}`}>
              {s.status === "done" ? <Icon name="check" /> : s.status === "error" ? <Icon name="x" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={`text-sm ${st.title}`}>
                  <span className="sr-only">Étape {i + 1} : </span>
                  {s.title}
                </span>
                {i < steps.length - 1 && <span aria-hidden="true" className="hidden h-px flex-1 bg-line-strong/50 sm:block" />}
              </span>
              <span className={`block text-xs ${s.status === "error" ? "text-danger" : "text-fg-muted"}`}>
                {s.description ?? STEP_TEXT[s.status].replace(/^./, (c) => c.toUpperCase())}
                {s.description && <span className="sr-only"> ({STEP_TEXT[s.status]})</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Légende HTML (pastille ou tiret + mot) pour un visuel dont la couleur porte un statut
export function ColorLegend({ items, className = "" }: { items: { color: string; label: string; dashed?: boolean }[]; className?: string }) {
  return (
    <ul className={`mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted ${className}`}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed ? (
            <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: cssChartColor(i.color) }} />
          ) : (
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: cssChartColor(i.color) }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, StatusBadge, buttonClass, cardCls } from "@/components/ui";
import type { Statement } from "@/lib/dal/synthesis";
import { INSIGHT_ICONS, TONE_LABELS, TONE_STYLE, statementAction, type InsightIcon } from "./labels";

export function InsightIconSvg({ name, className = "h-4 w-4" }: { name: InsightIcon; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={INSIGHT_ICONS[name]} />
    </svg>
  );
}

const TONE_ICON: Record<Statement["tone"], InsightIcon> = { alerte: "alert", attention: "watch", info: "info", positif: "good" };

function StatementLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  return href.startsWith("#") ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// Constats rédigés : couleur de bordure + libellé texte du ton (jamais la couleur seule), action « verbe + objet ».
// priority : cartes avec bouton d'action (constats à traiter) ; compact : liste courte (informations, bonnes nouvelles)
export function StatementList({ items, variant = "priority" }: { items: Statement[]; variant?: "priority" | "compact" }) {
  if (variant === "compact")
    return (
      <ul className="divide-y divide-line">
        {items.map((s) => {
          const st = TONE_STYLE[s.tone];
          return (
            <li key={s.key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${st.icon}`}>
                <InsightIconSvg name={TONE_ICON[s.tone]} className="h-3.5 w-3.5" />
              </span>
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-fg">
                <StatusBadge tone={st.badge} dot={false}>
                  {TONE_LABELS[s.tone]}
                </StatusBadge>{" "}
                <span className="align-middle">{s.text}</span>
                {s.href && (
                  <>
                    {" "}
                    <StatementLink
                      href={s.href}
                      className="whitespace-nowrap rounded-sm align-middle font-medium text-link underline underline-offset-2 transition-colors duration-200 hover:text-fg hover:decoration-2"
                    >
                      {statementAction(s)}
                    </StatementLink>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    );
  return (
    <ol className="space-y-2">
      {items.map((s) => {
        const st = TONE_STYLE[s.tone];
        return (
          <li
            key={s.key}
            className={`flex flex-col gap-3 rounded-control border-l-4 bg-surface p-3 ring-1 ring-inset ring-line sm:flex-row sm:items-center sm:p-4 ${st.border}`}
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${st.icon}`}>
                <InsightIconSvg name={TONE_ICON[s.tone]} />
              </span>
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-fg">
                <StatusBadge tone={st.badge} dot={false}>
                  {TONE_LABELS[s.tone]}
                </StatusBadge>{" "}
                <span className="align-middle">{s.text}</span>
              </p>
            </div>
            {s.href && (
              <StatementLink href={s.href} className={buttonClass("secondary", "sm", "shrink-0 self-start sm:self-center")}>
                {statementAction(s)}
                <Icon name="chevron-right" />
              </StatementLink>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Encadré des composants de fiche : même gabarit que les zones de la fiche collaborateur
export function InsightZone({
  id,
  title,
  hint,
  icon,
  aside,
  children,
  className = "",
}: {
  id: string;
  title: string;
  hint: string;
  icon: InsightIcon;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`${cardCls} min-w-0 p-4 sm:p-5 ${className}`}>
      <header className="mb-4 flex items-start gap-3 border-b border-line pb-3">
        <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
          <InsightIconSvg name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-base font-semibold leading-7 text-heading">
            {title}
          </h2>
          <p className="text-xs text-fg-muted">{hint}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

// Valeur avant → après, avec le sens de variation en texte
export function BeforeAfter({
  label,
  before,
  after,
  delta,
  better,
}: {
  label: string;
  before: ReactNode;
  after: ReactNode;
  delta?: number | null;
  better?: "down" | "up";
}) {
  const favorable = delta == null || delta === 0 || !better ? null : delta < 0 === (better === "down");
  return (
    <div className="rounded-control bg-surface-2 px-2.5 py-2 ring-1 ring-inset ring-line">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-semibold tabular-nums text-heading">
        <span>{before}</span>
        <InsightIconSvg name="arrow" className="h-3.5 w-3.5 text-fg-subtle" />
        <span className="sr-only">puis</span>
        <span>{after}</span>
      </p>
      {favorable != null && (
        <p className={`text-xs font-medium ${favorable ? "text-success" : "text-danger"}`}>{favorable ? "Évolution favorable" : "Évolution défavorable"}</p>
      )}
    </div>
  );
}

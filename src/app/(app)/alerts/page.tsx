import Link from "next/link";
import { Suspense } from "react";
import { pageContext, type AccessContext } from "@/lib/dal/context";
import { ActiveFilters, FilterForm, Pagination, buildHref } from "@/components/pilotage/filters";
import { ALERT_SEVERITIES, alertFiltersSchema, countAlerts, listAlerts, type AlertSeverity, type AlertStatus, type AlertType } from "@/lib/dal/alerts";
import { ALERT_STATUSES, ALERT_TYPES } from "@/db/schema";
import { ButtonLink, EmptyState, Notice, PageHeader, cardCls, fmt } from "@/components/ui";
import { AlertsListSkeleton } from "@/components/admin/skeletons";
import { ExportButton } from "@/components/export/export-button";
import {
  SEVERITY_BORDER,
  SEVERITY_DOT,
  SEVERITY_LABEL,
  STATUS_LABEL,
  SeverityBadge,
  StatusBadge,
  TYPES_BY_ROLE,
  TYPE_LABEL,
  TypeIcon,
  alertDate,
  concernedLabel,
  proposedAction,
  withReturn,
} from "./labels";

export const metadata = { title: "Alertes — People Analytics AJIR" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const PAGE_SIZE = 50;

const SUBTITLE = {
  MANAGER: "Situations à examiner dans votre équipe : risque de départ et absentéisme collectif. Les signaux individuels d'absentéisme restent réservés à la RH.",
  RH: "Situations à examiner : risque de départ, absentéisme et qualité des données. Chaque alerte propose une action et se suit jusqu'à sa clôture.",
  ADMIN: "Alertes techniques : qualité des imports et fonctionnement du service de calcul. Aucune alerte nominative.",
} as const;
const SCOPE = { MANAGER: "Votre équipe (périmètre hiérarchique)", RH: "Toute l'entreprise", ADMIN: "Fonctionnement de l'outil" } as const;

// Pas de loading.tsx ici : il envelopperait aussi alerts/[id] (redirection 403 et 404 doivent précéder le streaming)
export default async function AlertsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext();
  return (
    <>
      <PageHeader eyebrow={ctx.role === "ADMIN" ? "Administration" : "Vue d'ensemble"} title="Alertes" subtitle={SUBTITLE[ctx.role]} scope={SCOPE[ctx.role]} />
      <Suspense fallback={<AlertsListSkeleton />}>
        <AlertsContent ctx={ctx} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AlertsContent({ ctx, searchParams }: { ctx: AccessContext; searchParams: SP }) {
  const sp = await searchParams;
  const parsed = alertFiltersSchema.safeParse({ type: one(sp.type), status: one(sp.status), severity: one(sp.severity) });
  const values: { type?: AlertType; status?: AlertStatus; severity?: AlertSeverity } = parsed.success
    ? { type: parsed.data.type, status: parsed.data.status, severity: parsed.data.severity }
    : {};
  const filtered = !!(values.type || values.status || values.severity);
  // Total exact (sans plafond) et pagination
  const total = countAlerts(ctx, values);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number(one(sp.page));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pageCount) : 1;
  const alerts = listAlerts(ctx, { ...values, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const without = (k: keyof typeof values) => buildHref("/alerts", { ...values, [k]: undefined });
  const active = [
    ...(values.type ? [{ label: "Type", value: TYPE_LABEL[values.type], removeHref: without("type") }] : []),
    ...(values.status ? [{ label: "Statut", value: STATUS_LABEL[values.status], removeHref: without("status") }] : []),
    ...(values.severity ? [{ label: "Gravité", value: SEVERITY_LABEL[values.severity], removeHref: without("severity") }] : []),
  ];
  const bySeverity = values.severity
    ? [{ s: values.severity, n: total }]
    : [...ALERT_SEVERITIES].reverse().map((s) => ({ s, n: countAlerts(ctx, { ...values, severity: s }) })).filter((x) => x.n > 0);
  // Retour depuis le détail vers la liste filtrée
  const here = buildHref("/alerts", { ...values, page: page > 1 ? page : undefined });
  const detailHref = (id: number) => buildHref(`/alerts/${id}`, { retour: here === "/alerts" ? undefined : here });
  const onlyNew = values.status === "NOUVELLE" && !values.type && !values.severity;
  const types = ALERT_TYPES.filter((t) => TYPES_BY_ROLE[ctx.role].includes(t) || t === values.type);

  return (
    <>
      <FilterForm
        action="/alerts"
        values={values}
        showReset={filtered}
        fields={[
          { name: "status", label: "Statut", allLabel: "Tous", options: ALERT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
          { name: "type", label: "Type", allLabel: "Tous", options: types.map((t) => ({ value: t, label: TYPE_LABEL[t] })) },
          { name: "severity", label: "Gravité", allLabel: "Toutes", options: ALERT_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] })) },
        ]}
      />
      <ActiveFilters filters={active} />

      {!parsed.success && (
        <div className="mb-4">
          <Notice tone="warning">Filtres invalides ignorés : choisissez le type, le statut et la gravité dans les listes.</Notice>
        </div>
      )}

      {alerts.length === 0 ? (
        <EmptyState
          icon={filtered ? "search" : "inbox"}
          title={onlyNew ? "Aucune alerte nouvelle" : filtered ? "Aucune alerte ne correspond à ces filtres" : "Aucune alerte pour le moment"}
          action={
            filtered ? (
              <ButtonLink href="/alerts" variant="secondary">
                Afficher toutes les alertes
              </ButtonLink>
            ) : undefined
          }
        >
          {onlyNew
            ? "Toutes les alertes ont été prises en charge. Les nouvelles alertes apparaissent après le calcul mensuel et les imports AJIR."
            : filtered
              ? "Retirez un filtre ou élargissez la sélection pour voir davantage d'alertes."
              : "Les alertes sont créées lors du calcul mensuel et des imports AJIR."}
        </EmptyState>
      ) : (
        <section className={`${cardCls} min-w-0 overflow-hidden`} aria-labelledby="alertes-liste">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
            <h2 id="alertes-liste" className="text-sm text-fg-muted">
              <span className="text-lg font-semibold tabular-nums text-heading">{fmt.int(total)}</span> alerte{total > 1 ? "s" : ""}
              <span className="text-fg-muted"> · nouvelles et en cours d&apos;abord, les plus graves en tête</span>
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Répartition par gravité">
                {bySeverity.map(({ s, n }) => (
                  <li key={s} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SEVERITY_DOT[s]}`} />
                    <span className="font-semibold tabular-nums text-fg">{fmt.int(n)}</span> {SEVERITY_LABEL[s].toLowerCase()}
                  </li>
                ))}
              </ul>
              <ExportButton kind="alerts" searchParams={sp} total={total} size="sm" />
            </div>
          </div>
          <ol className="divide-y divide-line" aria-label={`Alertes, page ${page} sur ${pageCount}`}>
            {alerts.map((a) => {
              const when = alertDate(a.createdAt);
              const closed = a.status === "TRAITEE" || a.status === "REJETEE";
              return (
                <li key={a.id} data-alert-id={a.id} className={`border-l-4 px-4 py-3.5 transition-colors duration-150 ${SEVERITY_BORDER[a.severity]} ${closed ? "bg-surface-2 hover:bg-surface-3" : "bg-surface hover:bg-surface-2"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <SeverityBadge severity={a.severity} withHint={!closed} />
                    <span data-field="type" className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-brand-magenta dark:text-fuchsia-300">
                      <TypeIcon type={a.type} />
                      {TYPE_LABEL[a.type]}
                    </span>
                    <StatusBadge status={a.status} />
                    <span className="text-fg-muted">
                      Créée le{" "}
                      {when ? (
                        <time dateTime={a.createdAt} className="tabular-nums">
                          {when.day} à {when.time}
                        </time>
                      ) : (
                        fmt.date(a.createdAt)
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold leading-snug">
                        <Link href={detailHref(a.id)} className="text-heading underline-offset-2 transition-colors hover:text-link hover:underline">
                          {a.title}
                        </Link>
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted" title={a.message}>
                        {a.message}
                      </p>
                      <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-[13px] sm:grid-cols-[max-content_minmax(0,1fr)]">
                        <dt className="font-medium text-fg-muted">Concerne</dt>
                        <dd data-field="concerne" className="text-fg">
                          {a.employeeName && a.link?.startsWith("/employees/") ? (
                            <Link href={withReturn(a.link, here)} className="text-link underline-offset-2 hover:underline">
                              {a.employeeName}
                            </Link>
                          ) : a.departmentName && a.link?.startsWith("/absenteeism") ? (
                            <Link href={a.link} className="text-link underline-offset-2 hover:underline">
                              {a.departmentName}
                            </Link>
                          ) : (
                            concernedLabel(a)
                          )}
                        </dd>
                        <dt className="font-medium text-fg-muted">Action proposée</dt>
                        <dd className="text-fg">{proposedAction(a, ctx.role)}</dd>
                      </dl>
                    </div>
                    <ButtonLink href={detailHref(a.id)} variant={closed ? "tertiary" : "secondary"} size="sm" iconEnd="arrow-right" className="self-start">
                      {closed ? "Voir l'alerte" : "Traiter l'alerte"}
                      <span className="sr-only"> « {a.title} »</span>
                    </ButtonLink>
                  </div>
                </li>
              );
            })}
          </ol>
          {pageCount > 1 && (
            <div className="border-t border-line bg-surface-2/60 px-4 py-2.5">
              <Pagination path="/alerts" params={values} page={page} pageCount={pageCount} total={total} pageSize={PAGE_SIZE} embedded />
            </div>
          )}
        </section>
      )}
    </>
  );
}

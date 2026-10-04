import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageContext } from "@/lib/dal/context";
import { ALERT_TRANSITIONS, alertFiltersSchema, getAlert, listAlerts, type AlertDTO, type AlertStatus } from "@/lib/dal/alerts";
import { safeReturn } from "@/components/ux/breadcrumb";
import { HttpError } from "@/lib/dal/errors";
import { Badge, ButtonLink, Card, Icon, Notice, PageHeader, fmt } from "@/components/ui";
import { buildHref } from "@/components/pilotage/filters";
import { AlertStatusForm } from "../alert-status-form";
import { STATUS_LABEL, SeverityBadge, StatusBadge, TYPE_LABEL, TypeIcon, concernedLabel, linkLabel, proposedAction, withReturn } from "../labels";

export const metadata = { title: "Alerte — People Analytics AJIR" };

const dtCls = "text-xs font-medium text-fg-muted";
const ddCls = "mt-1 text-sm text-fg";

// Étapes du suivi : Nouvelle → En cours → Traitée (ou Rejetée)
function Steps({ status }: { status: AlertStatus }) {
  const rejected = status === "REJETEE";
  const steps: AlertStatus[] = ["NOUVELLE", "EN_COURS", rejected ? "REJETEE" : "TRAITEE"];
  const reached = rejected ? 2 : steps.indexOf(status);
  return (
    <div className="relative mb-4">
      <span aria-hidden="true" className="absolute inset-x-[16.6%] top-3.5 h-px bg-line-strong/50" />
      <ol className="relative grid grid-cols-3 gap-1 text-center text-xs" aria-label="Étapes du suivi">
        {steps.map((s, i) => {
          const done = i <= reached;
          const current = i === reached;
          return (
            <li key={s} aria-current={current ? "step" : undefined} className="relative flex flex-col items-center gap-1">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ring-4 ring-surface transition-colors ${
                  current ? (rejected ? "bg-fg-muted text-surface" : "bg-primary text-primary-fg") : done ? "bg-primary-soft text-link" : "bg-surface-3 text-fg-subtle"
                }`}
              >
                {done && !current ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={current ? "font-semibold text-fg" : "text-fg-muted"}>
                {STATUS_LABEL[s]}
                {current ? <span className="sr-only"> (étape actuelle)</span> : done && <span className="sr-only"> (étape franchie)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default async function AlertDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await pageContext();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  let alert: AlertDTO;
  try {
    alert = getAlert(ctx, id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    if (err instanceof HttpError && err.status === 403) redirect("/interdit");
    throw err;
  }
  const next = ALERT_TRANSITIONS[alert.status];
  const retour = safeReturn((await searchParams)?.retour, ["/alerts"]) ?? "/alerts";
  // Enchaîner le tri : prochaine alerte nouvelle visible, dans la sélection (type, gravité) de la liste d'origine,
  // une fois celle-ci prise en charge ou clôturée
  const origin = new URLSearchParams(retour.split("?")[1] ?? "");
  const sel = alertFiltersSchema.pick({ type: true, severity: true }).safeParse({ type: origin.get("type") ?? undefined, severity: origin.get("severity") ?? undefined });
  const selection = sel.success ? { type: sel.data.type, severity: sel.data.severity } : {};
  const narrowed = !!(selection.type || selection.severity);
  const following =
    alert.status === "NOUVELLE" ? null : (listAlerts(ctx, { status: "NOUVELLE", ...selection, limit: 2 }).find((a) => a.id !== alert.id) ?? null);
  const closed = next.length === 0;
  // Fiche du collaborateur : fil d'Ariane « Alerte » qui ramène ici, pour clôturer l'alerte sans la rechercher
  const self = `/alerts/${alert.id}`;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href={retour} className="group inline-flex min-h-10 items-center gap-1.5 font-medium text-link underline-offset-2 hover:underline">
          <Icon name="arrow-left" className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Toutes les alertes
        </Link>
      </p>
      <PageHeader
        eyebrow={ctx.role === "ADMIN" ? "Administration" : "Vue d'ensemble"}
        title={alert.title}
        badge={<Badge>Aide à la décision</Badge>}
        period={`Créée le ${fmt.dateTime(alert.createdAt)}`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card title="Description" className="lg:col-span-2">
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg">{alert.message}</p>

          <dl className="mt-4 grid gap-x-6 gap-y-4 rounded-control bg-surface-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className={dtCls}>Gravité</dt>
              <dd className={ddCls}>
                <SeverityBadge severity={alert.severity} withHint />
              </dd>
            </div>
            <div>
              <dt className={dtCls}>Statut</dt>
              <dd className={ddCls}>
                <StatusBadge status={alert.status} />
              </dd>
            </div>
            <div>
              <dt className={dtCls}>Type</dt>
              <dd className={`${ddCls} inline-flex items-center gap-1.5 font-medium text-brand-magenta dark:text-fuchsia-300`}>
                <TypeIcon type={alert.type} />
                {TYPE_LABEL[alert.type]}
              </dd>
            </div>
            <div>
              <dt className={dtCls}>{alert.employeeName ? "Collaborateur" : "Concerne"}</dt>
              <dd className={`${ddCls} font-medium`}>
                {alert.employeeName && alert.link?.startsWith("/employees/") ? (
                  <Link href={withReturn(alert.link, self)} className="text-link underline-offset-2 hover:underline">
                    {alert.employeeName}
                  </Link>
                ) : alert.departmentName && alert.link?.startsWith("/absenteeism") ? (
                  <Link href={alert.link} className="text-link underline-offset-2 hover:underline">
                    {alert.departmentName}
                  </Link>
                ) : (
                  concernedLabel(alert)
                )}
              </dd>
            </div>
            {alert.departmentName && alert.employeeName && (
              <div>
                <dt className={dtCls}>Département</dt>
                <dd className={ddCls}>{alert.departmentName}</dd>
              </div>
            )}
            <div>
              <dt className={dtCls}>Dernière mise à jour</dt>
              <dd className={ddCls}>
                {alert.updatedAt ? (
                  <>
                    {fmt.dateTime(alert.updatedAt)}
                    {alert.updatedByLogin && ` par ${alert.updatedByLogin}`}
                  </>
                ) : (
                  <span className="text-fg-muted">Aucune</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-4 rounded-control border border-primary/30 bg-primary-soft p-3">
            <h3 className="text-sm font-semibold text-fg">Action proposée</h3>
            <p className="mt-0.5 text-sm text-fg">{proposedAction(alert, ctx.role)}</p>
            {alert.link && (
              <ButtonLink href={withReturn(alert.link, self)} variant="secondary" size="sm" iconEnd="arrow-right" className="mt-2">
                {linkLabel(alert.link, alert.employeeName)}
              </ButtonLink>
            )}
          </div>

          {alert.comment && (
            <div className="mt-4 rounded-control border-l-4 border-accent bg-surface-2 px-3 py-2.5 text-sm">
              <p className="text-xs font-semibold text-fg-muted">Commentaire de suivi</p>
              <p className="mt-1 whitespace-pre-line text-fg">{alert.comment}</p>
            </div>
          )}
        </Card>

        <Card title="Suivi de l'alerte">
          <Steps status={alert.status} />
          {closed ? (
            <Notice tone={alert.status === "TRAITEE" ? "success" : "neutral"}>Alerte clôturée ({alert.status === "TRAITEE" ? "traitée" : "rejetée"})</Notice>
          ) : (
            <AlertStatusForm id={alert.id} next={next} />
          )}
          {following ? (
            <p className="mt-4">
              <ButtonLink
                href={buildHref(`/alerts/${following.id}`, {
                  retour: retour === "/alerts" ? undefined : retour,
                })}
                variant={closed ? "primary" : "secondary"}
                iconEnd="arrow-right"
                fullWidth
              >
                Traiter l&apos;alerte nouvelle suivante
                <span className="sr-only"> : « {following.title} »</span>
              </ButtonLink>
            </p>
          ) : (
            alert.status !== "NOUVELLE" && (
              <p className="mt-4 text-sm text-fg-muted">
                Aucune autre alerte nouvelle{narrowed ? " dans cette sélection" : ""} ·{" "}
                <Link href={retour} className="font-medium text-link underline underline-offset-2 hover:decoration-2">
                  Revenir à la liste
                </Link>
              </p>
            )
          )}
        </Card>
      </div>
    </>
  );
}

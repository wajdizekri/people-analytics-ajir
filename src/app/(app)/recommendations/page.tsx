import Link from "next/link";
import { Badge, ButtonLink, EmptyState, Initials, KpiTile, PageHeader, RiskBadge, cardCls, fmt } from "@/components/ui";
import { ActiveFilters, FilterForm, Pagination, buildHref } from "@/components/pilotage/filters";
import { FEEDBACK_LABELS, RECO_STATUS_LABELS, actionLabel, formatDate, formatRate, todayTunis } from "@/components/pilotage/labels";
import { RECO_WHAT, recoWhy } from "@/components/pilotage/reco-text";
import { decideRecommendationAction } from "@/app/(app)/employees/[id]/actions";
import { pageContext } from "@/lib/dal/context";
import { departmentOptions, parseQuery } from "@/lib/dal/employees";
import { RECO_STATUSES, listRecommendations, recommendationListSchema, type RecommendationRow } from "@/lib/dal/recommendations";
import { ExportButton } from "@/components/export/export-button";
import { RecoDecision } from "./reco-decision";

export const metadata = { title: "Recommandations — People Analytics AJIR" };

const STATUS_TONE = { PROPOSEE: "sky", REALISEE: "emerald", REJETEE: "slate", REMPLACEE: "slate" } as const;
const STATUS_ICON: Record<keyof typeof STATUS_TONE, string> = {
  PROPOSEE: "M8 4.5V8l2.2 1.4 M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0",
  REALISEE: "m3.5 8.5 3 3 6-7",
  REJETEE: "m4.5 4.5 7 7 m0-7-7 7",
  REMPLACEE: "M13 8a5 5 0 1 1-1.5-3.6 M13 2.5v3h-3",
};
const STATUS_FILTER_LABELS: Record<string, string> = { PROPOSEE: "Proposée (en attente de décision)", REALISEE: "Réalisée", REJETEE: "Rejetée ou remplacée" };
// Priorité d'affichage selon le niveau de risque actuel (estimation, à confirmer par un échange)
const PRIORITY = {
  ELEVE: { rank: 0, label: "Priorité haute", tone: "red", bar: "border-l-danger" },
  MOYEN: { rank: 1, label: "Priorité moyenne", tone: "amber", bar: "border-l-warning" },
  NONE: { rank: 2, label: "Priorité basse", tone: "slate", bar: "border-l-line-strong" },
} as const;
const priorityOf = (r: RecommendationRow) => (r.level === "ELEVE" ? PRIORITY.ELEVE : r.level === "MOYEN" ? PRIORITY.MOYEN : PRIORITY.NONE);

function StatusBadge({ status }: { status: keyof typeof STATUS_TONE }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-1 h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={STATUS_ICON[status]} />
      </svg>
      {RECO_STATUS_LABELS[status]}
    </Badge>
  );
}

function Label({ children }: { children: string }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{children}</p>;
}

export default async function RecommendationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(["RH"]);
  const raw = await searchParams;
  const { data: q, ignored } = parseQuery(recommendationListSchema, raw, "lenient");
  const l = listRecommendations(ctx, q);
  const depts = departmentOptions(ctx);
  const k = l.kpis;
  const current = { statut: q.statut, action: q.action, departement: q.departement };
  const without = (key: keyof typeof current) => buildHref("/recommendations", { ...current, [key]: undefined });
  const filters = [
    ...(q.statut ? [{ label: "Statut", value: STATUS_FILTER_LABELS[q.statut], removeHref: without("statut") }] : []),
    ...(q.action ? [{ label: "Action", value: actionLabel(q.action), removeHref: without("action") }] : []),
    ...(q.departement ? [{ label: "Département", value: depts.find((d) => d.id === q.departement)?.label ?? `n° ${q.departement}`, removeHref: without("departement") }] : []),
  ];
  // Retour depuis la fiche vers cette liste (filtres et page conservés)
  const here = buildHref("/recommendations", { ...current, page: l.page > 1 ? l.page : undefined });
  const today = todayTunis();
  const decided = k.done + k.rejected;
  // Ordre serveur conservé (en attente d'abord, puis les plus récentes) ; sur la page, les plus prioritaires d'abord
  const rows = l.rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.status === "PROPOSEE" ? 0 : 1) - (b.r.status === "PROPOSEE" ? 0 : 1) || priorityOf(a.r).rank - priorityOf(b.r).rank || a.i - b.i)
    .map(({ r }) => r);
  const parts = [
    { key: "done", label: "Réalisées", n: k.done, cls: "bg-success" },
    { key: "rejected", label: "Rejetées", n: k.rejected, cls: "bg-line-strong" },
    ...(k.superseded > 0 ? [{ key: "superseded", label: "Remplacées par un nouveau calcul", n: k.superseded, cls: "bg-fg-subtle" }] : []),
    { key: "proposed", label: "En attente de décision", n: k.proposed, cls: "bg-primary" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Collaborateurs"
        title="Recommandations"
        subtitle="Décider des actions proposées pour les collaborateurs en risque de départ élevé ou moyen. Une recommandation est une aide, pas une obligation."
        scope="Toute l'entreprise"
        actions={l.total > 0 ? <ExportButton kind="recommendations" searchParams={raw} total={l.total} /> : undefined}
      />
      <FilterForm
        action="/recommendations"
        values={q}
        showReset={filters.length > 0}
        fields={[
          { name: "statut", label: "Statut", allLabel: "Tous les statuts", options: RECO_STATUSES.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] })) },
          { name: "action", label: "Action recommandée", allLabel: "Toutes les actions", options: l.actions.map((a) => ({ value: a, label: actionLabel(a) })) },
          { name: "departement", label: "Département", allLabel: "Tous les départements", options: depts.map((d) => ({ value: String(d.id), label: d.label })) },
        ]}
      />
      <ActiveFilters filters={filters} ignored={ignored} note="le suivi de l'adoption ignore le filtre de statut" />

      <section aria-labelledby="adoption-titre" className={`${cardCls} mb-6 p-4 sm:p-5`}>
        <h2 id="adoption-titre" className="text-base font-semibold text-heading">
          Où en sont les {fmt.int(k.total)} recommandations ?
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {fmt.int(k.done)} réalisée{k.done > 1 ? "s" : ""}, {fmt.int(k.rejected)} rejetée{k.rejected > 1 ? "s" : ""}
          {k.superseded > 0 && `, ${fmt.int(k.superseded)} remplacée${k.superseded > 1 ? "s" : ""} par un nouveau calcul`} et{" "}
          <strong className="text-heading">{fmt.int(k.proposed)} en attente de décision</strong>
          .
        </p>
        {k.total > 0 && (
          <div className="mt-3">
            <div className="flex h-4 w-full gap-px overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              {parts.map((p) => (p.n > 0 ? <span key={p.key} className={`${p.cls} h-full transition-[width] duration-200`} style={{ width: `${(p.n / k.total) * 100}%` }} /> : null))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
              {parts.map((p) => (
                <li key={p.key} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-sm ${p.cls}`} />
                  {p.label} : <span className="font-semibold tabular-nums text-fg">{fmt.int(p.n)}</span> ({formatRate(p.n / k.total, 0)})
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-xs text-fg-muted">
          Taux d&apos;adoption = recommandations réalisées ÷ recommandations décidées par la RH (réalisées ou rejetées).
          {k.superseded > 0 && ` ${fmt.int(k.superseded)} remplacée${k.superseded > 1 ? "s" : ""} par un nouveau calcul, hors du taux.`}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          <KpiTile
            label="En attente de décision"
            value={fmt.int(k.proposed)}
            hint="Recommandations à traiter"
            href={buildHref("/recommendations", { statut: "PROPOSEE", action: q.action, departement: q.departement })}
          />
          <KpiTile
            label="Taux d'adoption"
            value={formatRate(k.adoptionRate, 0)}
            hint={decided ? `${fmt.int(k.done)} réalisée${k.done > 1 ? "s" : ""} sur ${fmt.int(decided)} décidée${decided > 1 ? "s" : ""}` : "Aucune recommandation décidée"}
          />
          <KpiTile
            label="Interventions enregistrées"
            value={fmt.int(k.interventions)}
            hint="Actions datées, avec leur avant / après"
            detailHref="/interventions"
            detailLabel="Voir les interventions"
          />
          <KpiTile
            label="Jugées pertinentes"
            value={formatRate(k.relevantRate, 0)}
            hint={k.feedbackCount ? `sur ${fmt.int(k.feedbackCount)} avis donné${k.feedbackCount > 1 ? "s" : ""}` : "Aucun avis donné pour l'instant"}
          />
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon={filters.length > 0 ? "search" : "inbox"}
          title={
            q.statut === "PROPOSEE" && filters.length === 1
              ? "Aucune recommandation en attente de décision"
              : filters.length > 0
                ? "Aucune recommandation ne correspond aux filtres"
                : "Aucune recommandation pour le moment"
          }
          action={
            filters.length > 0 ? (
              <ButtonLink href="/recommendations" variant="secondary">
                Afficher toutes les recommandations
              </ButtonLink>
            ) : undefined
          }
        >
          {q.statut === "PROPOSEE" && filters.length === 1
            ? "Toutes les recommandations ont été décidées. Les suivantes seront créées au prochain calcul mensuel des risques."
            : filters.length > 0
              ? "Aucune recommandation pour cette combinaison de filtres : retirez un filtre pour élargir la sélection."
              : "Les recommandations sont créées à chaque calcul mensuel des risques."}
        </EmptyState>
      ) : (
        <section className={`${cardCls} overflow-hidden`} aria-labelledby="liste-titre">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
            <h2 id="liste-titre" className="text-base font-semibold text-heading">
              <span className="text-lg tabular-nums">{fmt.int(l.total)}</span> recommandation{l.total > 1 ? "s" : ""}
            </h2>
            <p className="text-xs text-fg-muted">En attente de décision d&apos;abord ; sur chaque page, priorité haute (risque Élevé) puis moyenne</p>
          </div>
          {!q.action && (q.statut ?? "PROPOSEE") === "PROPOSEE" && l.actions.includes("ENTRETIEN") && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-primary-soft px-4 py-2.5 text-sm text-fg sm:px-5">
              <span>Pour commencer par les plus urgentes : les entretiens de rétention concernent les collaborateurs classés au niveau Élevé.</span>
              <ButtonLink href={buildHref("/recommendations", { statut: "PROPOSEE", action: "ENTRETIEN", departement: q.departement })} variant="secondary" size="sm" iconEnd="arrow-right">
                Voir les entretiens en attente
              </ButtonLink>
            </div>
          )}
          <ol className="divide-y divide-line">
            {rows.map((r) => {
              const p = priorityOf(r);
              return (
                <li
                  key={r.id}
                  data-reco={r.id}
                  className={`border-l-4 px-4 py-4 transition-colors duration-200 hover:bg-surface-2 focus-within:bg-surface-2 sm:px-5 ${r.status === "PROPOSEE" ? p.bar : "border-l-transparent"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === "PROPOSEE" && <Badge tone={p.tone}>{p.label}</Badge>}
                    <StatusBadge status={r.superseded ? "REMPLACEE" : r.status} />
                    <span className="text-xs text-fg-muted">
                      Émise le <span className="tabular-nums">{formatDate(r.createdAt.slice(0, 10))}</span>
                    </span>
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]">
                    <div className="min-w-0">
                      <Label>Pour qui</Label>
                      <div className="mt-1 flex items-start gap-2.5">
                        <Initials name={r.employee.name} />
                        <div className="min-w-0 leading-tight">
                          <Link href={buildHref(`/employees/${r.employee.id}`, { retour: here })} className="font-medium text-link underline-offset-2 hover:underline">
                            {r.employee.name}
                          </Link>
                          <span className="mt-0.5 block text-xs text-fg-muted">
                            <span className="font-mono">{r.employee.matricule}</span> · {r.department ?? "Département non renseigné"}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
                            Niveau de risque actuel : <RiskBadge level={r.level} />
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <Label>Pourquoi</Label>
                      <p className="mt-1 text-sm text-fg">{recoWhy(r.triggerGroup, r.triggerLabel)}</p>
                    </div>
                    <div className="min-w-0">
                      <Label>Que faire</Label>
                      <p className="mt-1 text-sm font-semibold text-heading">{actionLabel(r.actionCode)}</p>
                      {RECO_WHAT[r.actionCode] && <p className="text-sm text-fg-muted">{RECO_WHAT[r.actionCode]}</p>}
                    </div>
                  </div>
                  {r.status !== "PROPOSEE" && (
                    <p className="mt-3 text-xs text-fg-muted">
                      {r.status === "REALISEE" ? "Réalisée" : r.superseded ? "Remplacée par un nouveau calcul" : "Rejetée"}
                      {r.updatedAt ? ` le ${formatDate(r.updatedAt.slice(0, 10))}` : ""}
                      {r.superseded && ", sans décision de la RH"}
                      {r.interventionDate && <> · Intervention le {formatDate(r.interventionDate)}</>}
                      {r.comment && !r.superseded && (
                        <>
                          {" "}
                          · {r.status === "REJETEE" ? "Motif" : "Commentaire"} : <span className="italic">{r.comment}</span>
                        </>
                      )}
                      {r.feedback && (
                        <>
                          {" "}
                          · Avis : <span className={`font-medium ${r.feedback === "PERTINENTE" ? "text-success" : "text-fg"}`}>{FEEDBACK_LABELS[r.feedback]}</span>
                        </>
                      )}
                    </p>
                  )}
                  <div className="mt-3">
                    {/* Toujours rendu : le message de confirmation survit au changement de statut de la ligne */}
                    <RecoDecision recommendationId={r.id} open={r.status === "PROPOSEE"} today={today} who={r.employee.name} what={actionLabel(r.actionCode)} action={decideRecommendationAction} />
                  </div>
                </li>
              );
            })}
          </ol>
          {l.pageCount > 1 && (
            <div className="border-t border-line bg-surface-2 px-4 py-2.5 sm:px-5">
              <Pagination path="/recommendations" params={{ statut: q.statut, action: q.action, departement: q.departement }} page={l.page} pageCount={l.pageCount} total={l.total} pageSize={l.pageSize} embedded />
            </div>
          )}
        </section>
      )}
    </>
  );
}

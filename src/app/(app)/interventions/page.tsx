import Link from "next/link";
import { headers } from "next/headers";
import { Badge, ButtonLink, EmptyState, KpiTile, PageHeader, RiskBadge, StatusBadge, cardCls, fmt, tableCls } from "@/components/ui";
import { ChartCard, VisualCard } from "@/components/charts/pbi";
import { shareChart } from "@/components/charts/builders";
import { InfoTip } from "@/components/help";
import { ActiveFilters, FilterForm, Pagination, buildHref } from "@/components/pilotage/filters";
import { actionLabel, formatDate, formatRate } from "@/components/pilotage/labels";
import { CAUSALITY_NOTICE } from "@/components/insights/intervention-effects";
import { LEVEL_CHANGE_LABELS, formatHours, formatPoints, formatSignedHours } from "@/components/insights/labels";
import { clientIp } from "@/lib/auth/session";
import { pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { getInterventions, interventionsQuerySchema, type ActionStats, type EffectMeasure, type LevelChange } from "@/lib/dal/interventions";
import { getMatchedComparison } from "@/lib/dal/intervention-impact";
import { MatchedComparison } from "./matched-comparison";

export const metadata = { title: "Interventions — People Analytics AJIR" };

const th = `${tableCls.th} whitespace-nowrap`;
const thR = `${th} text-right`;
const td = `${tableCls.td} tabular-nums`;
const tdR = `${td} text-right`;
const CHANGE_STYLE: Record<LevelChange, string> = { BAISSE: "text-success", HAUSSE: "text-danger", STABLE: "text-fg-muted" };
const sub = "block text-xs font-normal text-fg-subtle";
const CHANGE_ARROW: Record<LevelChange, string> = { BAISSE: "▼", HAUSSE: "▲", STABLE: "■" };

const plural = (n: number, one: string, many = `${one}s`) => `${fmt.int(n)} ${n > 1 ? many : one}`;
const verdict = (d: number) => (d < 0 ? "favorable" : d > 0 ? "à surveiller" : "stable");

// Une baisse d'absentéisme ou d'heures supplémentaires est favorable : le sens est écrit, pas seulement coloré
function DeltaText({ value, text }: { value: number | null; text: string }) {
  if (value == null) return <span className="text-fg-subtle">—</span>;
  const tone = value < 0 ? "text-success" : value > 0 ? "text-danger" : "text-fg-muted";
  return (
    <span className={tone}>
      {text}
      <span className={sub}>{value < 0 ? "en baisse, favorable" : value > 0 ? "en hausse, à surveiller" : "stable"}</span>
    </span>
  );
}

// Écart d'une ligne (après − avant) : même lecture que DeltaText, en une ligne courte
function DeltaHint({ value, text, inline = false }: { value: number | null; text: string; inline?: boolean }) {
  if (value == null) return null;
  const tone = value < 0 ? "text-success" : value > 0 ? "text-danger" : "text-fg-muted";
  return <span className={`${inline ? "" : "block "}text-xs ${tone}`}>{`${inline ? "(" : ""}${text}, ${value < 0 ? "en baisse" : value > 0 ? "en hausse" : "stable"}${inline ? ")" : ""}`}</span>;
}

const deltas = (m: EffectMeasure | null) => ({
  abs: m && m.absenteeismBefore != null && m.absenteeismAfter != null ? m.absenteeismAfter - m.absenteeismBefore : null,
  ot: m && m.overtimeBefore != null && m.overtimeAfter != null ? m.overtimeAfter - m.overtimeBefore : null,
});

function LevelWords({ s }: { s: ActionStats }) {
  if (!s.measured) return <span className="text-xs text-fg-subtle">Aucune mesure complète</span>;
  return (
    <span className="text-xs leading-5">
      <span className="text-success">{fmt.int(s.levelDown)} en baisse</span> · <span className="text-fg-muted">{fmt.int(s.levelSame)} inchangé{s.levelSame > 1 ? "s" : ""}</span> ·{" "}
      <span className="text-danger">{fmt.int(s.levelUp)} en hausse</span>
    </span>
  );
}

function EffectRow({ s, name, total = false }: { s: ActionStats; name: string; total?: boolean }) {
  return (
    <tr className={`${tableCls.tr} ${total ? "border-t-2 border-line bg-surface-2 font-semibold" : ""}`}>
      <th scope="row" className={`${tableCls.td} ${total ? "" : "font-medium"}`}>
        {name}
      </th>
      <td className={tdR}>
        {formatRate(s.completionRate, 0)}
        <span className={sub}>
          {fmt.int(s.done)} sur {fmt.int(s.total)}
        </span>
      </td>
      <td className={tdR}>
        {fmt.int(s.measured)}
        <span className={sub}>sur {plural(s.actions, "action")}</span>
      </td>
      <td className={tableCls.td}>
        <LevelWords s={s} />
      </td>
      <td className={tdR}>
        <DeltaText value={s.absenteeismDelta} text={formatPoints(s.absenteeismDelta)} />
      </td>
      <td className={tdR}>
        <DeltaText value={s.overtimeDelta} text={formatSignedHours(s.overtimeDelta)} />
      </td>
    </tr>
  );
}

export default async function InterventionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(["RH"]);
  const { data: q, ignored } = parseQuery(interventionsQuerySchema, await searchParams, "lenient");
  const d = getInterventions(ctx, q, { source: "page", ip: clientIp(await headers()) });
  const t = d.totals;
  const w = d.windowMonths;
  const matching = t.actions > 0 ? getMatchedComparison(ctx) : null;
  const measuredActions = d.byAction.filter((a) => a.measured > 0);
  const pendingHref = buildHref("/recommendations", { statut: "PROPOSEE" });
  // Fiche ouverte depuis la liste : fil d'Ariane « Interventions » qui ramène au même type d'action et à la même page
  const fiche = (id: number) => buildHref(`/employees/${id}`, { retour: buildHref("/interventions", { action: q.action, page: d.page > 1 ? d.page : undefined }) });

  return (
    <>
      <PageHeader
        eyebrow="Collaborateurs"
        title="Interventions"
        badge={
          <span className="inline-flex items-center gap-1">
            <StatusBadge tone="neutral" dot={false}>
              Observation non causale
            </StatusBadge>
            <InfoTip label="Observation non causale">
              {CAUSALITY_NOTICE}
              {matching && " La comparaison avec des collaborateurs similaires en tient compte en partie, sans prouver d'effet."}
            </InfoTip>
          </span>
        }
        scope="Toute l'entreprise"
        period={`Données au ${formatDate(d.referenceDate)} · ${w} mois avant / après`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
        <KpiTile label="Actions réalisées" value={fmt.int(t.actions)} hint={`Mesures complètes : ${fmt.int(t.measured)}`} />
        <KpiTile
          label="Taux de réalisation des recommandations"
          value={formatRate(t.completionRate, 0)}
          hint={`${fmt.int(t.done)} / ${fmt.int(t.total)} émises · En attente : ${fmt.int(t.proposed)}`}
        />
        <KpiTile
          label="Niveau de risque en baisse après l'action"
          value={t.measured ? formatRate(t.levelDown / t.measured, 0) : "—"}
          hint={t.measured ? `${fmt.int(t.levelDown)} / ${plural(t.measured, "mesuré")}` : "Aucune mesure complète"}
        />
        <KpiTile
          label="Absentéisme : écart après l'action"
          value={formatPoints(t.absenteeismDelta)}
          hint={t.absenteeismDelta == null ? "Aucune mesure complète" : `Après − avant · ${verdict(t.absenteeismDelta)}`}
        />
        <KpiTile
          label="Heures sup. : écart après l'action"
          value={formatSignedHours(t.overtimeDelta)}
          hint={t.overtimeDelta == null ? "Aucune mesure complète" : `Par personne et par mois · ${verdict(t.overtimeDelta)}`}
        />
      </div>

      {d.byAction.length === 0 ? (
        <EmptyState
          title="Aucune recommandation ni intervention enregistrée"
          action={
            <ButtonLink href="/recommendations" variant="secondary" iconEnd="arrow-right">
              Voir les recommandations
            </ButtonLink>
          }
        />
      ) : (
        <>
          {t.actions === 0 && (
            <section className={`${cardCls} mb-6 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-primary p-4 sm:p-5`} aria-labelledby="aucune-action">
              <div className="min-w-0">
                <h2 id="aucune-action" className="text-base font-semibold text-heading">
                  Aucune action réalisée
                </h2>
                <p className="mt-0.5 text-sm text-fg-muted">Recommandations en attente : {fmt.int(t.proposed)}</p>
              </div>
              {t.proposed > 0 && (
                <ButtonLink href={pendingHref} variant="primary" iconEnd="arrow-right">
                  Traiter les recommandations en attente
                </ButtonLink>
              )}
            </section>
          )}

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Statut des recommandations par action (%)"
              actions={
                <InfoTip label="Statut des recommandations" align="end">
                  Réalisée : l&apos;action a eu lieu. En attente : aucune décision prise. Rejetée : jugée non adaptée, avec un motif. Remplacée : retirée par un
                  nouveau calcul, sans décision ; comptée à part, hors des pourcentages{t.superseded ? ` (${fmt.int(t.superseded)})` : ""}.
                </InfoTip>
              }
              chart={shareChart({
                rows: d.byAction.map((a) => ({ name: actionLabel(a.actionCode), values: [a.done, a.proposed, a.rejected] })),
                parts: [
                  { label: "Réalisées", tone: "favorable" },
                  { label: "En attente de décision", tone: "neutre" },
                  { label: "Rejetées", tone: "reference" },
                ],
                measure: "Statut des recommandations",
                unit: "recommandations",
                categoryName: "Type d'action",
              })}
            />
            {measuredActions.length === 0 ? (
              <VisualCard title="Niveau de risque après l'action (%)">
                <EmptyState title="Aucune mesure complète" compact />
              </VisualCard>
            ) : (
              <ChartCard
                title="Niveau de risque après l'action (%)"
                subtitle={`Mesures complètes, ${w} mois de recul`}
                chart={shareChart({
                  rows: measuredActions.map((a) => ({ name: actionLabel(a.actionCode), values: [a.levelDown, a.levelSame, a.levelUp] })),
                  parts: [
                    { label: LEVEL_CHANGE_LABELS.BAISSE, tone: "favorable" },
                    { label: LEVEL_CHANGE_LABELS.STABLE, tone: "reference" },
                    { label: LEVEL_CHANGE_LABELS.HAUSSE, tone: "defavorable" },
                  ],
                  measure: "Évolution du niveau de risque après l'action",
                  categoryName: "Type d'action",
                })}
              />
            )}
          </div>

          {t.actions > 0 && (
            <section className={`${cardCls} mb-6 overflow-hidden`} aria-labelledby="par-action-titre">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                <h2 id="par-action-titre" className="flex items-center gap-1 text-base font-semibold text-heading">
                  Avant / après par type d&apos;action
                  <InfoTip label="Méthode avant / après">
                    Écarts moyens « après − avant » sur les mesures complètes. Niveau avant : dernier calcul publié antérieur à l&apos;action ; niveau après : calcul
                    publié {w} mois après le mois de l&apos;action. Absentéisme hors maladie, maternité et congés annuels ; heures supplémentaires pointées. Les
                    collaborateurs opposés au traitement prédictif ne sont pas mesurés.
                  </InfoTip>
                </h2>
              </div>
              <div className={tableCls.wrap} tabIndex={0} role="region" aria-labelledby="par-action-titre">
                <table className={tableCls.table}>
                  <caption className="sr-only">Réalisation et mesure avant / après par type d&apos;action</caption>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th scope="col" className={th}>Action</th>
                      <th scope="col" className={thR}>Réalisation</th>
                      <th scope="col" className={thR}>Mesures complètes</th>
                      <th scope="col" className={th}>Niveau de risque après l&apos;action</th>
                      <th scope="col" className={thR}>Absentéisme (écart)</th>
                      <th scope="col" className={thR}>Heures sup. par mois (écart)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byAction.map((a) => (
                      <EffectRow key={a.actionCode} s={a} name={actionLabel(a.actionCode)} />
                    ))}
                    <EffectRow s={t} name="Toutes les actions" total />
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {matching && <MatchedComparison data={matching} />}

          {t.actions > 0 && (
            <>
              <FilterForm
                action="/interventions"
                values={{ action: q.action }}
                showReset={!!q.action}
                fields={[{ name: "action", label: "Afficher les actions de type", allLabel: "Tous les types", options: d.actions.map((a) => ({ value: a, label: actionLabel(a) })) }]}
              />
              <ActiveFilters filters={q.action ? [{ label: "Action", value: actionLabel(q.action), removeHref: "/interventions" }] : []} ignored={ignored} />
            </>
          )}

          {t.actions > 0 &&
            (d.rows.length === 0 ? (
              <EmptyState
                icon="search"
                title="Aucune action réalisée de ce type"
                action={
                  <ButtonLink href="/interventions" variant="secondary">
                    Afficher tous les types d&apos;action
                  </ButtonLink>
                }
              />
            ) : (
              <section className={`${cardCls} overflow-hidden`} aria-labelledby="actions-titre">
                <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                  <h2 id="actions-titre" className="text-base font-semibold text-heading">
                    Actions réalisées <span className="font-normal tabular-nums text-fg-muted">({fmt.int(d.total)})</span>
                  </h2>
                  <Badge>Consultation tracée</Badge>
                </div>
                {/* Mobile : une carte par action (mêmes informations que le tableau) */}
                <ul className="divide-y divide-line sm:hidden" aria-labelledby="actions-titre">
                  {d.rows.map((r) => {
                    const m = r.measure;
                    const dl = deltas(m);
                    return (
                      <li key={r.key} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link href={fiche(r.employee.id)} className="font-medium text-link underline-offset-2 hover:underline">
                              {r.employee.name}
                            </Link>
                            <span className="block text-xs text-fg-subtle">{r.department ?? "—"}</span>
                          </div>
                          <span className="shrink-0 text-right text-xs tabular-nums text-fg-muted">
                            {formatDate(r.date)}
                            {r.source === "RECOMMANDATION" && <span className="block text-fg-subtle">date de décision</span>}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-fg">{actionLabel(r.actionCode)}</p>
                        {m ? (
                          <>
                            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
                              Risque : <RiskBadge level={m.levelBefore} compact /> <span aria-hidden="true">→</span>
                              <span className="sr-only">puis</span> <RiskBadge level={m.levelAfter} compact />
                              {m.levelChange && <span className={`font-medium ${CHANGE_STYLE[m.levelChange]}`}>{LEVEL_CHANGE_LABELS[m.levelChange]}</span>}
                            </p>
                            <p className="mt-1 text-xs tabular-nums text-fg-muted">
                              Absentéisme : {formatRate(m.absenteeismBefore)} → {formatRate(m.absenteeismAfter)}{" "}
                              <DeltaHint value={dl.abs} text={formatPoints(dl.abs)} inline />
                            </p>
                            <p className="text-xs tabular-nums text-fg-muted">
                              Heures sup. par mois : {formatHours(m.overtimeBefore)} → {formatHours(m.overtimeAfter)}{" "}
                              <DeltaHint value={dl.ot} text={formatSignedHours(dl.ot)} inline />
                            </p>
                            <p className="text-xs">
                              {m.complete ? <span className="text-success">Recul complet ({w} mois)</span> : <span className="text-warning">{`Recul partiel : ${m.monthsAfter} mois sur ${w}`}</span>}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-fg-subtle">Non mesuré (opposition)</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="relative hidden max-h-[70vh] overflow-auto sm:block" tabIndex={0} role="region" aria-labelledby="actions-titre">
                  <table className={tableCls.table}>
                    <caption className="sr-only">Actions réalisées et mesure avant / après</caption>
                    <thead className={`${tableCls.thead} sticky top-0 z-10`}>
                      <tr>
                        <th scope="col" className={th}>Date</th>
                        <th scope="col" className={th}>Collaborateur</th>
                        <th scope="col" className={th}>Action</th>
                        <th scope="col" className={th}>Niveau de risque avant → après</th>
                        <th scope="col" className={thR}>Absentéisme avant → après</th>
                        <th scope="col" className={thR}>Heures sup. par mois avant → après</th>
                        <th scope="col" className={th}>Recul</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => {
                        const m = r.measure;
                        const dl = deltas(m);
                        return (
                          <tr key={r.key} className={`${tableCls.tr} align-top`}>
                            <td className={`${td} whitespace-nowrap`}>
                              {formatDate(r.date)}
                              {r.source === "RECOMMANDATION" && <span className="block text-xs text-fg-subtle">date de décision</span>}
                            </td>
                            <th scope="row" className={`${tableCls.td} font-normal`}>
                              <Link href={fiche(r.employee.id)} className="font-medium text-link underline-offset-2 hover:underline">
                                {r.employee.name}
                              </Link>
                              <span className="block text-xs text-fg-subtle">{r.department ?? "—"}</span>
                            </th>
                            <td className={tableCls.td}>{actionLabel(r.actionCode)}</td>
                            <td className={tableCls.td}>
                              {m ? (
                                <>
                                  <span className="inline-flex flex-wrap items-center gap-1">
                                    <RiskBadge level={m.levelBefore} /> <span aria-hidden="true">→</span>
                                    <span className="sr-only">puis</span> <RiskBadge level={m.levelAfter} />
                                  </span>
                                  {m.levelChange && (
                                    <span className={`mt-1 block text-xs font-medium ${CHANGE_STYLE[m.levelChange]}`}>
                                      <span aria-hidden="true">{CHANGE_ARROW[m.levelChange]} </span>
                                      {LEVEL_CHANGE_LABELS[m.levelChange]}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-fg-subtle">Non mesuré (opposition)</span>
                              )}
                            </td>
                            <td className={`${tdR} whitespace-nowrap`}>
                              {m ? `${formatRate(m.absenteeismBefore)} → ${formatRate(m.absenteeismAfter)}` : "—"}
                              <DeltaHint value={dl.abs} text={formatPoints(dl.abs)} />
                            </td>
                            <td className={`${tdR} whitespace-nowrap`}>
                              {m ? `${formatHours(m.overtimeBefore)} → ${formatHours(m.overtimeAfter)}` : "—"}
                              <DeltaHint value={dl.ot} text={formatSignedHours(dl.ot)} />
                            </td>
                            <td className={`${tableCls.td} whitespace-nowrap text-xs`}>
                              {!m ? "—" : m.complete ? <span className="text-success">Complet ({w} mois)</span> : <span className="text-warning">{`${m.monthsAfter} mois sur ${w}`}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {d.pageCount > 1 && (
                  <div className="border-t border-line px-4 py-2">
                    <Pagination path="/interventions" params={{ action: q.action }} page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} embedded />
                  </div>
                )}
              </section>
            ))}
        </>
      )}
    </>
  );
}

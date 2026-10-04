import Link from "next/link";
import {
  ButtonLink,
  cardCls,
  DataTable,
  EmptyState,
  fmt,
  Notice,
  PageHeader,
  QuestionAnswer,
  SectionHeader,
  StatusBadge,
  type DataTableColumn,
} from "@/components/ui";
import { KpiCard, VisualCard } from "@/components/charts/pbi";
import { Breadcrumb, safeReturn } from "@/components/ux/breadcrumb";
import { absenteeismHref, employeesHref, withDrillSpec } from "@/components/charts/drill";
import { ActiveFilters, FilterForm, buildHref } from "@/components/pilotage/filters";
import { formatDate } from "@/components/pilotage/labels";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { absenteeismQuerySchema, getAbsenteeism, type AbsSeries } from "@/lib/dal/absenteeism";
import { getAbsenteeismForecast } from "@/lib/dal/ai-absenteeism";
import { readConformal } from "@/lib/ai/conformal";
import { departmentOptions, parseQuery } from "@/lib/dal/employees";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { TermTip } from "@/components/help";
import { AbsenteeismForecastCard, readForecast } from "@/components/ai/absenteeism/forecast-section";
import { AbsRecoBoard } from "@/components/ai/absenteeism/reco-status-form";
import { groupBars, trendChart } from "@/components/ai/absenteeism/chart";
import { Def, fr, type Answer } from "@/components/ai/workload/insight-kit";

export const metadata = { title: "Absentéisme — People Analytics AJIR" };

const SCOPE_LABEL = { ENTREPRISE: "Entreprise", DEPARTEMENT: "Département", EQUIPE: "Équipe" } as const;
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const days = (n: number | null) => (n == null ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));
const SIGNAL_COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Collaborateur" },
  { key: "dept", label: "Département" },
  { key: "period", label: "Période" },
  { key: "message", label: "Signal à vérifier", cardBlock: true, className: "min-w-72 text-fg-muted" },
];
const linkCls = "font-medium text-link underline underline-offset-2 transition-[text-decoration-thickness] hover:decoration-2";

export default async function AbsenteeismPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const raw = await searchParams;
  const { data: q, ignored } = parseQuery(absenteeismQuerySchema, raw, "lenient");
  const retour = safeReturn(raw.retour, ["/dashboard"]);
  const a = getAbsenteeism(ctx, q);
  const f = getAbsenteeismForecast(ctx);
  const rh = a.view === "RH";
  const depts = rh ? departmentOptions(ctx) : [];
  const deptLabel = rh && q.departement ? (depts.find((d) => d.id === q.departement)?.label ?? `n° ${q.departement}`) : null;
  const weekly = a.granularity === "semaine";
  const axisWord = a.axis === "equipe" ? "équipe" : "département";
  const labels = a.buckets.map((b) => (weekly ? `sem. ${formatDate(b.from).slice(0, 5)}` : fr.monthShort(b.key)));
  const periodShort = weekly ? `${a.buckets.length} dernières semaines` : `${a.buckets.length} derniers mois`;
  const period = `${periodShort} (du ${formatDate(a.window.from)} au ${formatDate(a.window.to)})`;
  const filters = [
    { label: "Afficher par", value: weekly ? "Semaine" : "Mois" },
    ...(rh ? [{ label: "Comparer par", value: a.axis === "equipe" ? "Équipe" : "Département" }] : []),
    ...(deptLabel ? [{ label: "Département", value: deptLabel }] : []),
  ];
  const scopeLabel = rh ? (deptLabel ?? "Toute l'entreprise") : `Vos équipes (${fmt.int(a.total.activeMembers)} collaborateurs)`;
  const tooSmall = `Taux masqués : moins de ${MIN_GROUP_SIZE} personnes`;
  const ranked = a.series.filter((g): g is AbsSeries & { rate: number } => !g.masked && g.rate != null);
  const hasData = !a.total.masked && (a.total.workableDays ?? 0) > 0;

  // Tendance récente : moyenne des 4 dernières semaines (3 derniers mois) comparée aux périodes précédentes
  const recentN = weekly ? 4 : 3;
  const beforeLabel = weekly ? "vs les semaines précédentes" : "vs les mois précédents";
  const recentLabel = weekly ? "4 dernières semaines" : "3 derniers mois";
  const recent = mean(a.total.rates.slice(-recentN));
  const before = mean(a.total.rates.slice(0, -recentN));
  const delta = recent != null && before != null ? recent - before : null;
  const trend = delta == null || Math.abs(delta) < 0.002 || Math.abs(delta) < 0.2 * (before ?? 0) ? "stable" : delta > 0 ? "hausse" : "baisse";

  const preferKey = rh ? (q.departement ? `D${q.departement}` : "E") : undefined;
  const unit = f.units.find((u) => u.key === preferKey) ?? f.units[0];
  const fc = unit ? readForecast(unit) : null;
  const n = a.collective.length;

  let verdict: Answer;
  if (a.total.masked) verdict = { tone: "neutre", label: "Non affiché", text: null };
  else if (!hasData) verdict = { tone: "neutre", label: "Pas de données", text: null };
  else {
    const up = trend === "hausse";
    const fcUp = fc?.trend === "hausse";
    const tone = up && (n > 0 || fcUp) ? "critique" : up || n > 0 || fcUp ? "attention" : "bon";
    verdict = { tone, label: tone === "bon" ? "Sous contrôle" : tone === "attention" ? "À surveiller" : "Hausse à traiter", text: null };
  }

  const above = ranked.filter((g) => a.total.rate != null && g.rate > a.total.rate).length;
  const averageLabel = rh ? (deptLabel ? "Moyenne du département" : "Moyenne entreprise") : "Moyenne de votre périmètre";
  // Filtrage croisé : département → ses équipes ; équipe → ses collaborateurs. Seuls les groupes affichés (non masqués) sont cliquables.
  const groupKey = new Map(ranked.map((g) => [g.label, Number(g.key)]));
  const drillGroup = (name: string) => {
    const key = groupKey.get(name);
    if (!key) return undefined;
    return a.axis === "departement" ? absenteeismHref({ granularite: q.granularite, axe: "equipe", departement: key, retour }) : employeesHref({ manager: key });
  };
  const drillGroupHint = a.axis === "departement" ? "Cliquer pour voir les équipes du département" : "Cliquer pour voir les collaborateurs de l'équipe";
  const selfHref = buildHref("/absenteeism", { granularite: q.granularite, axe: q.axe, departement: q.departement, retour });
  const recoItems = f.recommendations.map((r) => ({
    id: r.id,
    status: r.status,
    priority: r.priority,
    title: r.title,
    rationale: r.rationale,
    scopeLabel: SCOPE_LABEL[r.scope],
    target: r.scope === "ENTREPRISE" ? null : r.label,
    createdOn: fmt.date(r.createdAt),
    updatedOn: r.updatedAt ? fmt.date(r.updatedAt) : null,
    comment: r.comment,
    allowed: r.allowed,
  }));

  return (
    <>
      {retour && <Breadcrumb items={[{ label: "Tableau de bord", href: retour }, { label: "Absentéisme" }]} />}
      <PageHeader
        title="Absentéisme"
        scope={scopeLabel}
        period={`Données au ${formatDate(a.referenceDate)}`}
        actions={
          <ButtonLink href="/alerts?type=ABSENTEISME" icon="warning">
            Voir les alertes d&apos;absentéisme
          </ButtonLink>
        }
      />
      <FilterForm
        action="/absenteeism"
        values={q}
        hidden={{ retour }}
        fields={[
          {
            name: "granularite",
            label: "Afficher par",
            defaultValue: "semaine",
            options: [
              { value: "semaine", label: "Semaine" },
              { value: "mois", label: "Mois" },
            ],
          },
          ...(rh
            ? [
                {
                  name: "axe",
                  label: "Comparer par",
                  defaultValue: "departement",
                  options: [
                    { value: "departement", label: "Département" },
                    { value: "equipe", label: "Équipe" },
                  ],
                },
                { name: "departement", label: "Département", allLabel: "Tous", options: depts.map((d) => ({ value: String(d.id), label: d.label })) },
              ]
            : []),
        ]}
      />
      <ActiveFilters period={period} filters={filters} ignored={ignored} />

      <QuestionAnswer
        id="reponse-absenteisme"
        question="État de l'absentéisme"
        verdict={verdict}
        scope={`${scopeLabel} · ${periodShort} · hors santé et congés annuels`}
        method={
          <>
            Trois repères : la tendance des {recentLabel} (un écart de moins de 0,2 point ou de moins de 20 % est jugé stable), les hausses inhabituelles
            d&apos;équipe ou de département détectées sur la période, et la prévision des 3 prochains mois comparée aux 12 derniers. « À surveiller » dès
            qu&apos;un repère se dégrade. Taux = jours d&apos;absence injustifiée, de congé sans solde ou d&apos;autre absence, divisés par les jours ouvrables ;
            maladie, maternité et congés annuels exclus. Calendrier tunisien pris en compte (Ramadan, jours fériés, ponts, séance unique). Aucun taux pour un
            groupe de moins de {MIN_GROUP_SIZE} personnes.
          </>
        }
      >
        <KpiCard
          label="Taux d'absence"
          period={periodShort}
          value={a.total.masked ? "—" : fr.rate(a.total.rate)}
          spark={hasData ? a.total.rates : undefined}
          delta={
            hasData && delta != null
              ? { value: trend === "stable" ? 0 : delta, label: `${fr.points(delta)} sur les ${recentLabel}`, reference: beforeLabel, good: "down" }
              : null
          }
          hint={a.total.masked ? tooSmall : `${days(a.total.absenceDays)} jours d'absence · ${fmt.int(a.total.activeMembers)} collaborateurs`}
          tip={<TermTip term="absenteisme" role={ctx.role} align="end" />}
        />
        <KpiCard
          label="Prévision du mois prochain"
          period={fc?.next ? fr.monthLong(fc.next.month) : undefined}
          value={fc?.next ? fr.rate(fc.next.value) : "—"}
          status={
            fc
              ? fc.trend === "hausse"
                ? { tone: "attention", label: "Hausse prévue" }
                : { tone: "bon", label: fc.trend === "baisse" ? "Baisse prévue" : "Stable" }
              : undefined
          }
          hint={
            fc?.next && fc.next.lower != null && fc.next.upper != null
              ? `Fourchette probable à 80 % : ${fr.rate(fc.next.lower)} à ${fr.rate(fc.next.upper)}`
              : f.teamTooSmall
                ? `Masquée : moins de ${MIN_GROUP_SIZE} personnes`
                : "Aucune prévision"
          }
          detailHref={fc ? "#prevision" : undefined}
          detailLabel="Voir la prévision"
          tip={<Def id="fourchette" />}
        />
        <KpiCard
          label="Hausses inhabituelles"
          period="équipes et départements, sur la période"
          value={fmt.int(n)}
          status={n ? { tone: "attention", label: "À examiner" } : { tone: "bon", label: "Aucune" }}
          detailHref={n ? "#anomalies" : undefined}
          detailLabel="Voir la liste"
          tip={<TermTip term="anomalieCollective" role={ctx.role} align="end" />}
        />
        {a.view === "RH" && (
          <KpiCard
            label="Signaux individuels à vérifier"
            period="réservés à la RH, sur la période"
            value={fmt.int(a.individual.length)}
            status={a.individual.length ? { tone: "attention", label: "À vérifier" } : { tone: "bon", label: "Aucun" }}
            detailHref={a.individual.length ? "#signaux" : undefined}
            detailLabel="Voir la liste"
            tip={<TermTip term="bradford" role={ctx.role} align="end" />}
          />
        )}
      </QuestionAnswer>

      {a.total.masked ? (
        <Notice tone="warning">{tooSmall}</Notice>
      ) : !hasData ? (
        <EmptyState
          title="Aucune donnée d'absence sur la période"
          icon="calendar"
          action={
            weekly ? (
              <ButtonLink href={buildHref("/absenteeism", { granularite: "mois", axe: q.axe, departement: q.departement, retour })} variant="primary">
                Afficher par mois (12 mois)
              </ButtonLink>
            ) : rh ? (
              <ButtonLink href="/data-health">Vérifier le dernier import</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-5">
          <VisualCard
            title={`Absentéisme ${weekly ? "hebdomadaire" : "mensuel"} (%)`}
            subtitle={`% des jours ouvrables · ${a.total.label.toLowerCase()} · ${periodShort} · tirets : moyenne de la période`}
            className={ranked.length >= 2 ? "xl:col-span-3" : "xl:col-span-5"}
            chart={trendChart({ labels, rates: a.total.rates, average: a.total.rate, seriesName: a.total.label, weekly })}
          />
          {ranked.length >= 2 && (
            <VisualCard
              title={`Absentéisme par ${axisWord} (%)`}
              subtitle={`${periodShort} · ${scopeLabel} · ambre : au-dessus de la moyenne (${above} sur ${ranked.length})`}
              className="xl:col-span-2"
              chart={withDrillSpec(
                groupBars({
                  rows: ranked.map((g) => ({
                    name: g.label,
                    rate: g.rate,
                    tip: `${fr.rate(g.rate)} · ${days(g.absenceDays)} jours d'absence · ${fmt.int(g.activeMembers)} collaborateurs`,
                  })),
                  average: a.total.rate,
                  averageLabel,
                  categoryName: a.axis === "equipe" ? "Équipe" : "Département",
                }),
                drillGroup,
                drillGroupHint,
              )}
              footnote={
                a.hiddenSeries > 0 || !rh ? (
                  <>
                    {a.hiddenSeries > 0 && `Non affichés (taux plus faibles) : ${a.hiddenSeries} ${axisWord}${a.hiddenSeries > 1 ? "s" : ""}. `}
                    {!rh && `Taux affiché pour un groupe d'au moins ${MIN_GROUP_SIZE} personnes.`}
                  </>
                ) : undefined
              }
            />
          )}
        </div>
      )}

      <div id="prevision" className="mt-4 scroll-mt-4">
        <AbsenteeismForecastCard d={f} preferKey={preferKey} coverage={readConformal("absenteeism", f.modelVersion)?.coverage} />
      </div>

      <SectionHeader id="actions" title="Actions proposées" className="mt-8" />
      <div className={`${cardCls} p-4 sm:p-5`}>
        <AbsRecoBoard items={recoItems} emptyTitle="Aucune action à traiter" />
      </div>

      <SectionHeader title="Détail" className="mt-8" />
      <section id="anomalies" aria-labelledby="anomalies-titre" className="scroll-mt-4">
        <SectionHeader
          id="anomalies-titre"
          level={3}
          title={`Hausses inhabituelles (${fmt.int(n)})`}
          tip={<TermTip term="anomalieCollective" role={ctx.role} align="start" />}
        />
        <div className={`${cardCls} px-4 py-2 sm:px-5`}>
          {n === 0 ? (
            <EmptyState title="Aucune hausse inhabituelle sur la période" icon="success" compact />
          ) : (
            <ul className="divide-y divide-line">
              {a.collective.map((c) => (
                <li key={c.id} className="py-3 text-sm first:pt-1 last:pb-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge tone="warning">{c.scope === "EQUIPE" ? "Équipe" : "Département"}</StatusBadge>
                    <span className="font-semibold text-fg">{c.groupLabel}</span>
                    <span className="text-xs tabular-nums text-fg-subtle">
                      du {formatDate(c.periodStart)} au {formatDate(c.periodEnd)}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed text-fg-muted">{c.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {a.view === "RH" && (
        <section id="signaux" aria-labelledby="signaux-titre" className="mt-8 scroll-mt-4">
          <SectionHeader
            id="signaux-titre"
            level={3}
            title={`Signaux individuels à vérifier (${fmt.int(a.individual.length)})`}
            tip={<TermTip term="bradford" role={ctx.role} align="start" />}
            actions={
              <>
                <StatusBadge>Réservé RH</StatusBadge>
                <StatusBadge tone="warning">À vérifier, pas un constat</StatusBadge>
              </>
            }
          />
          <DataTable
            className="mt-3"
            columns={SIGNAL_COLUMNS}
            pageSize={10}
            rows={a.individual.map((s) => {
              const href = buildHref(`/employees/${s.employeeId}`, { retour: `${selfHref}#signaux` });
              return {
                id: s.id,
                rowHref: href,
                cells: {
                  name: (
                    <>
                      <Link href={href} className={linkCls}>
                        {s.employeeName}
                      </Link>
                      <span className="block text-xs text-fg-subtle">{s.matricule}</span>
                    </>
                  ),
                  dept: s.department ?? "—",
                  period: (
                    <span className="whitespace-nowrap tabular-nums">
                      {formatDate(s.periodStart)}
                      <span className="block text-xs text-fg-subtle">au {formatDate(s.periodEnd)}</span>
                    </span>
                  ),
                  message: s.message,
                },
                sort: { name: s.employeeName, dept: s.department, period: s.periodStart },
              };
            })}
            caption="Signaux individuels d'absentéisme à vérifier, réservés à la RH"
            empty={<EmptyState title="Aucun signal individuel sur la période" icon="success" compact className="mt-3" />}
          />
        </section>
      )}
    </>
  );
}

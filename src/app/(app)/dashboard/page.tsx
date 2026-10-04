import Link from "next/link";
import { Badge, ButtonLink, DataTable, EmptyState, PageHeader, SectionHeader, StatusBadge, fmt } from "@/components/ui";
import { EChart } from "@/components/charts/echart";
import { ChartData, KpiCard, VisualCard, barChart, lineChart } from "@/components/charts/pbi";
import { ActiveFilters, FilterForm, buildHref } from "@/components/pilotage/filters";
import { RISK_LEVELS, frRate, riskByDepartmentOption, shortDepartment } from "@/components/pilotage/chart-options";
import { CONTRACT_LABELS, LEVEL_LABELS, formatDate, formatMonth, formatRate } from "@/components/pilotage/labels";
import { PILOTAGE_ROLES, isGlobal, pageContext } from "@/lib/dal/context";
import { PERIODS, dashboardQuerySchema, getDashboard, restrictDashboardQuery } from "@/lib/dal/dashboard";
import { AGE_BANDS, CONTRACT_TYPES, TENURE_BANDS, departmentOptions, parseQuery } from "@/lib/dal/employees";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { countAlerts } from "@/lib/dal/alerts";
import { listRecommendations } from "@/lib/dal/recommendations";
import { ShortcutBar, type Shortcut } from "@/components/ux/shortcuts";
import { levelFromLabel, withDrill, withDrillSpec } from "@/components/charts/drill";
import { TermTip } from "@/components/help";
import { countDelta, rateDelta, signed } from "./messages";

// Liens de texte : jetons du thème, survol (soulignement épais), focus visible global, léger enfoncement au clic
const linkCls =
  "inline-flex min-h-8 items-center whitespace-nowrap rounded-sm font-medium text-link underline underline-offset-2 transition-colors duration-200 hover:text-fg hover:decoration-2 active:translate-y-px";
const cellLinkCls = "rounded-sm text-link underline underline-offset-2 transition-colors duration-200 hover:text-fg hover:decoration-2";

export const metadata = { title: "Tableau de bord — People Analytics AJIR" };

const plural = (n: number, one: string, many: string) => `${fmt.int(n)} ${n > 1 ? many : one}`;
// Taux (fraction) → pourcentage arrondi pour les graphiques
const toPct = (r: number | null, digits = 1) => (r == null ? null : Math.round(r * 100 * 10 ** digits) / 10 ** digits);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const { data, ignored } = parseQuery(dashboardQuerySchema, await searchParams, "lenient");
  const d = getDashboard(ctx, data, ignored);
  const { query: q, dropped } = restrictDashboardQuery(ctx, data);
  const rh = d.view === "RH";
  const population = { departement: q.departement, contrat: q.contrat, age: q.age, anciennete: q.anciennete };
  const defaultPeriod = dashboardQuerySchema.parse({}).periode;
  // Retour contextuel : les pages ouvertes depuis le tableau de bord y reviennent avec les mêmes filtres
  const current = { periode: q.periode === defaultPeriod ? undefined : q.periode, ...population, niveau: q.niveau };
  const here = buildHref("/dashboard", current);
  const toList = (extra: Record<string, string | number | undefined> = {}) =>
    buildHref("/employees", { ...population, niveau: q.niveau, ...extra, retour: here });
  const toAbsenteeism = (extra: Record<string, string | undefined> = {}) =>
    buildHref("/absenteeism", { departement: rh ? q.departement : undefined, granularite: "mois", ...extra, retour: here });

  const fromMonth = formatMonth(d.period.from);
  const toMonth = formatMonth(d.period.to);
  const periodRange = `${fromMonth} – ${toMonth}`;
  const periodLabel = `${periodRange} (${d.period.label})`;
  const k = d.kpis;
  const s = d.series;
  const months = s.map((x) => formatMonth(x.month));
  const first = s[0];
  const last = s[s.length - 1];
  const maskedReason = d.smallPopulation ? `Masqué : moins de ${MIN_GROUP_SIZE} personnes` : "Historique insuffisant";
  const risk = d.risk;
  const evaluated = risk ? risk.totals.ELEVE + risk.totals.MOYEN + risk.totals.FAIBLE : 0;
  const riskTotal = risk ? evaluated + risk.totals.nonScored : 0;
  // Départements les plus exposés en tête (graphique et tableau) : où agir d'abord
  const riskByDept = risk ? [...risk.byDepartment].sort((a, b) => b.ELEVE - a.ELEVE || b.MOYEN - a.MOYEN || a.name.localeCompare(b.name, "fr")) : [];
  const smallTeam = !rh && k.headcount > 0 && k.headcount < 20;
  const showDeptChart = !!risk && riskByDept.length > 1;
  // Puces retirables : la période (si elle diffère du défaut) puis les filtres de population et de niveau
  const chips = [
    ...(q.periode !== defaultPeriod
      ? [{ label: "Période", value: PERIODS[q.periode].label, removeHref: buildHref("/dashboard", { ...current, periode: undefined }) }]
      : []),
    ...d.filters.map((f) => ({ ...f, removeHref: buildHref("/dashboard", { ...current, [f.key]: undefined }) })),
  ];

  const noRun = (
    <EmptyState
      title="Aucun calcul de risque publié"
      action={
        rh ? (
          <ButtonLink href="/data-health" variant="secondary" size="sm">
            Voir l&apos;état du calcul
          </ButtonLink>
        ) : undefined
      }
    />
  );
  const noMatch = (
    <EmptyState
      title="Aucun collaborateur ne correspond aux filtres"
      action={
        <ButtonLink href="/dashboard" variant="secondary" size="sm">
          Réinitialiser les filtres
        </ButtonLink>
      }
    />
  );

  const newAlerts = countAlerts(ctx, { status: "NOUVELLE" });
  const critical = newAlerts ? countAlerts(ctx, { status: "NOUVELLE", severity: "CRITIQUE" }) : 0;
  const todo: Shortcut[] = [
    {
      href: "/alerts?status=NOUVELLE",
      count: newAlerts,
      singular: "nouvelle alerte",
      plural: "nouvelles alertes",
      detail: critical ? `dont ${fmt.int(critical)} critique${critical > 1 ? "s" : ""}` : undefined,
      urgent: critical > 0,
      none: "Aucune nouvelle alerte",
    },
  ];
  if (isGlobal(ctx)) {
    const proposed = listRecommendations(ctx, { statut: "PROPOSEE", departement: q.departement, page: 1 }).total;
    todo.push({
      href: buildHref("/recommendations", { statut: "PROPOSEE", departement: q.departement }),
      count: proposed,
      singular: "recommandation à décider",
      plural: "recommandations à décider",
      none: "Aucune recommandation à décider",
    });
  }

  // ---------- Visuels : helpers de la charte (formats français, tableau « Voir les données ») ----------
  const riskLevels =
    risk && riskTotal > 0
      ? barChart({
          rows: RISK_LEVELS.map((l) => ({
            name: l.label,
            value: risk.totals[l.key],
            tone: l.tone,
            tip:
              l.key === "nonScored" || !evaluated
                ? plural(risk.totals[l.key], "collaborateur", "collaborateurs")
                : `${plural(risk.totals[l.key], "collaborateur", "collaborateurs")} (${frRate(risk.totals[l.key] / evaluated)} des évalués)`,
          })),
          sort: "none",
          measure: "Effectif",
          unit: "collaborateurs",
          categoryName: "Niveau de risque",
          height: 200,
        })
      : null;
  const headcountLine = s.every((x) => x.headcount === 0)
    ? null
    : lineChart({
        categories: months,
        series: [{ name: "Effectif fin de mois", values: s.map((x) => x.headcount) }],
        measure: "Effectif",
        unit: "collaborateurs",
        // petite équipe : axe depuis 0 (une variation d'une personne n'occupe pas toute la hauteur)
        zeroBased: Math.max(...s.map((x) => x.headcount)) < 50,
        categoryName: "Mois",
        height: 300,
      });
  // effectif : graduations entières uniquement (jamais « 6,8 collaborateurs »)
  const headcountChart = headcountLine && {
    ...headcountLine,
    option: { ...headcountLine.option, yAxis: { ...(headcountLine.option.yAxis as object), minInterval: 1 } },
  };
  const turnoverChart = s.every((x) => x.turnover12 == null)
    ? null
    : lineChart({
        categories: months,
        series: [
          { name: "Total", values: s.map((x) => toPct(x.turnover12)) },
          { name: "Départs volontaires", values: s.map((x) => toPct(x.turnover12Voluntary)), dashed: true },
        ],
        measure: "Turnover 12 mois",
        unit: "%",
        categoryName: "Mois",
        height: 300,
      });
  const absenteeismChart = s.every((x) => x.absenteeismRate == null)
    ? null
    : lineChart({
        categories: months,
        series: [{ name: "Taux d'absence", values: s.map((x) => toPct(x.absenteeismRate, 2)) }],
        measure: "Taux d'absence",
        unit: "%",
        digits: 2,
        references: k.absenteeismRate == null ? undefined : [{ value: toPct(k.absenteeismRate, 2)!, label: "Moyenne" }],
        categoryName: "Mois",
        height: 300,
      });
  const deptHeadcountChart =
    d.view === "RH" && d.departments.some((x) => x.headcount > 0)
      ? barChart({
          rows: d.departments.filter((x) => x.headcount > 0).map((x) => ({ name: shortDepartment(x.name), value: x.headcount })),
          measure: "Effectif",
          unit: "collaborateurs",
          categoryName: "Département",
        })
      : null;
  const deptAbsenteeismChart =
    d.view === "RH" && d.departments.some((x) => x.absenteeismRate != null)
      ? barChart({
          // la moyenne est une barre grise (référence) parmi les départements ; au-dessus : ambre (à surveiller), en dessous : bleu
          rows: [
            ...d.departments
              .filter((x) => x.absenteeismRate != null)
              .map((x) => ({
                name: shortDepartment(x.name),
                value: toPct(x.absenteeismRate, 2),
                tone: k.absenteeismRate != null && toPct(x.absenteeismRate, 2)! > toPct(k.absenteeismRate, 2)! ? ("attention" as const) : undefined,
              })),
            ...(k.absenteeismRate == null ? [] : [{ name: "Moyenne", value: toPct(k.absenteeismRate, 2), tone: "reference" as const }]),
          ],
          measure: "Taux d'absence",
          unit: "%",
          digits: 2,
          categoryName: "Département",
        })
      : null;

  // Nombre de collaborateurs d'un département à un niveau : lien vers la liste filtrée
  const riskCell = (r: (typeof riskByDept)[number], n: number, niveau: keyof typeof LEVEL_LABELS) =>
    n > 0 ? (
      <Link className={cellLinkCls} href={buildHref("/employees", { ...population, departement: r.departmentId ?? undefined, niveau, retour: here })}>
        {fmt.int(n)}
        <span className="sr-only">
          {" "}
          {n > 1 ? "collaborateurs" : "collaborateur"}{" "}
          {niveau === "NON_EVALUE" ? (n > 1 ? "non évalués" : "non évalué") : `en risque ${LEVEL_LABELS[niveau].toLowerCase()}`} — {r.name} : voir la liste
        </span>
      </Link>
    ) : (
      <span className="text-fg-subtle">0</span>
    );
  const deptLink = (r: (typeof riskByDept)[number]) => buildHref("/employees", { ...population, departement: r.departmentId ?? undefined, retour: here });
  const liftText = (lift: number | null) => (lift == null ? "—" : `${lift.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ×`);

  // Filtrage croisé : un clic sur une barre ouvre la liste ou l'analyse filtrée ; équivalent clavier : tableau « Voir les données »
  const deptIdOf = (short: string) => (d.view === "RH" ? d.departments : []).find((x) => shortDepartment(x.name) === short)?.departmentId ?? undefined;
  const toLevelList = (name: string) => {
    const l = RISK_LEVELS.find((x) => x.label === name);
    return l && risk && risk.totals[l.key] > 0 ? toList({ niveau: levelFromLabel(name) }) : undefined;
  };
  const toDeptLevelList = (name: string, series?: string) => {
    const r = riskByDept.find((x) => shortDepartment(x.name) === name);
    const niveau = levelFromLabel(series);
    return r?.departmentId && (niveau === "ELEVE" || niveau === "MOYEN") && r[niveau] > 0 ? toList({ departement: r.departmentId, niveau }) : undefined;
  };
  const toDeptList = (name: string) => {
    const id = deptIdOf(name);
    return id ? toList({ departement: id, niveau: undefined }) : undefined;
  };
  const toDeptAbsenteeism = (name: string) => {
    const id = deptIdOf(name);
    return id ? toAbsenteeism({ departement: String(id), axe: "equipe" }) : undefined;
  };

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        scope={rh ? "Toute l'entreprise" : "Votre équipe et toute votre hiérarchie"}
        period={`${periodLabel} · données AJIR au ${formatDate(d.referenceDate)}`}
        badge={
          d.smallPopulation || !rh ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              {!rh && <Badge>Hors rémunération</Badge>}
              {d.smallPopulation && <StatusBadge tone="warning">Données masquées : petit groupe</StatusBadge>}
              <TermTip term="petitsGroupes" role={ctx.role} />
            </span>
          ) : undefined
        }
        actions={
          <ButtonLink href="/synthese" variant="secondary" iconEnd="arrow-right">
            Lire la synthèse du mois
          </ButtonLink>
        }
      />
      <ShortcutBar items={todo} />
      <FilterForm
        action="/dashboard"
        values={q}
        showReset={chips.length > 0}
        fields={[
          {
            name: "periode",
            label: "Période",
            defaultValue: defaultPeriod,
            options: Object.entries(PERIODS).map(([value, p]) => ({ value, label: p.label })),
          },
          {
            name: "departement",
            label: "Département",
            allLabel: "Tous",
            options: departmentOptions(ctx).map((o) => ({ value: String(o.id), label: o.label })),
          },
          ...(isGlobal(ctx)
            ? [
                { name: "contrat", label: "Contrat", allLabel: "Tous", options: CONTRACT_TYPES.map((c) => ({ value: c, label: CONTRACT_LABELS[c] })) },
                {
                  name: "age",
                  label: "Tranche d'âge",
                  allLabel: "Toutes",
                  options: Object.entries(AGE_BANDS).map(([value, b]) => ({ value, label: b.label })),
                },
                {
                  name: "anciennete",
                  label: "Ancienneté",
                  allLabel: "Toutes",
                  options: Object.entries(TENURE_BANDS).map(([value, b]) => ({ value, label: b.label })),
                },
              ]
            : []),
          {
            name: "niveau",
            label: "Niveau de risque",
            allLabel: "Tous",
            options: (["ELEVE", "MOYEN", "FAIBLE"] as const).map((l) => ({ value: l, label: LEVEL_LABELS[l] })),
          },
        ]}
      />
      <ActiveFilters filters={chips} ignored={ignored} restricted={dropped} />

      <div className="space-y-8">
        <section aria-labelledby="indicateurs-titre">
          <SectionHeader
            id="indicateurs-titre"
            title="Indicateurs clés"
            description={`Variation : ${toMonth} vs ${fromMonth}. Source : ${d.source === "AGREGATS" ? "agrégats mensuels" : "calcul détaillé sur la population filtrée"}, données au ${formatDate(d.referenceDate)}. Effectif, entrées, sorties et turnover : CDI et CDD, hors stages et SIVP. Absentéisme : hors maladie, maternité et congés annuels.${d.view === "RH" && d.risk ? ` Niveaux de risque : ${fmt.model(d.risk.modelVersion)}.` : ""}`}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {risk ? (
              <KpiCard
                label="Collaborateurs en risque élevé"
                period={`Calcul du ${formatDate(risk.asOf)}`}
                value={fmt.int(risk.totals.ELEVE)}
                hint={`${evaluated ? `Part des évalués : ${formatRate(risk.totals.ELEVE / evaluated)}` : "Aucun évalué"} · Moyen : ${fmt.int(risk.totals.MOYEN)}`}
                href={toList({ niveau: "ELEVE" })}
                linkLabel={risk.totals.ELEVE > 1 ? `Voir les ${fmt.int(risk.totals.ELEVE)} collaborateurs` : "Voir la liste"}
                tip={<TermTip term="niveauEleve" role={ctx.role} align="end" />}
              />
            ) : (
              <KpiCard
                label="Collaborateurs en risque élevé"
                value="—"
                emptyLabel="Aucun calcul publié"
                tip={<TermTip term="niveauEleve" role={ctx.role} align="end" />}
              />
            )}
            <KpiCard
              label="Turnover sur 12 mois"
              detailHref="/retention"
              detailLabel="Voir la rétention des embauchés"
              value={formatRate(k.turnover12)}
              delta={rateDelta(first.turnover12, last.turnover12, `depuis ${fromMonth}`, "down")}
              spark={s.map((x) => x.turnover12)}
              hint={k.turnover12 == null ? maskedReason : `Volontaire : ${formatRate(k.turnover12Voluntary)}`}
              tip={<TermTip term="turnover" role={ctx.role} align="end" />}
            />
            <KpiCard
              label="Absentéisme hors santé"
              period={`Moyenne, ${d.period.label}`}
              value={formatRate(k.absenteeismRate)}
              delta={rateDelta(first.absenteeismRate, last.absenteeismRate, `en ${toMonth} vs ${fromMonth}`, "down")}
              spark={s.map((x) => x.absenteeismRate)}
              hint={k.absenteeismRate == null ? maskedReason : undefined}
              href={toAbsenteeism()}
              linkLabel="Analyser l'absentéisme"
              tip={<TermTip term="absenteisme" role={ctx.role} align="end" />}
            />
            <KpiCard
              label={`Effectif fin ${toMonth}`}
              value={fmt.int(k.headcount)}
              delta={countDelta(first.headcount, last.headcount, `depuis fin ${fromMonth}`, "neutral")}
              spark={s.map((x) => x.headcount)}
              href={toList({ niveau: undefined })}
              linkLabel="Voir la liste (tous contrats)"
              tip={<TermTip term="effectif" role={ctx.role} align="end" />}
            />
            <KpiCard
              label="Entrées / sorties"
              period={d.period.label}
              value={`${fmt.int(k.entries)} / ${fmt.int(k.exits)}`}
              hint={k.exits == null ? "Sorties masquées : petit groupe" : `Volontaires : ${fmt.int(k.voluntaryExits ?? 0)} · Solde : ${signed(k.entries - k.exits)}`}
              tip={<TermTip term="entreesSorties" role={ctx.role} align="end" />}
            />
            <KpiCard
              label="Formations obligatoires réalisées"
              period={`Échéances, ${d.period.label}`}
              value={formatRate(k.mandatoryTraining.rate, 0)}
              hint={k.mandatoryTraining.due ? `${fmt.int(k.mandatoryTraining.done)} / ${fmt.int(k.mandatoryTraining.due)} échéances` : "Aucune échéance"}
              detailHref="/formations"
              detailLabel="Voir les formations à risque de retard"
              tip={<TermTip term="formationsObligatoires" role={ctx.role} align="end" />}
            />
            {d.view === "RH" && (
              <KpiCard
                label={`Masse salariale brute, ${formatMonth(d.payroll.month)}`}
                value={fmt.tnd(d.payroll.lastMonth)}
                delta={
                  d.payroll.monthly[0] > 0
                    ? {
                        value: d.payroll.lastMonth - d.payroll.monthly[0],
                        label: `${signed(((d.payroll.lastMonth - d.payroll.monthly[0]) / d.payroll.monthly[0]) * 100, 1)} % depuis ${fromMonth}`,
                        good: "neutral",
                      }
                    : null
                }
                spark={d.payroll.monthly}
                hint={`Cumul : ${fmt.tnd(d.payroll.periodTotal)}`}
                tip={<TermTip term="masseSalariale" role={ctx.role} align="end" />}
              />
            )}
          </div>
        </section>

        <section aria-labelledby="risques-titre">
          <SectionHeader id="risques-titre" title="Risques de départ" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <VisualCard
              headingLevel={3}
              title="Collaborateurs par niveau de risque"
              subtitle={risk ? `Calcul du ${formatDate(risk.asOf)} · ${fmt.int(riskTotal)} actifs, tous contrats` : undefined}
              chart={riskLevels ? withDrillSpec(riskLevels, toLevelList, "Cliquer pour voir les collaborateurs de ce niveau") : undefined}
              className={showDeptChart ? "" : "xl:col-span-3"}
              actions={
                risk && risk.totals.ELEVE > 0 ? (
                  <Link href={toList({ niveau: "ELEVE" })} className={linkCls}>
                    Voir les risques élevés
                  </Link>
                ) : undefined
              }
            >
              {!risk ? noRun : riskTotal === 0 ? noMatch : null}
            </VisualCard>

            {showDeptChart && (
              <VisualCard
                headingLevel={3}
                title="Risque élevé et moyen par département"
                className="xl:col-span-2"
                actions={<TermTip term="capacite" role={ctx.role} align="end" />}
              >
                <EChart
                  option={withDrill(riskByDepartmentOption(riskByDept), toDeptLevelList, "Cliquer pour voir les collaborateurs concernés")}
                  format={{ unit: "collaborateurs" }}
                  height={Math.max(160, 48 + 40 * riskByDept.length)}
                  ariaLabel={`Collaborateurs en risque élevé et moyen par département, du plus exposé au moins exposé. En tête : ${riskByDept
                    .slice(0, 3)
                    .map((r) => `${r.name}, ${plural(r.ELEVE, "risque élevé", "risques élevés")}`)
                    .join(" ; ")}.`}
                />
              </VisualCard>
            )}
          </div>
        </section>

        <section aria-labelledby="evolution-titre">
          <SectionHeader id="evolution-titre" title="Évolution mensuelle" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <VisualCard headingLevel={3} title="Effectif fin de mois" chart={headcountChart ?? undefined} actions={<TermTip term="effectif" role={ctx.role} align="end" />}>
              {!headcountChart && <EmptyState compact title="Aucun effectif sur la période" />}
            </VisualCard>
            <VisualCard
              headingLevel={3}
              title="Turnover sur 12 mois (%)"
              chart={turnoverChart ?? undefined}
              footnote={turnoverChart && smallTeam ? "Petite équipe : un seul départ fait varier le taux de plusieurs points." : undefined}
              actions={<TermTip term="turnover" role={ctx.role} align="end" />}
            >
              {!turnoverChart && <EmptyState compact title={maskedReason} />}
            </VisualCard>
            <VisualCard
              headingLevel={3}
              title="Absentéisme mensuel (%)"
              chart={absenteeismChart ?? undefined}
              actions={
                <Link href={toAbsenteeism()} className={linkCls}>
                  Analyser
                  <span className="sr-only"> l&apos;absentéisme</span>
                </Link>
              }
            >
              {!absenteeismChart && <EmptyState compact title={maskedReason} />}
            </VisualCard>
          </div>
        </section>

        {d.view === "RH" && (
          <section aria-labelledby="departements-titre">
            <SectionHeader id="departements-titre" title="Comparaison des départements" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <VisualCard
                headingLevel={3}
                title="Effectif par département"
                chart={deptHeadcountChart ? withDrillSpec(deptHeadcountChart, toDeptList, "Cliquer pour voir les collaborateurs du département") : undefined}
              >
                {!deptHeadcountChart && <EmptyState compact title="Aucun effectif sur la période" />}
              </VisualCard>
              <VisualCard
                headingLevel={3}
                title="Absentéisme par département (%)"
                subtitle="Ambre : au-dessus de la moyenne"
                chart={deptAbsenteeismChart ? withDrillSpec(deptAbsenteeismChart, toDeptAbsenteeism, "Cliquer pour analyser l'absentéisme du département") : undefined}
                actions={
                  <Link href={toAbsenteeism({ axe: "departement" })} className={linkCls}>
                    Analyser par département
                  </Link>
                }
              >
                {deptAbsenteeismChart ? (
                  <ChartData
                    summary="Voir le détail mois par mois"
                    caption="Absentéisme par département et par mois"
                    table={{
                      headers: ["Département", "Période", ...months],
                      rows: d.departments.map((x) => [x.name, formatRate(x.absenteeismRate, 2), ...x.absenteeismRates.map((r) => formatRate(r, 2))]),
                    }}
                  />
                ) : (
                  <EmptyState compact title="Aucune donnée d'absence sur la période" />
                )}
              </VisualCard>
            </div>
          </section>
        )}

        {risk && riskByDept.length > 0 && (
          <section aria-labelledby="detail-titre">
            <SectionHeader id="detail-titre" title="Niveaux de risque par département" tip={<TermTip term="capacite" role={ctx.role} align="end" />} />
            <DataTable
              caption="Collaborateurs par niveau de risque et par département, avec liens vers la liste"
              defaultSort={{ key: "ELEVE", dir: "desc" }}
              maxHeight={false}
              columns={[
                { key: "name", label: "Département" },
                { key: "ELEVE", label: "Élevé", numeric: true },
                { key: "MOYEN", label: "Moyen", numeric: true },
                { key: "FAIBLE", label: "Faible", numeric: true },
                { key: "nonScored", label: "Non évalués", numeric: true },
                ...(rh ? [{ key: "lift", label: "Lift moyen", numeric: true }] : []),
              ]}
              rows={riskByDept.map((r) => ({
                id: r.departmentId ?? r.name,
                href: deptLink(r),
                cells: {
                  name: r.name,
                  ELEVE: <span className={r.ELEVE > 0 ? "font-semibold" : undefined}>{riskCell(r, r.ELEVE, "ELEVE")}</span>,
                  MOYEN: riskCell(r, r.MOYEN, "MOYEN"),
                  FAIBLE: riskCell(r, r.FAIBLE, "FAIBLE"),
                  nonScored: riskCell(r, r.nonScored, "NON_EVALUE"),
                  ...("avgLift" in r ? { lift: liftText(r.avgLift) } : {}),
                },
                sort: {
                  name: r.name,
                  ELEVE: r.ELEVE,
                  MOYEN: r.MOYEN,
                  FAIBLE: r.FAIBLE,
                  nonScored: r.nonScored,
                  ...("avgLift" in r ? { lift: r.avgLift } : {}),
                },
              }))}
            />
            <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1">
                Non évalués <TermTip term="nonEvalue" role={ctx.role} />
              </span>
              {rh && (
                <span className="inline-flex items-center gap-1">
                  Lift moyen <TermTip term="liftMoyen" role={ctx.role} />
                </span>
              )}
            </p>
          </section>
        )}
      </div>
    </>
  );
}

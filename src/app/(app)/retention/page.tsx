import { EmptyState, Notice, PageHeader, QuestionAnswer, SectionHeader, StatusBadge, fmt } from "@/components/ui";
import { KpiCard, VisualCard, frNumber } from "@/components/charts/pbi";
import { TermTip } from "@/components/help";
import { ActiveFilters, FilterForm, buildHref, type ActiveFilter } from "@/components/pilotage/filters";
import { CI_LABEL, ciText, monthsText, retentionChart } from "@/components/retention/chart-options";
import { GroupTable } from "@/components/retention/sections";
import { DepartureProfiles } from "@/components/retention/departure-profiles";
import { getDepartureProfiles } from "@/lib/dal/typology";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { MAX_CHART_GROUPS, RETENTION_MODES, RETENTION_SEGMENTS, getRetention, retentionQuerySchema, type RetentionDto, type RetentionSegment } from "@/lib/dal/retention";
import type { CurveSummary } from "@/lib/retention/summary";
import type { Role } from "@/db/schema";

export const metadata = { title: "Rétention — People Analytics AJIR" };

const at = (c: CurveSummary, months: number) => c.milestones.find((m) => m.months === months) ?? null;
const pValue = (p: number) => (p < 0.001 ? "p < 0,001" : `p = ${frNumber(p, 3)}`);
const plural = (n: number, one: string, many: string) => `${fmt.int(n)} ${n > 1 ? many : one}`;

export default async function RetentionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const { data: q, ignored } = parseQuery(retentionQuerySchema, await searchParams, "lenient");
  const r = getRetention(ctx, q);
  const profiles = getDepartureProfiles(ctx);
  const rh = r.view === "RH";
  const start = r.observationStart ? fmt.date(r.observationStart) : null;
  const scopeLabel = rh ? "Toute l'entreprise" : "Votre périmètre";
  const voluntary = r.mode === "volontaires";

  const filters: ActiveFilter[] = [];
  if (voluntary) filters.push({ label: "Sorties", value: RETENTION_MODES.volontaires, removeHref: buildHref("/retention", { segment: q.segment }) });
  if (q.segment) filters.push({ label: "Comparaison", value: RETENTION_SEGMENTS[q.segment], removeHref: buildHref("/retention", { mode: voluntary ? q.mode : undefined }) });

  return (
    <>
      <PageHeader
        title="Rétention"
        scope={`${scopeLabel} — ${plural(r.followed, "embauche suivie", "embauches suivies")}`}
        period={start ? `Embauches du ${start} au ${fmt.date(r.referenceDate)}` : `Données au ${fmt.date(r.referenceDate)}`}
      />
      <FilterForm
        action="/retention"
        fields={[
          {
            name: "mode",
            label: "Sorties comptées",
            defaultValue: "toutes",
            options: [
              { value: "toutes", label: RETENTION_MODES.toutes },
              { value: "volontaires", label: "Départs volontaires (démission, abandon)" },
            ],
          },
          {
            name: "segment",
            label: "Comparer par",
            allLabel: "Aucune comparaison",
            options: (Object.keys(RETENTION_SEGMENTS) as RetentionSegment[]).map((k) => ({ value: k, label: RETENTION_SEGMENTS[k] })),
          },
        ]}
        values={{ mode: q.mode, segment: q.segment }}
        showReset={voluntary || !!q.segment}
      />
      <ActiveFilters filters={filters} ignored={ignored} />
      <Content r={r} role={ctx.role} start={start} scopeLabel={scopeLabel} />
      {profiles && <DepartureProfiles data={profiles} role={ctx.role} />}
    </>
  );
}

function Content({ r, role, start, scopeLabel }: { r: RetentionDto; role: Role; start: string | null; scopeLabel: string }) {
  const since = start ? `depuis le ${start}` : "";
  if (r.followed === 0) return <EmptyState title="Aucune embauche à suivre" icon="users" />;
  if (!r.overall || r.overall.stopMonths <= 0) return <EmptyState title="Périmètre trop petit pour une courbe de maintien" icon="users" />;

  const o = r.overall;
  const voluntary = r.mode === "volontaires";
  const measure = voluntary ? "Part sans départ volontaire" : "Part encore présente";
  const m12 = at(o, 12);
  const m24 = at(o, 24);
  const stop = Math.floor(o.stopMonths);

  const shown = r.groups.filter((g) => g.curve && g.curve.stopMonths > 0);
  const charted = r.groups.filter((g) => g.inChart && g.curve).map((g) => ({ name: g.label, curve: g.curve! }));
  const overallName = r.segment ? `Ensemble (${scopeLabel.toLowerCase()})` : "Ensemble";
  const chart = retentionChart({ overall: { name: overallName, curve: o }, groups: charted, tableGroups: shown.map((g) => ({ name: g.label, curve: g.curve! })), measure });
  const lr = r.logRank;
  const title = r.segment ? `Courbe de maintien par ${RETENTION_SEGMENTS[r.segment].toLowerCase()} (%)` : "Courbe de maintien (%)";

  return (
    <>
      <QuestionAnswer
        id="reponse-retention"
        question="Maintien des embauchés"
        verdict={{ tone: "neutre", label: voluntary ? "Départs volontaires" : "Toutes sorties", text: null }}
        scope={`${scopeLabel} · embauches en CDI ou CDD ${since}`}
        method={
          <>
            Méthode de Kaplan-Meier : à chaque ancienneté, part des collaborateurs encore suivis qui restent. Les arrivées récentes comptent tant qu&apos;elles sont suivies
            (censure). La courbe s&apos;arrête quand moins de {r.minAtRisk} personnes restent suivies. Embauche = début du premier CDI ou CDD ; stages et SIVP exclus.{" "}
            {start
              ? `L'historique AJIR commence le ${start}. ${plural(r.notFollowed, "collaborateur embauché avant n'est pas suivi", "collaborateurs embauchés avant ne sont pas suivis")} : seuls ceux encore présents à cette date figurent dans l'export, les compter surestimerait la rétention.`
              : "Début de l'historique inconnu : toutes les embauches sont suivies depuis leur arrivée."}{" "}
            {voluntary
              ? "Départs volontaires : les autres sorties (fin de CDD, licenciement, retraite…) arrêtent le suivi. La courbe estime un risque spécifique, pas la part réellement observée en présence de ces risques concurrents."
              : "Toutes sorties : fins de CDD, licenciements et retraites comptent comme des départs, au même titre que les démissions."}{" "}
            Département, famille de métier et hiérarchie : ceux du dernier import. Données simulées.
          </>
        }
      >
        <KpiCard
          label="Rétention à 12 mois"
          period={voluntary ? "départs volontaires seulement" : "toutes sorties"}
          value={m12?.survival != null ? frNumber(m12.survival * 100, 1) : "—"}
          unit={m12?.survival != null ? "%" : undefined}
          hint={m12?.survival != null ? `IC à 95 % : ${ciText(m12.lower, m12.upper)}` : "Suivi encore trop court"}
          tip={<TermTip term="retention" role={role} align="end" />}
        />
        <KpiCard
          label="Rétention à 24 mois"
          period={voluntary ? "départs volontaires seulement" : "toutes sorties"}
          value={m24?.survival != null ? frNumber(m24.survival * 100, 1) : "—"}
          unit={m24?.survival != null ? "%" : undefined}
          hint={m24?.survival != null ? `IC à 95 % : ${ciText(m24.lower, m24.upper)}` : "Suivi encore trop court"}
          tip={<TermTip term="kaplanMeier" role={role} align="end" />}
        />
        <KpiCard
          label="Durée médiane de présence"
          period={voluntary ? "avant un départ volontaire" : "toutes sorties"}
          value={o.medianMonths != null ? fmt.int(o.medianMonths) : "Non atteinte"}
          unit={o.medianMonths != null ? "mois" : undefined}
          hint={o.medianMonths != null ? undefined : `Suivi de ${monthsText(stop)}`}
          tip={<TermTip term="dureeMediane" role={role} align="end" />}
        />
        <KpiCard
          label="Embauches suivies"
          period={since ? `CDI ou CDD, ${since}` : "CDI ou CDD"}
          value={fmt.int(r.followed)}
          hint={plural(o.events, voluntary ? "départ volontaire observé" : "sortie observée", voluntary ? "départs volontaires observés" : "sorties observées")}
          tip={<TermTip term="censure" role={role} align="end" />}
        />
      </QuestionAnswer>

      {r.maskedGroups > 0 && (
        <Notice className="mb-4">
          {r.maskedGroups > 1 ? `${r.maskedGroups} groupes ne sont pas affichés` : "1 groupe n'est pas affiché"} : petits groupes (moins de {r.minAtRisk} personnes)
        </Notice>
      )}

      <VisualCard
        id="courbe"
        title={title}
        chart={chart}
        measure={measure}
        unit="%"
        scope={scopeLabel}
        period={`ancienneté de 0 à ${monthsText(r.horizonMonths)}`}
        className="mb-6"
        badge={lr && <StatusBadge tone={lr.pValue < 0.05 ? "warning" : "neutral"}>{lr.pValue < 0.05 ? "Écart significatif" : "Écart non significatif"}</StatusBadge>}
        footnote={
          <>
            Bande grise : {CI_LABEL.toLowerCase()} de l&apos;ensemble · courbes arrêtées sous {r.minAtRisk} personnes suivies
            {shown.length > charted.length && ` · ${MAX_CHART_GROUPS} groupes les plus nombreux tracés, tous dans le tableau`}
            {lr && ` · Test du log-rank : χ² = ${frNumber(lr.chi2, 1)}, ${plural(lr.df, "degré de liberté", "degrés de liberté")}, ${pValue(lr.pValue)}`}
          </>
        }
      />

      {r.segment && (
        <section aria-labelledby="detail-groupes" className="mb-6">
          <SectionHeader id="detail-groupes" title={`Détail par ${RETENTION_SEGMENTS[r.segment].toLowerCase()}`} />
          <GroupTable overall={{ label: overallName, n: r.followed, curve: o }} groups={r.groups} caption={`Rétention par ${RETENTION_SEGMENTS[r.segment].toLowerCase()}`} />
        </section>
      )}
    </>
  );
}

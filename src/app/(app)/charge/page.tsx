import { cardCls, EmptyState, fmt, Notice, PageHeader, QuestionAnswer, SectionHeader } from "@/components/ui";
import { EChart } from "@/components/charts/echart";
import { ChartData, KpiCard, VisualCard } from "@/components/charts/pbi";
import { departmentBars, groupLineChart, monthShort, observedForecastOption, peakBars } from "@/components/ai/workload/options";
import { GroupTable, OverloadTable, workloadRecoItems } from "@/components/ai/workload/sections";
import { RecoBoard } from "@/components/ai/workload/reco-status-form";
import { DEFS, Def, ReadingGuide, fr, type Answer } from "@/components/ai/workload/insight-kit";
import { CoverageNote } from "@/components/ai/conformal/coverage-note";
import { readConformal } from "@/lib/ai/conformal";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { MIN_GROUP_SIZE, getWorkload, type GroupView, type WorkloadManager, type WorkloadRh } from "@/lib/dal/ai-workload";
import { updateWorkloadRecoAction } from "./actions";

export const metadata = { title: "Charge de travail — People Analytics AJIR" };

const SUBTITLE = "Repérer les équipes dont les heures supplémentaires dépassent un niveau soutenable, avant que la surcharge ne s'installe.";
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const names = (gs: GroupView[], max = 3) =>
  `${gs
    .slice(0, max)
    .map((g) => g.label)
    .join(", ")}${gs.length > max ? `, et ${gs.length - max} autre${gs.length - max > 1 ? "s" : ""}` : ""}`;
const lastForecastMonth = (gs: (GroupView | null)[]) => {
  const m = gs
    .flatMap((g) => g?.forecast.map((p) => p.month) ?? [])
    .sort()
    .pop();
  return m ? fr.monthLong(m) : "les 3 prochains mois";
};
const peakTip = (g: GroupView) =>
  g.peak
    ? `${fr.hours(g.peak.value)} en ${fr.monthLong(g.peak.month)}${g.peak.lower != null && g.peak.upper != null ? ` (fourchette ${fr.hours(g.peak.lower)} à ${fr.hours(g.peak.upper)})` : ""}${
        g.tension === "PROBABLE" ? " · tension probable" : g.tension === "POSSIBLE" ? " · tension possible" : ""
      }`
    : "—";

// Réponse « Quelles équipes sont en surcharge ? » à partir des équipes prévues et du seuil de tension
function tensionVerdict(teams: GroupView[], threshold: number | null, until: string, overloads: number | null): Answer {
  const probable = teams.filter((t) => t.tension === "PROBABLE");
  const possible = teams.filter((t) => t.tension === "POSSIBLE");
  const thr = threshold != null ? ` (${fr.hours(threshold)} par ETP et par mois)` : "";
  const extra =
    overloads == null || overloads === 0
      ? ""
      : ` Par ailleurs, ${fr.count(overloads, "collaborateur fait", "collaborateurs font")} des heures sup élevées depuis plusieurs mois.`;
  if (!teams.length)
    return { tone: "neutre", label: "Pas de prévision", text: `Aucune équipe d'au moins ${MIN_GROUP_SIZE} personnes n'a de prévision ce mois-ci.${extra}` };
  if (probable.length)
    return {
      tone: "critique",
      label: "Surcharge probable",
      text: `${probable.length} ${plural(probable.length, "équipe dépassera", "équipes dépasseront")} probablement le seuil de tension${thr} d'ici ${until} : ${names(probable)}.${
        possible.length ? ` ${possible.length} autre${possible.length > 1 ? "s" : ""} pourrai${possible.length > 1 ? "ent" : "t"} le dépasser.` : ""
      }${extra}`,
    };
  if (possible.length)
    return {
      tone: "attention",
      label: "Surcharge possible",
      text: `Aucune équipe ne dépasse le seuil de façon probable, mais ${possible.length} ${plural(possible.length, "pourrait", "pourraient")} le dépasser d'ici ${until} : ${names(possible)}.${extra}`,
    };
  return { tone: "bon", label: "Pas de surcharge prévue", text: `Aucune équipe ne devrait dépasser le seuil de tension${thr} d'ici ${until}.${extra}` };
}

export default async function ChargePage() {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const w = getWorkload(ctx);
  const period = w.asOf ? `Données au ${fmt.date(w.asOf)}` : undefined;
  return (
    <>
      <PageHeader
        title="Charge de travail"
        subtitle={SUBTITLE}
        scope={w.view === "RH" ? "Toute l'entreprise" : `Vos équipes d'au moins ${MIN_GROUP_SIZE} personnes`}
        period={period}
      />
      {!w.asOf ? (
        <EmptyState title="Aucune prévision de charge disponible" icon="chart">
          Les prévisions apparaissent après le calcul mensuel, une fois le modèle « charge de travail » mis en service par l&apos;administrateur.
        </EmptyState>
      ) : w.view === "RH" ? (
        <RhView w={w} />
      ) : (
        <ManagerView w={w} />
      )}
    </>
  );
}

function Method({ w }: { w: WorkloadRh | WorkloadManager }) {
  return (
    <ReadingGuide helpHref="/aide">
      <li>
        Unité : heures supplémentaires pointées par ETP et par mois. {DEFS.etp.text} Un groupe réunit les collaborateurs qui lui sont rattachés au{" "}
        {fmt.date(w.asOf)}, historique compris.
      </li>
      <li>
        La prévision à 1-3 mois tient compte du niveau récent, de la saisonnalité et du calendrier tunisien (Ramadan, séance unique, ponts), de l&apos;effectif
        et des départs récents. {DEFS.fourchette.text}
      </li>
      <li>
        Seuil de tension : {fr.hours(w.threshold)} par ETP et par mois, soit le niveau des 15 % de mois les plus chargés de l&apos;historique des équipes.
        Tension probable : même le bas de la fourchette dépasse le seuil.
      </li>
      <li>Seules les équipes d&apos;au moins {MIN_GROUP_SIZE} personnes sont prévues.</li>
    </ReadingGuide>
  );
}

// Couverture mesurée des fourchettes du modèle qui a produit les prévisions (version calibrée), par portée
const coverageOf = (w: WorkloadRh | WorkloadManager) => readConformal("workload", w.modelVersion ?? null)?.coverage;

function RhView({ w }: { w: WorkloadRh }) {
  const c = w.company;
  const coverage = coverageOf(w);
  const next = c?.forecast[0] ?? null;
  const tensionTeams = w.teams.filter((t) => t.tension);
  const probable = tensionTeams.filter((t) => t.tension === "PROBABLE").length;
  const until = lastForecastMonth([c, ...w.teams.slice(0, 1)]);
  const barTeams = (tensionTeams.length ? tensionTeams : w.teams.filter((t) => t.peak)).slice(0, 20);
  const deptRows = w.departments.filter((d) => d.peak);
  const topDept = [...deptRows].sort((a, b) => (b.peak?.value ?? 0) - (a.peak?.value ?? 0))[0];
  const companyDelta = c?.last != null && c.mean12 != null ? c.last - c.mean12 : null;
  const companyTrend = next && c?.last != null ? next.value - c.last : null;
  const companyTitle =
    companyTrend == null || !c
      ? "Heures sup par ETP de l'entreprise"
      : Math.abs(companyTrend) < 0.5
        ? `Entreprise : heures sup stables, autour de ${fr.hours(next!.value)} par ETP`
        : `Entreprise : heures sup en ${companyTrend > 0 ? "hausse" : "baisse"}, ${fr.hours(next!.value)} par ETP prévues en ${fr.monthLong(next!.month)}`;
  const recos = workloadRecoItems(w.recommendations, fmt.date);

  return (
    <>
      <QuestionAnswer
        id="reponse-charge"
        question="Quelles équipes sont en surcharge ?"
        verdict={tensionVerdict(w.teams, w.threshold, until, w.overloads.length)}
        scope={`Toute l'entreprise · ${fr.count(w.teams.length, "équipe prévue", "équipes prévues")} · 12 derniers mois observés et 3 mois prévus, au ${fmt.date(w.asOf)}.`}
        method={
          <>
            Une équipe est en tension si son pic d&apos;heures sup prévu sur 3 mois dépasse le seuil de {fr.hours(w.threshold)} par ETP. Probable : même le bas
            de la fourchette à 80 % dépasse le seuil ; possible : seule la prévision centrale le dépasse.
          </>
        }
      >
        <KpiCard
          label="Équipes en tension"
          period={`d'ici ${until}`}
          value={fmt.int(tensionTeams.length)}
          unit={`sur ${fmt.int(w.teams.length)}`}
          status={
            tensionTeams.length
              ? { tone: probable ? "critique" : "attention", label: probable ? `${probable} probable${probable > 1 ? "s" : ""}` : "Possible" }
              : { tone: "bon", label: "Aucune" }
          }
          hint={
            tensionTeams.length
              ? `${probable} tension${probable > 1 ? "s" : ""} probable${probable > 1 ? "s" : ""}, ${tensionTeams.length - probable} possible${tensionTeams.length - probable > 1 ? "s" : ""}`
              : "Toutes sous le seuil"
          }
          detailHref={tensionTeams.length ? "#equipes" : undefined}
          detailLabel="Voir les équipes"
          tip={<Def id="tension" />}
        />
        <KpiCard
          label="Heures sup par ETP, entreprise"
          period={c?.observed.length ? `${fr.monthLong(c.observed[c.observed.length - 1].month)} (observé)` : undefined}
          value={fr.hours(c?.last)}
          delta={
            companyDelta != null
              ? { value: Math.abs(companyDelta) < 0.05 ? 0 : companyDelta, label: `${fr.hoursDelta(companyDelta)} vs moyenne 12 mois`, good: "down" }
              : null
          }
          hint={`Moyenne 12 mois : ${fr.hours(c?.mean12)}`}
          spark={c?.observed.map((p) => p.value)}
          tip={<Def id="heuresSup" />}
        />
        <KpiCard
          label="Prévision du mois prochain"
          period={next ? fr.monthLong(next.month) : undefined}
          value={fr.hours(next?.value)}
          delta={
            next && c?.last != null
              ? {
                  value: Math.abs(next.value - c.last) < 0.05 ? 0 : next.value - c.last,
                  label: `${fr.hoursDelta(next.value - c.last)} vs dernier mois`,
                  good: "down",
                }
              : null
          }
          hint={
            next && next.lower != null && next.upper != null
              ? `Fourchette probable à 80 % : ${fr.hours(next.lower)} à ${fr.hours(next.upper)}`
              : "Moyenne des départements pondérée par l'effectif (pas de fourchette au niveau entreprise)"
          }
          tip={<Def id="heuresSup" />}
        />
        <KpiCard
          label="Surcharges individuelles"
          period={`${w.rule.months} mois ou plus au-delà de ${fr.hours(w.rule.thresholdH)}`}
          value={fmt.int(w.overloads.length)}
          unit={plural(w.overloads.length, "collaborateur", "collaborateurs")}
          status={w.overloads.length ? { tone: "attention", label: "Entretiens à prévoir" } : { tone: "bon", label: "Aucune" }}
          detailHref={w.overloads.length ? "#surcharges" : undefined}
          detailLabel="Voir la liste"
          tip={<Def id="surcharge" />}
        />
      </QuestionAnswer>

      <div className="grid gap-4 xl:grid-cols-5">
        <VisualCard
          title={
            probable
              ? `${probable} ${plural(probable, "équipe dépassera", "équipes dépasseront")} probablement le seuil de ${fr.hours(w.threshold)}`
              : tensionTeams.length
                ? `${tensionTeams.length} ${plural(tensionTeams.length, "équipe pourrait", "équipes pourraient")} dépasser le seuil de ${fr.hours(w.threshold)}`
                : "Aucune équipe au-dessus du seuil : voici les plus chargées"
          }
          subtitle={`Pic d'heures sup par ETP prévu sur les 3 prochains mois (h), par équipe désignée par son manager · toute l'entreprise, d'ici ${until} · rouge : tension probable · ambre : possible · tirets : seuil de tension`}
          className="xl:col-span-3"
          chart={
            barTeams.length
              ? peakBars(
                  barTeams.map((t) => ({
                    name: t.label.replace(/^Équipe de /, ""),
                    value: t.peak?.value ?? 0,
                    tension: t.tension,
                    tip: `${peakTip(t)}${t.departmentName ? ` · ${t.departmentName}` : ""}`,
                  })),
                  w.threshold,
                )
              : undefined
          }
          footnote={
            tensionTeams.length > barTeams.length ? `${tensionTeams.length - barTeams.length} autres équipes en tension dans le tableau du détail.` : undefined
          }
        >
          {!barTeams.length && <EmptyState title="Aucune équipe prévue ce mois-ci" compact />}
        </VisualCard>
        <VisualCard
          title={topDept ? `${topDept.label} : la charge prévue la plus élevée (${fr.hours(topDept.peak?.value)})` : "Départements"}
          subtitle="Pic d'heures sup par ETP prévu sur 3 mois, par département (h) · tirets : entreprise"
          className="xl:col-span-2"
          chart={
            deptRows.length
              ? departmentBars(
                  deptRows.map((d) => ({
                    name: d.label,
                    value: d.peak!.value,
                    tension: d.tension,
                    tip: `${peakTip(d)} · moyenne 12 mois ${fr.hours(d.mean12)}`,
                  })),
                  c?.peak?.value ?? null,
                )
              : undefined
          }
        >
          {!deptRows.length && <EmptyState title="Aucun département prévu" compact />}
        </VisualCard>
      </div>
      {c && (
        <VisualCard
          title={companyTitle}
          subtitle={`Heures sup par ETP et par mois (h) · toute l'entreprise · 12 mois observés puis 3 mois prévus`}
          className="mt-4"
          chart={groupLineChart(c, null, 280)}
          footnote={
            c.forecast.some((p) => p.lower != null)
              ? "Bleu : observé. Gris en tirets : prévision. Bande grise : fourchette probable à 80 %, qui contient la valeur réelle environ 8 fois sur 10."
              : "Bleu : observé. Gris en tirets : prévision, moyenne des départements pondérée par l'effectif (les fourchettes sont calculées par département et par équipe)."
          }
        />
      )}

      <SectionHeader
        id="actions"
        title="Que faire ?"
        description="Actions proposées pour les équipes en tension et, pour la RH, entretiens avec les collaborateurs en surcharge."
        className="mt-8"
      />
      <div className={`${cardCls} p-4 sm:p-5`}>
        <RecoBoard
          items={recos}
          action={updateWorkloadRecoAction}
          emptyTitle="Aucune action à traiter sur la charge de travail"
          emptyText="Des actions sont proposées après le calcul mensuel pour les équipes en tension et les surcharges individuelles."
        />
      </div>

      <SectionHeader title="Détail" description="Équipes en tension, départements et surcharges individuelles." className="mt-8" />
      <section id="equipes" aria-labelledby="equipes-titre" className="scroll-mt-4">
        <SectionHeader
          id="equipes-titre"
          level={3}
          title={`Équipes en tension (${tensionTeams.length})`}
          tip={<Def id="tension" align="start" />}
          description={`${w.teams.length} équipes d'au moins ${MIN_GROUP_SIZE} personnes prévues ; les équipes plus petites ne sont pas prévues.`}
        />
        <GroupTable
          groups={tensionTeams}
          caption="Équipes dont le pic prévu dépasse le seuil de tension"
          empty={<EmptyState title="Aucune équipe au-dessus du seuil de tension sur les 3 prochains mois" icon="success" compact />}
        />
        <CoverageNote cell={coverage?.EQUIPE} />
      </section>
      <section aria-labelledby="departements-titre" className="mt-8">
        <SectionHeader
          id="departements-titre"
          level={3}
          title="Départements"
          description="Heures sup par ETP observées et prévues, toutes équipes confondues."
        />
        <GroupTable groups={w.departments} caption="Heures sup par ETP observées et prévues par département" showDepartment={false} nameHeader="Département" />
        <CoverageNote cell={coverage?.DEPARTEMENT} />
      </section>
      <section id="surcharges" aria-labelledby="surcharges-titre" className="mt-8 scroll-mt-4">
        <SectionHeader
          id="surcharges-titre"
          level={3}
          title={`Surcharges individuelles soutenues (${w.overloads.length})`}
          tip={<Def id="surcharge" align="start" />}
        />
        <Notice tone="info" className="mb-3">
          Règle simple, sans modèle : plus de {fr.hours(w.rule.thresholdH)} d&apos;heures sup chaque mois pendant au moins {w.rule.months} mois consécutifs.
          Réservé à la RH ; les collaborateurs opposés au calcul sont exclus. Le risque de départ est une information complémentaire.
        </Notice>
        <OverloadTable rows={w.overloads} />
      </section>
      <p className="mt-4 text-xs text-fg-subtle">
        Calcul au {fmt.date(w.asOf)} · {fmt.model(w.modelVersion)}
      </p>
      <Method w={w} />
    </>
  );
}

function ManagerView({ w }: { w: WorkloadManager }) {
  const tension = w.teams.filter((t) => t.tension);
  const until = lastForecastMonth(w.teams);
  const single = w.teams.length === 1 ? w.teams[0] : null;
  const loaded = [...w.teams].sort((a, b) => (b.peak?.value ?? 0) - (a.peak?.value ?? 0))[0];
  const recos = workloadRecoItems(w.recommendations, fmt.date);
  const chartTitle = single
    ? single.tension
      ? `${single.label} : tension ${single.tension === "PROBABLE" ? "probable" : "possible"} en ${fr.monthLong(single.peak!.month)}`
      : `${single.label} : sous le seuil de tension jusqu'en ${until}`
    : tension.length
      ? `${tension.length} de vos équipes ${plural(tension.length, "pourrait", "pourraient")} dépasser le seuil de tension`
      : `Vos équipes restent sous le seuil de tension jusqu'en ${until}`;
  const multi = w.teams.slice(0, 8);
  const teamCoverage = coverageOf(w)?.EQUIPE;
  return (
    <>
      <QuestionAnswer
        id="reponse-charge"
        question="Vos équipes sont-elles en surcharge ?"
        verdict={tensionVerdict(w.teams, w.threshold, until, null)}
        scope={`${fr.count(w.teams.length, "équipe suivie", "équipes suivies")}, en agrégé · 12 derniers mois observés et 3 mois prévus, au ${fmt.date(w.asOf)}.`}
        method={
          <>
            Une équipe est en tension si son pic d&apos;heures sup prévu sur 3 mois dépasse le seuil de {fr.hours(w.threshold)} par ETP. Seules les équipes
            d&apos;au moins {MIN_GROUP_SIZE} personnes sont prévues ; aucun chiffre individuel n&apos;est affiché.
          </>
        }
      >
        <KpiCard
          label="Équipes en tension"
          period={`d'ici ${until}`}
          value={fmt.int(tension.length)}
          unit={`sur ${fmt.int(w.teams.length)}`}
          status={tension.length ? { tone: "attention", label: "Charge prévue élevée" } : { tone: "bon", label: "Aucune" }}
          tip={<Def id="tension" />}
        />
        {single ? (
          <KpiCard
            label="Heures sup par ETP"
            period={single.observed.length ? `${fr.monthLong(single.observed[single.observed.length - 1].month)} (observé)` : undefined}
            value={fr.hours(single.last)}
            delta={
              single.last != null && single.mean12 != null
                ? {
                    value: Math.abs(single.last - single.mean12) < 0.05 ? 0 : single.last - single.mean12,
                    label: `${fr.hoursDelta(single.last - single.mean12)} vs moyenne 12 mois`,
                    good: "down",
                  }
                : null
            }
            spark={single.observed.map((p) => p.value)}
            tip={<Def id="heuresSup" />}
          />
        ) : (
          <KpiCard
            label="Équipe la plus chargée"
            period="pic prévu sur 3 mois"
            value={fr.hours(loaded?.peak?.value)}
            status={
              loaded?.tension
                ? { tone: loaded.tension === "PROBABLE" ? "critique" : "attention", label: loaded.tension === "PROBABLE" ? "Tension probable" : "Tension possible" }
                : loaded?.peak
                  ? { tone: "bon", label: "Sous le seuil" }
                  : undefined
            }
            hint={loaded?.label}
            tip={<Def id="heuresSup" />}
          />
        )}
        <KpiCard label="Seuil de tension" period="par ETP et par mois" value={fr.hours(w.threshold)} tip={<Def id="seuil" />} />
      </QuestionAnswer>

      {w.hiddenTeams > 0 && (
        <Notice tone="warning" className="mb-4">
          {w.hiddenTeams} équipe(s) de votre périmètre non affichée(s) : moins de {MIN_GROUP_SIZE} personnes ou historique insuffisant.
        </Notice>
      )}
      {w.teams.length ? (
        single ? (
          <VisualCard
            title={chartTitle}
            subtitle="Heures sup par ETP et par mois (h) · 12 mois observés puis 3 mois prévus · tirets : seuil de tension"
            chart={groupLineChart(single, w.threshold)}
            footnote="Bleu : observé. Gris en tirets : prévision. Bande grise : fourchette probable à 80 %, qui contient la valeur réelle environ 8 fois sur 10."
          >
            <CoverageNote cell={teamCoverage} />
          </VisualCard>
        ) : (
          <VisualCard
            title={chartTitle}
            subtitle="Heures sup par ETP et par mois (h) · 12 mois observés puis 3 mois prévus · trait plein : observé · tirets : prévu · ligne grise : seuil de tension"
            footnote={`Fourchette probable à 80 % de chaque équipe (elle contient la valeur réelle environ 8 fois sur 10) : dans « Voir les données » et dans le tableau du détail.${
              w.teams.length > multi.length ? ` Graphique limité à ${multi.length} équipes ; les ${w.teams.length} figurent dans le tableau du détail.` : ""
            }`}
          >
            <EChart
              height={300}
              format={{ unit: "h", digits: 1 }}
              option={observedForecastOption(
                multi.map((g) => ({ name: g.label, observed: g.observed, forecast: g.forecast })),
                w.threshold,
              )}
              ariaLabel={`Heures supplémentaires par ETP de vos équipes, observées puis prévues. ${chartTitle}.`}
            />
            <ChartData
              caption="Heures sup par ETP par mois et par équipe"
              table={{
                headers: ["Mois", ...multi.map((g) => g.label)],
                rows: [...new Set(multi.flatMap((g) => [...g.observed.map((p) => p.month), ...g.forecast.map((p) => p.month)]))].sort().map((m) => [
                  monthShort(m),
                  ...multi.map((g) => {
                    const o = g.observed.find((p) => p.month === m);
                    const f = g.forecast.find((p) => p.month === m);
                    if (o) return fr.hours(o.value);
                    if (!f) return "—";
                    return f.lower != null && f.upper != null ? `${fr.hours(f.value)} (prévu, ${fr.hours(f.lower)} à ${fr.hours(f.upper)})` : `${fr.hours(f.value)} (prévu)`;
                  }),
                ]),
              }}
            />
            <CoverageNote cell={teamCoverage} />
          </VisualCard>
        )
      ) : (
        <EmptyState title="Aucune équipe affichable" icon="users">
          Les chiffres ne sont montrés que pour des équipes d&apos;au moins {MIN_GROUP_SIZE} personnes, pour protéger l&apos;anonymat.
        </EmptyState>
      )}

      <SectionHeader id="actions" title="Que faire ?" description="Recommandations pour vos équipes, jamais pour une personne." className="mt-8" />
      <div className={`${cardCls} p-4 sm:p-5`}>
        <RecoBoard
          items={recos}
          action={updateWorkloadRecoAction}
          emptyTitle="Aucune action à traiter pour vos équipes"
          emptyText="Une action vous est proposée après le calcul mensuel si l'une de vos équipes risque de dépasser le seuil de tension."
        />
      </div>

      {w.teams.length > 0 && (
        <>
          <SectionHeader title="Détail" description="Heures sup par ETP observées et prévues de chacune de vos équipes." className="mt-8" />
          <section aria-label="Vos équipes">
            <GroupTable groups={w.teams} caption="Heures sup par ETP observées et prévues de vos équipes" />
          </section>
        </>
      )}
      <Method w={w} />
    </>
  );
}

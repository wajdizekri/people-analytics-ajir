import { cardCls, EmptyState, fmt, Notice, PageHeader, QuestionAnswer, SectionHeader, StatusBadge } from "@/components/ui";
import { EChart } from "@/components/charts/echart";
import { ChartData, KpiCard, VisualCard } from "@/components/charts/pbi";
import { InfoTip } from "@/components/help";
import { departmentBars, groupLineChart, monthShort, observedForecastOption, peakBars } from "@/components/ai/workload/options";
import { GroupTable, OverloadTable, TensionBadge, workloadRecoItems } from "@/components/ai/workload/sections";
import { RecoBoard } from "@/components/ai/workload/reco-status-form";
import { DEFS, Def, fr, type Answer } from "@/components/ai/workload/insight-kit";
import { CoverageNote } from "@/components/ai/conformal/coverage-note";
import { readConformal } from "@/lib/ai/conformal";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { MIN_GROUP_SIZE, getWorkload, type GroupView, type WorkloadManager, type WorkloadRh } from "@/lib/dal/ai-workload";
import { updateWorkloadRecoAction } from "./actions";

export const metadata = { title: "Charge de travail — People Analytics AJIR" };

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
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
        g.tension === "PROBABLE" ? " · surcharge probable" : g.tension === "POSSIBLE" ? " · surcharge possible" : ""
      }`
    : "—";

// Verdict de la synthèse : équipes prévues et seuil de surcharge (couleur + mot)
function tensionVerdict(teams: GroupView[]): Answer {
  if (!teams.length) return { tone: "neutre", label: "Pas de prévision", text: null };
  if (teams.some((t) => t.tension === "PROBABLE")) return { tone: "critique", label: "Surcharge probable", text: null };
  if (teams.some((t) => t.tension === "POSSIBLE")) return { tone: "attention", label: "Surcharge possible", text: null };
  return { tone: "bon", label: "Pas de surcharge prévue", text: null };
}

// Méthode (bulle « ? » de la synthèse) : unité, prévision, seuil, groupes prévus
function method(w: WorkloadRh | WorkloadManager, rh: boolean) {
  return (
    <>
      Une équipe est en surcharge prévue si son pic d&apos;heures sup prévu sur 3 mois dépasse le seuil de {fr.hours(w.threshold)} par ETP et par mois (niveau des
      15 % de mois les plus chargés de l&apos;historique). Probable : même le bas de la fourchette à 80 % dépasse le seuil ; possible : seule la prévision centrale
      le dépasse. Unité : heures sup pointées par ETP et par mois. {DEFS.etp.text} La prévision tient compte du niveau récent, de la saisonnalité, du calendrier
      tunisien (Ramadan, séance unique, ponts), de l&apos;effectif et des départs récents. Seules les équipes d&apos;au moins {MIN_GROUP_SIZE} personnes sont prévues
      {rh ? "." : " ; aucun chiffre individuel n'est affiché."}
    </>
  );
}

export default async function ChargePage() {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const w = getWorkload(ctx);
  const period = w.asOf ? `Données au ${fmt.date(w.asOf)}` : undefined;
  return (
    <>
      <PageHeader
        title="Charge de travail"
        scope={w.view === "RH" ? "Toute l'entreprise" : `Vos équipes d'au moins ${MIN_GROUP_SIZE} personnes`}
        period={period}
      />
      {!w.asOf ? (
        <EmptyState title="Aucune prévision de charge disponible" icon="chart" />
      ) : w.view === "RH" ? (
        <RhView w={w} />
      ) : (
        <ManagerView w={w} />
      )}
    </>
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
  const companyDelta = c?.last != null && c.mean12 != null ? c.last - c.mean12 : null;
  const recos = workloadRecoItems(w.recommendations, fmt.date);

  return (
    <>
      <QuestionAnswer
        id="reponse-charge"
        question="Surcharge des équipes"
        verdict={tensionVerdict(w.teams)}
        scope={`Toute l'entreprise · ${fr.count(w.teams.length, "équipe prévue", "équipes prévues")} · 12 mois observés, 3 mois prévus`}
        method={method(w, true)}
      >
        <KpiCard
          label="Équipes en surcharge prévue"
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
              ? `${probable} surcharge${probable > 1 ? "s" : ""} probable${probable > 1 ? "s" : ""}, ${tensionTeams.length - probable} possible${tensionTeams.length - probable > 1 ? "s" : ""}`
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
              : "Moyenne pondérée des départements, sans fourchette"
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
          title="Charge prévue par équipe (h)"
          subtitle={`Pic d'heures sup par ETP sur 3 mois, d'ici ${until} · rouge : surcharge probable · ambre : possible · tirets : seuil de surcharge`}
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
          footnote={tensionTeams.length > barTeams.length ? `Autres équipes en surcharge prévue, dans le détail : ${tensionTeams.length - barTeams.length}` : undefined}
        >
          {!barTeams.length && <EmptyState title="Aucune équipe prévue ce mois-ci" compact />}
        </VisualCard>
        <VisualCard
          title="Charge prévue par département (h)"
          subtitle="Pic d'heures sup par ETP sur 3 mois · tirets : entreprise"
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
          title="Heures sup par ETP, entreprise (h)"
          subtitle={
            c.forecast.some((p) => p.lower != null)
              ? "12 mois observés puis 3 mois prévus · bande grise : fourchette probable à 80 %"
              : "12 mois observés puis 3 mois prévus · prévision : moyenne des départements pondérée par l'effectif"
          }
          className="mt-4"
          chart={groupLineChart(c, null, 280)}
        />
      )}

      <SectionHeader id="actions" title="Actions proposées" className="mt-8" />
      <div className={`${cardCls} p-4 sm:p-5`}>
        <RecoBoard items={recos} action={updateWorkloadRecoAction} emptyTitle="Aucune action à traiter" />
      </div>

      <SectionHeader title="Détail" className="mt-8" />
      <section id="equipes" aria-labelledby="equipes-titre" className="scroll-mt-4">
        <SectionHeader id="equipes-titre" level={3} title={`Équipes en surcharge prévue (${tensionTeams.length})`} tip={<Def id="tension" align="start" />} />
        <GroupTable
          groups={tensionTeams}
          caption="Équipes dont le pic prévu dépasse le seuil de surcharge"
          empty={<EmptyState title="Aucune équipe au-dessus du seuil" icon="success" compact />}
        />
        <CoverageNote cell={coverage?.EQUIPE} />
      </section>
      <section aria-labelledby="departements-titre" className="mt-8">
        <SectionHeader id="departements-titre" level={3} title="Départements" />
        <GroupTable groups={w.departments} caption="Heures sup par ETP observées et prévues par département" showDepartment={false} nameHeader="Département" />
        <CoverageNote cell={coverage?.DEPARTEMENT} />
      </section>
      <section id="surcharges" aria-labelledby="surcharges-titre" className="mt-8 scroll-mt-4">
        <SectionHeader
          id="surcharges-titre"
          level={3}
          title={`Surcharges individuelles soutenues (${w.overloads.length})`}
          tip={
            <InfoTip label={DEFS.surcharge.label} align="start">
              Plus de {fr.hours(w.rule.thresholdH)} d&apos;heures sup chaque mois pendant au moins {w.rule.months} mois consécutifs. Règle simple, sans modèle ;
              collaborateurs opposés au calcul exclus. Le risque de départ est une information complémentaire.
            </InfoTip>
          }
          actions={<StatusBadge>Réservé RH</StatusBadge>}
        />
        <OverloadTable rows={w.overloads} />
      </section>
      <p className="mt-4 text-xs text-fg-subtle">
        Calcul au {fmt.date(w.asOf)} · {fmt.model(w.modelVersion)}
      </p>
    </>
  );
}

function ManagerView({ w }: { w: WorkloadManager }) {
  const tension = w.teams.filter((t) => t.tension);
  const until = lastForecastMonth(w.teams);
  const single = w.teams.length === 1 ? w.teams[0] : null;
  const loaded = [...w.teams].sort((a, b) => (b.peak?.value ?? 0) - (a.peak?.value ?? 0))[0];
  const recos = workloadRecoItems(w.recommendations, fmt.date);
  const multi = w.teams.slice(0, 8);
  const teamCoverage = coverageOf(w)?.EQUIPE;
  return (
    <>
      <QuestionAnswer
        id="reponse-charge"
        question="Surcharge de vos équipes"
        verdict={tensionVerdict(w.teams)}
        scope={`${fr.count(w.teams.length, "équipe suivie", "équipes suivies")}, en agrégé · 12 mois observés, 3 mois prévus`}
        method={method(w, false)}
      >
        <KpiCard
          label="Équipes en surcharge prévue"
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
                ? { tone: loaded.tension === "PROBABLE" ? "critique" : "attention", label: loaded.tension === "PROBABLE" ? "Surcharge probable" : "Surcharge possible" }
                : loaded?.peak
                  ? { tone: "bon", label: "Sous le seuil" }
                  : undefined
            }
            hint={loaded?.label}
            tip={<Def id="heuresSup" />}
          />
        )}
        <KpiCard label="Seuil de surcharge" period="par ETP et par mois" value={fr.hours(w.threshold)} tip={<Def id="seuil" />} />
      </QuestionAnswer>

      {w.hiddenTeams > 0 && (
        <Notice tone="warning" className="mb-4">
          {w.hiddenTeams} équipe(s) non affichée(s) : moins de {MIN_GROUP_SIZE} personnes ou historique insuffisant
        </Notice>
      )}
      {w.teams.length ? (
        single ? (
          <VisualCard
            title="Charge prévue de l'équipe (h)"
            subtitle={`${single.label} · heures sup par ETP · 12 mois observés puis 3 mois prévus · bande grise : fourchette probable à 80 % · tirets : seuil de surcharge`}
            badge={<TensionBadge tension={single.tension} />}
            chart={groupLineChart(single, w.threshold)}
          >
            <CoverageNote cell={teamCoverage} />
          </VisualCard>
        ) : (
          <VisualCard
            title="Charge prévue par équipe (h)"
            subtitle="Heures sup par ETP · 12 mois observés puis 3 mois prévus · trait plein : observé · tirets : prévu · ligne grise : seuil de surcharge"
            footnote={`Fourchette probable à 80 % de chaque équipe : dans « Voir les données »${w.teams.length > multi.length ? ` · ${multi.length} équipes sur ${w.teams.length} tracées` : ""}`}
          >
            <EChart
              height={300}
              format={{ unit: "h", digits: 1 }}
              option={observedForecastOption(
                multi.map((g) => ({ name: g.label, observed: g.observed, forecast: g.forecast })),
                w.threshold,
              )}
              ariaLabel={`Heures supplémentaires par ETP de vos équipes, observées puis prévues. ${fr.count(tension.length, "équipe", "équipes")} en surcharge prévue.`}
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
        <EmptyState title="Aucune équipe affichable" icon="users" />
      )}

      <SectionHeader id="actions" title="Actions proposées" className="mt-8" />
      <div className={`${cardCls} p-4 sm:p-5`}>
        <RecoBoard items={recos} action={updateWorkloadRecoAction} emptyTitle="Aucune action à traiter" />
      </div>

      {w.teams.length > 0 && (
        <>
          <SectionHeader title="Détail" className="mt-8" />
          <section aria-label="Vos équipes">
            <GroupTable groups={w.teams} caption="Heures sup par ETP observées et prévues de vos équipes" />
          </section>
        </>
      )}
    </>
  );
}

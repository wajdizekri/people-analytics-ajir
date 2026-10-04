import Link from "next/link";
import { headers } from "next/headers";
import { ButtonLink, DataTable, EmptyState, KpiTile, Notice, PageHeader, fmt } from "@/components/ui";
import { employeesHref, teamsHref } from "@/components/charts/drill";
import { VisualCard } from "@/components/charts/pbi";
import { InfoTip, PageIntro, TermTip } from "@/components/help";
import { ActiveFilters, FilterForm, buildHref } from "@/components/pilotage/filters";
import { DataDetails } from "@/components/pilotage/data-details";
import { formatDate, formatMonth, formatRate } from "@/components/pilotage/labels";
import { TENSION_HELP, TENSION_LABELS, formatHours } from "@/components/insights/labels";
import { TensionBadge, TensionDot, reasonSentence, tensionReasons } from "@/components/insights/teams";
import { TeamsTreemap, type TreemapTeam } from "@/components/insights/teams-treemap";
import { clientIp } from "@/lib/auth/session";
import { PILOTAGE_ROLES, getContext, pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { TENSION_RULES, getTeams, teamsQuerySchema, type TeamStats, type TensionLevel } from "@/lib/dal/teams";

// Titre d'onglet = libellé du menu, qui dépend du rôle
export async function generateMetadata() {
  const ctx = await getContext();
  return { title: `${ctx?.role === "RH" ? "Équipes" : "Mes équipes"} — People Analytics AJIR` };
}

const LEVELS: TensionLevel[] = ["FORTE", "TENSION", "SURVEILLER", "STABLE"];
const TENSION_RANK: Record<TensionLevel, number> = { FORTE: 3, TENSION: 2, SURVEILLER: 1, STABLE: 0 };
// Au-delà, la carte devient illisible sur un téléphone : le tableau trié la remplace
const MOBILE_MAP_MAX = 30;

function Masked() {
  return (
    <span className="text-xs text-fg-subtle">
      Masqué<span className="sr-only"> : groupe de moins de {MIN_GROUP_SIZE} personnes</span>
    </span>
  );
}

const KPI_LABELS = { FORTE: "Équipes en forte tension", TENSION: "Équipes en tension", SURVEILLER: "Équipes à surveiller" } as const;
const RISK_DOT = { ELEVE: "bg-danger", MOYEN: "bg-warning", FAIBLE: "bg-success" } as const;
const RISK_WORD = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible" } as const;

function RiskCounts({ r }: { r: TeamStats["risk"] }) {
  const parts = (["ELEVE", "MOYEN", "FAIBLE"] as const).filter((l) => r[l] > 0);
  if (!parts.length && !r.nonScored) return <span className="text-xs text-fg-subtle">—</span>;
  return (
    <ul className="space-y-0.5 text-xs text-fg-muted">
      {parts.map((l) => (
        <li key={l} className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${RISK_DOT[l]}`} />
          {RISK_WORD[l]} : <span className="font-semibold tabular-nums text-fg">{r[l]}</span>
        </li>
      ))}
      {r.nonScored > 0 && <li className="whitespace-nowrap pl-3.5 text-fg-subtle">Non évalué : {r.nonScored}</li>}
    </ul>
  );
}

export default async function TeamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const { data: q, ignored } = parseQuery(teamsQuerySchema, await searchParams, "lenient");
  const t = getTeams(ctx, q, { source: "page", ip: clientIp(await headers()) });
  const rh = t.view === "RH";
  const window = `${formatMonth(t.window.months[0])} – ${formatMonth(t.window.months[t.window.months.length - 1])}`;
  const R = TENSION_RULES;
  const refLabel = rh ? "entreprise" : "votre périmètre";
  const ref = { absenteeismRate: t.total.masked ? null : t.total.absenteeismRate, overtimePerHead: t.total.masked ? null : t.total.overtimePerHead };
  const filters = [
    ...(t.filters.departement
      ? [
          {
            label: "Département",
            value: t.departments.find((d) => d.id === t.filters.departement)?.label ?? `n° ${t.filters.departement}`,
            removeHref: buildHref("/equipes", { tension: t.filters.tension ? "oui" : undefined }),
          },
        ]
      : []),
    ...(t.filters.tension ? [{ label: "Équipes", value: "en tension ou à surveiller", removeHref: buildHref("/equipes", { departement: t.filters.departement ?? undefined }) }] : []),
  ];
  // Retour depuis la liste des collaborateurs d'une équipe vers cet écran, filtres conservés (fil d'Ariane de la liste)
  const here = buildHref("/equipes", { departement: t.filters.departement ?? undefined, tension: t.filters.tension ? "oui" : undefined });
  const teamHref = (managerId: number) => employeesHref({ manager: managerId, retour: here });
  const reasons = new Map(t.teams.map((x) => [x.key, reasonSentence(tensionReasons(x, ref, refLabel))]));
  const byDept = new Map<string, TreemapTeam[]>();
  for (const team of t.teams) {
    const list = byDept.get(team.department.name) ?? [];
    list.push({
      name: team.label.replace(/^Équipe de /, ""),
      label: team.label,
      headcount: team.headcount,
      tension: team.tension,
      reason: reasons.get(team.key) ?? "",
      href: team.managerId != null ? teamHref(team.managerId) : undefined,
    });
    byDept.set(team.department.name, list);
  }
  // Filtrage croisé : département de la carte → équipes du département (RH, filtre « Département du manager »)
  const deptHref = (name: string) => {
    const id = t.teams.find((x) => x.department.name === name)?.department.id;
    return rh && !t.filters.departement && id != null ? teamsHref({ departement: id, tension: t.filters.tension ? "oui" : undefined }) : undefined;
  };
  const map = [...byDept].map(([name, teams]) => ({ name, teams, href: deptHref(name) })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const watched = t.tensionCounts.FORTE + t.tensionCounts.TENSION + t.tensionCounts.SURVEILLER;
  const bigMap = t.teams.length > MOBILE_MAP_MAX;
  // Une seule équipe : la carte n'apporte rien, le tableau suffit
  const showMap = t.teams.length > 1;

  return (
    <>
      <PageHeader
        eyebrow="Collaborateurs"
        title={rh ? "Équipes" : "Mes équipes"}
        subtitle={rh ? "Tableau de bord par équipe : signaux de difficulté et niveau de tension." : "Les équipes de votre périmètre hiérarchique : signaux de difficulté et niveau de tension, hors rémunération."}
        scope={`${rh ? "Toute l'entreprise" : "Votre périmètre"} : ${fmt.int(t.totalTeams)} équipe${t.totalTeams > 1 ? "s" : ""}, ${fmt.int(t.total.headcount)} collaborateurs actifs`}
        period={`Données au ${formatDate(t.referenceDate)} · absentéisme et heures sup. sur ${window}`}
        actions={
          <ButtonLink href="/organigramme" variant="secondary" icon="users">
            Voir l&apos;organigramme
          </ButtonLink>
        }
      />
      <PageIntro
        helpHref="/aide#tableau-de-bord"
        points={[
          "Une équipe regroupe les collaborateurs rattachés directement à un même manager.",
          "Cinq signaux sont suivis : risque de départ, absentéisme, heures supplémentaires, formations en retard, recommandations en attente. Plus une équipe en cumule, plus sa tension est forte.",
          rh
            ? "Un clic sur le nom d'une équipe ouvre la liste de ses collaborateurs."
            : `L'absentéisme et les heures supplémentaires d'une équipe de moins de ${MIN_GROUP_SIZE} personnes ne sont pas affichés.`,
        ]}
      >
        Repérer les équipes qui cumulent des signaux de difficulté, pour prioriser les échanges avec leurs managers.
      </PageIntro>
      <FilterForm
        action="/equipes"
        values={{ departement: t.filters.departement ?? undefined, tension: t.filters.tension ? "oui" : undefined }}
        showReset={filters.length > 0}
        fields={[
          ...(rh ? [{ name: "departement", label: "Département du manager", allLabel: "Tous les départements", options: t.departments.map((d) => ({ value: String(d.id), label: d.label })) }] : []),
          { name: "tension", label: "Équipes affichées", allLabel: "Toutes les équipes", options: [{ value: "oui", label: "En tension ou à surveiller" }] },
        ]}
      />
      <ActiveFilters period={`${window} (3 derniers mois)`} filters={filters} ignored={ignored} />
      {t.maskedTeams > 0 && (
        <div className="mb-4">
          <Notice tone="warning">
            {t.maskedTeams} équipe{t.maskedTeams > 1 ? "s" : ""} : absentéisme et heures supplémentaires masqués (moins de {MIN_GROUP_SIZE} personnes, ou déductibles par
            différence avec le total du périmètre). Ces indicateurs ne produisent alors aucun signal.
          </Notice>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
        <KpiTile
          label="Équipes suivies"
          value={fmt.int(t.totalTeams)}
          hint={`${fmt.int(watched)} à regarder · ${fmt.int(t.tensionCounts.STABLE)} stable${t.tensionCounts.STABLE > 1 ? "s" : ""} (aucun signal)`}
          detailHref={!t.filters.tension && watched > 0 ? buildHref("/equipes", { departement: t.filters.departement ?? undefined, tension: "oui" }) : undefined}
          detailLabel="Voir les équipes à regarder"
        />
        {(["FORTE", "TENSION", "SURVEILLER"] as const).map((l) => (
          <KpiTile
            key={l}
            label={KPI_LABELS[l]}
            value={fmt.int(t.tensionCounts[l])}
            hint={
              <span className="inline-flex items-center gap-1.5">
                <TensionDot level={l} />
                {TENSION_HELP[l]}
              </span>
            }
          />
        ))}
        <KpiTile
          label={rh ? "Absentéisme de l'entreprise" : "Absentéisme du périmètre"}
          value={t.total.masked ? "—" : formatRate(t.total.absenteeismRate)}
          hint={t.total.masked ? `Groupe de moins de ${MIN_GROUP_SIZE} personnes` : `Sur 3 mois · heures sup. : ${formatHours(t.total.overtimePerHead)} par personne et par mois`}
        />
      </div>

      {t.teams.length === 0 ? (
        <EmptyState title={t.filters.tension ? "Aucune équipe en tension" : "Aucune équipe dans ce périmètre"}>
          {t.filters.tension ? (
            <>
              Aucune équipe ne cumule de signal sur la période.{" "}
              <Link href={buildHref("/equipes", { departement: t.filters.departement ?? undefined })} className="font-medium text-link underline underline-offset-2 hover:decoration-2">
                Afficher toutes les équipes
              </Link>
              .
            </>
          ) : (
            "Aucun collaborateur actif n'est rattaché à un manager de votre périmètre."
          )}
        </EmptyState>
      ) : (
        <>
          {showMap && (
            <VisualCard
              title={
                watched
                  ? `${fmt.int(watched)} équipe${watched > 1 ? "s" : ""} sur ${fmt.int(t.teams.length)} présente${watched > 1 ? "nt" : ""} au moins un signal de difficulté`
                  : "Aucune équipe ne présente de signal de difficulté"
              }
              subtitle={`Carte des équipes par département du manager · ${window}`}
              className="mb-6"
              actions={
                <InfoTip label="Carte des équipes" align="end">
                  Chaque rectangle est une équipe, regroupée avec les autres équipes de son département. Sa surface est proportionnelle au nombre de collaborateurs actifs ;
                  sa couleur indique le niveau de tension. Survolez un rectangle pour lire la raison.
                </InfoTip>
              }
            >
              <div className="mb-3 rounded-control bg-surface-2 px-3 py-2 text-xs text-fg-muted ring-1 ring-inset ring-line">
                <p className="font-medium text-fg">Comment lire la carte : 1 rectangle = 1 équipe · surface = effectif · couleur = niveau de tension</p>
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {LEVELS.map((l) => (
                    <li key={l} className="inline-flex items-center gap-1.5">
                      <TensionDot level={l} className="h-3 w-3 rounded-sm" />
                      <span className="font-medium text-fg">{TENSION_LABELS[l]}</span> ({TENSION_HELP[l]})
                    </li>
                  ))}
                </ul>
              </div>
              <div className={bigMap ? "hidden sm:block" : ""}>
                <TeamsTreemap
                  departments={map}
                  height={bigMap ? 560 : Math.max(220, Math.min(420, 160 + 28 * t.teams.length))}
                  ariaLabel="Carte des équipes par département, taille selon l'effectif et couleur selon la tension"
                />
              </div>
              {bigMap && (
                <p className="text-xs text-fg-muted sm:hidden">
                  La carte des {fmt.int(t.teams.length)} équipes s&apos;affiche sur un écran plus large. Le tableau ci-dessous donne les mêmes informations, les équipes les plus
                  en tension en premier.
                </p>
              )}
              <DataDetails
                summary="Voir les données de la carte"
                caption="Carte des équipes"
                headers={["Équipe", "Département", "Effectif actif", "Niveau de tension", "Formations en retard", "Recommandations en attente"]}
                rows={t.teams.map((x) => [x.label, x.department.name, fmt.int(x.headcount), TENSION_LABELS[x.tension], fmt.int(x.trainings.overdue), fmt.int(x.openRecommendations)])}
              />
            </VisualCard>
          )}

          <section aria-labelledby="equipes-titre">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <h2 id="equipes-titre" className="flex items-center gap-1 text-lg font-semibold text-heading">
                Équipes triées par niveau de tension
                <InfoTip label="Signaux de tension">
                  Risque : au moins {Math.round(R.riskShare * 100)} % des évalués en risque élevé ou moyen, ou au moins {R.riskHigh} en risque élevé. Absentéisme : au moins{" "}
                  {R.absenteeismRatio.toLocaleString("fr-FR")} fois celui {rh ? "de l'entreprise" : "du périmètre"} et 1 point au-dessus. Heures supplémentaires : au moins{" "}
                  {R.overtimeAbs} h par personne et par mois, ou {R.overtimeRatio.toLocaleString("fr-FR")} fois la référence. Formations : au moins{" "}
                  {Math.round(R.trainingShare * 100)} % de l&apos;équipe avec une formation obligatoire en retard. Recommandations : au moins {R.recoMin} en attente et{" "}
                  {Math.round(R.recoShare * 100)} % de l&apos;effectif.
                </InfoTip>
              </h2>
              <p className="flex flex-wrap items-center gap-x-1 text-xs text-fg-muted">
                Forte tension d&apos;abord, puis nombre de signaux · cliquez sur un en-tête pour trier · absentéisme <TermTip term="absenteisme" role={ctx.role} /> et heures
                sup. sur {window} · risque de départ <TermTip term="niveauRisque" role={ctx.role} align="end" /> au {t.runAsOf ? formatDate(t.runAsOf) : "— (calcul non publié)"}
              </p>
            </div>
            <DataTable
              caption="Équipes triées par niveau de tension, avec la raison du niveau"
              maxHeight="75vh"
              defaultSort={{ key: "tension", dir: "desc" }}
              columns={[
                { key: "team", label: "Équipe", className: "min-w-[12rem]" },
                { key: "tension", label: "Niveau de tension" },
                { key: "why", label: "Pourquoi", sortable: false, hideOnCard: true, className: "min-w-[16rem]" },
                { key: "headcount", label: "Effectif", numeric: true },
                { key: "risk", label: "Risque de départ" },
                { key: "abs", label: "Absentéisme", numeric: true },
                { key: "ot", label: "Heures sup. par pers. / mois", numeric: true },
              ]}
              rows={t.teams.map((x) => ({
                id: x.key,
                // Ligne (et carte) entière cliquable : le clic suit le lien du nom de l'équipe
                rowHref: x.managerId != null ? teamHref(x.managerId) : undefined,
                cells: {
                  team: (
                    <>
                      {x.managerId != null ? (
                        <Link href={teamHref(x.managerId)} className="font-medium text-link underline-offset-2 hover:underline">
                          {x.label}
                        </Link>
                      ) : (
                        <span className="font-medium text-fg">{x.label}</span>
                      )}
                      <span className="block text-xs text-fg-subtle">{x.department.name}</span>
                      {/* Vue en cartes (mobile) : la raison sous le nom, pleine largeur */}
                      <span className={`mt-1 block text-sm sm:hidden ${x.signals.length ? "text-fg" : "text-fg-subtle"}`}>{reasons.get(x.key)}</span>
                    </>
                  ),
                  tension: <TensionBadge level={x.tension} />,
                  why: <span className={`text-sm ${x.signals.length ? "text-fg" : "text-fg-subtle"}`}>{reasons.get(x.key)}</span>,
                  headcount: fmt.int(x.headcount),
                  risk: <RiskCounts r={x.risk} />,
                  abs: x.masked ? <Masked /> : formatRate(x.absenteeismRate),
                  ot: x.masked ? <Masked /> : formatHours(x.overtimePerHead),
                },
                sort: {
                  team: x.label,
                  tension: TENSION_RANK[x.tension] * 10 + x.signals.length,
                  headcount: x.headcount,
                  risk: x.risk.ELEVE * 1000 + x.risk.MOYEN,
                  abs: x.masked ? null : x.absenteeismRate,
                  ot: x.masked ? null : x.overtimePerHead,
                },
              }))}
            />
          </section>
        </>
      )}
      <p className="mt-3 text-xs text-fg-muted">
        Effectif et niveaux de risque : collaborateurs actifs. Absentéisme hors maladie, maternité et congés annuels ; heures supplémentaires pointées rapportées aux
        personnes présentes chaque mois ; formations obligatoires dont l&apos;échéance est dépassée sans être terminées.
      </p>
    </>
  );
}

import { Suspense } from "react";
import { headers } from "next/headers";
import { Badge, ButtonLink, DataTable, EmptyState, Icon, Notice, PageHeader, RiskBadge, SectionHeader, StatusBadge, cardCls, fmt } from "@/components/ui";
import { KpiCard } from "@/components/charts/pbi";
import { InfoTip, TermTip } from "@/components/help";
import { StatementList } from "@/components/insights/ui";
import { formatHours } from "@/components/insights/labels";
import { formatDate, formatMonth, formatRate } from "@/components/pilotage/labels";
import { clientIp } from "@/lib/auth/session";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { getSynthesis, type PersonChange } from "@/lib/dal/synthesis";
import { countDelta, rateDelta } from "@/app/(app)/dashboard/messages";
import { PrintButton } from "@/components/export/print-button";
import { PrintHeader } from "@/components/export/print-header";
import { draftNarrative, factsFromSynthesis } from "@/lib/ai/narrative";
import { narrativeAiConfig } from "@/lib/ai/narrative/generative";
import { AiNarrative, NarrativeBox } from "./narrative";

export const metadata = { title: "Synthèse du mois — People Analytics AJIR" };

const REASON: Record<PersonChange["reason"], string> = {
  HAUSSE: "Niveau en hausse",
  BAISSE: "Niveau abaissé",
  SORTI: "Sorti de l'entreprise",
  NON_EVALUE: "N'est plus évalué",
};
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const LEVEL_RANK = { ELEVE: 3, MOYEN: 2, FAIBLE: 1 } as const;
const rank = (l: PersonChange["before"]) => (l ? LEVEL_RANK[l] : 0);

// Liste nominative (DataTable : tri, pagination, cartes sous 640 px) ; ordre initial fourni par la DAL
function PeopleTable({ id, title, rows, showReason }: { id: string; title: string; rows: PersonChange[]; showReason: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-6">
      <h3 id={`${id}-titre`} className="mb-3 text-base font-semibold text-heading">
        {title} <span className="font-normal tabular-nums text-fg-muted">({fmt.int(rows.length)})</span>
      </h3>
      <DataTable
        caption={title}
        pageSize={10}
        maxHeight={false}
        empty={<EmptyState compact title="Aucun collaborateur concerné" />}
        columns={[
          { key: "name", label: "Collaborateur" },
          { key: "matricule", label: "Matricule" },
          { key: "department", label: "Département" },
          { key: "levels", label: "Niveau de risque : avant → maintenant" },
          ...(showReason ? [{ key: "reason", label: "Motif" }] : []),
        ]}
        rows={rows.map((p) => ({
          id: p.id,
          // Retour contextuel : le fil d'Ariane de la fiche ramène à cette liste de la synthèse
          href: `/employees/${p.id}?retour=${encodeURIComponent(`/synthese#${id}`)}`,
          cells: {
            name: p.name,
            matricule: p.matricule,
            department: p.department ?? "—",
            levels: (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <RiskBadge level={p.before} compact />
                <Icon name="arrow-right" className="h-3.5 w-3.5 text-fg-subtle" />
                <span className="sr-only">puis</span>
                <RiskBadge level={p.after} compact />
              </span>
            ),
            reason: <span className="text-fg-muted">{REASON[p.reason]}</span>,
          },
          sort: { name: p.name, matricule: p.matricule, department: p.department, levels: rank(p.before) * 10 + rank(p.after), reason: REASON[p.reason] },
        }))}
      />
    </section>
  );
}

export default async function SynthesisPage() {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const meta = { source: "page" as const, ip: clientIp(await headers()) };
  const s = getSynthesis(ctx, meta);
  const draft = draftNarrative(factsFromSynthesis(s, MIN_GROUP_SIZE));
  const rh = s.view === "RH";
  const k = s.kpis;
  const M = formatMonth(s.month);
  const P = formatMonth(s.previousMonth);
  const vs = `vs ${P}`;
  const masked = `Masqué : moins de ${MIN_GROUP_SIZE} personnes`;
  // Résumé exécutif : d'abord ce qui demande une action, puis les chiffres, puis le reste
  const priority = s.statements.filter((x) => x.tone === "alerte" || x.tone === "attention");
  const others = s.statements.filter((x) => x.tone === "info" || x.tone === "positif");
  const previousHigh = k.high != null && k.newHigh != null && k.leftHigh != null ? k.high - k.newHigh + k.leftHigh : null;

  return (
    <>
      <PrintHeader title="Synthèse du mois" dataDate={s.referenceDate} login={ctx.login} role={ctx.role} scope={rh ? "Toute l'entreprise" : "Votre équipe (périmètre hiérarchique)"} />
      <PageHeader
        title="Synthèse du mois"
        badge={
          s.smallPopulation || !rh ? (
            <span className="inline-flex items-center gap-1">
              {s.smallPopulation ? <StatusBadge tone="warning">Données masquées : petit groupe</StatusBadge> : <Badge>Petits groupes masqués</Badge>}
              <TermTip term="petitsGroupes" role={ctx.role} />
            </span>
          ) : undefined
        }
        scope={rh ? "Toute l'entreprise" : "Votre équipe (périmètre hiérarchique)"}
        period={`${capitalize(s.previous ? `${M} comparé à ${P}` : M)} · données au ${formatDate(s.referenceDate)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <PrintButton label="Imprimer la synthèse" />
            <ButtonLink href="/dashboard" variant="secondary" iconEnd="arrow-right">
              Ouvrir le tableau de bord
            </ButtonLink>
          </div>
        }
      />
      {!s.current && <Notice className="mb-4">Aucun calcul de risque publié</Notice>}

      <div className="space-y-8">
        {narrativeAiConfig() ? (
          <Suspense fallback={<NarrativeBox narrative={draft} pending />}>
            <AiNarrative ctx={ctx} synthesis={s} meta={meta} />
          </Suspense>
        ) : (
          <NarrativeBox narrative={draft} />
        )}

        <section aria-labelledby="priorites-titre" className={`${cardCls} p-4 sm:p-5`}>
          <SectionHeader
            id="priorites-titre"
            title={`À traiter en priorité (${fmt.int(priority.length)})`}
            tip={
              <InfoTip label="Constats du mois">
                Phrases rédigées automatiquement à partir des données AJIR et des calculs publiés, entre la fin de {P} et le{" "}
                {formatDate(s.current?.asOf ?? s.referenceDate)}. Un niveau de risque est une estimation, pas une certitude.
              </InfoTip>
            }
          />
          {priority.length ? (
            <StatementList items={priority} />
          ) : (
            <p className="flex items-start gap-2 rounded-control bg-success-soft px-3 py-2.5 text-sm text-fg">
              <Icon name="success" className="mt-0.5 h-4 w-4 text-success" />
              Rien d&apos;urgent ce mois-ci
            </p>
          )}
        </section>

        <section aria-labelledby="chiffres-titre">
          <SectionHeader
            id="chiffres-titre"
            title="Chiffres clés"
            description={`${capitalize(M)} vs ${P}, données au ${formatDate(s.referenceDate)}. Effectif, entrées et sorties hors stages et SIVP ; absentéisme hors maladie, maternité et congés annuels ; heures supplémentaires pointées rapportées aux personnes présentes dans le mois. Aucune probabilité ni rémunération sur cette page.`}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Collaborateurs en risque élevé"
              value={k.high == null ? "—" : fmt.int(k.high)}
              delta={k.high != null && previousHigh != null ? countDelta(previousHigh, k.high, vs, "down") : null}
              hint={k.newHigh == null || k.leftHigh == null ? "Aucun calcul précédent" : `Entrés : ${fmt.int(k.newHigh)} · Sortis : ${fmt.int(k.leftHigh)}`}
              href={k.high ? "/employees?niveau=ELEVE&retour=%2Fsynthese" : undefined}
              linkLabel={k.high && k.high > 1 ? `Voir les ${fmt.int(k.high)} collaborateurs` : "Voir la liste"}
              tip={<TermTip term="niveauEleve" role={ctx.role} align="end" />}
            />
            <KpiCard
              label={`Effectif fin ${M}`}
              value={fmt.int(k.headcount.now)}
              delta={countDelta(k.headcount.before, k.headcount.now, `vs fin ${P}`, "neutral")}
              hint={`Entrées : ${fmt.int(k.entries)} · ${k.exits == null ? "Sorties masquées" : `Sorties : ${fmt.int(k.exits)} (volontaires : ${fmt.int(k.voluntaryExits ?? 0)})`}`}
              href="/employees?retour=%2Fsynthese"
              linkLabel="Voir la liste (tous contrats)"
              tip={<TermTip term="effectif" role={ctx.role} align="end" />}
            />
            <KpiCard
              label={`Absentéisme hors santé, ${M}`}
              value={formatRate(k.absenteeism.now)}
              delta={rateDelta(k.absenteeism.before, k.absenteeism.now, vs, "down")}
              hint={k.absenteeism.now == null ? masked : `${P} : ${formatRate(k.absenteeism.before)}`}
              href="/absenteeism?granularite=mois"
              linkLabel="Analyser l'absentéisme"
              tip={<TermTip term="absenteisme" role={ctx.role} align="end" />}
            />
            <KpiCard
              label={`Heures supplémentaires par personne, ${M}`}
              value={formatHours(k.overtime.now)}
              delta={k.overtime.now == null || k.overtime.before == null ? null : countDelta(k.overtime.before, k.overtime.now, vs, "down", " h", 1)}
              hint={k.overtime.now == null ? masked : `${P} : ${formatHours(k.overtime.before)}`}
              href="/charge"
              linkLabel="Analyser la charge de travail"
            />
            <KpiCard
              label="Alertes à traiter"
              value={fmt.int(k.alerts.open)}
              hint={`Critiques : ${fmt.int(k.alerts.critical)}${k.alerts.sincePrevious != null ? ` · Nouvelles : ${fmt.int(k.alerts.sincePrevious)}` : ""}`}
              status={k.alerts.critical ? { tone: "critique", label: "Critique" } : undefined}
              href={k.alerts.open > 0 ? "/alerts?status=NOUVELLE" : undefined}
              linkLabel="Traiter les alertes"
            />
            <KpiCard
              label={rh ? "Recommandations à décider" : "Recommandations en cours"}
              value={fmt.int(k.recommendations.open)}
              hint={k.recommendations.sincePrevious != null ? `Nouvelles : ${fmt.int(k.recommendations.sincePrevious)}` : undefined}
              href={rh && k.recommendations.open > 0 ? "/recommendations?statut=PROPOSEE" : undefined}
              linkLabel="Décider des recommandations"
            />
            <KpiCard
              label="Formations obligatoires en retard"
              value={fmt.int(k.trainingsOverdue.total)}
              hint={`Nouvelles : ${fmt.int(k.trainingsOverdue.thisMonth)}`}
              href={k.trainingsOverdue.total > 0 ? "/formations" : undefined}
              linkLabel="Voir les formations en retard"
              tip={<TermTip term="formationsObligatoires" role={ctx.role} align="end" />}
            />
          </div>
        </section>

        {others.length > 0 && (
          <section aria-labelledby="autres-constats-titre" className={`${cardCls} p-4 sm:p-5`}>
            <SectionHeader id="autres-constats-titre" title="Autres constats" />
            <StatementList items={others} variant="compact" />
          </section>
        )}
        {s.statements.length === 0 && (
          <EmptyState title="Aucun constat pour ce mois" />
        )}

        {s.previous && (
          <section aria-labelledby="mouvements-titre">
            <SectionHeader id="mouvements-titre" title="Mouvements du niveau Élevé" actions={rh ? <Badge>Consultation tracée</Badge> : undefined} />
            <div className="space-y-4">
              <PeopleTable
                id="nouveaux-eleves"
                title="Passés en risque élevé"
                rows={s.newHigh}
                showReason={false}
              />
              <PeopleTable
                id="sortis-du-risque"
                title="Sortis du risque élevé"
                rows={s.leftHigh}
                showReason
              />
            </div>
          </section>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import {
  cardCls,
  DataTable,
  EmptyState,
  fmt,
  PageHeader,
  QuestionAnswer,
  RiskBadge,
  SectionHeader,
  type DataTableColumn,
  type DataTableRow,
} from "@/components/ui";
import { KpiCard, VisualCard } from "@/components/charts/pbi";
import { TrainingRecoBoard } from "@/components/ai/training/reco-status-form";
import { PARTS, stackedCounts } from "@/components/ai/training/chart";
import { Def, ReadingGuide, capitalize, fr, type Answer } from "@/components/ai/workload/insight-kit";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { getTrainingOverview, type TrainingOverview, type TrainingRecoRow } from "@/lib/dal/ai-training";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import { updateTrainingRecoAction } from "./actions";

export const metadata = { title: "Formations obligatoires — People Analytics AJIR" };

const days = (n: number) => `${n} jour${Math.abs(n) > 1 ? "s" : ""}`;
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const linkCls = "font-medium text-link underline underline-offset-2 transition-[text-decoration-thickness] hover:decoration-2";
const LEVEL_RANK: Record<string, number> = { ELEVE: 3, MOYEN: 2, FAIBLE: 1 };
const OVERDUE_COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Collaborateur" },
  { key: "title", label: "Formation" },
  { key: "due", label: "Échéance" },
  { key: "late", label: "Retard", numeric: true },
];
// Fiche du collaborateur (RH, et manager pour sa hiérarchie : même périmètre que ces listes), retour à la section d'origine
const ficheHref = (id: number, anchor: string) => `/employees/${id}?retour=${encodeURIComponent(`/formations#${anchor}`)}`;
const person = (href: string, name: string, matricule: string, extra?: string | null) => (
  <>
    <Link href={href} className={linkCls}>
      {name}
    </Link>
    <span className="block text-xs text-fg-subtle">
      {matricule}
      {extra !== undefined ? ` · ${extra ?? "—"}` : ""}
    </span>
  </>
);
const dueCell = (date: string, daysToDue: number) => (
  <span className="whitespace-nowrap tabular-nums">
    {fmt.date(date)}
    <span className="block text-xs text-fg-subtle">dans {days(daysToDue)}</span>
  </span>
);

// Mois d'échéance qui concentrent les formations à risque (deux au plus, dans l'ordre du calendrier)
function peakMonths(upcoming: TrainingOverview["upcoming"]) {
  const top = [...upcoming]
    .filter((u) => u.atRisk > 0)
    .sort((a, b) => b.atRisk - a.atRisk)
    .slice(0, 2)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!top.length) return null;
  const sameYear = top.length === 2 && top[0].month.slice(0, 4) === top[1].month.slice(0, 4);
  const label =
    top.length === 1
      ? fr.monthLong(top[0].month)
      : sameYear
        ? `${fr.monthOnly(top[0].month)} et ${fr.monthLong(top[1].month)}`
        : `${fr.monthLong(top[0].month)} et ${fr.monthLong(top[1].month)}`;
  return { label, count: top.reduce((s, u) => s + u.atRisk, 0), single: top.length === 1 };
}

function verdictOf(o: TrainingOverview): Answer {
  const k = o.kpis;
  const atRisk = k.high + k.medium;
  const late = k.overdue ? ` ${fr.count(k.overdue, "formation est", "formations sont")} déjà en retard.` : "";
  const peak = peakMonths(o.upcoming);
  const when = peak ? ` ${peak.count} ${plural(peak.count, "arrive", "arrivent")} à échéance en ${peak.label}.` : "";
  if (!o.asOf) return { tone: "neutre", label: "Pas d'estimation", text: `Le risque n'est pas encore calculé : il apparaît après le calcul mensuel.${late}` };
  if (k.high)
    return {
      tone: "critique",
      label: "Relances urgentes",
      text: `${fr.count(atRisk, "formation risque", "formations risquent")} de ne pas être terminée${atRisk > 1 ? "s" : ""} à temps, dont ${k.high} à risque élevé.${when}${late}`,
    };
  if (k.medium)
    return {
      tone: "attention",
      label: "Relances à prévoir",
      text: `${fr.count(k.medium, "formation est", "formations sont")} à risque moyen de dépasser l'échéance.${when}${late}`,
    };
  if (k.overdue)
    return { tone: "attention", label: "Retards à rattraper", text: `Aucune formation à venir n'est à risque, mais${late.replace(/^ /, " ").toLowerCase()}` };
  return { tone: "bon", label: "Dans les temps", text: "Aucune formation obligatoire ne risque d'être en retard d'après l'estimation du mois." };
}

function recoItems(rows: TrainingRecoRow[], rh: boolean) {
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    priority: r.priority,
    title: r.title,
    rationale: r.rationale,
    scopeLabel: r.scope === "SALARIE" ? "Relance individuelle" : "Équipe",
    target: rh ? r.target : null,
    createdOn: fmt.date(r.createdAt),
    updatedOn: r.updatedAt ? fmt.date(r.updatedAt) : null,
    comment: r.comment,
    allowed: (["PROPOSEE", "REALISEE", "REJETEE"] as const).filter((s) => s !== r.status),
  }));
}

export default async function FormationsPage() {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const o = getTrainingOverview(ctx);
  const rh = o.view === "RH";
  const k = o.kpis;
  const atRisk = k.high + k.medium;
  const upcomingAtRisk = o.upcoming.reduce((s, u) => s + u.atRisk, 0);
  const peak = peakMonths(o.upcoming);
  const scope = o.view === "RH" ? "Toute l'entreprise" : `Votre équipe (${fmt.int(o.teamSize)} collaborateurs)`;

  // Répartition par mois d'échéance : élevé / moyen séparés quand la liste des formations à risque est complète
  const complete = o.atRisk.length === atRisk;
  const highByMonth = new Map<string, number>();
  for (const r of o.atRisk) if (r.level === "ELEVE") highByMonth.set(r.dueDate.slice(0, 7), (highByMonth.get(r.dueDate.slice(0, 7)) ?? 0) + 1);
  const monthChart = o.upcoming.length
    ? stackedCounts({
        rows: o.upcoming.map((u) => {
          const high = complete ? Math.min(u.atRisk, highByMonth.get(u.month) ?? 0) : 0;
          return { name: capitalize(fr.monthLong(u.month)), values: complete ? [high, u.atRisk - high, u.total - u.atRisk] : [u.atRisk, u.total - u.atRisk] };
        }),
        parts: complete ? [PARTS.eleve, PARTS.moyen, PARTS.faible] : [PARTS.aRisque, PARTS.faible],
        categoryName: "Mois d'échéance",
        measure: "Formations obligatoires non terminées",
        keepOrder: true,
      })
    : null;

  // Où relancer : par département (RH) ou par intitulé de formation (manager)
  const groupKey = (r: TrainingOverview["atRisk"][number]) =>
    o.view === "RH" ? ((r as { department: string | null }).department ?? "Sans département") : r.title;
  const byGroup = new Map<string, [number, number]>();
  for (const r of o.atRisk) {
    const g = byGroup.get(groupKey(r)) ?? [0, 0];
    g[r.level === "ELEVE" ? 0 : 1]++;
    byGroup.set(groupKey(r), g);
  }
  const groups = [...byGroup.entries()]
    .map(([name, v]) => ({ name, values: v, total: v[0] + v[1] }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "fr"));
  const groupChart =
    groups.length >= 1
      ? stackedCounts({
          rows: groups,
          parts: [PARTS.eleve, PARTS.moyen],
          categoryName: rh ? "Département" : "Formation",
          measure: "Formations à risque de dépasser l'échéance",
        })
      : null;

  // Tableaux du détail (DataTable : tri, pagination, cartes sous 640 px) ; le manager ne voit ni probabilité ni facteur détaillé
  const riskColumns: DataTableColumn[] = [
    { key: "name", label: "Collaborateur" },
    { key: "title", label: "Formation" },
    { key: "due", label: "Échéance" },
    { key: "level", label: "Niveau de risque" },
    ...(rh ? [{ key: "prob", label: "Probabilité estimée", numeric: true }] : []),
    { key: "factors", label: rh ? "Principaux facteurs" : "Catégories de facteurs", cardBlock: true, className: "min-w-56 text-xs text-fg-muted" },
  ];
  const riskRows: DataTableRow[] =
    o.view === "RH"
      ? o.atRisk.map((r) => ({
          id: r.trainingId,
          rowHref: ficheHref(r.employee.id, "a-risque"),
          cells: {
            name: person(ficheHref(r.employee.id, "a-risque"), r.employee.name, r.employee.matricule, r.department),
            title: r.title,
            due: dueCell(r.dueDate, r.daysToDue),
            level: <RiskBadge level={r.level} compact />,
            prob: fmt.pct(r.prob, 0),
            factors:
              r.factors
                .slice(0, 2)
                .map((f) => f.phrase)
                .join(" · ") || "—",
          },
          sort: { name: r.employee.name, title: r.title, due: r.dueDate, level: LEVEL_RANK[r.level], prob: r.prob },
        }))
      : o.atRisk.map((r) => ({
          id: r.trainingId,
          rowHref: ficheHref(r.employee.id, "a-risque"),
          cells: {
            name: person(ficheHref(r.employee.id, "a-risque"), r.employee.name, r.employee.matricule),
            title: r.title,
            due: dueCell(r.dueDate, r.daysToDue),
            level: <RiskBadge level={r.level} compact />,
            factors: r.factors.join(" · ") || "—",
          },
          sort: { name: r.employee.name, title: r.title, due: r.dueDate, level: LEVEL_RANK[r.level] },
        }));

  return (
    <>
      <PageHeader
        title="Formations obligatoires"
        subtitle="Anticiper les formations obligatoires qui risquent de ne pas être terminées à temps, et relancer les bonnes personnes."
        scope={scope}
        period={`Données au ${fmt.date(o.dataEnd)} · échéances des ${o.horizonDays} prochains jours`}
      />

      <QuestionAnswer
        id="reponse-formations"
        question="Quelles formations risquent d'être en retard ?"
        verdict={verdictOf(o)}
        scope={`${scope} · formations obligatoires planifiées ou en cours · estimation du ${fmt.date(o.asOf)}.`}
        method={
          <>
            Chaque mois, un modèle statistique estime pour chaque formation obligatoire ouverte le risque qu&apos;elle ne soit pas terminée à son échéance
            (échéance proche, formation non commencée, historique de la personne…). Élevé ou Moyen : une relance est conseillée. C&apos;est une estimation, pas
            un constat.
          </>
        }
      >
        <KpiCard
          label="Formations à risque"
          period="estimation du mois"
          value={fmt.int(atRisk)}
          status={
            k.high
              ? { tone: "critique", label: `${k.high} à risque élevé` }
              : k.medium
                ? { tone: "attention", label: "Risque moyen" }
                : { tone: "bon", label: "Aucune" }
          }
          hint={`${fmt.int(k.high)} à risque élevé · ${fmt.int(k.medium)} à risque moyen`}
          detailHref={atRisk ? "#a-risque" : undefined}
          detailLabel="Voir la liste"
          tip={<Def id="risqueFormation" />}
        />
        <KpiCard
          label="Déjà en retard"
          period={`au ${fmt.date(o.dataEnd)}`}
          value={fmt.int(k.overdue)}
          status={k.overdue ? { tone: "attention", label: "À rattraper" } : { tone: "bon", label: "Aucune" }}
          hint="Échéance dépassée, formation non terminée"
          detailHref={k.overdue ? "#retards" : undefined}
          detailLabel="Voir la liste"
          tip={<Def id="retard" />}
        />
        <KpiCard
          label="Échéances à venir"
          period={`dans les ${o.horizonDays} prochains jours`}
          value={fmt.int(k.upcoming)}
          hint={`dont ${fmt.int(upcomingAtRisk)} à risque`}
        />
        <KpiCard
          label="Réalisées à l'échéance"
          period="12 derniers mois"
          value={k.masked ? "—" : fmt.pct(k.onTimeRate)}
          hint={
            k.masked
              ? `Non affiché : équipe de moins de ${MIN_GROUP_SIZE} personnes`
              : `${fmt.int(k.dueLast12)} formations échues · terminées même en retard : ${fmt.pct(k.doneRate)}`
          }
          tip={<Def id="realisation" />}
        />
      </QuestionAnswer>

      <div className="grid gap-4 xl:grid-cols-2">
        <VisualCard
          title={
            peak
              ? `${capitalize(peak.label)} ${peak.single ? "concentre" : "concentrent"} ${peak.count} des ${upcomingAtRisk} formations à risque`
              : o.upcoming.length
                ? "Aucune échéance à venir n'est à risque"
                : "Aucune échéance dans les prochains mois"
          }
          subtitle={`Formations obligatoires non terminées, par mois d'échéance (nombre) · ${scope} · échéances des ${o.horizonDays} prochains jours · ${complete ? "rouge : risque élevé · ambre : moyen · " : "ambre : à risque · "}gris : risque faible`}
          chart={monthChart ?? undefined}
        >
          {!monthChart && <EmptyState title="Aucune échéance dans les prochains mois" icon="calendar" compact />}
        </VisualCard>
        <VisualCard
          title={
            groups.length
              ? rh
                ? `${groups[0].name} : le plus de formations à risque (${groups[0].total})`
                : `« ${groups[0].name} » : ${fr.count(groups[0].total, "formation", "formations")} à risque`
              : "Aucune formation à risque"
          }
          subtitle={`Formations à risque de dépasser l'échéance, par ${rh ? "département" : "intitulé"} (nombre) · ${scope}${o.asOf ? ` · estimation du ${fmt.date(o.asOf)}` : ""} · rouge : élevé · ambre : moyen`}
          chart={groupChart ?? undefined}
        >
          {!groupChart && (
            <EmptyState title="Aucune formation à risque moyen ou élevé" icon="success" compact>
              {o.asOf ? "L'estimation du mois ne signale aucune formation à relancer." : "Le risque est estimé après le calcul mensuel."}
            </EmptyState>
          )}
        </VisualCard>
      </div>

      <SectionHeader
        id="actions"
        title="Que faire ?"
        description={
          rh
            ? "Relances proposées pour les formations à risque élevé, et actions d'équipe."
            : "Recommandations pour votre équipe quand plusieurs formations sont à risque."
        }
        className="mt-8"
      />
      <div className={`${cardCls} p-4 sm:p-5`}>
        <TrainingRecoBoard
          items={recoItems(o.recommendations, rh)}
          action={updateTrainingRecoAction}
          emptyTitle="Aucune relance à traiter"
          emptyText={
            rh
              ? "Les relances sont proposées après le calcul mensuel pour les formations à risque élevé."
              : "Une recommandation vous est proposée quand plusieurs formations de votre équipe sont à risque."
          }
        />
      </div>

      <SectionHeader title="Détail" description="Formations à risque, puis formations déjà en retard." className="mt-8" />
      <section id="a-risque" aria-labelledby="a-risque-titre" className="scroll-mt-4">
        <SectionHeader
          id="a-risque-titre"
          level={3}
          title={`Formations à risque de dépasser l'échéance (${fmt.int(atRisk)})`}
          tip={<Def id="risqueFormation" align="start" />}
          description={
            o.atRisk.length > 1
              ? `De la plus urgente à la moins urgente${complete ? "" : ` : les ${fmt.int(o.atRisk.length)} premières sont listées`}. Cliquez sur une ligne pour ouvrir la fiche.`
              : undefined
          }
        />
        {!o.asOf ? (
          <EmptyState title="Aucune estimation disponible" icon="chart" compact>
            Le risque est calculé chaque mois, une fois le modèle « formation » mis en service. La mise en service se fait hors de l&apos;interface, par une procédure tracée.
          </EmptyState>
        ) : (
          <DataTable
            columns={riskColumns}
            rows={riskRows}
            pageSize={10}
            caption="Formations obligatoires ouvertes à risque moyen ou élevé, de la plus urgente à la moins urgente"
            empty={<EmptyState title="Aucune formation à risque moyen ou élevé" icon="success" compact />}
          />
        )}
      </section>

      <section id="retards" aria-labelledby="retards-titre" className="mt-8 scroll-mt-4">
        <SectionHeader
          id="retards-titre"
          level={3}
          title={`Formations déjà en retard (${fmt.int(k.overdue)})`}
          tip={<Def id="retard" align="start" />}
          description={o.overdue.length < k.overdue ? `Les ${fmt.int(o.overdue.length)} plus anciennes sont listées.` : undefined}
        />
        <DataTable
          columns={OVERDUE_COLUMNS}
          pageSize={10}
          rows={o.overdue.map((r) => ({
            id: r.trainingId,
            rowHref: ficheHref(r.employee.id, "retards"),
            cells: { name: person(ficheHref(r.employee.id, "retards"), r.employee.name, r.employee.matricule), title: r.title, due: fmt.date(r.dueDate), late: days(r.daysLate) },
            sort: { name: r.employee.name, title: r.title, due: r.dueDate, late: r.daysLate },
          }))}
          caption="Formations obligatoires dont l'échéance est dépassée, de la plus ancienne à la plus récente"
          empty={<EmptyState title="Aucune formation obligatoire en retard" icon="success" compact />}
        />
      </section>

      <ReadingGuide helpHref="/aide">
        <li>Seules les formations obligatoires planifiées ou en cours, avec une échéance, sont suivies.</li>
        <li>
          Le niveau de risque est une estimation statistique{o.asOf ? ` au ${fmt.date(o.asOf)}` : ""}
          {o.view === "RH" && o.modelVersion ? ` (${fmt.model(o.modelVersion)})` : ""} : il sert à prioriser les relances, ce n&apos;est pas un constat.
        </li>
        <li>Une formation terminée en retard compte comme réalisée, mais pas comme réalisée à l&apos;échéance.</li>
        {!rh && <li>Le taux de réalisation n&apos;est pas affiché pour une équipe de moins de {MIN_GROUP_SIZE} personnes.</li>}
      </ReadingGuide>
    </>
  );
}

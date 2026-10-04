import Form from "next/form";
import Link from "next/link";
import { headers } from "next/headers";
import { Button, DataTable, EmptyState, Icon, KpiTile, Notice, PageHeader, RiskBadge, StatusBadge, cardCls, fieldCls, fmt, tableCls } from "@/components/ui";
import { VisualCard, barChart } from "@/components/charts/pbi";
import { buildHref } from "@/components/pilotage/filters";
import { formatDate, formatMonth, formatProb, formatRate } from "@/components/pilotage/labels";
import { gainChart, resignationTimelineChart } from "@/components/monitoring/model-options";
import { Disclosure } from "@/components/monitoring/disclosure";
import { clientIp } from "@/lib/auth/session";
import { backtestQuerySchema, getBacktest, type BacktestDto, type BacktestPerson } from "@/lib/dal/backtest";
import { pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { InfoTip, PageIntro, TermTip } from "@/components/help";

export const metadata = { title: "Vérification a posteriori (backtesting) — People Analytics AJIR" };

const dec = (n: number, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const months = (days: number | null) => (days == null ? "—" : `${dec(days / 30.44)} mois`);
const people = (n: number) => `${fmt.int(n)} personne${n > 1 ? "s" : ""}`;
const resignations = (n: number) => `${fmt.int(n)} démission${n > 1 ? "s" : ""}`;
const upperFirst = (s: string) => s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1);

type Result = NonNullable<BacktestDto["result"]>;
type Row = { key: string; label: string; flagged: number; hits: number; precision: number | null; recall: number | null; lift: number | null; delay: number | null };

// Groupes Élevé, Moyen, Élevé ou Moyen (calculés par la DAL) et Faible (le reste des collaborateurs évalués)
function groupRows(r: Result): Row[] {
  const [eleve, moyen, both] = r.groups;
  const faibleN = r.n - both.flagged;
  const faibleRate = faibleN ? r.missedPositives / faibleN : null;
  const row = (key: string, label: string, g: Result["groups"][number]): Row => ({
    key,
    label,
    flagged: g.flagged,
    hits: g.hits,
    precision: g.precision,
    recall: g.recall,
    lift: g.lift,
    delay: g.meanDelayDays,
  });
  return [
    row("ELEVE", "Classés Élevé", eleve),
    row("MOYEN", "Classés Moyen", moyen),
    row("ELEVE_MOYEN", "Élevé ou Moyen", both),
    {
      key: "FAIBLE",
      label: "Classés Faible",
      flagged: faibleN,
      hits: r.missedPositives,
      precision: faibleRate,
      recall: r.positives ? r.missedPositives / r.positives : null,
      lift: faibleRate != null && r.baseRate ? faibleRate / r.baseRate : null,
      delay: null,
    },
  ];
}

function PeopleTable({ list, asOf, here, b0, caption }: { list: BacktestPerson[]; asOf: string; here: string; b0: boolean; caption: string }) {
  const score = (s: number) => (b0 ? `${dec(s, 0)} point${s > 1 ? "s" : ""}` : formatProb(s));
  return (
    <DataTable
      caption={caption}
      pageSize={25}
      maxHeight={false}
      defaultSort={{ key: "rang", dir: "asc" }}
      columns={[
        { key: "nom", label: "Collaborateur" },
        { key: "rang", label: "Rang", numeric: true },
        { key: "departement", label: "Département" },
        { key: "niveau", label: "Niveau de risque", sortable: false },
        { key: "score", label: b0 ? "Score à règles" : "Probabilité à 6 mois", numeric: true },
        { key: "demission", label: "Démission dans les 6 mois" },
      ]}
      rows={list.map((p) => {
        const dated = p.resigned && p.eventDate && p.eventDate > asOf;
        return {
          id: p.id,
          cells: {
            nom: (
              <>
                <Link
                  href={buildHref(`/employees/${p.id}`, { retour: here })}
                  className="inline-flex min-h-8 items-center font-medium text-link underline-offset-2 transition-colors hover:text-fg hover:underline"
                >
                  {p.name}
                </Link>
                <span className="block font-mono text-xs text-fg-subtle">{p.matricule}</span>
              </>
            ),
            rang: p.rank,
            departement: p.department ?? "—",
            niveau: <RiskBadge level={p.level} compact />,
            score: score(p.score),
            demission: !p.resigned ? (
              <span className="text-fg-muted">Non</span>
            ) : dated ? (
              <span className="inline-flex flex-col items-end gap-0.5 sm:items-start">
                <StatusBadge tone="warning">Oui, le {formatDate(p.eventDate)}</StatusBadge>
                <span className="text-xs text-fg-muted">{months(p.delayDays)} après</span>
              </span>
            ) : (
              <StatusBadge tone="warning">Oui (date de démission non renseignée)</StatusBadge>
            ),
          },
          sort: { nom: p.name, rang: p.rank, departement: p.department, score: p.score, demission: p.resigned ? (p.eventDate ?? "9999") : "" },
        };
      })}
    />
  );
}

export default async function BacktestingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(["RH"]);
  const { data: q, ignored } = parseQuery(backtestQuerySchema, await searchParams, "lenient");
  const b = getBacktest(ctx, q, { source: "page", ip: clientIp(await headers()) });
  const r = b.result;
  const b0 = b.model?.kind === "B0";
  const here = buildHref("/backtesting", { mois: r?.asOf.slice(0, 7) });
  const trainTo = b.model?.trainTo?.slice(0, 7) ?? null;
  const afterTraining = trainTo ? b.months.filter((m) => m.month > trainTo) : [];
  const presets = b.months.length
    ? [
        { label: "Dernière date possible", month: b.months[0].month },
        { label: "Un an plus tôt", month: b.months.find((m) => m.month <= `${Number(b.months[0].month.slice(0, 4)) - 1}${b.months[0].month.slice(4)}`)?.month },
        { label: "Deux ans plus tôt", month: b.months.find((m) => m.month <= `${Number(b.months[0].month.slice(0, 4)) - 2}${b.months[0].month.slice(4)}`)?.month },
      ].filter((p): p is { label: string; month: string } => !!p.month)
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Données et modèle"
        title="Vérification a posteriori (backtesting)"
        subtitle="Le modèle aurait-il repéré les démissions ? Le calcul est rejoué à une date passée, puis comparé aux démissions des 6 mois suivants."
      />
      <PageIntro
        helpHref="/aide#modele"
        points={[
          "Choisissez une date d'origine : seules les fins de mois suivies pendant 6 mois complets sont proposées.",
          "Le résultat mesure l'exposition au risque signalée à cette date, pas l'effet des actions menées ensuite.",
        ]}
      >
        Vérifier après coup si les niveaux de risque d&apos;une date passée ont repéré les démissions des 6 mois suivants.
      </PageIntro>
      {(ignored.length > 0 || b.requestedUnavailable) && (
        <div className="mb-4 space-y-2">
          {ignored.length > 0 && <Notice tone="warning">Paramètre ignoré car invalide : {ignored.join(", ")}.</Notice>}
          {b.requestedUnavailable && (
            <Notice tone="warning">La date demandée n&apos;a pas 6 mois de suivi complet ou pas de variables calculées. La dernière date possible est affichée.</Notice>
          )}
        </div>
      )}

      {!b.model ? (
        <EmptyState title="Aucun modèle en service">
          La vérification a posteriori est impossible sans modèle en service. Voir{" "}
          <Link href="/transparency" className="font-medium text-link underline underline-offset-2">
            Transparence du modèle
          </Link>
          .
        </EmptyState>
      ) : b.months.length === 0 || !r ? (
        <EmptyState title="Aucune date avec un suivi complet de 6 mois">
          Il faut des variables calculées pour une fin de mois antérieure d&apos;au moins 6 mois à la fin des données.
          {b.dataEndDate ? ` Fin des données : ${formatDate(b.dataEndDate)}.` : ""}
        </EmptyState>
      ) : (
        <ResultView b={b} r={r} b0={b0} here={here} role={ctx.role} presets={presets} afterTraining={afterTraining.length} trainTo={trainTo} />
      )}
    </>
  );
}

function ResultView({
  b,
  r,
  b0,
  here,
  role,
  presets,
  afterTraining,
  trainTo,
}: {
  b: BacktestDto;
  r: Result;
  b0: boolean;
  here: string;
  role: "RH" | "ADMIN" | "MANAGER";
  presets: { label: string; month: string }[];
  afterTraining: number;
  trainTo: string | null;
}) {
  const rows = groupRows(r);
  const [eleve, moyen, both, faible] = rows;
  const current = r.asOf.slice(0, 7);
  const eleveList = r.people.filter((p) => p.level === "ELEVE");
  const otherList = r.people.filter((p) => p.level !== "ELEVE");
  const origin = formatDate(r.asOf);
  const pct = (rate: number | null) => (rate != null ? Math.round(rate * 1000) / 10 : null);
  const capacity = eleve.flagged > 0 && eleve.recall != null && r.n > 0 ? { share: eleve.flagged / r.n, captured: eleve.recall } : null;
  const monthTotals = r.byMonth.map((m) => m.levels.ELEVE + m.levels.MOYEN + m.levels.FAIBLE);
  const dated = monthTotals.reduce((s, n) => s + n, 0);
  const firstHalf = monthTotals.slice(0, 3).reduce((s, n) => s + n, 0);
  return (
    <>
      <section className={`${cardCls} mb-4 p-4`} aria-labelledby="choix-date">
        <h2 id="choix-date" className="text-base font-semibold text-heading">
          Choisir la date d&apos;origine
        </h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          Le modèle est rejoué sur les données connues à cette fin de mois. Les démissions sont comptées sur les 6 mois suivants.
        </p>
        <Form action="/backtesting" className="mt-3 flex flex-wrap items-end gap-3" aria-label="Choix de la date d'origine">
          <div className="min-w-[14rem]">
            <label htmlFor="f-mois" className="flex items-center gap-1 text-sm font-medium text-fg">
              Date d&apos;origine (fin de mois)
            </label>
            <select
              id="f-mois"
              name="mois"
              defaultValue={current}
              className={`mt-1 ${fieldCls}`}
            >
              {b.months.map((m) => (
                <option key={m.month} value={m.month}>
                  {formatMonth(m.month)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="primary" icon="search">
            Afficher la vérification
          </Button>
          <TermTip term="dateOrigine" role={role} />
        </Form>
        {presets.length > 1 && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-semibold text-fg-muted">Raccourcis :</span>
            {presets.map((p) => (
              <Link
                key={p.label}
                href={buildHref("/backtesting", { mois: p.month })}
                aria-current={p.month === current ? "true" : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-200 active:translate-y-px ${
                  p.month === current ? "border-primary bg-primary-soft font-medium text-link" : "border-line-strong bg-surface text-fg-muted hover:border-primary hover:bg-primary-soft hover:text-fg"
                }`}
              >
                {p.month === current && <Icon name="check" className="h-3.5 w-3.5" />}
                {p.label} ({formatMonth(p.month)})
              </Link>
            ))}
          </p>
        )}
        {!b0 && trainTo && (
          <p className="mt-2 text-xs text-fg-muted">
            {afterTraining
              ? `${afterTraining} date${afterTraining > 1 ? "s" : ""} postérieure${afterTraining > 1 ? "s" : ""} à l'apprentissage du modèle (après ${formatMonth(trainTo)}) : ce sont les résultats les plus fiables.`
              : `Toutes les dates proposées font partie de la période d'apprentissage du modèle (jusqu'à ${formatMonth(trainTo)}) : les résultats sont optimistes.`}
          </p>
        )}
      </section>

      <section className={`${cardCls} mb-4 border-l-4 border-l-primary p-4`} aria-labelledby="resultat-titre">
        <h2 id="resultat-titre" className="text-sm font-semibold text-link">
          Résultat au {origin}
        </h2>
        <p className="mt-1 text-base font-semibold text-heading sm:text-lg">
          À cette date, le modèle aurait signalé {people(eleve.flagged)} au niveau Élevé ; {fmt.int(eleve.hits)} {eleve.hits > 1 ? "ont" : "a"} démissionné dans les 6 mois.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
          {eleve.precision != null && r.baseRate != null && (
            <li>
              Soit {formatRate(eleve.precision)} des personnes signalées, contre {formatRate(r.baseRate)} pour l&apos;ensemble des {fmt.int(r.n)} collaborateurs évalués.
              {eleve.lift != null ? ` C'est ${dec(eleve.lift)} fois plus que la moyenne.` : ""}
            </li>
          )}
          <li>
            En ajoutant le niveau Moyen ({people(moyen.flagged)}) : {resignations(both.hits)} parmi les {people(both.flagged)} signalées.
          </li>
          <li>
            Les {resignations(r.missedPositives)} restante{r.missedPositives > 1 ? "s" : ""} concernaient des collaborateurs classés Faible. Le modèle aide à prioriser ; il
            ne repère pas tous les départs.
          </li>
        </ul>
        <p className="mt-2 text-xs text-fg-muted">
          {upperFirst(fmt.model(b.model!.version, b.model!.promotedAt))} ;{" "}
          {r.source === "RUN" ? "niveaux du calcul enregistré pour ce mois" : "niveaux recalculés sur les variables du mois avec les paramètres de décision actuels"}. Ce
          résultat mesure l&apos;exposition au risque signalée à la date d&apos;origine, sans tenir compte des actions menées entre-temps. Ce n&apos;est pas une mesure de
          l&apos;effet d&apos;une intervention.
        </p>
        {b0 && (
          <div className="mt-3">
            <Notice>
              Le modèle en service est un score à règles (B0). Ses règles sont fixées à l&apos;avance, sans apprentissage sur les données. Le score est un nombre de
              points, pas une probabilité.
            </Notice>
          </div>
        )}
        {!b0 && r.seenInTraining === true && (
          <div className="mt-3">
            <Notice tone="warning">
              <strong>Date vue pendant l&apos;apprentissage : résultat optimiste.</strong> Ce mois fait partie de la période d&apos;apprentissage du modèle (
              {formatDate(b.model!.trainFrom)} au {formatDate(b.model!.trainTo)}).
            </Notice>
          </div>
        )}
        {!b0 && r.seenInTraining === null && (
          <div className="mt-3">
            <Notice tone="warning">Période d&apos;apprentissage non renseignée dans le fichier du modèle : impossible de savoir si ce mois a été vu à l&apos;apprentissage.</Notice>
          </div>
        )}
      </section>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          tip={<TermTip term="dateOrigine" role={role} align="end" />}
          label="Collaborateurs évalués (suivi complet)"
          value={fmt.int(r.n)}
          hint={`à la date d'origine (${origin})`}
        />
        <KpiTile
          tip={<TermTip term="tauxBase" role={role} align="end" />}
          label="Démissions dans les 6 mois"
          value={fmt.int(r.positives)}
          hint={`Soit ${formatRate(r.baseRate)} des collaborateurs évalués`}
        />
        <KpiTile
          tip={<TermTip term="precision" role={role} align="end" />}
          label="Précision au niveau Élevé"
          value={formatRate(eleve.precision)}
          hint={`${resignations(eleve.hits)} parmi les ${fmt.int(eleve.flagged)} classés Élevé`}
        />
        <KpiTile
          tip={<TermTip term="liftCapacite" role={role} align="end" />}
          label="Lift au niveau Élevé"
          value={eleve.lift != null ? `${dec(eleve.lift)} ×` : "—"}
          hint={`fois le taux moyen (${formatRate(r.baseRate)})`}
        />
        <KpiTile
          tip={<TermTip term="rappel" role={role} align="end" />}
          label="Rappel au niveau Élevé"
          value={formatRate(eleve.recall)}
          hint={`${fmt.int(eleve.hits)} des ${resignations(r.positives)} repérée${eleve.hits > 1 ? "s" : ""}`}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VisualCard
          title={
            eleve.lift != null
              ? `Les classés Élevé ont démissionné ${dec(eleve.lift)} fois plus que la moyenne`
              : "Part ayant démissionné dans les 6 mois, par niveau de risque"
          }
          subtitle={`Part des collaborateurs de chaque niveau qui ont démissionné dans les 6 mois suivant le ${origin} (%)`}
          chart={barChart({
            rows: [
              { name: `Élevé (${fmt.int(eleve.hits)} sur ${fmt.int(eleve.flagged)})`, value: pct(eleve.precision), tone: "defavorable" },
              { name: `Moyen (${fmt.int(moyen.hits)} sur ${fmt.int(moyen.flagged)})`, value: pct(moyen.precision), tone: "attention" },
              { name: `Faible (${fmt.int(faible.hits)} sur ${fmt.int(faible.flagged)})`, value: pct(faible.precision), tone: "favorable" },
              { name: `Ensemble (${fmt.int(r.positives)} sur ${fmt.int(r.n)})`, value: pct(r.baseRate), tone: "reference" },
            ],
            sort: "none",
            measure: "Part ayant démissionné dans les 6 mois",
            unit: "%",
            categoryName: "Groupe",
            height: 260,
          })}
        />
        <VisualCard
          title={
            capacity
              ? `En contactant ${formatRate(capacity.share)} des collaborateurs, on repère ${formatRate(capacity.captured)} des démissions`
              : "Démissions repérées selon la part de collaborateurs contactés"
          }
          subtitle="Part des démissions des 6 mois repérées (%), en contactant les collaborateurs par ordre de risque · trait gris : tirage au hasard"
          chart={r.gain.length ? { ...gainChart(r.gain, capacity), height: 260, mobileHeight: 280 } : undefined}
        >
          {!r.gain.length && <EmptyState compact title="Aucune démission sur la période">La courbe apparaît dès qu&apos;une démission est observée dans les 6 mois.</EmptyState>}
        </VisualCard>
        <VisualCard
          className="lg:col-span-2"
          title={
            dated > 0
              ? `${fmt.int(firstHalf)} des ${resignations(dated)} datées surviennent dans les 3 premiers mois`
              : "Aucune démission datée dans les 6 mois"
          }
          subtitle={`Démissions de chaque mois après le ${origin}, selon le niveau de risque à cette date`}
          actions={
            <InfoTip label="Pourquoi si peu de démissions repérées ?" align="end">
              Le niveau Élevé est limité par la capacité d&apos;entretiens RH (2 % par défaut) : il sert à choisir qui rencontrer en priorité. La plupart des démissions
              viennent donc de collaborateurs classés Faible, beaucoup plus nombreux.
            </InfoTip>
          }
          chart={dated > 0 ? { ...resignationTimelineChart(r.byMonth, r.byMonth.map((m) => fmt.month(m.month, { short: true }))), height: 240, mobileHeight: 260 } : undefined}
          footnote={
            r.undated > 0
              ? `${resignations(r.undated)} sans date connue ne figure${r.undated > 1 ? "nt" : ""} pas dans ce visuel.`
              : undefined
          }
        />
      </div>

      <div className={`${cardCls} relative mb-6 overflow-x-auto`} tabIndex={0} role="region" aria-label="Exposition au risque et démissions observées (zone défilante)">
        <table className={tableCls.table}>
          <caption className="px-4 pt-4 pb-2 text-left text-[15px] font-semibold text-fg">Exposition au risque et démissions observées</caption>
          <thead className={tableCls.thead}>
            <tr>
              <th scope="col" className={tableCls.th}>Groupe</th>
              <th scope="col" className={`${tableCls.th} text-right`}>Collaborateurs</th>
              <th scope="col" className={`${tableCls.th} text-right`}>Démissions à 6 mois</th>
              <th scope="col" className={`${tableCls.th} text-right`}>
                Précision
                <span className="block font-normal normal-case tracking-normal">part ayant démissionné</span>
              </th>
              <th scope="col" className={`${tableCls.th} text-right`}>
                Rappel
                <span className="block font-normal normal-case tracking-normal">part des démissions repérées</span>
              </th>
              <th scope="col" className={`${tableCls.th} text-right`}>
                Lift
                <span className="block font-normal normal-case tracking-normal">fois la moyenne</span>
              </th>
              <th scope="col" className={`${tableCls.th} text-right`}>Délai moyen avant démission</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className={`${tableCls.tr} ${g.key === "ELEVE_MOYEN" ? "font-medium" : ""}`}>
                <th scope="row" className={`${tableCls.td} font-normal`}>{g.label}</th>
                <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.int(g.flagged)}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.int(g.hits)}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{formatRate(g.precision)}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{formatRate(g.recall)}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{g.lift != null ? `${dec(g.lift)} ×` : "—"}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{months(g.delay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-3 text-xs text-fg-muted">
          Moyenne de référence : {formatRate(r.baseRate)} de démissions parmi les {fmt.int(r.n)} collaborateurs évalués. Précision, rappel et lift sont définis dans
          l&apos;aide (bulles « ? »).
        </p>
      </div>

      <section aria-labelledby="personnes-titre">
        <h2 id="personnes-titre" className="text-lg font-semibold text-heading">
          Collaborateurs signalés au {origin}
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-fg-muted">
          Liste nominative réservée à la RH, par rang. La dernière colonne signale les démissions survenues dans les 6 mois, avec leur date.
        </p>
        {r.people.length === 0 ? (
          <EmptyState title="Aucun collaborateur classé Élevé ou Moyen à cette date">Choisissez une autre date d&apos;origine ci-dessus.</EmptyState>
        ) : (
          <div className="space-y-3">
            {eleveList.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-fg">
                  Classés Élevé ({fmt.int(eleveList.length)}, dont {resignations(eleve.hits)})
                </h3>
                <PeopleTable list={eleveList} asOf={r.asOf} here={here} b0={b0} caption="Collaborateurs classés Élevé et démissions observées" />
              </>
            )}
            {otherList.length > 0 && (
              <Disclosure bodyClassName="p-3" summary={`Voir aussi les ${fmt.int(otherList.length)} collaborateurs classés Moyen (dont ${resignations(moyen.hits)})`}>
                <PeopleTable list={otherList} asOf={r.asOf} here={here} b0={b0} caption="Collaborateurs classés Moyen et démissions observées" />
              </Disclosure>
            )}
          </div>
        )}
      </section>
    </>
  );
}

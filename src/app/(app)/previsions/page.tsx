import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, StatusBadge, cardCls, fmt, tableCls } from "@/components/ui";
import { VisualCard } from "@/components/charts/pbi";
import { InfoTip } from "@/components/help";
import { DataDetails } from "@/components/pilotage/data-details";
import { SERIES, monthShort, type Band, type Point } from "@/components/ai/workforce/chart-options";
import { ProjectionChart, ProjectionLegend } from "@/components/ai/workforce/projection-chart";
import { WorkforceRecoStatusForm } from "@/components/ai/workforce/reco-status-form";
import { WorkforceScenarioForm } from "@/components/ai/workforce/scenario-form";
import { CoverageNote } from "@/components/ai/conformal/coverage-note";
import { readConformal } from "@/lib/ai/conformal";
import { getWorkforceForecast, workforceScenarioSchema, type WorkforceDeptRow, type WorkforceReco } from "@/lib/dal/ai-workforce";
import { pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { updateWorkforceRecoAction } from "./actions";

export const metadata = { title: "Prévisions effectifs — People Analytics AJIR" };

const NBSP = " ";
const dec = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
// Effectifs et flux projetés = moyennes attendues : arrondis à l'unité, « moins de 1 » plutôt que 0 quand la valeur n'est pas nulle
const people = (v: number | null | undefined) => (v == null ? "—" : v > 0 && v < 0.5 ? "moins de 1" : fmt.int(v));
const signedPct = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${dec(Math.abs(r) * 100)}${NBSP}%`;
const signedInt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt.int(Math.abs(v))}`;
const PRIORITY = {
  1: { label: "Priorité haute", tone: "red", bar: "border-l-danger" },
  2: { label: "Priorité moyenne", tone: "amber", bar: "border-l-warning" },
  3: { label: "Priorité basse", tone: "slate", bar: "border-l-line-strong" },
} as const;
const STATUS = { PROPOSEE: { label: "En attente de décision", tone: "sky" }, REALISEE: { label: "Réalisée", tone: "emerald" }, REJETEE: { label: "Rejetée", tone: "slate" } } as const;
const TOPIC = { EFFECTIF: "Effectif", MASSE_SALARIALE: "Masse salariale" } as const;
// Paramètres d'adresse refusés : nom en clair et valeurs admises (message « ce qui s'est passé + comment corriger »)
const PARAM_HELP: Record<string, string> = {
  embauches: "rythme des embauches (de 0 à 300 %)",
  hausse: "hausse générale de janvier (de 0 à 30 %)",
  budget: "budget annuel de masse salariale (montant en TND, supérieur à 0)",
  departement: "département des graphiques (à choisir dans la liste)",
};
const SHOWN_RECOS = 4;
// « Voir les données » : toutes les séries du graphique (observé, projection, fourchette, scénario de référence si simulé)
const chartHeaders = (simulated: boolean) => [
  "Mois",
  SERIES.observed,
  SERIES.projected,
  `${SERIES.band} : basse`,
  `${SERIES.band} : haute`,
  ...(simulated ? [SERIES.reference] : []),
];
function chartRows(observed: Point[], projected: Band[], reference: Band[] | null, f: (v: number) => string): string[][] {
  const ref = new Map((reference ?? []).map((p) => [p.month, p.value]));
  const refCell = (m: string) => (reference ? [ref.has(m) ? f(ref.get(m)!) : "—"] : []);
  return [
    ...observed.map((p) => [monthShort(p.month), f(p.value), "—", "—", "—", ...refCell("")]),
    ...projected.map((p) => [monthShort(p.month), "—", f(p.value), f(p.lower), f(p.upper), ...refCell(p.month)]),
  ];
}
const thR = `${tableCls.th} ${tableCls.num}`;
const tdR = `${tableCls.td} ${tableCls.num}`;
const sub = "block text-xs font-normal text-fg-subtle";
// Dépliant secondaire (même apparence que « Voir les données »)
const summaryCls =
  "inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control px-1 text-[13px] font-medium text-link transition-colors duration-200 hover:bg-primary-soft hover:underline [&::-webkit-details-marker]:hidden";
function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 5l5 5-5 5" />
    </svg>
  );
}

function DeptRow({ r, total = false }: { r: WorkforceDeptRow; total?: boolean }) {
  const exits = r.exits12.resign + r.exits12.other + r.exits12.cdd + r.exits12.retire + r.exits12.known;
  return (
    <tr className={`${tableCls.tr} ${total ? "border-t-2 border-line bg-surface-2 font-semibold" : ""}`}>
      <th scope="row" className={`${tableCls.td} ${total ? "" : "font-normal"}`}>
        {total ? (
          "Toute l'entreprise"
        ) : (
          <>
            <span className="font-medium">{r.name}</span> <span className="text-xs text-fg-subtle">({r.code})</span>
          </>
        )}
      </th>
      <td className={tdR}>{fmt.int(r.hc0)}</td>
      <td className={tdR}>
        {people(r.hc12)}
        <span className={sub}>
          {fmt.int(r.lower12)} – {fmt.int(r.upper12)}
        </span>
      </td>
      <td className={tdR}>
        {people(exits)}
        <span className={sub}>dont {people(r.exits12.resign)} démission{r.exits12.resign >= 1.5 ? "s" : ""}</span>
      </td>
      <td className={tdR}>{people(r.hires12)}</td>
      <td className={tdR}>
        {fmt.tnd(r.mass12)}
        {r.mass12 != null && r.mass0 ? <span className={sub}>{signedPct(r.mass12 / r.mass0 - 1)} sur 12 mois</span> : null}
      </td>
    </tr>
  );
}

// Vue mobile du tableau par département : mêmes valeurs, une carte par ligne
function DeptCard({ r, total = false }: { r: WorkforceDeptRow; total?: boolean }) {
  const exits = r.exits12.resign + r.exits12.other + r.exits12.cdd + r.exits12.retire + r.exits12.known;
  return (
    <li className={`px-4 py-3 ${total ? "bg-surface-2" : ""}`}>
      <p className="text-sm font-semibold text-fg">
        {total ? "Toute l'entreprise" : r.name} {!total && <span className="text-xs font-normal text-fg-subtle">({r.code})</span>}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-fg-muted">Effectif : aujourd&apos;hui → dans 12 mois</dt>
          <dd className="text-sm tabular-nums text-fg">
            {fmt.int(r.hc0)} → <strong className="font-semibold">{people(r.hc12)}</strong>
            <span className={sub}>
              fourchette {fmt.int(r.lower12)} – {fmt.int(r.upper12)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Masse mensuelle dans 12 mois</dt>
          <dd className="text-sm tabular-nums text-fg">
            {fmt.tnd(r.mass12)}
            {r.mass12 != null && r.mass0 ? <span className={sub}>{signedPct(r.mass12 / r.mass0 - 1)} sur 12 mois</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Sorties attendues</dt>
          <dd className="text-sm tabular-nums text-fg">
            {people(exits)}
            <span className={sub}>dont {people(r.exits12.resign)} démission{r.exits12.resign >= 1.5 ? "s" : ""}</span>
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Embauches prévues</dt>
          <dd className="text-sm tabular-nums text-fg">{people(r.hires12)}</dd>
        </div>
      </dl>
    </li>
  );
}

function RecoItem({ r }: { r: WorkforceReco }) {
  const p = PRIORITY[(r.priority as 1 | 2 | 3) ?? 2] ?? PRIORITY[2];
  const open = r.status === "PROPOSEE";
  return (
    <li
      className={`rounded-control border border-line border-l-4 bg-surface p-4 transition duration-200 hover:border-line-strong/60 hover:shadow-card focus-within:border-line-strong/60 focus-within:shadow-card ${open ? p.bar : "border-l-line"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {open && <Badge tone={p.tone}>{p.label}</Badge>}
        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
        <span className="text-xs text-fg-muted">
          {TOPIC[r.topic]} · {r.department ?? "Toute l'entreprise"}
        </span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug text-heading">{r.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">Pourquoi : </span>
        {r.rationale}
      </p>
      {r.comment && <p className="mt-1.5 text-xs text-fg-muted">Commentaire : {r.comment}</p>}
      <WorkforceRecoStatusForm id={r.id} title={r.title} status={r.status} action={updateWorkforceRecoAction} />
    </li>
  );
}

export default async function PrevisionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(["RH"]);
  const { data: q, ignored } = parseQuery(workforceScenarioSchema, await searchParams, "lenient");
  const v = getWorkforceForecast(ctx, q);
  const header = (asOf?: string, end?: string) => (
    <PageHeader
      eyebrow="Analyses"
      title="Prévisions effectifs"
      badge={<StatusBadge tone="info">Projection indicative</StatusBadge>}
      scope="Toute l'entreprise et par département"
      period={asOf ? `Données au ${fmt.date(asOf)} · projection jusqu'en ${end}` : undefined}
    />
  );
  if (v.status === "NO_MODEL")
    return (
      <>
        {header()}
        <EmptyState title="Aucune projection disponible" />
      </>
    );
  if (v.status === "NO_FORECAST")
    return (
      <>
        {header()}
        <EmptyState title="Projection pas encore calculée" />
      </>
    );

  const t = v.total;
  const H = v.months.length;
  const end = monthShort(v.months[H - 1]);
  const now = monthShort(v.asOf.slice(0, 7));
  const exits12 = t.exits12.resign + t.exits12.other + t.exits12.cdd + t.exits12.retire + t.exits12.known;
  const massChange = t.mass12 != null && t.mass0 ? t.mass12 / t.mass0 - 1 : null;
  const sc = v.scenario;
  const s = v.focus.series;
  const raiseText = `hausse de janvier ${dec(sc.raisePct)}${NBSP}%${Math.abs(sc.raisePct - sc.raiseDefaultPct) < 1e-9 ? " (observée)" : ""}`;
  const scenarioLabel = sc.isReference ? "scénario de référence" : `scénario simulé : embauches à ${dec(sc.hiringPct, 0)} % du rythme, ${raiseText}`;
  const baseHires12 = sc.hiringPct > 0 ? (t.hires12 * 100) / sc.hiringPct : null;
  const b = v.budget;
  const focusName = v.focus.departmentId ? v.focus.label : "Toute l'entreprise";
  const focusSuffix = v.focus.departmentId ? `, ${v.focus.label}` : "";
  const open = v.recommendations.filter((r) => r.status === "PROPOSEE");
  const decided = v.recommendations.filter((r) => r.status !== "PROPOSEE");
  // Couverture mesurée des fourchettes (versions calibrées) : source des démissions et niveau (entreprise ou département) affichés
  const level = v.focus.departmentId ? "dept" : "total";
  const coverageFor = (version: string | null) => {
    const c = readConformal("workforce", version)?.coverage;
    return c?.[`${v.resignSource}:${level}`] ?? c?.[`TAUX:${level}`] ?? null;
  };
  const coverageNote = sc.isReference ? undefined : "Mesure faite pour le scénario de référence.";

  return (
    <>
      {header(v.asOf, end)}
      <div className="space-y-6">
        {ignored.length > 0 && (
          <Notice tone="warning" title={`Hypothèse${ignored.length > 1 ? "s" : ""} non prise${ignored.length > 1 ? "s" : ""} en compte`}>
            Valeur{ignored.length > 1 ? "s" : ""} invalide{ignored.length > 1 ? "s" : ""} pour : {ignored.map((k) => PARAM_HELP[k] ?? k).join(" ; ")}. Le scénario de
            référence est utilisé pour ce{ignored.length > 1 ? "s" : "t"} élément{ignored.length > 1 ? "s" : ""}. Corrigez la valeur dans « Simulation de
            scénario », puis cliquez sur « Recalculer la projection ».
          </Notice>
        )}

        <section aria-labelledby="en-bref" className={`${cardCls} border-l-4 border-l-primary p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="en-bref" className="flex items-center gap-1 text-base font-semibold text-heading">
              Projection à 12 mois
              <InfoTip label="Projection indicative" prefix="Détails" align="start">
                Fondée sur les tendances des 12 à 24 derniers mois : ni un engagement, ni un objectif. Elle porte sur des effectifs agrégés et ne fonde aucune
                décision individuelle.
              </InfoTip>
            </h2>
            <span className="text-[13px] text-fg-muted">Toute l&apos;entreprise · {sc.isReference ? "scénario de référence" : "scénario simulé"}</span>
          </div>
          <dl className="mt-3 grid gap-4 border-t border-line pt-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
            <div className="sm:pr-5">
              <dt className="text-xs font-medium text-fg-muted">Effectif prévu en {end}</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-heading">
                {people(t.hc12)} <span className="text-sm font-normal text-fg-muted">collaborateurs</span>
              </dd>
              <dd className="mt-0.5 text-xs text-fg-muted">
                {signedInt(t.hc12 - t.hc0)} vs aujourd&apos;hui ({fmt.int(t.hc0)}) · fourchette probable à 80{NBSP}% : {fmt.int(t.lower12)} – {fmt.int(t.upper12)}
              </dd>
            </div>
            <div className="sm:px-5">
              <dt className="text-xs font-medium text-fg-muted">Masse salariale brute mensuelle en {end}</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-heading">{t.mass12 != null ? fmt.tnd(t.mass12) : "—"}</dd>
              <dd className="mt-0.5 text-xs text-fg-muted">
                {massChange != null ? `${signedPct(massChange)} vs ${now} (${fmt.tnd(t.mass0)}) · ${raiseText}` : "Non projetée"}
              </dd>
            </div>
            <div className="sm:pl-5">
              <dt className="text-xs font-medium text-fg-muted">Mouvements sur 12 mois</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-heading">
                {people(exits12)} <span className="text-sm font-normal text-fg-muted">sorties</span> · {people(t.hires12)}{" "}
                <span className="text-sm font-normal text-fg-muted">embauches</span>
              </dd>
              <dd className="mt-0.5 text-xs text-fg-muted">
                Démissions {people(t.exits12.resign)} · fins de CDD {people(t.exits12.cdd)} · retraites {people(t.exits12.retire)} · autres{" "}
                {people(t.exits12.other + t.exits12.known)} · embauches à {dec(sc.hiringPct, 0)}
                {NBSP}% du rythme
              </dd>
            </div>
          </dl>
        </section>

        {!sc.isReference && (
          <Notice
            title="Scénario simulé"
            action={
              <ButtonLink href="/previsions" variant="secondary" size="sm">
                Revenir au scénario de référence
              </ButtonLink>
            }
          >
            Embauches à {dec(sc.hiringPct, 0)}
            {NBSP}% du rythme · {raiseText}
          </Notice>
        )}

        {b && (
          <Notice
            tone={b.gap > 0.02 ? "error" : b.gap < -0.02 ? "info" : "warning"}
            title={`Budget ${b.year} : ${
              b.gap > 0.005 ? `dépassement de ${dec(b.gap * 100)}${NBSP}%` : b.gap < -0.005 ? `marge de ${dec(-b.gap * 100)}${NBSP}%` : "conforme"
            }`}
          >
            Budget {v.scenario.budgetFromSettings ? "paramétré" : "saisi"} : {fmt.tnd(b.amount)} · masse projetée sur l&apos;année : {fmt.tnd(b.observed + b.projected)}{" "}
            (dont {b.observedMonths} mois réalisés : {fmt.tnd(b.observed)}) · fourchette probable : {fmt.tnd(b.observed + b.projectedLower)} –{" "}
            {fmt.tnd(b.observed + b.projectedUpper)}
          </Notice>
        )}

        <Card title="Simulation de scénario">
          <WorkforceScenarioForm
            key={JSON.stringify(q)}
            values={q}
            raiseDefaultPct={sc.raiseDefaultPct}
            budgetYear={sc.budgetYear}
            departments={v.departmentOptions}
            baseHires12={baseHires12}
          />
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <VisualCard
            title={`Projection de l'effectif${focusSuffix}`}
            subtitle={`Effectif de fin de mois · ${focusName} · ${s.observedHc.length} mois observés puis 12 mois projetés · ${scenarioLabel}`}
          >
            <ProjectionLegend observedMonths={s.observedHc.length} simulated={!sc.isReference} />
            <ProjectionChart
              observed={s.observedHc}
              projected={s.hc}
              reference={sc.isReference ? null : s.referenceHc}
              unit="collaborateurs"
              axisName="Collaborateurs"
              ariaLabel={`Effectif observé et projeté à 12 mois, ${v.focus.label}`}
            />
            <DataDetails
              summary="Voir les données du graphique"
              caption={`Effectif observé et projeté par mois, ${v.focus.label}`}
              headers={chartHeaders(!sc.isReference)}
              rows={chartRows(s.observedHc, s.hc, sc.isReference ? null : s.referenceHc, (x) => fmt.int(x))}
              numeric
            />
            <CoverageNote cell={coverageFor(v.models.effectif)} note={coverageNote} />
          </VisualCard>
          <VisualCard
            title={`Projection de la masse salariale${focusSuffix}`}
            subtitle={`Masse salariale brute mensuelle (milliers de TND) · ${focusName} · ${s.observedMass.length} mois observés puis 12 mois projetés · hausse générale en janvier`}
          >
            {s.mass ? (
              <>
                <ProjectionLegend observedMonths={s.observedMass.length} simulated={!sc.isReference} />
                <ProjectionChart
                  observed={s.observedMass}
                  projected={s.mass}
                  reference={sc.isReference ? null : s.referenceMass}
                  divisor={1000}
                  unit="TND"
                  axisName="Milliers de TND"
                  ariaLabel={`Masse salariale brute observée et projetée à 12 mois, ${v.focus.label}`}
                />
                <DataDetails
                  summary="Voir les données du graphique"
                  caption={`Masse salariale observée et projetée par mois, ${v.focus.label}`}
                  headers={chartHeaders(!sc.isReference)}
                  rows={chartRows(s.observedMass, s.mass, sc.isReference ? null : s.referenceMass, (x) => fmt.tnd(x))}
                  numeric
                />
                <CoverageNote cell={coverageFor(v.models.masse)} note={coverageNote} />
              </>
            ) : (
              <EmptyState title="Masse salariale non projetée" compact />
            )}
          </VisualCard>
        </div>

        <section aria-labelledby="par-departement" className={`${cardCls} overflow-hidden`}>
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
            <h2 id="par-departement" className="flex items-center gap-1 text-base font-semibold text-heading">
              Projection par département
              <InfoTip label="Méthode de projection" prefix="Détails" align="start">
                Sorties et embauches : moyennes attendues sur 12 mois, arrondies à l&apos;unité. Démissions :{" "}
                {v.resignSource === "LOGREG"
                  ? "probabilités de démission publiées par le modèle de risque de départ."
                  : "taux observé dans le département sur les 24 derniers mois."}{" "}
                Fins de CDD : contrats arrivant à terme × part non renouvelée observée ({dec(v.params.qCdd * 100)}
                {NBSP}%). Retraites : âge de 60 ans ({dec(v.params.qRet * 100, 0)}
                {NBSP}% de départs observés à cet âge). Masse salariale : salaires actuels, hausse générale de janvier et dérive mensuelle de{" "}
                {dec(v.params.driftPct, 2)}
                {NBSP}% (promotions). Fourchettes à 80 % calibrées sur les erreurs passées des modèles {v.models.effectif}
                {v.models.masse ? ` et ${v.models.masse}` : ""}.
              </InfoTip>
            </h2>
            <p className="text-xs text-fg-muted">Dans 12 mois ({end}) · valeurs arrondies · {scenarioLabel}</p>
          </div>
          {/* Mobile : une carte par département ; à partir de 640 px : tableau */}
          <ul className="divide-y divide-line sm:hidden">
            {[...v.departments, t].map((r) => (
              <DeptCard key={r === t ? "total" : r.id} r={r} total={r === t} />
            ))}
          </ul>
          <div className={`${tableCls.wrap} hidden sm:block`} tabIndex={0} role="region" aria-labelledby="par-departement">
            <table className={tableCls.table}>
              <caption className="sr-only">Effectif, sorties, embauches et masse salariale projetés à 12 mois par département</caption>
              <thead className={tableCls.thead}>
                <tr>
                  <th scope="col" className={tableCls.th}>Département</th>
                  <th scope="col" className={thR}>Effectif aujourd&apos;hui</th>
                  <th scope="col" className={thR}>Effectif dans 12 mois (fourchette)</th>
                  <th scope="col" className={thR}>Sorties attendues</th>
                  <th scope="col" className={thR}>Embauches prévues</th>
                  <th scope="col" className={thR}>Masse mensuelle dans 12 mois</th>
                </tr>
              </thead>
              <tbody>
                {v.departments.map((r) => (
                  <DeptRow key={r.id} r={r} />
                ))}
                <DeptRow r={t} total />
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-4 py-2 sm:px-5">
            <DataDetails
              summary="Voir les sorties par motif"
              caption="Sorties attendues sur 12 mois par motif et par département"
              headers={["Département", "Démissions", "Fins de CDD", "Retraites", "Autres sorties"]}
              rows={[...v.departments, t].map((r) => [
                r.id === 0 ? "Toute l'entreprise" : r.name,
                people(r.exits12.resign),
                people(r.exits12.cdd),
                people(r.exits12.retire),
                people(r.exits12.other + r.exits12.known),
              ])}
              numeric
            />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section aria-labelledby="recos-rh" className={`${cardCls} min-w-0 p-4 sm:p-5 xl:col-span-2`}>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2 id="recos-rh" className="flex items-center gap-1 text-base font-semibold text-heading">
                Recommandations RH
                <InfoTip label="Recommandations RH" align="start">
                  Pistes d&apos;action produites à partir de la projection de référence : succession des départs en retraite, renouvellement des CDD, recrutements à
                  anticiper, budget. Ce sont des aides à la décision, pas des obligations.
                </InfoTip>
              </h2>
              <p className="text-xs text-fg-muted">
                <strong className="font-semibold tabular-nums text-fg">{open.length}</strong> en attente de décision · {decided.length} décidée{decided.length > 1 ? "s" : ""}
              </p>
            </div>
            {v.recommendations.length === 0 ? (
              <EmptyState title="Aucune recommandation pour cette projection" compact />
            ) : (
              <div className="space-y-3">
                {open.length === 0 ? (
                  <EmptyState title="Toutes les recommandations ont été décidées" icon="success" compact />
                ) : (
                  <ul className="space-y-3">
                    {open.slice(0, SHOWN_RECOS).map((r) => (
                      <RecoItem key={r.id} r={r} />
                    ))}
                  </ul>
                )}
                {open.length > SHOWN_RECOS && (
                  <details className="group">
                    <summary className={summaryCls}>
                      <Chevron />
                      Voir les {open.length - SHOWN_RECOS} autres recommandations en attente
                    </summary>
                    <ul className="mt-2 space-y-3">
                      {open.slice(SHOWN_RECOS).map((r) => (
                        <RecoItem key={r.id} r={r} />
                      ))}
                    </ul>
                  </details>
                )}
                {decided.length > 0 && (
                  <details className="group">
                    <summary className={summaryCls}>
                      <Chevron />
                      Voir les {decided.length} recommandation{decided.length > 1 ? "s" : ""} déjà décidée{decided.length > 1 ? "s" : ""}
                    </summary>
                    <ul className="mt-2 space-y-3">
                      {decided.map((r) => (
                        <RecoItem key={r.id} r={r} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          <Card title="Effectif actuel par grade" className="xl:col-span-1">
            <div className={`${tableCls.wrap} -mx-4 sm:-mx-5`} tabIndex={0} role="region" aria-label="Effectif actuel par grade">
              <table className={tableCls.table}>
                <caption className="sr-only">Effectif, salaire de base moyen et collaborateurs actuels encore présents dans 12 mois (hors embauches futures), par grade</caption>
                <thead className={tableCls.thead}>
                  <tr>
                    <th scope="col" className={`${tableCls.th} pl-4 sm:pl-5`}>Grade</th>
                    <th scope="col" className={thR}>Effectif</th>
                    <th scope="col" className={thR}>Salaire de base moyen</th>
                    <th scope="col" className={`${thR} pr-4 sm:pr-5`}>Encore présents dans 12 mois</th>
                  </tr>
                </thead>
                <tbody>
                  {v.byGrade.map((g) => (
                    <tr key={g.grade} className={tableCls.tr}>
                      <th scope="row" className={`${tableCls.td} pl-4 font-normal sm:pl-5`}>{g.grade === "?" ? "Non renseigné" : g.grade}</th>
                      <td className={tdR}>{fmt.int(g.hc0)}</td>
                      <td className={tdR}>{fmt.tnd(g.avgBase0)}</td>
                      <td className={`${tdR} pr-4 sm:pr-5`}>{people(g.hc12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

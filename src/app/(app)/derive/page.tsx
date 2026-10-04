import { ColorLegend, EmptyState, Icon, PageHeader, Section, StatusBadge, StatusPill, StatusSummary, cardCls, fmt } from "@/components/ui";
import { KpiCard, VisualCard, type Status } from "@/components/charts/pbi";
import { InfoTip, TermTip } from "@/components/help";
import { ActionLine } from "@/components/monitoring/action-line";
import { DataDetails } from "@/components/pilotage/data-details";
import { formatDate, formatMonth, formatRate } from "@/components/pilotage/labels";
import { formatRatio } from "@/components/insights/labels";
import { driftBarsOption, observedExpectedOption, oeTargetOption, psiText } from "@/components/monitoring/data-options";
import { Disclosure } from "@/components/monitoring/disclosure";
import { EChart } from "@/components/charts/echart";
import { SEMANTIC } from "@/components/charts/theme";
import { OnThisPage } from "@/components/ux/on-this-page";
import { pageContext } from "@/lib/dal/context";
import { getDrift, type DriftDto, type DriftVariable } from "@/lib/dal/drift";
import type { DriftStatus, PsiBin } from "@/lib/drift/psi";
import { FEATURES } from "@/lib/features/spec";

export const metadata = { title: "Dérive des données — People Analytics AJIR" };

type Scored = DriftVariable & { psi: number; status: DriftStatus };

const UNITS = new Map(FEATURES.map((f) => [f.name, f.unit]));
const num = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });

// Un seul vocabulaire sur la page : statut en mots, feu correspondant, action à mener (verbe + objet)
const STATE: Record<DriftStatus, { tone: "bon" | "attention" | "critique"; label: string; light: string; action: string }> = {
  FORTE: { tone: "critique", label: "Dérive forte", light: "Feu rouge", action: "Vérifier la saisie dans AJIR" },
  MODEREE: { tone: "attention", label: "À surveiller", light: "Feu orange", action: "Revoir au prochain calcul" },
  STABLE: { tone: "bon", label: "Stable", light: "Feu vert", action: "Aucune" },
};

type Verdict = { tone: "critique" | "attention" | "bon"; label: string; title: string; action: string };

// Rouge seulement si les démissions observées / prévues sortent de la cible ; une dérive des variables seule reste ambre
function verdictOf(d: DriftDto, hasStrong: boolean): Verdict {
  const cal = d.calibration.status;
  if (d.recommendation.level === "REENTRAINER")
    return {
      tone: "critique",
      label: "Dérive",
      title: "Réentraînement recommandé",
      action: d.view === "ADMIN" ? "Demander un réentraînement" : "Prévenir l'administrateur",
    };
  if (d.recommendation.level === "RAS") return { tone: "bon", label: "Stable", title: "Aucune dérive notable", action: "Aucune" };
  return {
    tone: "attention",
    label: "À surveiller",
    title: cal === "HORS_CIBLE" ? "Démissions hors cible" : "Dérive de variables",
    action: hasStrong ? STATE.FORTE.action : STATE.MODEREE.action,
  };
}

// Valeur d'une classe dans l'unité de la variable (ratio affiché en %)
function value(v: number, unit: string | undefined): string {
  if (unit === "ratio") return `${num(v * 100)} %`;
  if (unit && !["0/1", "nombre", "score", "niveau", "points"].includes(unit)) return `${num(v)} ${unit}`;
  return num(v);
}

function binLabel(b: PsiBin, unit: string | undefined): string {
  if (b.other) return "Autre valeur";
  if (b.value != null) return unit === "0/1" ? (b.value === 1 ? "Oui" : b.value === 0 ? "Non" : num(b.value)) : value(b.value, unit);
  if (b.from == null && b.to != null) return b.to === 0 ? `égale à ${value(0, unit)}` : `jusqu'à ${value(b.to, unit)}`;
  if (b.to == null && b.from != null) return `plus de ${value(b.from, unit)}`;
  return `de ${value(b.from!, unit)} à ${value(b.to!, unit)}`;
}

// Écart principal, au format libellé : valeur : la classe dont la part a le plus bougé, part de référence → part du mois
function mainChange(v: DriftVariable): string | null {
  const unit = UNITS.get(v.name);
  const b = [...v.bins].sort((x, y) => Math.abs(y.curShare - y.refShare) - Math.abs(x.curShare - x.refShare))[0];
  if (!b) return null;
  const label = binLabel(b, unit);
  return `${unit === "0/1" ? `« ${label} »` : label} · ${formatRate(b.refShare)} → ${formatRate(b.curShare)}`;
}

// Deux noms au plus, puis le nombre restant
const names = (vs: { label: string }[]) => vs.slice(0, 2).map((v) => v.label).join(", ") + (vs.length > 2 ? ` + ${vs.length - 2}` : "");
const variables = (n: number) => `${n} variable${n > 1 ? "s" : ""}`;

function Bins({ v }: { v: DriftVariable }) {
  const unit = UNITS.get(v.name);
  return (
    <details className="group/bins mt-1 text-xs">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-control pr-1.5 font-medium text-link transition-colors duration-200 hover:bg-primary-soft [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-flex transition-transform duration-200 group-open/bins:rotate-90">
          <Icon name="chevron-right" className="h-3.5 w-3.5" />
        </span>
        <span className="underline underline-offset-2">Voir la répartition complète</span>
        <span className="sr-only"> : {v.label}</span>
      </summary>
      <div className="relative mt-1.5 overflow-x-auto rounded-control border border-line bg-surface-2 px-2">
        <table className="w-full min-w-[16rem] text-left text-fg">
          <caption className="sr-only">Répartition de {v.label} par classe</caption>
          <thead className="text-[11px] uppercase tracking-wide text-fg-muted">
            <tr>
              <th scope="col" className="py-1 pr-2 font-semibold">Valeur</th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">Référence</th>
              <th scope="col" className="py-1 text-right font-semibold">Mois comparé</th>
            </tr>
          </thead>
          <tbody>
            {v.bins.map((b, i) => (
              <tr key={i} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 font-normal">{binLabel(b, unit)}</th>
                <td className="py-1 pr-2 text-right tabular-nums">{formatRate(b.refShare)}</td>
                <td className="py-1 text-right tabular-nums">{formatRate(b.curShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function VariableRow({ v }: { v: Scored }) {
  const change = v.status === "STABLE" ? null : mainChange(v);
  return (
    <li className="px-4 py-3 transition-colors duration-150 hover:bg-surface-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-medium text-fg">{v.label}</p>
        <p className="text-xs text-fg-muted">
          {v.groupLabel} · <span className="tabular-nums">PSI {psiText(v.psi)}</span>
        </p>
      </div>
      {change && (
        <p className="mt-1 text-sm tabular-nums text-fg-muted">
          <span className="font-semibold text-fg">Écart principal : </span>
          {change}
        </p>
      )}
      <Bins v={v} />
    </li>
  );
}

// Variables d'un même statut : l'action est écrite une fois, en tête du groupe
function StateGroup({ status, rows }: { status: DriftStatus; rows: Scored[] }) {
  const s = STATE[status];
  return (
    <section className={`${cardCls} overflow-hidden`} aria-labelledby={`groupe-${status}`}>
      <div className="border-b border-line bg-surface-2 px-4 py-3">
        <h3 id={`groupe-${status}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-heading">
          <StatusPill tone={s.tone} label={s.label} />
          {variables(rows.length)}
        </h3>
        <ActionLine className="mt-1.5">{s.action}</ActionLine>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((v) => (
          <VariableRow key={v.name} v={v} />
        ))}
      </ul>
    </section>
  );
}

export default async function DriftPage() {
  const ctx = await pageContext(["RH", "ADMIN"]);
  const d = getDrift(ctx);
  const cal = d.calibration;
  const scored = d.variables.filter((v): v is Scored => v.psi != null && v.status != null);
  const sorted = [...scored].sort((a, b) => b.psi - a.psi);
  const strong = sorted.filter((v) => v.status === "FORTE");
  const moderate = sorted.filter((v) => v.status === "MODEREE");
  const advice = verdictOf(d, strong.length > 0);
  const stable = sorted.filter((v) => v.status === "STABLE");
  const unscored = d.variables.filter((v) => v.psi == null || v.status == null);
  const refPeriod = d.reference ? `${formatMonth(d.reference.from.slice(0, 7))} – ${formatMonth(d.reference.to.slice(0, 7))}` : null;
  const curName = d.current ? formatMonth(d.current.asOf.slice(0, 7)) : "dernier mois";
  const calLabels = cal.points.map((p) => formatMonth(p.asOf.slice(0, 7)));
  const expectedName = cal.source === "PROBABILITE" ? "Taux prévu par le modèle" : "Taux de la période de référence";
  const oe = cal.recent?.oe ?? null;
  const oeOk = cal.status === "DANS_LA_CIBLE";
  const target = `${formatRatio(cal.target[0])} à ${formatRatio(cal.target[1])}`;
  const tracked = cal.points.length > 0 && cal.source != null;
  const moderateText = psiText(d.thresholds.moderate);
  const strongText = psiText(d.thresholds.strong);

  const computable = !!d.reference && scored.length > 0;
  const points: string[] = [];
  if (strong.length) points.push(`${STATE.FORTE.label} : ${names(strong)}`);
  if (moderate.length) points.push(`${STATE.MODEREE.label} : ${names(moderate)}`);
  if (cal.status && oe != null) points.push(`Observé / prévu : ${formatRatio(oe)} (cible ${target})`);

  const state = (status: DriftStatus, n: number): { tone: Status; label: string } => (n > 0 || status === "STABLE" ? { tone: STATE[status].tone, label: STATE[status].light } : { tone: "bon", label: "Aucune" });
  const oeBadge = cal.status ? <StatusBadge tone={oeOk ? "success" : "warning"}>{oeOk ? "Dans la cible" : "Hors cible"}</StatusBadge> : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Données et modèle"
        title="Dérive des données"
        badge={
          <StatusBadge tone="info" dot={false}>
            Données agrégées
          </StatusBadge>
        }
      />
      {computable ? (
        <StatusSummary tone={advice.tone} label={advice.label} title={advice.title} points={points} ariaLabel="Verdict sur la dérive des données">
          <ActionLine>{advice.action}</ActionLine>
        </StatusSummary>
      ) : (
        <StatusSummary tone="neutre" label="En attente de données" title="Dérive non calculable" ariaLabel="Verdict sur la dérive des données">
          <ActionLine>Attendre le prochain calcul mensuel</ActionLine>
        </StatusSummary>
      )}
      <OnThisPage
        items={[
          { id: "variables", label: "Dérive par variable" },
          { id: "demissions", label: "Démissions observées et prévues" },
        ]}
      />

      <section aria-label="Indicateurs de dérive" className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Variables en dérive forte"
          value={computable ? fmt.int(d.summary.FORTE) : null}
          emptyLabel="Non calculé"
          status={computable ? state("FORTE", d.summary.FORTE) : undefined}
          hint={`PSI ≥ ${strongText}`}
          detailHref={computable ? "#variables" : undefined}
          detailLabel="Voir les variables"
        />
        <KpiCard
          label="Variables à surveiller"
          value={computable ? fmt.int(d.summary.MODEREE) : null}
          emptyLabel="Non calculé"
          status={computable ? state("MODEREE", d.summary.MODEREE) : undefined}
          hint={`PSI de ${moderateText} à ${strongText}`}
        />
        <KpiCard
          label="Variables stables"
          value={computable ? fmt.int(d.summary.STABLE) : null}
          emptyLabel="Non calculé"
          unit={computable ? `sur ${fmt.int(scored.length)}` : undefined}
          status={computable ? state("STABLE", d.summary.STABLE) : undefined}
          hint={`PSI < ${moderateText}`}
        />
        <KpiCard
          tip={<TermTip term="observePrevu" role={ctx.role} align="end" />}
          label="Démissions observées / prévues"
          period={`${cal.recentCohorts} dernières cohortes`}
          value={oe == null ? null : formatRatio(oe)}
          emptyLabel="En attente"
          status={cal.status ? { tone: oeOk ? "bon" : "attention", label: oeOk ? "Dans la cible" : "Hors cible" } : undefined}
          hint={cal.status ? `Cible : ${target}` : "Aucune cohorte à 6 mois"}
          detailHref="#demissions"
          detailLabel="Voir l'évolution"
        />
      </section>
      <ul aria-label="Périmètre du calcul" className="mb-8 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
        <li>
          Référence : {refPeriod ?? "—"}
          {d.reference ? ` · ${d.reference.source === "BUNDLE" ? "apprentissage du modèle" : `${d.reference.months} premiers mois`} · ${fmt.int(d.reference.rows)} lignes` : ""}
        </li>
        <li>Mois comparé : {d.current ? `${curName} · ${fmt.int(d.current.rows)} lignes` : "—"}</li>
        <li>{d.model ? fmt.model(d.model.version).replace(/^modèle/, "Modèle") : "Aucun modèle en service"}</li>
        <li>Oppositions au calcul : exclues</li>
      </ul>

      <Section
        id="variables"
        title="Dérive par variable (PSI)"
        tip={
          <InfoTip label="Indice de stabilité (PSI)">
            Population Stability Index : somme, sur les classes de la période de référence, de (part du mois − part de référence) × ln(part du mois / part de
            référence). 0 = répartition identique. Moins de {moderateText} : stable ; de {moderateText} à {strongText} : à surveiller ; {strongText} ou plus :
            dérive forte.
          </InfoTip>
        }
      >
        {!computable ? (
          <EmptyState title="Dérive non calculable" />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <VisualCard headingLevel={3} className="xl:col-span-2" title="Indice PSI par variable" footnote="Barre : zone atteinte · valeur exacte dans la liste">
              <ColorLegend
                items={[
                  { color: SEMANTIC.defavorable, label: STATE.FORTE.label },
                  { color: SEMANTIC.attention, label: STATE.MODEREE.label },
                  { color: SEMANTIC.favorable, label: STATE.STABLE.label },
                ]}
              />
              <EChart
                format={{ digits: 2 }}
                option={driftBarsOption(
                  scored.map((v) => ({ label: v.label, psi: v.psi, tone: STATE[v.status].tone, status: STATE[v.status].label })),
                  d.thresholds,
                )}
                height={30 * scored.length + 60}
                mobileHeight={38 * scored.length + 60}
                ariaLabel={`Barres triées : indice de changement de chaque variable, par zone de seuil. ${strong.length} en dérive forte, ${moderate.length} à surveiller, ${stable.length} stables.`}
              />
            </VisualCard>
            <div className="space-y-4 xl:col-span-3">
              {strong.length > 0 && <StateGroup status="FORTE" rows={strong} />}
              {moderate.length > 0 && <StateGroup status="MODEREE" rows={moderate} />}
              {stable.length > 0 && (
                <Disclosure summary={`Variables stables (${stable.length})`} bodyClassName="">
                  <ul className="divide-y divide-line">
                    {stable.map((v) => (
                      <VariableRow key={v.name} v={v} />
                    ))}
                  </ul>
                </Disclosure>
              )}
              {unscored.length > 0 && <p className="text-xs text-fg-muted">Non calculable : {unscored.map((v) => v.label).join(", ")}</p>}
            </div>
          </div>
        )}
      </Section>

      <Section
        id="demissions"
        title="Démissions observées et prévues"
        tip={
          <InfoTip label="Cohorte" align="start">
            Les collaborateurs évalués à une fin de mois dont les 6 mois suivants sont connus. Rapport au-dessus de 1 : plus de démissions que prévu ; en dessous :
            moins. Cible : de {target} sur les {cal.recentCohorts} dernières cohortes.
          </InfoTip>
        }
        className="mb-0"
      >
        {!tracked ? (
          <EmptyState title="Aucune cohorte suivie 6 mois" />
        ) : (
          <>
            <div className={`grid grid-cols-1 gap-4 ${d.view === "RH" ? "xl:grid-cols-2" : ""}`}>
              {d.view === "RH" && (
                <VisualCard
                  headingLevel={3}
                  title="Taux de démission à 6 mois (%)"
                  subtitle={
                    d.calibration.recent?.expected != null
                      ? `Moyenne des ${cal.recentCohorts} dernières cohortes : ${formatRate(d.calibration.recent.observed)} observé · ${formatRate(d.calibration.recent.expected)} prévu`
                      : undefined
                  }
                >
                  <EChart
                    format={{ unit: "%", digits: 1 }}
                    option={observedExpectedOption(
                      calLabels,
                      d.calibration.points.map((p) => p.observed),
                      d.calibration.points.map((p) => p.expected),
                      expectedName,
                    )}
                    height={260}
                    ariaLabel="Courbes : taux de démission observé et prévu par cohorte mensuelle."
                  />
                  <DataDetails
                    summary="Voir les données par cohorte"
                    caption="Taux de démission observé et prévu"
                    numeric
                    headers={["Cohorte", "Collaborateurs", "Observé", expectedName, "Observé / prévu"]}
                    rows={d.calibration.points.map((p) => [formatMonth(p.asOf.slice(0, 7)), fmt.int(p.n), formatRate(p.observed), formatRate(p.expected), formatRatio(p.oe)])}
                  />
                </VisualCard>
              )}
              <VisualCard headingLevel={3} title="Observé / prévu par cohorte" badge={oeBadge}>
                <ColorLegend
                  items={[
                    { color: SEMANTIC.neutre, label: "Dans la cible" },
                    { color: SEMANTIC.attention, label: "Hors cible" },
                  ]}
                />
                <EChart
                  format={{ digits: 2 }}
                  option={oeTargetOption(
                    calLabels,
                    cal.points.map((p) => p.oe),
                    cal.target,
                  )}
                  height={260}
                  ariaLabel={`Courbe du rapport observé sur prévu par cohorte mensuelle, zone cible de ${target}.`}
                />
                {d.view === "ADMIN" && (
                  <DataDetails
                    summary="Voir les données par cohorte"
                    caption="Rapport observé / prévu"
                    numeric
                    headers={["Cohorte", "Collaborateurs", "Observé / prévu"]}
                    rows={cal.points.map((p) => [formatMonth(p.asOf.slice(0, 7)), fmt.int(p.n), formatRatio(p.oe)])}
                  />
                )}
              </VisualCard>
            </div>
            <p className="mt-2 text-xs text-fg-muted">Dernière cohorte complète : {formatDate(cal.points[cal.points.length - 1].asOf)}</p>
          </>
        )}
      </Section>
    </>
  );
}

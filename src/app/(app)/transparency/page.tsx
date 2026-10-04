import Link from "next/link";
import type { ReactNode } from "react";
import { pageContext } from "@/lib/dal/context";
import { getTransparency, type ChampionDTO, type ParsedMetrics, type TransparencyDTO } from "@/lib/dal/model";
import { listTopicModels, type TopicModelDTO } from "@/lib/dal/admin";
import { getModelMonitoring, type ModelMonitoringDTO } from "@/lib/dal/data-monitoring";
import { Card, ColorLegend, EmptyState, Notice, PageHeader, Section, StatusBadge, StatusSummary, cardCls, fmt, tableCls, type StatusTone } from "@/components/ui";
import { Chart, IconArray, VisualCard, barChart, lineChart } from "@/components/charts/pbi";
import { SEMANTIC, cssChartColor } from "@/components/charts/theme";
import { formatMonth } from "@/components/pilotage/labels";
import { runLabel } from "@/components/monitoring/data-options";
import { estimateHistogramChart, factorsChart, fairnessChart, levelShareChart } from "@/components/monitoring/model-options";
import { factorAxisLabel, factorPhrase, factorsHeadline, ruleCondition } from "@/components/monitoring/model-words";
import { OnThisPage } from "@/components/ux/on-this-page";
import { Disclosure } from "@/components/monitoring/disclosure";
import { CalibrationChart } from "./calibration-chart";
import { LevelExplainer, PageIntro, TermTip } from "@/components/help";

type Light = "bon" | "attention" | "critique";

export const metadata = { title: "Transparence du modèle — People Analytics AJIR" };

const KIND_LABEL: Record<string, string> = {
  LOGREG: "Régression logistique régularisée",
  B0: "Score à règles (B0)",
  LGBM: "Gradient boosting (LightGBM)",
};
const KIND_PLAIN: Record<string, string> = {
  LOGREG: "Un modèle statistique additionne l'influence de chaque facteur, puis la convertit en probabilité de démission dans les 6 mois.",
  B0: "Une grille de points fixée à l'avance : chaque condition remplie ajoute des points. Le résultat est un nombre de points, pas une probabilité.",
  LGBM: "Un ensemble d'arbres de décision combine les facteurs entre eux pour estimer la probabilité de démission dans les 6 mois.",
};
const STATUS: Record<"CHAMPION" | "CANDIDAT" | "RETIRE", { label: string; tone: StatusTone }> = {
  CHAMPION: { label: "En service", tone: "success" },
  CANDIDAT: { label: "Candidat", tone: "info" },
  RETIRE: { label: "Retiré", tone: "neutral" },
};

const dec = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const times = (n: number) => `${dec(n, 1)} ×`;
const signed = (n: number, d = 3) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${dec(Math.abs(n), d)}`;
const inRange = (v: number | null | undefined, min: number, max: number) => v != null && v >= min && v <= max;
const upperFirst = (s: string) => s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1);
const range95 = (ci: [number, number] | undefined, d = 2) => (ci ? `${dec(ci[0], d)} à ${dec(ci[1], d)}` : null);
// Libellé lisible d'une version (à côté de son identifiant) : date de mise en service, sinon date portée par l'identifiant
const versionLabel = (version: string, promotedAt: string | null) => (promotedAt || /\d{8}$/.test(version) ? upperFirst(fmt.model(version, promotedAt)) : null);
const fairnessVerdict = (oe: number | null) => (oe == null ? "non évalué" : inRange(oe, 0.8, 1.25) ? "juste" : oe > 1.25 ? "sous-estimé" : "surestimé");

function Target({ ok, label }: { ok: boolean; label?: string }) {
  return <StatusBadge tone={ok ? "success" : "warning"}>{label ?? (ok ? "Dans la cible" : "Hors cible")}</StatusBadge>;
}

// À 12 mois seul l'O/E est contraint (sinon la CIF12 est « indicative »)
function HorizonTarget({ horizon, oe, slope }: { horizon: number; oe: number | null; slope: number | null }) {
  if (oe == null) return null;
  const ok = horizon >= 12 ? inRange(oe, 0.7, 1.4) : inRange(oe, 0.8, 1.25) && (slope == null || inRange(slope, 0.8, 1.2));
  return <Target ok={ok} label={ok ? "Dans la cible" : horizon >= 12 ? "Indicative" : "Hors cible"} />;
}

function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr] sm:gap-y-2">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="mb-1 min-w-0 break-words text-fg sm:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function More({ summary, children }: { summary: string; children: ReactNode }) {
  return <Disclosure summary={summary}>{children}</Disclosure>;
}

const aucWord = (auc: number) => (auc < 0.6 ? "faible" : auc < 0.7 ? "modéré" : auc < 0.8 ? "bon" : "très bon");

function evalRange(period: string | null): string | null {
  const m = period?.match(/(\d{4}-\d{2})\s*→\s*(\d{4}-\d{2})/);
  return m ? `${formatMonth(m[1])} – ${formatMonth(m[2])}` : null;
}

// Verdict en une phrase, d'après les cibles fixées avant l'entraînement
function verdict(c: ChampionDTO, m: ParsedMetrics | null, coldStart: boolean): { tone: Light; label: string; title: string; points: ReactNode[] } {
  const method = `${KIND_LABEL[c.kind] ?? c.kind} en service${c.promotedAt ? ` depuis le ${fmt.date(c.promotedAt)}` : ""}`;
  if (!m) {
    return {
      tone: "attention",
      label: "Performances non documentées",
      title: `${method} : aucune mesure de performance enregistrée.`,
      points: ["Les niveaux de risque restent calculés ; interprétez-les avec prudence."],
    };
  }
  const liftOk = (m.lift.liftAtK ?? 0) >= 3;
  const oeOk = inRange(m.calibration.oe, 0.8, 1.25);
  const slopeOk = m.calibration.slope == null || inRange(m.calibration.slope, 0.8, 1.2);
  const ok = liftOk && oeOk && slopeOk;
  const points: ReactNode[] = [];
  if (m.auc != null)
    points.push(`Pouvoir de tri ${aucWord(m.auc)} : le modèle aide à choisir qui rencontrer en priorité, il ne prédit pas qui partira.`);
  if (!liftOk && m.lift.liftAtK != null) points.push(`Concentration des démissions au niveau Élevé sous la cible (${times(m.lift.liftAtK)} pour au moins 3 ×).`);
  if (!oeOk && m.calibration.oe != null) points.push(`Pourcentages annoncés hors cible en moyenne (observé / prévu ${dec(m.calibration.oe)}).`);
  if (!slopeOk) points.push(`Estimations extrêmes trop ${m.calibration.slope! < 1 ? "marquées" : "prudentes"} (pente ${dec(m.calibration.slope)}).`);
  if (coldStart) points.push("Démarrage à froid : les niveaux publiés viennent encore du score à règles (voir l'encadré ci-dessous).");
  points.push("Les facteurs affichés sont associés au départ, pas des causes.");
  const lift = m.lift.liftAtK != null ? `${dec(m.lift.liftAtK, 1)} fois plus de démissions au niveau Élevé` : "démissions plus fréquentes au niveau Élevé";
  return {
    tone: ok ? "bon" : "attention",
    label: ok ? "Modèle dans ses cibles" : "Modèle hors cible sur un point",
    title: `${method} : ${lift} ; pourcentages ${oeOk ? "justes en moyenne" : "à vérifier"}.`,
    points,
  };
}

function Scale({ value }: { value: number }) {
  const at = Math.min(100, Math.max(0, ((value - 0.5) / 0.5) * 100));
  return (
    <div aria-hidden="true" className="mt-3">
      <div className="relative h-2.5 rounded-full bg-gradient-to-r from-surface-3 via-primary-soft to-primary ring-1 ring-inset ring-line">
        <span className="absolute -top-1 h-4.5 w-1.5 -translate-x-1/2 rounded bg-fg ring-2 ring-surface" style={{ left: `${at}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-fg-muted">
        <span>50 : hasard</span>
        <span>100 : parfait</span>
      </div>
    </div>
  );
}

// Performance en analogies « sur 100 » : précision et lift au niveau Élevé, rappel, pouvoir de tri (AUC)
function Reliability({ m, capacityRate }: { m: ParsedMetrics; capacityRate: number }) {
  const precision = m.lift.precisionAtK;
  const lift = m.lift.liftAtK;
  const base = m.evalBaseRate ?? (precision != null && lift ? precision / lift : null);
  const p100 = precision != null ? Math.round(precision * 100) : null;
  const b100 = base != null ? Math.round(base * 100) : null;
  const r100 = m.lift.recallAtK != null ? Math.round(m.lift.recallAtK * 100) : null;
  const capacity = fmt.pct(m.lift.kRate ?? capacityRate, 0);
  const range = evalRange(m.evalPeriod);
  const liftRange = range95(m.lift.liftCi, 1);
  const aucRange = range95(m.aucCi ?? undefined);
  return (
    <>
      <p className="mb-3 max-w-3xl text-sm text-fg-muted">
        Mesuré sur des données passées que le modèle n&apos;avait pas vues
        {range ? ` (${range}${m.evalN != null ? `, ${fmt.int(m.evalN)} situations mensuelles` : ""})` : ""}. Ses estimations sont comparées aux démissions réellement
        survenues dans les 6 mois.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {p100 != null && (
          <section className={`${cardCls} p-4`} aria-labelledby="perf-eleve">
            <div className="flex items-start justify-between gap-2">
              <h3 id="perf-eleve" className="text-sm font-semibold text-heading">Sur 100 collaborateurs classés Élevé</h3>
              <TermTip term="liftCapacite" align="end" />
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-heading">
              {p100} <span className="text-base font-medium">ont démissionné</span>
            </p>
            <p className="text-xs text-fg-muted">dans les 6 mois suivants</p>
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <div>
                <IconArray segments={[{ n: p100, tone: "defavorable" }]} total={100} label={`${p100} carrés colorés sur 100 : classés Élevé ayant démissionné`} />
                <p className="mt-1 text-[11px] text-fg-muted">Classés Élevé</p>
              </div>
              {b100 != null && (
                <div>
                  <IconArray segments={[{ n: b100, tone: "reference" }]} total={100} label={`${b100} carrés colorés sur 100 : ensemble des collaborateurs ayant démissionné`} />
                  <p className="mt-1 text-[11px] text-fg-muted">Ensemble ({b100} sur 100)</p>
                </div>
              )}
            </div>
            {lift != null && (
              <p className="mt-3 text-sm text-fg-muted">
                Soit <strong>{dec(lift, 1)} fois</strong> plus que la moyenne (lift {times(lift)}). <Target ok={lift >= 3} label={lift >= 3 ? "Dans la cible (au moins 3 ×)" : "Sous la cible de 3 ×"} />
                {liftRange && <span className="mt-1 block text-xs">Marge d&apos;incertitude à 95 % : de {liftRange} fois.</span>}
              </p>
            )}
          </section>
        )}
        {r100 != null && (
          <section className={`${cardCls} p-4`} aria-labelledby="perf-rappel">
            <div className="flex items-start justify-between gap-2">
              <h3 id="perf-rappel" className="text-sm font-semibold text-heading">Sur 100 démissionnaires</h3>
              <TermTip term="rappel" align="end" />
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-heading">
              {r100} <span className="text-base font-medium">étaient classés Élevé</span>
            </p>
            <p className="text-xs text-fg-muted">6 mois avant leur départ</p>
            <div className="mt-3">
              <IconArray segments={[{ n: r100, tone: "defavorable" }]} total={100} label={`${r100} carrés colorés sur 100 : démissionnaires qui étaient classés Élevé`} />
            </div>
            <p className="mt-3 text-sm text-fg-muted">
              Le niveau Élevé est limité à {capacity} des collaborateurs : c&apos;est la capacité d&apos;entretiens RH. La plupart des départs viennent donc des niveaux Moyen
              ou Faible. Le modèle aide à prioriser ; il ne repère pas tous les départs.
            </p>
          </section>
        )}
        {m.auc != null && (
          <section className={`${cardCls} p-4`} aria-labelledby="perf-tri">
            <div className="flex items-start justify-between gap-2">
              <h3 id="perf-tri" className="text-sm font-semibold text-heading">Pouvoir de tri</h3>
              <TermTip term="auc" align="end" />
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-heading">
              {Math.round(m.auc * 100)} <span className="text-base font-medium">cas sur 100</span>
            </p>
            <p className="text-xs text-fg-muted">
              Pouvoir de tri {aucWord(m.auc)} (AUC {dec(m.auc)}
              {aucRange ? ` ; marge à 95 % : ${aucRange}` : ""})
            </p>
            <Scale value={m.auc} />
            <p className="mt-3 text-sm text-fg-muted">
              Prenez au hasard un collaborateur parti et un collaborateur resté. Dans {Math.round(m.auc * 100)} cas sur 100, le modèle donne le risque le plus haut au
              premier.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

function Calibration({ m }: { m: ParsedMetrics }) {
  const cal = m.calibration;
  const top = cal.bins.at(-1);
  const oeOk = inRange(cal.oe, 0.8, 1.25);
  const slopeOk = inRange(cal.slope, 0.8, 1.2);
  const oeRange = range95(cal.oeCi);
  const slopeRange = range95(cal.slopeCi);
  if (cal.oe == null && cal.bins.length < 2) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
      <section className={`${cardCls} p-4 xl:col-span-2`} aria-labelledby="calibration-titre">
        <div className="flex items-start justify-between gap-2">
          <h3 id="calibration-titre" className="text-sm font-semibold text-heading">Les pourcentages annoncés sont-ils justes ?</h3>
          <TermTip term="calibration" align="end" />
        </div>
        <ul className="mt-2 space-y-3 text-sm text-fg-muted">
          {cal.oe != null && (
            <li>
              Pour <strong>100 démissions prévues</strong>, <strong className="tabular-nums">{Math.round(cal.oe * 100)}</strong> ont été observées (rapport observé / prévu{" "}
              {dec(cal.oe)}, cible de 0,8 à 1,25). <Target ok={oeOk} />
              {oeRange && <span className="mt-1 block text-xs">Marge d&apos;incertitude à 95 % : {oeRange}.</span>}
            </li>
          )}
          {top && (
            <li>
              Pour les collaborateurs au risque le plus haut, le modèle annonçait <strong className="tabular-nums">{fmt.pct(top.predicted, 1)}</strong> de démissions ;{" "}
              <strong className="tabular-nums">{fmt.pct(top.observed, 1)}</strong> ont réellement démissionné.
            </li>
          )}
          {cal.slope != null && (
            <li>
              Écart entre estimations hautes et basses : pente {dec(cal.slope)} (cible de 0,8 à 1,2).{" "}
              {cal.slope < 0.95 ? "Les estimations extrêmes sont un peu trop marquées. " : cal.slope > 1.05 ? "Les estimations sont un peu trop prudentes. " : ""}
              <Target ok={slopeOk} />
              {slopeRange && <span className="mt-1 block text-xs">Marge d&apos;incertitude à 95 % : {slopeRange}.</span>}
            </li>
          )}
        </ul>
      </section>
      {cal.bins.length > 1 && <CalibrationChart bins={cal.bins} onTarget={oeOk} className="xl:col-span-3" />}
    </div>
  );
}

function Fairness({ m }: { m: ParsedMetrics }) {
  const f = m.fairness;
  return (
    <>
      <p className="mb-3 max-w-3xl text-sm text-fg-muted">
        Le sexe et l&apos;âge ne sont pas utilisés par le modèle. On vérifie ici qu&apos;il ne se trompe pas davantage pour un groupe que pour un autre. Aucun chiffre
        n&apos;est affiché sous {fmt.int(f.minGroupSize)} observations.
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {f.dimensions.map((d) => {
          const shown = d.rows.filter((r) => !r.masked);
          const off = shown.filter((r) => r.oe != null && !inRange(r.oe, 0.8, 1.25));
          const dots = shown.flatMap((r) => (r.baseRate != null && r.meanPred != null ? [{ group: r.group, observed: r.baseRate, estimated: r.meanPred, verdict: fairnessVerdict(r.oe) }] : []));
          return (
            <section key={d.key} className={`${cardCls} p-4`} aria-labelledby={`equite-${d.key}`}>
              <h3 id={`equite-${d.key}`} className="text-sm font-semibold text-heading">
                {d.label} : {off.length === 0 ? "risque estimé proche du réel dans chaque groupe" : `estimation à surveiller pour ${off.map((r) => r.group).join(", ")}`}
              </h3>
              <p className="mb-3 mt-1 text-sm text-fg-muted">
                {off.length === 0
                  ? "Pour chaque groupe, le risque estimé moyen est proche du taux de démission réel : aucun groupe n'est surestimé ni sous-estimé."
                  : `Estimation à surveiller pour : ${off.map((r) => r.group).join(", ")}.`}
              </p>
              {dots.length > 0 && <Chart spec={fairnessChart(dots)} />}
              <div className="relative mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={`Équité : ${d.label}`}>
                <table className={tableCls.table}>
                  <caption className="sr-only">Justesse des estimations par groupe : {d.label}</caption>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th scope="col" className={tableCls.th}>Groupe</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Démissions réelles</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Risque estimé moyen</th>
                      <th scope="col" className={tableCls.th}>Justesse</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Classés Élevé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) =>
                      r.masked ? (
                        <tr key={r.group} className={tableCls.tr}>
                          <th scope="row" className={`${tableCls.td} font-normal`}>{r.group}</th>
                          <td colSpan={4} className={`${tableCls.td} text-xs text-fg-muted`}>Groupe trop petit : non affiché.</td>
                        </tr>
                      ) : (
                        <tr key={r.group} className={tableCls.tr}>
                          <th scope="row" className={`${tableCls.td} font-normal`}>
                            {r.group}
                            <span className="block text-xs text-fg-muted">{fmt.int(r.n)} observations</span>
                          </th>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(r.baseRate, 1)}</td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(r.meanPred, 1)}</td>
                          <td className={tableCls.td}>
                            {r.oe == null ? "—" : inRange(r.oe, 0.8, 1.25) ? <StatusBadge tone="success">Juste</StatusBadge> : <StatusBadge tone="warning">{r.oe > 1.25 ? "Sous-estimé" : "Surestimé"}</StatusBadge>}
                          </td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(r.selectionRate, 1)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-3 max-w-3xl text-xs text-fg-muted">
        Quand les taux de démission diffèrent d&apos;un groupe à l&apos;autre, la part classée Élevé diffère aussi. Ce rapport éclaire une décision humaine ; il ne bloque
        rien automatiquement.
      </p>
    </>
  );
}

function ModelCard({ c }: { c: ChampionDTO }) {
  return (
    <Card title="Modèle en service" headingLevel={3}>
      <Dl
        items={[
          ["Méthode", KIND_LABEL[c.kind] ?? c.kind],
          ["Mise en service", c.promotedAt ? `Le ${fmt.date(c.promotedAt)}${c.promotedBy ? `, par ${c.promotedBy}` : ""}` : "—"],
          ["Ce qu'il estime", c.kind === "B0" ? "Un nombre de points de priorité" : "La probabilité de démission (ou d'abandon de poste) dans les 6 mois"],
          ["Appris sur", c.trainRows != null ? `${fmt.int(c.trainRows)} situations mensuelles passées` : "—"],
          [
            "Identifiant technique",
            <a key="fiche" href="#technique" className="font-medium text-link underline underline-offset-2">
              Voir la fiche technique
            </a>,
          ],
        ]}
      />
    </Card>
  );
}

// Comment le modèle décide : principaux facteurs (sens et poids) et poids par famille
function HowItDecides({ c }: { c: ChampionDTO }) {
  if (c.rules) {
    return (
      <div className="space-y-4">
        <ModelCard c={c} />
        <Card title="Règles du score B0" headingLevel={3} actions={<TermTip term="scoreRegles" align="end" />}>
          <p className="mb-3 text-sm text-fg-muted">
            Le modèle en service est un score à règles : chaque condition remplie ajoute des points. Plus le total est élevé, plus le collaborateur est prioritaire.
            Le résultat est un nombre de points, pas une probabilité.
          </p>
          <div className="relative overflow-x-auto">
            <table className={tableCls.table}>
              <caption className="sr-only">Règles du score B0</caption>
              <thead className={tableCls.thead}>
                <tr>
                  <th scope="col" className={tableCls.th}>Condition</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>Points ajoutés</th>
                </tr>
              </thead>
              <tbody>
                {c.rules.map((r, i) => (
                  <tr key={i} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      {ruleCondition(r.feature, r.op, r.value)}
                      <span className="block font-mono text-xs text-fg-subtle">
                        {r.feature} {r.op} {r.value}
                      </span>
                    </td>
                    <td className={`${tableCls.td} ${tableCls.num}`}>+{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }
  if (!c.groups.length) {
    return (
      <div className="space-y-4">
        <ModelCard c={c} />
        <Notice tone="warning">Le détail des facteurs est indisponible{c.bundleError ? ` : ${c.bundleError}` : "."}</Notice>
      </div>
    );
  }
  const all = c.groups.flatMap((g) => g.features);
  const total = all.reduce((s, f) => s + Math.abs(f.effect), 0) || 1;
  const top = [...all].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 10);
  const topShare = top.reduce((s, f) => s + Math.abs(f.effect), 0) / total;
  const share = (weight: number) => (weight / total) * 100;
  const families = barChart({
    rows: c.groups.map((g) => ({ name: g.label, value: Math.round(share(g.weight) * 10) / 10, tone: g.actionable ? "neutre" : "contexte" })),
    measure: "Poids de la famille",
    unit: "%",
    digits: 0,
    categoryName: "Famille",
  });
  const first = c.groups[0];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:order-2 xl:col-span-2">
        <ModelCard c={c} />
        <VisualCard
          headingLevel={3}
          title={`${first.label} : première famille, ${Math.round(share(first.weight))} % du poids`}
          subtitle="Part du poids total des facteurs, par famille (%)"
          chart={{
            ...families,
            table: {
              headers: ["Famille", "Signal", "Poids"],
              rows: c.groups.map((g) => [g.label, g.actionable ? "Levier RH" : "Signal à observer", `${Math.round(share(g.weight))} %`]),
            },
          }}
        >
          <ul className="mt-1 space-y-1.5 text-[13px] text-fg-muted">
            {[true, false].map((lever) => {
              const names = c.groups.filter((g) => g.actionable === lever).map((g) => g.label);
              if (!names.length) return null;
              return (
                <li key={String(lever)} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: cssChartColor(lever ? SEMANTIC.neutre : SEMANTIC.contexte) }} />
                  <StatusBadge tone={lever ? "info" : "neutral"} dot={false}>{lever ? "Levier RH" : "Signal à observer"}</StatusBadge>
                  <span>{names.join(", ")}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-fg-muted">
            « Levier RH » : famille sur laquelle la RH peut agir. Les absences pour maladie et maternité ne comptent dans aucun facteur.
          </p>
        </VisualCard>
      </div>
      <VisualCard
        headingLevel={3}
        className="xl:order-1 xl:col-span-3"
        title={factorsHeadline(top.map((f) => f.name)) ?? `Les ${top.length} facteurs les plus influents, du plus fort au plus faible`}
        subtitle={
          top.length < all.length
            ? `Poids relatif de chaque facteur (%) · les ${top.length} plus influents sur ${all.length} · ils pèsent ${fmt.pct(topShare, 0)} de la décision`
            : `Poids relatif de chaque facteur (%) · les ${top.length} facteurs du modèle`
        }
        actions={<TermTip term="facteursAssocies" align="end" />}
        chart={factorsChart(top.map((f) => ({ label: factorPhrase(f.name), axis: factorAxisLabel(f.name), weight: share(f.effect) })))}
        footnote="Les facteurs se lisent ensemble : deux facteurs proches (absences courtes et facteur de Bradford, par exemple) peuvent se compenser. Poids relatif : influence d'un écart habituel de la valeur, rapportée à l'ensemble des facteurs."
      >
        <ColorLegend
          className="mt-2"
          items={[
            { color: SEMANTIC.defavorable, label: "Défavorable, à droite de zéro : associé à un risque plus élevé" },
            { color: SEMANTIC.favorable, label: "Favorable, à gauche de zéro : associé à un risque plus faible" },
          ]}
        />
      </VisualCard>
    </div>
  );
}

function Levels({ t, admin, role }: { t: TransparencyDTO; admin: boolean; role: "ADMIN" | "RH" }) {
  return (
    <Card title="Du risque estimé au niveau de risque" headingLevel={3} className="mt-4" actions={<TermTip term="capacite" align="end" />}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="space-y-3 text-sm">
          <Dl
            items={[
              ["Capacité (niveau « Élevé »)", `${fmt.pct(t.decision.capacityRate, 1)} des collaborateurs évalués`],
              ["Seuil du niveau « Moyen »", `${dec(t.decision.mediumLift, 1)} fois le risque moyen`],
            ]}
          />
          <p className="text-xs text-fg-muted">
            Aucun seuil de probabilité : le niveau dépend du rang de chaque collaborateur et de la capacité d&apos;entretiens RH. En cas d&apos;égalité à la limite, le nombre
            de collaborateurs Élevé peut être inférieur à la capacité.
          </p>
          {admin && (
            <Link href="/admin/settings" className="inline-flex min-h-10 items-center text-sm font-medium text-link underline underline-offset-2">
              Modifier la capacité dans Paramètres
            </Link>
          )}
        </div>
        <LevelExplainer capacityRate={t.decision.capacityRate} mediumLift={t.decision.mediumLift} role={role} />
      </div>
    </Card>
  );
}

// Trois visuels de même hauteur : volume évalué, part des niveaux, répartition des risques estimés
function ModelMonitoringSection({ m }: { m: ModelMonitoringDTO }) {
  const { runs, lastRun, distribution: d } = m;
  const total = (r: ModelMonitoringDTO["runs"][number]) => r.levels.ELEVE + r.levels.MOYEN + r.levels.FAIBLE;
  const last = runs.at(-1);
  const lastTotal = last ? total(last) : 0;
  let cut: number | null = null;
  if (d) {
    let acc = 0;
    for (const b of d.bins) {
      acc += b.n;
      if (acc >= d.n * 0.8) {
        cut = b.to;
        break;
      }
    }
  }
  const scored = lineChart({
    categories: runs.map(runLabel),
    series: [{ name: "Collaborateurs évalués", values: runs.map((r) => r.nScored), tone: "neutre" }],
    measure: "Collaborateurs évalués",
    categoryName: "Calcul",
    height: 260,
  });
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <VisualCard
        headingLevel={3}
        title={last ? `${fmt.int(last.nScored)} collaborateurs évalués en ${runLabel(last)}` : "Collaborateurs évalués par calcul"}
        subtitle={`Nombre de collaborateurs évalués à chaque calcul mensuel${runs.length > 1 ? ` · ${runs.length} derniers calculs` : ""}`}
        chart={
          runs.length
            ? {
                ...scored,
                table: {
                  headers: ["Calcul", "Modèle", "Collaborateurs évalués"],
                  rows: [...runs].reverse().map((r) => [`${runLabel(r)}${r.current ? " (publié)" : ""}`, upperFirst(fmt.model(r.modelVersion)), fmt.int(r.nScored)]),
                },
              }
            : undefined
        }
      >
        {!runs.length && <EmptyState compact title="Aucun calcul publié">Le suivi apparaît après le premier calcul mensuel.</EmptyState>}
      </VisualCard>

      <VisualCard
        headingLevel={3}
        title={
          last && lastTotal
            ? `En ${runLabel(last)} : ${fmt.pct(last.levels.ELEVE / lastTotal, 1)} Élevé, ${fmt.pct(last.levels.MOYEN / lastTotal, 1)} Moyen`
            : "Répartition des niveaux de risque par calcul"
        }
        subtitle="Part des collaborateurs évalués par niveau de risque, à chaque calcul (%)"
        chart={runs.some((r) => total(r) > 0) ? levelShareChart(runs) : undefined}
      >
        {!runs.some((r) => total(r) > 0) && <EmptyState compact title="Aucun niveau de risque calculé">La répartition apparaît après le premier calcul mensuel.</EmptyState>}
      </VisualCard>

      <VisualCard
        headingLevel={3}
        title={cut != null ? `8 collaborateurs sur 10 ont un risque estimé inférieur à ${fmt.pct(cut, 0)}` : "Répartition des risques estimés au dernier calcul"}
        subtitle={
          lastRun && d
            ? `Nombre de collaborateurs par tranche de risque estimé à 6 mois · calcul au ${fmt.date(lastRun.asOf)}`
            : "Nombre de collaborateurs par tranche de risque estimé à 6 mois"
        }
        chart={lastRun?.modelKind !== "B0" && d ? estimateHistogramChart(d.bins, d.mean) : undefined}
        footnote={lastRun?.modelKind !== "B0" && d && d.bins.at(-1)?.to == null ? "La dernière tranche regroupe le 1 % d'estimations les plus hautes." : undefined}
      >
        {lastRun?.modelKind === "B0" ? (
          <Notice>
            Le calcul publié repose sur un score à règles (B0) : sa valeur est un nombre de points, pas une probabilité. Aucune répartition de risques estimés
            n&apos;est affichée.
          </Notice>
        ) : (
          !d && <EmptyState compact title={lastRun ? "Aucune estimation pour ce calcul" : "Aucun calcul publié"}>La répartition apparaît après un calcul mensuel par un modèle probabiliste.</EmptyState>
        )}
      </VisualCard>
    </div>
  );
}

const TOPIC_LABEL: Record<string, string> = {
  ABSENTEISME: "Absentéisme",
  EFFECTIF: "Effectif",
  MASSE_SALARIALE: "Masse salariale",
  FORMATION: "Formations obligatoires",
  CHARGE_TRAVAIL: "Charge de travail",
  TURNOVER: "Risque de départ",
};

// Identifiant technique accompagné de son libellé lisible (fiche technique, modèles par sujet, historique)
function VersionCell({ version, promotedAt, extra }: { version: string; promotedAt: string | null; extra?: ReactNode }) {
  const label = versionLabel(version, promotedAt);
  return (
    <>
      {label && <span className="block text-fg">{label}</span>}
      <span className="font-mono text-xs text-fg-muted">{version}</span>
      {extra && <span className="block text-xs text-fg-muted">{extra}</span>}
    </>
  );
}

// Modèles collectifs (hors risque de départ) : repliés, le résumé donne le nombre et les sujets
function TopicModels({ models }: { models: TopicModelDTO[] }) {
  const subjects = [...new Set(models.map((m) => (TOPIC_LABEL[m.topic] ?? m.topic).toLocaleLowerCase("fr-FR")))];
  return (
    <More summary={models.length ? `Modèles par sujet : ${models.length} (${subjects.join(", ")})` : "Modèles par sujet"}>
      <p className="mb-3 text-sm text-fg-muted">
        Prévisions collectives (absentéisme, effectif, masse salariale, charge de travail) et risque de formation en retard. Pour chacun : version, statut et
        mesures sur le passé. Aucune donnée individuelle.
      </p>
      {models.length === 0 ? (
        <EmptyState title="Aucun modèle par sujet enregistré">L&apos;enregistrement et la mise en service se font par la procédure outillée.</EmptyState>
      ) : (
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Modèles par sujet">
          <table className={tableCls.table}>
            <caption className="sr-only">Modèles par sujet : version, statut et indicateurs clés</caption>
            <thead className={tableCls.thead}>
              <tr>
                <th scope="col" className={tableCls.th}>Sujet</th>
                <th scope="col" className={tableCls.th}>Version</th>
                <th scope="col" className={tableCls.th}>Statut</th>
                <th scope="col" className={tableCls.th}>Mise en service</th>
                <th scope="col" className={tableCls.th}>Indicateurs clés</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.version} className={tableCls.tr}>
                  <th scope="row" className={`${tableCls.td} font-medium`}>{TOPIC_LABEL[m.topic] ?? m.topic}</th>
                  <td className={tableCls.td}>
                    <VersionCell version={m.version} promotedAt={m.promotedAt} extra={m.kind} />
                  </td>
                  <td className={tableCls.td}>
                    <StatusBadge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</StatusBadge>
                  </td>
                  <td className={`${tableCls.td} whitespace-nowrap`}>{m.promotedAt ? fmt.date(m.promotedAt) : "—"}</td>
                  <td className={tableCls.td}>
                    {m.metrics.length ? (
                      <ul className="space-y-0.5 text-xs">
                        {m.metrics.map((x) => (
                          <li key={x.label}>
                            {x.label} : <span className="font-semibold tabular-nums text-fg">{x.value}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-fg-muted">Non renseignés</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </More>
  );
}

// Détails techniques : réservés aux spécialistes, repliés par défaut
function Technical({ c, t }: { c: ChampionDTO; t: TransparencyDTO }) {
  const m = c.metrics;
  const cal = m?.calibration;
  const withRecall = !!m?.lift.curve.some((cv) => cv.recall != null);
  const ci = (range: string | null) => (range ? ` (marge à 95 % : ${range})` : "");
  return (
    <div className="space-y-3">
      <Card title="Fiche technique du modèle en service" headingLevel={3}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Dl
            items={[
              ["Version", <VersionCell key="v" version={c.version} promotedAt={c.promotedAt} />],
              ["Méthode", KIND_LABEL[c.kind] ?? c.kind],
              ["Jeu de variables (fsv)", <>{c.fsv} {c.fsv !== t.contractFsv && <StatusBadge tone="danger">Différent du contrat ({t.contractFsv})</StatusBadge>}</>],
              ["Entraîné le", fmt.dateTime(c.trainedAt)],
              ["Taille d'entraînement", c.trainRows != null ? `${fmt.int(c.trainRows)} observations` : "—"],
            ]}
          />
          <Dl
            items={[
              ["Enregistré le", fmt.dateTime(c.createdAt)],
              ["Taux de base", c.baseRate != null ? fmt.pct(c.baseRate, 1) : "—"],
              ["Recalibrage", c.calibration ? `${c.calibration.method} (a = ${dec(c.calibration.a, 3)}, b = ${dec(c.calibration.b, 3)})` : "—"],
              ["Empreinte des données", c.dataHash ? <span className="font-mono text-xs">{c.dataHash.slice(0, 19)}…</span> : "—"],
            ]}
          />
        </div>
        {c.bundleError && !c.rules && (
          <div className="mt-3">
            <Notice tone="warning">{c.bundleError}</Notice>
          </div>
        )}
      </Card>
      {m && (
        <More summary="Mesures d'évaluation détaillées (AUC, Brier, PR-AUC, contrôle de parité)">
          <Dl
            items={[
              ["Période d'évaluation", m.evalPeriod ?? "—"],
              ["Observations (dont départs volontaires)", m.evalN != null ? `${fmt.int(m.evalN)} (${fmt.int(m.evalPositives)})` : "—"],
              ["Taux de base observé", fmt.pct(m.evalBaseRate, 2)],
              [`AUC à ${m.horizonMonths ?? 6} mois`, m.auc != null ? `${dec(m.auc)}${m.aucCi ? ` (IC 95 % : ${dec(m.aucCi[0])} – ${dec(m.aucCi[1])})` : ""}` : "—"],
              ["Score de Brier", dec(m.brier, 4)],
              ["PR-AUC", m.prAuc != null ? `${dec(m.prAuc, 3)} (à comparer au taux de base)` : "—"],
              ...(cal?.oe != null ? ([["Rapport observé / prévu", `${dec(cal.oe)}${ci(range95(cal.oeCi))}`]] as [string, ReactNode][]) : []),
              ...(cal?.slope != null ? ([["Pente de calibration", `${dec(cal.slope)}${ci(range95(cal.slopeCi))}`]] as [string, ReactNode][]) : []),
              ...(m.lift.liftAtK != null ? ([["Lift à la capacité", `${times(m.lift.liftAtK)}${ci(range95(m.lift.liftCi, 1))}`]] as [string, ReactNode][]) : []),
              ...(m.golden
                ? ([
                    [
                      "Contrôle golden (TS vs Python)",
                      <>
                        {m.golden.status === "OK" ? <StatusBadge tone="success">Conforme</StatusBadge> : <StatusBadge tone="danger">{m.golden.status}</StatusBadge>}{" "}
                        {m.golden.maxAbsDiff != null && <span className="text-xs text-fg-muted">écart max {m.golden.maxAbsDiff.toExponential(1).replace(".", ",")}</span>}
                      </>,
                    ],
                  ] as [string, ReactNode][])
                : []),
              ...m.other.map((o) => [o.key, o.value] as [string, ReactNode]),
            ]}
          />
          <p className="mt-3 text-xs text-fg-muted">
            Cibles fixées avant l&apos;entraînement, à 3 et 6 mois : observé / prévu entre 0,8 et 1,25, pente entre 0,8 et 1,2. À 12 mois : observé / prévu entre 0,7
            et 1,4. Lift d&apos;au moins 3 à la capacité par défaut.
          </p>
          {cal && cal.byHorizon.length > 0 && (
            <div className="mt-4 relative overflow-x-auto">
              <table className={tableCls.table}>
                <caption className="mb-1 text-left text-sm font-medium text-fg">Calibration par horizon</caption>
                <thead className={tableCls.thead}>
                  <tr>
                    <th scope="col" className={tableCls.th}>Horizon</th>
                    <th scope="col" className={`${tableCls.th} text-right`}>Observé / prévu</th>
                    <th scope="col" className={`${tableCls.th} text-right`}>Pente</th>
                    <th scope="col" className={tableCls.th}>Cible</th>
                  </tr>
                </thead>
                <tbody>
                  {cal.byHorizon.map((h) => (
                    <tr key={h.horizon} className={tableCls.tr}>
                      <td className={tableCls.td}>{h.horizon} mois</td>
                      <td className={`${tableCls.td} ${tableCls.num}`}>{dec(h.oe)}</td>
                      <td className={`${tableCls.td} ${tableCls.num}`}>{dec(h.slope)}</td>
                      <td className={tableCls.td}>
                        <HorizonTarget horizon={h.horizon} oe={h.oe} slope={h.slope} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </More>
      )}
      {m && m.lift.curve.length > 0 && (
        <More summary="Lift et précision selon la part de collaborateurs ciblée">
          <div className="relative overflow-x-auto">
            <table className={tableCls.table}>
              <caption className="sr-only">Courbe de lift</caption>
              <thead className={tableCls.thead}>
                <tr>
                  <th scope="col" className={tableCls.th}>Part ciblée (les plus exposés)</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>Lift</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>Précision</th>
                  {withRecall && <th scope="col" className={`${tableCls.th} text-right`}>Rappel</th>}
                </tr>
              </thead>
              <tbody>
                {m.lift.curve.map((cv) => {
                  const current = Math.abs(cv.topPct - t.decision.capacityRate) < 1e-9;
                  return (
                    <tr key={cv.topPct} className={`${tableCls.tr} ${current ? "bg-primary-soft font-medium" : ""}`}>
                      <td className={tableCls.td}>
                        {fmt.pct(cv.topPct, cv.topPct < 0.1 ? 1 : 0)}
                        {current && <span className="ml-2 text-xs text-link">(capacité actuelle)</span>}
                      </td>
                      <td className={`${tableCls.td} ${tableCls.num}`}>{cv.lift != null ? times(cv.lift) : "—"}</td>
                      <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(cv.precision)}</td>
                      {withRecall && <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(cv.recall)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            Lift : taux de démission du groupe ciblé, rapporté au taux moyen. Précision : part du groupe ciblé qui a démissionné.
            {withRecall ? " Rappel : part des démissions qui concernaient le groupe ciblé." : ""}
          </p>
        </More>
      )}
      {m && m.decisionCurve.length > 0 && (
        <More summary="Courbe de décision (bénéfice net)">
          <div className="relative overflow-x-auto">
            <table className={tableCls.table}>
              <caption className="sr-only">Bénéfice net selon le seuil</caption>
              <thead className={tableCls.thead}>
                <tr>
                  <th scope="col" className={`${tableCls.th} text-right`}>Seuil d&apos;estimation</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>Bénéfice net du modèle</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>Bénéfice net « tous ciblés »</th>
                </tr>
              </thead>
              <tbody>
                {m.decisionCurve.map((d) => (
                  <tr key={d.threshold} className={tableCls.tr}>
                    <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(d.threshold, 1)}</td>
                    <td className={`${tableCls.td} ${tableCls.num}`}>{dec(d.netBenefit, 4)}</td>
                    <td className={`${tableCls.td} ${tableCls.num}`}>{dec(d.treatAll, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-fg-muted">Analyse coût-bénéfice indicative : le niveau de risque n&apos;utilise pas de seuil de probabilité mais la capacité RH.</p>
        </More>
      )}
      {m && m.fairness.dimensions.length > 0 && (
        <More summary="Rapport d'équité complet (TPR@k, FPR@k)">
          {m.fairness.note && <p className="mb-3 text-sm text-fg-muted">{m.fairness.note}</p>}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {m.fairness.dimensions.map((d) => (
              <div key={d.key} className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={`Rapport d'équité : ${d.label}`}>
                <table className={tableCls.table}>
                  <caption className="mb-1 text-left text-sm font-medium text-fg">{d.label}</caption>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th scope="col" className={tableCls.th}>Groupe</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Effectif</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Obs. / prévu</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Sélection</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>TPR@k</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>FPR@k</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) =>
                      r.masked ? (
                        <tr key={r.group} className={tableCls.tr}>
                          <td className={tableCls.td}>{r.group}</td>
                          <td colSpan={5} className={`${tableCls.td} text-xs text-fg-muted`}>Effectif insuffisant, non affiché.</td>
                        </tr>
                      ) : (
                        <tr key={r.group} className={tableCls.tr}>
                          <td className={tableCls.td}>{r.group}</td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.int(r.n)}</td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>
                            {dec(r.oe)}
                            {r.oeCi && <span className="block text-xs font-normal text-fg-muted">{range95(r.oeCi)}</span>}
                          </td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(r.selectionRate)}</td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(r.tpr)}</td>
                          <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.pct(r.fpr)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          {m.fairness.dimensions.some((d) => d.rows.some((r) => r.oeCi)) && <p className="mt-2 text-xs text-fg-muted">Sous chaque rapport observé / prévu : marge d&apos;incertitude à 95 %.</p>}
        </More>
      )}
      {c.groups.length > 0 && (
        <More summary="Coefficients de toutes les variables (effet pour +1 écart-type, odds ratio)">
          <p className="mb-3 text-sm text-fg-muted">
            Effet de chaque variable sur le log-odds de l&apos;estimation pour une hausse d&apos;un écart-type, recalibrage inclus. Un effet positif est associé à un risque
            plus élevé. <TermTip term="variables" />
          </p>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {c.groups.map((g) => (
              <div key={g.code} className="relative overflow-x-auto">
                <table className={tableCls.table}>
                  <caption className="mb-1 text-left text-sm font-medium text-fg">{g.label}</caption>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th scope="col" className={tableCls.th}>Variable</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Effet (+1 σ)</th>
                      <th scope="col" className={`${tableCls.th} text-right`}>Odds ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.features.map((f) => (
                      <tr key={f.name} className={tableCls.tr}>
                        <td className={tableCls.td}>
                          {factorPhrase(f.name)}
                          <span className="block font-mono text-xs text-fg-subtle">{f.name}</span>
                        </td>
                        <td className={`${tableCls.td} ${tableCls.num}`}>
                          {signed(f.effect)}
                          <span className="sr-only">{f.effect > 0 ? " (associé à un risque plus élevé)" : f.effect < 0 ? " (associé à un risque plus faible)" : ""}</span>
                        </td>
                        <td className={`${tableCls.td} ${tableCls.num}`}>{dec(Math.exp(f.effect))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </More>
      )}
    </div>
  );
}

const promotion = (v: TransparencyDTO["versions"][number]) => (v.promotedAt ? `${fmt.date(v.promotedAt)}${v.promotedBy ? ` · ${v.promotedBy}` : ""}` : "—");
const liftText = (v: TransparencyDTO["versions"][number]) => (v.liftAtK != null ? times(v.liftAtK) : "—");

function Versions({ t }: { t: TransparencyDTO }) {
  return (
    <Card title="Historique des versions" headingLevel={3}>
      {t.versions.length === 0 ? (
        <EmptyState title="Aucune version enregistrée">Les versions apparaissent ici après leur enregistrement par la procédure outillée.</EmptyState>
      ) : (
        <>
          {/* Sous 640 px : une carte par version ; à partir de 640 px : tableau */}
          <ul aria-label="Historique des versions de modèle" className="divide-y divide-line sm:hidden">
            {t.versions.map((v) => (
              <li key={v.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0 break-words">
                    <VersionCell version={v.version} promotedAt={v.promotedAt} extra={`variables ${v.fsv}`} />
                  </div>
                  <StatusBadge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</StatusBadge>
                </div>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  {(
                    [
                      ["Méthode", v.kind],
                      ["Enregistrée", fmt.date(v.createdAt)],
                      ["Mise en service", promotion(v)],
                      ["AUC", dec(v.auc)],
                      ["Lift à la capacité", liftText(v)],
                    ] as const
                  ).map(([k, val]) => (
                    <div key={k} className="contents">
                      <dt className="text-fg-muted">{k}</dt>
                      <dd className="break-words text-right tabular-nums text-fg">{val}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto sm:block" tabIndex={0} role="region" aria-label="Historique des versions de modèle (zone défilante)">
            <table className={tableCls.table}>
              <caption className="sr-only">Historique des versions de modèle</caption>
              <thead className={tableCls.thead}>
                <tr>
                  <th scope="col" className={tableCls.th}>Version</th>
                  <th scope="col" className={tableCls.th}>Méthode</th>
                  <th scope="col" className={tableCls.th}>Statut</th>
                  <th scope="col" className={tableCls.th}>Enregistrée</th>
                  <th scope="col" className={tableCls.th}>Mise en service</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>AUC</th>
                  <th scope="col" className={`${tableCls.th} text-right`}>Lift à la capacité</th>
                </tr>
              </thead>
              <tbody>
                {t.versions.map((v) => (
                  <tr key={v.id} className={tableCls.tr}>
                    <td className={tableCls.td}>
                      <VersionCell version={v.version} promotedAt={v.promotedAt} extra={`variables ${v.fsv}`} />
                    </td>
                    <td className={tableCls.td}>{v.kind}</td>
                    <td className={tableCls.td}>
                      <StatusBadge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</StatusBadge>
                    </td>
                    <td className={`${tableCls.td} whitespace-nowrap`}>{fmt.date(v.createdAt)}</td>
                    <td className={`${tableCls.td} whitespace-nowrap`}>{promotion(v)}</td>
                    <td className={`${tableCls.td} ${tableCls.num}`}>{dec(v.auc)}</td>
                    <td className={`${tableCls.td} ${tableCls.num}`}>{liftText(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-fg-muted">La mise en service d&apos;un modèle se fait hors de l&apos;interface, par une procédure outillée et tracée.</p>
    </Card>
  );
}

export default async function TransparencyPage() {
  const ctx = await pageContext(["ADMIN", "RH"]);
  const t = getTransparency(ctx);
  const topics = listTopicModels(ctx);
  const monitoring = getModelMonitoring(ctx);
  const c = t.champion;
  const role = ctx.role === "ADMIN" ? "ADMIN" : "RH";
  const v = c ? verdict(c, c.metrics, !!t.coldStart?.active) : null;

  return (
    <>
      <PageHeader
        eyebrow="Données et modèle"
        title="Transparence du modèle"
        subtitle={`Comment le risque de départ est estimé, avec quelle fiabilité et dans quelles limites.${c ? ` ${upperFirst(fmt.model(c.version, c.promotedAt))}.` : ""}`}
      />
      {v && <StatusSummary tone={v.tone} label={v.label} title={v.title} points={v.points} ariaLabel="Le modèle en un coup d'œil" />}
      <PageIntro
        helpHref="/aide#modele"
        points={[
          "Outil d'aide à la décision : chaque estimation est à examiner par une personne.",
          "Les facteurs sont associés au départ, pas des causes.",
          "Aucune donnée individuelle n'est affichée sur cette page.",
        ]}
      >
        Comprendre comment le modèle classe les collaborateurs, avec quelle fiabilité et avec quelle équité entre les groupes.
      </PageIntro>
      <OnThisPage
        items={[
          ...(c ? [{ id: "modele", label: "Comment il décide" }, { id: "performances", label: "Fiabilité" }] : []),
          ...(c?.metrics?.fairness.dimensions.length ? [{ id: "equite", label: "Équité" }] : []),
          { id: "suivi", label: "Suivi mensuel" },
          { id: "technique", label: "Détails techniques" },
        ]}
      />
      {t.coldStart?.message && (
        <div className="mb-4">
          <Notice tone={t.coldStart.active || t.coldStart.indicative ? "warning" : "info"}>{t.coldStart.message}</Notice>
        </div>
      )}

      {!c ? (
        <div className="mb-8">
          <EmptyState title="Aucun modèle en service">
            Les estimations ne sont pas calculées. La mise en service se fait hors de l&apos;interface, par la procédure outillée (voir l&apos;historique des versions
            ci-dessous).
          </EmptyState>
        </div>
      ) : (
        <>
          <Section
            id="modele"
            title="Comment le modèle décide"
            intro={
              <>
                {KIND_PLAIN[c.kind] ?? ""} Il s&apos;appuie uniquement sur des données AJIR : carrière, rémunération, temps de travail, absences hors santé, formation et
                équipe.
              </>
            }
          >
            <HowItDecides c={c} />
            <Levels t={t} admin={ctx.role === "ADMIN"} role={role} />
          </Section>

          <Section id="performances" title="Fiabilité : que valent ses estimations ?">
            {c.metrics ? (
              <>
                <Reliability m={c.metrics} capacityRate={t.decision.capacityRate} />
                <Calibration m={c.metrics} />
              </>
            ) : (
              <EmptyState title="Mesures de performance non disponibles pour ce modèle">Le fichier du modèle ne contient pas de mesures d&apos;évaluation ; les niveaux de risque restent calculés.</EmptyState>
            )}
          </Section>

          {c.metrics && c.metrics.fairness.dimensions.length > 0 && (
            <Section id="equite" title="Équité : le modèle traite-t-il tous les groupes de la même façon ?">
              <Fairness m={c.metrics} />
            </Section>
          )}
        </>
      )}

      <Section
        id="suivi"
        title="Suivi mensuel du modèle"
        intro={
          <>
            Ce que le modèle produit chaque mois. Pour vérifier que les données récentes ressemblent encore à celles de l&apos;apprentissage, voir{" "}
            <Link href="/derive" className="text-link underline underline-offset-2">
              Dérive des données
            </Link>
            .
          </>
        }
      >
        <ModelMonitoringSection m={monitoring} />
      </Section>

      <Section id="technique" title="Détails techniques" intro="Pour les spécialistes : fiche complète, mesures statistiques, modèles par sujet et historique des versions." className="mb-0">
        <div className="space-y-3">
          {c && <Technical c={c} t={t} />}
          <TopicModels models={topics} />
          <Versions t={t} />
        </div>
      </Section>
    </>
  );
}

import { ChartData } from "@/components/charts/pbi";
import { InfoTip } from "@/components/help";
import { actionLabel, formatDate, formatRate, joinFr, lcFirst } from "@/components/pilotage/labels";
import { StatusBadge, cardCls, fmt } from "@/components/ui";
import type { ActionMatching, MatchedComparisonDto, MatchingOutcome, OutcomeEstimate } from "@/lib/dal/intervention-impact";

// Section « Comparaison avec des collaborateurs similaires » de /interventions (RH) : écart et fourchette par type d'action,
// équilibre des groupes, limites dans la bulle « ? ». Écart en bleu neutre, jamais en vert « favorable » :
// une différence entre groupes appariés n'est pas un effet de l'action.

export const MATCHING_TITLE = "Comparaison avec des profils similaires";
export const NON_CAUSAL_BADGE = "Estimation non causale";
export const INSUFFICIENT_LABEL = "Effectif insuffisant pour comparer";
export const VERDICT_LABELS = { COMPARABLE: "Groupes comparables", FRAGILE: "Comparaison fragile" } as const;
const VERDICT_TONE = { COMPARABLE: "success", FRAGILE: "warning" } as const;

export function outcomeLabel(o: MatchingOutcome, d: Pick<MatchedComparisonDto, "horizonMonths" | "levelWindowMonths">): string {
  return o === "DEMISSION_6M" ? `Démission dans les ${d.horizonMonths} mois` : `Niveau de risque en baisse ${d.levelWindowMonths} mois après`;
}

function outcomeHelp(o: MatchingOutcome, d: Pick<MatchedComparisonDto, "horizonMonths" | "levelWindowMonths">): string {
  return o === "DEMISSION_6M"
    ? `Démission ou abandon de poste dans les ${d.horizonMonths} mois qui suivent la fin du mois précédant l'action.`
    : `Niveau plus bas au calcul publié ${d.levelWindowMonths} mois après le mois de l'action qu'au calcul précédant l'action.`;
}

export function intervalReading(o: Pick<OutcomeEstimate, "low" | "high">): string {
  if (o.low == null || o.high == null) return "";
  return o.low <= 0 && o.high >= 0 ? "Aucun écart net (fourchette contenant zéro)" : "Écart net, non causal (fourchette excluant zéro)";
}

const count = (k: number, one: string, many = `${one}s`) => `${fmt.int(k)} ${k > 1 ? many : one}`;
const pct = (v: number | null) => formatRate(v, 1);
const SCALES = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1];

// Bande de la fourchette sur une échelle symétrique autour de zéro, commune aux types d'action d'un même indicateur
function IntervalStrip({ o, scale }: { o: OutcomeEstimate; scale: number }) {
  if (o.diff == null || o.low == null || o.high == null) return null;
  const pos = (v: number) => ((Math.max(-scale, Math.min(scale, v)) + scale) / (2 * scale)) * 100;
  const lo = pos(o.low);
  const hi = pos(o.high);
  const text = `Écart ${fmt.pts(o.diff)}, fourchette de ${fmt.pts(o.low)} à ${fmt.pts(o.high)}. Le trait vertical marque l'absence d'écart.`;
  return (
    <div className="mt-2 max-w-sm">
      <div role="img" aria-label={text} title={text} className="relative h-5">
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-3" />
        <span aria-hidden="true" className="absolute inset-y-0 w-px bg-line-strong" style={{ left: "50%" }} />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-primary-soft ring-1 ring-inset ring-primary/50"
          style={{ left: `${lo.toFixed(2)}%`, width: `${Math.max(0.5, hi - lo).toFixed(2)}%` }}
        />
        <span aria-hidden="true" className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface" style={{ left: `${pos(o.diff).toFixed(2)}%` }} />
      </div>
      <div aria-hidden="true" className="flex justify-between text-[11px] tabular-nums text-fg-subtle">
        <span>{fmt.pts(-scale, 0)}</span>
        <span>0</span>
        <span>{fmt.pts(scale, 0)}</span>
      </div>
    </div>
  );
}

function OutcomeBlock({ o, data, scale }: { o: OutcomeEstimate; data: MatchedComparisonDto; scale: number }) {
  return (
    <div className="rounded-control bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-line">
      <dt className="flex items-center gap-1 text-sm font-medium text-fg">
        {outcomeLabel(o.outcome, data)}
        <InfoTip label={outcomeLabel(o.outcome, data)} align="start">
          {outcomeHelp(o.outcome, data)}
        </InfoTip>
      </dt>
      <dd className="mt-1">
        {o.status === "OK" ? (
          <>
            <p className="text-sm tabular-nums text-fg-muted">
              Suivis : <span className="font-medium text-fg">{pct(o.treatedRate)}</span> · Similaires : <span className="font-medium text-fg">{pct(o.controlRate)}</span>
            </p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-heading">
              Écart : {fmt.pts(o.diff)}{" "}
              <span className="text-sm font-normal text-fg-muted">
                (fourchette de {fmt.pts(o.low)} à {fmt.pts(o.high)})
              </span>
            </p>
            <IntervalStrip o={o} scale={scale} />
            <p className="mt-1 text-xs text-fg-muted">
              {intervalReading(o)} · Paires : {fmt.int(o.pairs)}
            </p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            {INSUFFICIENT_LABEL} : {fmt.int(o.pairs)} / {fmt.int(data.minPairs)} paires
          </p>
        )}
      </dd>
    </div>
  );
}

function fragility(a: ActionMatching, threshold: number): string[] {
  const out: string[] = [];
  if (a.reasons.includes("DESEQUILIBRE")) {
    const off = a.balance.filter((b) => b.smdAfter != null && Math.abs(b.smdAfter) >= threshold).sort((x, y) => Math.abs(y.smdAfter ?? 0) - Math.abs(x.smdAfter ?? 0));
    out.push(
      off.length
        ? `Écarts subsistants : ${joinFr(off.slice(0, 3).map((b) => lcFirst(b.label)))}${off.length > 3 ? ", entre autres" : ""}`
        : "Écarts subsistants après appariement",
    );
  }
  if (a.reasons.includes("APPARIEMENT_PARTIEL") && a.matchedShare != null) out.push(`Appariement partiel : ${formatRate(a.matchedShare, 0)} des suivis`);
  return out;
}

function ActionCard({ a, data, scales }: { a: ActionMatching; data: MatchedComparisonDto; scales: Record<MatchingOutcome, number> }) {
  return (
    <li className="rounded-control bg-surface p-3 ring-1 ring-inset ring-line sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-heading">
          {actionLabel(a.actionCode)}
        </h3>
        {a.status === "OK" && a.verdict ? (
          <StatusBadge tone={VERDICT_TONE[a.verdict]}>{VERDICT_LABELS[a.verdict]}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">{INSUFFICIENT_LABEL}</StatusBadge>
        )}
      </div>
      {a.status === "OK" ? (
        <>
          <p className="mt-1 text-xs text-fg-muted">
            Paires : {fmt.int(a.matched)} · Couverture : {formatRate(a.matchedShare, 0)} des {count(a.comparable, "suivi comparable", "suivis comparables")}
          </p>
          {fragility(a, data.smdThreshold).map((s) => (
            <p key={s} className="mt-1 text-xs text-warning">
              {s}
            </p>
          ))}
          <dl className="mt-3 grid gap-2">
            {a.outcomes.map((o) => (
              <OutcomeBlock key={o.outcome} o={o} data={data} scale={scales[o.outcome]} />
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">
          Suivis comparables : {fmt.int(a.comparable)} / {fmt.int(data.minTreated)} requis
        </p>
      )}
    </li>
  );
}

export function MatchedComparison({ data }: { data: MatchedComparisonDto }) {
  const ok = data.actions.filter((a) => a.status === "OK");
  const scaleOf = (outcome: MatchingOutcome) => {
    const m = Math.max(0, ...ok.flatMap((a) => a.outcomes.filter((o) => o.outcome === outcome && o.status === "OK").flatMap((o) => [Math.abs(o.low ?? 0), Math.abs(o.high ?? 0)])));
    return SCALES.find((s) => s >= m) ?? 1;
  };
  const scales = { DEMISSION_6M: scaleOf("DEMISSION_6M"), NIVEAU_BAISSE: scaleOf("NIVEAU_BAISSE") };
  const level = formatRate(data.level, 0);
  const rows = data.actions.flatMap((a) =>
    a.status === "OK"
      ? a.outcomes.map((o) => [
          actionLabel(a.actionCode),
          outcomeLabel(o.outcome, data),
          fmt.int(o.pairs),
          o.status === "OK" ? pct(o.treatedRate) : "—",
          o.status === "OK" ? pct(o.controlRate) : "—",
          o.status === "OK" ? `${fmt.pts(o.diff)} (${fmt.pts(o.low)} à ${fmt.pts(o.high)})` : "—",
          o.status === "OK" ? fmt.pts(o.naiveDiff) : "—",
        ])
      : [[actionLabel(a.actionCode), INSUFFICIENT_LABEL, "—", "—", "—", "—", "—"]],
  );
  const balanceRows = ok.flatMap((a) =>
    a.balance.map((b) => [actionLabel(a.actionCode), b.label, fmt.num(b.smdBefore, 2), b.smdAfter == null ? "—" : fmt.num(b.smdAfter, 2)]),
  );

  return (
    <section className={`${cardCls} mb-6 overflow-hidden`} aria-labelledby="comparaison-titre">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="comparaison-titre" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-heading">
            {MATCHING_TITLE}
            <StatusBadge tone="neutral" dot={false}>
              {NON_CAUSAL_BADGE}
            </StatusBadge>
          </h2>
          <span className="inline-flex items-center gap-1">
            <InfoTip label="Méthode de comparaison" align="end">
              Chaque collaborateur suivi est comparé à un collaborateur non suivi au profil proche, évalué le même mois. Un modèle estime la probabilité
              d&apos;être suivi, à partir des variables du modèle de risque et du niveau de risque. Ces données sont celles connues à la fin du mois précédant
              l&apos;action. Chaque collaborateur suivi est associé au non-suivi le plus proche, sans réutilisation. Sans voisin assez proche (plus de{" "}
              {fmt.num(data.caliperSd, 1)} écart-type), il reste sans comparaison. Les non-suivis n&apos;ont reçu aucune action dans les {data.washoutMonths}{" "}
              mois avant ou après. La fourchette à {level} vient de {fmt.int(data.bootstrap)} tirages au hasard parmi les paires.
            </InfoTip>
            <InfoTip label="Ce que ce chiffre ne dit pas" align="end">
              Il ne mesure pas l&apos;effet de l&apos;action : c&apos;est une estimation non causale, valable sous hypothèses. Variables non observées :
              motivation, offre d&apos;emploi externe ou vie personnelle ne figurent pas dans AJIR. Sur données simulées, un tel facteur a inversé le sens de
              l&apos;écart, alors que les groupes paraissaient comparables. Choix des personnes suivies : la RH les a retenues pour des raisons que les données
              ne montrent pas toujours. Petits effectifs : la fourchette est large, et un écart peut venir du seul hasard. Aucune décision individuelle ne
              repose sur ce chiffre : il éclaire un choix RH, sans le remplacer.
            </InfoTip>
          </span>
        </div>
        <p className="mt-0.5 text-xs text-fg-subtle">
          Données au {formatDate(data.referenceDate)} · fourchette à {level}
        </p>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        {data.actions.length === 0 ? (
          <p className="text-sm text-fg-muted">Aucune action à comparer</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.actions.map((a) => (
              <ActionCard key={a.actionCode} a={a} data={data} scales={scales} />
            ))}
          </ul>
        )}
        <ChartData
          caption="Comparaison appariée par type d'action et par indicateur"
          table={{ headers: ["Type d'action", "Indicateur", "Paires", "Suivis", "Similaires", `Écart (fourchette à ${level})`, "Écart sans appariement"], rows }}
        />
        {balanceRows.length > 0 && (
          <ChartData
            summary="Voir l'équilibre des groupes"
            caption={`Écarts standardisés avant et après appariement (sous 0,1 : écart négligeable ; à partir de ${fmt.num(data.smdThreshold, 2)} : écart important)`}
            table={{ headers: ["Type d'action", "Variable", "Écart standardisé avant", "Écart standardisé après"], rows: balanceRows }}
          />
        )}
      </div>
    </section>
  );
}

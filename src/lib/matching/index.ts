import { fitRidgeLogistic, linearPredictor, type LogisticFit } from "./logistic";
import { nearestNeighborMatch, type MatchUnit } from "./match";
import { mean, mulberry32, pairBootstrap, smdDenominator, standardizedDifference } from "./stats";

// Comparaison appariée par score de propension (estimation non causale), sans accès base : la DAL fournit les unités.
// 1. Score de propension : régression logistique ridge « suivi ou non » sur les variables observées au mois du calcul.
// 2. Appariement 1:1 au plus proche voisin sur le logit du score, exact sur la strate (mois), caliper = 0,2 écart-type
//    du logit (Austin, 2011), sans remise.
// 3. Diagnostics : différences standardisées avant / après, part appariée, support commun.
// 4. Écart moyen suivis − témoins appariés par indicateur, fourchette percentile par bootstrap des paires.
// Gardes : sous `minTreated` suivis, aucune comparaison ; sous `minPairs` paires mesurées, aucun chiffre pour l'indicateur.

export { fitRidgeLogistic, linearPredictor, propensity, standardize, type LogisticFit } from "./logistic";
export { admissible, nearestNeighborMatch, type MatchUnit, type Pair } from "./match";
export { mulberry32, pairBootstrap, smdDenominator, standardizedDifference } from "./stats";

export const MATCHING_DEFAULTS = {
  caliperSd: 0.2,
  ridge: 1,
  replace: false,
  bootstrap: 2000,
  level: 0.95,
  seed: 20261004,
  minTreated: 20,
  minPairs: 20,
  // Seuil du verdict sur la plus forte |DS| après appariement : 0,25 (Rubin, 2001 ; Stuart, 2010). Avec 27 variables et
  // une centaine de paires, le hasard seul porte ce maximum vers 0,2 : un seuil de 0,1 déclarait tout « fragile »
  // (validation semi-synthétique, docs/RESULTATS_IA_INTERVENTIONS.md § 5.3)
  smdThreshold: 0.25,
  minMatchedShare: 0.8,
};
export type MatchingOptions = typeof MATCHING_DEFAULTS;

export type ComparisonUnit = {
  key: string;
  stratum: string;
  treated: boolean;
  x: number[];
  date?: string | null;
  atRiskUntil?: string | null;
  /** Un indicateur par position ; null = non mesuré (recul insuffisant, sortie…). */
  outcomes: (number | null)[];
};

export type OutcomeComparison = {
  status: "OK" | "INSUFFISANT";
  pairs: number;
  treatedMean: number | null;
  controlMean: number | null;
  diff: number | null;
  low: number | null;
  high: number | null;
  naiveDiff: number | null;
};

export type MatchingVerdict = "COMPARABLE" | "FRAGILE";
export type FragilityReason = "DESEQUILIBRE" | "APPARIEMENT_PARTIEL";

export type ComparisonResult = {
  status: "OK" | "INSUFFISANT";
  treated: number;
  candidates: number;
  matched: number;
  matchedShare: number | null;
  supportShare: number | null;
  caliper: number | null;
  balance: { index: number; smdBefore: number; smdAfter: number | null }[];
  maxSmdBefore: number | null;
  maxSmdAfter: number | null;
  verdict: MatchingVerdict | null;
  reasons: FragilityReason[];
  outcomes: OutcomeComparison[];
  fit: LogisticFit | null;
  pairs: { treated: string; control: string; distance: number }[];
};

const EMPTY_OUTCOME: OutcomeComparison = { status: "INSUFFISANT", pairs: 0, treatedMean: null, controlMean: null, diff: null, low: null, high: null, naiveDiff: null };
const isNum = (v: number | null): v is number => v != null && Number.isFinite(v);
const maxAbs = (xs: number[]) => (xs.length ? Math.max(...xs.map(Math.abs)) : null);

export function compareMatched(units: ComparisonUnit[], nOutcomes: number, options: Partial<MatchingOptions> = {}): ComparisonResult {
  const o = { ...MATCHING_DEFAULTS, ...options };
  const strata = new Set(units.filter((u) => u.treated).map((u) => u.stratum));
  const pool = units.filter((u) => strata.has(u.stratum));
  const tIdx = pool.flatMap((u, i) => (u.treated ? [i] : []));
  const cIdx = pool.flatMap((u, i) => (u.treated ? [] : [i]));
  const empty: ComparisonResult = {
    status: "INSUFFISANT",
    treated: tIdx.length,
    candidates: cIdx.length,
    matched: 0,
    matchedShare: null,
    supportShare: null,
    caliper: null,
    balance: [],
    maxSmdBefore: null,
    maxSmdAfter: null,
    verdict: null,
    reasons: [],
    outcomes: Array.from({ length: nOutcomes }, () => ({ ...EMPTY_OUTCOME })),
    fit: null,
    pairs: [],
  };
  if (tIdx.length < o.minTreated || !cIdx.length) return empty;

  let fit: LogisticFit;
  try {
    fit = fitRidgeLogistic(
      pool.map((u) => u.x),
      pool.map((u) => (u.treated ? 1 : 0)),
      { lambda: o.ridge },
    );
  } catch {
    return empty;
  }
  const scores = pool.map((u) => linearPredictor(fit, u.x));
  const m = mean(scores);
  const sd = Math.sqrt(scores.reduce((s, v) => s + (v - m) * (v - m), 0) / scores.length);
  const caliper = o.caliperSd * sd;
  const matchUnits: MatchUnit[] = pool.map((u, i) => ({ key: u.key, stratum: u.stratum, treated: u.treated, score: scores[i], date: u.date, atRiskUntil: u.atRiskUntil }));
  const pairs = nearestNeighborMatch(matchUnits, { caliper, replace: o.replace });

  const range = new Map<string, [number, number]>();
  for (const i of cIdx) {
    const r = range.get(pool[i].stratum);
    range.set(pool[i].stratum, r ? [Math.min(r[0], scores[i]), Math.max(r[1], scores[i])] : [scores[i], scores[i]]);
  }
  const inSupport = tIdx.filter((i) => {
    const r = range.get(pool[i].stratum);
    return !!r && scores[i] >= r[0] && scores[i] <= r[1];
  }).length;

  const p = pool[0].x.length;
  const balance = Array.from({ length: p }, (_, k) => {
    const tv = tIdx.map((i) => pool[i].x[k]);
    const cv = cIdx.map((i) => pool[i].x[k]);
    const den = smdDenominator(tv, cv);
    return {
      index: k,
      smdBefore: standardizedDifference(tv, cv, den),
      smdAfter: pairs.length
        ? standardizedDifference(
            pairs.map((q) => pool[q.treated].x[k]),
            pairs.map((q) => pool[q.control].x[k]),
            den,
          )
        : null,
    };
  });
  const maxSmdBefore = maxAbs(balance.map((b) => b.smdBefore));
  const maxSmdAfter = pairs.length ? maxAbs(balance.map((b) => b.smdAfter ?? 0)) : null;
  const matchedShare = pairs.length / tIdx.length;
  const reasons: FragilityReason[] = [];
  if (maxSmdAfter == null || maxSmdAfter >= o.smdThreshold) reasons.push("DESEQUILIBRE");
  if (matchedShare < o.minMatchedShare) reasons.push("APPARIEMENT_PARTIEL");

  const outcomes = Array.from({ length: nOutcomes }, (_, j): OutcomeComparison => {
    const measured = pairs.filter((q) => isNum(pool[q.treated].outcomes[j]) && isNum(pool[q.control].outcomes[j]));
    if (measured.length < o.minPairs) return { ...EMPTY_OUTCOME, pairs: measured.length };
    const yt = measured.map((q) => pool[q.treated].outcomes[j] as number);
    const yc = measured.map((q) => pool[q.control].outcomes[j] as number);
    const diffs = yt.map((v, i) => v - yc[i]);
    const ci = pairBootstrap(diffs, o.bootstrap, o.level, mulberry32(o.seed + j));
    const tAll = tIdx.map((i) => pool[i].outcomes[j]).filter(isNum);
    const cAll = cIdx.map((i) => pool[i].outcomes[j]).filter(isNum);
    return {
      status: "OK",
      pairs: measured.length,
      treatedMean: mean(yt),
      controlMean: mean(yc),
      diff: mean(diffs),
      low: ci.low,
      high: ci.high,
      naiveDiff: tAll.length && cAll.length ? mean(tAll) - mean(cAll) : null,
    };
  });

  return {
    status: "OK",
    treated: tIdx.length,
    candidates: cIdx.length,
    matched: pairs.length,
    matchedShare,
    supportShare: inSupport / tIdx.length,
    caliper,
    balance,
    maxSmdBefore,
    maxSmdAfter,
    verdict: reasons.length ? "FRAGILE" : "COMPARABLE",
    reasons,
    outcomes,
    fit,
    pairs: pairs.map((q) => ({ treated: pool[q.treated].key, control: pool[q.control].key, distance: q.distance })),
  };
}

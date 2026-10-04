// Appariement glouton au plus proche voisin sur le logit du score de propension, exact sur la strate (mois du calcul),
// avec caliper. Ordre des suivis : score décroissant (les plus difficiles à apparier d'abord), puis clé ; à distance égale,
// le témoin de plus petite clé. Sans remise par défaut : un témoin sert au plus une fois.

export type MatchUnit = {
  key: string;
  stratum: string;
  treated: boolean;
  score: number;
  /** Suivi : date de l'action. */
  date?: string | null;
  /** Témoin : date à partir de laquelle il n'est plus « à risque » (sortie ou démission) ; exclu pour un suivi d'action postérieure. */
  atRiskUntil?: string | null;
};

export type Pair = { treated: number; control: number; distance: number };

export const admissible = (t: MatchUnit, c: MatchUnit) => !c.atRiskUntil || !t.date || c.atRiskUntil > t.date;

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function nearestNeighborMatch(units: MatchUnit[], opts: { caliper: number; replace?: boolean }): Pair[] {
  const strata = new Map<string, { treated: number[]; controls: number[] }>();
  units.forEach((u, i) => {
    const s = strata.get(u.stratum) ?? { treated: [], controls: [] };
    (u.treated ? s.treated : s.controls).push(i);
    strata.set(u.stratum, s);
  });
  const pairs: Pair[] = [];
  const used = new Set<number>();
  for (const stratum of [...strata.keys()].sort(byKey)) {
    const { treated, controls } = strata.get(stratum)!;
    treated.sort((a, b) => units[b].score - units[a].score || byKey(units[a].key, units[b].key));
    for (const t of treated) {
      const tu = units[t];
      let best = -1;
      let bestD = Infinity;
      for (const c of controls) {
        if (!opts.replace && used.has(c)) continue;
        const cu = units[c];
        if (!admissible(tu, cu)) continue;
        const dist = Math.abs(cu.score - tu.score);
        if (dist < bestD || (dist === bestD && best >= 0 && byKey(cu.key, units[best].key) < 0)) {
          best = c;
          bestD = dist;
        }
      }
      if (best >= 0 && bestD <= opts.caliper) {
        pairs.push({ treated: t, control: best, distance: bestD });
        if (!opts.replace) used.add(best);
      }
    }
  }
  return pairs;
}

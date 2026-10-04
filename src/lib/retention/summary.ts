import { RiskSet, kaplanMeier, medianTime, stopTime, survivalAt, type Subject } from "./km";

// Durées en jours, restituées en mois moyens (365,25 / 12 jours)
export const DAYS_PER_MONTH = 365.25 / 12;
export const MILESTONES = [6, 12, 24, 36, 48] as const;

export type Milestone = { months: number; survival: number | null; lower: number | null; upper: number | null; atRisk: number | null };

export type CurveSummary = {
  n: number;
  events: number;
  // Courbe montrée sur [0, stopMonths] : au-delà, moins de minAtRisk personnes encore suivies
  stopMonths: number;
  medianMonths: number | null;
  milestones: Milestone[];
  // S(t), bornes de l'IC à 95 % : un point par mois d'ancienneté, de 0 à horizonMonths (null au-delà de l'arrêt)
  survival: (number | null)[];
  lower: (number | null)[];
  upper: (number | null)[];
  atRisk: (number | null)[];
};

export const toMonths = (days: number) => days / DAYS_PER_MONTH;

export function summarizeCurve(subjects: Subject[], opts: { minAtRisk: number; horizonMonths: number }): CurveSummary {
  const fit = kaplanMeier(subjects);
  const risk = new RiskSet(subjects);
  const stop = fit.n > 0 ? stopTime(risk, opts.minAtRisk) : 0;
  const shown = (t: number) => stop > 0 && t <= stop;
  const median = medianTime(fit, stop);
  const milestones = MILESTONES.map((months): Milestone => {
    const t = months * DAYS_PER_MONTH;
    if (!shown(t)) return { months, survival: null, lower: null, upper: null, atRisk: null };
    const p = survivalAt(fit, t);
    return { months, ...p, atRisk: risk.at(t) };
  });
  const survival: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const upper: (number | null)[] = [];
  const atRisk: (number | null)[] = [];
  for (let m = 0; m <= opts.horizonMonths; m++) {
    const t = m * DAYS_PER_MONTH;
    const p = shown(t) ? survivalAt(fit, t) : null;
    survival.push(p ? p.survival : null);
    lower.push(p ? p.lower : null);
    upper.push(p ? p.upper : null);
    atRisk.push(p ? (m === 0 ? risk.after(0) : risk.at(t)) : null);
  }
  return { n: fit.n, events: fit.events, stopMonths: toMonths(stop), medianMonths: median == null ? null : toMonths(median), milestones, survival, lower, upper, atRisk };
}

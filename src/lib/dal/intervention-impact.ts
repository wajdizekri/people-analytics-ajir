import "server-only";
import { getDb } from "@/db/client";
import { featureShortLabel } from "@/lib/drift/labels";
import { FEATURE_NAMES, FSV } from "@/lib/features/spec";
import { MATCHING_DEFAULTS, compareMatched, type ComparisonUnit, type FragilityReason, type MatchingVerdict } from "@/lib/matching";
import { opposedEmployeeIds } from "@/lib/privacy";
import { ensureRole } from "./admin";
import type { AccessContext } from "./context";
import { referenceDate, type RiskLevel } from "./employees";
import { ACTIONS_SQL, EFFECT_WINDOW_MONTHS, levelChange } from "./interventions";
import { addMonths, monthEnd } from "./pilotage-metrics";
import { levelsOfRun, publishedRuns, type RunRef } from "./teams";

// Comparaison appariée des collaborateurs suivis et non suivis, par type d'action (RH seulement, agrégats seulement).
// Estimation non causale : elle tient compte des variables observées, jamais des raisons invisibles du choix des personnes suivies.
// - Suivi : première action réalisée de ce type par collaborateur (intervention ou recommandation réalisée), hors opposition.
// - Date « as of » t = fin du mois précédant l'action : variables de feature_snapshot (visibilité à la date de saisie,
//   ADR-005) et niveau de risque du dernier calcul publié au plus tard à t (même règle que l'avant / après de la page).
// - Témoins : collaborateurs évalués au même t, sans aucune action réalisée dans les 6 mois avant ou après t, encore
//   présents et sans démission à la date de l'action du suivi auquel ils sont associés.
// - Indicateurs : démission ou abandon dans les 6 mois (y6 de v_label_panel, suivi complet, ADR-004) ; niveau de risque
//   en baisse au calcul publié dans les 3 mois après le mois de l'action (même lecture que la page).
// Aucun nom, identifiant ni score individuel ne sort de cette fonction ; sous les seuils, aucun chiffre d'indicateur.

export const MATCHING_OUTCOMES = ["DEMISSION_6M", "NIVEAU_BAISSE"] as const;
export type MatchingOutcome = (typeof MATCHING_OUTCOMES)[number];
export const CONTROL_WASHOUT_MONTHS = 6;
export const RESIGNATION_HORIZON_MONTHS = 6;

export const MATCHING_COVARIATES: { code: string; label: string }[] = [
  ...FEATURE_NAMES.map((code) => ({ code, label: featureShortLabel(code) })),
  { code: "level_eleve", label: "Risque élevé au dernier calcul" },
  { code: "level_moyen", label: "Risque moyen au dernier calcul" },
];

export type CovariateBalance = { code: string; label: string; smdBefore: number; smdAfter: number | null };

export type OutcomeEstimate = {
  outcome: MatchingOutcome;
  status: "OK" | "INSUFFISANT";
  pairs: number;
  treatedRate: number | null;
  controlRate: number | null;
  diff: number | null;
  low: number | null;
  high: number | null;
  naiveDiff: number | null;
};

export type ActionMatching = {
  actionCode: string;
  status: "OK" | "INSUFFISANT";
  /** Collaborateurs suivis : première action réalisée de ce type, hors opposition. */
  actions: number;
  /** Dont évalués au mois précédant l'action et encore présents, sans démission, à la date de l'action. */
  comparable: number;
  candidates: number;
  matched: number;
  matchedShare: number | null;
  supportShare: number | null;
  verdict: MatchingVerdict | null;
  reasons: FragilityReason[];
  maxSmdBefore: number | null;
  maxSmdAfter: number | null;
  balance: CovariateBalance[];
  outcomes: OutcomeEstimate[];
};

export type MatchedComparisonDto = {
  referenceDate: string;
  horizonMonths: number;
  levelWindowMonths: number;
  washoutMonths: number;
  minTreated: number;
  minPairs: number;
  level: number;
  bootstrap: number;
  caliperSd: number;
  smdThreshold: number;
  actions: ActionMatching[];
};

type ActionRow = { interventionId: number | null; recommendationId: number | null; employeeId: number; date: string; actionCode: string };
type ExitRow = { employeeId: number; exitDate: string; reason: string | null; eventDate: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const VOLUNTARY = new Set(["DEMISSION", "ABANDON"]);
const BIG = Number.MAX_SAFE_INTEGER;
// t : fin du mois précédant le mois de l'action
export const asOfBefore = (date: string) => monthEnd(addMonths(date.slice(0, 7), -1));

function loadSnapshots(months: string[], opposed: Set<number>): Map<string, Map<number, number[]>> {
  const out = new Map<string, Map<number, number[]>>(months.map((m) => [m, new Map()]));
  const rows = getDb()
    .sqlite.prepare("SELECT employee_id AS id, as_of AS asOf, values_json AS v FROM feature_snapshot WHERE fsv = @fsv AND as_of IN (SELECT value FROM json_each(@months))")
    .all({ fsv: FSV, months: JSON.stringify(months) }) as { id: number; asOf: string; v: string }[];
  for (const r of rows) {
    if (opposed.has(r.id)) continue;
    const x = JSON.parse(r.v) as unknown;
    if (!Array.isArray(x) || x.length !== FEATURE_NAMES.length || !x.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    out.get(r.asOf)?.set(r.id, x as number[]);
  }
  return out;
}

function loadLabels(months: string[]): Map<string, { y6: number; followup: boolean }> {
  const rows = getDb()
    .sqlite.prepare(
      `SELECT employee_id AS id, as_of AS asOf, MAX(y6) AS y6, MAX(followup_complete) AS followup FROM v_label_panel
       WHERE fsv = @fsv AND as_of IN (SELECT value FROM json_each(@months)) GROUP BY employee_id, as_of`,
    )
    .all({ fsv: FSV, months: JSON.stringify(months) }) as { id: number; asOf: string; y6: number; followup: number }[];
  return new Map(rows.map((r) => [`${r.id}|${r.asOf}`, { y6: r.y6 ? 1 : 0, followup: r.followup === 1 }]));
}

function loadExits(): Map<number, ExitRow[]> {
  const rows = getDb()
    .sqlite.prepare(
      `SELECT employee_id AS employeeId, exit_date AS exitDate, reason, COALESCE(resignation_date, date(exit_date, '-1 month')) AS eventDate FROM exit_event
       UNION ALL SELECT id, exit_date, NULL, NULL FROM employee WHERE exit_date IS NOT NULL`,
    )
    .all() as ExitRow[];
  const out = new Map<number, ExitRow[]>();
  for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), r]);
  return out;
}

// Première date, après t, où le collaborateur n'est plus « à risque » : sortie effective, ou date de démission ou d'abandon
// (une démission antérieure à t mais saisie après t compte aussi, si la sortie tombe après t)
function riskUntil(exits: ExitRow[] | undefined, t: string): string | null {
  let until: string | null = null;
  for (const e of exits ?? []) {
    if (e.exitDate <= t) continue;
    for (const d of [e.exitDate, e.reason && VOLUNTARY.has(e.reason) ? e.eventDate : null]) if (d && (!until || d < until)) until = d;
  }
  return until;
}

export function getMatchedComparison(ctx: AccessContext): MatchedComparisonDto {
  ensureRole(ctx, ["RH"], "interventions.view");
  const { sqlite } = getDb();
  const o = MATCHING_DEFAULTS;
  const dto: MatchedComparisonDto = {
    referenceDate: referenceDate(),
    horizonMonths: RESIGNATION_HORIZON_MONTHS,
    levelWindowMonths: EFFECT_WINDOW_MONTHS,
    washoutMonths: CONTROL_WASHOUT_MONTHS,
    minTreated: o.minTreated,
    minPairs: o.minPairs,
    level: o.level,
    bootstrap: o.bootstrap,
    caliperSd: o.caliperSd,
    smdThreshold: o.smdThreshold,
    actions: [],
  };
  const opposed = opposedEmployeeIds(sqlite);
  const all = (sqlite.prepare(ACTIONS_SQL).all() as ActionRow[])
    .filter((a) => !opposed.has(a.employeeId) && ISO.test(a.date))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.interventionId ?? BIG) - (b.interventionId ?? BIG) || (a.recommendationId ?? BIG) - (b.recommendationId ?? BIG),
    );
  if (!all.length) return dto;

  const actionDates = new Map<number, string[]>();
  const firsts = new Map<string, Map<number, ActionRow>>();
  for (const a of all) {
    actionDates.set(a.employeeId, [...(actionDates.get(a.employeeId) ?? []), a.date]);
    const byEmployee = firsts.get(a.actionCode) ?? new Map<number, ActionRow>();
    if (!byEmployee.has(a.employeeId)) byEmployee.set(a.employeeId, a);
    firsts.set(a.actionCode, byEmployee);
  }
  const months = [...new Set([...firsts.values()].flatMap((m) => [...m.values()].map((a) => asOfBefore(a.date))))].sort();
  const snapshots = loadSnapshots(months, opposed);
  const labels = loadLabels(months);
  const exits = loadExits();

  const runs = publishedRuns();
  const levelCache = new Map<number, Map<number, RiskLevel>>();
  const levelsAt = (run: RunRef | null) => {
    if (!run) return null;
    if (!levelCache.has(run.id)) levelCache.set(run.id, levelsOfRun(run.id));
    return levelCache.get(run.id)!;
  };
  const runsCache = new Map<string, { before: Map<number, RiskLevel> | null; after: Map<number, RiskLevel> | null }>();
  // Avant : dernier calcul publié au plus tard à t ; après : dernier calcul au plus tard fin M+3, postérieur au mois M de l'action
  const runsAt = (t: string) => {
    if (!runsCache.has(t)) {
      const month = addMonths(t.slice(0, 7), 1);
      const end = monthEnd(addMonths(month, EFFECT_WINDOW_MONTHS));
      const last = monthEnd(month);
      runsCache.set(t, {
        before: levelsAt(runs.find((r) => r.asOf <= t) ?? null),
        after: levelsAt(runs.find((r) => r.asOf <= end && r.asOf > last) ?? null),
      });
    }
    return runsCache.get(t)!;
  };
  const washedOut = (id: number, t: string) => {
    const from = monthEnd(addMonths(t.slice(0, 7), -CONTROL_WASHOUT_MONTHS));
    const to = monthEnd(addMonths(t.slice(0, 7), CONTROL_WASHOUT_MONTHS));
    return (actionDates.get(id) ?? []).some((d) => d > from && d <= to);
  };
  const unit = (id: number, t: string, x: number[], treated: boolean, date: string | null): ComparisonUnit => {
    const r = runsAt(t);
    const before = r.before?.get(id) ?? null;
    const after = r.after?.get(id) ?? null;
    const label = labels.get(`${id}|${t}`);
    return {
      key: `${treated ? "s" : "t"}${id}@${t}`,
      stratum: t,
      treated,
      x: [...x, before === "ELEVE" ? 1 : 0, before === "MOYEN" ? 1 : 0],
      date,
      atRiskUntil: treated ? null : riskUntil(exits.get(id), t),
      outcomes: [label?.followup ? label.y6 : null, before && after ? (levelChange(before, after) === "BAISSE" ? 1 : 0) : null],
    };
  };

  for (const code of [...firsts.keys()].sort()) {
    const actions = [...firsts.get(code)!.values()];
    const treated: ComparisonUnit[] = [];
    for (const a of actions) {
      const t = asOfBefore(a.date);
      const x = snapshots.get(t)?.get(a.employeeId);
      if (!x) continue;
      const until = riskUntil(exits.get(a.employeeId), t);
      if (until && until <= a.date) continue;
      treated.push(unit(a.employeeId, t, x, true, a.date));
    }
    const controls =
      treated.length < o.minTreated
        ? []
        : [...new Set(treated.map((u) => u.stratum))].flatMap((t) =>
            [...(snapshots.get(t) ?? new Map<number, number[]>()).entries()].filter(([id]) => !washedOut(id, t)).map(([id, x]) => unit(id, t, x, false, null)),
          );
    const res = compareMatched([...treated, ...controls], MATCHING_OUTCOMES.length);
    dto.actions.push({
      actionCode: code,
      status: res.status,
      actions: actions.length,
      comparable: treated.length,
      candidates: res.candidates,
      matched: res.matched,
      matchedShare: res.matchedShare,
      supportShare: res.supportShare,
      verdict: res.verdict,
      reasons: res.reasons,
      maxSmdBefore: res.maxSmdBefore,
      maxSmdAfter: res.maxSmdAfter,
      balance: res.balance
        .map((b) => ({ ...MATCHING_COVARIATES[b.index], smdBefore: b.smdBefore, smdAfter: b.smdAfter }))
        .sort((a, b) => Math.abs(b.smdBefore) - Math.abs(a.smdBefore)),
      outcomes: res.outcomes.map((r, j) => ({
        outcome: MATCHING_OUTCOMES[j],
        status: r.status,
        pairs: r.pairs,
        treatedRate: r.treatedMean,
        controlRate: r.controlMean,
        diff: r.diff,
        low: r.low,
        high: r.high,
        naiveDiff: r.naiveDiff,
      })),
    });
  }
  return dto;
}

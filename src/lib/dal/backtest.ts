import "server-only";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { readSnapshots } from "@/lib/features";
import { toDay } from "@/lib/features/dates";
import { loadChampion, rankAndLevel, type LoadedModel } from "@/lib/scoring";
import { getSetting } from "@/lib/settings";
import { isGlobal, type AccessContext } from "./context";
import type { AuditMeta, RiskLevel } from "./employees";
import { forbidden } from "./errors";

export const backtestQuerySchema = z.object({ mois: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
export type BacktestQuery = z.output<typeof backtestQuerySchema>;

export type BacktestSource = "RUN" | "CALCUL";
export type BacktestGroup = {
  key: "ELEVE" | "MOYEN" | "ELEVE_MOYEN";
  flagged: number;
  hits: number;
  precision: number | null;
  recall: number | null;
  lift: number | null;
  meanDelayDays: number | null;
};
export type BacktestPerson = {
  id: number;
  matricule: string;
  name: string;
  department: string | null;
  level: RiskLevel;
  rank: number;
  score: number;
  resigned: boolean;
  eventDate: string | null;
  delayDays: number | null;
};
/** Parts de 0 à 1 : collaborateurs contactés par rang (share) et démissions repérées parmi eux (captured). */
export type BacktestGainPoint = { share: number; captured: number };
/** Démissions d'un mois suivant l'origine (« AAAA-MM »), selon le niveau de risque à l'origine. */
export type BacktestMonth = { month: string; levels: Record<RiskLevel, number> };
export type BacktestDto = {
  model: { version: string; kind: "B0" | "LOGREG"; trainFrom: string | null; trainTo: string | null; promotedAt: string | null } | null;
  dataEndDate: string | null;
  months: { month: string; asOf: string; source: BacktestSource }[];
  requestedUnavailable: boolean;
  result: {
    asOf: string;
    source: BacktestSource;
    n: number;
    positives: number;
    baseRate: number | null;
    seenInTraining: boolean | null;
    groups: BacktestGroup[];
    missedPositives: number;
    people: BacktestPerson[];
    /** Agrégats sans identité : courbe de gain, démissions des 6 mois suivants, démissions sans date connue. */
    gain: BacktestGainPoint[];
    byMonth: BacktestMonth[];
    undated: number;
  } | null;
};

type Scored = { id: number; score: number; level: RiskLevel; rank: number };
type Label = { id: number; y6: number; fc: number; eventDate: string | null };
// event = COALESCE(resignation_date, date(exit_date, '-1 month')) et horizon = date(as_of, '+6 months'), calculés
// par SQLite comme dans v_label_panel.
export type ExitRow = { id: number; resignationDate: string | null; exitDate: string; recordedAt: string; event: string };

// Date de l'événement comptée par le backtest, strictement postérieure à l'origine (E2E-06). Démission posée avant
// l'origine mais saisie après (2e cas de y6 dans v_label_panel) : avec une date de démission connue, c'est elle qui
// compte (salarié déjà démissionnaire à l'origine : exclu du backtest) ; sans elle, la seule date observée après
// l'origine est la sortie.
export function backtestEvent(asOf: string, horizon: string, exits: ExitRow[]): { date: string } | "AVANT_ORIGINE" | null {
  let before = false;
  for (const x of exits) {
    const event = x.event;
    if (event > asOf && event <= horizon) return { date: event };
    if (event <= asOf && x.recordedAt > asOf && x.exitDate > asOf && x.exitDate <= horizon) {
      if (!x.resignationDate) return { date: x.exitDate };
      before = true;
    }
  }
  return before ? "AVANT_ORIGINE" : null;
}

// Courbe de gain : collaborateurs contactés par rang (risque le plus haut d'abord), démissions repérées en cumul.
// Un point par centième de l'effectif (un par collaborateur en dessous de 100).
export function gainCurve(resigned: boolean[]): BacktestGainPoint[] {
  const n = resigned.length;
  const positives = resigned.filter(Boolean).length;
  if (!n || !positives) return [];
  const cum = [0];
  for (const r of resigned) cum.push(cum[cum.length - 1] + (r ? 1 : 0));
  const steps = Math.min(100, n);
  return Array.from({ length: steps + 1 }, (_, k) => {
    const top = Math.round((n * k) / steps);
    return { share: top / n, captured: cum[top] / positives };
  });
}

// Démissions par mois calendaire après l'origine : du mois suivant l'origine au mois de l'horizon (6 mois)
export function resignationsByMonth(asOf: string, events: { level: RiskLevel; eventDate: string | null }[]): { byMonth: BacktestMonth[]; undated: number } {
  const index = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  const start = index(asOf);
  const byMonth: BacktestMonth[] = Array.from({ length: 6 }, (_, k) => {
    const m = start + k + 1;
    return { month: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`, levels: { ELEVE: 0, MOYEN: 0, FAIBLE: 0 } };
  });
  let undated = 0;
  for (const e of events) {
    if (!e.eventDate) undated++;
    else byMonth[Math.min(6, Math.max(1, index(e.eventDate) - start)) - 1].levels[e.level]++;
  }
  return { byMonth, undated };
}

function numSetting(sqlite: Database.Database, key: string, fallback: number): number {
  const v = Number(getSetting(sqlite, key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const str = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? v : null);

// Période d'entraînement (train_from / train_to) lue dans le bundle du manifeste ou dans les métriques, si renseignée.
function trainingPeriod(manifestJson: string | null, metricsJson: string | null): { from: string | null; to: string | null } {
  const sources: Record<string, unknown>[] = [];
  try {
    const bundle = (JSON.parse(manifestJson ?? "null") as { bundle?: Record<string, unknown> } | null)?.bundle;
    if (bundle) sources.push(bundle, (bundle.metrics as Record<string, unknown>) ?? {});
    sources.push((JSON.parse(metricsJson ?? "null") as Record<string, unknown> | null) ?? {});
  } catch {
    return { from: null, to: null };
  }
  for (const s of sources) {
    const from = str(s.train_from);
    const to = str(s.train_to);
    if (from || to) return { from, to };
  }
  return { from: null, to: null };
}

function scoredRows(sqlite: Database.Database, model: LoadedModel, asOf: string, runId: number | null): Scored[] {
  if (runId != null)
    return sqlite.prepare("SELECT employee_id AS id, prob6 AS score, level, rank FROM prediction WHERE run_id = ?").all(runId) as Scored[];
  const rows = rankAndLevel(model, readSnapshots(sqlite, asOf, model.fsv), numSetting(sqlite, "capacity_rate", 0.02), numSetting(sqlite, "medium_lift", 2));
  return rows.map((r) => ({ id: r.employeeId, score: r.score, level: r.level, rank: r.rank }));
}

function groupStats(key: BacktestGroup["key"], rows: (Scored & { label: Label; delay: number | null })[], positives: number, baseRate: number | null): BacktestGroup {
  const flagged = rows.filter((r) => (key === "ELEVE_MOYEN" ? r.level !== "FAIBLE" : r.level === key));
  const hits = flagged.filter((r) => r.label.y6 === 1);
  const precision = flagged.length ? hits.length / flagged.length : null;
  const delays = hits.map((r) => r.delay).filter((d): d is number => d != null);
  return {
    key,
    flagged: flagged.length,
    hits: hits.length,
    precision,
    recall: positives ? hits.length / positives : null,
    lift: precision != null && baseRate ? precision / baseRate : null,
    meanDelayDays: delays.length ? delays.reduce((s, d) => s + d, 0) / delays.length : null,
  };
}

// Backtest du champion à une date d'origine passée : niveaux du run enregistré (ou calculés à la volée sur feature_snapshot),
// confrontés aux démissions des 6 mois suivants (v_label_panel, lignes à suivi complet ; dates strictement postérieures
// à l'origine, voir backtestEvent). RH seulement (liste nominative).
export function getBacktest(ctx: AccessContext, q: BacktestQuery, meta: AuditMeta): BacktestDto {
  const target = { type: "backtest", id: q.mois ?? null };
  if (!isGlobal(ctx)) {
    audit(ctx.userId, "backtest.view", target, "REFUSE", { source: meta.source }, meta.ip);
    throw forbidden();
  }
  const { sqlite } = getDb();
  const end = getSetting(sqlite, "data_end_date");
  const dataEndDate = /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;
  const model = loadChampion(sqlite);
  if (!model) return { model: null, dataEndDate, months: [], requestedUnavailable: false, result: null };

  const row = sqlite.prepare("SELECT manifest_json AS m, metrics_json AS x, promoted_at AS p FROM model_version WHERE id = ?").get(model.id) as {
    m: string | null;
    x: string | null;
    p: string | null;
  };
  const period = model.kind === "B0" ? { from: null, to: null } : trainingPeriod(row.m, row.x);
  const modelDto = { version: model.version, kind: model.kind, trainFrom: period.from, trainTo: period.to, promotedAt: row.p };

  const monthRows = sqlite
    .prepare(
      `SELECT s.as_of AS asOf, (SELECT r.id FROM scoring_run r WHERE r.as_of = s.as_of AND r.model_version_id = @model AND r.status = 'PUBLIE') AS runId
       FROM (SELECT DISTINCT as_of FROM feature_snapshot WHERE fsv = @fsv) s
       WHERE date(s.as_of, '+6 months') <= COALESCE((SELECT value FROM app_setting WHERE key = 'data_end_date'), '0000-00-00')
       ORDER BY s.as_of DESC`,
    )
    .all({ model: model.id, fsv: model.fsv }) as { asOf: string; runId: number | null }[];
  const months = monthRows.map((m) => ({ month: m.asOf.slice(0, 7), asOf: m.asOf, source: (m.runId != null ? "RUN" : "CALCUL") as BacktestSource }));
  const requested = q.mois ? monthRows.find((m) => m.asOf.startsWith(q.mois!)) : undefined;
  const chosen = requested ?? monthRows[0];
  const requestedUnavailable = q.mois != null && !requested;
  if (!chosen) return { model: modelDto, dataEndDate, months, requestedUnavailable, result: null };

  const asOf = chosen.asOf;
  const labels = new Map(
    (
      sqlite
        .prepare(
          `SELECT employee_id AS id, MAX(y6) AS y6, MAX(followup_complete) AS fc, MIN(CASE WHEN y6 = 1 THEN event_date END) AS eventDate
           FROM v_label_panel WHERE as_of = ? AND fsv = ? GROUP BY employee_id`,
        )
        .all(asOf, model.fsv) as Label[]
    ).map((l) => [l.id, l]),
  );
  const exits = new Map<number, ExitRow[]>();
  for (const x of sqlite
    .prepare(
      `SELECT employee_id AS id, resignation_date AS resignationDate, exit_date AS exitDate, recorded_at AS recordedAt,
              COALESCE(resignation_date, date(exit_date, '-1 month')) AS event
       FROM exit_event WHERE reason IN ('DEMISSION', 'ABANDON') AND exit_date > ?`,
    )
    .all(asOf) as ExitRow[])
    exits.set(x.id, [...(exits.get(x.id) ?? []), x]);
  const horizon = (sqlite.prepare("SELECT date(?, '+6 months') AS h").get(asOf) as { h: string }).h;
  const origin = toDay(asOf);
  const rows = scoredRows(sqlite, model, asOf, chosen.runId)
    .flatMap((s) => {
      const l = labels.get(s.id);
      if (!l || l.fc !== 1) return [];
      if (l.y6 !== 1) return [{ ...s, label: { ...l, eventDate: null }, delay: null }];
      const ev = backtestEvent(asOf, horizon, exits.get(s.id) ?? []);
      if (ev === "AVANT_ORIGINE") return [];
      const label = { ...l, eventDate: ev?.date ?? null };
      return [{ ...s, label, delay: ev ? toDay(ev.date) - origin : null }];
    })
    .sort((a, b) => a.rank - b.rank);

  const n = rows.length;
  const positives = rows.filter((r) => r.label.y6 === 1).length;
  const baseRate = n ? positives / n : null;
  const groups = (["ELEVE", "MOYEN", "ELEVE_MOYEN"] as const).map((k) => groupStats(k, rows, positives, baseRate));

  const flagged = rows.filter((r) => r.level !== "FAIBLE");
  const identity = new Map(
    (
      sqlite
        .prepare(
          `SELECT e.id, e.matricule, e.last_name || ' ' || e.first_name AS name, d.name AS department
           FROM employee e LEFT JOIN department d ON d.id = e.department_id WHERE e.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(flagged.map((r) => r.id))) as { id: number; matricule: string; name: string; department: string | null }[]
    ).map((e) => [e.id, e]),
  );
  const people = flagged.map((r) => {
    const e = identity.get(r.id);
    return {
      id: r.id,
      matricule: e?.matricule ?? "",
      name: e?.name ?? "",
      department: e?.department ?? null,
      level: r.level,
      rank: r.rank,
      score: r.score,
      resigned: r.label.y6 === 1,
      eventDate: r.label.y6 === 1 ? r.label.eventDate : null,
      delayDays: r.delay,
    };
  });

  const timeline = resignationsByMonth(
    asOf,
    rows.filter((r) => r.label.y6 === 1).map((r) => ({ level: r.level, eventDate: r.label.eventDate })),
  );

  const m = asOf.slice(0, 7);
  const seenInTraining =
    model.kind === "B0" || !period.from || !period.to ? null : m >= period.from.slice(0, 7) && m <= period.to.slice(0, 7);

  audit(ctx.userId, "backtest.view", { type: "backtest", id: m }, "OK", { source: meta.source, model: model.version, origin: chosen.runId != null ? "RUN" : "CALCUL" }, meta.ip);
  return {
    model: modelDto,
    dataEndDate,
    months,
    requestedUnavailable,
    result: {
      asOf,
      source: chosen.runId != null ? "RUN" : "CALCUL",
      n,
      positives,
      baseRate,
      seenInTraining,
      groups,
      missedPositives: positives - groups[2].hits,
      people,
      gain: gainCurve(rows.map((r) => r.label.y6 === 1)),
      byMonth: timeline.byMonth,
      undated: timeline.undated,
    },
  };
}

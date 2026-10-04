import type Database from "better-sqlite3";
import { fromDay, toDay } from "@/lib/features/dates";
import { championTopicModel, loadBundle } from "../registry";
import { forecastUnit, validateBundle, windowStats, type AbsBundle, type Pair } from "./model";
import { ABS_ACTIONS, draftRecommendations, recoSettings, type UnitContext } from "./recommendations";
import { AbsCalendar, activeAt, computeSeries, loadOrg, mEnd, mi, ml, parentOf, scopeOf, unitLabel, type Org } from "./series";

export type AbsForecastRow = {
  unit: string;
  scope: "ENTREPRISE" | "DEPARTEMENT" | "EQUIPE";
  departmentId: number | null;
  managerId: number | null;
  month: string;
  horizon: number;
  value: number;
  lower: number;
  upper: number;
};

// Responsable d'un département : unique salarié actif du département sans manager (sinon aucun : recommandations à la RH).
function departmentHeads(sqlite: Database.Database): Map<number, number> {
  const rows = sqlite
    .prepare("SELECT department_id AS d, min(id) AS id, count(*) AS n FROM employee WHERE status = 'ACTIF' AND manager_id IS NULL AND department_id IS NOT NULL GROUP BY department_id")
    .all() as { d: number; id: number; n: number }[];
  return new Map(rows.filter((r) => r.n === 1).map((r) => [r.d, r.id]));
}

const activeManagers = (sqlite: Database.Database) =>
  new Set((sqlite.prepare("SELECT id FROM employee WHERE status = 'ACTIF'").all() as { id: number }[]).map((r) => r.id));

// Prévisions des unités éligibles (>= min_group actifs en fin de mois) à l'origine asOf, sans écriture.
export function forecastAt(sqlite: Database.Database, bundle: AbsBundle, asOf: string, org: Org = loadOrg(sqlite), cal: AbsCalendar = AbsCalendar.load(sqlite)) {
  const o = mi(asOf.slice(0, 7));
  const oe = mEnd(o);
  const series = computeSeries(sqlite, org, cal, o - 11, o, oe + bundle.visibility_lag_days);
  const active = activeAt(org, oe);
  const pair = (u: string): Pair => {
    const s = series.get(u);
    return s ? [s.num, s.den] : [new Array(12).fill(0), new Array(12).fill(0)];
  };
  const company = pair("E");
  const rows: AbsForecastRow[] = [];
  const units: { unit: string; ma12: number; ma3: number; active: number }[] = [];
  for (const [unit, n] of [...active.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n < bundle.min_group) continue;
    const own = pair(unit);
    const w = windowStats(own[0], own[1]);
    if (!w || own[1][11] <= 0) continue;
    const scope = scopeOf(unit);
    const parent = parentOf(org, unit, oe);
    const departmentId = scope === "DEPARTEMENT" ? Number(unit.slice(1)) : scope === "EQUIPE" && parent !== "E" ? Number(parent.slice(1)) : null;
    units.push({ unit, ma12: w[0], ma3: w[1], active: n });
    for (const h of bundle.horizons) {
      const f = forecastUnit(bundle, h, scope, own, pair(parent), company, cal.monthFeatures(o + h), cal.monthFeatures(o + h - 12));
      rows.push({ unit, scope, departmentId, managerId: scope === "EQUIPE" ? Number(unit.slice(1)) : null, month: ml(o + h), horizon: h, value: f.value, lower: f.lower, upper: f.upper });
    }
  }
  const companyStats = windowStats(company[0], company[1]);
  return { rows, units, companyMa12: companyStats ? companyStats[0] : 0, cal, org, origin: o };
}

// Étape du batch mensuel : prévisions 1-3 mois (forecast) et recommandations collectives (insight_recommendation). Idempotente.
export function runStep(sqlite: Database.Database, asOf: string): { summary: string } {
  const champion = championTopicModel(sqlite, "ABSENTEISME");
  if (!champion) return { summary: "aucun modèle champion (npm run topic-model -- register ABSENTEISME <dossier> puis promote)" };
  const bundle = validateBundle(loadBundle<AbsBundle>(champion));
  const { rows, units, companyMa12, cal, org, origin } = forecastAt(sqlite, bundle, asOf);
  if (!rows.length) return { summary: `aucune unité éligible au ${asOf}` };
  const settings = recoSettings(sqlite);
  const heads = departmentHeads(sqlite);
  const actives = activeManagers(sqlite);
  const asOfMonth = asOf.slice(0, 7);
  const since = fromDay(toDay(asOf) - 91);

  const anomalyRows = sqlite
    .prepare(
      `SELECT scope, department_id AS d, manager_id AS m, period_start AS s FROM anomaly
       WHERE scope IN ('EQUIPE','DEPARTEMENT') AND metric = 'taux_absence_hebdo' AND period_end > @since AND period_start <= @asOf ORDER BY period_start`,
    )
    .all({ since, asOf }) as { scope: string; d: number | null; m: number | null; s: string }[];
  const anomaliesOf = (unit: string) => {
    const id = Number(unit.slice(1));
    const list = anomalyRows.filter((a) => (unit.startsWith("T") ? a.scope === "EQUIPE" && a.m === id : unit.startsWith("D") ? a.d === id : false));
    return { count: list.length, lastStart: list.length ? list[list.length - 1].s : null };
  };

  const insertForecast = sqlite.prepare(
    `INSERT INTO forecast (topic, scope, department_id, manager_id, as_of, month, horizon, value, lower, upper, model_version)
     VALUES ('ABSENTEISME', @scope, @departmentId, @managerId, @asOf, @month, @horizon, @value, @lower, @upper, @version)`,
  );
  const openSame = sqlite.prepare("SELECT 1 FROM insight_recommendation WHERE topic = 'ABSENTEISME' AND status = 'PROPOSEE' AND dedup_key LIKE ? AND dedup_key <> ? LIMIT 1");
  const insertReco = sqlite.prepare(
    `INSERT OR IGNORE INTO insight_recommendation (topic, scope, audience, department_id, manager_id, employee_id, action_code, title, rationale, priority, dedup_key)
     VALUES ('ABSENTEISME', @scope, @audience, @departmentId, @managerId, NULL, @action, @title, @rationale, @priority, @dedupKey)`,
  );

  let created = 0;
  sqlite
    .transaction(() => {
      sqlite.prepare("DELETE FROM forecast WHERE topic = 'ABSENTEISME' AND as_of = ?").run(asOf);
      for (const r of rows) insertForecast.run({ ...r, asOf, version: bundle.version });
      for (const u of units) {
        const fc = rows.filter((r) => r.unit === u.unit);
        const first = fc[0];
        const ctxUnit: UnitContext = {
          unit: u.unit,
          scope: first.scope,
          label: unitLabel(org, u.unit),
          active: u.active,
          ma12: u.ma12,
          ma3: u.ma3,
          companyMa12,
          forecasts: fc.map((f) => ({ month: f.month, value: f.value, lower: f.lower, upper: f.upper, cal: cal.monthFeatures(origin + f.horizon) })),
          anomalies: anomaliesOf(u.unit),
        };
        for (const d of draftRecommendations(ctxUnit, settings)) {
          const dedupKey = `abs:${u.unit}:${asOfMonth}:${d.action}`;
          if (openSame.get(`abs:${u.unit}:%:${d.action}`, dedupKey)) continue;
          // Équipe : son manager s'il est toujours en poste ; département : son responsable ; sinon (et entreprise) : la RH.
          const managerId = first.scope === "EQUIPE" ? (actives.has(first.managerId!) ? first.managerId : null) : first.scope === "DEPARTEMENT" ? (heads.get(first.departmentId!) ?? null) : null;
          const audience = managerId != null ? "MANAGER" : "RH";
          created += insertReco.run({
            scope: first.scope,
            audience,
            departmentId: first.departmentId,
            managerId: first.scope === "EQUIPE" ? first.managerId : managerId,
            action: d.action,
            title: ABS_ACTIONS[d.action],
            rationale: d.rationale,
            priority: d.priority,
            dedupKey,
          }).changes;
        }
      }
    })
    .immediate();
  return { summary: `${rows.length} prévisions (${units.length} unités, ${bundle.version}), ${created} recommandation(s) créée(s)` };
}

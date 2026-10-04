import type Database from "better-sqlite3";
import { computeWorkforce, observedMassByYear, readBudgets } from "./compute";
import { loadWorkforceModels } from "./models";
import { buildWorkforceRecommendations } from "./recommendations";

const TOPICS = ["EFFECTIF", "MASSE_SALARIALE"] as const;

// Étape du batch mensuel : projection de référence à 12 mois (embauches au rythme des 12 derniers mois, hausse de janvier
// observée) écrite dans forecast, puis recommandations RH. Idempotente pour un même asOf (fin du mois calculé).
export function runStep(sqlite: Database.Database, asOf: string): { summary: string } {
  const models = loadWorkforceModels(sqlite);
  if (!models) return { summary: "aucun modèle champion EFFECTIF" };
  const month0 = asOf.slice(0, 7);
  const hasAgg = sqlite.prepare("SELECT 1 FROM agg_kpi_monthly WHERE month = ? LIMIT 1").get(month0);
  if (!hasAgg) return { summary: `agrégats du mois ${month0} absents` };

  const { state, members, proj } = computeWorkforce(sqlite, asOf, models);
  const recos = buildWorkforceRecommendations({ asOf, proj, state, members, budgets: readBudgets(sqlite), observedMass: observedMassByYear(sqlite, month0) });

  const insForecast = sqlite.prepare(
    `INSERT INTO forecast (topic, scope, department_id, manager_id, as_of, month, horizon, value, lower, upper, model_version)
     VALUES (@topic, @scope, @departmentId, NULL, @asOf, @month, @horizon, @value, @lower, @upper, @modelVersion)`,
  );
  const upsertReco = sqlite.prepare(
    `INSERT INTO insight_recommendation (topic, scope, audience, department_id, action_code, title, rationale, priority, dedup_key)
     VALUES (@topic, @scope, 'RH', @departmentId, @actionCode, @title, @rationale, @priority, @dedupKey)
     ON CONFLICT(dedup_key) DO UPDATE SET title = excluded.title, rationale = excluded.rationale, priority = excluded.priority`,
  );
  let nForecast = 0;
  let removed = 0;
  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM forecast WHERE as_of = ? AND topic IN (${TOPICS.map(() => "?").join(",")})`).run(asOf, ...TOPICS);
    const series = [
      { scope: "ENTREPRISE", departmentId: null as number | null, s: proj.total },
      ...proj.departments.filter((d) => d.hc0 > 0 || d.hires.some((h) => h > 0)).map((d) => ({ scope: "DEPARTEMENT", departmentId: d.id as number | null, s: d })),
    ];
    for (const { scope, departmentId, s } of series) {
      proj.months.forEach((month, i) => {
        const base = { scope, departmentId, asOf, month, horizon: i + 1 };
        insForecast.run({ ...base, topic: "EFFECTIF", value: s.hc[i], lower: s.hcLower[i], upper: s.hcUpper[i], modelVersion: models.rowE.version });
        nForecast++;
        if (s.mass && s.massLower && s.massUpper && models.rowM) {
          insForecast.run({ ...base, topic: "MASSE_SALARIALE", value: s.mass[i], lower: s.massLower[i], upper: s.massUpper[i], modelVersion: models.rowM.version });
          nForecast++;
        }
      });
    }
    for (const r of recos) upsertReco.run(r);
    const keep = new Set(recos.map((r) => r.dedupKey));
    const stale = sqlite
      .prepare(`SELECT id, dedup_key AS k FROM insight_recommendation WHERE status = 'PROPOSEE' AND topic IN ('EFFECTIF','MASSE_SALARIALE') AND dedup_key LIKE ?`)
      .all(`%:${asOf}`) as { id: number; k: string }[];
    const del = sqlite.prepare("DELETE FROM insight_recommendation WHERE id = ?");
    for (const r of stale) if (!keep.has(r.k)) removed += del.run(r.id).changes;
  })();

  const t = proj.total;
  const H = proj.months.length;
  const massPart = t.mass && t.mass0 != null ? ` ; masse mensuelle ${Math.round(t.mass0)} → ${Math.round(t.mass[H - 1])} TND` : "";
  return {
    summary:
      `${nForecast} prévisions au ${asOf} (effectif ${t.hc0} → ${t.hc[H - 1].toFixed(1)} à ${H} mois${massPart}), ` +
      `${recos.length} recommandation(s)${removed ? `, ${removed} retirée(s)` : ""}, démissions : ${state.resignSource === "LOGREG" ? "probabilités publiées" : "taux historiques"}`,
  };
}

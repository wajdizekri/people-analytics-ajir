import type Database from "better-sqlite3";
import { FSV, computeFeatures } from "../features";

// Droit d'opposition (loi organique n° 2004-63, art. 42 : « l'opposition suspend immédiatement le traitement »).
// Un salarié présent dans employee_opposition est exclu de tout traitement prédictif individuel :
// variables mensuelles (backfillFeatures) et panel d'entraînement (scripts/export-panel.ts), donc tout réentraînement ;
// scoring (ni prédiction ni facteur), what-if, recommandations et alertes turnover, risques individuels des étapes IA.
// Fonctions sans « server-only » : utilisables par le worker, les scripts et les étapes IA (src/lib/ai/*/step.ts).

export const OPPOSITION_LABEL = "Opposition au traitement prédictif";

export type Opposition = { employeeId: number; since: string; requestId: number | null; recordedBy: number | null };

export type PurgeCounts = {
  predictions: number;
  factors: number;
  snapshots: number;
  recommendations: number;
  alerts: number;
  trainingRisks: number;
  insights: number;
};

export { excludeOpposed, isOpposed, opposedEmployeeIds } from "./opposition";

export function getOpposition(sqlite: Database.Database, employeeId: number): Opposition | null {
  const row = sqlite
    .prepare("SELECT employee_id AS employeeId, since, request_id AS requestId, recorded_by AS recordedBy FROM employee_opposition WHERE employee_id = ?")
    .get(employeeId) as Opposition | undefined;
  return row ?? null;
}

// Supprime les résultats prédictifs individuels déjà calculés. Les recommandations déjà réalisées ou rejetées
// (décisions RH tracées, interventions) sont conservées, détachées de la prédiction supprimée.
// À appeler dans une transaction.
export function purgePredictiveData(sqlite: Database.Database, employeeId: number): PurgeCounts {
  const run = (sql: string) => sqlite.prepare(sql).run(employeeId).changes;
  const factors = run("DELETE FROM prediction_factor WHERE prediction_id IN (SELECT id FROM prediction WHERE employee_id = ?)");
  const recommendations = run("DELETE FROM recommendation WHERE employee_id = ? AND status = 'PROPOSEE'");
  run("UPDATE recommendation SET prediction_id = NULL WHERE employee_id = ? AND prediction_id IS NOT NULL");
  return {
    predictions: run("DELETE FROM prediction WHERE employee_id = ?"),
    factors,
    snapshots: run("DELETE FROM feature_snapshot WHERE employee_id = ?"),
    recommendations,
    alerts: run("DELETE FROM alert WHERE employee_id = ? AND type = 'TURNOVER'"),
    trainingRisks: run("DELETE FROM training_risk WHERE employee_id = ?"),
    insights: run("DELETE FROM insight_recommendation WHERE employee_id = ? AND scope = 'SALARIE' AND status = 'PROPOSEE'"),
  };
}

export function recordOpposition(
  sqlite: Database.Database,
  o: { employeeId: number; requestId?: number | null; userId?: number | null; since?: string },
): { created: boolean; purged: PurgeCounts } {
  return sqlite
    .transaction(() => {
      const created =
        sqlite
          .prepare("INSERT OR IGNORE INTO employee_opposition (employee_id, since, request_id, recorded_by) VALUES (?, ?, ?, ?)")
          .run(o.employeeId, o.since ?? new Date().toISOString(), o.requestId ?? null, o.userId ?? null).changes === 1;
      return { created, purged: purgePredictiveData(sqlite, o.employeeId) };
    })
    .immediate();
}

// Levée : le salarié redevient éligible au prochain calcul. Rien de ce qui a été supprimé n'est restauré ; seules ses
// variables du dernier mois calculé sont recalculées, sinon un recalcul du même mois (variables réutilisées) l'ignorerait.
export function liftOpposition(sqlite: Database.Database, employeeId: number): boolean {
  if (sqlite.prepare("DELETE FROM employee_opposition WHERE employee_id = ?").run(employeeId).changes !== 1) return false;
  const last = (sqlite.prepare("SELECT MAX(as_of) AS asOf FROM feature_snapshot WHERE fsv = ?").get(FSV) as { asOf: string | null }).asOf;
  const f = last ? computeFeatures(sqlite, employeeId, last) : null;
  if (last && f)
    sqlite
      .prepare("INSERT OR REPLACE INTO feature_snapshot (employee_id, as_of, fsv, values_json, partial_history) VALUES (?, ?, ?, ?, ?)")
      .run(employeeId, last, FSV, JSON.stringify(f.values), f.partial ? 1 : 0);
  return true;
}

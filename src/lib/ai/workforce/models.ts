import type Database from "better-sqlite3";
import { championTopicModel, loadBundle, type TopicModelRow } from "../registry";
import type { EffectifBundle, MasseBundle } from "./engine";

export type WorkforceModels = { be: EffectifBundle; bm: MasseBundle | null; rowE: TopicModelRow; rowM: TopicModelRow | null };

// Champions EFFECTIF (obligatoire) et MASSE_SALARIALE (facultatif : sans lui, pas de projection de masse)
export function loadWorkforceModels(sqlite: Database.Database): WorkforceModels | null {
  const rowE = championTopicModel(sqlite, "EFFECTIF");
  if (!rowE) return null;
  const rowM = championTopicModel(sqlite, "MASSE_SALARIALE");
  return { be: loadBundle<EffectifBundle>(rowE), bm: rowM ? loadBundle<MasseBundle>(rowM) : null, rowE, rowM };
}

// Probabilités de démission publiées à asOf, seulement si le run publié vient d'un modèle probabiliste (LOGREG) :
// les points d'un score à règles B0 ne sont pas des probabilités et ne s'additionnent pas.
export function publishedProb6(sqlite: Database.Database, asOf: string): Map<number, number> | null {
  const run = sqlite
    .prepare(
      `SELECT r.id, mv.kind FROM scoring_run r JOIN model_version mv ON mv.id = r.model_version_id
       WHERE r.as_of = ? AND r.status = 'PUBLIE'
       ORDER BY (CAST(r.id AS TEXT) = (SELECT value FROM app_setting WHERE key = 'current_run_id')) DESC, r.id DESC LIMIT 1`,
    )
    .get(asOf) as { id: number; kind: string } | undefined;
  if (!run || run.kind !== "LOGREG") return null;
  const rows = sqlite.prepare("SELECT employee_id AS id, prob6 FROM prediction WHERE run_id = ?").all(run.id) as { id: number; prob6: number }[];
  return new Map(rows.map((r) => [r.id, r.prob6]));
}

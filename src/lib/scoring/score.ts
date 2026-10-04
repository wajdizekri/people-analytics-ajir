import type Database from "better-sqlite3";
import { dataEndDate, getSetting, setSetting } from "../settings";
import { auditSqlite, systemAlert } from "../engine/alerts";
import { applyPublicationEffects } from "../engine/recommendations";
import { computeFeaturesForMonth, readSnapshots, writeSnapshots } from "../features";
import { frDate, normalizeAsOf } from "../features/dates";
import { excludeOpposed } from "../privacy";
import { coldStartState, type ColdStartState } from "./cold-start";
import { explain, predict, type GroupContribution, type LoadedModel } from "./model";
import { ensureChampion, loadB0Fallback } from "./registry";

export type RiskLevel = "FAIBLE" | "MOYEN" | "ELEVE";
export type ScoredRow = { employeeId: number; score: number; rank: number; lift: number; level: RiskLevel; factors: GroupContribution[] };
export type ScoreOptions = { publish?: boolean; force?: boolean; userId?: number | null };
export type ScoreResult = {
  runId: number;
  nScored: number;
  published: boolean;
  reused: boolean;
  modelVersion: string;
  kind: "B0" | "LOGREG";
  recommendations: number;
  alerts: number;
  // démarrage à froid : champion probabiliste écarté au profit de B0 (null = champion utilisé tel quel)
  coldStart: (ColdStartState & { champion: string }) | null;
};

const MAX_FACTORS = 6;
const WRITE_BATCH = 500;

function numSetting(sqlite: Database.Database, key: string, fallback: number): number {
  const v = Number(getSetting(sqlite, key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Rang (score décroissant, ex-æquo ordonnés par id pour un rang stable), lift = score / moyenne, niveau.
// capacity_rate est un plafond : ÉLEVÉ = au plus k salariés, et des ex-æquo qui franchiraient la k-ième place
// restent tous hors ÉLEVÉ, pour que le niveau ne dépende jamais du matricule (fréquent avec les points entiers de B0).
// k = partie entière de n × taux (plafond strict dès que la capacité atteint 1) ; en dessous (moins de 50 scorés à 2 %),
// k = 1 : la RH garde une priorité par mois plutôt qu'aucune (arbitrage B1, docs/adr/006).
// Une contribution de groupe nulle n'est ni une hausse ni une baisse : elle n'est pas retenue comme facteur.
export function rankAndLevel(
  model: LoadedModel,
  rows: { employeeId: number; values: number[] }[],
  capacityRate: number,
  mediumLift: number,
): ScoredRow[] {
  const scored = rows.map((r) => ({ employeeId: r.employeeId, values: r.values, score: predict(model, r.values) }));
  scored.sort((a, b) => b.score - a.score || a.employeeId - b.employeeId);
  const n = scored.length;
  const mean = n ? scored.reduce((s, r) => s + r.score, 0) / n : 0;
  const k = n ? Math.max(1, Math.floor(n * capacityRate + 1e-9)) : 0;
  const firstExcluded = k < n ? scored[k].score : -Infinity;
  const b0 = model.kind === "B0";
  return scored.map((r, i) => {
    const lift = mean > 0 ? r.score / mean : 0;
    const positive = !b0 || r.score > 0;
    const level: RiskLevel = i < k && r.score > firstExcluded && positive ? "ELEVE" : positive && lift >= mediumLift ? "MOYEN" : "FAIBLE";
    return { employeeId: r.employeeId, score: r.score, rank: i + 1, lift, level, factors: explain(model, r.values).filter((f) => f.contribution !== 0).slice(0, MAX_FACTORS) };
  });
}

function writePredictions(sqlite: Database.Database, runId: number, asOf: string, modelId: number, rows: ScoredRow[]) {
  const insP = sqlite.prepare(
    "INSERT INTO prediction (run_id, employee_id, as_of, prob6, level, rank, lift, model_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insF = sqlite.prepare(
    `INSERT INTO prediction_factor (prediction_id, group_code, contribution, rank, direction, top_feature, top_feature_value, phrase_rh, phrase_manager)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    const pid = Number(insP.run(runId, r.employeeId, asOf, r.score, r.level, r.rank, r.lift, modelId).lastInsertRowid);
    r.factors.forEach((f, i) =>
      insF.run(pid, f.group, f.contribution, i + 1, f.direction, f.topFeature, f.topFeatureValue, f.phraseRh, f.phraseManager),
    );
  }
}

function deleteRunRows(sqlite: Database.Database, runId: number) {
  sqlite.prepare("DELETE FROM prediction_factor WHERE prediction_id IN (SELECT id FROM prediction WHERE run_id = ?)").run(runId);
  sqlite.prepare("DELETE FROM prediction WHERE run_id = ?").run(runId);
}

function currentRunId(sqlite: Database.Database): number | null {
  const v = Number(getSetting(sqlite, "current_run_id"));
  return Number.isInteger(v) && v > 0 ? v : null;
}

export function currentPublishedAsOf(sqlite: Database.Database): string | null {
  const id = currentRunId(sqlite);
  const r = id ? (sqlite.prepare("SELECT as_of AS asOf FROM scoring_run WHERE id = ? AND status = 'PUBLIE'").get(id) as { asOf: string } | undefined) : undefined;
  return r?.asOf ?? null;
}

// Scoring d'une fin de mois : run STAGING, écriture par lots, puis publication atomique
// (statut PUBLIE + pointeur current_run_id dans une seule transaction). publish=false : run complet sans pointeur (backtest).
export function scoreMonth(sqlite: Database.Database, asOfInput: string, opts: ScoreOptions = {}): ScoreResult {
  const asOf = normalizeAsOf(asOfInput);
  const publish = opts.publish ?? true;
  const userId = opts.userId ?? null;

  const lastImport = sqlite.prepare("SELECT id, status FROM import_batch ORDER BY id DESC LIMIT 1").get() as { id: number; status: string } | undefined;
  if (lastImport?.status === "BLOQUE")
    throw new Error(`Calcul des risques refusé : le dernier import (n° ${lastImport.id}) est bloqué par le contrôle qualité. Faites corriger l'export dans AJIR, puis importez-le de nouveau.`);
  const end = dataEndDate(sqlite);
  if (publish && end && asOf > end)
    throw new Error(`Publication refusée : le ${frDate(asOf)} dépasse la fin des données importées (${frDate(end)}). Importez l'export AJIR couvrant ce mois.`);

  const champion = ensureChampion(sqlite, userId);
  const cold = champion.kind === "B0" ? null : coldStartState(sqlite, asOf, champion.kind, champion.fsv);
  const model = cold?.active ? loadB0Fallback(sqlite, userId) : champion;
  const coldStart = cold?.active ? { ...cold, champion: champion.version } : null;
  const modelId = model.id!;
  // Opposition (loi 2004-63, art. 42) : un salarié opposé n'a ni variables écrites, ni prédiction, ni facteur
  let snaps = excludeOpposed(sqlite, readSnapshots(sqlite, asOf, model.fsv));
  if (!snaps.length) {
    snaps = excludeOpposed(sqlite, computeFeaturesForMonth(sqlite, asOf));
    writeSnapshots(sqlite, asOf, snaps);
  }
  if (!snaps.length) throw new Error(`Aucun collaborateur à évaluer au ${frDate(asOf)} : vérifiez que l'export AJIR couvre ce mois.`);

  const base = { modelVersion: model.version, kind: model.kind, recommendations: 0, alerts: 0, coldStart };
  const existing = sqlite
    .prepare("SELECT id, status, n_scored AS n FROM scoring_run WHERE as_of = ? AND model_version_id = ?")
    .get(asOf, modelId) as { id: number; status: string; n: number } | undefined;

  if (existing?.status === "PUBLIE" && !opts.force) {
    let published = currentRunId(sqlite) === existing.id;
    if (publish && !published) {
      setSetting(sqlite, "current_run_id", String(existing.id), userId ?? undefined);
      published = true;
    }
    const effects = published && publish ? applyPublicationEffects(sqlite, existing.id) : { recommendations: 0, alerts: 0 };
    return { ...base, ...effects, runId: existing.id, nScored: existing.n, published, reused: true };
  }

  const rows = rankAndLevel(model, snaps, numSetting(sqlite, "capacity_rate", 0.02), numSetting(sqlite, "medium_lift", 2));
  let runId: number;

  if (existing?.status === "PUBLIE") {
    runId = existing.id;
    const oldIds = (sqlite.prepare("SELECT id, employee_id AS e FROM prediction WHERE run_id = ?").all(runId) as { id: number; e: number }[]);
    sqlite
      .transaction(() => {
        deleteRunRows(sqlite, runId);
        writePredictions(sqlite, runId, asOf, modelId, rows);
        const remap = sqlite.prepare(
          "UPDATE recommendation SET prediction_id = (SELECT id FROM prediction WHERE run_id = ? AND employee_id = ?) WHERE prediction_id = ?",
        );
        for (const o of oldIds) remap.run(runId, o.e, o.id);
        sqlite
          .prepare(
            "UPDATE scoring_run SET status = 'PUBLIE', n_scored = ?, error = NULL, started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
          )
          .run(rows.length, runId);
        if (publish) setSetting(sqlite, "current_run_id", String(runId), userId ?? undefined);
      })
      .immediate();
  } else {
    if (existing) {
      sqlite
        .transaction(() => {
          deleteRunRows(sqlite, existing.id);
          sqlite.prepare("DELETE FROM scoring_run WHERE id = ?").run(existing.id);
        })
        .immediate();
    }
    runId = Number(sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status) VALUES (?, ?, 'STAGING')").run(asOf, modelId).lastInsertRowid);
    try {
      for (let i = 0; i < rows.length; i += WRITE_BATCH) {
        const chunk = rows.slice(i, i + WRITE_BATCH);
        sqlite.transaction(() => writePredictions(sqlite, runId, asOf, modelId, chunk)).immediate();
      }
      sqlite
        .transaction(() => {
          const r = sqlite
            .prepare("UPDATE scoring_run SET status = 'PUBLIE', n_scored = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'STAGING'")
            .run(rows.length, runId);
          if (r.changes !== 1) throw new Error("Calcul interrompu : il a été publié ou annulé entre-temps par un autre traitement.");
          if (publish) setSetting(sqlite, "current_run_id", String(runId), userId ?? undefined);
        })
        .immediate();
    } catch (e) {
      const msg = (e as Error).message;
      sqlite.prepare("UPDATE scoring_run SET status = 'ECHEC', error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(msg, runId);
      systemAlert(
        sqlite,
        `scoring:${asOf}:run${runId}`,
        "Échec du calcul des risques",
        `Le calcul des risques au ${frDate(asOf)} a échoué (${msg}). Le dernier calcul publié reste affiché ; relancez le calcul depuis Santé des données une fois la cause corrigée.`,
      );
      auditSqlite(sqlite, userId, "scoring.publish", { type: "scoring_run", id: runId }, "ECHEC", { asOf, error: msg });
      throw e;
    }
  }

  auditSqlite(sqlite, userId, "scoring.publish", { type: "scoring_run", id: runId }, "OK", {
    asOf,
    model: model.version,
    nScored: rows.length,
    current: publish,
    ...(coldStart ? { coldStart: { champion: coldStart.champion, events: coldStart.events, threshold: coldStart.threshold } } : {}),
  });
  const effects = publish ? applyPublicationEffects(sqlite, runId) : { recommendations: 0, alerts: 0 };
  return { ...base, ...effects, runId, nScored: rows.length, published: publish, reused: false };
}

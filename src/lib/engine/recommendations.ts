import type Database from "better-sqlite3";
import { frDate } from "../features/dates";
import { GROUPS, managerVisibleGroup } from "../features/spec";
import { excludeOpposed } from "../privacy";
import { auditSqlite, createAlert } from "./alerts";

export const ACTION_BY_GROUP: Record<string, string> = {
  REMUNERATION: "REVISION_SALARIALE",
  TEMPS_TRAVAIL: "CHARGE_TRAVAIL",
  FORMATION_EVAL: "PLAN_FORMATION",
};
export const ACTION_ENTRETIEN = "ENTRETIEN";
export const ENTRETIEN_TRIGGER = "NIVEAU_ELEVE";

type PredRow = {
  id: number;
  employeeId: number;
  level: "FAIBLE" | "MOYEN" | "ELEVE";
  firstName: string;
  lastName: string;
  managerId: number | null;
  departmentId: number | null;
};
type FactorRow = { predictionId: number; groupCode: string; rank: number; direction: "HAUSSE" | "BAISSE" };

type RunEffectsInput = { run: { id: number; asOf: string; kind: string | null }; preds: PredRow[]; factorsByPred: Map<number, FactorRow[]> };

function loadRunEffectsInput(sqlite: Database.Database, runId: number): RunEffectsInput {
  const run = sqlite
    .prepare("SELECT r.id, r.as_of AS asOf, m.kind FROM scoring_run r LEFT JOIN model_version m ON m.id = r.model_version_id WHERE r.id = ?")
    .get(runId) as { id: number; asOf: string; kind: string | null } | undefined;
  if (!run) throw new Error(`Run inconnu : ${runId}`);

  // Salarié opposé au traitement prédictif : ni recommandation individuelle ni alerte TURNOVER
  const preds = excludeOpposed(
    sqlite,
    sqlite
      .prepare(
        `SELECT p.id, p.employee_id AS employeeId, p.level, e.first_name AS firstName, e.last_name AS lastName,
                e.manager_id AS managerId, e.department_id AS departmentId
           FROM prediction p JOIN employee e ON e.id = p.employee_id
          WHERE p.run_id = ? AND p.level IN ('ELEVE','MOYEN') ORDER BY p.rank`,
      )
      .all(runId) as PredRow[],
  );
  const factors = sqlite
    .prepare(
      `SELECT f.prediction_id AS predictionId, f.group_code AS groupCode, f.rank, f.direction
         FROM prediction_factor f JOIN prediction p ON p.id = f.prediction_id
        WHERE p.run_id = ? AND f.rank <= 3 ORDER BY f.prediction_id, f.rank`,
    )
    .all(runId) as FactorRow[];
  const factorsByPred = new Map<number, FactorRow[]>();
  for (const f of factors) {
    if (!factorsByPred.has(f.predictionId)) factorsByPred.set(f.predictionId, []);
    factorsByPred.get(f.predictionId)!.push(f);
  }
  return { run, preds, factorsByPred };
}

// Actions proposées pour une prédiction : groupes actionnables à la hausse parmi les 3 premiers facteurs, entretien si ÉLEVÉ
function actionsFor(level: PredRow["level"], top: FactorRow[]): [string, string][] {
  const actions: [string, string][] = [];
  for (const f of top) {
    const action = ACTION_BY_GROUP[f.groupCode];
    if (action && f.direction === "HAUSSE" && GROUPS[f.groupCode]?.actionable) actions.push([action, f.groupCode]);
  }
  if (level === "ELEVE") actions.push([ACTION_ENTRETIEN, ENTRETIEN_TRIGGER]);
  return actions;
}

// Message de l'alerte TURNOVER (manager) : catégories de facteurs visibles par le manager pour le modèle du run
function turnoverMessage(asOf: string, kind: string | null, top: FactorRow[]): string {
  const cats = top
    .filter((f) => f.direction === "HAUSSE" && managerVisibleGroup(f.groupCode, kind ?? "B0"))
    .map((f) => GROUPS[f.groupCode]?.label_manager ?? f.groupCode);
  return (
    `Niveau de risque Élevé au ${frDate(asOf)} : estimation de départ volontaire dans les 6 mois parmi les plus fortes de l'entreprise.` +
    (cats.length ? ` Facteurs associés : ${cats.join(", ")}.` : "") +
    " Prévoyez un échange pour comprendre sa situation : c'est une estimation, pas une certitude."
  );
}

// Effets métier d'un run publié : recommandations et alertes TURNOVER. Idempotent, y compris après un rejet ou une
// réalisation : une action n'est proposée qu'une fois par salarié et par mois scoré, et jamais en double tant qu'elle est ouverte.
export function applyPublicationEffects(sqlite: Database.Database, runId: number): { recommendations: number; alerts: number } {
  const { run, preds, factorsByPred } = loadRunEffectsInput(sqlite, runId);

  const prev = sqlite
    .prepare("SELECT id FROM scoring_run WHERE status = 'PUBLIE' AND as_of < ? ORDER BY as_of DESC, id DESC LIMIT 1")
    .get(run.asOf) as { id: number } | undefined;
  const wasHigh = new Set(
    prev
      ? (sqlite.prepare("SELECT employee_id AS id FROM prediction WHERE run_id = ? AND level = 'ELEVE'").all(prev.id) as { id: number }[]).map((r) => r.id)
      : [],
  );

  const exists = sqlite.prepare(
    `SELECT 1 FROM recommendation r LEFT JOIN prediction p ON p.id = r.prediction_id
      WHERE r.employee_id = @employeeId AND r.action_code = @action AND (r.status = 'PROPOSEE' OR p.as_of = @asOf) LIMIT 1`,
  );
  const insReco = sqlite.prepare("INSERT INTO recommendation (employee_id, prediction_id, action_code, trigger_group) VALUES (?, ?, ?, ?)");
  let recommendations = 0;
  let alerts = 0;

  sqlite
    .transaction(() => {
      for (const p of preds) {
        const top = factorsByPred.get(p.id) ?? [];
        for (const [action, group] of actionsFor(p.level, top)) {
          if (exists.get({ employeeId: p.employeeId, action, asOf: run.asOf })) continue;
          insReco.run(p.employeeId, p.id, action, group);
          recommendations++;
        }

        if (p.level !== "ELEVE" || wasHigh.has(p.employeeId)) continue;
        const created = createAlert(sqlite, {
          type: "TURNOVER",
          severity: "ATTENTION",
          audience: "MANAGER",
          managerId: p.managerId,
          departmentId: p.departmentId,
          employeeId: p.employeeId,
          title: `Passage au niveau de risque Élevé : ${p.firstName} ${p.lastName}`,
          message: turnoverMessage(run.asOf, run.kind, top),
          link: `/employees/${p.employeeId}`,
          dedupKey: `turnover:${p.employeeId}:${run.asOf}`,
        });
        if (created) alerts++;
      }
    })
    .immediate();

  return { recommendations, alerts };
}

export const SUPERSEDED_COMMENT = "Remplacée : recalcul avec le modèle entraîné";

export type SupersedeResult = { runId: number; asOf: string; rejected: number[]; relinked: number[]; alerts: number[]; refreshed: number[]; applied: boolean };

// Mois recalculé avec un autre modèle (ex. score à règles B0 puis modèle entraîné, même date de coupure) : parmi les
// recommandations encore proposées issues d'un autre calcul de ce mois, celles que le run courant propose aussi sont
// rattachées à sa prédiction, les autres passent REJETEE avec SUPERSEDED_COMMENT. Alertes TURNOVER nouvelles de ce mois
// pour un salarié qui n'est plus ÉLEVÉ (ou opposé) : REJETEE ; celles, créées avant la publication du run, d'un salarié encore
// ÉLEVÉ : message recalculé avec les facteurs du run. Simulation par défaut ; apply = écriture auditée scoring.supersede.
export function supersedeSameMonthEffects(sqlite: Database.Database, runId: number, opts: { apply?: boolean; userId?: number | null } = {}): SupersedeResult {
  const { run, preds, factorsByPred } = loadRunEffectsInput(sqlite, runId);
  const planned = new Set<string>();
  const predOf = new Map<number, number>();
  const high = new Map<number, string>();
  for (const p of preds) {
    predOf.set(p.employeeId, p.id);
    if (p.level === "ELEVE") high.set(p.employeeId, turnoverMessage(run.asOf, run.kind, factorsByPred.get(p.id) ?? []));
    for (const [action] of actionsFor(p.level, factorsByPred.get(p.id) ?? [])) planned.add(`${p.employeeId}:${action}`);
  }
  const open = sqlite
    .prepare(
      `SELECT r.id, r.employee_id AS employeeId, r.action_code AS action FROM recommendation r JOIN prediction p ON p.id = r.prediction_id
        WHERE r.status = 'PROPOSEE' AND p.as_of = ? AND p.run_id <> ? ORDER BY r.id`,
    )
    .all(run.asOf, run.id) as { id: number; employeeId: number; action: string }[];
  const rejected = open.filter((r) => !planned.has(`${r.employeeId}:${r.action}`)).map((r) => r.id);
  const relinked = open.filter((r) => planned.has(`${r.employeeId}:${r.action}`)).map((r) => r.id);
  const monthAlerts = sqlite
    .prepare(
      `SELECT a.id, a.employee_id AS employeeId, a.message, a.created_at < COALESCE(s.finished_at, '') AS older FROM alert a, scoring_run s
        WHERE s.id = @run AND a.type = 'TURNOVER' AND a.status = 'NOUVELLE' AND a.dedup_key = 'turnover:' || a.employee_id || ':' || @asOf ORDER BY a.id`,
    )
    .all({ run: run.id, asOf: run.asOf }) as { id: number; employeeId: number; message: string; older: number }[];
  const alerts = monthAlerts.filter((a) => !high.has(a.employeeId)).map((a) => a.id);
  const stale = monthAlerts.filter((a) => a.older && high.has(a.employeeId) && a.message !== high.get(a.employeeId));
  const refreshed = stale.map((a) => a.id);
  const result = { runId: run.id, asOf: run.asOf, rejected, relinked, alerts, refreshed, applied: false };
  if (!opts.apply) return result;

  const userId = opts.userId ?? null;
  sqlite
    .transaction(() => {
      const now = new Date().toISOString();
      const reject = sqlite.prepare("UPDATE recommendation SET status = 'REJETEE', comment = ?, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'PROPOSEE'");
      for (const id of rejected) reject.run(SUPERSEDED_COMMENT, now, userId, id);
      const relink = sqlite.prepare("UPDATE recommendation SET prediction_id = ? WHERE id = ? AND employee_id = ?");
      for (const r of open) if (relinked.includes(r.id)) relink.run(predOf.get(r.employeeId)!, r.id, r.employeeId);
      const closeAlert = sqlite.prepare("UPDATE alert SET status = 'REJETEE', comment = ?, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'NOUVELLE'");
      for (const id of alerts) closeAlert.run(SUPERSEDED_COMMENT, now, userId, id);
      const refresh = sqlite.prepare("UPDATE alert SET message = ? WHERE id = ? AND status = 'NOUVELLE'");
      for (const a of stale) refresh.run(high.get(a.employeeId)!, a.id);
      auditSqlite(sqlite, userId, "scoring.supersede", { type: "scoring_run", id: run.id }, "OK", { asOf: run.asOf, rejected, relinked, alerts, refreshed });
    })
    .immediate();
  return { ...result, applied: true };
}

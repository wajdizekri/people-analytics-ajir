import type Database from "better-sqlite3";
import { auditSqlite } from "../engine/alerts";
import { getSetting, setSetting } from "../settings";

export type RunRow = {
  id: number;
  asOf: string;
  model: string;
  kind: string;
  status: string;
  nScored: number;
  finishedAt: string | null;
  current: boolean;
  everCurrent: boolean;
};

const currentId = (sqlite: Database.Database) => {
  const v = Number(getSetting(sqlite, "current_run_id"));
  return Number.isInteger(v) && v > 0 ? v : null;
};

const RUN_SELECT = `SELECT r.id, r.as_of AS asOf, m.version AS model, m.kind, r.status, r.n_scored AS nScored, r.finished_at AS finishedAt,
    EXISTS (SELECT 1 FROM audit_log a WHERE a.target_type = 'scoring_run' AND a.target_id = CAST(r.id AS TEXT) AND a.outcome = 'OK'
      AND ((a.action = 'scoring.publish' AND json_extract(a.detail_json, '$.current') = 1) OR a.action = 'scoring.rollback')) AS everCurrent
  FROM scoring_run r JOIN model_version m ON m.id = r.model_version_id`;

type RawRun = Omit<RunRow, "current" | "everCurrent"> & { everCurrent: number };
const toRun = (r: RawRun, cur: number | null): RunRow => ({ ...r, current: r.id === cur, everCurrent: !!r.everCurrent || r.id === cur });

// everCurrent : le run a été le calcul courant (publication auditée « current », ou retour arrière vers lui).
export function listRuns(sqlite: Database.Database, limit = 24): RunRow[] {
  const cur = currentId(sqlite);
  return (sqlite.prepare(`${RUN_SELECT} ORDER BY r.id DESC LIMIT ?`).all(limit) as RawRun[]).map((r) => toRun(r, cur));
}

export type RollbackResult = { from: number | null; to: number; asOf: string; model: string };

// Repointe current_run_id vers un run PUBLIE antérieur (date de coupure <= celle du run courant). Refusé pendant un
// calcul en cours, et vers un run jamais publié comme courant (backtest) sauf force. Audité scoring.rollback (OK ou REFUSE).
export function rollbackRun(sqlite: Database.Database, runId: number, opts: { userId?: number | null; force?: boolean } = {}): RollbackResult {
  const userId = opts.userId ?? null;
  const target = { type: "scoring_run", id: runId };
  const res = sqlite
    .transaction((): { error: string; from: number | null } | RollbackResult => {
      const from = currentId(sqlite);
      const raw = sqlite.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(runId) as RawRun | undefined;
      if (!raw) return { error: `Run ${runId} introuvable.`, from };
      const run = toRun(raw, from);
      if (run.status !== "PUBLIE") return { error: `Run ${runId} au statut ${run.status} : seul un run PUBLIE peut redevenir courant.`, from };
      if (run.current) return { error: `Run ${runId} est déjà le calcul publié courant.`, from };
      const cur = from ? (sqlite.prepare("SELECT as_of AS asOf FROM scoring_run WHERE id = ?").get(from) as { asOf: string } | undefined) : undefined;
      if (cur && run.asOf > cur.asOf) return { error: `Run ${runId} (${run.asOf}) postérieur au calcul courant (${cur.asOf}) : ce n'est pas un retour arrière.`, from };
      const busy = sqlite.prepare("SELECT id, type FROM app_job WHERE status = 'EN_COURS' AND type IN ('SCORING', 'BATCH_MENSUEL') LIMIT 1").get() as
        | { id: number; type: string }
        | undefined;
      if (busy && !opts.force) return { error: `Calcul en cours (job ${busy.id} ${busy.type}) : attendez sa fin ou utilisez --force.`, from };
      if (!run.everCurrent && !opts.force) return { error: `Run ${runId} n'a jamais été le calcul courant (run de backtest ?) : --force pour confirmer.`, from };
      setSetting(sqlite, "current_run_id", String(runId), userId ?? undefined);
      auditSqlite(sqlite, userId, "scoring.rollback", target, "OK", { from, to: runId, asOf: run.asOf, model: run.model, force: !!opts.force });
      return { from, to: runId, asOf: run.asOf, model: run.model };
    })
    .immediate();
  if ("error" in res) {
    auditSqlite(sqlite, userId, "scoring.rollback", target, "REFUSE", { from: res.from, reason: res.error });
    throw new Error(res.error);
  }
  return res;
}

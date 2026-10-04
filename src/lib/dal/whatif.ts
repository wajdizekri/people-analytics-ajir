import "server-only";
import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { OPPOSITION_LABEL, isOpposed } from "@/lib/privacy";
import { featurePhrase, parseBundle, toLoadedModel, type LoadedModel } from "@/lib/scoring";
import { DEFAULT_CHARGE_RATE_PCT, LEVER_LIMITS, NON_CAUSAL_NOTICE, WhatIfError, simulate, type Levers, type Placement } from "@/lib/whatif";
import {
  ALREADY_LOW_MESSAGE,
  LEVER_STEPS,
  NO_COMBINATION_MESSAGE,
  PROMOTION_EFFORT,
  searchLevers,
  type LeverSearchResult,
  type LeverSearchStatus,
} from "@/lib/whatif/search";
import { canSeeEmployee, isGlobal, type AccessContext } from "./context";
import { groupLabel, type AuditMeta, type ModelKind } from "./employees";
import { HttpError, forbidden, notFound } from "./errors";

export const whatIfSchema = z
  .object({
    salaryPct: z.number().min(0).max(LEVER_LIMITS.salaryPct).default(0),
    overtimeCutH: z.number().min(0).max(LEVER_LIMITS.overtimeCutH).default(0),
    trainingHours: z.number().min(0).max(LEVER_LIMITS.trainingHours).default(0),
    promotion: z.boolean().default(false),
    chargeRatePct: z.number().min(0).max(100).default(DEFAULT_CHARGE_RATE_PCT),
  })
  .strict();
export type WhatIfInput = z.output<typeof whatIfSchema>;

export type WhatIfDto = {
  employeeId: number;
  asOf: string;
  model: { version: string; kind: ModelKind };
  notice: string;
  levers: WhatIfInput;
  stored: { score: number; level: Placement["level"] };
  before: Placement;
  after: Placement;
  groups: { group: string; label: string; before: number; after: number }[];
  changes: { feature: string; before: string; after: string }[];
  applied: {
    salary: { before: number; after: number } | null;
    grade: { before: string; after: string } | null;
    overtimeRemovedH: number;
    trainingHours: number;
  };
  cost: { monthlySalaryDelta: number; annual: number; chargeRate: number };
  notes: string[];
};

function numSetting(sqlite: Database.Database, key: string, fallback: number): number {
  const v = Number(getSetting(sqlite, key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Modèle du calcul publié (celui dont le score est affiché sur la fiche), lu depuis son manifeste enregistré.
export function loadRunModel(sqlite: Database.Database, modelVersionId: number): LoadedModel {
  const row = sqlite.prepare("SELECT manifest_json AS m FROM model_version WHERE id = ?").get(modelVersionId) as { m: string | null } | undefined;
  const manifest = row?.m ? (JSON.parse(row.m) as { bundle?: unknown }) : null;
  if (!manifest?.bundle) throw new HttpError(409, "MODELE_INDISPONIBLE", "Modèle du calcul publié indisponible : simulation impossible pour le moment. Signalez-le à l'administrateur de l'outil.");
  return toLoadedModel(parseBundle(manifest.bundle), modelVersionId);
}

type WhatIfAction = "whatif.run" | "whatif.search";

// Gardes communes au what-if et à la recherche de leviers : RH seulement, périmètre, opposition (409), refus audités.
function guardWhatIf(ctx: AccessContext, employeeId: number, action: WhatIfAction, meta: AuditMeta): Database.Database {
  const target = { type: "employee", id: employeeId };
  if (!isGlobal(ctx)) {
    audit(ctx.userId, action, target, "REFUSE", { source: meta.source }, meta.ip);
    throw forbidden();
  }
  const { sqlite } = getDb();
  if (!sqlite.prepare("SELECT 1 AS ok FROM employee WHERE id = ?").get(employeeId)) throw notFound("Collaborateur");
  if (!canSeeEmployee(ctx, employeeId)) {
    audit(ctx.userId, action, target, "REFUSE", { source: meta.source }, meta.ip);
    throw forbidden();
  }
  if (isOpposed(sqlite, employeeId)) {
    audit(ctx.userId, action, target, "REFUSE", { source: meta.source, reason: "opposition" }, meta.ip);
    throw new HttpError(409, "OPPOSITION", `${OPPOSITION_LABEL} enregistrée pour ce collaborateur : simulation impossible.`);
  }
  return sqlite;
}

type PublishedRun = { id: number; asOf: string; modelId: number; version: string; kind: ModelKind };

// Calcul publié, score affiché du salarié et modèle de ce calcul ; 409 si l'un manque.
function publishedRun(sqlite: Database.Database, employeeId: number): { run: PublishedRun; stored: WhatIfDto["stored"]; model: LoadedModel } {
  const runId = Number(getSetting(sqlite, "current_run_id"));
  const run = Number.isInteger(runId) && runId > 0
    ? (sqlite
        .prepare(
          `SELECT r.id, r.as_of AS asOf, r.model_version_id AS modelId, m.version, m.kind FROM scoring_run r
           JOIN model_version m ON m.id = r.model_version_id WHERE r.id = ? AND r.status = 'PUBLIE'`,
        )
        .get(runId) as PublishedRun | undefined)
    : undefined;
  if (!run) throw new HttpError(409, "AUCUN_CALCUL", "Aucun calcul de risque publié : simulation impossible.");
  const stored = sqlite.prepare("SELECT prob6 AS score, level FROM prediction WHERE run_id = ? AND employee_id = ? ORDER BY id LIMIT 1").get(run.id, employeeId) as
    | WhatIfDto["stored"]
    | undefined;
  if (!stored) throw new HttpError(409, "NON_EVALUE", "Collaborateur non évalué dans le calcul publié : simulation impossible.");
  return { run, stored, model: loadRunModel(sqlite, run.modelId) };
}

const placementSettings = (sqlite: Database.Database) => ({
  capacityRate: numSetting(sqlite, "capacity_rate", 0.02),
  mediumLift: numSetting(sqlite, "medium_lift", 2),
});

const STALE_NOTE = "Les données sources ont changé depuis le calcul publié : la situation « avant » est recalculée et diffère du score affiché.";

// RH seulement ; rien n'est écrit hormis l'audit (whatif.run).
export function runWhatIf(ctx: AccessContext, employeeId: number, body: unknown, meta: AuditMeta): WhatIfDto {
  const target = { type: "employee", id: employeeId };
  const sqlite = guardWhatIf(ctx, employeeId, "whatif.run", meta);
  const input = whatIfSchema.parse(body ?? {});
  const { run, stored, model } = publishedRun(sqlite, employeeId);
  const levers = { salaryPct: input.salaryPct, overtimeCutH: input.overtimeCutH, trainingHours: input.trainingHours, promotion: input.promotion };
  let res: ReturnType<typeof simulate>;
  try {
    res = simulate(sqlite, model, employeeId, run.asOf, levers, { ...placementSettings(sqlite), chargeRate: input.chargeRatePct / 100 });
  } catch (e) {
    if (e instanceof WhatIfError) {
      audit(ctx.userId, "whatif.run", target, "ECHEC", { source: meta.source, asOf: run.asOf, levers: input, error: e.message }, meta.ip);
      throw new HttpError(422, "SIMULATION_IMPOSSIBLE", e.message);
    }
    throw e;
  }
  audit(ctx.userId, "whatif.run", target, "OK", { source: meta.source, asOf: run.asOf, model: run.version, levers: input }, meta.ip);

  const notes = [...res.applied.notes];
  if (Math.abs(res.before.score - stored.score) > 1e-9) notes.push(STALE_NOTE);
  return {
    employeeId,
    asOf: run.asOf,
    model: { version: run.version, kind: run.kind },
    notice: NON_CAUSAL_NOTICE,
    levers: input,
    stored,
    before: res.before,
    after: res.after,
    groups: res.groups.map((g) => ({ ...g, label: groupLabel(g.group, "RH") })),
    changes: res.changes.map((c) => ({ feature: c.feature, before: featurePhrase(c.feature, c.before), after: featurePhrase(c.feature, c.after) })),
    applied: {
      salary: res.applied.salary,
      grade: res.applied.grade,
      overtimeRemovedH: res.applied.overtimeRemovedH,
      trainingHours: res.applied.trainingHours,
    },
    cost: res.cost,
    notes,
  };
}

export const leverSearchSchema = z
  .object({
    chargeRatePct: z.number().min(0).max(100).default(DEFAULT_CHARGE_RATE_PCT),
  })
  .strict();

export type LeverProposalDto = {
  levers: Levers;
  effort: number;
  after: Placement;
  applied: WhatIfDto["applied"];
  cost: WhatIfDto["cost"];
};

export type LeverSearchDto = {
  employeeId: number;
  asOf: string;
  model: { version: string; kind: ModelKind };
  notice: string;
  stored: WhatIfDto["stored"];
  before: Placement;
  status: LeverSearchStatus;
  message: string;
  proposals: LeverProposalDto[];
  method: {
    steps: typeof LEVER_STEPS;
    limits: typeof LEVER_LIMITS;
    promotionEffort: number;
    combos: number;
    evaluated: number;
    pruned: number;
    engineRuns: number;
    ms: number;
  };
  notes: string[];
};

const LEVEL_WORD: Record<Placement["level"], string> = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible" };

// Mêmes rôles, gardes et calcul publié que runWhatIf ; rien n'est écrit hormis l'audit (whatif.search). L'outil propose
// des pistes, la RH décide : aucune action n'est enregistrée ni déclenchée.
export function searchWhatIfLevers(ctx: AccessContext, employeeId: number, body: unknown, meta: AuditMeta): LeverSearchDto {
  const target = { type: "employee", id: employeeId };
  const sqlite = guardWhatIf(ctx, employeeId, "whatif.search", meta);
  const input = leverSearchSchema.parse(body ?? {});
  const { run, stored, model } = publishedRun(sqlite, employeeId);
  let res: LeverSearchResult;
  try {
    res = searchLevers(sqlite, model, employeeId, run.asOf, { ...placementSettings(sqlite), chargeRate: input.chargeRatePct / 100 });
  } catch (e) {
    if (e instanceof WhatIfError) {
      audit(ctx.userId, "whatif.search", target, "ECHEC", { source: meta.source, asOf: run.asOf, error: e.message }, meta.ip);
      throw new HttpError(422, "SIMULATION_IMPOSSIBLE", e.message);
    }
    throw e;
  }
  const n = res.proposals.length;
  audit(
    ctx.userId,
    "whatif.search",
    target,
    "OK",
    { source: meta.source, asOf: run.asOf, model: run.version, status: res.status, proposals: n, ms: res.stats.ms },
    meta.ip,
  );

  const message =
    res.status === "TROUVE"
      ? `${n} piste${n > 1 ? "s" : ""} pour passer sous le niveau ${LEVEL_WORD[res.before.level]}, de la plus petite à la plus forte.`
      : res.status === "AUCUNE"
        ? NO_COMBINATION_MESSAGE
        : ALREADY_LOW_MESSAGE;
  const notes = [...res.notes];
  if (Math.abs(res.before.score - stored.score) > 1e-9) notes.push(STALE_NOTE);
  return {
    employeeId,
    asOf: run.asOf,
    model: { version: run.version, kind: run.kind },
    notice: NON_CAUSAL_NOTICE,
    stored,
    before: res.before,
    status: res.status,
    message,
    proposals: res.proposals.map((p) => ({
      levers: p.levers,
      effort: p.effort,
      after: p.result.after,
      applied: {
        salary: p.result.applied.salary,
        grade: p.result.applied.grade,
        overtimeRemovedH: p.result.applied.overtimeRemovedH,
        trainingHours: p.result.applied.trainingHours,
      },
      cost: p.result.cost,
    })),
    method: { steps: LEVER_STEPS, limits: LEVER_LIMITS, promotionEffort: PROMOTION_EFFORT, ...res.stats },
    notes,
  };
}

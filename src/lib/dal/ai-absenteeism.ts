import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { AbsCalendar, computeSeries, loadOrg, mi, ml, unitLabel } from "@/lib/ai/absenteeism/series";
import { ensurePilotage, isGlobal, type AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";
import { MIN_GROUP_SIZE } from "./pilotage-metrics";

const HISTORY_MONTHS = 24;
const RECO_STATUSES = ["PROPOSEE", "REALISEE", "REJETEE"] as const;
export type AbsRecoStatus = (typeof RECO_STATUSES)[number];
type Scope = "ENTREPRISE" | "DEPARTEMENT" | "EQUIPE";

export type AbsForecastPoint = { month: string; horizon: number; value: number; lower: number | null; upper: number | null };
export type AbsForecastUnit = {
  key: string;
  scope: Scope;
  label: string;
  observed: { month: string; rate: number | null }[];
  forecast: AbsForecastPoint[];
};
export type AbsRecommendation = {
  id: number;
  scope: Scope;
  label: string;
  actionCode: string;
  title: string;
  rationale: string;
  priority: number;
  status: AbsRecoStatus;
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  allowed: AbsRecoStatus[];
};
export type AbsForecastDto = {
  view: "RH" | "MANAGER";
  asOf: string | null;
  modelVersion: string | null;
  units: AbsForecastUnit[];
  // manager : équipe directe de moins de MIN_GROUP_SIZE personnes en poste, aucune prévision affichée
  teamTooSmall: boolean;
  recommendations: AbsRecommendation[];
};

type ForecastRow = { scope: Scope; departmentId: number | null; managerId: number | null; month: string; horizon: number; value: number; lower: number | null; upper: number | null; version: string };

const unitKey = (r: { scope: Scope; departmentId: number | null; managerId: number | null }) =>
  r.scope === "ENTREPRISE" ? "E" : r.scope === "DEPARTEMENT" ? `D${r.departmentId}` : `T${r.managerId}`;

// Prévision d'absentéisme hors santé non planifiée : RH = entreprise et départements ; MANAGER = son équipe directe si >= 5 personnes.
export function getAbsenteeismForecast(ctx: AccessContext): AbsForecastDto {
  ensurePilotage(ctx, "absenteeism.forecast.view");
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const view = global ? "RH" : "MANAGER";
  const recommendations = listAbsenteeismRecommendations(ctx);
  const last = sqlite.prepare("SELECT max(as_of) AS asOf FROM forecast WHERE topic = 'ABSENTEISME'").get() as { asOf: string | null };
  const empty = { view, asOf: last.asOf, modelVersion: null, units: [], teamTooSmall: false, recommendations } as AbsForecastDto;
  if (!last.asOf) return empty;

  if (!global) {
    if (ctx.employeeId == null) return empty;
    const team = sqlite.prepare("SELECT count(*) AS n FROM employee WHERE manager_id = ? AND status = 'ACTIF'").get(ctx.employeeId) as { n: number };
    if (team.n < MIN_GROUP_SIZE) return { ...empty, teamTooSmall: true };
  }
  const rows = sqlite
    .prepare(
      `SELECT scope, department_id AS departmentId, manager_id AS managerId, month, horizon, value, lower, upper, model_version AS version
       FROM forecast WHERE topic = 'ABSENTEISME' AND as_of = @asOf AND ${global ? "scope IN ('ENTREPRISE','DEPARTEMENT')" : "scope = 'EQUIPE' AND manager_id = @me"}
       ORDER BY scope DESC, department_id, horizon`,
    )
    .all({ asOf: last.asOf, me: ctx.employeeId ?? -1 }) as ForecastRow[];
  if (!rows.length) return empty;

  const o = mi(last.asOf.slice(0, 7));
  const org = loadOrg(sqlite);
  const series = computeSeries(sqlite, org, AbsCalendar.load(sqlite), o - HISTORY_MONTHS + 1, o);
  const byUnit = new Map<string, ForecastRow[]>();
  for (const r of rows) {
    const k = unitKey(r);
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k)!.push(r);
  }
  const units: AbsForecastUnit[] = [...byUnit.entries()].map(([key, fc]) => {
    const s = series.get(key);
    return {
      key,
      scope: fc[0].scope,
      label: unitLabel(org, key),
      observed: Array.from({ length: HISTORY_MONTHS }, (_, k) => {
        const den = s?.den[k] ?? 0;
        const hidden = !global && (s?.members[k] ?? 0) < MIN_GROUP_SIZE;
        return { month: ml(o - HISTORY_MONTHS + 1 + k), rate: den > 0 && !hidden ? s!.num[k] / den : null };
      }),
      forecast: fc.map((r) => ({ month: r.month, horizon: r.horizon, value: r.value, lower: r.lower, upper: r.upper })),
    };
  });
  units.sort((a, b) => (a.scope === "ENTREPRISE" ? -1 : b.scope === "ENTREPRISE" ? 1 : a.label.localeCompare(b.label, "fr")));
  return { view, asOf: last.asOf, modelVersion: rows[0].version, units, teamTooSmall: false, recommendations };
}

type RecoRow = Omit<AbsRecommendation, "label" | "allowed"> & { audience: "RH" | "MANAGER"; managerId: number | null; department: string | null; managerName: string | null };

function allowedFor(ctx: AccessContext, r: { status: AbsRecoStatus; audience: string; managerId: number | null }): AbsRecoStatus[] {
  if (isGlobal(ctx)) return RECO_STATUSES.filter((s) => s !== r.status);
  if (ctx.role === "MANAGER" && r.audience === "MANAGER" && r.managerId === ctx.employeeId && r.status === "PROPOSEE") return ["REALISEE"];
  return [];
}

// RH : toutes les recommandations du sujet ; MANAGER : celles adressées à son équipe ou au département dont il est responsable.
export function listAbsenteeismRecommendations(ctx: AccessContext, limit = 100): AbsRecommendation[] {
  ensurePilotage(ctx, "absenteeism.recommendations.view");
  const global = isGlobal(ctx);
  if (!global && ctx.employeeId == null) return [];
  const rows = getDb()
    .sqlite.prepare(
      `SELECT r.id, r.scope, r.audience, r.manager_id AS managerId, r.action_code AS actionCode, r.title, r.rationale, r.priority, r.status, r.comment,
         r.created_at AS createdAt, r.updated_at AS updatedAt, d.name AS department, m.last_name || ' ' || m.first_name AS managerName
       FROM insight_recommendation r LEFT JOIN department d ON d.id = r.department_id LEFT JOIN employee m ON m.id = r.manager_id
       WHERE r.topic = 'ABSENTEISME' AND r.scope <> 'SALARIE' ${global ? "" : "AND r.audience = 'MANAGER' AND r.manager_id = @me"}
       ORDER BY r.status = 'PROPOSEE' DESC, r.priority, r.created_at DESC, r.id DESC LIMIT @limit`,
    )
    .all({ me: ctx.employeeId ?? -1, limit }) as RecoRow[];
  return rows.map(({ audience, managerId, department, managerName, ...r }) => ({
    ...r,
    label: r.scope === "ENTREPRISE" ? "Entreprise" : r.scope === "DEPARTEMENT" ? (department ?? "Département") : `Équipe de ${managerName ?? "—"}`,
    allowed: allowedFor(ctx, { status: r.status, audience, managerId }),
  }));
}

export const absRecoUpdateSchema = z.object({
  status: z.enum(RECO_STATUSES),
  comment: z
    .string()
    .trim()
    .max(1000, "Commentaire trop long : 1\u00a0000 caractères au plus.")
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type AbsRecoUpdate = { status: AbsRecoStatus; comment?: string };

// RH : tout changement de statut ; MANAGER : « réalisée » sur une recommandation proposée de son périmètre. Audité.
export function updateAbsenteeismRecommendation(ctx: AccessContext, id: number, input: AbsRecoUpdate): void {
  const target = { type: "insight_recommendation", id };
  ensurePilotage(ctx, "insight.recommendation.update", target);
  const { sqlite } = getDb();
  const row = sqlite
    .prepare("SELECT status, audience, manager_id AS managerId FROM insight_recommendation WHERE id = ? AND topic = 'ABSENTEISME'")
    .get(id) as { status: AbsRecoStatus; audience: string; managerId: number | null } | undefined;
  if (!row) throw notFound("Recommandation");
  if (!isGlobal(ctx) && !(row.audience === "MANAGER" && row.managerId === ctx.employeeId)) {
    audit(ctx.userId, "insight.recommendation.update", target, "REFUSE", { topic: "ABSENTEISME", motif: "hors_perimetre" });
    throw forbidden();
  }
  if (!allowedFor(ctx, row).includes(input.status)) {
    audit(ctx.userId, "insight.recommendation.update", target, "REFUSE", { topic: "ABSENTEISME", from: row.status, to: input.status });
    throw new HttpError(409, "TRANSITION_INVALIDE", "Ce changement de statut n'est pas autorisé.");
  }
  sqlite
    .prepare(
      "UPDATE insight_recommendation SET status = @status, comment = COALESCE(@comment, comment), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = @user WHERE id = @id",
    )
    .run({ id, status: input.status, comment: input.comment ?? null, user: ctx.userId });
  audit(ctx.userId, "insight.recommendation.update", target, "OK", { topic: "ABSENTEISME", from: row.status, to: input.status, comment: input.comment != null });
}

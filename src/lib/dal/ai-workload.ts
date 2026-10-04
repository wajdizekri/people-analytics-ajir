import "server-only";
import { z } from "zod";
import { dbPath, getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { loadBundle, type TopicModelRow } from "@/lib/ai/registry";
import type { WorkloadBundle } from "@/lib/ai/workload/model";
import { detectOverloads, ruleParams, type Overload } from "@/lib/ai/workload/rule";
import { opposedEmployeeIds } from "@/lib/privacy";
import { SCOPE_SUBQUERY, ensurePilotage, isGlobal, type AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";
import { MIN_GROUP_SIZE } from "./pilotage-metrics";

// Charge de travail (heures sup par ETP et par mois) : lecture des résultats de l'étape IA (forecast horizon 0 = observé,
// 1..3 = prévu) et des recommandations CHARGE_TRAVAIL. RH : tout, dont les surcharges individuelles (lecture auditée).
// MANAGER : équipes de sa hiérarchie en agrégé (>= MIN_GROUP_SIZE, garanti à l'écriture) et recommandations collectives.
// ADMIN : refusé (séparation des tâches).

const TOPIC = "CHARGE_TRAVAIL";

export type Point = { month: string; value: number };
export type ForecastPoint = { month: string; horizon: number; value: number; lower: number | null; upper: number | null };
export type Tension = "PROBABLE" | "POSSIBLE" | null;
export type GroupView = {
  key: number;
  label: string;
  departmentName: string | null;
  observed: Point[];
  forecast: ForecastPoint[];
  mean12: number | null;
  last: number | null;
  peak: ForecastPoint | null;
  tension: Tension;
};
export type WorkloadReco = {
  id: number;
  scope: "ENTREPRISE" | "DEPARTEMENT" | "EQUIPE" | "SALARIE";
  audience: "RH" | "MANAGER";
  title: string;
  rationale: string;
  priority: number;
  status: "PROPOSEE" | "REALISEE" | "REJETEE";
  comment: string | null;
  createdAt: string;
  updatedAt: string | null;
  groupLabel: string | null;
  employeeId: number | null;
};
export type OverloadView = {
  employeeId: number;
  name: string;
  departmentName: string | null;
  managerName: string | null;
  months: number;
  start: string;
  average: number;
  recent: Point[];
  level: "ELEVE" | "MOYEN" | "FAIBLE" | null;
};

type Common = { asOf: string | null; threshold: number | null; unit: string };
export type WorkloadRh = Common & {
  view: "RH";
  modelVersion: string | null;
  company: GroupView | null;
  departments: GroupView[];
  teams: GroupView[];
  overloads: OverloadView[];
  rule: { thresholdH: number; months: number };
  recommendations: WorkloadReco[];
};
export type WorkloadManager = Common & { view: "MANAGER"; teams: GroupView[]; hiddenTeams: number; recommendations: WorkloadReco[]; modelVersion?: string | null };
export type WorkloadView = WorkloadRh | WorkloadManager;

const UNIT = "heures sup par ETP et par mois";

type FRow = { scope: string; departmentId: number | null; managerId: number | null; month: string; horizon: number; value: number; lower: number | null; upper: number | null };

const g = globalThis as unknown as { __paWorkload?: { bundles: Map<string, WorkloadBundle>; overloads: Map<string, Overload[]> } };
const cache = () => (g.__paWorkload ??= { bundles: new Map(), overloads: new Map() });

function bundleFor(version: string | null): WorkloadBundle | null {
  if (!version) return null;
  const c = cache().bundles;
  if (!c.has(version)) {
    const row = getDb().sqlite.prepare("SELECT * FROM topic_model WHERE version = ?").get(version) as TopicModelRow | undefined;
    if (!row?.bundle_path) return null;
    try {
      c.set(version, loadBundle<WorkloadBundle>(row));
    } catch {
      return null;
    }
  }
  return c.get(version) ?? null;
}

function buildGroups(rows: FRow[], keyOf: (r: FRow) => number | null, label: (key: number, r: FRow) => string, deptName: (id: number | null) => string | null, threshold: number | null): GroupView[] {
  const byKey = new Map<number, FRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k == null) continue;
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  return [...byKey.entries()].map(([key, rs]) => {
    const observed = rs.filter((r) => r.horizon === 0).sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ month: r.month, value: r.value }));
    const forecast = rs
      .filter((r) => r.horizon > 0)
      .sort((a, b) => a.horizon - b.horizon)
      .map((r) => ({ month: r.month, horizon: r.horizon, value: r.value, lower: r.lower, upper: r.upper }));
    const peak = forecast.length ? forecast.reduce((a, b) => (b.value > a.value ? b : a)) : null;
    const tension: Tension =
      threshold == null || !peak || peak.value < threshold ? null : peak.lower != null && peak.lower >= threshold ? "PROBABLE" : "POSSIBLE";
    return {
      key,
      label: label(key, rs[0]),
      departmentName: deptName(rs[0].departmentId),
      observed,
      forecast,
      mean12: observed.length ? observed.reduce((s, p) => s + p.value, 0) / observed.length : null,
      last: observed.length ? observed[observed.length - 1].value : null,
      peak,
      tension,
    };
  });
}

const tensionRank = (t: Tension) => (t === "PROBABLE" ? 0 : t === "POSSIBLE" ? 1 : 2);
const byTension = (a: GroupView, b: GroupView) => tensionRank(a.tension) - tensionRank(b.tension) || (b.peak?.value ?? 0) - (a.peak?.value ?? 0) || a.label.localeCompare(b.label, "fr");

function managerSet(ctx: AccessContext): number[] {
  if (ctx.employeeId == null) return [];
  const rows = getDb().sqlite.prepare(SCOPE_SUBQUERY).all({ scopeRoot: ctx.employeeId }) as { id: number }[];
  return [ctx.employeeId, ...rows.map((r) => r.id)];
}

function listRecos(ctx: AccessContext, managers: number[] | null): WorkloadReco[] {
  const { sqlite } = getDb();
  const where = managers ? "AND r.audience = 'MANAGER' AND r.scope = 'EQUIPE' AND r.manager_id IN (SELECT value FROM json_each(@managers))" : "";
  const rows = sqlite
    .prepare(
      `SELECT r.id, r.scope, r.audience, r.title, r.rationale, r.priority, r.status, r.comment, r.created_at AS createdAt, r.updated_at AS updatedAt,
              r.employee_id AS employeeId,
              CASE r.scope WHEN 'EQUIPE' THEN 'Équipe de ' || m.first_name || ' ' || m.last_name
                           WHEN 'DEPARTEMENT' THEN d.name
                           WHEN 'SALARIE' THEN s.first_name || ' ' || s.last_name END AS groupLabel
         FROM insight_recommendation r
         LEFT JOIN employee m ON m.id = r.manager_id
         LEFT JOIN department d ON d.id = r.department_id
         LEFT JOIN employee s ON s.id = r.employee_id
        WHERE r.topic = '${TOPIC}' ${where}
        ORDER BY r.status = 'PROPOSEE' DESC, r.priority, r.id DESC LIMIT 300`,
    )
    .all(managers ? { managers: JSON.stringify(managers) } : {}) as WorkloadReco[];
  return isGlobal(ctx) ? rows : rows.map((r) => ({ ...r, employeeId: null }));
}

function overloadsFor(asOf: string, p: { thresholdH: number; months: number }): Overload[] {
  const key = `${dbPath()}|${asOf}|${p.thresholdH}|${p.months}`;
  const c = cache().overloads;
  let v = c.get(key);
  if (!v) {
    v = detectOverloads(getDb().sqlite, asOf.slice(0, 7), p);
    if (c.size > 8) c.clear();
    c.set(key, v);
  }
  return v;
}

export function getWorkload(ctx: AccessContext): WorkloadView {
  ensurePilotage(ctx, "workload.view", { type: "forecast" });
  const { sqlite } = getDb();
  const asOf = (sqlite.prepare("SELECT max(as_of) AS a FROM forecast WHERE topic = ?").get(TOPIC) as { a: string | null }).a;
  const version = asOf
    ? ((sqlite.prepare("SELECT model_version AS v FROM forecast WHERE topic = ? AND as_of = ? LIMIT 1").get(TOPIC, asOf) as { v: string } | undefined)?.v ?? null)
    : null;
  const threshold = bundleFor(version)?.tension.threshold_h ?? null;
  const depts = new Map((sqlite.prepare("SELECT id, name FROM department").all() as { id: number; name: string }[]).map((d) => [d.id, d.name]));
  const deptName = (id: number | null) => (id == null ? null : (depts.get(id) ?? null));
  const names = (ids: number[]) =>
    new Map(
      (sqlite.prepare("SELECT id, first_name || ' ' || last_name AS n FROM employee WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(ids)) as { id: number; n: string }[]).map((r) => [
        r.id,
        r.n,
      ]),
    );
  const read = (extra: string, params: Record<string, unknown>) =>
    asOf
      ? (sqlite
          .prepare(
            `SELECT scope, department_id AS departmentId, manager_id AS managerId, month, horizon, value, lower, upper
               FROM forecast WHERE topic = '${TOPIC}' AND as_of = @asOf ${extra}`,
          )
          .all({ asOf, ...params }) as FRow[])
      : [];
  const teamGroups = (rows: FRow[]) => {
    const mgrNames = names([...new Set(rows.map((r) => r.managerId).filter((x): x is number => x != null))]);
    return buildGroups(rows, (r) => r.managerId, (k) => `Équipe de ${mgrNames.get(k) ?? `n° ${k}`}`, deptName, threshold).sort(byTension);
  };

  if (ctx.role === "MANAGER") {
    const managers = managerSet(ctx);
    const rows = read("AND scope = 'EQUIPE' AND manager_id IN (SELECT value FROM json_each(@managers))", { managers: JSON.stringify(managers) });
    const teams = teamGroups(rows);
    const withReports = sqlite
      .prepare(
        `SELECT count(DISTINCT e.manager_id) AS n FROM employee e
          WHERE e.status = 'ACTIF' AND e.manager_id IN (SELECT value FROM json_each(@managers))`,
      )
      .get({ managers: JSON.stringify(managers) }) as { n: number };
    return { view: "MANAGER", asOf, threshold, unit: UNIT, teams, hiddenTeams: Math.max(0, withReports.n - teams.length), recommendations: listRecos(ctx, managers), modelVersion: version };
  }

  const rows = read("", {});
  const company = buildGroups(rows.filter((r) => r.scope === "ENTREPRISE"), () => 0, () => "Entreprise", () => null, null)[0] ?? null;
  const departments = buildGroups(rows.filter((r) => r.scope === "DEPARTEMENT"), (r) => r.departmentId, (k) => deptName(k) ?? `n° ${k}`, deptName, threshold).sort((a, b) =>
    a.label.localeCompare(b.label, "fr"),
  );
  const teams = teamGroups(rows.filter((r) => r.scope === "EQUIPE"));

  const champion = sqlite.prepare("SELECT * FROM topic_model WHERE topic = ? AND status = 'CHAMPION'").get(TOPIC) as TopicModelRow | undefined;
  const rule = ruleParams(sqlite, bundleFor(champion?.version ?? version));
  let overloads: OverloadView[] = [];
  if (asOf) {
    const opposed = opposedEmployeeIds(sqlite);
    const found = overloadsFor(asOf, rule).filter((o) => !opposed.has(o.employeeId));
    const info = new Map(
      (
        sqlite
          .prepare(
            `SELECT e.id, e.first_name || ' ' || e.last_name AS name, d.name AS dept, m.first_name || ' ' || m.last_name AS mgr,
                    (SELECT p.level FROM prediction p JOIN scoring_run r ON r.id = p.run_id
                      WHERE r.status = 'PUBLIE' AND r.as_of = @asOf AND p.employee_id = e.id ORDER BY r.id DESC LIMIT 1) AS level
               FROM employee e LEFT JOIN department d ON d.id = e.department_id LEFT JOIN employee m ON m.id = e.manager_id
              WHERE e.id IN (SELECT value FROM json_each(@ids))`,
          )
          .all({ asOf, ids: JSON.stringify(found.map((o) => o.employeeId)) }) as { id: number; name: string; dept: string | null; mgr: string | null; level: OverloadView["level"] }[]
      ).map((r) => [r.id, r]),
    );
    overloads = found.map((o) => {
      const i = info.get(o.employeeId);
      return {
        employeeId: o.employeeId,
        name: i?.name ?? `n° ${o.employeeId}`,
        departmentName: i?.dept ?? null,
        managerName: i?.mgr ?? null,
        months: o.months,
        start: o.start,
        average: o.hours.reduce((s, x) => s + x.hours, 0) / o.hours.length,
        recent: o.hours.slice(-6).map((x) => ({ month: x.month, value: x.hours })),
        level: i?.level ?? null,
      };
    });
  }
  audit(ctx.userId, "workload.view", { type: "forecast", id: asOf }, "OK", { overloads: overloads.length });
  return { view: "RH", asOf, threshold, unit: UNIT, modelVersion: version, company, departments, teams, overloads, rule, recommendations: listRecos(ctx, null) };
}

export const workloadRecoUpdateSchema = z
  .object({
    status: z.enum(["PROPOSEE", "REALISEE", "REJETEE"]),
    comment: z
      .string()
      .trim()
      .max(1000, "Commentaire trop long : 1\u00a0000 caractères au plus.")
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((d) => d.status !== "REJETEE" || (d.comment?.length ?? 0) >= 3, { path: ["comment"], message: "Un commentaire est obligatoire pour rejeter une recommandation : expliquez la décision en quelques mots (3 caractères au moins)." });
export type WorkloadRecoUpdate = z.input<typeof workloadRecoUpdateSchema>;

export function updateWorkloadRecommendation(ctx: AccessContext, id: number, input: WorkloadRecoUpdate): { id: number; status: string } {
  const target = { type: "insight_recommendation", id };
  ensurePilotage(ctx, "insight.update", target);
  const data = workloadRecoUpdateSchema.parse(input);
  const { sqlite } = getDb();
  const row = sqlite
    .prepare("SELECT id, scope, audience, manager_id AS managerId, status FROM insight_recommendation WHERE id = ? AND topic = ?")
    .get(id, TOPIC) as { id: number; scope: string; audience: string; managerId: number | null; status: string } | undefined;
  if (!row) throw notFound("Recommandation");
  if (!isGlobal(ctx)) {
    const ok = ctx.role === "MANAGER" && row.audience === "MANAGER" && row.scope === "EQUIPE" && row.managerId != null && managerSet(ctx).includes(row.managerId);
    if (!ok) {
      audit(ctx.userId, "insight.update", target, "REFUSE", { role: ctx.role });
      throw forbidden();
    }
  }
  if (row.status === data.status) throw new HttpError(409, "INCHANGE", "La recommandation a déjà ce statut.");
  const res = sqlite
    .prepare(
      `UPDATE insight_recommendation SET status = @to, comment = COALESCE(@comment, comment),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = @userId
       WHERE id = @id AND status = @from`,
    )
    .run({ id, to: data.status, from: row.status, comment: data.comment ?? null, userId: ctx.userId });
  if (res.changes !== 1) throw new HttpError(409, "CONFLIT", "La recommandation a été modifiée entre-temps. Rechargez la page.");
  audit(ctx.userId, "insight.update", target, "OK", { topic: TOPIC, from: row.status, to: data.status, comment: !!data.comment });
  return { id, status: data.status };
}

export { MIN_GROUP_SIZE };

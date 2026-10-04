import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { RH_ONLY_ACTIONS } from "@/lib/features/spec";
import { opposedEmployeeIds } from "@/lib/privacy";
import { ensureRole } from "./admin";
import { isGlobal, type AccessContext } from "./context";
import { referenceDate, type AuditMeta, type RiskLevel } from "./employees";
import { addMonths, monthEnd, monthRange } from "./pilotage-metrics";
import { absenteeismOf, guardEmployee, monthlyMeasures, overtimePerHeadOf, publishedRuns, sumMeasures, type MeasureSet, type RunRef } from "./teams";

// Interventions (RH) : actions réalisées (table intervention + recommandations réalisées sans intervention enregistrée),
// taux de réalisation par type d'action et mesure avant / après sur 3 mois civils de part et d'autre du mois de l'action.
// Observation, pas un effet causal : pas de groupe témoin, retour naturel vers la moyenne après un niveau Élevé.

export const EFFECT_WINDOW_MONTHS = 3;
const PAGE_SIZE = 25;
const LEVEL_RANK: Record<RiskLevel, number> = { FAIBLE: 0, MOYEN: 1, ELEVE: 2 };

export const interventionsQuerySchema = z.object({
  action: z
    .string()
    .regex(/^[A-Z0-9_]{2,40}$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type InterventionsQuery = z.output<typeof interventionsQuerySchema>;

export type LevelChange = "BAISSE" | "HAUSSE" | "STABLE";

export type EffectMeasure = {
  complete: boolean;
  monthsBefore: number;
  monthsAfter: number;
  levelBefore: RiskLevel | null;
  levelAfter: RiskLevel | null;
  levelChange: LevelChange | null;
  absenteeismBefore: number | null;
  absenteeismAfter: number | null;
  overtimeBefore: number | null;
  overtimeAfter: number | null;
};

export type InterventionRow = {
  key: string;
  interventionId: number | null;
  recommendationId: number | null;
  employee: { id: number; name: string; matricule: string };
  department: string | null;
  actionCode: string;
  triggerGroup: string | null;
  date: string;
  source: "INTERVENTION" | "RECOMMANDATION";
  opposed: boolean;
  measure: EffectMeasure | null;
};

export type ActionStats = {
  actionCode: string;
  proposed: number;
  done: number;
  rejected: number;
  total: number;
  completionRate: number | null;
  actions: number;
  measured: number;
  levelDown: number;
  levelUp: number;
  levelSame: number;
  absenteeismDelta: number | null;
  overtimeDelta: number | null;
};

export type InterventionsDto = {
  referenceDate: string;
  windowMonths: number;
  totals: ActionStats;
  byAction: ActionStats[];
  rows: InterventionRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  actions: string[];
};

type ActionRaw = { interventionId: number | null; recommendationId: number | null; employeeId: number; date: string; actionCode: string; triggerGroup: string | null };

const ACTIONS_SQL = `
  SELECT i.id AS interventionId, i.recommendation_id AS recommendationId, i.employee_id AS employeeId, i.date, i.action_code AS actionCode, r.trigger_group AS triggerGroup
  FROM intervention i LEFT JOIN recommendation r ON r.id = i.recommendation_id
  UNION ALL
  SELECT NULL, r.id, r.employee_id, substr(COALESCE(r.updated_at, r.created_at), 1, 10), r.action_code, r.trigger_group
  FROM recommendation r WHERE r.status = 'REALISEE' AND NOT EXISTS (SELECT 1 FROM intervention i WHERE i.recommendation_id = r.id)`;

export function levelChange(before: RiskLevel | null, after: RiskLevel | null): LevelChange | null {
  if (!before || !after) return null;
  const d = LEVEL_RANK[after] - LEVEL_RANK[before];
  return d < 0 ? "BAISSE" : d > 0 ? "HAUSSE" : "STABLE";
}

// Niveau avant = dernier calcul publié antérieur à l'action ; après = dernier calcul au plus tard fin M+3, postérieur au mois de l'action
function pickRuns(runs: RunRef[], date: string): { before: RunRef | null; after: RunRef | null } {
  const month = date.slice(0, 7);
  const afterEnd = monthEnd(addMonths(month, EFFECT_WINDOW_MONTHS));
  const monthLast = monthEnd(month);
  return {
    before: runs.find((r) => r.asOf < date) ?? null,
    after: runs.find((r) => r.asOf <= afterEnd && r.asOf > monthLast) ?? null,
  };
}

function measureActions(actions: ActionRaw[], ref: string, opposed: Set<number>): (EffectMeasure | null)[] {
  if (!actions.length) return [];
  const { sqlite } = getDb();
  const runs = publishedRuns();
  const refMonth = ref.slice(0, 7);
  const months = actions.map((a) => a.date.slice(0, 7));
  const first = addMonths(months.reduce((a, b) => (a < b ? a : b)), -EFFECT_WINDOW_MONTHS);
  const lastWanted = addMonths(months.reduce((a, b) => (a > b ? a : b)), EFFECT_WINDOW_MONTHS);
  const last = lastWanted < refMonth ? lastWanted : refMonth;
  const ids = [...new Set(actions.map((a) => a.employeeId))].filter((id) => !opposed.has(id));
  const people = sqlite
    .prepare("SELECT id, hire_date AS hireDate, exit_date AS exitDate FROM employee WHERE id IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify(ids)) as { id: number; hireDate: string; exitDate: string | null }[];
  const set: MeasureSet = first <= last ? monthlyMeasures(people, monthRange(first, last), ref) : { buckets: [], byEmployee: new Map() };
  const index = new Map(set.buckets.map((b, i) => [b.key, i]));

  const picked = actions.map((a) => pickRuns(runs, a.date));
  const runIds = [...new Set(picked.flatMap((p) => [p.before?.id, p.after?.id]).filter((x): x is number => x != null))];
  const levels = new Map<string, RiskLevel>();
  if (runIds.length && ids.length)
    for (const r of sqlite
      .prepare("SELECT run_id AS runId, employee_id AS id, level FROM prediction WHERE run_id IN (SELECT value FROM json_each(?)) AND employee_id IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(runIds), JSON.stringify(ids)) as { runId: number; id: number; level: RiskLevel }[])
      levels.set(`${r.runId}:${r.id}`, r.level);

  return actions.map((a, k) => {
    if (opposed.has(a.employeeId)) return null;
    const m = a.date.slice(0, 7);
    const range = (from: number, to: number) => {
      const idx = monthRange(addMonths(m, from), addMonths(m, to))
        .map((x) => index.get(x))
        .filter((x): x is number => x != null);
      if (!idx.length) return { n: 0, abs: null, ot: null };
      const t = sumMeasures(set, [a.employeeId], idx[0], idx[idx.length - 1]);
      return { n: idx.length, abs: absenteeismOf(t), ot: overtimePerHeadOf(t) };
    };
    const before = range(-EFFECT_WINDOW_MONTHS, -1);
    const after = range(1, EFFECT_WINDOW_MONTHS);
    const { before: rb, after: ra } = picked[k];
    const levelBefore = rb ? (levels.get(`${rb.id}:${a.employeeId}`) ?? null) : null;
    const levelAfter = ra ? (levels.get(`${ra.id}:${a.employeeId}`) ?? null) : null;
    return {
      complete: after.n === EFFECT_WINDOW_MONTHS && monthEnd(addMonths(m, EFFECT_WINDOW_MONTHS)) <= ref,
      monthsBefore: before.n,
      monthsAfter: after.n,
      levelBefore,
      levelAfter,
      levelChange: levelChange(levelBefore, levelAfter),
      absenteeismBefore: before.abs,
      absenteeismAfter: after.n ? after.abs : null,
      overtimeBefore: before.ot,
      overtimeAfter: after.n ? after.ot : null,
    };
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function actionStats(actionCode: string, counts: { proposed: number; done: number; rejected: number }, measures: (EffectMeasure | null)[]): ActionStats {
  const complete = measures.filter((m): m is EffectMeasure => !!m && m.complete);
  const total = counts.proposed + counts.done + counts.rejected;
  return {
    actionCode,
    ...counts,
    total,
    completionRate: total ? counts.done / total : null,
    actions: measures.length,
    measured: complete.length,
    levelDown: complete.filter((m) => m.levelChange === "BAISSE").length,
    levelUp: complete.filter((m) => m.levelChange === "HAUSSE").length,
    levelSame: complete.filter((m) => m.levelChange === "STABLE").length,
    absenteeismDelta: mean(complete.flatMap((m) => (m.absenteeismBefore != null && m.absenteeismAfter != null ? [m.absenteeismAfter - m.absenteeismBefore] : []))),
    overtimeDelta: mean(complete.flatMap((m) => (m.overtimeBefore != null && m.overtimeAfter != null ? [m.overtimeAfter - m.overtimeBefore] : []))),
  };
}

export function getInterventions(ctx: AccessContext, q: InterventionsQuery, meta: AuditMeta): InterventionsDto {
  ensureRole(ctx, ["RH"], "interventions.view");
  const { sqlite } = getDb();
  const ref = referenceDate();
  const opposed = opposedEmployeeIds(sqlite);
  const all = (sqlite.prepare(ACTIONS_SQL).all() as ActionRaw[]).sort((a, b) => b.date.localeCompare(a.date) || (b.interventionId ?? 0) - (a.interventionId ?? 0));
  const measures = measureActions(all, ref, opposed);

  const counts = new Map<string, { proposed: number; done: number; rejected: number }>();
  for (const r of sqlite
    .prepare(
      `SELECT action_code AS action, COALESCE(SUM(status = 'PROPOSEE'), 0) AS proposed, COALESCE(SUM(status = 'REALISEE'), 0) AS done,
        COALESCE(SUM(status = 'REJETEE'), 0) AS rejected FROM recommendation GROUP BY action_code`,
    )
    .all() as { action: string; proposed: number; done: number; rejected: number }[])
    counts.set(r.action, { proposed: r.proposed, done: r.done, rejected: r.rejected });
  const codes = [...new Set([...counts.keys(), ...all.map((a) => a.actionCode)])].sort();
  const zero = { proposed: 0, done: 0, rejected: 0 };
  const byAction = codes.map((code) =>
    actionStats(
      code,
      counts.get(code) ?? zero,
      measures.filter((_, i) => all[i].actionCode === code),
    ),
  );
  const sum = [...counts.values()].reduce((s, c) => ({ proposed: s.proposed + c.proposed, done: s.done + c.done, rejected: s.rejected + c.rejected }), zero);
  const totals = actionStats("TOUTES", sum, measures);

  const filtered = all.map((a, i) => ({ a, m: measures[i] })).filter(({ a }) => !q.action || a.actionCode === q.action);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(q.page, pageCount);
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const who = new Map(
    (
      sqlite
        .prepare(
          `SELECT e.id, e.last_name || ' ' || e.first_name AS name, e.matricule, d.name AS department
           FROM employee e LEFT JOIN department d ON d.id = e.department_id WHERE e.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(slice.map(({ a }) => a.employeeId))) as { id: number; name: string; matricule: string; department: string | null }[]
    ).map((e) => [e.id, e]),
  );
  const rows: InterventionRow[] = slice.map(({ a, m }) => {
    const e = who.get(a.employeeId);
    return {
      key: a.interventionId != null ? `i${a.interventionId}` : `r${a.recommendationId}`,
      interventionId: a.interventionId,
      recommendationId: a.recommendationId,
      employee: { id: a.employeeId, name: e?.name ?? "", matricule: e?.matricule ?? "" },
      department: e?.department ?? null,
      actionCode: a.actionCode,
      triggerGroup: a.triggerGroup,
      date: a.date,
      source: a.interventionId != null ? "INTERVENTION" : "RECOMMANDATION",
      opposed: opposed.has(a.employeeId),
      measure: m,
    };
  });

  audit(ctx.userId, "interventions.view", { type: "interventions", id: q.action ?? null }, "OK", { source: meta.source, rows: rows.length, page }, meta.ip);
  return { referenceDate: ref, windowMonths: EFFECT_WINDOW_MONTHS, totals, byAction, rows, total: filtered.length, page, pageSize: PAGE_SIZE, pageCount, actions: codes };
}

// ---------- Fiche : « Avant / après intervention » ----------

export type EmployeeEffectsDto =
  | {
      view: "RH";
      employeeId: number;
      windowMonths: number;
      opposed: boolean;
      items: { key: string; date: string; actionCode: string; source: "INTERVENTION" | "RECOMMANDATION"; measure: EffectMeasure | null }[];
    }
  | {
      view: "MANAGER";
      employeeId: number;
      windowMonths: number;
      // le manager ne connaît pas l'opposition (minimisation, dal/privacy.ts)
      opposed: false;
      items: { key: string; month: string; actionCode: string; levelBefore: RiskLevel | null; levelAfter: RiskLevel | null; levelChange: LevelChange | null; complete: boolean }[];
    };

// RH : mesure complète. Manager : actions issues d'une recommandation qu'il voit déjà (hors actions réservées à la RH),
// au mois près, avec les seuls niveaux de risque (ni absentéisme ni heures sup individuels).
export function getEmployeeInterventionEffects(ctx: AccessContext, employeeId: number, meta: AuditMeta): EmployeeEffectsDto {
  guardEmployee(ctx, employeeId, "employee.effects.view", meta);
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const opposed = opposedEmployeeIds(sqlite);
  const isOpp = opposed.has(employeeId);
  const actions = (sqlite.prepare(`SELECT * FROM (${ACTIONS_SQL}) WHERE employeeId = ? ORDER BY date DESC`).all(employeeId) as ActionRaw[]).filter(
    (a) => global || (a.recommendationId != null && !RH_ONLY_ACTIONS.has(a.actionCode)),
  );
  const measures = measureActions(actions, ref, opposed);
  audit(ctx.userId, "employee.effects.view", { type: "employee", id: employeeId }, "OK", { source: meta.source, view: global ? "RH" : "MANAGER", items: actions.length }, meta.ip);
  const key = (a: ActionRaw) => (a.interventionId != null ? `i${a.interventionId}` : `r${a.recommendationId}`);
  if (global)
    return {
      view: "RH",
      employeeId,
      windowMonths: EFFECT_WINDOW_MONTHS,
      opposed: isOpp,
      items: actions.map((a, i) => ({ key: key(a), date: a.date, actionCode: a.actionCode, source: a.interventionId != null ? "INTERVENTION" : "RECOMMANDATION", measure: measures[i] })),
    };
  return {
    view: "MANAGER",
    employeeId,
    windowMonths: EFFECT_WINDOW_MONTHS,
    opposed: false,
    items: actions.map((a, i) => {
      const m = measures[i];
      return {
        key: key(a),
        month: a.date.slice(0, 7),
        actionCode: a.actionCode,
        levelBefore: m?.levelBefore ?? null,
        levelAfter: m?.levelAfter ?? null,
        levelChange: m?.levelChange ?? null,
        complete: m?.complete ?? false,
      };
    }),
  };
}

import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { computeWorkforce, observedMassByYear, readBudgets } from "@/lib/ai/workforce/compute";
import { CAUSES, type Cause, type SeriesOut } from "@/lib/ai/workforce/engine";
import { loadWorkforceModels } from "@/lib/ai/workforce/models";
import { WORKFORCE_ACTIONS } from "@/lib/ai/workforce/recommendations";
import type { AccessContext } from "./context";
import { forbidden, notFound } from "./errors";

// Projection des effectifs et de la masse salariale : écran réservé à la RH (masse salariale = donnée sensible).
// Les scénarios sont recalculés à la volée côté serveur, sans aucune écriture en base.

const num = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").replace(",", ".") : v), z.coerce.number().min(min).max(max));

export const workforceScenarioSchema = z.object({
  embauches: num(0, 300).optional(),
  hausse: num(0, 30).optional(),
  budget: num(1, 1e11).optional(),
  departement: z.coerce.number().int().positive().optional(),
});
export type WorkforceScenarioQuery = z.output<typeof workforceScenarioSchema>;

export const WORKFORCE_RECO_STATUSES = ["PROPOSEE", "REALISEE", "REJETEE"] as const;
export const workforceRecoUpdateSchema = z
  .object({
    status: z.enum(WORKFORCE_RECO_STATUSES),
    comment: z
      .string()
      .trim()
      .max(1000, "Commentaire trop long : 1\u00a0000 caractères au plus.")
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.status !== "REJETEE" || (v.comment?.length ?? 0) >= 3, {
    message: "Un commentaire est obligatoire pour rejeter une recommandation : expliquez la décision en quelques mots (3 caractères au moins).",
    path: ["comment"],
  });

type Point = { month: string; value: number };
type Band = { month: string; value: number; lower: number; upper: number };
export type WorkforceSeries = { observedHc: Point[]; observedMass: Point[]; hc: Band[]; mass: Band[] | null; referenceHc: Band[]; referenceMass: Band[] };
export type WorkforceDeptRow = {
  id: number;
  code: string;
  name: string;
  hc0: number;
  hc6: number;
  hc12: number;
  lower12: number;
  upper12: number;
  exits12: Record<Cause, number>;
  hires12: number;
  mass0: number | null;
  mass12: number | null;
  massLower12: number | null;
  massUpper12: number | null;
};
export type WorkforceReco = {
  id: number;
  topic: "EFFECTIF" | "MASSE_SALARIALE";
  department: string | null;
  actionLabel: string;
  title: string;
  rationale: string;
  priority: number;
  status: (typeof WORKFORCE_RECO_STATUSES)[number];
  comment: string | null;
  updatedAt: string | null;
};
export type WorkforceView =
  | { status: "NO_MODEL" }
  | { status: "NO_FORECAST"; modelVersion: string }
  | {
      status: "OK";
      asOf: string;
      months: string[];
      models: { effectif: string; masse: string | null };
      resignSource: "TAUX" | "LOGREG";
      scenario: { hiringPct: number; raisePct: number; raiseDefaultPct: number; isReference: boolean; budget: number | null; budgetFromSettings: boolean; budgetYear: number | null };
      params: { qCdd: number; qRet: number; driftPct: number };
      departmentOptions: { id: number; label: string }[];
      focus: { departmentId: number | null; label: string; series: WorkforceSeries };
      total: WorkforceDeptRow;
      departments: WorkforceDeptRow[];
      byGrade: { grade: string; hc0: number; avgBase0: number; hc12: number }[];
      budget: { year: number; amount: number; observed: number; observedMonths: number; projected: number; projectedLower: number; projectedUpper: number; gap: number } | null;
      recommendations: WorkforceReco[];
    };

function ensureRh(ctx: AccessContext, action: string, target?: { type: string; id?: number | string }) {
  if (ctx.role === "RH") return;
  audit(ctx.userId, action, target ?? { type: "workforce" }, "REFUSE", { role: ctx.role });
  throw forbidden();
}

const sumArr = (a: number[]) => a.reduce((s, v) => s + v, 0);

function row(id: number, code: string, name: string, s: SeriesOut): WorkforceDeptRow {
  const H = s.hc.length;
  return {
    id,
    code,
    name,
    hc0: s.hc0,
    hc6: s.hc[Math.min(5, H - 1)],
    hc12: s.hc[H - 1],
    lower12: s.hcLower[H - 1],
    upper12: s.hcUpper[H - 1],
    exits12: Object.fromEntries(CAUSES.map((c) => [c, sumArr(s.exits[c])])) as Record<Cause, number>,
    hires12: sumArr(s.hires),
    mass0: s.mass0,
    mass12: s.mass ? s.mass[H - 1] : null,
    massLower12: s.massLower ? s.massLower[H - 1] : null,
    massUpper12: s.massUpper ? s.massUpper[H - 1] : null,
  };
}

function bands(months: string[], v: number[] | null, lo: number[] | null, up: number[] | null): Band[] | null {
  if (!v || !lo || !up) return null;
  return months.map((month, i) => ({ month, value: v[i], lower: lo[i], upper: up[i] }));
}

export function getWorkforceForecast(ctx: AccessContext, q: WorkforceScenarioQuery): WorkforceView {
  ensureRh(ctx, "workforce.view");
  const { sqlite } = getDb();
  const models = loadWorkforceModels(sqlite);
  if (!models) return { status: "NO_MODEL" };
  const last = sqlite.prepare("SELECT MAX(as_of) AS asOf FROM forecast WHERE topic = 'EFFECTIF'").get() as { asOf: string | null };
  if (!last.asOf) return { status: "NO_FORECAST", modelVersion: models.rowE.version };
  const asOf = last.asOf;
  const month0 = asOf.slice(0, 7);

  const hiringPct = q.embauches ?? 100;
  const raise = q.hausse == null ? null : q.hausse / 100;
  const { state, proj } = computeWorkforce(sqlite, asOf, models, { hiringPct, raise });
  const isReference = hiringPct === 100 && (raise == null || Math.abs(raise - state.raise) < 1e-12);

  const depts = proj.departments.filter((d) => d.hc0 > 0 || sumArr(d.hires) > 0);
  const focusDept = q.departement ? depts.find((d) => d.id === q.departement) ?? null : null;
  const focusSeries: SeriesOut = focusDept ?? proj.total;

  const histFrom = `${Number(month0.slice(0, 4)) - 2}${month0.slice(4)}`;
  const hist = sqlite
    .prepare(
      `SELECT month, SUM(headcount) AS hc, SUM(payroll_mass) AS mass FROM agg_kpi_monthly
       WHERE month > @from AND month <= @to AND (@dept IS NULL OR department_id = @dept) GROUP BY month ORDER BY month`,
    )
    .all({ from: histFrom, to: month0, dept: focusDept?.id ?? null }) as { month: string; hc: number; mass: number }[];
  const ref = sqlite
    .prepare(
      `SELECT topic, month, value, lower, upper FROM forecast WHERE as_of = @asOf AND topic IN ('EFFECTIF','MASSE_SALARIALE')
       AND ((@dept IS NULL AND scope = 'ENTREPRISE') OR (scope = 'DEPARTEMENT' AND department_id = @dept)) ORDER BY horizon`,
    )
    .all({ asOf, dept: focusDept?.id ?? null }) as { topic: string; month: string; value: number; lower: number; upper: number }[];

  const years = [...new Set(proj.months.map((m) => Number(m.slice(0, 4))))];
  const observed = observedMassByYear(sqlite, month0);
  const settings = readBudgets(sqlite);
  let budget: Extract<WorkforceView, { status: "OK" }>["budget"] = null;
  let budgetFromSettings = false;
  let budgetYear: number | null = null;
  const tm = proj.total.mass;
  if (tm && proj.total.massLower && proj.total.massUpper) {
    for (const y of years) {
      const idx = proj.months.map((m, i) => (Number(m.slice(0, 4)) === y ? i : -1)).filter((i) => i >= 0);
      const obs = observed.get(y) ?? { total: 0, months: 0 };
      if (obs.months + idx.length !== 12) continue;
      budgetYear = y;
      const amount = q.budget ?? settings.get(y) ?? null;
      if (amount == null) continue;
      budgetFromSettings = q.budget == null;
      const projected = sumArr(idx.map((i) => tm[i]));
      budget = {
        year: y,
        amount,
        observed: obs.total,
        observedMonths: obs.months,
        projected,
        projectedLower: sumArr(idx.map((i) => proj.total.massLower![i])),
        projectedUpper: sumArr(idx.map((i) => proj.total.massUpper![i])),
        gap: (obs.total + projected) / amount - 1,
      };
      break;
    }
  }

  const recos = sqlite
    .prepare(
      `SELECT r.id, r.topic, d.name AS department, r.action_code AS actionCode, r.title, r.rationale, r.priority, r.status, r.comment, r.updated_at AS updatedAt
       FROM insight_recommendation r LEFT JOIN department d ON d.id = r.department_id
       WHERE r.topic IN ('EFFECTIF','MASSE_SALARIALE') AND r.audience = 'RH' AND r.dedup_key LIKE @suffix
       ORDER BY r.priority, r.topic, d.name, r.id`,
    )
    .all({ suffix: `%:${asOf}` }) as (Omit<WorkforceReco, "actionLabel"> & { actionCode: string })[];

  audit(ctx.userId, "workforce.view", { type: "forecast", id: asOf }, "OK", isReference && !q.budget ? undefined : { hiringPct, raisePct: raise == null ? null : raise * 100, budget: q.budget ?? null });

  return {
    status: "OK",
    asOf,
    months: proj.months,
    models: { effectif: models.rowE.version, masse: models.rowM?.version ?? null },
    resignSource: state.resignSource,
    scenario: { hiringPct, raisePct: proj.raise * 100, raiseDefaultPct: state.raise * 100, isReference, budget: budget?.amount ?? q.budget ?? null, budgetFromSettings, budgetYear },
    params: { qCdd: state.qCdd, qRet: state.qRet, driftPct: state.drift * 100 },
    departmentOptions: depts.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` })),
    focus: {
      departmentId: focusDept?.id ?? null,
      label: focusDept ? `${focusDept.code} — ${focusDept.name}` : "Entreprise",
      series: {
        observedHc: hist.map((h) => ({ month: h.month, value: h.hc })),
        observedMass: hist.map((h) => ({ month: h.month, value: h.mass })),
        hc: bands(proj.months, focusSeries.hc, focusSeries.hcLower, focusSeries.hcUpper)!,
        mass: bands(proj.months, focusSeries.mass, focusSeries.massLower, focusSeries.massUpper),
        referenceHc: ref.filter((r) => r.topic === "EFFECTIF").map(({ month, value, lower, upper }) => ({ month, value, lower, upper })),
        referenceMass: ref.filter((r) => r.topic === "MASSE_SALARIALE").map(({ month, value, lower, upper }) => ({ month, value, lower, upper })),
      },
    },
    total: row(0, "TOTAL", "Entreprise", proj.total),
    departments: depts.map((d) => row(d.id, d.code, d.name, d)),
    byGrade: proj.byGrade,
    budget,
    recommendations: recos.map((r) => ({ ...r, actionLabel: WORKFORCE_ACTIONS[r.actionCode] ?? r.actionCode })),
  };
}

export function updateWorkforceRecommendation(ctx: AccessContext, id: number, input: { status: (typeof WORKFORCE_RECO_STATUSES)[number]; comment?: string }): void {
  ensureRh(ctx, "insight.update", { type: "insight_recommendation", id });
  const { sqlite } = getDb();
  const cur = sqlite.prepare("SELECT id, topic, status FROM insight_recommendation WHERE id = ?").get(id) as { id: number; topic: string; status: string } | undefined;
  if (!cur || (cur.topic !== "EFFECTIF" && cur.topic !== "MASSE_SALARIALE")) throw notFound("Recommandation");
  sqlite
    .prepare(
      `UPDATE insight_recommendation SET status = @status, comment = COALESCE(@comment, comment), updated_by = @userId,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`,
    )
    .run({ id, status: input.status, comment: input.comment ?? null, userId: ctx.userId });
  audit(ctx.userId, "insight.update", { type: "insight_recommendation", id }, "OK", { topic: cur.topic, from: cur.status, to: input.status });
}

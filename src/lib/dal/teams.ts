import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { workStartSql } from "@/lib/aggregates";
import { RH_ONLY_ACTIONS } from "@/lib/features/spec";
import { canSeeEmployee, ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import { workingDays } from "./dashboard";
import { departmentOptions, getPublishedRun, referenceDate, type AuditMeta, type ModelKind, type Option, type RiskLevel } from "./employees";
import { forbidden, notFound } from "./errors";
import {
  MIN_GROUP_SIZE,
  absenceByEmployee,
  addMonths,
  isUnplannedNonHealth,
  monthBuckets,
  monthRange,
  ratio,
  smallGroupMask,
  workableCounter,
  type AbsenceEp,
  type Bucket,
  type PopEmployee,
  type PopMember,
} from "./pilotage-metrics";

// « Mes équipes » (RH et MANAGER) et mesures partagées par la synthèse du mois, les interventions et les composants de fiche.
// Équipe = collaborateurs rattachés directement à un même manager (même définition que l'écran Absentéisme).

// ---------- Mesures partagées ----------

export type RunRef = { id: number; asOf: string; finishedAt: string | null; kind: ModelKind };

// Un calcul publié par fin de mois (le calcul courant pour son mois, sinon le plus récent), jusqu'au calcul courant, du plus récent au plus ancien
export function publishedRuns(): RunRef[] {
  const { sqlite } = getDb();
  const current = getPublishedRun();
  if (!current) return [];
  return sqlite
    .prepare(
      `SELECT r.id, r.as_of AS asOf, r.finished_at AS finishedAt, m.kind FROM scoring_run r JOIN model_version m ON m.id = r.model_version_id
       WHERE r.status = 'PUBLIE' AND r.as_of <= @asOf AND r.id = (
         SELECT r2.id FROM scoring_run r2 WHERE r2.as_of = r.as_of AND r2.status = 'PUBLIE' ORDER BY (r2.id = @current) DESC, r2.id DESC LIMIT 1)
       ORDER BY r.as_of DESC`,
    )
    .all({ asOf: current.asOf, current: current.id }) as RunRef[];
}

export function levelsOfRun(runId: number, ids?: number[]): Map<number, RiskLevel> {
  const sql = ids
    ? "SELECT employee_id AS id, level FROM prediction WHERE run_id = @runId AND employee_id IN (SELECT value FROM json_each(@ids))"
    : "SELECT employee_id AS id, level FROM prediction WHERE run_id = @runId";
  const rows = getDb().sqlite.prepare(sql).all({ runId, ids: JSON.stringify(ids ?? []) }) as { id: number; level: RiskLevel }[];
  return new Map(rows.map((r) => [r.id, r.level]));
}

export type Member = PopMember & { status: "ACTIF" | "SORTI"; departmentId: number | null; managerId: number | null };

// Collaborateurs du périmètre présents sur [from, to] (tous contrats) ; workStart sert aux effectifs hors stages et SIVP
export function scopeMembers(ctx: AccessContext, from: string, to: string): Member[] {
  const scope = scopeFilter(ctx, "e.id");
  return getDb()
    .sqlite.prepare(
      `SELECT e.id, e.hire_date AS hireDate, e.exit_date AS exitDate, ${workStartSql("e")} AS workStart, e.status,
        e.department_id AS departmentId, e.manager_id AS managerId
       FROM employee e WHERE ${scope.clause} AND e.hire_date <= @to AND (e.exit_date IS NULL OR e.exit_date >= @from)`,
    )
    .all({ ...scope.params, from, to }) as Member[];
}

export type Measure = { absence: number[]; workable: number[]; overtime: number[] };
export type MeasureSet = { buckets: Bucket[]; byEmployee: Map<number, Measure> };

// Par salarié et par mois : jours d'absence hors santé non planifiée (au prorata des jours ouvrés), jours ouvrés « employé »
// et heures supplémentaires pointées. Le dernier mois est tronqué à `until` (fin des données).
export function monthlyMeasures(members: PopEmployee[], months: string[], until: string): MeasureSet {
  const buckets = monthBuckets(months)
    .filter((b) => b.from <= until)
    .map((b) => (b.to > until ? { ...b, to: until } : b));
  const byEmployee = new Map<number, Measure>();
  if (!buckets.length || !members.length) return { buckets, byEmployee };
  const { sqlite } = getDb();
  const from = buckets[0].from;
  const to = buckets[buckets.length - 1].to;
  const isWorking = workingDays(from, to);
  const params = { ids: JSON.stringify(members.map((m) => m.id)), from, to };
  const episodes = (
    sqlite
      .prepare(
        `SELECT employee_id AS employeeId, start_date AS startDate, end_date AS endDate, days, is_health AS isHealth, category
         FROM absence_episode WHERE employee_id IN (SELECT value FROM json_each(@ids)) AND end_date >= @from AND start_date <= @to`,
      )
      .all(params) as (Omit<AbsenceEp, "isHealth"> & { isHealth: number })[]
  )
    .map((a) => ({ ...a, isHealth: !!a.isHealth }))
    .filter(isUnplannedNonHealth);
  const absence = absenceByEmployee(buckets, episodes, isWorking);
  const count = workableCounter(buckets, isWorking);
  for (const m of members)
    byEmployee.set(m.id, { absence: absence.get(m.id) ?? buckets.map(() => 0), workable: count([m]), overtime: buckets.map(() => 0) });
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const overtime = sqlite
    .prepare(
      `SELECT employee_id AS id, substr(date, 1, 7) AS month, SUM(overtime_minutes) / 60.0 AS hours FROM attendance_daily
       WHERE employee_id IN (SELECT value FROM json_each(@ids)) AND date BETWEEN @from AND @to GROUP BY employee_id, substr(date, 1, 7)`,
    )
    .all(params) as { id: number; month: string; hours: number }[];
  for (const r of overtime) {
    const i = index.get(r.month);
    const e = byEmployee.get(r.id);
    if (e && i != null) e.overtime[i] += r.hours;
  }
  return { buckets, byEmployee };
}

export type MeasureTotal = { absenceDays: number; workableDays: number; overtimeHours: number; presentMonths: number };

// Somme sur des salariés et des mois (indices [first, last] inclus) ; presentMonths = mois-personnes avec au moins un jour ouvré
export function sumMeasures(set: MeasureSet, ids: Iterable<number>, first = 0, last = set.buckets.length - 1): MeasureTotal {
  const t: MeasureTotal = { absenceDays: 0, workableDays: 0, overtimeHours: 0, presentMonths: 0 };
  for (const id of ids) {
    const m = set.byEmployee.get(id);
    if (!m) continue;
    for (let i = Math.max(0, first); i <= last && i < set.buckets.length; i++) {
      t.absenceDays += m.absence[i];
      t.workableDays += m.workable[i];
      t.overtimeHours += m.overtime[i];
      if (m.workable[i] > 0) t.presentMonths++;
    }
  }
  return t;
}

export const absenteeismOf = (t: MeasureTotal) => ratio(t.absenceDays, t.workableDays);
export const overtimePerHeadOf = (t: MeasureTotal) => (t.presentMonths > 0 ? t.overtimeHours / t.presentMonths : null);

// Accès nominatif à une fiche : pilotage seulement, 404 si inexistant, 403 audité si hors périmètre
export function guardEmployee(ctx: AccessContext, employeeId: number, action: string, meta: AuditMeta): void {
  const target = { type: "employee", id: employeeId };
  ensurePilotage(ctx, action, target);
  if (!getDb().sqlite.prepare("SELECT 1 AS ok FROM employee WHERE id = ?").get(employeeId)) throw notFound("Collaborateur");
  if (!canSeeEmployee(ctx, employeeId)) {
    audit(ctx.userId, action, target, "REFUSE", { source: meta.source }, meta.ip);
    throw forbidden();
  }
}

// ---------- Mes équipes ----------

export const TEAM_WINDOW_MONTHS = 3;
// Seuils des signaux de tension ; une équipe cumule 0 à 5 signaux
export const TENSION_RULES = {
  riskShare: 0.25, // part Élevé + Moyen parmi les évalués
  riskHigh: 2, // ou au moins 2 collaborateurs en risque élevé
  absenteeismRatio: 1.5, // absentéisme >= 1,5 × la référence…
  absenteeismGap: 0.01, // … et au moins 1 point au-dessus
  overtimeAbs: 20, // heures sup par personne et par mois (seuil de la règle B0)
  overtimeRatio: 1.5,
  overtimeGap: 2,
  trainingShare: 0.2, // part de l'équipe avec une formation obligatoire en retard
  recoShare: 0.2, // recommandations ouvertes rapportées à l'effectif
  recoMin: 2,
} as const;

export const TENSION_SIGNALS = ["RISQUE", "ABSENTEISME", "HEURES_SUP", "FORMATION", "RECOMMANDATIONS"] as const;
export type TensionSignal = (typeof TENSION_SIGNALS)[number];
export type TensionLevel = "FORTE" | "TENSION" | "SURVEILLER" | "STABLE";
export const TENSION_ORDER: Record<TensionLevel, number> = { FORTE: 3, TENSION: 2, SURVEILLER: 1, STABLE: 0 };

export const teamsQuerySchema = z.object({
  departement: z.coerce.number().int().positive().optional(),
  tension: z.enum(["oui"]).optional(),
});
export type TeamsQuery = z.output<typeof teamsQuerySchema>;

type RiskCounts = { ELEVE: number; MOYEN: number; FAIBLE: number; nonScored: number };

export type TeamStats = {
  key: string;
  managerId: number | null;
  label: string;
  department: { id: number | null; name: string };
  headcount: number;
  present: number;
  risk: RiskCounts;
  // null quand masqué (vue manager, groupe < MIN_GROUP_SIZE ou déductible par différence)
  absenteeismRate: number | null;
  overtimePerHead: number | null;
  masked: boolean;
  trainings: { overdue: number; due: number; done: number; rate: number | null };
  openRecommendations: number;
  signals: TensionSignal[];
  tension: TensionLevel;
};

export type TeamsDto = {
  view: "RH" | "MANAGER";
  referenceDate: string;
  window: { from: string; to: string; months: string[] };
  runAsOf: string | null;
  total: TeamStats;
  teams: TeamStats[];
  totalTeams: number;
  tensionCounts: Record<TensionLevel, number>;
  maskedTeams: number;
  departments: Option[];
  filters: { departement: number | null; tension: boolean };
};

export function tensionLevel(n: number): TensionLevel {
  return n >= 3 ? "FORTE" : n === 2 ? "TENSION" : n === 1 ? "SURVEILLER" : "STABLE";
}

type SignalInput = Pick<TeamStats, "headcount" | "risk" | "absenteeismRate" | "overtimePerHead" | "trainings" | "openRecommendations">;

// Combinaison de signaux ; un indicateur masqué (null) ne produit jamais de signal
export function tensionSignals(t: SignalInput, ref: { absenteeismRate: number | null; overtimePerHead: number | null }): TensionSignal[] {
  const R = TENSION_RULES;
  const out: TensionSignal[] = [];
  const scored = t.risk.ELEVE + t.risk.MOYEN + t.risk.FAIBLE;
  if (scored > 0 && ((t.risk.ELEVE + t.risk.MOYEN) / scored >= R.riskShare || t.risk.ELEVE >= R.riskHigh)) out.push("RISQUE");
  if (t.absenteeismRate != null && ref.absenteeismRate != null && t.absenteeismRate >= ref.absenteeismRate * R.absenteeismRatio && t.absenteeismRate - ref.absenteeismRate >= R.absenteeismGap)
    out.push("ABSENTEISME");
  if (
    t.overtimePerHead != null &&
    (t.overtimePerHead >= R.overtimeAbs ||
      (ref.overtimePerHead != null && ref.overtimePerHead > 0 && t.overtimePerHead >= ref.overtimePerHead * R.overtimeRatio && t.overtimePerHead - ref.overtimePerHead >= R.overtimeGap))
  )
    out.push("HEURES_SUP");
  if (t.headcount > 0 && t.trainings.overdue / t.headcount >= R.trainingShare) out.push("FORMATION");
  if (t.openRecommendations >= Math.max(R.recoMin, Math.ceil(R.recoShare * t.headcount))) out.push("RECOMMANDATIONS");
  return out;
}

type PersonFacts = { level: RiskLevel | null; overdue: boolean; due: number; done: number; openRecos: number };

function personFacts(ctx: AccessContext, ids: number[], ref: string, runId: number | null): Map<number, PersonFacts> {
  const { sqlite } = getDb();
  const p = { ids: JSON.stringify(ids), ref, runId: runId ?? -1 };
  const facts = new Map<number, PersonFacts>(ids.map((id) => [id, { level: null, overdue: false, due: 0, done: 0, openRecos: 0 }]));
  for (const [id, level] of runId != null ? levelsOfRun(runId, ids) : new Map<number, RiskLevel>()) facts.get(id)!.level = level;
  const trainings = sqlite
    .prepare(
      `SELECT employee_id AS id,
        MAX(status <> 'TERMINEE' AND due_date < @ref) AS overdue,
        SUM(due_date > date(@ref, '-12 months') AND due_date <= @ref) AS due,
        SUM(due_date > date(@ref, '-12 months') AND due_date <= @ref AND status = 'TERMINEE') AS done
       FROM training WHERE mandatory = 1 AND due_date IS NOT NULL AND employee_id IN (SELECT value FROM json_each(@ids)) GROUP BY employee_id`,
    )
    .all(p) as { id: number; overdue: number; due: number; done: number }[];
  for (const t of trainings) Object.assign(facts.get(t.id)!, { overdue: !!t.overdue, due: t.due ?? 0, done: t.done ?? 0 });
  const recos = sqlite
    .prepare(`SELECT employee_id AS id, action_code AS action FROM recommendation WHERE status = 'PROPOSEE' AND employee_id IN (SELECT value FROM json_each(@ids))`)
    .all(p) as { id: number; action: string }[];
  const global = isGlobal(ctx);
  for (const r of recos) if (global || !RH_ONLY_ACTIONS.has(r.action)) facts.get(r.id)!.openRecos++;
  return facts;
}

type Group = { key: string; managerId: number | null; label: string; department: { id: number | null; name: string }; members: Member[] };

function stats(g: Group, facts: Map<number, PersonFacts>, set: MeasureSet): TeamStats {
  const active = g.members.filter((m) => m.status === "ACTIF");
  const risk: RiskCounts = { ELEVE: 0, MOYEN: 0, FAIBLE: 0, nonScored: 0 };
  const trainings = { overdue: 0, due: 0, done: 0, rate: null as number | null };
  let openRecommendations = 0;
  for (const m of active) {
    const f = facts.get(m.id);
    if (!f) continue;
    if (f.level) risk[f.level]++;
    else risk.nonScored++;
    if (f.overdue) trainings.overdue++;
    trainings.due += f.due;
    trainings.done += f.done;
    openRecommendations += f.openRecos;
  }
  trainings.rate = ratio(trainings.done, trainings.due);
  const total = sumMeasures(
    set,
    g.members.map((m) => m.id),
  );
  return {
    key: g.key,
    managerId: g.managerId,
    label: g.label,
    department: g.department,
    headcount: active.length,
    present: g.members.length,
    risk,
    absenteeismRate: absenteeismOf(total),
    overtimePerHead: overtimePerHeadOf(total),
    masked: false,
    trainings,
    openRecommendations,
    signals: [],
    tension: "STABLE",
  };
}

const maskStats = (t: TeamStats): TeamStats => ({ ...t, masked: true, absenteeismRate: null, overtimePerHead: null });
const tooSmall = (t: TeamStats) => t.present > 0 && (t.present < MIN_GROUP_SIZE || t.headcount < MIN_GROUP_SIZE);

export function getTeams(ctx: AccessContext, q: TeamsQuery, meta: AuditMeta): TeamsDto {
  ensurePilotage(ctx, "teams.view");
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const refMonth = ref.slice(0, 7);
  const months = monthRange(addMonths(refMonth, -(TEAM_WINDOW_MONTHS - 1)), refMonth);
  const from = `${months[0]}-01`;
  const members = scopeMembers(ctx, from, ref);
  const run = getPublishedRun();
  const facts = personFacts(
    ctx,
    members.map((m) => m.id),
    ref,
    run?.id ?? null,
  );
  const set = monthlyMeasures(members, months, ref);

  const managerIds = [...new Set(members.map((m) => m.managerId).filter((x): x is number => x != null))];
  const managers = new Map(
    (
      sqlite
        .prepare(
          `SELECT e.id, e.last_name || ' ' || e.first_name AS name, e.department_id AS departmentId, d.name AS departmentName
           FROM employee e LEFT JOIN department d ON d.id = e.department_id WHERE e.id IN (SELECT value FROM json_each(?))`,
        )
        .all(JSON.stringify(managerIds)) as { id: number; name: string; departmentId: number | null; departmentName: string | null }[]
    ).map((m) => [m.id, m]),
  );
  const groups = new Map<number, Group>();
  for (const m of members) {
    if (m.managerId == null) continue;
    let g = groups.get(m.managerId);
    if (!g) {
      const mgr = managers.get(m.managerId);
      g = {
        key: String(m.managerId),
        managerId: m.managerId,
        label: `Équipe de ${mgr?.name ?? `n° ${m.managerId}`}`,
        department: { id: mgr?.departmentId ?? null, name: mgr?.departmentName ?? "Sans département" },
        members: [],
      };
      groups.set(m.managerId, g);
    }
    g.members.push(m);
  }
  const list = [...groups.values()].filter((g) => g.members.some((m) => m.status === "ACTIF"));
  let teams = list.map((g) => stats(g, facts, set));
  const scopeLabel = global ? "Ensemble de l'entreprise" : "Ensemble de mon périmètre";
  let scopeTotal = stats({ key: "total", managerId: null, label: scopeLabel, department: { id: null, name: "" }, members }, facts, set);

  if (!global) {
    const masked = smallGroupMask(
      teams.map((t) => t.present),
      teams.map(tooSmall),
    );
    teams = teams.map((t, i) => (masked[i] ? maskStats(t) : t));
    if (tooSmall(scopeTotal)) scopeTotal = maskStats(scopeTotal);
  }
  const reference = { absenteeismRate: scopeTotal.absenteeismRate, overtimePerHead: scopeTotal.overtimePerHead };
  teams = teams.map((t) => {
    const signals = tensionSignals(t, reference);
    return { ...t, signals, tension: tensionLevel(signals.length) };
  });

  const departments = global
    ? departmentOptions()
    : [...new Map(teams.map((t) => [t.department.id ?? 0, { id: t.department.id ?? 0, label: t.department.name }])).values()];
  let shown = teams;
  let total = scopeTotal;
  if (global && q.departement) {
    shown = teams.filter((t) => t.department.id === q.departement);
    const ids = new Set(shown.flatMap((t) => groups.get(t.managerId!)?.members.map((m) => m.id) ?? []));
    const name = departments.find((d) => d.id === q.departement)?.label ?? "département";
    total = stats({ key: "total", managerId: null, label: `Ensemble du département ${name}`, department: { id: q.departement, name }, members: members.filter((m) => ids.has(m.id)) }, facts, set);
  }
  const tensionCounts: Record<TensionLevel, number> = { FORTE: 0, TENSION: 0, SURVEILLER: 0, STABLE: 0 };
  for (const t of shown) tensionCounts[t.tension]++;
  const totalTeams = shown.length;
  if (q.tension) shown = shown.filter((t) => t.tension !== "STABLE");
  shown = [...shown].sort(
    (a, b) => TENSION_ORDER[b.tension] - TENSION_ORDER[a.tension] || b.signals.length - a.signals.length || b.headcount - a.headcount || a.label.localeCompare(b.label, "fr"),
  );
  const totalSignals = tensionSignals(total, reference);

  audit(ctx.userId, "teams.view", { type: "teams" }, "OK", { source: meta.source, teams: shown.length, view: global ? "RH" : "MANAGER" }, meta.ip);
  return {
    view: global ? "RH" : "MANAGER",
    referenceDate: ref,
    window: { from, to: ref, months: set.buckets.map((b) => b.key) },
    runAsOf: run?.asOf ?? null,
    total: { ...total, signals: totalSignals, tension: tensionLevel(totalSignals.length) },
    teams: shown,
    totalTeams,
    tensionCounts,
    maskedTeams: teams.filter((t) => t.masked).length,
    departments: departments.sort((a, b) => a.label.localeCompare(b.label, "fr")),
    filters: { departement: global ? (q.departement ?? null) : null, tension: !!q.tension },
  };
}

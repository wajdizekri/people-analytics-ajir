// Calculs purs (sans accès base) partagés par la DAL de pilotage et par scripts/seed-dev-ui.ts.

const DAY_MS = 86_400_000;

export const toTime = (s: string) => Date.parse(s + "T00:00:00Z");
export const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => isoDate(toTime(s) + n * DAY_MS);
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return isoDate(Date.UTC(y, m, 0));
};
export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}
export const weekStart = (s: string) => {
  const t = toTime(s);
  return isoDate(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
};
export const isWeekend = (s: string) => {
  const w = new Date(toTime(s)).getUTCDay();
  return w === 0 || w === 6;
};

// dim_date si elle couvre la date, sinon lundi-vendredi
export function workingDayFn(dimDate: Map<string, boolean> | null): (d: string) => boolean {
  if (!dimDate || dimDate.size === 0) return (d) => !isWeekend(d);
  return (d) => dimDate.get(d) ?? !isWeekend(d);
}

// Absences comptées dans l'absentéisme « hors santé non planifié »
export const isUnplannedNonHealth = (a: { isHealth: boolean; category: string }) => !a.isHealth && a.category !== "CONGE_ANNUEL";
export const VOLUNTARY_EXIT_REASONS = ["DEMISSION", "ABANDON"];

export type Bucket = { key: string; from: string; to: string };
export type PopEmployee = { id: number; hireDate: string; exitDate: string | null };
// workStart : début du premier contrat de travail (CDI, CDD), null si seulement stage ou SIVP (workStartSql)
export type PopMember = PopEmployee & { workStart: string | null };

// Population de l'effectif, des entrées, des sorties et du turnover : hors stages et SIVP, entrée au premier CDI/CDD
export const workforce = (members: PopMember[]): PopEmployee[] =>
  members.flatMap((e) => (e.workStart && (!e.exitDate || e.workStart <= e.exitDate) ? [{ id: e.id, hireDate: e.workStart, exitDate: e.exitDate }] : []));
export type AbsenceEp = { employeeId: number; startDate: string; endDate: string; days: number; isHealth: boolean; category: string };

export const monthBuckets = (months: string[]): Bucket[] => months.map((m) => ({ key: m, from: m + "-01", to: monthEnd(m) }));
export function weekBuckets(lastDay: string, n: number): Bucket[] {
  const last = weekStart(lastDay);
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = addDays(last, -7 * i);
    out.push({ key: from, from, to: addDays(from, 6) });
  }
  return out;
}

type Calendar = { start: number; cum: number[]; dayBucket: Int32Array };

// Cumul des jours ouvrés et seau de chaque jour de la fenêtre (seaux contigus et ordonnés)
function calendar(buckets: Bucket[], isWorking: (d: string) => boolean): Calendar {
  const start = toTime(buckets[0].from);
  const n = Math.round((toTime(buckets[buckets.length - 1].to) - start) / DAY_MS) + 1;
  const cum = new Array<number>(n + 1);
  cum[0] = 0;
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + (isWorking(isoDate(start + i * DAY_MS)) ? 1 : 0);
  const dayBucket = new Int32Array(n).fill(-1);
  buckets.forEach((b, k) => {
    for (let i = Math.round((toTime(b.from) - start) / DAY_MS), end = Math.round((toTime(b.to) - start) / DAY_MS); i <= end; i++) if (i >= 0 && i < n) dayBucket[i] = k;
  });
  return { start, cum, dayBucket };
}

// Jours ouvrés « employé » par seau (embauche <= jour <= sortie) ; calendrier construit une fois pour plusieurs groupes
export function workableCounter(buckets: Bucket[], isWorking: (d: string) => boolean): (members: PopEmployee[]) => number[] {
  if (!buckets.length) return () => [];
  const cal = calendar(buckets, isWorking);
  const n = cal.cum.length - 1;
  const idx = (d: string) => Math.round((toTime(d) - cal.start) / DAY_MS);
  const bounds = buckets.map((b) => [idx(b.from), idx(b.to)] as const);
  return (members) => {
    const out = buckets.map(() => 0);
    for (const e of members) {
      const hire = idx(e.hireDate);
      const exit = e.exitDate ? idx(e.exitDate) : n;
      for (let i = 0; i < bounds.length; i++) {
        const a = Math.max(bounds[i][0], hire, 0);
        const b = Math.min(bounds[i][1], exit, n - 1);
        if (a <= b) out[i] += cal.cum[b + 1] - cal.cum[a];
      }
    }
    return out;
  };
}

export const workableDaysByBucket = (buckets: Bucket[], members: PopEmployee[], isWorking: (d: string) => boolean) => workableCounter(buckets, isWorking)(members);

// Répartit les jours d'un épisode au prorata des jours ouvrés qu'il couvre dans chaque seau, par salarié
export function absenceByEmployee(buckets: Bucket[], episodes: AbsenceEp[], isWorking: (d: string) => boolean): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!buckets.length) return out;
  const cal = calendar(buckets, isWorking);
  const n = cal.dayBucket.length;
  const first = buckets[0].from;
  const last = buckets[buckets.length - 1].to;
  // Jours de la fenêtre lus dans le cumul du calendrier ; hors fenêtre (épisode à cheval), isWorking est interrogé.
  const workingOutside = (i: number) => isWorking(isoDate(cal.start + i * DAY_MS));
  const row = (emp: number) => {
    let arr = out.get(emp);
    if (!arr) out.set(emp, (arr = buckets.map(() => 0)));
    return arr;
  };
  for (const ep of episodes) {
    if (ep.endDate < first || ep.startDate > last) continue;
    const s = Math.round((toTime(ep.startDate) - cal.start) / DAY_MS);
    const e = Math.round((toTime(ep.endDate) - cal.start) / DAY_MS);
    const a = Math.max(s, 0);
    const b = Math.min(e, n - 1);
    let nWork = a <= b ? cal.cum[b + 1] - cal.cum[a] : 0;
    for (let i = s; i < 0 && i <= e; i++) if (workingOutside(i)) nWork++;
    for (let i = Math.max(s, n); i <= e; i++) if (workingOutside(i)) nWork++;
    if (!nWork) {
      const k = s >= 0 && s < n ? cal.dayBucket[s] : -1;
      if (k >= 0) row(ep.employeeId)[k] += ep.days;
      continue;
    }
    const share = ep.days / nWork;
    let arr: number[] | null = null;
    for (let i = a; i <= b; i++) {
      const k = cal.dayBucket[i];
      if (k < 0 || cal.cum[i + 1] === cal.cum[i]) continue;
      (arr ??= row(ep.employeeId))[k] += share;
    }
  }
  return out;
}

export function sumByBucket(n: number, arrays: Iterable<number[] | undefined>): number[] {
  const out = new Array<number>(n).fill(0);
  for (const a of arrays) if (a) for (let i = 0; i < n; i++) out[i] += a[i];
  return out;
}

export const absenceDaysByBucket = (buckets: Bucket[], episodes: AbsenceEp[], isWorking: (d: string) => boolean) =>
  sumByBucket(buckets.length, absenceByEmployee(buckets, episodes, isWorking).values());

export type MonthRow = {
  month: string;
  headcount: number;
  entries: number;
  exits: number;
  voluntaryExits: number;
  absenceDaysNonHealth: number;
  absenceDaysHealth: number;
  workableDays: number;
  payrollMass: number;
  trainingsDone: number;
  trainingsDue: number;
};

export type MonthlyInput = {
  months: string[];
  employees: PopMember[];
  exits: { employeeId: number; exitDate: string; reason: string }[];
  absences: AbsenceEp[];
  payroll?: { month: string; gross: number }[];
  mandatoryTrainings: { dueDate: string | null; status: string }[];
  isWorking: (d: string) => boolean;
};

// Mêmes définitions que agg_kpi_monthly : effectif, entrées et sorties hors stages et SIVP ; absentéisme sur tous les présents
// (absence_days_non_health = hors santé et hors congé annuel)
export function computeMonthlyRows(input: MonthlyInput): MonthRow[] {
  const buckets = monthBuckets(input.months);
  const workable = workableDaysByBucket(buckets, input.employees, input.isWorking);
  const staff = workforce(input.employees);
  const workStart = new Map(staff.map((e) => [e.id, e.hireDate]));
  const staffExits = input.exits.filter((x) => {
    const start = workStart.get(x.employeeId);
    return start != null && x.exitDate >= start;
  });
  const nonHealth = absenceDaysByBucket(buckets, input.absences.filter(isUnplannedNonHealth), input.isWorking);
  const health = absenceDaysByBucket(buckets, input.absences.filter((a) => a.isHealth), input.isWorking);
  const payroll = new Map<string, number>();
  for (const p of input.payroll ?? []) payroll.set(p.month, (payroll.get(p.month) ?? 0) + p.gross);
  return buckets.map((b, i) => {
    const due = input.mandatoryTrainings.filter((t) => t.dueDate && t.dueDate >= b.from && t.dueDate <= b.to);
    const exits = staffExits.filter((x) => x.exitDate >= b.from && x.exitDate <= b.to);
    return {
      month: b.key,
      headcount: staff.filter((e) => e.hireDate <= b.to && (!e.exitDate || e.exitDate > b.to)).length,
      entries: staff.filter((e) => e.hireDate >= b.from && e.hireDate <= b.to).length,
      exits: exits.length,
      voluntaryExits: exits.filter((x) => VOLUNTARY_EXIT_REASONS.includes(x.reason)).length,
      absenceDaysNonHealth: nonHealth[i],
      absenceDaysHealth: health[i],
      workableDays: workable[i],
      payrollMass: payroll.get(b.key) ?? 0,
      trainingsDone: due.filter((t) => t.status === "TERMINEE").length,
      trainingsDue: due.length,
    };
  });
}

export function sumRows(rows: MonthRow[][]): MonthRow[] {
  const byMonth = new Map<string, MonthRow>();
  for (const list of rows)
    for (const r of list) {
      const acc = byMonth.get(r.month);
      if (!acc) {
        byMonth.set(r.month, { ...r });
        continue;
      }
      for (const k of Object.keys(r) as (keyof MonthRow)[]) if (k !== "month") acc[k] += r[k];
    }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// Turnover glissant 12 mois au mois i : sorties des 12 derniers mois / effectif moyen ; null si historique incomplet
export function rollingTurnover(rows: MonthRow[], i: number, voluntary: boolean): number | null {
  if (i < 11) return null;
  const win = rows.slice(i - 11, i + 1);
  const avg = win.reduce((s, r) => s + r.headcount, 0) / 12;
  if (avg <= 0) return null;
  return win.reduce((s, r) => s + (voluntary ? r.voluntaryExits : r.exits), 0) / avg;
}

export const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

// Effectif minimal d'un groupe dont un manager voit un taux d'absence ou des sorties (anti ré-identification)
export const MIN_GROUP_SIZE = 5;

export const countPresent = (members: PopEmployee[], from: string, to: string) =>
  members.reduce((n, e) => n + (e.hireDate <= to && (!e.exitDate || e.exitDate >= from) ? 1 : 0), 0);

// Groupes à masquer : effectif non nul < K, ou déjà masqués. Si l'ensemble masqué compte moins de K personnes,
// les plus petits groupes visibles sont masqués à leur tour (sinon « total − groupes visibles » le révélerait).
export function smallGroupMask(counts: number[], preMasked: boolean[] = [], k = MIN_GROUP_SIZE): boolean[] {
  const masked = counts.map((n, i) => !!preMasked[i] || (n > 0 && n < k));
  let pool = counts.reduce((s, n, i) => s + (masked[i] ? n : 0), 0);
  while (pool > 0 && pool < k) {
    let j = -1;
    for (let i = 0; i < counts.length; i++) if (!masked[i] && counts[i] > 0 && (j < 0 || counts[i] < counts[j])) j = i;
    if (j < 0) break;
    masked[j] = true;
    pool += counts[j];
  }
  return masked;
}

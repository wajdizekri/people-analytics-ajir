import type Database from "better-sqlite3";
import { createAlert } from "../engine/alerts";
import { CAL_BRIDGE, CAL_HOLIDAY, CAL_RAMADAN, CAL_SEANCE_UNIQUE, WorkCalendar } from "../features/calendar";
import { addMonths, frDate, fromDay, mondayOf, toDay } from "../features/dates";
import { COUNTED_ABSENCE, HEALTH_ABSENCE } from "../features/spec";
import { getSetting } from "../settings";
import { MIN_GROUP_SIZE } from "../dal/pilotage-metrics";

export const Z_THRESHOLD = 3.5;
export const BASELINE_WEEKS = 26;
export const MIN_BASELINE_WEEKS = 8;
// groupe suivi séparément seulement à partir du seuil des petites populations (vue manager)
export { MIN_GROUP_SIZE };
// au-delà, l'anomalie reste consultable mais ne crée plus d'alerte (backtest, première passe sur 12 mois)
export const ALERT_WINDOW_WEEKS = 13;
const FACTOR_HISTORY_WEEKS = 156;
const RATE_FLOOR = 0.02;
const MAD_SCALE = 1.4826;

export type WeekClass = "RAMADAN" | "FERIE_PONT" | "SEANCE_UNIQUE" | "NORMALE";
const CLASS_LABEL: Record<WeekClass, string> = {
  RAMADAN: "semaine de Ramadan",
  FERIE_PONT: "semaine avec jour férié ou pont",
  SEANCE_UNIQUE: "semaine en séance unique",
  NORMALE: "semaine normale",
};

// "2025-W14" (ISO) ou une date quelconque de la semaine -> lundi (numéro de jour)
export function parseWeek(s: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(s);
  if (m) return mondayOf(toDay(`${m[1]}-01-04`)) + (Number(m[2]) - 1) * 7;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return mondayOf(toDay(s));
  throw new Error(`Semaine invalide : ${s} (format attendu : AAAA-Wss ou AAAA-MM-JJ)`);
}

export function isoWeek(monday: number): string {
  const thursday = monday + 3;
  const year = fromDay(thursday).slice(0, 4);
  const week = Math.floor((thursday - mondayOf(toDay(`${year}-01-04`))) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toString().replace(".", ",")}\u00a0%`;

type Emp = {
  id: number;
  firstName: string;
  lastName: string;
  hire: string;
  exit: string | null;
  managerId: number | null;
  departmentId: number | null;
};
type Episode = { eid: number; s: string; e: string; days: number; category: string; h: number };
type Series = { key: string; scope: "EQUIPE" | "DEPARTEMENT"; managerId: number | null; departmentId: number | null; label: string; num: Float64Array; den: Float64Array };

export type WeeklyPoint = { week: string; rate: number; expected: number | null; z: number | null; weekClass: WeekClass };

// Options d'évaluation (ml/eval) : les valeurs par défaut reproduisent exactement le comportement nominal.
export type DetectOptions = {
  zThreshold?: number; // défaut Z_THRESHOLD
  consecutiveWeeks?: number; // défaut 2
  calendarAdjust?: boolean; // false = ablation : facteurs de classe de semaine (Ramadan, fériés/ponts, séance unique) à 1
  bradfordThreshold?: number; // défaut : paramètre bradford_threshold
  alerts?: boolean; // false = aucune alerte créée
};

type Prepared = {
  startMon: number;
  nW: number;
  classes: WeekClass[];
  factor: Record<WeekClass, number>;
  series: Series[];
  allSeries: Series[];
  activeAtEnd: Map<string, number>;
  emps: Emp[];
  episodes: Map<number, Episode[]>;
  cal: WorkCalendar;
  endDay: number;
};

function prepare(sqlite: Database.Database, fromMon: number, toMon: number, calendarAdjust = true): Prepared {
  const endDay = toMon + 6;
  const first = sqlite
    .prepare("SELECT min(d) AS d FROM (SELECT min(date) AS d FROM attendance_daily UNION ALL SELECT min(start_date) FROM absence_episode)")
    .get() as { d: string | null };
  const dataStart = first.d ? toDay(first.d) : fromMon;
  const startMon = mondayOf(Math.max(dataStart, Math.min(fromMon - (BASELINE_WEEKS + 1) * 7, toMon - FACTOR_HISTORY_WEEKS * 7)));
  const nW = Math.max(1, (toMon - startMon) / 7 + 1);
  const cal = WorkCalendar.load(sqlite, fromDay(startMon), fromDay(endDay));

  const classes: WeekClass[] = [];
  for (let w = 0; w < nW; w++) {
    let flags = 0;
    for (let d = startMon + w * 7; d < startMon + w * 7 + 7; d++) flags |= cal.flag(d);
    classes.push(flags & CAL_RAMADAN ? "RAMADAN" : flags & (CAL_HOLIDAY | CAL_BRIDGE) ? "FERIE_PONT" : flags & CAL_SEANCE_UNIQUE ? "SEANCE_UNIQUE" : "NORMALE");
  }

  const emps = sqlite
    .prepare(
      `SELECT e.id, e.first_name AS firstName, e.last_name AS lastName, e.hire_date AS hire,
              COALESCE((SELECT min(x.exit_date) FROM exit_event x WHERE x.employee_id = e.id), e.exit_date) AS exit,
              e.manager_id AS managerId, e.department_id AS departmentId
         FROM employee e WHERE e.hire_date <= @end`,
    )
    .all({ end: fromDay(endDay) }) as Emp[];
  const episodes = new Map<number, Episode[]>();
  for (const ep of sqlite
    .prepare("SELECT employee_id AS eid, start_date AS s, end_date AS e, days, category, is_health AS h FROM absence_episode WHERE end_date >= ? AND start_date <= ?")
    .all(fromDay(startMon - 400), fromDay(endDay)) as Episode[]) {
    if (!episodes.has(ep.eid)) episodes.set(ep.eid, []);
    episodes.get(ep.eid)!.push(ep);
  }

  const byKey = new Map<string, Series>();
  const names = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const deptNames = new Map(
    (sqlite.prepare("SELECT id, name FROM department").all() as { id: number; name: string }[]).map((d) => [d.id, d.name]),
  );
  const series = (key: string, init: () => Omit<Series, "key" | "num" | "den">): Series => {
    let s = byKey.get(key);
    if (!s) byKey.set(key, (s = { key, ...init(), num: new Float64Array(nW), den: new Float64Array(nW) }));
    return s;
  };
  const company = { num: new Float64Array(nW), den: new Float64Array(nW) };
  const activeAtEnd = new Map<string, number>();
  const nDays = nW * 7;

  for (const e of emps) {
    const a = Math.max(toDay(e.hire), startMon);
    const b = Math.min(e.exit ? toDay(e.exit) : endDay, endDay);
    if (b < a) continue;
    const health = new Uint8Array(nDays);
    const abs = new Float32Array(nDays);
    for (const ep of episodes.get(e.id) ?? []) {
      const s = Math.max(toDay(ep.s), startMon);
      const t = Math.min(toDay(ep.e), endDay);
      if (ep.h || HEALTH_ABSENCE.has(ep.category)) {
        for (let d = s; d <= t; d++) health[d - startMon] = 1;
      } else if (COUNTED_ABSENCE.has(ep.category)) {
        const w = cal.workingBetween(toDay(ep.s), toDay(ep.e));
        const scale = w > 0 ? Math.min(1, ep.days / w) : 0;
        for (let d = s; d <= t; d++) abs[d - startMon] += scale;
      }
    }
    const groups: Series[] = [];
    if (e.managerId != null)
      groups.push(
        series(`T${e.managerId}`, () => ({
          scope: "EQUIPE",
          managerId: e.managerId,
          departmentId: emps.find((m) => m.id === e.managerId)?.departmentId ?? e.departmentId,
          label: `l'équipe de ${names.get(e.managerId!) ?? `n° ${e.managerId}`}`,
        })),
      );
    if (e.departmentId != null)
      groups.push(
        series(`D${e.departmentId}`, () => ({
          scope: "DEPARTEMENT",
          managerId: null,
          departmentId: e.departmentId,
          label: `le département ${deptNames.get(e.departmentId!) ?? `n° ${e.departmentId}`}`,
        })),
      );
    if (b >= endDay) for (const g of groups) activeAtEnd.set(g.key, (activeAtEnd.get(g.key) ?? 0) + 1);
    for (let d = a; d <= b; d++) {
      const i = d - startMon;
      if (health[i] || !cal.isWorking(d)) continue;
      const w = Math.floor(i / 7);
      const f = Math.min(1, abs[i]);
      company.den[w] += 1;
      company.num[w] += f;
      for (const g of groups) {
        g.den[w] += 1;
        g.num[w] += f;
      }
    }
  }

  const pooled = (c: WeekClass) => {
    let n = 0;
    let d = 0;
    for (let w = 0; w < nW; w++)
      if (classes[w] === c) {
        n += company.num[w];
        d += company.den[w];
      }
    return d > 0 ? n / d : null;
  };
  const normal = pooled("NORMALE");
  const factor = { NORMALE: 1, RAMADAN: 1, FERIE_PONT: 1, SEANCE_UNIQUE: 1 } as Record<WeekClass, number>;
  if (calendarAdjust && normal && normal > 0)
    for (const c of ["RAMADAN", "FERIE_PONT", "SEANCE_UNIQUE"] as WeekClass[]) {
      const r = pooled(c);
      if (r != null && r > 0) factor[c] = r / normal;
    }

  const allSeries = [...byKey.values()];
  return {
    startMon,
    nW,
    classes,
    factor,
    series: allSeries.filter((s) => (activeAtEnd.get(s.key) ?? 0) >= MIN_GROUP_SIZE),
    allSeries,
    activeAtEnd,
    emps,
    episodes,
    cal,
    endDay,
  };
}

function zSeries(p: Prepared, s: Series): { rate: number[]; expected: (number | null)[]; z: (number | null)[] } {
  const rate: number[] = [];
  const expected: (number | null)[] = [];
  const z: (number | null)[] = [];
  for (let w = 0; w < p.nW; w++) {
    rate.push(s.den[w] > 0 ? s.num[w] / s.den[w] : 0);
    const base: number[] = [];
    for (let k = Math.max(0, w - BASELINE_WEEKS); k < w; k++) if (s.den[k] > 0) base.push(s.num[k] / s.den[k] / p.factor[p.classes[k]]);
    if (s.den[w] <= 0 || base.length < MIN_BASELINE_WEEKS) {
      expected.push(null);
      z.push(null);
      continue;
    }
    const f = p.factor[p.classes[w]];
    const med = median(base);
    const mad = median(base.map((x) => Math.abs(x - med)));
    const exp = med * f;
    const pf = Math.min(0.5, Math.max(exp, RATE_FLOOR * f));
    const sigma = Math.max(MAD_SCALE * mad * f, Math.sqrt((pf * (1 - pf)) / s.den[w]));
    expected.push(exp);
    z.push((rate[w] - exp) / sigma);
  }
  return { rate, expected, z };
}

// Détection collective (équipes et départements >= MIN_GROUP_SIZE) et individuelle (Bradford, RH seulement).
export function detectAnomalies(sqlite: Database.Database, fromWeek: string, toWeek: string, opts: DetectOptions = {}): number {
  const fromMon = parseWeek(fromWeek);
  const toMon = parseWeek(toWeek);
  if (toMon < fromMon) throw new Error("Semaine de fin antérieure à la semaine de début.");
  const zThreshold = opts.zThreshold ?? Z_THRESHOLD;
  const k = opts.consecutiveWeeks ?? 2;
  if (!Number.isInteger(k) || k < 1) throw new Error("consecutiveWeeks doit être un entier >= 1.");
  const withAlerts = opts.alerts ?? true;
  const p = prepare(sqlite, fromMon, toMon, opts.calendarAdjust ?? true);
  const fromIdx = Math.max(0, (fromMon - p.startMon) / 7);
  const toIdx = (toMon - p.startMon) / 7;
  let created = 0;

  const exists = sqlite.prepare(
    "SELECT 1 FROM anomaly WHERE scope = ? AND metric = ? AND period_start = ? AND coalesce(manager_id, -1) = coalesce(?, -1) AND coalesce(department_id, -1) = coalesce(?, -1) AND coalesce(employee_id, -1) = coalesce(?, -1) LIMIT 1",
  );
  const insert = sqlite.prepare(
    `INSERT INTO anomaly (scope, department_id, manager_id, employee_id, period_start, period_end, metric, observed, expected, score, message)
     VALUES (@scope, @departmentId, @managerId, @employeeId, @periodStart, @periodEnd, @metric, @observed, @expected, @score, @message)`,
  );

  sqlite
    .transaction(() => {
      for (const s of p.series) {
        const { rate, expected, z } = zSeries(p, s);
        const hot = (w: number) => w >= 0 && z[w] != null && z[w]! > zThreshold;
        for (let w = Math.max(fromIdx, k - 1); w <= toIdx; w++) {
          const win = Array.from({ length: k }, (_, i) => w - k + 1 + i);
          if (!win.every(hot) || hot(w - k)) continue;
          const periodStart = fromDay(p.startMon + win[0] * 7);
          const periodEnd = fromDay(p.startMon + w * 7 + 6);
          if (exists.get(s.scope, "taux_absence_hebdo", periodStart, s.managerId, s.departmentId, null)) continue;
          const observed = win.reduce((a, i) => a + rate[i], 0) / k;
          const exp = win.reduce((a, i) => a + expected[i]!, 0) / k;
          const cls = [...new Set(win.map((i) => p.classes[i]))].filter((c) => c !== "NORMALE");
          const calNote = cls.length ? ` (${cls.map((c) => CLASS_LABEL[c]).join(", ")} prise${cls.length > 1 ? "s" : ""} en compte)` : "";
          const gap = (Math.round((observed - exp) * 1000) / 10).toString().replace(".", ",");
          const weeks =
            k === 1
              ? `la semaine du ${frDate(periodStart)}`
              : k === 2
                ? `les semaines du ${frDate(periodStart)} et du ${frDate(fromDay(p.startMon + w * 7))}`
                : `les ${k} semaines du ${frDate(periodStart)} au ${frDate(periodEnd)}`;
          const message =
            `Absentéisme non planifié (hors santé) inhabituel dans ${s.label} : taux d'absence de ${pct(observed)} ${weeks}, ` +
            `contre ${pct(exp)} attendus, soit +${gap} points${calNote}. ` +
            "Échangez avec l'équipe pour en comprendre la cause : organisation du travail, événement ponctuel ou absence mal saisie dans AJIR.";
          insert.run({
            scope: s.scope,
            departmentId: s.departmentId,
            managerId: s.managerId,
            employeeId: null,
            periodStart,
            periodEnd,
            metric: "taux_absence_hebdo",
            observed,
            expected: exp,
            score: Math.min(...win.map((i) => z[i]!)),
            message,
          });
          created++;
          if (withAlerts && toIdx - w < ALERT_WINDOW_WEEKS)
            createAlert(sqlite, {
              type: "ABSENTEISME",
              severity: "ATTENTION",
              audience: "MANAGER",
              managerId: s.managerId,
              departmentId: s.departmentId,
              title: `Absentéisme inhabituel : ${s.label}`,
              message,
              link: "/absenteeism",
              dedupKey: `absenteisme:${s.key}:${periodStart}`,
            });
        }
      }
      created += detectBradford(sqlite, p, opts.bradfordThreshold, withAlerts);
    })
    .immediate();
  return created;
}

export type BradfordRow = { employeeId: number; spells: number; days: number; bradford: number };

// Facteur de Bradford sur les 12 mois se terminant à p.endDay, pour chaque salarié en poste ayant au moins une absence comptée.
function bradfordRows(sqlite: Database.Database, p: Prepared): { end: string; winStart: number; rows: (BradfordRow & { emp: Emp })[] } {
  const end = fromDay(p.endDay);
  const winStart = toDay(addMonths(end, -12)) + 1;
  const cal = p.cal.start <= winStart ? p.cal : WorkCalendar.load(sqlite, fromDay(winStart - 400), end);
  const rows: (BradfordRow & { emp: Emp })[] = [];
  for (const e of p.emps) {
    if (e.hire > end || (e.exit && e.exit <= end)) continue;
    const eps = p.episodes.get(e.id) ?? [];
    const healthDays = new Set<number>();
    for (const ep of eps)
      if (ep.h || HEALTH_ABSENCE.has(ep.category)) for (let d = Math.max(toDay(ep.s), winStart); d <= Math.min(toDay(ep.e), p.endDay); d++) healthDays.add(d);
    let spells = 0;
    let days = 0;
    for (const ep of eps) {
      if (!COUNTED_ABSENCE.has(ep.category)) continue;
      const s = Math.max(toDay(ep.s), winStart);
      const t = Math.min(toDay(ep.e), p.endDay);
      if (t < s) continue;
      const w = cal.workingBetween(toDay(ep.s), toDay(ep.e));
      const scale = w > 0 ? Math.min(1, ep.days / w) : 0;
      let n = 0;
      for (let d = s; d <= t; d++) if (cal.isWorking(d) && !healthDays.has(d)) n++;
      if (n === 0) continue;
      spells++;
      days += n * scale;
    }
    if (spells > 0) rows.push({ emp: e, employeeId: e.id, spells, days, bradford: spells * spells * days });
  }
  return { end, winStart, rows };
}

function detectBradford(sqlite: Database.Database, p: Prepared, thresholdOverride?: number, withAlerts = true): number {
  const threshold = thresholdOverride ?? (Number(getSetting(sqlite, "bradford_threshold")) || 250);
  const { end, winStart, rows } = bradfordRows(sqlite, p);
  const month = end.slice(0, 7);
  const exists = sqlite.prepare("SELECT 1 FROM anomaly WHERE scope = 'SALARIE' AND metric = 'bradford_12m' AND employee_id = ? AND substr(period_end, 1, 7) = ? LIMIT 1");
  const insert = sqlite.prepare(
    `INSERT INTO anomaly (scope, department_id, manager_id, employee_id, period_start, period_end, metric, observed, expected, score, message)
     VALUES ('SALARIE', ?, ?, ?, ?, ?, 'bradford_12m', ?, ?, ?, ?)`,
  );
  let created = 0;
  for (const { emp: e, spells, days, bradford } of rows) {
    if (bradford < threshold || exists.get(e.id, month)) continue;
    const rounded = Math.round(bradford);
    const message =
      `Facteur de Bradford de ${rounded.toLocaleString("fr-FR")} sur les 12 mois au ${frDate(end)} ` +
      `(${spells} absence${spells > 1 ? "s" : ""} non planifiée${spells > 1 ? "s" : ""} hors santé, ` +
      `${(Math.round(days * 10) / 10).toLocaleString("fr-FR")} jour${days >= 2 ? "s" : ""}), au-dessus du seuil de ${threshold.toLocaleString("fr-FR")}. ` +
      "Ce facteur pèse davantage les absences courtes et répétées. Signal à vérifier : échangez avec le collaborateur sans présumer de la cause, ou contrôlez la saisie dans AJIR.";
    insert.run(e.departmentId, e.managerId, e.id, fromDay(winStart), end, bradford, threshold, bradford / threshold, message);
    created++;
    if (withAlerts)
      createAlert(sqlite, {
        type: "ABSENTEISME",
        severity: "INFO",
        audience: "RH",
        employeeId: e.id,
        departmentId: e.departmentId,
        managerId: e.managerId,
        title: `Absences répétées à vérifier : ${e.firstName} ${e.lastName}`,
        message,
        link: `/employees/${e.id}`,
        dedupKey: `bradford:${e.id}:${month}`,
      });
  }
  return created;
}

// Série hebdomadaire d'un groupe (pour affichage ou diagnostic).
export function weeklySeries(sqlite: Database.Database, key: string, fromWeek: string, toWeek: string): WeeklyPoint[] {
  const fromMon = parseWeek(fromWeek);
  const p = prepare(sqlite, fromMon, parseWeek(toWeek));
  const s = p.series.find((x) => x.key === key);
  if (!s) return [];
  const { rate, expected, z } = zSeries(p, s);
  const out: WeeklyPoint[] = [];
  for (let w = Math.max(0, (fromMon - p.startMon) / 7); w < p.nW; w++)
    out.push({ week: isoWeek(p.startMon + w * 7), rate: rate[w], expected: expected[w], z: z[w], weekClass: p.classes[w] });
  return out;
}

export type GroupScores = {
  key: string;
  scope: "EQUIPE" | "DEPARTEMENT";
  managerId: number | null;
  departmentId: number | null;
  activeAtEnd: number;
  monitored: boolean;
  points: (WeeklyPoint & { weekStart: string; num: number; den: number })[];
};

// Évaluation hors ligne : scores robustes de tous les groupes (y compris ceux sous MIN_GROUP_SIZE, monitored = false), sans écriture.
export function anomalyScores(
  sqlite: Database.Database,
  fromWeek: string,
  toWeek: string,
  opts: Pick<DetectOptions, "calendarAdjust"> = {},
): { factor: Record<WeekClass, number>; groups: GroupScores[] } {
  const fromMon = parseWeek(fromWeek);
  const p = prepare(sqlite, fromMon, parseWeek(toWeek), opts.calendarAdjust ?? true);
  const from = Math.max(0, (fromMon - p.startMon) / 7);
  const groups = p.allSeries.map((s) => {
    const { rate, expected, z } = zSeries(p, s);
    const points = [];
    for (let w = from; w < p.nW; w++)
      points.push({
        week: isoWeek(p.startMon + w * 7),
        weekStart: fromDay(p.startMon + w * 7),
        rate: rate[w],
        expected: expected[w],
        z: z[w],
        weekClass: p.classes[w],
        num: s.num[w],
        den: s.den[w],
      });
    const activeAtEnd = p.activeAtEnd.get(s.key) ?? 0;
    return { key: s.key, scope: s.scope, managerId: s.managerId, departmentId: s.departmentId, activeAtEnd, monitored: activeAtEnd >= MIN_GROUP_SIZE, points };
  });
  return { factor: { ...p.factor }, groups };
}

// Évaluation hors ligne : facteur de Bradford de tous les salariés en poste à la fin de toWeek (12 mois glissants), sans écriture.
export function bradfordScores(sqlite: Database.Database, toWeek: string): { end: string; rows: BradfordRow[] } {
  const toMon = parseWeek(toWeek);
  const p = prepare(sqlite, toMon, toMon);
  const { end, rows } = bradfordRows(sqlite, p);
  return { end, rows: rows.map(({ employeeId, spells, days, bradford }) => ({ employeeId, spells, days, bradford })) };
}

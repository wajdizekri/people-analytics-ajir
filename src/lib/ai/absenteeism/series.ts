import type Database from "better-sqlite3";
import { dayOfWeek, fromDay, toDay } from "@/lib/features/dates";

// Séries mensuelles d'absentéisme hors santé non planifié par unité : "E" (entreprise), "D<id>" (département), "T<id>" (équipe
// du manager <id>). Miroir exact de ml/absenteeism/series.py (parité vérifiée par golden.json) :
// dénominateur = jours ouvrés de présence (embauche <= jour <= sortie) ; numérateur = épisodes is_health = 0 hors CONGE_ANNUEL,
// ventilés au prorata de leurs jours ouvrés ; rattachement à la date de référence du mois (MUTATION, CHANGEMENT_MANAGER).

export const mi = (ym: string) => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1;
export const ml = (i: number) => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
export const mStart = (i: number) => toDay(`${ml(i)}-01`);
export const mEnd = (i: number) => mStart(i + 1) - 1;
const isWeekday = (d: number) => {
  const w = dayOfWeek(d);
  return w >= 1 && w <= 5;
};

type Period = { from: number; to: number; value: number | null };
const FAR = 1e9;

function history(events: { d: number; old: string | null; nw: string | null }[], current: number | null, resolve: (v: string | null) => number | null): Period[] {
  if (!events.length) return [{ from: -FAR, to: FAR, value: current }];
  const firstOld = resolve(events[0].old);
  const out: Period[] = [{ from: -FAR, to: events[0].d, value: firstOld ?? current }];
  events.forEach((e, k) => {
    const next = k + 1 < events.length ? events[k + 1].d : FAR;
    out.push({ from: e.d, to: next, value: resolve(e.nw) ?? current });
  });
  return out;
}

function at(periods: Period[], d: number): number | null {
  let v: number | null = null;
  for (const p of periods) if (p.from <= d && d < p.to) v = p.value;
  return v;
}

export type Org = {
  emp: Map<number, { hire: number; exit: number | null }>;
  dept: Map<number, Period[]>;
  mgr: Map<number, Period[]>;
  names: Map<number, string>;
  deptNames: Map<number, string>;
};

export function loadOrg(sqlite: Database.Database): Org {
  const emps = sqlite
    .prepare("SELECT id, matricule, hire_date AS hire, exit_date AS exit, department_id AS dept, manager_id AS mgr, last_name || ' ' || first_name AS name FROM employee")
    .all() as { id: number; matricule: string; hire: string; exit: string | null; dept: number | null; mgr: number | null; name: string }[];
  const byMat = new Map(emps.map((e) => [e.matricule, e.id]));
  const depts = sqlite.prepare("SELECT id, code, name FROM department").all() as { id: number; code: string; name: string }[];
  const deptCodes = new Map(depts.map((d) => [d.code, d.id]));
  const ev = new Map<string, { d: number; old: string | null; nw: string | null }[]>();
  for (const r of sqlite
    .prepare(
      "SELECT employee_id AS e, date, type, old_value AS old, new_value AS nw FROM career_event WHERE type IN ('MUTATION','CHANGEMENT_MANAGER') ORDER BY employee_id, date, id",
    )
    .all() as { e: number; date: string; type: string; old: string | null; nw: string | null }[]) {
    const k = `${r.e}|${r.type}`;
    if (!ev.has(k)) ev.set(k, []);
    ev.get(k)!.push({ d: toDay(r.date), old: r.old, nw: r.nw });
  }
  const org: Org = { emp: new Map(), dept: new Map(), mgr: new Map(), names: new Map(), deptNames: new Map(depts.map((d) => [d.id, d.name])) };
  for (const e of emps) {
    org.emp.set(e.id, { hire: toDay(e.hire), exit: e.exit ? toDay(e.exit) : null });
    org.names.set(e.id, e.name);
    org.dept.set(e.id, history(ev.get(`${e.id}|MUTATION`) ?? [], e.dept, (v) => (v == null ? null : (deptCodes.get(v) ?? null))));
    org.mgr.set(e.id, history(ev.get(`${e.id}|CHANGEMENT_MANAGER`) ?? [], e.mgr, (v) => (v == null ? null : (byMat.get(v) ?? null))));
  }
  return org;
}

export const deptAt = (org: Org, e: number, d: number) => at(org.dept.get(e) ?? [], d);
export const mgrAt = (org: Org, e: number, d: number) => at(org.mgr.get(e) ?? [], d);

function unitsAt(org: Org, e: number, d: number): string[] {
  const out = ["E"];
  const dep = deptAt(org, e, d);
  if (dep != null) out.push(`D${dep}`);
  const mgr = mgrAt(org, e, d);
  if (mgr != null) out.push(`T${mgr}`);
  return out;
}

function unitsOfMonth(org: Org, e: number, i: number): string[] {
  const ex = org.emp.get(e)!.exit;
  return unitsAt(org, e, ex != null && ex < mEnd(i) ? ex : mEnd(i));
}

export type MonthCal = { wd: number; ram: number; bridge: number; hol: number; su: number };
type DayFlags = { working: boolean; ram: number; bridge: number; hol: number; su: number };

export class AbsCalendar {
  private constructor(private readonly days: Map<number, DayFlags>) {}

  static load(sqlite: Database.Database): AbsCalendar {
    const rows = sqlite
      .prepare("SELECT date, is_weekend AS we, is_holiday AS h, is_ramadan AS r, is_bridge AS b, is_seance_unique AS s FROM dim_date")
      .all() as { date: string; we: number; h: number; r: number; b: number; s: number }[];
    return new AbsCalendar(new Map(rows.map((x) => [toDay(x.date), { working: !x.we && !x.h, ram: x.r ? 1 : 0, bridge: x.b ? 1 : 0, hol: x.h ? 1 : 0, su: x.s ? 1 : 0 }])));
  }

  isWorking(d: number): boolean {
    const f = this.days.get(d);
    return f ? f.working : isWeekday(d);
  }

  monthFeatures(i: number): MonthCal {
    let wd = 0;
    let ram = 0;
    let br = 0;
    let hol = 0;
    let su = 0;
    for (let d = mStart(i); d <= mEnd(i); d++) {
      const f = this.days.get(d);
      if (f && f.hol && isWeekday(d)) hol++;
      if (!this.isWorking(d)) continue;
      wd++;
      if (f) {
        ram += f.ram;
        br += f.bridge;
        su += f.su && !f.ram ? 1 : 0;
      }
    }
    return { wd, ram: wd ? ram / wd : 0, bridge: br, hol, su: wd ? su / wd : 0 };
  }
}

export type UnitSeries = { num: number[]; den: number[]; members: number[] };

// Séries des mois [fromMi, toMi] pour toutes les unités ; cutoffDay : ne compter que les épisodes saisis au plus tard ce jour.
export function computeSeries(sqlite: Database.Database, org: Org, cal: AbsCalendar, fromMi: number, toMi: number, cutoffDay: number | null = null): Map<string, UnitSeries> {
  const n = toMi - fromMi + 1;
  const out = new Map<string, UnitSeries>();
  const get = (u: string) => {
    let s = out.get(u);
    if (!s) out.set(u, (s = { num: new Array(n).fill(0), den: new Array(n).fill(0), members: new Array(n).fill(0) }));
    return s;
  };
  const lo = mStart(fromMi);
  const hi = mEnd(toMi);
  const cum = [0];
  for (let d = lo; d <= hi; d++) cum.push(cum[cum.length - 1] + (cal.isWorking(d) ? 1 : 0));
  for (const [e, { hire, exit }] of org.emp) {
    if (hire > hi || (exit != null && exit < lo)) continue;
    for (let i = fromMi; i <= toMi; i++) {
      const a = Math.max(hire, mStart(i));
      const b = Math.min(exit ?? FAR, mEnd(i));
      if (a > b) continue;
      const w = cum[b - lo + 1] - cum[a - lo];
      if (w <= 0) continue;
      for (const u of unitsOfMonth(org, e, i)) {
        const s = get(u);
        s.den[i - fromMi] += w;
        s.members[i - fromMi] += 1;
      }
    }
  }
  const episodes = sqlite
    .prepare(
      `SELECT employee_id AS e, start_date AS s, end_date AS t, days, recorded_at AS rec FROM absence_episode
       WHERE is_health = 0 AND category <> 'CONGE_ANNUEL' AND end_date >= ? AND start_date <= ? ORDER BY id`,
    )
    .all(fromDay(lo), fromDay(hi)) as { e: number; s: string; t: string; days: number; rec: string }[];
  for (const ep of episodes) {
    if (!org.emp.has(ep.e)) continue;
    if (cutoffDay != null && toDay(ep.rec.slice(0, 10)) > cutoffDay) continue;
    const so = toDay(ep.s);
    const to = toDay(ep.t);
    const wds: number[] = [];
    for (let d = so; d <= to; d++) if (cal.isWorking(d)) wds.push(d);
    const per = new Map<number, number>();
    if (!wds.length) per.set(mi(ep.s), ep.days);
    else {
      const share = ep.days / wds.length;
      for (const d of wds) {
        const k = mi(fromDay(d));
        per.set(k, (per.get(k) ?? 0) + share);
      }
    }
    for (const [i, v] of per) {
      if (i < fromMi || i > toMi) continue;
      for (const u of unitsOfMonth(org, ep.e, i)) get(u).num[i - fromMi] += v;
    }
  }
  return out;
}

// Effectif actif au jour d par unité (embauché au plus tard d, pas sorti au plus tard d)
export function activeAt(org: Org, d: number): Map<string, number> {
  const cnt = new Map<string, number>();
  for (const [e, { hire, exit }] of org.emp) {
    if (hire > d || (exit != null && exit <= d)) continue;
    for (const u of unitsAt(org, e, d)) cnt.set(u, (cnt.get(u) ?? 0) + 1);
  }
  return cnt;
}

export function parentOf(org: Org, unit: string, d: number): string {
  if (!unit.startsWith("T")) return "E";
  const m = Number(unit.slice(1));
  const dep = org.emp.has(m) ? deptAt(org, m, d) : null;
  return dep != null ? `D${dep}` : "E";
}

export function unitLabel(org: Org, unit: string): string {
  if (unit === "E") return "Ensemble de l'entreprise";
  const id = Number(unit.slice(1));
  if (unit.startsWith("D")) return org.deptNames.get(id) ?? `Département n° ${id}`;
  return `Équipe de ${org.names.get(id) ?? `n° ${id}`}`;
}

export const scopeOf = (unit: string) => (unit === "E" ? "ENTREPRISE" : unit.startsWith("D") ? "DEPARTEMENT" : "EQUIPE") as "ENTREPRISE" | "DEPARTEMENT" | "EQUIPE";

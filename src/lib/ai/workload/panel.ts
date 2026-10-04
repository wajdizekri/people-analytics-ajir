import type Database from "better-sqlite3";
import type { WorkloadScope } from "./model";

// Mêmes définitions que ml/workload/data.py et features.py (parité : bloc `features` de golden.json).
// Groupe à l'origine O : salariés actifs en fin de O rattachés au manager (équipe) ou au département à cette date ;
// série du groupe = heures sup de ces membres par ETP présent, ETP = jours pointés / jours ouvrés du mois.

export const FEATURES = [
  "z_last_dev", "z_3m_dev", "seas_group", "seas_dept", "trend_6m",
  "ramadan_T", "summer_su_T", "bridges_T", "workdays_T", "ramadan_diff", "summer_su_diff", "bridges_diff", "workdays_diff",
  "log_headcount", "headcount_change_3m", "unfilled_exits_3m",
  "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12",
] as const;

export const MIN_MEMBERS = 5;
const MIN_VALID_12 = 6;
const FTE_MIN = 1.0;
const S_FLOOR = 0.03;
const STD_MONTH_DAYS = 21.67;
const LOOKBACK = 18;
export const HORIZONS = [1, 2, 3] as const;

export const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const monthLabel = (i: number) => `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
export const monthEndOf = (i: number) => {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${monthLabel(i)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

type CalMonth = { wd: number; ram: number; su: number; br: number };
type Ev = { date: string; oldId: number | null; newId: number | null };
type Emp = { id: number; hire: string; exit: string | null; mgr: number | null; dept: number | null; hireCol: number };

export type Panel = {
  origin: number;
  first: number;
  dataFirst: number;
  cols: number;
  emps: Emp[];
  ot: Float64Array[]; // heures sup (h) par colonne
  days: Float64Array[];
  mgrAt: (e: number, month: number) => number;
  deptAt: (e: number, month: number) => number;
  cal: (month: number) => CalMonth;
};

// Valeur à la date d à partir d'événements triés ; repli : valeur courante (comme agg_dept_period)
function valueAt(evs: Ev[] | undefined, current: number | null, d: string): number | null {
  if (!evs?.length) return current;
  let val: number | null | undefined;
  for (const ev of evs) {
    if (ev.date <= d) val = ev.newId;
    else break;
  }
  if (val === undefined) val = evs[0].oldId;
  return val ?? current;
}

export function loadPanel(sqlite: Database.Database, originMonth: string): Panel | null {
  const origin = monthIndex(originMonth);
  const firstRow = sqlite.prepare("SELECT min(date) AS d FROM attendance_daily").get() as { d: string | null };
  if (!firstRow.d) return null;
  const dataFirst = monthIndex(firstRow.d.slice(0, 7));
  if (origin < dataFirst) return null;
  const first = Math.max(origin - LOOKBACK, dataFirst);
  const cols = origin - first + 1;
  const end = monthEndOf(origin);

  const emps = (
    sqlite
      .prepare(
        `SELECT e.id, e.hire_date AS hire,
                COALESCE((SELECT min(x.exit_date) FROM exit_event x WHERE x.employee_id = e.id), e.exit_date) AS exit,
                e.manager_id AS mgr, e.department_id AS dept
           FROM employee e WHERE e.hire_date <= ? ORDER BY e.id`,
      )
      .all(end) as Omit<Emp, "hireCol">[]
  ).map((e) => ({ ...e, hireCol: monthIndex(e.hire.slice(0, 7)) }));
  const pos = new Map(emps.map((e, k) => [e.id, k]));
  const mat2id = new Map((sqlite.prepare("SELECT matricule, id FROM employee").all() as { matricule: string; id: number }[]).map((r) => [r.matricule, r.id]));
  const code2id = new Map((sqlite.prepare("SELECT code, id FROM department").all() as { code: string; id: number }[]).map((r) => [r.code, r.id]));
  const mgrEv = new Map<number, Ev[]>();
  const deptEv = new Map<number, Ev[]>();
  for (const r of sqlite
    .prepare("SELECT employee_id AS e, date, type, old_value AS o, new_value AS n FROM career_event WHERE type IN ('CHANGEMENT_MANAGER','MUTATION') ORDER BY employee_id, date, id")
    .all() as { e: number; date: string; type: string; o: string | null; n: string | null }[]) {
    const map = r.type === "CHANGEMENT_MANAGER" ? mat2id : code2id;
    const target = r.type === "CHANGEMENT_MANAGER" ? mgrEv : deptEv;
    const ev = { date: r.date, oldId: r.o != null ? (map.get(r.o) ?? null) : null, newId: r.n != null ? (map.get(r.n) ?? null) : null };
    const list = target.get(r.e);
    if (list) list.push(ev);
    else target.set(r.e, [ev]);
  }

  const ot = emps.map(() => new Float64Array(cols));
  const days = emps.map(() => new Float64Array(cols));
  for (const r of sqlite
    .prepare(
      `SELECT employee_id AS e, substr(date, 1, 7) AS m, SUM(overtime_minutes) AS ot, COUNT(*) AS n
         FROM attendance_daily WHERE date BETWEEN ? AND ? GROUP BY employee_id, substr(date, 1, 7)`,
    )
    .all(`${monthLabel(first)}-01`, end) as { e: number; m: string; ot: number; n: number }[]) {
    const k = pos.get(r.e);
    const c = monthIndex(r.m) - first;
    if (k === undefined || c < 0 || c >= cols) continue;
    ot[k][c] = r.ot / 60.0;
    days[k][c] = r.n;
  }

  const calRows = sqlite
    .prepare(
      `SELECT substr(date, 1, 7) AS m,
              SUM(is_weekend = 0 AND is_holiday = 0) AS wd,
              SUM(is_weekend = 0 AND is_holiday = 0 AND is_ramadan = 1) AS ram,
              SUM(is_weekend = 0 AND is_holiday = 0 AND is_seance_unique = 1 AND is_ramadan = 0) AS su,
              SUM(is_bridge = 1) AS br
         FROM dim_date WHERE date BETWEEN ? AND ? GROUP BY substr(date, 1, 7)`,
    )
    .all(`${monthLabel(first - 12)}-01`, monthEndOf(origin + 3)) as { m: string; wd: number; ram: number; su: number; br: number }[];
  const calMap = new Map<number, CalMonth>();
  for (const r of calRows) if (r.wd > 0) calMap.set(monthIndex(r.m), { wd: r.wd, ram: r.ram / r.wd, su: r.su / r.wd, br: r.br / r.wd });
  const cal = (i: number): CalMonth => {
    const c = calMap.get(i);
    if (c) return c;
    const y = Math.floor(i / 12);
    const m = i % 12;
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let wd = 0;
    for (let d = 1; d <= n; d++) {
      const w = new Date(Date.UTC(y, m, d)).getUTCDay();
      if (w !== 0 && w !== 6) wd++;
    }
    return { wd, ram: 0, su: 0, br: 0 };
  };

  const active = (e: Emp, d: string) => e.hire <= d && (e.exit == null || e.exit > d);
  const memo = new Map<number, { mgr: Int32Array; dept: Int32Array }>();
  const at = (month: number) => {
    let r = memo.get(month);
    if (!r) {
      const d = monthEndOf(month);
      const mgr = new Int32Array(emps.length).fill(-1);
      const dept = new Int32Array(emps.length).fill(-1);
      emps.forEach((e, k) => {
        if (!active(e, d)) return;
        mgr[k] = valueAt(mgrEv.get(e.id), e.mgr, d) ?? -1;
        dept[k] = valueAt(deptEv.get(e.id), e.dept, d) ?? -1;
      });
      memo.set(month, (r = { mgr, dept }));
    }
    return r;
  };
  return {
    origin,
    first,
    dataFirst,
    cols,
    emps,
    ot,
    days,
    mgrAt: (e, month) => at(month).mgr[e],
    deptAt: (e, month) => at(month).dept[e],
    cal,
  };
}

export type GroupSeries = { key: number; n: number; members: number[]; home: number; I: Float64Array; z: Float64Array };

// Groupes à l'origine (clés croissantes, comme np.unique) ; « ENTREPRISE » = tous les actifs (affichage seulement)
export function groupSeries(p: Panel, scope: WorkloadScope | "ENTREPRISE"): GroupSeries[] {
  const O = p.origin;
  const d = monthEndOf(O);
  const byKey = new Map<number, number[]>();
  for (let k = 0; k < p.emps.length; k++) {
    const e = p.emps[k];
    const key =
      scope === "EQUIPE" ? p.mgrAt(k, O) : scope === "DEPARTEMENT" ? p.deptAt(k, O) : e.hire <= d && (e.exit == null || e.exit > d) ? 0 : -1;
    if (key < 0) continue;
    const list = byKey.get(key);
    if (list) list.push(k);
    else byKey.set(key, [k]);
  }
  const pos = new Map(p.emps.map((e, k) => [e.id, k]));
  const wd = Array.from({ length: p.cols }, (_, c) => p.cal(p.first + c).wd);
  return [...byKey.keys()]
    .sort((a, b) => a - b)
    .map((key) => {
      const members = byKey.get(key)!;
      const I = new Float64Array(p.cols);
      const z = new Float64Array(p.cols);
      for (let c = 0; c < p.cols; c++) {
        let ot = 0;
        let dsum = 0;
        for (const k of members) {
          ot += p.ot[k][c];
          dsum += p.days[k][c];
        }
        const fte = dsum / wd[c];
        I[c] = fte >= FTE_MIN ? ot / fte : NaN;
        z[c] = Math.log1p(I[c]);
      }
      const mk = pos.get(key);
      const home = scope === "EQUIPE" ? (mk !== undefined ? p.deptAt(mk, O) : -1) : key;
      return { key, n: members.length, members, home, I, z };
    });
}

const nanMean = (a: ArrayLike<number>, from: number, to: number) => {
  let s = 0;
  let n = 0;
  for (let i = from; i <= to; i++)
    if (!Number.isNaN(a[i])) {
      s += a[i];
      n++;
    }
  return n ? s / n : NaN;
};

export type GroupRow = {
  scope: WorkloadScope;
  key: number;
  home: number;
  n: number;
  h: number;
  month: string; // mois prévu
  x: number[];
  zbar12: number;
  s: number | null;
  I12: number; // moyenne des heures sup par ETP sur 12 mois
  last: number; // dernier mois observé
};

// Lignes de prévision à l'origine : une par groupe éligible et horizon (ordre de ml/workload/features.origin_rows)
export function groupRows(p: Panel, scope: WorkloadScope, deptSeries?: GroupSeries[]): { rows: GroupRow[]; series: GroupSeries[] } {
  const O = p.origin;
  const c = (m: number) => m - p.first;
  const gs = scope === "DEPARTEMENT" && deptSeries ? deptSeries : groupSeries(p, scope);
  const ds = deptSeries ?? (scope === "DEPARTEMENT" ? gs : groupSeries(p, "DEPARTEMENT"));
  const dpos = new Map(ds.map((g) => [g.key, g]));
  const rows: GroupRow[] = [];
  if (O - 11 < p.dataFirst) return { rows, series: gs };
  const trend = (z: Float64Array) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let m = O - 5; m <= O; m++)
      if (m >= p.dataFirst && !Number.isNaN(z[c(m)])) {
        xs.push(m - O);
        ys.push(z[c(m)]);
      }
    if (xs.length < 3) return 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < xs.length; i++) {
      mx += xs[i];
      my += ys[i];
    }
    mx /= xs.length;
    my /= ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    return sxy / sxx;
  };
  const seasonal = (z: Float64Array, T: number) => {
    if (T - 18 < p.dataFirst || Number.isNaN(z[c(T - 12)])) return 0;
    const v = nanMean(z, c(T - 18), c(T - 7));
    let n = 0;
    for (let m = T - 18; m <= T - 7; m++) if (!Number.isNaN(z[c(m)])) n++;
    return n < MIN_VALID_12 ? 0 : z[c(T - 12)] - v;
  };
  const scale = (z: Float64Array) => {
    let ss = 0;
    let n = 0;
    for (let m = Math.max(p.dataFirst + 1, O - 11); m <= O; m++) {
      const a = z[c(m)];
      const b = z[c(m - 1)];
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        ss += (a - b) * (a - b);
        n++;
      }
    }
    return n < 3 ? null : Math.max(S_FLOOR, Math.sqrt(ss / n / 2));
  };

  for (const g of gs) {
    if (scope === "EQUIPE" && g.n < MIN_MEMBERS) continue;
    let valid = 0;
    for (let m = O - 11; m <= O; m++) if (!Number.isNaN(g.z[c(m)])) valid++;
    if (valid < MIN_VALID_12) continue;
    const zbar12 = nanMean(g.z, c(O - 11), c(O));
    let zbar3 = nanMean(g.z, c(O - 2), c(O));
    if (Number.isNaN(zbar3)) zbar3 = zbar12;
    const zlast = Number.isNaN(g.z[c(O)]) ? zbar3 : g.z[c(O)];
    const s = scale(g.z);
    let n3 = 0;
    let departs = 0;
    for (let k = 0; k < p.emps.length; k++) {
      const prev = scope === "EQUIPE" ? p.mgrAt(k, O - 3) : p.deptAt(k, O - 3);
      if (prev !== g.key) continue;
      n3++;
      const cur = p.emps[k];
      const d = monthEndOf(O);
      if (!(cur.hire <= d && (cur.exit == null || cur.exit > d))) departs++;
    }
    let hires = 0;
    for (const k of g.members) if (p.emps[k].hireCol > O - 3) hires++;
    const hcChange = n3 > 0 ? (g.n - n3) / n3 : 0;
    const unfilled = n3 > 0 ? Math.max(0, departs - hires) / n3 : 0;
    const dz = dpos.get(g.home)?.z ?? g.z;
    const I12 = nanMean(g.I, c(O - 11), c(O));
    const tr = trend(g.z);
    const sg = (T: number) => seasonal(g.z, T);
    const sd = (T: number) => seasonal(dz, T);
    for (const h of HORIZONS) {
      const T = O + h;
      const cT = p.cal(T);
      const cP = p.cal(T - 12);
      const moy = (T % 12) + 1;
      const x = [
        zlast - zbar12,
        zbar3 - zbar12,
        sg(T),
        sd(T),
        tr,
        cT.ram,
        cT.su,
        cT.br,
        cT.wd / STD_MONTH_DAYS,
        cT.ram - cP.ram,
        cT.su - cP.su,
        cT.br - cP.br,
        (cT.wd - cP.wd) / STD_MONTH_DAYS,
        Math.log(g.n),
        hcChange,
        unfilled,
        ...Array.from({ length: 11 }, (_, i) => (moy === i + 2 ? 1 : 0)),
      ];
      rows.push({ scope, key: g.key, home: g.home, n: g.n, h, month: monthLabel(T), x, zbar12, s, I12, last: g.I[c(O)] });
    }
  }
  return { rows, series: gs };
}

// Heures sup pointées par mois (brutes) des salariés actifs en fin de mois d'origine, sur `months` mois
// (option : restreint à une liste de salariés, lue par l'index (employee_id, date))
export function individualOvertime(
  sqlite: Database.Database,
  originMonth: string,
  months = 36,
  onlyIds?: number[],
): { months: string[]; rows: { employeeId: number; hours: number[]; days: number[] }[] } {
  const O = monthIndex(originMonth);
  const labels = Array.from({ length: months }, (_, i) => monthLabel(O - months + 1 + i));
  const end = monthEndOf(O);
  const ids = onlyIds ? JSON.stringify(onlyIds) : null;
  const active = sqlite
    .prepare(
      `SELECT e.id FROM employee e
        WHERE e.hire_date <= @end
          AND COALESCE((SELECT min(x.exit_date) FROM exit_event x WHERE x.employee_id = e.id), e.exit_date, '9999-12-31') > @end
          ${ids ? "AND e.id IN (SELECT value FROM json_each(@ids))" : ""}
        ORDER BY e.id`,
    )
    .all(ids ? { end, ids } : { end }) as { id: number }[];
  const idx = new Map(active.map((r, k) => [r.id, k]));
  const rows = active.map((r) => ({ employeeId: r.id, hours: new Array<number>(months).fill(0), days: new Array<number>(months).fill(0) }));
  if (!rows.length) return { months: labels, rows };
  const params = { from: `${labels[0]}-01`, end, ...(ids ? { ids } : {}) };
  for (const r of sqlite
    .prepare(
      `SELECT employee_id AS e, substr(date, 1, 7) AS m, SUM(overtime_minutes) AS ot, COUNT(*) AS n
         FROM attendance_daily WHERE ${ids ? "employee_id IN (SELECT value FROM json_each(@ids)) AND" : ""} date BETWEEN @from AND @end
        GROUP BY employee_id, substr(date, 1, 7)`,
    )
    .all(params) as { e: number; m: string; ot: number; n: number }[]) {
    const k = idx.get(r.e);
    const c = monthIndex(r.m) - (O - months + 1);
    if (k === undefined || c < 0 || c >= months) continue;
    rows[k].hours[c] = r.ot / 60.0;
    rows[k].days[c] = r.n;
  }
  return { months: labels, rows };
}

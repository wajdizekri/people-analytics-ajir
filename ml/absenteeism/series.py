"""Séries mensuelles d'absentéisme hors santé non planifié par unité (entreprise, département, équipe).

Même définition que src/lib/ai/absenteeism/series.ts (parité vérifiée par golden.json) :
- jour ouvré : dim_date (is_weekend = 0 et is_holiday = 0), lundi-vendredi si la date manque ;
- dénominateur : jours ouvrés de présence de chaque salarié dans le mois (embauche <= jour <= sortie) ;
- numérateur : épisodes is_health = 0 et catégorie <> CONGE_ANNUEL, ventilés au prorata de leurs jours ouvrés
  (au jour de début s'ils n'en ont aucun) ; visibilité : saisis au plus tard LAG_DAYS jours après la fin du mois d'origine ;
- rattachement du mois : département et manager à la date de référence (fin du mois, ou sortie si antérieure),
  reconstitués depuis les MUTATION et CHANGEMENT_MANAGER (comme agg_kpi_monthly).
"""
import hashlib
import sqlite3
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

LAG_DAYS = 10
MIN_GROUP = 5


def connect_ro(db_path) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)


def mi(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7]) - 1


def ml(i: int) -> str:
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def d0(s: str) -> int:
    return date.fromisoformat(s).toordinal()


def ds(o: int) -> str:
    return date.fromordinal(o).isoformat()


def m_start(i: int) -> int:
    return date(i // 12, i % 12 + 1, 1).toordinal()


def m_end(i: int) -> int:
    return m_start(i + 1) - 1


@dataclass
class Calendar:
    start: int
    working: list  # bool par jour depuis start
    ramadan: list
    bridge: list
    holiday: list
    seance: list

    def is_working(self, o: int) -> bool:
        i = o - self.start
        if 0 <= i < len(self.working) and self.working[i] is not None:
            return self.working[i]
        return date.fromordinal(o).weekday() < 5

    def month_features(self, i: int) -> dict:
        wd = ram = br = hol = su = 0
        for o in range(m_start(i), m_end(i) + 1):
            k = o - self.start
            known = 0 <= k < len(self.working) and self.working[k] is not None
            wday = date.fromordinal(o).weekday() < 5
            if known and self.holiday[k] and wday:
                hol += 1
            if not self.is_working(o):
                continue
            wd += 1
            if known:
                ram += self.ramadan[k]
                br += self.bridge[k]
                su += self.seance[k] and not self.ramadan[k]
        return {"wd": wd, "ram": ram / wd if wd else 0.0, "bridge": br, "hol": hol, "su": su / wd if wd else 0.0}


def load_calendar(con, from_o: int, to_o: int) -> Calendar:
    n = to_o - from_o + 1
    working, ram, br, hol, su = [None] * n, [0] * n, [0] * n, [0] * n, [0] * n
    for d, we, h, r, b, s in con.execute(
        "SELECT date, is_weekend, is_holiday, is_ramadan, is_bridge, is_seance_unique FROM dim_date WHERE date BETWEEN ? AND ?",
        (ds(from_o), ds(to_o)),
    ):
        k = d0(d) - from_o
        working[k] = not we and not h
        ram[k], br[k], hol[k], su[k] = int(r), int(b), int(h), int(s)
    return Calendar(from_o, working, ram, br, hol, su)


def _history(events, current, resolve):
    """[(from_ord, to_ord, value)] : valeur avant le premier événement = ancienne valeur (sinon actuelle), puis nouvelles valeurs."""
    if not events:
        return [(-10**9, 10**9, current)]
    out = []
    first_old = resolve(events[0][1])
    out.append((-10**9, events[0][0], first_old if first_old is not None else current))
    for k, (o, _old, new) in enumerate(events):
        nxt = events[k + 1][0] if k + 1 < len(events) else 10**9
        v = resolve(new)
        out.append((o, nxt, v if v is not None else current))
    return out


def _at(periods, o):
    val = None
    for a, b, v in periods:
        if a <= o < b:
            val = v
    return val


@dataclass
class Data:
    months: list  # indices de mois
    cal: Calendar
    emp: dict  # id -> (hire_o, exit_o|None)
    dept_hist: dict
    mgr_hist: dict
    dept_names: dict
    emp_names: dict
    den: dict = field(default_factory=dict)  # (unit, month) -> jours ouvrés
    alloc: list = field(default_factory=list)  # (unit, month, recorded_o, jours)
    num_full: dict = field(default_factory=dict)

    def dept_at(self, e, o):
        return _at(self.dept_hist[e], o)

    def mgr_at(self, e, o):
        return _at(self.mgr_hist[e], o)

    def units(self, e, i):
        ex = self.emp[e][1]
        ref = ex if ex is not None and ex < m_end(i) else m_end(i)
        out = ["E"]
        dep = self.dept_at(e, ref)
        if dep is not None:
            out.append(f"D{dep}")
        mgr = self.mgr_at(e, ref)
        if mgr is not None:
            out.append(f"T{mgr}")
        return out

    def active_at(self, o):
        """Effectif actif à la date o par unité (embauche <= o et pas sorti au plus tard le jour o)."""
        cnt = {}
        for e, (h, x) in self.emp.items():
            if h > o or (x is not None and x <= o):
                continue
            for u in ("E", f"D{self.dept_at(e, o)}" if self.dept_at(e, o) is not None else None,
                      f"T{self.mgr_at(e, o)}" if self.mgr_at(e, o) is not None else None):
                if u:
                    cnt[u] = cnt.get(u, 0) + 1
        return cnt


def load(db_path, first_month: str | None = None, last_month: str | None = None) -> Data:
    con = connect_ro(db_path)
    try:
        if last_month is None:
            row = con.execute("SELECT value FROM app_setting WHERE key = 'data_end_date'").fetchone()
            last_month = row[0][:7] if row and row[0] else con.execute("SELECT substr(max(date),1,7) FROM attendance_daily").fetchone()[0]
        if first_month is None:
            first_month = con.execute("SELECT substr(min(date),1,7) FROM attendance_daily").fetchone()[0]
        months = list(range(mi(first_month), mi(last_month) + 1))
        lo, hi = m_start(months[0]), m_end(months[-1])
        cal = load_calendar(con, lo - 400, hi + 400)
        emps = con.execute("SELECT id, matricule, hire_date, exit_date, department_id, manager_id, last_name, first_name FROM employee").fetchall()
        by_mat = {m: i for i, m, *_ in emps}
        dept_codes = {c: i for i, c in con.execute("SELECT id, code FROM department")}
        dept_names = {i: n for i, n in con.execute("SELECT id, name FROM department")}
        ev = {}
        for eid, d, typ, old, new in con.execute(
            "SELECT employee_id, date, type, old_value, new_value FROM career_event WHERE type IN ('MUTATION','CHANGEMENT_MANAGER') ORDER BY employee_id, date, id"
        ):
            ev.setdefault((eid, typ), []).append((d0(d), old, new))
        emp, dept_hist, mgr_hist, names = {}, {}, {}, {}
        for eid, _mat, hire, ex, dep, mgr, ln, fn in emps:
            emp[eid] = (d0(hire), d0(ex) if ex else None)
            names[eid] = f"{ln} {fn}"
            dept_hist[eid] = _history(ev.get((eid, "MUTATION"), []), dep, lambda v: dept_codes.get(v))
            mgr_hist[eid] = _history(ev.get((eid, "CHANGEMENT_MANAGER"), []), mgr, lambda v: by_mat.get(v))
        data = Data(months, cal, emp, dept_hist, mgr_hist, dept_names, names)

        # dénominateur
        cum_start = lo
        cum = [0]
        for o in range(lo, hi + 1):
            cum.append(cum[-1] + (1 if cal.is_working(o) else 0))

        def wd_between(a, b):
            a, b = max(a, lo), min(b, hi)
            return cum[b - cum_start + 1] - cum[a - cum_start] if a <= b else 0

        for e, (h, x) in emp.items():
            for i in months:
                a, b = max(h, m_start(i)), min(x if x is not None else 10**9, m_end(i))
                if a > b:
                    continue
                w = wd_between(a, b)
                if w <= 0:
                    continue
                for u in data.units(e, i):
                    data.den[(u, i)] = data.den.get((u, i), 0) + w

        # numérateur : ventilation au prorata des jours ouvrés de l'épisode
        first_i, last_i = months[0], months[-1]
        for e, s, t, days, rec in con.execute(
            "SELECT employee_id, start_date, end_date, days, recorded_at FROM absence_episode "
            "WHERE is_health = 0 AND category <> 'CONGE_ANNUEL' AND end_date >= ? AND start_date <= ? ORDER BY id",
            (ds(lo), ds(hi)),
        ):
            if e not in emp:
                continue
            so, to = d0(s), d0(t)
            wds = [o for o in range(so, to + 1) if cal.is_working(o)]
            rec_o = d0(rec[:10])
            per = {}
            if not wds:
                i = mi(s[:7])
                per[i] = float(days)
            else:
                share = float(days) / len(wds)
                for o in wds:
                    dd = date.fromordinal(o)
                    i = dd.year * 12 + dd.month - 1
                    per[i] = per.get(i, 0.0) + share
            for i, v in per.items():
                if i < first_i or i > last_i:
                    continue
                for u in data.units(e, i):
                    data.alloc.append((u, i, rec_o, v))
                    data.num_full[(u, i)] = data.num_full.get((u, i), 0.0) + v
        return data
    finally:
        con.close()


def visible_num(data: Data, origin: int) -> dict:
    """Numérateur vu à l'origine (fin du mois origin + LAG_DAYS) pour les 12 derniers mois : (unit, month) -> jours."""
    cutoff = m_end(origin) + LAG_DAYS
    out = {}
    for u, i, rec, v in data.alloc:
        if origin - 11 <= i <= origin and rec <= cutoff:
            out[(u, i)] = out.get((u, i), 0.0) + v
    return out


def data_hash(db_path) -> str:
    con = connect_ro(db_path)
    try:
        h = hashlib.sha256()
        for row in con.execute(
            "SELECT employee_id, start_date, end_date, days, category, recorded_at FROM absence_episode WHERE is_health = 0 ORDER BY id"
        ):
            h.update(repr(row).encode())
        for row in con.execute("SELECT id, hire_date, exit_date, department_id, manager_id FROM employee ORDER BY id"):
            h.update(repr(row).encode())
        return h.hexdigest()
    finally:
        con.close()

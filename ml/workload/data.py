"""Panel mensuel des heures supplémentaires (lecture seule) : pointages, appartenance équipe / département, calendrier.

Mêmes définitions que src/lib/ai/workload/panel.ts (parité vérifiée par le bloc `features` de golden.json).
"""
import calendar as _cal
import hashlib
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
STD_MONTH_DAYS = 21.67


def connect_ro(db_path) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)


def mi(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7]) - 1


def ym(i: int) -> str:
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def month_end(i: int) -> str:
    y, m = i // 12, i % 12 + 1
    return f"{y:04d}-{m:02d}-{_cal.monthrange(y, m)[1]:02d}"


@dataclass
class Calendar:
    """Indexé par mois absolu (mi) : jours ouvrés, part Ramadan, part séance unique d'été, part de ponts."""
    wd: dict = field(default_factory=dict)
    ram: dict = field(default_factory=dict)
    su: dict = field(default_factory=dict)
    br: dict = field(default_factory=dict)

    def get(self, i: int):
        if i in self.wd:
            return self.wd[i], self.ram[i], self.su[i], self.br[i]
        y, m = i // 12, i % 12 + 1
        n = _cal.monthrange(y, m)[1]
        wd = sum(1 for d in range(1, n + 1) if _cal.weekday(y, m, d) < 5)
        return float(wd), 0.0, 0.0, 0.0


def load_calendar(con, first: int, last: int) -> Calendar:
    rows = con.execute(
        """SELECT substr(date, 1, 7) AS m,
                  SUM(is_weekend = 0 AND is_holiday = 0) AS wd,
                  SUM(is_weekend = 0 AND is_holiday = 0 AND is_ramadan = 1) AS ram,
                  SUM(is_weekend = 0 AND is_holiday = 0 AND is_seance_unique = 1 AND is_ramadan = 0) AS su,
                  SUM(is_bridge = 1) AS br
             FROM dim_date WHERE date BETWEEN ? AND ? GROUP BY substr(date, 1, 7)""",
        (ym(first) + "-01", month_end(last)),
    ).fetchall()
    cal = Calendar()
    for m, wd, ram, su, br in rows:
        i = mi(m)
        if wd and wd > 0:
            cal.wd[i], cal.ram[i], cal.su[i], cal.br[i] = float(wd), ram / wd, su / wd, br / wd
    return cal


@dataclass
class Panel:
    m0: int  # mois absolu de la colonne 0
    n_obs: int  # colonnes observées 0..n_obs-1 (dernier mois = data_end_date)
    emp_ids: np.ndarray
    ot_min: np.ndarray  # (E, M) minutes supplémentaires pointées
    days: np.ndarray  # (E, M) jours pointés
    act: np.ndarray  # (E, M) actif en fin de mois
    mgr: np.ndarray  # (E, M) manager en fin de mois (-1 : inactif ou aucun)
    dept: np.ndarray  # (E, M) département en fin de mois (-1)
    hire_col: np.ndarray  # colonne du mois d'embauche (peut être < 0)
    exit_date: list
    cal: Calendar
    data_hash: str

    @property
    def ot_h(self) -> np.ndarray:
        return self.ot_min / 60.0

    def col(self, ym_: str) -> int:
        return mi(ym_) - self.m0


def _at(events, current, d: str):
    """Valeur (id) à la date d à partir d'événements triés (date, old_id, new_id) ; repli : valeur courante."""
    if not events:
        return current
    val = None
    for date, old, new in events:
        if date <= d:
            val = new
        else:
            break
    if val is None:
        val = events[0][1]
    return current if val is None else val


def load_panel(db_path) -> Panel:
    con = connect_ro(db_path)
    try:
        end = con.execute("SELECT value FROM app_setting WHERE key = 'data_end_date'").fetchone()
        last_att = con.execute("SELECT max(date), min(date) FROM attendance_daily").fetchone()
        end_date = end[0] if end and end[0] else last_att[0]
        m0, m_last = mi(last_att[1][:7]), mi(end_date[:7])
        M = m_last - m0 + 1
        emps = con.execute(
            """SELECT e.id, e.matricule, e.hire_date,
                      COALESCE((SELECT min(x.exit_date) FROM exit_event x WHERE x.employee_id = e.id), e.exit_date),
                      e.manager_id, e.department_id
                 FROM employee e ORDER BY e.id"""
        ).fetchall()
        mat2id = {r[1]: r[0] for r in emps}
        code2id = dict(con.execute("SELECT code, id FROM department").fetchall())
        mgr_ev, dept_ev = {}, {}
        for eid, date, typ, old, new in con.execute(
            "SELECT employee_id, date, type, old_value, new_value FROM career_event WHERE type IN ('CHANGEMENT_MANAGER','MUTATION') ORDER BY employee_id, date, id"
        ):
            if typ == "CHANGEMENT_MANAGER":
                mgr_ev.setdefault(eid, []).append((date, mat2id.get(old), mat2id.get(new)))
            else:
                dept_ev.setdefault(eid, []).append((date, code2id.get(old), code2id.get(new)))
        att = con.execute(
            """SELECT employee_id, substr(date, 1, 7) AS m, SUM(overtime_minutes), COUNT(*)
                 FROM attendance_daily WHERE date <= ? GROUP BY employee_id, substr(date, 1, 7) ORDER BY employee_id, m""",
            (end_date,),
        ).fetchall()
        cal = load_calendar(con, m0 - 24, m_last + 12)
    finally:
        con.close()

    E = len(emps)
    idx = {r[0]: k for k, r in enumerate(emps)}
    ot = np.zeros((E, M))
    days = np.zeros((E, M))
    h = hashlib.sha256()
    for eid, m, otm, n in att:
        c = mi(m) - m0
        if 0 <= c < M and eid in idx:
            ot[idx[eid], c] = otm
            days[idx[eid], c] = n
            h.update(f"{eid};{m};{otm};{n}\n".encode())
    ends = [month_end(m0 + c) for c in range(M)]
    ends_arr = np.array(ends)
    act = np.zeros((E, M), dtype=bool)
    mgr = np.full((E, M), -1, dtype=np.int64)
    dept = np.full((E, M), -1, dtype=np.int64)
    hire_col = np.zeros(E, dtype=np.int64)
    exit_date = []
    for k, (eid, _mat, hire, ex, cur_mgr, cur_dept) in enumerate(emps):
        hire_col[k] = mi(hire[:7]) - m0
        exit_date.append(ex)
        me, de = mgr_ev.get(eid), dept_ev.get(eid)
        a = (ends_arr >= hire) if ex is None else ((ends_arr >= hire) & (ends_arr < ex))
        act[k] = a
        cols = np.nonzero(a)[0]
        if me:
            for c in cols:
                mv = _at(me, cur_mgr, ends[c])
                mgr[k, c] = -1 if mv is None else mv
        elif cur_mgr is not None:
            mgr[k, cols] = cur_mgr
        if de:
            for c in cols:
                dv = _at(de, cur_dept, ends[c])
                dept[k, c] = -1 if dv is None else dv
        elif cur_dept is not None:
            dept[k, cols] = cur_dept
    return Panel(m0, M, np.array([r[0] for r in emps]), ot, days, act, mgr, dept, hire_col, exit_date, cal, h.hexdigest())


def voluntary_exits(db_path) -> dict:
    """employee_id -> date de sortie volontaire (DEMISSION, ABANDON)."""
    con = connect_ro(db_path)
    try:
        return dict(
            con.execute(
                "SELECT employee_id, min(exit_date) FROM exit_event WHERE reason IN ('DEMISSION','ABANDON') GROUP BY employee_id"
            ).fetchall()
        )
    finally:
        con.close()


def risk_levels(db_path) -> dict:
    """(employee_id, as_of) -> niveau publié (run PUBLIE le plus récent par as_of)."""
    con = connect_ro(db_path)
    try:
        rows = con.execute(
            """SELECT p.employee_id, p.as_of, p.level FROM prediction p
                 JOIN scoring_run r ON r.id = p.run_id
                WHERE r.id IN (SELECT max(id) FROM scoring_run WHERE status = 'PUBLIE' GROUP BY as_of)"""
        ).fetchall()
        kind = con.execute(
            """SELECT mv.version, mv.kind FROM model_version mv WHERE mv.status = 'CHAMPION'"""
        ).fetchone()
    finally:
        con.close()
    return {"levels": {(e, a): lv for e, a, lv in rows}, "champion": kind}

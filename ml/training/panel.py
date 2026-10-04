"""Panel « formation obligatoire ouverte à t » : population, variables visibles à t et étiquette (lecture seule).

Miroir exact de src/lib/ai/training/features.ts (parité vérifiée par golden-features.json).
"""
import hashlib
import math
import sqlite3
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

HORIZON_DAYS = 120  # formation « connue et suivie » à t : échéance dans ]t, t + 120 j]
TEAM_WINDOW_DAYS = 365
TEAM_MIN_TRAININGS = 5
MARGIN_CLIP = 120
NEW_HIRE_MONTHS = 3
FEATURE_PARAMS = {"horizon_days": HORIZON_DAYS, "team_window_days": TEAM_WINDOW_DAYS,
                  "team_min_trainings": TEAM_MIN_TRAININGS, "margin_clip": MARGIN_CLIP, "new_hire_months": NEW_HIRE_MONTHS}

ALL_FEATURES = ["days_to_due", "log_days_to_due", "started", "hours", "tenure_months", "log_tenure", "new_hire", "emp_past_n",
                "emp_late_rate", "emp_margin_days", "emp_overdue_other", "team_late_rate_12m", "overtime_h_3m",
                "open_mandatory_others", "due_summer"]

EPOCH = date(1970, 1, 1)


def to_day(s: str) -> int:
    return (date(int(s[0:4]), int(s[5:7]), int(s[8:10])) - EPOCH).days


def from_day(d: int) -> str:
    return (EPOCH + timedelta(days=d)).isoformat()


def is_month_end(s: str) -> bool:
    return int(s[8:10]) == monthrange(int(s[0:4]), int(s[5:7]))[1]


def months_between(a: str, b: str) -> int:
    m = (int(b[0:4]) - int(a[0:4])) * 12 + (int(b[5:7]) - int(a[5:7]))
    if int(b[8:10]) < int(a[8:10]) and not is_month_end(b):
        m -= 1
    return m


def month_start_minus(t: str, n: int) -> str:
    idx = int(t[0:4]) * 12 + int(t[5:7]) - 1 - n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}-01"


def month_end(month: str) -> str:
    y, m = int(month[0:4]), int(month[5:7])
    return f"{month[0:7]}-{monthrange(y, m)[1]:02d}"


def month_ends(first: str, last: str) -> list[str]:
    out, y, m = [], int(first[0:4]), int(first[5:7])
    while f"{y:04d}-{m:02d}" <= last[0:7]:
        out.append(month_end(f"{y:04d}-{m:02d}"))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def connect_ro(db_path) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)


class Source:
    """Sources brutes nécessaires (toutes dates confondues) ; la visibilité à t est appliquée par as_of()."""

    def __init__(self, con: sqlite3.Connection):
        q = lambda sql: con.execute(sql).fetchall()  # noqa: E731
        self.employees = {r[0]: {"id": r[0], "matricule": r[1], "hire": r[2], "manager_id": r[3]}
                          for r in q("SELECT id, matricule, hire_date, manager_id FROM employee ORDER BY id")}
        self.id_by_mat = {e["matricule"]: e["id"] for e in self.employees.values()}
        self.exits: dict[int, list[tuple[str, str]]] = {}
        for eid, d, rec in q("SELECT employee_id, exit_date, substr(recorded_at, 1, 10) FROM exit_event ORDER BY employee_id, exit_date, id"):
            self.exits.setdefault(eid, []).append((d, rec))
        self.mgr_events: dict[int, list[tuple[str, str | None, str | None, str]]] = {}
        for eid, d, o, n, rec in q("""SELECT employee_id, date, old_value, new_value, substr(recorded_at, 1, 10) FROM career_event
                                      WHERE type = 'CHANGEMENT_MANAGER' ORDER BY employee_id, date, id"""):
            self.mgr_events.setdefault(eid, []).append((d, o, n, rec))
        self.trainings = [
            {"id": r[0], "eid": r[1], "code": r[2], "start": r[3], "end": r[4], "due": r[5], "hours": float(r[6]), "status": r[7]}
            for r in q("""SELECT id, employee_id, code, start_date, end_date, due_date, hours, status FROM training
                          WHERE mandatory = 1 AND due_date IS NOT NULL ORDER BY employee_id, due_date, id""")
        ]
        self.by_emp: dict[int, list[dict]] = {}
        for tr in self.trainings:
            self.by_emp.setdefault(tr["eid"], []).append(tr)
        ot = pd.read_sql("SELECT employee_id AS eid, date, overtime_minutes AS ot FROM attendance_daily WHERE overtime_minutes > 0", con)
        ot["day"] = ot["date"].map(to_day)
        self.ot = {eid: (g["day"].to_numpy(), np.cumsum(g["ot"].to_numpy())) for eid, g in ot.sort_values(["eid", "day"]).groupby("eid")}
        self.opposed = {r[0] for r in q("SELECT employee_id FROM employee_opposition")}
        row = con.execute("SELECT value FROM app_setting WHERE key = 'data_end_date'").fetchone()
        self.data_end = row[0] if row else None

    def active(self, eid: int, t: str) -> bool:
        e = self.employees[eid]
        return e["hire"] <= t and not any(d <= t and rec <= t for d, rec in self.exits.get(eid, []))

    def manager_at(self, eid: int, t: str) -> int | None:
        """Même règle que stateAt (src/lib/features/compute.ts) pour CHANGEMENT_MANAGER."""
        last = first = None
        for ev in self.mgr_events.get(eid, []):
            if first is None:
                first = ev
            if ev[0] <= t and ev[3] <= t and (last is None or ev[0] >= last[0]):
                last = ev
        if last is not None:
            mat = last[2] or None
        elif first is not None:
            mat = first[1] or None
        else:
            cur = self.employees[eid]["manager_id"]
            return cur if cur in self.employees else None
        return self.id_by_mat.get(mat) if mat else None

    def overtime_hours(self, eid: int, lo: str, hi: str) -> float:
        s = self.ot.get(eid)
        if s is None:
            return 0.0
        days, cum = s
        a = np.searchsorted(days, to_day(lo), side="left")
        b = np.searchsorted(days, to_day(hi), side="right")
        tot = (cum[b - 1] if b > 0 else 0) - (cum[a - 1] if a > 0 else 0)
        return float(tot) / 60.0


def completed_by(tr: dict, d: str) -> bool:
    return tr["status"] == "TERMINEE" and tr["end"] is not None and tr["end"] <= d


def is_open(tr: dict, t: str) -> bool:
    """Ouverte à t : échéance dans ]t, t + H], non abandonnée, pas terminée à t (TERMINEE sans date de fin : exclue)."""
    if tr["status"] == "ABANDONNEE" or (tr["status"] == "TERMINEE" and tr["end"] is None):
        return False
    d = to_day(tr["due"]) - to_day(t)
    return 0 < d <= HORIZON_DAYS and not completed_by(tr, t)


def late(tr: dict) -> int:
    """Non terminée à l'échéance ; visible à t dès que l'échéance est <= t."""
    return 0 if completed_by(tr, tr["due"]) else 1


def features_for(src: Source, tr: dict, t: str, teams: dict, team_members: dict) -> dict:
    """Variables brutes (None = manquante, imputée par le bundle). team_members[mgr] = {eid: (n, late)} des membres."""
    eid = tr["eid"]
    e = src.employees[eid]
    tday = to_day(t)
    own = src.by_emp.get(eid, [])
    past = [x for x in own if x["due"] <= t]
    n_past = len(past)
    lates = sum(late(x) for x in past)
    margins = []
    for x in past:
        ref = x["end"] if completed_by(x, t) else t
        margins.append(max(-MARGIN_CLIP, min(MARGIN_CLIP, to_day(x["due"]) - to_day(ref))))
    overdue_other = any(x["id"] != tr["id"] and x["due"] <= t and not completed_by(x, t) and x["status"] != "ABANDONNEE" for x in own)
    others_open = sum(1 for x in own if x["id"] != tr["id"] and is_open(x, t))
    mgr = src.manager_at(eid, t)
    team_rate = None
    if mgr is not None and mgr in teams:
        n, lt = teams[mgr]
        mine = team_members.get(mgr, {}).get(eid, (0, 0))
        n, lt = n - mine[0], lt - mine[1]
        if n >= TEAM_MIN_TRAININGS:
            team_rate = lt / n
    tenure = months_between(e["hire"], t)
    dtd = to_day(tr["due"]) - tday
    started = 1 if tr["status"] in ("EN_COURS", "TERMINEE") and tr["start"] is not None and tr["start"] <= t else 0
    return {
        "days_to_due": dtd,
        "log_days_to_due": math.log(dtd),
        "started": started,
        "hours": tr["hours"],
        "tenure_months": tenure,
        "log_tenure": math.log1p(max(tenure, 0)),
        "new_hire": 1 if tenure < NEW_HIRE_MONTHS else 0,
        "emp_past_n": n_past,
        "emp_late_rate": lates / n_past if n_past else None,
        "emp_margin_days": sum(margins) / n_past if n_past else None,
        "emp_overdue_other": 1 if overdue_other else 0,
        "team_late_rate_12m": team_rate,
        "overtime_h_3m": src.overtime_hours(eid, month_start_minus(t, 2), t) / 3.0,
        "open_mandatory_others": others_open,
        "due_summer": 1 if int(tr["due"][5:7]) in (7, 8) else 0,
    }


def team_member_stats(src: Source, t: str) -> dict[int, dict[int, tuple[int, int]]]:
    """Par manager à t puis par membre actif : (formations obligatoires échues dans ]t - 365 j, t], dont en retard)."""
    lo = from_day(to_day(t) - TEAM_WINDOW_DAYS)
    out: dict[int, dict[int, tuple[int, int]]] = {}
    for eid, trs in src.by_emp.items():
        if not src.active(eid, t):
            continue
        mgr = src.manager_at(eid, t)
        if mgr is None:
            continue
        sel = [x for x in trs if lo < x["due"] <= t]
        if sel:
            out.setdefault(mgr, {})[eid] = (len(sel), sum(late(x) for x in sel))
    return out


def open_rows(src: Source, t: str, exclude_opposed: bool = True):
    members = team_member_stats(src, t)
    teams = {m: (sum(v[0] for v in d.values()), sum(v[1] for v in d.values())) for m, d in members.items()}
    for tr in src.trainings:
        if exclude_opposed and tr["eid"] in src.opposed:
            continue
        if not is_open(tr, t) or not src.active(tr["eid"], t):
            continue
        yield tr, features_for(src, tr, t, teams, members)


def exits_before(src: Source, eid: int, d: str) -> bool:
    return any(x <= d for x, _ in src.exits.get(eid, []))


def build_panel(db_path, first: str = "2020-11-30", last: str | None = None) -> pd.DataFrame:
    """Une ligne par (fin de mois t, formation obligatoire ouverte à t). Étiquette y = non terminée à l'échéance.
    followup_complete = 1 si t + H <= data_end_date ; départ du salarié avant l'échéance : ligne exclue (sans objet)."""
    con = connect_ro(db_path)
    try:
        src = Source(con)
    finally:
        con.close()
    last = last or src.data_end
    rows = []
    for t in month_ends(first, last):
        complete = to_day(t) + HORIZON_DAYS <= to_day(src.data_end)
        for tr, f in open_rows(src, t):
            if exits_before(src, tr["eid"], tr["due"]):
                continue
            rows.append({"as_of": t, "training_id": tr["id"], "employee_id": tr["eid"], "code": tr["code"], "due": tr["due"],
                         "y": late(tr) if tr["due"] <= src.data_end else -1, "followup_complete": int(complete), **f})
    df = pd.DataFrame(rows)
    df.attrs["data_end"] = src.data_end
    return df


def data_hash(df: pd.DataFrame) -> str:
    cols = ["as_of", "training_id", "y"] + ALL_FEATURES
    return hashlib.sha256(pd.util.hash_pandas_object(df[cols], index=False).values.tobytes()).hexdigest()

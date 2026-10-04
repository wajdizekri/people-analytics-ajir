"""Test de stress du facteur calendrier : copie data/eval-base.db et ajoute un effet saisonnier « normal »
(absences d'un jour, catégorie AUTRE) pendant le Ramadan et les jours collés aux fériés, absent du simulateur.

    python -m ml.eval.stress --ramadan 2 --ferie 3 --out data/eval-stress-r2f3.db
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

from . import common as C

BASE_RATE = 0.0083  # taux journalier d'absence comptée hors santé, semaines normales (facteur NORMALE, eval-base.db)


def near_holiday(cal: pd.DataFrame) -> np.ndarray:
    work = ((cal["is_weekend"] == 0) & (cal["is_holiday"] == 0) & (cal["is_bridge"] == 0)).to_numpy()
    hol = cal["is_holiday"].to_numpy().astype(bool)
    out = np.zeros(len(cal), dtype=bool)
    for i in np.nonzero(work)[0]:
        for step in (-1, 1):
            j, seen = i + step, False
            while 0 <= j < len(cal) and not work[j]:
                seen |= hol[j]
                j += step
            out[i] |= seen
    return out


def build(src: Path, dst: Path, ramadan: float, ferie: float, seed: int = 1) -> dict:
    if not dst.name.startswith("eval-"):
        raise ValueError("copie attendue sous data/eval-*.db")
    for f in (dst, Path(f"{dst}-wal"), Path(f"{dst}-shm")):
        f.unlink(missing_ok=True)
    with sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True) as s, sqlite3.connect(dst) as d:
        s.backup(d)
    rng = np.random.default_rng(seed)
    with sqlite3.connect(dst) as c:
        cal = pd.read_sql("SELECT date, is_weekend, is_holiday, is_bridge, is_ramadan FROM dim_date ORDER BY date", c)
        cal["near"] = near_holiday(cal)
        cal["working"] = (cal["is_weekend"] == 0) & (cal["is_holiday"] == 0) & (cal["is_bridge"] == 0)
        emps = pd.read_sql(
            "SELECT e.id, e.hire_date, COALESCE((SELECT min(x.exit_date) FROM exit_event x WHERE x.employee_id = e.id), e.exit_date) AS exit_date FROM employee e",
            c,
        )
        ep = pd.read_sql("SELECT employee_id, start_date, end_date FROM absence_episode", c)
        lo, hi = pd.read_sql("SELECT min(date) a, max(date) b FROM attendance_daily", c).iloc[0]
        cal = cal[(cal["date"] >= lo) & (cal["date"] <= hi) & cal["working"]]
        p = np.where(cal["is_ramadan"] == 1, (ramadan - 1) * BASE_RATE, 0.0) + np.where(cal["near"], (ferie - 1) * BASE_RATE, 0.0)
        cal = cal.assign(p=p)
        cal = cal[cal["p"] > 0]
        busy = {}
        for e, a, b in ep.itertuples(index=False):
            busy.setdefault(e, []).append((a, b))
        rows = []
        for e, h, x in emps.itertuples(index=False):
            days = cal[(cal["date"] >= h) & ((cal["date"] <= x) if x else True)]
            pick = days.loc[rng.random(len(days)) < days["p"].to_numpy(), "date"]
            for dday in pick:
                if not any(a <= dday <= b for a, b in busy.get(e, ())):
                    rows.append((int(e), dday, dday, 1.0, "AUTRE", 0, dday))
        c.executemany("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?,?,?,?,?,?,?)", rows)
        c.execute("DELETE FROM anomaly")
        c.execute("DELETE FROM alert")
    return {"ramadan_multiplier": ramadan, "ferie_multiplier": ferie, "added_episodes": len(rows), "db": str(dst)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ramadan", type=float, default=2.0)
    ap.add_argument("--ferie", type=float, default=3.0)
    ap.add_argument("--src", type=Path, default=C.EVAL_DB)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    print(build(a.src, a.out, a.ramadan, a.ferie, a.seed))

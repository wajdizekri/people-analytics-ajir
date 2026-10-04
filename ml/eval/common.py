"""Chemins et chargement : vérité terrain du simulateur et exports de scripts/eval-anomalies.ts."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SIM_DIR = ROOT / "data" / "sim" / "mixte_medium_s1"
EXPORT_DIR = ROOT / "data" / "eval-out"
EVAL_DB = ROOT / "data" / "eval-base.db"
RESULTS_DIR = Path(__file__).resolve().parent / "results"


def read_csv(path: Path, **kw) -> pd.DataFrame:
    return pd.read_csv(path, sep=";", **kw)


def load_meta(export: Path = EXPORT_DIR) -> dict:
    return json.loads((export / "scores_meta.json").read_text(encoding="utf-8"))


def load_employees(export: Path = EXPORT_DIR) -> pd.DataFrame:
    e = read_csv(export / "employees.csv")
    for c in ("manager_id", "department_id"):
        e[c] = e[c].astype("Int64")
    e["exit_date"] = e["exit_date"].fillna("")
    return e


def group_members(emps: pd.DataFrame) -> dict[str, frozenset]:
    """Composition des groupes telle que la voit detectAnomalies : manager et département actuels (statiques)."""
    out: dict[str, frozenset] = {}
    for m, g in emps.dropna(subset=["manager_id"]).groupby("manager_id"):
        out[f"T{int(m)}"] = frozenset(g["id"].astype(int))
    for d, g in emps.dropna(subset=["department_id"]).groupby("department_id"):
        out[f"D{int(d)}"] = frozenset(g["id"].astype(int))
    return out


def active_at(emps: pd.DataFrame, day: str, strict_exit: bool = False) -> pd.Series:
    """Salariés en poste à la date : embauche <= jour et sortie absente ou >= jour (> jour si strict_exit)."""
    ex = emps["exit_date"]
    ok_exit = (ex == "") | ((ex > day) if strict_exit else (ex >= day))
    return (emps["hire_date"] <= day) & ok_exit


def load_events(sim_dir: Path, emps: pd.DataFrame) -> pd.DataFrame:
    gt = read_csv(sim_dir / "ground_truth" / "anomalies.csv")
    ids = dict(zip(emps["matricule"], emps["id"].astype(int)))
    depts = emps.dropna(subset=["department_id"]).drop_duplicates("department_code").set_index("department_code")["department_id"]
    gt["employee_id"] = gt["matricule"].map(ids)
    ev = (
        gt.groupby("anomaly_id")
        .agg(
            type=("type", "first"),
            scope=("scope", "first"),
            department_code=("department_code", "first"),
            manager_matricule=("manager_matricule", "first"),
            start=("start_date", "first"),
            end=("end_date", "first"),
            held_out=("held_out", "first"),
            n_members=("matricule", "size"),
            injected_days=("injected_days", "sum"),
            members=("employee_id", lambda s: frozenset(int(x) for x in s.dropna())),
        )
        .reset_index()
    )
    ev["department_id"] = ev["department_code"].map(depts).astype("Int64")
    return ev


def load_scores(tag: str, export: Path = EXPORT_DIR) -> pd.DataFrame:
    s = read_csv(export / f"scores_{tag}.csv")
    s["manager_id"] = s["manager_id"].astype("Int64")
    s["department_id"] = s["department_id"].astype("Int64")
    return s


def z_matrix(scores: pd.DataFrame) -> tuple[list[str], list[str], np.ndarray, np.ndarray]:
    """(clés, lundis, z[groupe, semaine], den[groupe, semaine])."""
    keys = sorted(scores["key"].unique(), key=lambda k: (k[0], int(k[1:])))
    weeks = sorted(scores["week_start"].unique())
    ki = {k: i for i, k in enumerate(keys)}
    wi = {w: i for i, w in enumerate(weeks)}
    z = np.full((len(keys), len(weeks)), np.nan)
    den = np.zeros((len(keys), len(weeks)))
    r = scores["key"].map(ki).to_numpy()
    c = scores["week_start"].map(wi).to_numpy()
    z[r, c] = scores["z"].to_numpy(dtype=float)
    den[r, c] = scores["den"].to_numpy(dtype=float)
    return keys, weeks, z, den


def calendar(db: Path = EVAL_DB) -> pd.DataFrame:
    with sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True) as c:
        return pd.read_sql("SELECT date, is_weekend, is_holiday, holiday_name, is_ramadan, is_bridge, is_seance_unique FROM dim_date", c)


def add_days(day: str, n: int) -> str:
    return str(np.datetime64(day) + np.timedelta64(n, "D"))


def month_end(month: str) -> str:
    return str((np.datetime64(month, "M") + 1).astype("datetime64[D]") - 1)


def monday_of(day: str) -> str:
    d = np.datetime64(day)
    return str(d - np.timedelta64(int((d.astype("datetime64[D]").view("int64") - 4) % 7), "D"))


def month_range(a: str, b: str) -> list[str]:
    return [str(m) for m in np.arange(np.datetime64(a, "M"), np.datetime64(b, "M") + 1)]


def weeks_of_month(month: str) -> tuple[str, str]:
    """Identique à weeksOfMonth (src/lib/jobs/handlers.ts)."""
    return add_days(monday_of(f"{month}-01"), -7), monday_of(month_end(month))

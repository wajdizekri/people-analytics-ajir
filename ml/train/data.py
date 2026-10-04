"""Chargement du panel (feature_snapshot x v_label_panel), lecture seule."""
import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
FEATURES_JSON = ROOT / "shared" / "features.json"
AGE_BANDS = [(0, 30, "< 30 ans"), (30, 45, "30-44 ans"), (45, 200, "45 ans et plus")]


def load_spec(path=FEATURES_JSON) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def feature_names(spec: dict) -> list[str]:
    return [f["name"] for f in spec["features"]]


def connect_ro(db_path) -> sqlite3.Connection:
    uri = Path(db_path).resolve().as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


def month_index(dates) -> np.ndarray:
    s = pd.Series(dates, dtype=str)
    return (s.str.slice(0, 4).astype(int) * 12 + s.str.slice(5, 7).astype(int) - 1).to_numpy()


def month_label(idx: int) -> str:
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def setting(con: sqlite3.Connection, key: str, default=None):
    row = con.execute("SELECT value FROM app_setting WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def age_band(age: np.ndarray) -> np.ndarray:
    out = np.full(len(age), "inconnu", dtype=object)
    for lo, hi, label in AGE_BANDS:
        out[(age >= lo) & (age < hi)] = label
    return out


def load_panel(db_path, spec: dict | None = None, complete_only: bool = True) -> tuple[pd.DataFrame, np.ndarray]:
    """Renvoie (meta, X) : meta = une ligne par snapshot (clés, étiquette, attributs d'audit), X dans l'ordre de features.json."""
    spec = spec or load_spec()
    names = feature_names(spec)
    con = connect_ro(db_path)
    try:
        sql = """
            SELECT l.employee_id, l.as_of, l.y6, l.followup_complete, fs.values_json, fs.partial_history,
                   e.matricule, e.sex, e.birth_date
              FROM v_label_panel l
              JOIN feature_snapshot fs ON fs.employee_id = l.employee_id AND fs.as_of = l.as_of AND fs.fsv = l.fsv
              JOIN employee e ON e.id = l.employee_id
             WHERE l.fsv = ? {where}
             ORDER BY l.as_of, l.employee_id"""
        meta = pd.read_sql_query(sql.format(where="AND l.followup_complete = 1" if complete_only else ""), con, params=(spec["fsv"],))
    finally:
        con.close()
    if meta.duplicated(["employee_id", "as_of"]).any():
        raise ValueError("v_label_panel contient des doublons (employee_id, as_of)")
    X = np.array([json.loads(v) for v in meta["values_json"]], dtype=float)
    if X.shape[1] != len(names):
        raise ValueError(f"{X.shape[1]} variables dans feature_snapshot, {len(names)} dans features.json")
    meta["month"] = month_index(meta["as_of"])
    birth = pd.to_datetime(meta["birth_date"], errors="coerce")
    meta["age"] = ((pd.to_datetime(meta["as_of"]) - birth).dt.days / 365.25).to_numpy()
    meta["age_band"] = age_band(meta["age"].fillna(-1).to_numpy())
    meta["sex"] = meta["sex"].fillna("inconnu")
    meta["y6"] = meta["y6"].astype(int)
    return meta.reset_index(drop=True), X


def load_settings(db_path) -> dict:
    con = connect_ro(db_path)
    try:
        return {
            "capacity_rate": float(setting(con, "capacity_rate", "0.02")),
            "medium_lift": float(setting(con, "medium_lift", "2")),
            "data_end_date": setting(con, "data_end_date"),
        }
    finally:
        con.close()


def load_feature_csv(path, names: list[str]) -> pd.DataFrame:
    """Panel exporté par scripts/export-panel.ts (employee_id;as_of;partial_history;variables...)."""
    df = pd.read_csv(path, sep=";")
    missing = [n for n in names if n not in df.columns]
    if missing:
        raise ValueError(f"variables absentes de {path} : {missing}")
    return df[["employee_id", "as_of"] + names]


def align_features(meta: pd.DataFrame, other: pd.DataFrame, names: list[str]) -> np.ndarray:
    """X de `other` réordonné sur les lignes de meta ; erreur si une ligne manque."""
    m = meta[["employee_id", "as_of"]].merge(other, on=["employee_id", "as_of"], how="left", validate="one_to_one")
    if m[names].isna().any().any():
        raise ValueError("lignes du panel absentes de l'export")
    return m[names].to_numpy(dtype=float)


def load_oracle(sim_dir) -> pd.DataFrame | None:
    f = Path(sim_dir) / "ground_truth" / "oracle_prob6.csv"
    if not f.exists():
        return None
    o = pd.read_csv(f, sep=";", dtype={"matricule": str, "as_of": str})
    return o.rename(columns={"prob6": "oracle", "y6": "oracle_y6"})[["matricule", "as_of", "oracle", "oracle_y6"]]


def data_hash(meta: pd.DataFrame) -> str:
    h = hashlib.sha256()
    for eid, as_of, v, y in meta[["employee_id", "as_of", "values_json", "y6"]].itertuples(index=False):
        h.update(f"{eid};{as_of};{v};{y}\n".encode())
    return h.hexdigest()

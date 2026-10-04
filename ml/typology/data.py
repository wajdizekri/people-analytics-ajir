"""Départs volontaires et variables à la veille du départ, lecture seule (requête partagée avec TypeScript)."""
import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
QUERIES_JSON = ROOT / "src" / "lib" / "ai" / "typology" / "queries.json"
FEATURES_JSON = ROOT / "shared" / "features.json"
AGE_BANDS = [(0, 30, "< 30 ans"), (30, 45, "30-44 ans"), (45, 200, "45 ans et plus")]


def load_spec(path=FEATURES_JSON) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def departures_sql() -> str:
    return "\n".join(json.loads(QUERIES_JSON.read_text(encoding="utf-8"))["departures"])


def connect_ro(db_path) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)


def setting(con: sqlite3.Connection, key: str, default=None):
    row = con.execute("SELECT value FROM app_setting WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def load_departures(db_path, spec: dict | None = None) -> tuple[pd.DataFrame, np.ndarray, dict]:
    """(meta, X, info) : meta = un départ classable par ligne (opposés exclus), X = valeurs de feature_snapshot dans
    l'ordre de features.json ; info = effectifs (départs visibles, non classés, opposés) et référence."""
    spec = spec or load_spec()
    con = connect_ro(db_path)
    try:
        ref = setting(con, "data_end_date")
        if not ref:
            raise ValueError("app_setting.data_end_date absent : importer un export AJIR avant l'entraînement")
        cur = con.execute(departures_sql(), {"ref": ref, "fsv": spec["fsv"]})
        cols = [c[0] for c in cur.description]
        df = pd.DataFrame(cur.fetchall(), columns=cols)
        opposed = {r[0] for r in con.execute("SELECT employee_id FROM employee_opposition").fetchall()}
        # Attributs d'audit d'équité seulement (ADR-009) : jamais transmis au regroupement ni au bundle
        audit = pd.read_sql_query("SELECT id AS employeeId, matricule, sex, birth_date FROM employee", con)
    finally:
        con.close()
    total = len(df)
    is_opposed = df["employeeId"].isin(opposed)
    meta = df[df["valuesJson"].notna() & ~is_opposed].copy()
    X = np.array([json.loads(v) for v in meta["valuesJson"]], dtype=float) if len(meta) else np.zeros((0, len(spec["features"])))
    if X.shape[1] != len(spec["features"]):
        raise ValueError(f"{X.shape[1]} variables dans feature_snapshot, {len(spec['features'])} dans features.json")
    meta = meta.merge(audit, on="employeeId", how="left", validate="many_to_one").reset_index(drop=True)
    birth = pd.to_datetime(meta["birth_date"], errors="coerce")
    age = ((pd.to_datetime(meta["asOf"]) - birth).dt.days / 365.25).to_numpy()
    meta["age_band"] = "inconnu"
    for lo, hi, label in AGE_BANDS:
        meta.loc[(age >= lo) & (age < hi), "age_band"] = label
    meta["sex"] = meta["sex"].fillna("inconnu")
    meta["jobFamily"] = meta["jobFamily"].fillna("Non renseignée")
    info = {"ref": ref, "fsv": spec["fsv"], "departures": int(total), "classified": int(len(meta)),
            # non classés = sans variables à la veille du départ ou opposés (même définition que l'écran)
            "opposed": int(is_opposed.sum()), "unclassified": int(total - len(meta)),
            "first_exit": None if meta.empty else str(meta["exitDate"].min()),
            "last_exit": None if meta.empty else str(meta["exitDate"].max())}
    return meta, X, info


def data_hash(meta: pd.DataFrame) -> str:
    h = hashlib.sha256()
    for exit_id, as_of, v in meta[["exitId", "asOf", "valuesJson"]].itertuples(index=False):
        h.update(f"{exit_id};{as_of};{v}\n".encode())
    return h.hexdigest()

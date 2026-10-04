"""Bundle models/workload/<version>/ : model.json (ridge par portée x horizon, intervalles, paramètres des règles) + golden.json."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .evaluate import fit_select
from .features import FEATURES, FTE_MIN, HORIZONS, MIN_MEMBERS, MIN_VALID_12, S_FLOOR
from .model import LEVEL, bundle_predict


def _f(v):
    return [float(x) for x in np.asarray(v).ravel()]


def train_final(samples: dict, n_obs: int):
    models, s_default = {}, {}
    for scope, rows in samples.items():
        obs = [r for r in rows if not math.isnan(r["y"])]
        s_default[scope] = float(np.median([r["s"] for r in obs if r["s"] is not None]))
        models[scope] = {}
        for h in HORIZONS:
            train = [r for r in obs if r["h"] == h]
            m, alpha, q = fit_select(train, None, s_default[scope], n_obs - 1 - 12)
            models[scope][str(h)] = {
                "alpha": alpha, "q": q, "mean": _f(m.mean), "std": _f(m.std), "coef": _f(m.coef), "intercept": float(m.intercept),
                "train_rows": len(train),
            }
    return models, s_default


def build(version, models, s_default, tension_h, rule, data_hash, train_from, train_to, metrics):
    return {
        "version": version,
        "kind": "RIDGE_LOG",
        "topic": "CHARGE_TRAVAIL",
        "target": "z[T] - zbar12, z = log(1 + heures sup par ETP), T = origine + h",
        "unit": "heures supplémentaires par ETP et par mois",
        "features": FEATURES,
        "horizons": list(HORIZONS),
        "group": {"min_members": MIN_MEMBERS, "min_valid_months": MIN_VALID_12, "fte_min": FTE_MIN, "s_floor": S_FLOOR, "std_month_days": 21.67},
        "interval": {"level": LEVEL, "method": "conforme normalisé (|résidu| / échelle de bruit du groupe)", "s_default": s_default},
        "models": models,
        "tension": {"threshold_h": tension_h, "rule": "prévision >= seuil (quantile 85 % des heures sup par ETP des équipes, apprentissage)"},
        "rule": rule,
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_hash": f"sha256:{data_hash}",
        "train_from": train_from,
        "train_to": train_to,
        "metrics": metrics,
    }


def golden_rows(bundle, samples, n=200, seed=5):
    rng = np.random.default_rng(seed)
    out = []
    for scope, rows in samples.items():
        k = n // 2 if scope == "EQUIPE" else n - n // 2
        pick = rng.choice(len(rows), min(k, len(rows)), replace=False)
        for i in sorted(pick):
            r = rows[int(i)]
            m = bundle["models"][scope][str(r["h"])]
            s = r["s"] if r["s"] is not None else bundle["interval"]["s_default"][scope]
            v, lo, hi = bundle_predict(m, r["x"], r["zbar12"], s)
            out.append({"scope": scope, "h": r["h"], "x": [float(t) for t in r["x"]], "zbar12": r["zbar12"], "s": r["s"], "value": v, "lower": lo, "upper": hi})
    return out


def features_block(rows_last, as_of):
    return {
        "as_of": as_of,
        "groups": [
            {"scope": r["scope"], "key": r["key"], "h": r["h"], "n": r["n"], "x": [float(t) for t in r["x"]], "zbar12": r["zbar12"], "s": r["s"], "I12": r["I12"]}
            for r in rows_last
        ],
    }


def write(out_dir, bundle, gold):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "model.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "golden.json").write_text(json.dumps(gold, separators=(",", ":")) + "\n", encoding="utf-8")
    return out

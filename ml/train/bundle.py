"""Bundle de production LOGREG au format de docs/CONVENTIONS.md (model.json + golden.json)."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .models import Logreg


def bundle_predict(bundle: dict, x) -> float:
    """Même suite d'opérations que predictRaw (src/lib/scoring/model.ts)."""
    mean, std = bundle["standardization"]["mean"], bundle["standardization"]["std"]
    z = [(float(v) - mean[j]) / (1.0 if std[j] == 0 else std[j]) for j, v in enumerate(x)]
    logit = bundle["intercept"]
    for j, zj in enumerate(z):
        logit += bundle["coef"][j] * zj
    cal = bundle.get("calibration") or {}
    s = cal.get("a", 1.0) * logit + cal.get("b", 0.0)
    if s >= 0:
        return 1 / (1 + math.exp(-s))
    e = math.exp(s)
    return e / (1 + e)


def _floats(v):
    return [float(x) for x in np.asarray(v).ravel()]


def build_bundle(model: Logreg, names: list[str], fsv: str, version: str, *, base_rate: float, data_hash: str,
                 train_rows: int, train_from: str, train_to: str, metrics: dict, extra: dict | None = None) -> dict:
    return {
        "version": version,
        "kind": "LOGREG",
        "fsv": fsv,
        "features": list(names),
        "standardization": {"mean": _floats(model.mean), "std": _floats(model.std)},
        "coef": _floats(model.coef),
        "intercept": float(model.intercept),
        "calibration": {"method": "platt", "a": float(model.a), "b": float(model.b)},
        "base_rate": float(base_rate),
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_hash": f"sha256:{data_hash}",
        "train_rows": int(train_rows),
        "train_from": train_from,
        "train_to": train_to,
        **(extra or {}),
        "metrics": metrics,
    }


def golden(bundle: dict, X: np.ndarray) -> list[dict]:
    return [{"x": [float(v) for v in row], "p": bundle_predict(bundle, row)} for row in X]


def pick_golden_rows(X: np.ndarray, p: np.ndarray, n: int = 200, seed: int = 3) -> np.ndarray:
    """150 lignes au hasard + les 50 estimations les plus hautes (zone ÉLEVÉ)."""
    rng = np.random.default_rng(seed)
    top = np.argsort(-p)[: n // 4]
    rest = np.setdiff1d(np.arange(len(X)), top)
    idx = np.concatenate([rng.choice(rest, n - len(top), replace=False), top])
    return np.sort(idx)


def write_bundle(out_dir, bundle: dict, gold: list[dict]) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "model.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "golden.json").write_text(json.dumps(gold, separators=(",", ":")) + "\n", encoding="utf-8")
    return out

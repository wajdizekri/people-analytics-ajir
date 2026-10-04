import json

import numpy as np
import pytest

from train import bundle as BU
from train import data as D
from train import models as MD

SPEC = D.load_spec()
NAMES = D.feature_names(SPEC)
KEYS = {"version", "kind", "fsv", "features", "standardization", "coef", "intercept", "calibration", "base_rate", "trained_at",
        "data_hash", "train_rows", "train_from", "train_to", "metrics"}


@pytest.fixture
def model():
    rng = np.random.default_rng(8)
    X = rng.normal(5, 2, size=(4000, len(NAMES)))
    X[:, 3] = 1.0
    y = (rng.random(len(X)) < MD.sigmoid(X[:, 0] - 8)).astype(int)
    m = MD.fit_logreg(X, y, 0.1)
    m.a, m.b = 0.8, -0.4
    return m, X


def test_bundle_format_and_formula(model):
    m, X = model
    b = BU.build_bundle(m, NAMES, SPEC["fsv"], "logreg-v1-test", base_rate=0.04, data_hash="0" * 64, train_rows=len(X),
                        train_from="2020-09-30", train_to="2026-02-28", metrics={"auc": 0.6})
    assert KEYS <= set(b) and b["kind"] == "LOGREG" and b["features"] == NAMES
    assert b["calibration"] == {"method": "platt", "a": 0.8, "b": -0.4}
    assert len(b["coef"]) == len(b["standardization"]["mean"]) == len(b["standardization"]["std"]) == len(NAMES)
    json.dumps(b, allow_nan=False)
    gold = BU.golden(b, X[:200])
    assert np.max(np.abs(np.array([g["p"] for g in gold]) - m.proba(X[:200]))) < 1e-12
    assert all(len(g["x"]) == len(NAMES) for g in gold)


def test_golden_rows_include_top_scores():
    p = np.linspace(0, 1, 1000)
    idx = BU.pick_golden_rows(np.zeros((1000, 2)), p)
    assert len(idx) == len(set(idx)) == 200 and set(range(950, 1000)) <= set(idx)


BUNDLES = sorted((D.ROOT / "models" / "turnover").glob("logreg-v1-*/model.json"))


@pytest.mark.skipif(not BUNDLES, reason="aucun bundle LOGREG exporté")
@pytest.mark.parametrize("path", BUNDLES, ids=lambda p: p.parent.name)
def test_exported_bundle_reproduces_its_golden(path):
    b = json.loads(path.read_text(encoding="utf-8"))
    gold = json.loads((path.parent / "golden.json").read_text(encoding="utf-8"))
    assert KEYS <= set(b) and b["features"] == NAMES and b["fsv"] == SPEC["fsv"] and len(gold) == 200
    assert max(abs(BU.bundle_predict(b, g["x"]) - g["p"]) for g in gold) <= 1e-12
    assert b["calibration"]["a"] > 0 and 0 < b["base_rate"] < 1
    assert b["train_from"] <= b["train_to"] and len(b["train_to"]) == 10

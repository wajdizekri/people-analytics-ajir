import json

import numpy as np
import pytest

from train import data as D
from train import models as MD

SPEC = D.load_spec()
NAMES = D.feature_names(SPEC)


def test_b0_reproduces_the_b0_golden():
    gold = json.loads((D.ROOT / "models" / "turnover" / "b0-v1" / "golden.json").read_text(encoding="utf-8"))
    X = np.array([g["x"] for g in gold])
    assert np.array_equal(MD.b0_points(X, NAMES, SPEC["b0_rules"]), np.array([g["p"] for g in gold]))


def test_platt_recovers_known_parameters():
    rng = np.random.default_rng(4)
    s = rng.normal(0, 2, 100_000)
    y = (rng.random(len(s)) < MD.sigmoid(0.7 * s - 3)).astype(float)
    a, b = MD.platt_fit(s, y)
    assert a == pytest.approx(0.7, abs=0.03) and b == pytest.approx(-3, abs=0.06)


def test_logreg_handles_constant_column_and_formula():
    rng = np.random.default_rng(5)
    X = rng.normal(size=(3000, 4))
    X[:, 2] = 7.0
    y = (rng.random(3000) < MD.sigmoid(X[:, 0] - 2)).astype(int)
    m = MD.fit_logreg(X, y, 1.0)
    m.a, m.b = 0.9, -1.2
    assert m.std[2] == 0 and np.isfinite(m.logit(X)).all()
    z = (X - m.mean) / np.where(m.std == 0, 1, m.std)
    assert np.allclose(m.proba(X), 1 / (1 + np.exp(-(0.9 * (m.intercept + z @ m.coef) - 1.2))), atol=1e-14)
    assert m.coef[0] > 0


def test_weighting_shifts_intercept_not_ranking():
    rng = np.random.default_rng(6)
    X = rng.normal(size=(20_000, 3))
    y = (rng.random(len(X)) < MD.sigmoid(X @ [0.8, -0.5, 0] - 3)).astype(int)
    w = MD.fit_logreg(X, y, 1.0, "balanced")
    u = MD.fit_logreg(X, y, 1.0, None)
    assert w.intercept > u.intercept + 2
    assert np.corrcoef(w.logit(X), u.logit(X))[0, 1] > 0.99

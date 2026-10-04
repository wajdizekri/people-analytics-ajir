import numpy as np
import pytest
from sklearn.metrics import average_precision_score, roc_auc_score

from train import metrics as M


@pytest.fixture
def data():
    rng = np.random.default_rng(0)
    y = (rng.random(2000) < 0.1).astype(float)
    s = np.round(rng.normal(size=2000) + y, 1)
    return y, s


def test_auc_matches_sklearn_with_ties(data):
    y, s = data
    assert M.auc(y, s) == pytest.approx(roc_auc_score(y, s), abs=1e-12)


def test_average_precision_matches_sklearn_with_ties(data):
    y, s = data
    assert M.average_precision(y, s) == pytest.approx(average_precision_score(y, s), abs=1e-12)


def test_integer_weights_equal_duplication(data):
    y, s = data
    w = np.random.default_rng(1).integers(0, 4, len(y)).astype(float)
    rep = np.repeat(np.arange(len(y)), w.astype(int))
    assert M.auc(y, s, w) == pytest.approx(roc_auc_score(y[rep], s[rep]), abs=1e-12)
    assert M.average_precision(y, s, w) == pytest.approx(average_precision_score(y[rep], s[rep]), abs=1e-12)
    assert M.brier(y, s, w) == pytest.approx(np.mean((s[rep] - y[rep]) ** 2))


def test_calibration_of_a_calibrated_score():
    rng = np.random.default_rng(2)
    p = 1 / (1 + np.exp(-rng.normal(-3, 1, 200_000)))
    y = (rng.random(len(p)) < p).astype(float)
    slope, intercept = M.calibration_slope(y, p)
    assert slope == pytest.approx(1, abs=0.05)
    assert intercept == pytest.approx(0, abs=0.1)
    assert M.oe_ratio(y, p) == pytest.approx(1, abs=0.03)


def test_capacity_rule_like_rank_and_level():
    assert M.js_round(2.5) == 3 and M.js_round(1.49) == 1
    s = np.array([9, 8, 8, 7, 5, 5, 5, 4, 3, 2] + [1] * 90, dtype=float)
    month = np.zeros(100, dtype=int)
    assert np.flatnonzero(M.capacity_flags(s, month, 0.02)).tolist() == [0]
    assert np.flatnonzero(M.capacity_flags(s, month, 0.03)).tolist() == [0, 1, 2]
    zeros = np.zeros(100)
    assert not M.capacity_flags(zeros, month, 0.02, positive_only=True).any()
    two = np.concatenate([s, s])
    flags = M.capacity_flags(two, np.repeat([0, 1], 100), 0.03)
    assert flags.sum() == 6


def test_at_capacity_and_lift():
    y = np.array([1, 0, 1, 0, 0, 0, 0, 0, 0, 0], dtype=float)
    flags = np.array([1, 1, 0, 0, 0, 0, 0, 0, 0, 0], dtype=bool)
    r = M.at_capacity(y, flags)
    assert r["precision_at_k"] == 0.5 and r["recall_at_k"] == 0.5 and r["lift_at_k"] == pytest.approx(2.5)


def test_grouped_bootstrap_keeps_employees_together():
    groups = np.array([1, 1, 1, 2, 2, 3])
    for w in M.bootstrap_weights(groups, 20, seed=3):
        assert w[0] == w[1] == w[2] and w[3] == w[4]
        assert (w[[0, 3, 5]]).sum() == 3


def test_net_benefit_treat_all():
    y = np.array([1, 0, 0, 0], dtype=float)
    p = np.array([0.9, 0.1, 0.1, 0.1])
    nb = M.net_benefit(y, p, [0.5])[0]
    assert nb["net_benefit"] == pytest.approx(0.25)
    assert nb["treat_all"] == pytest.approx(0.25 - 0.75)

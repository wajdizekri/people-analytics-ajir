import numpy as np
import pytest

from ml.absenteeism.conformal import band, signed_interval


def test_rangs_exacts_et_zero_inclus():
    z = [k - 12.5 for k in range(1, 25)]  # n = 24 : m = 20, i = 2, j = 22
    assert signed_interval(z) == (z[1], z[21])
    assert signed_interval([1.0 + k for k in range(24)]) == (0.0, 22.0)  # bas ramené à 0
    assert signed_interval(list(range(8))) is None  # n < 9 : bornes infinies


def test_couverture_sur_donnees_synthetiques():
    rng = np.random.default_rng(1)
    hits = []
    for _ in range(3000):
        cal = rng.exponential(1.0, 24) - 1.0  # asymétrique
        lo, hi = signed_interval(cal)
        hits.append(lo <= rng.exponential(1.0) - 1.0 <= hi)
    assert np.mean(hits) >= 0.78  # garantie (j - i) / (n + 1) = 0,8


def test_borne_basse_jamais_negative():
    lo, hi = band(0.001, 0.01, [-1.0, 2.0])
    assert lo == 0.0 and hi == pytest.approx(0.021)

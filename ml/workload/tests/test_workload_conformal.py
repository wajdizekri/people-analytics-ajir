import math

import numpy as np

from workload.conformal import predict_conformal, signed_interval
from workload.model import bundle_predict


def test_quantiles_symetriques_redonnent_la_v1():
    m = {"intercept": 0.1, "coef": [0.2, -0.1], "mean": [1.0, 2.0], "std": [0.5, 1.0], "q": 1.3}
    x, zbar12, s = [1.4, 1.0], 2.0, 0.2
    assert predict_conformal(m, [-1.3, 1.3], x, zbar12, s) == bundle_predict(m, x, zbar12, s)


def test_quantiles_asymetriques_sur_l_echelle_log():
    m = {"intercept": 0.0, "coef": [0.0], "mean": [0.0], "std": [1.0]}
    v, lo, hi = predict_conformal(m, [-0.5, 1.0], [0.0], math.log1p(10.0), 0.1)
    assert abs(v - 10.0) < 1e-12 and lo < v < hi
    assert abs(math.log1p(hi) - math.log1p(v) - 2 * (math.log1p(v) - math.log1p(lo))) < 1e-12


def test_couverture_sur_donnees_synthetiques():
    rng = np.random.default_rng(2)
    hits = []
    for _ in range(3000):
        lo, hi = signed_interval(rng.standard_t(4, 96))
        hits.append(lo <= rng.standard_t(4) <= hi)
    assert np.mean(hits) >= 0.78
    assert signed_interval([0.3] * 8) is None

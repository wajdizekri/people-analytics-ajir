import numpy as np

from ml.absenteeism import model as M
from ml.absenteeism import series as S


def _data(alloc, den):
    d = S.Data(months=list(range(S.mi("2025-01"), S.mi("2025-12") + 1)), cal=None, emp={}, dept_hist={}, mgr_hist={},
               dept_names={}, emp_names={})
    d.alloc = alloc
    d.den = den
    return d


def test_visibilite_as_of():
    o = S.mi("2025-06")
    cutoff = S.m_end(o) + S.LAG_DAYS
    d = _data([("E", o, cutoff, 1.0), ("E", o, cutoff + 1, 5.0), ("E", o + 1, cutoff, 7.0), ("E", o - 12, cutoff, 9.0)], {})
    assert S.visible_num(d, o) == {("E", o): 1.0}


def test_variables_sans_futur_et_replis():
    num = [0.0] * 12
    den = [100.0] * 12
    num[11], num[0] = 2.0, 1.0
    cal = {"wd": 21, "ram": 0.5, "bridge": 1, "hol": 1, "su": 0.0}
    cal12 = {"wd": 22, "ram": 0.0, "bridge": 0, "hol": 0, "su": 0.0}
    x = M.features(1, "EQUIPE", (num, den), (num, den), (num, den), cal, cal12)
    f = dict(zip(M.FEATURES, x))
    assert f["r_last"] == 0.02 and f["seasonal"] == 0.01
    assert abs(f["ma12"] - 3 / 1200) < 1e-15 and f["ramadan_delta12"] == 0.5 and f["is_team"] == 1.0
    den2 = den[:]
    den2[1] = 0.0
    x2 = M.features(2, "DEPARTEMENT", (num, den2), (num, den), (num, den), cal, cal12)
    assert dict(zip(M.FEATURES, x2))["seasonal"] == dict(zip(M.FEATURES, x2))["ma12"]


def test_ridge_equations_normales():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(300, len(M.FEATURES)))
    y = X @ rng.normal(size=len(M.FEATURES)) * 0.01 + 0.5
    r = M.fit_ridge(X, y, alpha=0.0, offset="none")
    pred = M.predict(r, X)
    assert np.max(np.abs(pred - np.maximum(y, 0))) < 1e-8

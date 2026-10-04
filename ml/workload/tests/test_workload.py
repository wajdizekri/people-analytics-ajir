import math

import numpy as np

from workload import evaluate as EV
from workload.data import Calendar, Panel
from workload.features import FEATURES, origin_rows
from workload.model import Ridge, bundle_predict, conformal_q
from workload.rule import streaks


def _panel(E=12, M=30, ot_h=10.0):
    ot = np.full((E, M), ot_h * 60.0)
    days = np.full((E, M), 20.0)
    act = np.ones((E, M), dtype=bool)
    mgr = np.full((E, M), 100, dtype=np.int64)
    mgr[:, :] = np.where(np.arange(E)[:, None] < 6, 100, 200)
    dept = np.full((E, M), 1, dtype=np.int64)
    cal = Calendar(wd={i: 20.0 for i in range(24000, 24100)}, ram={i: 0.0 for i in range(24000, 24100)},
                   su={i: 0.0 for i in range(24000, 24100)}, br={i: 0.0 for i in range(24000, 24100)})
    return Panel(24000, M, np.arange(E), ot, days, act, mgr, dept, np.full(E, -10), [None] * E, cal, "x")


def test_features_and_target_on_constant_panel():
    P = _panel()
    rows = origin_rows(P, 20, "EQUIPE")
    assert {r["key"] for r in rows} == {100, 200}
    r = rows[0]
    assert len(r["x"]) == len(FEATURES)
    assert math.isclose(r["zbar12"], math.log1p(10.0))
    assert abs(r["x"][0]) < 1e-12 and abs(r["x"][1]) < 1e-12 and abs(r["y"]) < 1e-12
    assert r["n"] == 6 and r["x"][FEATURES.index("unfilled_exits_3m")] == 0.0


def test_small_team_excluded_and_departures_counted():
    P = _panel()
    P.act[:4, 19:] = False  # 4 départs de l'équipe 100 entre O-3 et O
    P.mgr[:4, 19:] = -1
    P.dept[:4, 19:] = -1
    rows = origin_rows(P, 20, "EQUIPE")
    assert {r["key"] for r in rows} == {200}
    rows = origin_rows(P, 20, "DEPARTEMENT")
    assert math.isclose(rows[0]["x"][FEATURES.index("unfilled_exits_3m")], 4 / 12)


def test_rolling_uses_only_known_targets():
    rng = np.random.default_rng(0)
    rows = []
    for O in range(10, 40):
        for h in (1, 2, 3):
            x = rng.normal(size=len(FEATURES)).tolist()
            rows.append({"key": O % 5, "O": O, "h": h, "T": O + h, "n": 6, "x": x, "zbar12": 2.0, "s": 0.2, "I12": 6.0,
                         "y": 0.1 * x[0], "I_T": math.expm1(2.0 + 0.1 * x[0]), "I_last": 6.0, "I_ma3": 6.0, "I_seas": 6.0})
    seen = []
    orig = EV.fit_select

    def spy(train, cols, s_default, cut, X=None):
        seen.append((max(r["T"] for r in train), cut))
        return orig(train, cols, s_default, cut, X)

    EV.fit_select = spy
    try:
        out = EV.rolling(rows, [30, 35])
    finally:
        EV.fit_select = orig
    assert out and all(t <= cut + 12 for t, cut in seen)
    s = EV.summarize(out)["all"]
    assert s["mae"]["RIDGE"] < s["mae"]["MOYENNE_MOBILE_3"]


def test_conformal_quantile_and_bundle_predict_match_ridge():
    r = np.arange(1, 11, dtype=float)
    assert conformal_q(r, 0.8) == 9.0
    rng = np.random.default_rng(1)
    X = rng.normal(size=(200, 4))
    y = X @ np.array([0.5, -0.2, 0.0, 0.1]) + rng.normal(scale=0.1, size=200)
    m = Ridge(1.0).fit(X, y)
    b = {"intercept": m.intercept, "coef": m.coef.tolist(), "mean": m.mean.tolist(), "std": m.std.tolist(), "q": 1.5}
    v, lo, hi = bundle_predict(b, X[0], 2.0, 0.1)
    assert math.isclose(v, math.expm1(2.0 + m.predict(X[:1])[0]), rel_tol=1e-12)
    assert lo <= v <= hi


def test_streaks_break_on_missing_month():
    P = _panel(E=1, M=6, ot_h=25.0)
    P.days[0, 2] = 0
    P.ot_min[0, 2] = 0
    assert streaks(P, 20.0)[0].tolist() == [1, 2, 0, 1, 2, 3]

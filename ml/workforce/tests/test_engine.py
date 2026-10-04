import math

from ml.workforce.engine import CAUSES, project
from ml.workforce.fit import baseline, conformal_q, monotone

H = 12
FLAT = {"dept": [1.0] * H, "total": [2.0] * H}
BE = {"horizon": H, "prob6_months": 6, "interval": {"level": 0.8, "TAUX": FLAT}}
BM = {"season": [0.0] * 12, "interval": {"level": 0.8, "TAUX": {"dept": [0.1] * H, "total": [0.1] * H}}}


def state(members, month0="2026-08", **dept):
    d = {"id": 1, "code": "D", "name": "D", "hc0": len(members), "mass0": 1.0, "resignRate": 0.01, "otherRate": 0.002,
         "hiresPerMonth": 1.5, "hireSalary": 1000.0, "avgBase": 1000.0, "level": 0.0, **dept}
    return {"asOf": "", "month0": month0, "resignSource": "TAUX", "qCdd": 0.2, "qRet": 1.0, "raise": 0.05, "drift": 0.0,
            "levelTotal": 0.0, "departments": [d], "members": members}


def member(**kw):
    return {"d": 0, "base": 1000.0, "p6": None, "cdd": None, "ret": None, "known": None, "grade": "G1", **kw}


def test_flux_conserves():
    st = state([member(cdd=3), member(ret=5), member(known=2), member()])
    out = project(BE, BM, st, {"hiringPct": 100})
    t = out["total"]
    for k in range(H):
        exits = sum(sum(t["exits"][c][: k + 1]) for c in CAUSES)
        assert math.isclose(t["hc0"] + sum(t["hires"][: k + 1]) - exits, t["hc"][k], abs_tol=1e-9)
    assert math.isclose(t["exits"]["known"][1], 1.0)
    assert t["exits"]["retire"][4] > 0.9


def test_hausse_de_janvier_et_gel_des_embauches():
    st = state([member()], month0="2026-12", resignRate=0.0, otherRate=0.0)
    out = project(BE, BM, st, {"hiringPct": 0})
    assert out["total"]["hc"] == [1.0] * H
    assert math.isclose(out["total"]["mass"][0], 1000.0 * 1.05)
    assert math.isclose(out["total"]["mass"][11], 1000.0 * 1.05)


def test_conformal_et_baselines():
    assert conformal_q([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.8) == 8
    assert monotone([1.0, 0.5, 2.0]) == [1.0, 1.0, 2.0]
    s = {f"2025-{m:02d}": float(m) for m in range(1, 13)}
    assert baseline(s, "2025-12", 1, "naive") == 12.0
    assert math.isclose(baseline(s, "2025-12", 2, "trend"), 14.0)

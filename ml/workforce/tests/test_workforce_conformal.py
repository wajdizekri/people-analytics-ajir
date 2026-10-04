from ml.workforce.conformal import signed_interval, widen
from ml.workforce.engine import project

H = 12
BE = {"horizon": H, "prob6_months": 6, "interval": {"level": 0.8, "TAUX": {"dept": [1.2] * H, "total": [1.8] * H}}}
BM = {"season": [0.0] * 12, "interval": {"level": 0.8, "TAUX": {"dept": [0.03] * H, "total": [0.02] * H}}}


def _state(source="TAUX"):
    d = {"id": 1, "code": "D", "name": "D", "hc0": 3, "mass0": 3000.0, "resignRate": 0.01, "otherRate": 0.002,
         "hiresPerMonth": 1.0, "hireSalary": 1000.0, "avgBase": 1000.0, "level": 0.0}
    members = [{"d": 0, "base": 1000.0, "p6": 0.1 if source == "LOGREG" else None, "cdd": None, "ret": None, "known": None, "grade": "G1"}] * 3
    return {"asOf": "2026-08-31", "month0": "2026-08", "resignSource": source, "qCdd": 0.2, "qRet": 1.0, "raise": 0.05,
            "drift": 0.0, "levelTotal": 0.0, "departments": [d], "members": members}


def _with(bundle, quantiles):
    return {**bundle, "conformal": {"level": 0.8, "quantiles": quantiles}}


def test_quantiles_symetriques_redonnent_la_v1():
    sym = lambda q: {"TAUX": {"dept": [[-q[0], q[0]]] * H, "total": [[-q[1], q[1]]] * H}}  # noqa: E731
    a = project(BE, BM, _state(), {"hiringPct": 100.0})
    b = project(_with(BE, sym((1.2, 1.8))), _with(BM, sym((0.03, 0.02))), _state(), {"hiringPct": 100.0})
    for k in ("hcLower", "hcUpper", "massLower", "massUpper"):
        assert a["total"][k] == b["total"][k]
        assert a["departments"][0][k] == b["departments"][0][k]


def test_bornes_asymetriques_et_repli_sur_taux():
    q = {"TAUX": {"dept": [[-1.0, 2.0]] * H, "total": [[-0.5, 3.0]] * H}}
    out = project(_with(BE, q), BM, _state("LOGREG"), {"hiringPct": 100.0})
    t = out["total"]
    for i in range(H):
        assert abs(t["hcLower"][i] - max(0.0, t["hc"][i] - 0.5 * t["hcSd"][i])) < 1e-12
        assert abs(t["hcUpper"][i] - (t["hc"][i] + 3.0 * t["hcSd"][i])) < 1e-12


def test_quantiles_croissants_avec_l_horizon():
    assert widen([(-1.0, 1.0), (-0.5, 2.0), (-2.0, 1.5)]) == [[-1.0, 1.0], [-1.0, 2.0], [-2.0, 2.0]]
    assert signed_interval([float(k) for k in range(-12, 12)]) == (-11.0, 9.0)

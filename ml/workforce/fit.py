"""Estimation hors ligne : saisonnalité de la masse (régression), baselines, métriques et intervalles conformes."""
import math

import numpy as np

from .engine import month_index, month_label


def season_regression(base: dict, agg: dict, upto: str) -> dict:
    """log(masse brute / masse de base des CDI-CDD) ~ effet département + effet mois de l'année (somme nulle), MCO."""
    keys = sorted(k for k in base if k[0] <= upto and k in agg and base[k] > 0 and agg[k] > 0)
    depts = sorted({k[1] for k in keys})
    di = {d: i for i, d in enumerate(depts)}
    n, nd = len(keys), len(depts)
    Xm = np.zeros((n, nd + 11))
    y = np.zeros(n)
    for r, (m, d) in enumerate(keys):
        Xm[r, di[d]] = 1.0
        moy = month_index(m) % 12
        if moy < 11:
            Xm[r, nd + moy] = 1.0
        else:
            Xm[r, nd:] = -1.0
        y[r] = math.log(agg[(m, d)]) - math.log(base[(m, d)])
    coef, *_ = np.linalg.lstsq(Xm, y, rcond=None)
    s = list(coef[nd:]) + [-float(np.sum(coef[nd:]))]
    resid = y - Xm @ coef
    r2 = 1.0 - float(resid @ resid) / float(((y - y.mean()) @ (y - y.mean()))) if n > 1 else float("nan")
    months = sorted({k[0] for k in keys})
    return {
        "season": [float(v) for v in s],
        "dept_effect": {str(d): float(coef[di[d]]) for d in depts},
        "rows": n, "months": [months[0], months[-1]] if months else None,
        "r2": r2, "resid_sd": float(resid.std(ddof=nd + 11)) if n > nd + 11 else float("nan"),
    }


def conformal_q(scores: list[float], level: float) -> float:
    s = sorted(x for x in scores if x == x)
    if not s:
        return float("nan")
    k = min(len(s) - 1, max(0, math.ceil((len(s) + 1) * level) - 1))
    return float(s[k])


def monotone(q: list[float]) -> list[float]:
    out, cur = [], 0.0
    for v in q:
        cur = max(cur, v)
        out.append(cur)
    return out


def baseline(series: dict, origin: str, h: int, kind: str) -> float | None:
    o = month_index(origin)
    get = lambda i: series.get(month_label(i))
    if kind == "naive":
        return get(o)
    if kind == "snaive":
        return get(o + h - 12)
    if kind == "snaive_growth":
        last = [get(o - j) for j in range(12)]
        prev = [get(o - 12 - j) for j in range(12)]
        ref = get(o + h - 12)
        if ref is None or any(v is None for v in last + prev) or sum(prev) == 0:
            return None
        return ref * sum(last) / sum(prev)
    if kind == "trend":
        pts = [(i, get(i)) for i in range(o - 23, o + 1) if get(i) is not None]
        if len(pts) < 6:
            return None
        t = np.array([p[0] for p in pts], dtype=float)
        v = np.array([p[1] for p in pts], dtype=float)
        b, a = np.polyfit(t - o, v, 1)
        return float(a + b * h)
    raise ValueError(kind)


def point_metrics(rows: list[dict]) -> dict:
    """rows : {y, yhat} ; MAE, MAPE (%), biais moyen (yhat - y)."""
    rows = [r for r in rows if r["yhat"] is not None and r["y"] is not None]
    if not rows:
        return {"n": 0}
    e = np.array([r["yhat"] - r["y"] for r in rows])
    y = np.array([r["y"] for r in rows])
    return {
        "n": len(rows),
        "mae": float(np.mean(np.abs(e))),
        "mape": float(np.mean(np.abs(e) / np.abs(y)) * 100) if np.all(y != 0) else float("nan"),
        "bias": float(np.mean(e)),
    }

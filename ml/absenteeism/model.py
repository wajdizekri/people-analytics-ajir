"""Variables, modèle ridge direct par horizon et intervalles par résidus empiriques normalisés.

Mêmes opérations que src/lib/ai/absenteeism/model.ts (parité 1e-9 via golden.json).
"""
import math
from dataclasses import dataclass

import numpy as np

from .series import MIN_GROUP, Data, m_end, visible_num

HORIZONS = (1, 2, 3)
FEATURES = [
    "r_last", "ma3", "ma12", "seasonal", "parent_ma12", "trend", "company_trend",
    "ramadan_share", "ramadan_delta12", "bridge_days", "holidays", "seance_unique_share", "workdays",
    "log_size", "is_team", "is_dept",
]
RATE_FLOOR = 0.002
SCOPES = {"E": "ENTREPRISE", "D": "DEPARTEMENT", "T": "EQUIPE"}


def _ratio(n, d):
    return n / d if d > 0 else None


def window_stats(num, den):
    """num, den : 12 mois [O-11 .. O]. Renvoie (ma12, ma3, r_last) avec replis ; None si aucun jour ouvré."""
    sd = sum(den)
    if sd <= 0:
        return None
    ma12 = sum(num) / sd
    d3 = den[9] + den[10] + den[11]
    ma3 = (num[9] + num[10] + num[11]) / d3 if d3 > 0 else ma12
    r = _ratio(num[11], den[11])
    return ma12, ma3, (r if r is not None else ma3)


def features(h, scope, own, parent, company, cal_t, cal_t12):
    """own/parent/company : (num[12], den[12]) ; cal_* : dict wd, ram, bridge, hol, su. Renvoie la liste FEATURES."""
    ma12, ma3, r_last = window_stats(*own)
    s = _ratio(own[0][h - 1], own[1][h - 1])
    seasonal = s if s is not None else ma12
    p = window_stats(*parent)
    parent_ma12 = p[0] if p is not None else ma12
    c = window_stats(*company)
    company_trend = (c[1] - c[0]) if c is not None else 0.0
    return [
        r_last, ma3, ma12, seasonal, parent_ma12, ma3 - ma12, company_trend,
        cal_t["ram"], cal_t["ram"] - cal_t12["ram"], float(cal_t["bridge"]), float(cal_t["hol"]), cal_t["su"], float(cal_t["wd"]),
        math.log(1.0 + sum(own[1]) / 12.0), 1.0 if scope == "EQUIPE" else 0.0, 1.0 if scope == "DEPARTEMENT" else 0.0,
    ]


def scale(pred, own_den):
    return math.sqrt(max(pred, RATE_FLOOR) / max(sum(own_den) / 12.0, 1.0))


@dataclass
class Example:
    unit: str
    scope: str
    origin: int
    h: int
    x: list
    y: float | None
    den_t: float
    own: tuple
    parent: tuple
    company: tuple
    cal_t: dict
    cal_t12: dict
    parent_unit: str


def parent_of(data: Data, unit: str, o: int):
    if unit == "E":
        return "E"
    if unit.startswith("D"):
        return "E"
    mgr = int(unit[1:])
    dep = data.dept_at(mgr, o) if mgr in data.emp else None
    return f"D{dep}" if dep is not None else "E"


def examples_at(data: Data, origin: int, horizons=HORIZONS, with_target=True, cal_cache=None, active=None):
    """Exemples (unité éligible x horizon) à l'origine : >= MIN_GROUP actifs en fin de mois d'origine, historique non vide."""
    vis = visible_num(data, origin)
    oe = m_end(origin)
    active = active if active is not None else data.active_at(oe)
    win = list(range(origin - 11, origin + 1))
    cal_cache = cal_cache if cal_cache is not None else {}

    def cal(i):
        if i not in cal_cache:
            cal_cache[i] = data.cal.month_features(i)
        return cal_cache[i]

    def series(u):
        return ([vis.get((u, i), 0.0) for i in win], [float(data.den.get((u, i), 0)) for i in win])

    company = series("E")
    out = []
    for u, n in sorted(active.items()):
        if n < MIN_GROUP:
            continue
        own = series(u)
        if sum(own[1]) <= 0 or own[1][11] <= 0:
            continue
        pu = parent_of(data, u, oe)
        parent = series(pu)
        scope = SCOPES[u[0]]
        for h in horizons:
            t = origin + h
            y, den_t = None, float(data.den.get((u, t), 0))
            if with_target:
                if t > data.months[-1] or den_t <= 0:
                    continue
                y = data.num_full.get((u, t), 0.0) / den_t
            x = features(h, scope, own, parent, company, cal(t), cal(t - 12))
            out.append(Example(u, scope, origin, h, x, y, den_t, own, parent, company, cal(t), cal(t - 12), pu))
    return out


@dataclass
class Ridge:
    mean: np.ndarray
    std: np.ndarray
    coef: np.ndarray
    intercept: float
    offset: str  # "ma12" ou "none"


def fit_ridge(X, y, alpha, offset="ma12", weights=None):
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    off = X[:, FEATURES.index("ma12")] if offset == "ma12" else np.zeros(len(y))
    t = y - off
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std == 0] = 1.0
    Z = (X - mean) / std
    w = np.ones(len(y)) if weights is None else np.asarray(weights, float)
    w = w / w.mean()
    zw = (Z * w[:, None]).sum(axis=0) / w.sum()
    tw = (t * w).sum() / w.sum()
    Zc, tc = Z - zw, t - tw
    A = (Zc * w[:, None]).T @ Zc + alpha * len(y) * np.eye(Z.shape[1])
    coef = np.linalg.solve(A, (Zc * w[:, None]).T @ tc)
    intercept = tw - zw @ coef
    return Ridge(mean, std, coef, float(intercept), offset)


def predict_one(m: dict, x) -> float:
    """Même suite d'opérations que predictRate (model.ts), à partir du bundle JSON d'un horizon."""
    s = m["intercept"]
    for j, v in enumerate(x):
        sd = m["std"][j]
        s += m["coef"][j] * ((float(v) - m["mean"][j]) / (1.0 if sd == 0 else sd))
    if m["offset"] == "ma12":
        s += float(x[FEATURES.index("ma12")])
    return s if s > 0 else 0.0


def ridge_dict(r: Ridge) -> dict:
    return {"mean": [float(v) for v in r.mean], "std": [float(v) for v in r.std], "coef": [float(v) for v in r.coef],
            "intercept": float(r.intercept), "offset": r.offset}


def predict(r: Ridge, X) -> np.ndarray:
    d = ridge_dict(r)
    return np.array([predict_one(d, x) for x in X])


# Baselines
def naive_seasonal(ex: Example) -> float:
    return ex.x[FEATURES.index("seasonal")]


def moving_average(ex: Example, k: int) -> float:
    return ex.x[FEATURES.index("ma3" if k == 3 else "ma12")]

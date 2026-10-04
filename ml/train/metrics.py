"""Métriques pondérables (poids = bootstrap groupé par salarié) et règle de capacité du produit."""
import math

import numpy as np


def _w(y, w):
    return np.ones(len(y)) if w is None else np.asarray(w, dtype=float)


def score_groups(s: np.ndarray) -> tuple[np.ndarray, int]:
    """Indice de groupe d'ex-æquo, croissant avec le score."""
    uniq, gid = np.unique(s, return_inverse=True)
    return gid, len(uniq)


def auc(y, s, w=None, groups=None) -> float:
    y = np.asarray(y)
    w = _w(y, w)
    gid, g = groups if groups is not None else score_groups(np.asarray(s))
    pos = np.bincount(gid, weights=w * y, minlength=g)
    neg = np.bincount(gid, weights=w * (1 - y), minlength=g)
    P, N = pos.sum(), neg.sum()
    if P == 0 or N == 0:
        return float("nan")
    below = np.cumsum(neg) - neg
    return float((pos * (below + 0.5 * neg)).sum() / (P * N))


def average_precision(y, s, w=None, groups=None) -> float:
    y = np.asarray(y)
    w = _w(y, w)
    gid, g = groups if groups is not None else score_groups(np.asarray(s))
    pos = np.bincount(gid, weights=w * y, minlength=g)[::-1]
    tot = np.bincount(gid, weights=w, minlength=g)[::-1]
    tp = np.cumsum(pos)
    n = np.cumsum(tot)
    P = tp[-1]
    if P == 0:
        return float("nan")
    keep = tot > 0
    prec = np.where(n > 0, tp / np.where(n > 0, n, 1), 0)
    return float((pos[keep] / P * prec[keep]).sum())


def brier(y, p, w=None) -> float:
    w = _w(y, w)
    return float((w * (p - y) ** 2).sum() / w.sum())


def oe_ratio(y, p, w=None) -> float:
    w = _w(y, w)
    return float((w * y).sum() / (w * p).sum())


def logistic_1d(x, y, w=None, iters=100):
    """Logistique non pénalisée y ~ sigmoid(a x + b) : Newton amorti (recherche linéaire), départ a = 0, b = logit(moyenne)."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    w = _w(y, w)
    ybar = np.clip((w * y).sum() / w.sum(), 1e-9, 1 - 1e-9)
    theta = np.array([0.0, np.log(ybar / (1 - ybar))])

    def nll(t):
        z = t[0] * x + t[1]
        return float((w * (np.logaddexp(0, z) - y * z)).sum())

    cur = nll(theta)
    for _ in range(iters):
        z = theta[0] * x + theta[1]
        p = 1 / (1 + np.exp(-np.clip(z, -700, 700)))
        r = w * (y - p)
        v = w * p * (1 - p)
        g = np.array([(r * x).sum(), r.sum()])
        H = np.array([[(v * x * x).sum(), (v * x).sum()], [(v * x).sum(), v.sum()]])
        step = np.linalg.solve(H + 1e-12 * np.eye(2), g)
        t = 1.0
        while nll(theta + t * step) > cur and t > 1e-8:
            t /= 2
        if t <= 1e-8:
            break
        theta = theta + t * step
        prev, cur = cur, nll(theta)
        if np.abs(t * step).max() < 1e-10 or prev - cur < 1e-13 * max(1.0, abs(cur)):
            break
    return float(theta[0]), float(theta[1])


def calibration_slope(y, p, w=None) -> tuple[float, float]:
    """(pente, ordonnée) de la régression logistique de y sur logit(p)."""
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return tuple(float(v) for v in logistic_1d(np.log(p / (1 - p)), y, w))


def js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def capacity_flags(score, month, rate: float, positive_only: bool = False) -> np.ndarray:
    """Règle ÉLEVÉ du produit par mois (rankAndLevel) : top round(n * rate) en plafond, ex-æquo franchissant la limite exclus."""
    score = np.asarray(score, dtype=float)
    month = np.asarray(month)
    flags = np.zeros(len(score), dtype=bool)
    for m in np.unique(month):
        idx = np.flatnonzero(month == m)
        s = score[idx]
        n = len(s)
        k = max(1, js_round(n * rate))
        cut = np.sort(s)[::-1][k] if k < n else -np.inf
        f = s > cut
        if positive_only:
            f &= s > 0
        flags[idx] = f
    return flags


def at_capacity(y, flags, w=None) -> dict:
    w = _w(y, w)
    sel = (w * flags).sum()
    tp = (w * flags * y).sum()
    P = (w * y).sum()
    prev = P / w.sum()
    prec = tp / sel if sel > 0 else float("nan")
    return {
        "precision_at_k": float(prec),
        "recall_at_k": float(tp / P) if P > 0 else float("nan"),
        "lift_at_k": float(prec / prev) if prev > 0 else float("nan"),
        "selection_rate": float(sel / w.sum()),
    }


def net_benefit(y, p, thresholds) -> list[dict]:
    n = len(y)
    prev = y.mean()
    out = []
    for t in thresholds:
        sel = p >= t
        tp = (sel & (y == 1)).sum() / n
        fp = (sel & (y == 0)).sum() / n
        odds = t / (1 - t)
        out.append({"threshold": t, "net_benefit": float(tp - fp * odds), "treat_all": float(prev - (1 - prev) * odds)})
    return out


def calibration_bins(y, p, n_bins: int = 10) -> list[dict]:
    edges = np.quantile(p, np.linspace(0, 1, n_bins + 1))
    b = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, n_bins - 1)
    return [
        {"p_mean": float(p[b == i].mean()), "observed": float(y[b == i].mean()), "n": int((b == i).sum())}
        for i in range(n_bins) if (b == i).any()
    ]


def bootstrap_weights(groups: np.ndarray, n_boot: int, seed: int = 20260929):
    """Générateur de poids de lignes : tirage avec remise des salariés (bootstrap groupé)."""
    uniq, inv = np.unique(groups, return_inverse=True)
    rng = np.random.default_rng(seed)
    G = len(uniq)
    for _ in range(n_boot):
        counts = np.bincount(rng.integers(0, G, G), minlength=G)
        yield counts[inv].astype(float)


def ci(values, level: float = 0.95) -> list[float]:
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    lo, hi = np.quantile(v, [(1 - level) / 2, 1 - (1 - level) / 2])
    return [float(lo), float(hi)]

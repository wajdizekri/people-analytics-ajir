"""Protocole temporel à origines glissantes : ridge vs naïf saisonnier, moyenne mobile 3 mois et dernier mois.

À chaque origine de test O et horizon h : apprentissage sur les lignes dont la cible T <= O (connue à l'origine) ;
alpha et quantile conforme choisis sur une scission interne (ajustement T <= O-12, calibration O-12 < T <= O) ;
modèle final réajusté sur tout T <= O ; prévision des lignes d'origine O.
"""
import math

import numpy as np

from .features import FEATURES, HORIZONS
from .model import ALPHAS, LEVEL, Ridge, conformal_q

BASELINES = ("NAIF_SAISONNIER", "MOYENNE_MOBILE_3", "DERNIER_MOIS")


def arrays(rows, cols=None):
    idx = [FEATURES.index(c) for c in cols] if cols else list(range(len(FEATURES)))
    X = np.array([[r["x"][j] for j in idx] for r in rows], dtype=float)
    return X


def _s(rows, s_default):
    return np.array([r["s"] if r["s"] is not None else s_default for r in rows])


def hours(zbar12, zhat):
    return np.maximum(0.0, np.expm1(zbar12 + zhat))


def fit_select(train, cols, s_default, cut, X=None):
    """Choix d'alpha et quantile conforme sur la scission (T <= cut | T > cut), puis réajustement sur tout train."""
    X = arrays(train, cols) if X is None else X
    y = np.array([r["y"] for r in train])
    T = np.array([r["T"] for r in train])
    f, c = T <= cut, T > cut
    zc = np.array([r["zbar12"] for r in train])[c]
    It = np.array([r["I_T"] for r in train])[c]
    sc = _s(train, s_default)[c]
    best = None
    for a in ALPHAS:
        m = Ridge(a).fit(X[f], y[f])
        pred = m.predict(X[c])
        mae = float(np.mean(np.abs(hours(zc, pred) - It)))
        if best is None or mae < best[0]:
            best = (mae, a, pred)
    _, alpha, pred = best
    q = conformal_q(np.abs(y[c] - pred) / sc, LEVEL)
    return Ridge(alpha).fit(X, y), alpha, q


def baseline(r, name):
    if name == "NAIF_SAISONNIER":
        return r["I_seas"] if not math.isnan(r["I_seas"]) else r["I12"]
    if name == "MOYENNE_MOBILE_3":
        return r["I_ma3"]
    return r["I_last"] if not math.isnan(r["I_last"]) else r["I_ma3"]


def rolling(samples, test_origins, cols=None, s_default=None):
    """Prévisions empilées sur les origines de test : liste de dicts (ligne + prévision + bornes + baselines)."""
    obs = [r for r in samples if not math.isnan(r["y"])]
    if s_default is None:
        s_default = float(np.median([r["s"] for r in obs if r["s"] is not None]))
    Xall = arrays(obs, cols)
    H = np.array([r["h"] for r in obs])
    T = np.array([r["T"] for r in obs])
    Or = np.array([r["O"] for r in obs])
    out = []
    for O in test_origins:
        for h in HORIZONS:
            tr = np.nonzero((H == h) & (T <= O))[0]
            te = np.nonzero((H == h) & (Or == O))[0]
            if not len(te) or not len(tr):
                continue
            train = [obs[i] for i in tr]
            test = [obs[i] for i in te]
            m, alpha, q = fit_select(train, cols, s_default, O - 12, Xall[tr])
            pred = m.predict(Xall[te])
            s = _s(test, s_default)
            for r, p, sc in zip(test, pred, s):
                zc = r["zbar12"] + p
                out.append(
                    {
                        "key": r["key"], "O": O, "h": h, "T": r["T"], "n": r["n"], "I_T": r["I_T"], "I12": r["I12"],
                        "pred": max(0.0, math.expm1(zc)), "lo": max(0.0, math.expm1(zc - q * sc)), "hi": max(0.0, math.expm1(zc + q * sc)),
                        "alpha": alpha, "q": q, **{b: baseline(r, b) for b in BASELINES},
                    }
                )
    return out


def _boot_delta(res, a, b, n_boot=1000, seed=7):
    """IC 95 % de MAE(a) - MAE(b), bootstrap par groupe (toutes les origines d'un groupe tirées ensemble)."""
    keys = np.array([r["key"] for r in res])
    d = np.array([abs(r[a] - r["I_T"]) - abs(r[b] - r["I_T"]) for r in res])
    uk, inv = np.unique(keys, return_inverse=True)
    sums = np.bincount(inv, weights=d, minlength=len(uk))
    cnt = np.bincount(inv, minlength=len(uk))
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(n_boot):
        k = rng.integers(0, len(uk), len(uk))
        bs.append(sums[k].sum() / cnt[k].sum())
    return float(d.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def summarize(res):
    out = {}
    for h in list(HORIZONS) + ["all"]:
        rs = [r for r in res if h == "all" or r["h"] == h]
        if not rs:
            continue
        It = np.array([r["I_T"] for r in rs])
        mae = {"RIDGE": float(np.mean([abs(r["pred"] - r["I_T"]) for r in rs]))}
        for b in BASELINES:
            mae[b] = float(np.mean([abs(r[b] - r["I_T"]) for r in rs]))
        best_b = min(BASELINES, key=lambda b: mae[b])
        cover = float(np.mean([(r["lo"] <= r["I_T"] <= r["hi"]) for r in rs]))
        width = float(np.mean([r["hi"] - r["lo"] for r in rs]))
        out[str(h)] = {
            "n": len(rs),
            "groups": len({r["key"] for r in rs}),
            "mean_I": float(It.mean()),
            "mae": mae,
            "skill_vs_best_baseline": 1 - mae["RIDGE"] / mae[best_b],
            "best_baseline": best_b,
            "delta_vs_best": _boot_delta(rs, "pred", best_b),
            "delta_vs_seasonal": _boot_delta(rs, "pred", "NAIF_SAISONNIER"),
            "coverage": cover,
            "coverage_below": float(np.mean([r["I_T"] < r["lo"] for r in rs])),
            "coverage_above": float(np.mean([r["I_T"] > r["hi"] for r in rs])),
            "mean_width": width,
            "alphas": sorted({r["alpha"] for r in rs}),
        }
    return out


def tension_eval(res, ratio, floor, pred_key="pred"):
    """Alerte « charge prévue élevée » : prévision >= max(plancher, (1 + ratio) x moyenne 12 mois). Précision / rappel."""
    tp = fp = fn = tn = 0
    for r in res:
        thr = max(floor, (1 + ratio) * r["I12"])
        p = r[pred_key] >= thr
        a = r["I_T"] >= thr
        tp += p and a
        fp += p and not a
        fn += (not p) and a
        tn += (not p) and (not a)
    n = tp + fp + fn + tn
    return {
        "n": n,
        "prevalence": (tp + fn) / n if n else None,
        "flagged_share": (tp + fp) / n if n else None,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
    }

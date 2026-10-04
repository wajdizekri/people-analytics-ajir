"""Rapport d'équité (sexe, tranche d'âge) et détection de proxys par information mutuelle. Rapport, jamais bloquant."""
import numpy as np
import pandas as pd
from sklearn.feature_selection import mutual_info_classif

from . import metrics as M

SEX_LABELS = {"F": "Femmes", "M": "Hommes"}
MIN_GROUP = 30


def _group_stats(y, p, flags, w=None) -> dict:
    w = np.ones(len(y)) if w is None else w
    n = w.sum()
    pos = (w * y).sum()
    neg = n - pos
    return {
        "base_rate": float(pos / n),
        "mean_pred": float((w * p).sum() / n),
        "oe_ratio": float(pos / (w * p).sum()),
        "selection_rate": float((w * flags).sum() / n),
        "tpr": float((w * flags * y).sum() / pos) if pos > 0 else float("nan"),
        "fpr": float((w * flags * (1 - y)).sum() / neg) if neg > 0 else float("nan"),
    }


def group_report(pred: pd.DataFrame, col: str, rate: float, n_boot: int = 500, seed: int = 11) -> dict:
    y = pred["y6"].to_numpy().astype(float)
    p = pred[col].to_numpy(dtype=float)
    flags = M.capacity_flags(p, pred["month"].to_numpy(), rate).astype(float)
    groups = pred["employee_id"].to_numpy()
    dims = {"sex": pred["sex"].map(lambda s: SEX_LABELS.get(s, s)).to_numpy(), "age_band": pred["age_band"].to_numpy()}
    out = {"min_group_size": MIN_GROUP, "model": col, "capacity_rate": rate}
    masks = {(d, g): v == g for d, v in dims.items() for g in sorted(set(v))}
    boot = {k: {s: [] for s in ("oe_ratio", "selection_rate", "tpr", "fpr")} for k in masks}
    for w in M.bootstrap_weights(groups, n_boot, seed):
        for k, m in masks.items():
            st = _group_stats(y[m], p[m], flags[m], w[m])
            for s in boot[k]:
                boot[k][s].append(st[s])
    for d in dims:
        rows = []
        for (dd, g), m in masks.items():
            if dd != d:
                continue
            st = _group_stats(y[m], p[m], flags[m])
            rows.append({"group": g, "n": int(m.sum()), "n_pos": int(y[m].sum()), **st, "auc": M.auc(y[m], p[m]),
                         "ci": {s: M.ci(v) for s, v in boot[(dd, g)].items()}})
        out[d] = rows
    return out


def proxy_mutual_information(meta: pd.DataFrame, X: np.ndarray, names: list[str], score=None, seed: int = 5) -> dict:
    """MI (nats) entre chaque variable et l'attribut sensible, sur un snapshot tiré au hasard par salarié
    (kNN pour les variables continues). share = MI / H(attribut)."""
    idx = meta.groupby("employee_id").sample(1, random_state=seed).index.to_numpy()
    Xs = X[idx]
    cols = list(names)
    if score is not None:
        Xs = np.column_stack([Xs, np.asarray(score)[idx]])
        cols.append("score_modele")
    discrete = np.array([len(np.unique(Xs[:, j])) <= 10 for j in range(Xs.shape[1])])
    out = {"n_employees": int(len(idx))}
    for attr in ("sex", "age_band"):
        target = meta.loc[idx, attr].to_numpy()
        keep = target != "inconnu"
        codes, labels = pd.factorize(target[keep])
        freq = np.bincount(codes) / len(codes)
        H = float(-(freq * np.log(freq)).sum())
        mi = mutual_info_classif(Xs[keep], codes, discrete_features=discrete, n_neighbors=3, random_state=seed)
        rows = sorted(({"feature": c, "mi": float(v), "share": float(v / H)} for c, v in zip(cols, mi)), key=lambda r: -r["mi"])
        out[attr] = {"entropy": H, "groups": [str(x) for x in labels], "features": rows}
    return out

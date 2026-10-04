"""Évaluation des prédictions de test empilées : métriques ponctuelles, IC bootstrap groupé par salarié, différences appariées."""
import numpy as np
import pandas as pd

from . import metrics as M

LIFT_RATES = (0.01, 0.02, 0.05, 0.10, 0.20)
DECISION_THRESHOLDS = (0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.10, 0.15, 0.20, 0.30)


def _is_prob(name: str) -> bool:
    return not name.startswith("B0")


def point_metrics(y, s, month, rate, prob: bool, b0: bool) -> dict:
    flags = M.capacity_flags(s, month, rate, positive_only=b0)
    out = {"auc": M.auc(y, s), "pr_auc": M.average_precision(y, s), **M.at_capacity(y, flags)}
    if prob:
        slope, intercept = M.calibration_slope(y, s)
        out |= {"brier": M.brier(y, s), "oe_ratio": M.oe_ratio(y, s), "slope": slope, "cal_intercept": intercept,
                "mean_pred": float(s.mean())}
    return out


def evaluate(pred: pd.DataFrame, models: list[str], rate: float, n_boot: int = 1000,
             pairs=(("LOGREG", "B0"), ("LGBM", "LOGREG")), oracle: str | None = "oracle", seed: int = 20260929) -> dict:
    y = pred["y6"].to_numpy().astype(float)
    month = pred["month"].to_numpy()
    groups = pred["employee_id"].to_numpy()
    S = {m: pred[m].to_numpy(dtype=float) for m in models}
    G = {m: M.score_groups(S[m]) for m in models}
    F = {m: M.capacity_flags(S[m], month, rate, positive_only=m.startswith("B0")) for m in models}
    pairs = [p for p in pairs if p[0] in S and p[1] in S]

    res = {"n": int(len(y)), "n_pos": int(y.sum()), "base_rate": float(y.mean()), "n_employees": int(len(np.unique(groups))),
           "capacity_rate": rate, "n_boot": n_boot, "models": {}, "diffs": {}}
    for m in models:
        res["models"][m] = point_metrics(y, S[m], month, rate, _is_prob(m), m.startswith("B0"))

    has_oracle = oracle is not None and oracle in pred and pred[oracle].notna().any()
    if has_oracle:
        om = pred[oracle].notna().to_numpy()
        yo = y[om]
        So = {m: S[m][om] for m in models} | {"ORACLE": pred[oracle].to_numpy(dtype=float)[om]}
        Go = {m: M.score_groups(v) for m, v in So.items()}
        res["oracle_subset"] = {"n": int(om.sum()), "n_pos": int(yo.sum()), "base_rate": float(yo.mean()),
                                "auc": {m: M.auc(yo, v) for m, v in So.items()}}

    keys = ("auc", "pr_auc", "lift_at_k", "precision_at_k", "brier", "oe_ratio", "slope")
    boot = {m: {k: [] for k in keys} for m in models}
    dboot = {f"{a}-{b}": {k: [] for k in ("auc", "pr_auc", "lift_at_k")} for a, b in pairs}
    oboot = {m: [] for m in (So if has_oracle else {})}
    for w in M.bootstrap_weights(groups, n_boot, seed):
        cur = {}
        for m in models:
            cap = M.at_capacity(y, F[m], w)
            cur[m] = {"auc": M.auc(y, S[m], w, G[m]), "pr_auc": M.average_precision(y, S[m], w, G[m]),
                      "lift_at_k": cap["lift_at_k"], "precision_at_k": cap["precision_at_k"]}
            if _is_prob(m):
                cur[m] |= {"brier": M.brier(y, S[m], w), "oe_ratio": M.oe_ratio(y, S[m], w),
                           "slope": M.calibration_slope(y, S[m], w)[0]}
            for k, v in cur[m].items():
                boot[m][k].append(v)
        for a, b in pairs:
            for k in ("auc", "pr_auc", "lift_at_k"):
                dboot[f"{a}-{b}"][k].append(cur[a][k] - cur[b][k])
        if has_oracle:
            wo = w[om]
            for m in oboot:
                oboot[m].append(M.auc(yo, So[m], wo, Go[m]))

    for m in models:
        res["models"][m]["ci"] = {k: M.ci(v) for k, v in boot[m].items() if v}
    for a, b in pairs:
        key = f"{a}-{b}"
        res["diffs"][key] = {k: {"value": res["models"][a][k] - res["models"][b][k], "ci": M.ci(v),
                                 "p_le_0": float(np.mean(np.asarray(v) <= 0))} for k, v in dboot[key].items()}
    if has_oracle:
        res["oracle_subset"]["ci"] = {m: M.ci(v) for m, v in oboot.items()}
    return res


def per_origin(pred: pd.DataFrame, models: list[str], rate: float) -> list[dict]:
    rows = []
    for origin, d in pred.groupby("origin"):
        y = d["y6"].to_numpy().astype(float)
        r = {"origin": origin, "n": int(len(d)), "n_pos": int(y.sum())}
        for m in models:
            s = d[m].to_numpy(dtype=float)
            r[m] = {"auc": M.auc(y, s), **M.at_capacity(y, M.capacity_flags(s, d["month"].to_numpy(), rate, m.startswith("B0")))}
            if _is_prob(m):
                r[m]["oe_ratio"] = M.oe_ratio(y, s)
        rows.append(r)
    return rows


def curves(pred: pd.DataFrame, col: str) -> dict:
    y = pred["y6"].to_numpy().astype(float)
    p = pred[col].to_numpy(dtype=float)
    month = pred["month"].to_numpy()
    lift = []
    for r in LIFT_RATES:
        cap = M.at_capacity(y, M.capacity_flags(p, month, r))
        lift.append({"top_pct": r, "lift": cap["lift_at_k"], "precision": cap["precision_at_k"], "recall": cap["recall_at_k"]})
    return {"bins": M.calibration_bins(y, p), "lift_curve": lift, "decision_curve": M.net_benefit(y, p, DECISION_THRESHOLDS)}

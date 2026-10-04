"""Formations obligatoires : protocole temporel, baseline vs régression logistique, bundle de production.

python -m ml.training.run --db data/dev-ai-train.db [--bundle] [--boot 1000]
"""
import argparse
import json
import math
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from ml.train import metrics as M

from .panel import ALL_FEATURES, FEATURE_PARAMS, HORIZON_DAYS, build_panel, data_hash, to_day

ROOT = Path(__file__).resolve().parents[2]
MODEL_FEATURES = ["days_to_due", "log_days_to_due", "hours", "log_tenure", "new_hire", "emp_margin_days", "team_late_rate_12m",
                  "overtime_h_3m", "due_summer"]
IMPUTED = ["emp_margin_days", "team_late_rate_12m"]
C_GRID = (1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1.0, 10.0)
CAL_DAYS = 183
TEST_DAYS = 365
LEVELS = {"high": 0.5, "medium": 0.25}
BASELINE_DAYS = 30
TOP_SHARE = 0.10


def sigmoid(z):
    z = np.asarray(z, dtype=float)
    return np.where(z >= 0, 1 / (1 + np.exp(-np.abs(z))), np.exp(-np.abs(z)) / (1 + np.exp(-np.abs(z))))


class Model:
    def __init__(self, impute, mean, std, coef, intercept, C):
        self.impute, self.mean, self.std, self.coef, self.intercept, self.C = impute, mean, std, coef, intercept, C
        self.a, self.b = 1.0, 0.0

    def matrix(self, df):
        X = df[MODEL_FEATURES].astype(float).copy()
        for k, v in self.impute.items():
            X[k] = X[k].fillna(v)
        return X.to_numpy()

    def logit(self, df):
        X = self.matrix(df)
        return self.intercept + ((X - self.mean) / np.where(self.std == 0, 1.0, self.std)) @ self.coef

    def proba(self, df):
        return sigmoid(self.a * self.logit(df) + self.b)


def fit_model(df, C) -> Model:
    impute = {k: float(df[k].mean()) for k in IMPUTED}
    X = df[MODEL_FEATURES].astype(float).copy()
    for k, v in impute.items():
        X[k] = X[k].fillna(v)
    X = X.to_numpy()
    mean, std = X.mean(axis=0), X.std(axis=0)
    Z = (X - mean) / np.where(std == 0, 1.0, std)
    clf = LogisticRegression(C=C, solver="lbfgs", max_iter=5000, tol=1e-10)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        clf.fit(Z, df["y"].to_numpy())
    return Model(impute, mean, std, clf.coef_[0].copy(), float(clf.intercept_[0]), C)


def split(df, origin: str):
    """fit : échéances closes avant la calibration ; cal : 6 mois de coupures dont l'horizon est clos à l'origine ;
    test : coupures des 12 mois après l'origine, horizon clos à la fin des données."""
    t = df["as_of"].map(to_day).to_numpy()
    o = to_day(origin)
    end = to_day(df.attrs["data_end"])
    cal = (t + HORIZON_DAYS <= o) & (t + HORIZON_DAYS > o - CAL_DAYS)
    fit = t + HORIZON_DAYS <= o - CAL_DAYS
    test = (t > o) & (t <= o + TEST_DAYS) & (t + HORIZON_DAYS <= end)
    return fit, cal, test


def train_recipe(df, origin: str):
    fit, cal, _ = split(df, origin)
    f, c = df[fit], df[cal]
    tuning = []
    for C in C_GRID:
        m = fit_model(f, C)
        tuning.append({"C": C, "auc_cal": M.auc(c["y"].to_numpy(), m.logit(c))})
    best = max(tuning, key=lambda r: (round(r["auc_cal"], 4), -r["C"]))["C"]
    m = fit_model(f, best)
    m.a, m.b = M.logistic_1d(m.logit(c), c["y"].to_numpy())
    return m, {"C": best, "tuning": tuning, "fit_rows": int(fit.sum()), "cal_rows": int(cal.sum()),
               "fit_span": [f["as_of"].min(), f["as_of"].max()], "cal_span": [c["as_of"].min(), c["as_of"].max()]}


def baseline(df) -> np.ndarray:
    return ((df["days_to_due"] < BASELINE_DAYS) & (df["started"] == 0)).astype(float).to_numpy()


def top_flags(score, month, k_by_month: dict) -> np.ndarray:
    """Sélection des k lignes de plus haut score par mois (ex-æquo à la limite exclus, comme la règle de capacité)."""
    flags = np.zeros(len(score), dtype=bool)
    for m, k in k_by_month.items():
        idx = np.flatnonzero(month == m)
        if k <= 0 or not len(idx):
            continue
        s = score[idx]
        cut = np.sort(s)[::-1][k] if k < len(s) else -np.inf
        flags[idx] = s > cut
    return flags


def point_metrics(y, p, base, month, w=None) -> dict:
    k_base = {m: int(base[month == m].sum()) for m in np.unique(month)}
    k_top = {m: max(1, M.js_round((month == m).sum() * TOP_SHARE)) for m in np.unique(month)}
    lr_base = top_flags(p, month, k_base)
    lr_top = top_flags(p, month, k_top)
    prec = lambda f: M.at_capacity(y, f, w)["precision_at_k"]  # noqa: E731
    rec = lambda f: M.at_capacity(y, f, w)["recall_at_k"]  # noqa: E731
    slope, inter = M.calibration_slope(y, p, w)
    high = p >= LEVELS["high"]
    med = p >= LEVELS["medium"]
    return {
        "auc_lr": M.auc(y, p, w), "auc_base": M.auc(y, base, w),
        "prauc_lr": M.average_precision(y, p, w), "prauc_base": M.average_precision(y, base, w),
        "brier_lr": M.brier(y, p, w), "oe_lr": M.oe_ratio(y, p, w), "cal_slope": slope, "cal_intercept": inter,
        "prec_base_rule": prec(base > 0), "recall_base_rule": rec(base > 0),
        "prec_lr_at_base_k": prec(lr_base), "recall_lr_at_base_k": rec(lr_base),
        "prec_lr_top10": prec(lr_top), "recall_lr_top10": rec(lr_top),
        "prec_high": prec(high), "recall_high": rec(high), "share_high": float(high.mean()) if w is None else float((w * high).sum() / w.sum()),
        "prec_medium_plus": prec(med), "recall_medium_plus": rec(med),
        "d_auc": M.auc(y, p, w) - M.auc(y, base, w), "d_prauc": M.average_precision(y, p, w) - M.average_precision(y, base, w),
        "d_prec_at_base_k": prec(lr_base) - prec(base > 0),
    }


def evaluate(df, origin: str, n_boot: int) -> dict:
    model, info = train_recipe(df, origin)
    _, _, test = split(df, origin)
    te = df[test]
    y = te["y"].to_numpy().astype(float)
    p = model.proba(te)
    base = baseline(te)
    month = te["as_of"].to_numpy()
    point = point_metrics(y, p, base, month)
    boots = {k: [] for k in point}
    for w in M.bootstrap_weights(te["employee_id"].to_numpy(), n_boot):
        for k, v in point_metrics(y, p, base, month, w).items():
            boots[k].append(v)
    return {
        "origin": origin, **info,
        "test_rows": int(len(te)), "test_trainings": int(te["training_id"].nunique()), "test_employees": int(te["employee_id"].nunique()),
        "test_span": [te["as_of"].min(), te["as_of"].max()], "test_positive_rate": float(y.mean()),
        "metrics": {k: {"value": float(v), "ci95": M.ci(boots[k])} for k, v in point.items()},
        "calibration_bins": M.calibration_bins(y, p, 10),
        "coef": dict(zip(MODEL_FEATURES, [float(c) for c in model.coef])), "platt": [float(model.a), float(model.b)],
    }


def bundle_predict(bundle: dict, x) -> float:
    """Même suite d'opérations que predictTraining (src/lib/ai/training/model.ts)."""
    mean, std = bundle["standardization"]["mean"], bundle["standardization"]["std"]
    logit = bundle["intercept"]
    for j, v in enumerate(x):
        logit += bundle["coef"][j] * ((float(v) - mean[j]) / (1.0 if std[j] == 0 else std[j]))
    s = bundle["calibration"]["a"] * logit + bundle["calibration"]["b"]
    if s >= 0:
        return 1 / (1 + math.exp(-s))
    e = math.exp(s)
    return e / (1 + e)


def make_bundle(df, panel, version: str, evals: list[dict]) -> tuple[dict, list[dict], list[dict]]:
    origin = df.attrs["data_end"]
    model, info = train_recipe(df, origin)
    fit, cal, _ = split(df, origin)
    used = df[fit | cal]
    main = evals[-1]["metrics"]
    bundle = {
        "version": version, "kind": "LOGREG", "topic": "FORMATION",
        "target": "formation obligatoire ouverte à t non terminée à son échéance",
        "features": MODEL_FEATURES, "feature_params": FEATURE_PARAMS, "impute": model.impute,
        "standardization": {"mean": [float(v) for v in model.mean], "std": [float(v) for v in model.std]},
        "coef": [float(v) for v in model.coef], "intercept": float(model.intercept),
        "calibration": {"method": "platt", "a": float(model.a), "b": float(model.b)},
        "base_rate": float(used["y"].mean()), "levels": LEVELS,
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_hash": f"sha256:{data_hash(used)}", "train_rows": int(len(used)),
        "train_from": used["as_of"].min(), "train_to": used["as_of"].max(), "C": info["C"],
        "metrics": {k: main[k] for k in ("auc_lr", "auc_base", "prauc_lr", "prauc_base", "brier_lr", "oe_lr", "cal_slope",
                                           "prec_base_rule", "prec_lr_at_base_k", "prec_lr_top10", "prec_high", "recall_high")}
                   | {"origin": evals[-1]["origin"], "test_rows": evals[-1]["test_rows"]},
    }
    X = model.matrix(df)
    p = np.array([bundle_predict(bundle, row) for row in X])
    rng = np.random.default_rng(3)
    top = np.argsort(-p)[:50]
    idx = np.sort(np.concatenate([rng.choice(np.setdiff1d(np.arange(len(X)), top), 150, replace=False), top]))
    golden = [{"x": [float(v) for v in X[i]], "p": float(p[i])} for i in idx]
    last = np.flatnonzero(panel["as_of"].to_numpy() == panel["as_of"].max())
    fidx = np.unique(np.concatenate([rng.choice(len(panel), 250, replace=False), rng.choice(last, min(50, len(last)), replace=False)]))
    gfeat = [{"training_id": int(panel.iloc[i]["training_id"]), "as_of": panel.iloc[i]["as_of"],
              "features": {k: (None if pd.isna(panel.iloc[i][k]) else float(panel.iloc[i][k])) for k in ALL_FEATURES}} for i in fidx]
    return bundle, golden, gfeat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/dev-ai-train.db")
    ap.add_argument("--origins", default="2024-06-30,2025-06-30")
    ap.add_argument("--boot", type=int, default=1000)
    ap.add_argument("--bundle", action="store_true")
    ap.add_argument("--version", default=f"formation-logreg-v1-{datetime.now():%Y%m%d}")
    ap.add_argument("--results", default=str(ROOT / "ml" / "training" / "results" / "results.json"))
    a = ap.parse_args()
    panel = build_panel(a.db)
    df = panel[(panel["followup_complete"] == 1) & (panel["y"] >= 0)].copy()
    df.attrs["data_end"] = panel.attrs["data_end"]
    summary = {
        "db": a.db, "data_end": df.attrs["data_end"], "panel_rows": int(len(panel)), "labelled_rows": int(len(df)),
        "trainings": int(df["training_id"].nunique()), "employees": int(df["employee_id"].nunique()),
        "positive_rate_rows": float(df["y"].mean()),
        "positive_rate_trainings": float(df.sort_values("as_of").groupby("training_id").head(1)["y"].mean()),
        "started_share": float(df["started"].mean()),
        "variance": {k: float(df[k].astype(float).std()) for k in ALL_FEATURES},
    }
    evals = [evaluate(df, o, a.boot) for o in a.origins.split(",")]
    out = {"summary": summary, "evaluations": evals}
    if a.bundle:
        bundle, golden, gfeat = make_bundle(df, panel, a.version, evals)
        d = ROOT / "models" / "training" / a.version
        d.mkdir(parents=True, exist_ok=True)
        (d / "model.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (d / "golden.json").write_text(json.dumps(golden, separators=(",", ":")) + "\n", encoding="utf-8")
        (d / "golden-features.json").write_text(json.dumps(gfeat, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        out["bundle"] = {"dir": str(d.relative_to(ROOT)).replace("\\", "/"), "version": a.version, "train_rows": bundle["train_rows"],
                         "C": bundle["C"], "coef": dict(zip(MODEL_FEATURES, bundle["coef"])), "calibration": bundle["calibration"]}
    Path(a.results).parent.mkdir(parents=True, exist_ok=True)
    Path(a.results).write_text(json.dumps(out, ensure_ascii=False, indent=2, default=float) + "\n", encoding="utf-8")
    for e in evals:
        m = e["metrics"]
        print(f"Origine {e['origin']} : test {e['test_rows']} lignes ({e['test_span'][0]} -> {e['test_span'][1]}), C={e['C']}")
        for k in ("auc_lr", "auc_base", "prauc_lr", "prauc_base", "brier_lr", "oe_lr", "cal_slope", "prec_base_rule",
                  "prec_lr_at_base_k", "prec_lr_top10", "prec_high", "recall_high", "share_high", "d_auc", "d_prec_at_base_k"):
            print(f"  {k:20s} {m[k]['value']:.3f}  IC95 [{m[k]['ci95'][0]:.3f} ; {m[k]['ci95'][1]:.3f}]")


if __name__ == "__main__":
    main()

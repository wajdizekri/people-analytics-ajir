"""B0 (règles), régression logistique L2 standardisée + Platt, LightGBM (comparateur hors ligne)."""
import warnings
from dataclasses import dataclass, field

import lightgbm as lgb
import numpy as np
from sklearn.linear_model import LogisticRegression

from . import metrics as M

C_GRID = (3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 0.1, 1.0)
LGBM_GRID = tuple({"num_leaves": nl, "min_child_samples": mc} for nl in (4, 8, 16) for mc in (100, 400))
LGBM_BASE = {
    "objective": "binary", "learning_rate": 0.02, "feature_fraction": 0.7, "bagging_fraction": 0.8, "bagging_freq": 1,
    "lambda_l2": 5.0, "verbose": -1, "seed": 7, "deterministic": True, "force_row_wise": True, "num_threads": 2,
}
LGBM_MAX_ROUNDS = 2000
LGBM_PATIENCE = 100

_OPS = {"<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal, "==": np.equal}


def b0_points(X: np.ndarray, names: list[str], rules: list[dict]) -> np.ndarray:
    s = np.zeros(len(X))
    for r in rules:
        s += np.where(_OPS[r["op"]](X[:, names.index(r["feature"])], r["value"]), r["points"], 0)
    return s


def sigmoid(z):
    z = np.asarray(z, dtype=float)
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1 / (1 + np.exp(-z[pos]))
    e = np.exp(z[~pos])
    out[~pos] = e / (1 + e)
    return out


def platt_fit(score: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> tuple[float, float]:
    """Logistique non pénalisée y ~ sigmoid(a * score + b) (Newton)."""
    a, b = M.logistic_1d(score, y, w)
    return float(a), float(b)


@dataclass
class Logreg:
    mean: np.ndarray
    std: np.ndarray
    coef: np.ndarray
    intercept: float
    C: float
    a: float = 1.0
    b: float = 0.0
    class_weight: str | None = "balanced"
    extra: dict = field(default_factory=dict)

    def z(self, X):
        return (X - self.mean) / np.where(self.std == 0, 1.0, self.std)

    def logit(self, X):
        return self.intercept + self.z(X) @ self.coef

    def proba(self, X):
        return sigmoid(self.a * self.logit(X) + self.b)


def fit_logreg(X, y, C: float, class_weight: str | None = "balanced") -> Logreg:
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    Z = (X - mean) / np.where(std == 0, 1.0, std)
    clf = LogisticRegression(C=C, class_weight=class_weight, solver="lbfgs", max_iter=5000, tol=1e-10)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        clf.fit(Z, y)
    return Logreg(mean, std, clf.coef_[0].copy(), float(clf.intercept_[0]), C, class_weight=class_weight)


def inner_split(month: np.ndarray, val_months: int = 6, horizon: int = 6):
    """Validation temporelle interne : derniers `val_months` mois ; apprentissage dont l'horizon se termine avant."""
    hi = month.max()
    val = month > hi - val_months
    fit = month + horizon <= hi - val_months + 1
    return fit, val


def _usable(y_fit, y_val) -> bool:
    return y_fit.sum() >= 2 and 0 < y_val.sum() < len(y_val)


DEFAULT_C = 1e-3


def select_C(X_fit, y_fit, X_val, y_val, grid=C_GRID, class_weight="balanced"):
    """C maximisant l'AUC de validation (à 1e-4 près, le plus régularisé) ; renvoie aussi le modèle ajusté sur X_fit."""
    rows, fitted = [], {}
    for C in grid:
        m = fit_logreg(X_fit, y_fit, C, class_weight)
        fitted[C] = m
        rows.append({"C": C, "auc_val": M.auc(y_val, m.logit(X_val))})
    best = max(rows, key=lambda r: (round(r["auc_val"], 4), -r["C"]))["C"]
    return best, rows, fitted[best]


def tune_logreg(X, y, month, grid=C_GRID, class_weight="balanced", default_C=DEFAULT_C):
    fit, val = inner_split(month)
    if not _usable(y[fit], y[val]):
        return default_C, []
    C, rows, _ = select_C(X[fit], y[fit], X[val], y[val], grid, class_weight)
    return C, rows


def train_logreg_prod(X, y, month, class_weight="balanced", C=None, default_C=DEFAULT_C) -> Logreg:
    """Recette du modèle de production : C et Platt estimés hors échantillon temporel (apprentissage sur les lignes dont
    l'horizon est clos avant les 6 derniers mois, validation-calibration sur ces 6 mois), puis coefficients réajustés
    sur toutes les lignes avec le même C, Platt conservé."""
    fit, val = inner_split(month)
    if _usable(y[fit], y[val]):
        if C is None:
            C, rows, early = select_C(X[fit], y[fit], X[val], y[val], class_weight=class_weight)
        else:
            rows, early = [], fit_logreg(X[fit], y[fit], C, class_weight)
        a, b = platt_fit(early.logit(X[val]), y[val])
    else:
        C, rows = C or default_C, []
        a = b = None
    m = fit_logreg(X, y, C, class_weight)
    if a is None or a <= 0:
        a, b = platt_fit(m.logit(X), y)
    m.a, m.b = a, b
    m.extra["tuning"] = rows
    m.extra["calibration_rows"] = int(val.sum())
    return m


def train_logreg(X, y, month, class_weight="balanced", C=None) -> Logreg:
    """Réglage de C par validation temporelle interne puis ajustement (Platt appliqué ensuite par l'appelant)."""
    tuning = []
    if C is None:
        C, tuning = tune_logreg(X, y, month, class_weight=class_weight)
    m = fit_logreg(X, y, C, class_weight)
    m.extra["tuning"] = tuning
    return m


@dataclass
class Gbm:
    booster: lgb.Booster
    params: dict
    n_rounds: int
    a: float = 1.0
    b: float = 0.0

    def logit(self, X):
        return self.booster.predict(X, raw_score=True)

    def proba(self, X):
        return sigmoid(self.a * self.logit(X) + self.b)


def _lgb_params(extra: dict, y) -> dict:
    pos = max(1, int(y.sum()))
    return {**LGBM_BASE, **extra, "scale_pos_weight": (len(y) - pos) / pos}


def fit_lgbm(X, y, params: dict, n_rounds: int) -> Gbm:
    p = _lgb_params(params, y)
    booster = lgb.train(p, lgb.Dataset(X, y, free_raw_data=False), num_boost_round=n_rounds)
    return Gbm(booster, params, n_rounds)


DEFAULT_LGBM = {"params": {"num_leaves": 4, "min_child_samples": 400}, "n_rounds": 200}


def select_lgbm(X_fit, y_fit, X_val, y_val, grid=LGBM_GRID, num_threads=None):
    """Grille réduite ; nombre d'arbres par arrêt précoce sur la validation (AUC)."""
    rows = []
    for g in grid:
        p = _lgb_params(g, y_fit) | {"metric": "auc"} | ({"num_threads": num_threads} if num_threads else {})
        booster = lgb.train(
            p, lgb.Dataset(X_fit, y_fit), num_boost_round=LGBM_MAX_ROUNDS, valid_sets=[lgb.Dataset(X_val, y_val)],
            callbacks=[lgb.early_stopping(LGBM_PATIENCE, verbose=False)],
        )
        rows.append({"params": g, "n_rounds": max(20, booster.best_iteration), "auc_val": float(booster.best_score["valid_0"]["auc"])})
    best = max(rows, key=lambda r: r["auc_val"])
    return {"params": best["params"], "n_rounds": best["n_rounds"]}, rows


def tune_lgbm(X, y, month, grid=LGBM_GRID, default=None):
    fit, val = inner_split(month)
    if not _usable(y[fit], y[val]):
        return default or DEFAULT_LGBM, []
    return select_lgbm(X[fit], y[fit], X[val], y[val], grid)


def train_lgbm(X, y, month, hp=None) -> Gbm:
    tuning = []
    if hp is None:
        hp, tuning = tune_lgbm(X, y, month)
    m = fit_lgbm(X, y, hp["params"], hp["n_rounds"])
    m.params = {**hp["params"], "n_rounds": hp["n_rounds"], "tuning": tuning}
    return m

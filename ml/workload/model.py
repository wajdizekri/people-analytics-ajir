"""Ridge standardisée sur z = log(1 + I) et intervalles conformes normalisés (échelle de bruit du groupe)."""
import math

import numpy as np

ALPHAS = (0.3, 1.0, 3.0, 10.0, 30.0, 100.0, 300.0, 1000.0, 3000.0, 10000.0)
LEVEL = 0.8


class Ridge:
    def __init__(self, alpha: float):
        self.alpha = alpha

    def fit(self, X: np.ndarray, y: np.ndarray):
        self.mean = X.mean(0)
        sd = X.std(0)
        self.std = np.where(sd > 1e-12, sd, 1.0)
        Z = (X - self.mean) / self.std
        self.intercept = float(y.mean())
        A = Z.T @ Z + self.alpha * np.eye(Z.shape[1])
        self.coef = np.linalg.solve(A, Z.T @ (y - self.intercept))
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.intercept + ((X - self.mean) / self.std) @ self.coef


def conformal_q(abs_norm_resid: np.ndarray, level: float = LEVEL) -> float:
    r = np.sort(abs_norm_resid[np.isfinite(abs_norm_resid)])
    n = len(r)
    k = min(n - 1, max(0, math.ceil((n + 1) * level) - 1))
    return float(r[k])


def to_hours(zhat, zbar12, s, q):
    """(valeur, bas, haut) en heures sup par ETP et par mois."""
    zc = zbar12 + zhat
    return max(0.0, math.expm1(zc)), max(0.0, math.expm1(zc - q * s)), max(0.0, math.expm1(zc + q * s))


def bundle_predict(m: dict, x, zbar12: float, s: float):
    """Même suite d'opérations que predictGroup (src/lib/ai/workload/model.ts)."""
    y = m["intercept"]
    for j, v in enumerate(x):
        y += m["coef"][j] * ((float(v) - m["mean"][j]) / m["std"][j])
    return to_hours(y, zbar12, s, m["q"])

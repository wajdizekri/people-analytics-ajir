"""Référence Python de la comparaison appariée : golden rejoué par tests/ia-causal/logistic.test.ts.

Le score de propension est estimé en TypeScript dans l'application (src/lib/matching). Ce script fixe un jeu
synthétique, l'estime avec scikit-learn (LogisticRegression, C = 1/λ, intercept non pénalisé, même objectif que
le TypeScript) et réimplémente indépendamment l'appariement glouton au plus proche voisin avec caliper et les
différences standardisées. Le test TypeScript doit retrouver coefficients et caliper à 1e-6 près, les mêmes paires
et les mêmes différences standardisées. Aucune lecture ni écriture de la base.

    python ml/matching/reference.py
    python ml/matching/reference.py --out tests/ia-causal/fixtures/matching-golden.json --seed 7
"""

from __future__ import annotations

import argparse
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
LAMBDA = 1.0
CALIPER_SD = 0.2


def make_data(seed: int, n: int = 900, strata: int = 3):
    rng = np.random.default_rng(seed)
    x0 = rng.normal(size=n)
    x1 = rng.normal(size=n)
    x2 = (rng.random(n) < 0.3).astype(float)
    x3 = rng.normal(loc=5.0, scale=2.0, size=n)
    x4 = rng.poisson(3.0, size=n).astype(float)
    eta = -2.2 + 1.1 * x0 - 0.6 * x1 + 0.5 * x2 + 0.1 * (x3 - 5.0)
    treated = (rng.random(n) < 1.0 / (1.0 + np.exp(-eta))).astype(int)
    X = np.column_stack([x0, x1, x2, x3, x4])
    strata_labels = [f"2025-{(i % strata) + 1:02d}-28" for i in range(n)]
    keys = [f"g{i:05d}" for i in range(n)]
    return X, treated, strata_labels, keys


def fit_numpy(Z: np.ndarray, t: np.ndarray, lam: float, tol: float = 1e-13, max_iter: int = 200):
    n, p = Z.shape
    A = np.column_stack([np.ones(n), Z])
    beta = np.zeros(p + 1)
    pen = np.full(p + 1, lam)
    pen[0] = 0.0
    for _ in range(max_iter):
        mu = 1.0 / (1.0 + np.exp(-A @ beta))
        g = A.T @ (mu - t) + pen * beta
        H = (A * (mu * (1.0 - mu))[:, None]).T @ A + np.diag(pen)
        d = np.linalg.solve(H, g)
        beta = beta - d
        if np.max(np.abs(d)) < tol:
            break
    return float(beta[0]), beta[1:]


def fit_sklearn(Z: np.ndarray, t: np.ndarray, lam: float):
    from sklearn.linear_model import LogisticRegression

    for solver in ("newton-cholesky", "lbfgs"):
        try:
            m = LogisticRegression(C=1.0 / lam, solver=solver, tol=1e-12, max_iter=10000)
            m.fit(Z, t)
            return float(m.intercept_[0]), m.coef_[0].astype(float), solver
        except ValueError:
            continue
    raise RuntimeError("aucun solveur scikit-learn disponible")


def greedy_match(scores, treated, strata, keys, caliper):
    pairs = []
    for s in sorted(set(strata)):
        idx = [i for i in range(len(keys)) if strata[i] == s]
        t_idx = sorted((i for i in idx if treated[i]), key=lambda i: (-scores[i], keys[i]))
        c_idx = [i for i in idx if not treated[i]]
        used: set[int] = set()
        for ti in t_idx:
            cands = [(abs(scores[c] - scores[ti]), keys[c], c) for c in c_idx if c not in used]
            if not cands:
                continue
            d, _, c = min(cands)
            if d <= caliper:
                pairs.append((ti, c))
                used.add(c)
    return pairs


def smd(tv: np.ndarray, cv: np.ndarray, den: float | None = None):
    if den is None:
        den = float(np.sqrt((tv.var() + cv.var()) / 2.0))
        if den <= 1e-12:
            den = float(np.concatenate([tv, cv]).std())
    value = 0.0 if den <= 1e-12 else float((tv.mean() - cv.mean()) / den)
    return value, den


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "tests/ia-causal/fixtures/matching-golden.json"))
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    X, t, strata, keys = make_data(args.seed)
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    Z = (X - mean) / std

    intercept, coef, solver = fit_sklearn(Z, t, LAMBDA)
    np_intercept, np_coef = fit_numpy(Z, t, LAMBDA)
    gap = max(abs(intercept - np_intercept), float(np.max(np.abs(coef - np_coef))))
    if gap > 1e-6:
        raise SystemExit(f"scikit-learn ({solver}) et Newton numpy divergent : {gap:.2e}")

    scores = intercept + Z @ coef
    caliper = CALIPER_SD * float(scores.std())
    pairs = greedy_match(scores.tolist(), t.tolist(), strata, keys, caliper)

    ti = np.flatnonzero(t == 1)
    ci = np.flatnonzero(t == 0)
    mt = np.array([p[0] for p in pairs])
    mc = np.array([p[1] for p in pairs])
    smd_before, smd_after = [], []
    for k in range(X.shape[1]):
        before, den = smd(X[ti, k], X[ci, k])
        after, _ = smd(X[mt, k], X[mc, k], den)
        smd_before.append(before)
        smd_after.append(after)

    golden = {
        "lambda": LAMBDA,
        "caliper_sd": CALIPER_SD,
        "seed": args.seed,
        "units": [{"key": keys[i], "stratum": strata[i], "treated": int(t[i]), "x": [float(v) for v in X[i]]} for i in range(len(keys))],
        "expected": {
            "intercept": intercept,
            "coef": [float(c) for c in coef],
            "caliper": caliper,
            "pairs": [[keys[a], keys[b]] for a, b in pairs],
            "smd_before": smd_before,
            "smd_after": smd_after,
            "sklearn": solver,
            "numpy_max_gap": gap,
        },
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(golden, ensure_ascii=False), encoding="utf-8")
    print(
        f"{out} : {len(keys)} unités, {int(t.sum())} suivis, {len(pairs)} paires, solveur {solver}, "
        f"écart numpy {gap:.1e}, |DS| max avant {max(map(abs, smd_before)):.3f} après {max(map(abs, smd_after)):.3f}"
    )


if __name__ == "__main__":
    main()

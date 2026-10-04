"""Protocole temporel à origines glissantes (mois = indice année * 12 + mois - 1 de la fin de mois as_of)."""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import models as MD
from .data import month_label

HORIZON = 6
CAL_MONTHS = 6
KEEP = ["employee_id", "matricule", "as_of", "month", "y6", "sex", "age_band"]


@dataclass
class Split:
    origin: int
    train: np.ndarray
    cal: np.ndarray
    test: np.ndarray
    history: np.ndarray

    def describe(self, month) -> dict:
        span = lambda m: f"{month_label(month[m].min())} → {month_label(month[m].max())}" if m.any() else "vide"  # noqa: E731
        return {"origin": month_label(self.origin), "train": span(self.train), "cal": span(self.cal),
                "test": span(self.test), "history": span(self.history)}


def make_split(month: np.ndarray, origin: int, cal_months: int = CAL_MONTHS, horizon: int = HORIZON) -> Split:
    """test : snapshots [O, O+5] ; calibration : [O-11, O-6] (horizon clos avant O) ;
    apprentissage : horizon clos avant la première cohorte de calibration (t + 6 <= O-11) ;
    history : tout ce dont l'horizon est clos à l'origine (t + 6 <= O), pour la recette de production."""
    test = (month >= origin) & (month <= origin + horizon - 1)
    cal_hi = origin - horizon
    cal_lo = cal_hi - cal_months + 1
    cal = (month >= cal_lo) & (month <= cal_hi)
    train = month + horizon <= cal_lo
    history = month + horizon <= origin
    return Split(origin, train, cal, test, history)


def default_origins(month: np.ndarray, n: int = 6, step: int = 6, horizon: int = HORIZON) -> list[int]:
    last = int(month.max()) - (horizon - 1)
    return [last - step * i for i in range(n - 1, -1, -1)]


def events(meta: pd.DataFrame, mask: np.ndarray) -> int:
    """Démissions observées : salariés distincts avec au moins une ligne positive."""
    sub = meta.loc[mask]
    return int(sub.loc[sub["y6"] == 1, "employee_id"].nunique())


def run_protocol(meta, X, names, rules, origins, models=("B0", "LOGREG", "LOGREG_PROD", "LGBM"), X_alt=None,
                 allowed=None, fixed=None, log=print):
    """Prédictions de test empilées sur les origines. X sert à l'apprentissage et au test ; X_alt (optionnel) :
    second jeu de variables sur lequel les mêmes modèles sont aussi appliqués (colonnes suffixées _alt).
    allowed : masque des lignes utilisables pour l'apprentissage et la calibration (sous-échantillon de salariés).
    fixed : hyperparamètres imposés {"C": ..., "lgbm": {...}} au lieu du réglage temporel interne."""
    fixed = fixed or {}
    month = meta["month"].to_numpy()
    y = meta["y6"].to_numpy()
    allowed = np.ones(len(meta), dtype=bool) if allowed is None else allowed
    preds, infos = [], []
    for origin in origins:
        sp = make_split(month, origin)
        tr, ca, te, hi = sp.train & allowed, sp.cal & allowed, sp.test, sp.history & allowed
        out = meta.loc[te, KEEP].copy()
        out["origin"] = month_label(origin)
        info = {**sp.describe(month), "n_train": int(tr.sum()), "pos_train": int(y[tr].sum()), "events_train": events(meta, tr),
                "n_cal": int(ca.sum()), "pos_cal": int(y[ca].sum()), "n_history": int(hi.sum()), "pos_history": int(y[hi].sum()),
                "events_history": events(meta, hi), "n_test": int(te.sum()), "pos_test": int(y[te].sum())}
        tests = {"": X[te]} | ({"_alt": X_alt[te]} if X_alt is not None else {})
        if "B0" in models:
            for sfx, Xt in tests.items():
                out["B0" + sfx] = MD.b0_points(Xt, names, rules)
        if "LOGREG" in models:
            m = MD.train_logreg(X[tr], y[tr], month[tr], C=fixed.get("C"))
            m.a, m.b = MD.platt_fit(m.logit(X[ca]), y[ca])
            for sfx, Xt in tests.items():
                out["LOGREG" + sfx] = m.proba(Xt)
            info["logreg"] = {"C": m.C, "platt_a": m.a, "platt_b": m.b, "tuning": m.extra["tuning"]}
        if "LOGREG_PROD" in models:
            m = MD.train_logreg_prod(X[hi], y[hi], month[hi], C=fixed.get("C"))
            for sfx, Xt in tests.items():
                out["LOGREG_PROD" + sfx] = m.proba(Xt)
            info["logreg_prod"] = {"C": m.C, "platt_a": m.a, "platt_b": m.b, "tuning": m.extra["tuning"]}
        if "LOGREG_PLATT_IN" in models:
            m = MD.train_logreg(X[hi], y[hi], month[hi], C=fixed.get("C"))
            m.a, m.b = MD.platt_fit(m.logit(X[hi]), y[hi])
            out["LOGREG_PLATT_IN"] = m.proba(X[te])
            info["logreg_platt_in"] = {"C": m.C, "platt_a": m.a, "platt_b": m.b}
        if "LOGREG_NW" in models:
            m = MD.train_logreg(X[tr], y[tr], month[tr], class_weight=None, C=fixed.get("C"))
            m.a, m.b = MD.platt_fit(m.logit(X[ca]), y[ca])
            out["LOGREG_NW"] = m.proba(X[te])
            info["logreg_nw"] = {"C": m.C, "platt_a": m.a, "platt_b": m.b}
        if "LGBM" in models:
            g = MD.train_lgbm(X[tr], y[tr], month[tr], hp=fixed.get("lgbm"))
            g.a, g.b = MD.platt_fit(g.logit(X[ca]), y[ca])
            for sfx, Xt in tests.items():
                out["LGBM" + sfx] = g.proba(Xt)
            info["lgbm"] = {**{k: v for k, v in g.params.items() if k != "tuning"}, "platt_a": g.a, "platt_b": g.b,
                            "tuning": g.params.get("tuning", [])}
        if log:
            log(f"  origine {info['origin']} : train {info['train']} ({info['n_train']} l., {info['events_train']} dém.), "
                f"cal {info['cal']}, test {info['test']} ({info['n_test']} l., {info['pos_test']} pos.)")
        preds.append(out)
        infos.append(info)
    return pd.concat(preds, ignore_index=True), infos

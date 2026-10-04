"""Étude Q1 : (a) inflation selon le découpage, (b) variables naïves vs as-of, (d) courbe d'apprentissage."""
import numpy as np
import pandas as pd
from joblib import Parallel, delayed

from . import metrics as M
from . import models as MD
from .data import month_label
from .protocol import events, make_split


def _tuned_fit_eval(X, y, tr, fit, val, te, b0_test, window=None) -> dict:
    """Réglage (C, grille LightGBM) sur fit/val, réajustement sur tr, AUC sur te (et sur te restreint à window)."""
    C, _, _ = MD.select_C(X[fit], y[fit], X[val], y[val])
    hp, _ = MD.select_lgbm(X[fit], y[fit], X[val], y[val], num_threads=1)
    m = MD.fit_logreg(X[tr], y[tr], C)
    g = MD.fit_lgbm(X[tr], y[tr], {**hp["params"], "num_threads": 1}, hp["n_rounds"])
    s = {"B0": b0_test, "LOGREG": m.logit(X[te]), "LGBM": g.logit(X[te])}
    out = {k: M.auc(y[te], v) for k, v in s.items()}
    if window is not None:
        w = window[te]
        out |= {f"{k}_fenetre": M.auc(y[te][w], v[w]) for k, v in s.items()}
    return out | {"C": C, "lgbm": {**hp["params"], "n_rounds": hp["n_rounds"]}}


def _split_task(meta, X, b0, kind, rep, test_frac, seed, first_origin, X_naive=None, b0_naive=None):
    y = meta["y6"].to_numpy()
    month = meta["month"].to_numpy()
    emp = meta["employee_id"].to_numpy()
    if kind == "temporel":
        sp = make_split(month, rep)
        hist = np.flatnonzero(sp.history)
        fit, val = MD.inner_split(month[hist])
        fit_m = np.zeros(len(y), dtype=bool)
        val_m = np.zeros(len(y), dtype=bool)
        fit_m[hist[fit]] = True
        val_m[hist[val]] = True
        return {"split": kind, "rep": month_label(rep), **_tuned_fit_eval(X, y, sp.history, fit_m, val_m, sp.test, b0[sp.test])}
    rng = np.random.default_rng(seed + rep)
    if kind == "par_salarie":
        uniq = np.unique(emp)
        test_emp = rng.choice(uniq, int(round(len(uniq) * test_frac)), replace=False)
        rest = np.setdiff1d(uniq, test_emp)
        te = np.isin(emp, test_emp)
        val = np.isin(emp, rng.choice(rest, int(round(len(rest) * test_frac)), replace=False))
    else:
        te = rng.random(len(y)) < test_frac
        val = ~te & (rng.random(len(y)) < test_frac)
    if kind == "aleatoire_ligne_naif":
        X, b0 = X_naive, b0_naive
    return {"split": kind, "rep": rep, **_tuned_fit_eval(X, y, ~te, ~te & ~val, val, te, b0[te], month >= first_origin)}


def split_inflation(meta, X, b0, origins, reps=5, test_frac=0.25, X_naive=None, b0_naive=None, seed=101, n_jobs=4,
                    log=print) -> dict:
    """AUC annoncée par chaque protocole, réglage des hyperparamètres compris (validation interne tirée de la même
    façon que le test : lignes au hasard, salariés au hasard, ou derniers mois de l'historique)."""
    kinds = ["aleatoire_ligne", "par_salarie"] + (["aleatoire_ligne_naif"] if X_naive is not None else [])
    tasks = [(k, r) for r in range(reps) for k in kinds] + [("temporel", o) for o in origins]
    if log:
        log(f"  {len(tasks)} ajustements réglés")
    slim = meta[["employee_id", "y6", "month"]]
    rows = Parallel(n_jobs=n_jobs)(
        delayed(_split_task)(slim, X, b0, k, r, test_frac, seed, min(origins), X_naive if k.endswith("naif") else None,
                             b0_naive if k.endswith("naif") else None) for k, r in tasks)
    df = pd.DataFrame(rows)
    temporal = df[df["split"] == "temporel"]
    summary = []
    for split in ["aleatoire_ligne", "aleatoire_ligne_naif", "par_salarie", "temporel"]:
        d = df[df["split"] == split]
        if d.empty:
            continue
        s = {"split": split, "reps": int(len(d))}
        for m in ("B0", "LOGREG", "LGBM"):
            s[m] = {"mean": float(d[m].mean()), "sd": float(d[m].std(ddof=1)) if len(d) > 1 else 0.0,
                    "inflation": float(d[m].mean() - temporal[m].mean())}
            col = f"{m}_fenetre" if split != "temporel" else m
            s[m]["mean_fenetre"] = float(d[col].mean())
            s[m]["inflation_fenetre"] = float(d[col].mean() - temporal[m].mean())
        summary.append(s)
    return {"summary": summary, "runs": df.to_dict(orient="records"),
            "note": "temporel = moyenne des AUC par origine (apprentissage sur l'historique dont l'horizon est clos à l'origine) ; "
                    "_fenetre = AUC des découpages aléatoires restreinte aux snapshots de la fenêtre de test temporelle"}


def _curve_task(meta, X, b0, origins, sample, size, rep, fixed, rate):
    y = meta["y6"].to_numpy()
    month = meta["month"].to_numpy()
    allowed = np.isin(meta["employee_id"].to_numpy(), sample)
    out = []
    for o in origins:
        sp = make_split(month, o)
        hi, te = sp.history & allowed, sp.test
        yt = y[te].astype(float)
        row = {"size": size, "rep": rep, "origin": month_label(o), "n_rows": int(hi.sum()), "n_pos": int(y[hi].sum()),
               "eligible_per_month": float(allowed.sum() / len(np.unique(month))),
               "events": events(meta, hi), "auc_b0": M.auc(yt, b0[te]),
               "lift_b0": M.at_capacity(yt, M.capacity_flags(b0[te], month[te], rate, True))["lift_at_k"]}
        if y[hi].sum() >= 2:
            m = MD.train_logreg_prod(X[hi], y[hi], month[hi])
            p = m.proba(X[te])
            row |= {"auc_logreg": M.auc(yt, p), "oe_logreg": M.oe_ratio(yt, p), "C": m.C,
                    "lift_logreg": M.at_capacity(yt, M.capacity_flags(p, month[te], rate))["lift_at_k"]}
            g = MD.fit_lgbm(X[hi], y[hi], {**fixed["lgbm"]["params"], "num_threads": 1}, fixed["lgbm"]["n_rounds"])
            row["auc_lgbm"] = M.auc(yt, g.logit(X[te]))
        out.append(row)
    return out


EVENT_BINS = (0, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 10_000)


def learning_curve(meta, X, b0, origins, fixed, rate, sizes=(100, 200, 400, 800, None), reps=None, seed=202,
                   n_jobs=4, log=print) -> dict:
    """Sous-échantillons de salariés (taille = salariés distincts du panel) ; recette de production entraînée sur
    l'historique de ces salariés ; évaluation appariée avec B0 sur toute la cohorte de test de chaque origine."""
    reps = reps or {100: 20, 200: 20, 400: 15, 800: 10}
    emps = np.unique(meta["employee_id"].to_numpy())
    rng = np.random.default_rng(seed)
    tasks = []
    for size in sizes:
        for r in range(1 if size is None else reps[size]):
            sample = emps if size is None else rng.choice(emps, size, replace=False)
            tasks.append((sample, len(sample), r))
    if log:
        log(f"  {len(tasks)} sous-échantillons x {len(origins)} origines")
    slim = meta[["employee_id", "y6", "month"]]
    res = Parallel(n_jobs=n_jobs)(delayed(_curve_task)(slim, X, b0, origins, s, n, r, fixed, rate) for s, n, r in tasks)
    df = pd.DataFrame([row for part in res for row in part])
    df["delta"] = df["auc_logreg"] - df["auc_b0"]
    df["delta_lgbm"] = df["auc_lgbm"] - df["auc_logreg"]
    by_size = []
    for size, d in df.groupby("size"):
        by_size.append({"size": int(size), "runs": int(len(d)), "eligible_per_month": float(d["eligible_per_month"].mean()),
                        "events_median": float(d["events"].median()),
                        "events_range": [int(d["events"].min()), int(d["events"].max())],
                        "auc_b0": float(d["auc_b0"].mean()), "auc_logreg": float(d["auc_logreg"].mean()),
                        "auc_logreg_sd": float(d["auc_logreg"].std(ddof=1)) if len(d) > 1 else 0.0,
                        "auc_lgbm": float(d["auc_lgbm"].mean()), "delta_mean": float(d["delta"].mean()),
                        "p_logreg_gt_b0": float((d["delta"] > 0).mean()), "p_lgbm_gt_logreg": float((d["delta_lgbm"] > 0).mean()),
                        "oe_in_range": float(d["oe_logreg"].between(0.8, 1.25).mean()),
                        "lift_logreg": float(d["lift_logreg"].mean()), "lift_b0": float(d["lift_b0"].mean())})
    by_events = summarize_by_events(df)
    return {"by_size": by_size, "by_events": by_events, "threshold": propose_threshold(by_events), "runs": df.to_dict(orient="records")}


def summarize_by_events(df: pd.DataFrame) -> list[dict]:
    bins = pd.cut(df["events"], EVENT_BINS, right=False)
    out = []
    for b, d in df.groupby(bins, observed=True):
        delta = d["auc_logreg"] - d["auc_b0"]
        out.append({"events_from": int(b.left), "events_to": int(b.right), "runs": int(len(d)),
                    "delta_mean": float(delta.mean()), "delta_p10": float(delta.quantile(0.1)),
                    "p_logreg_gt_b0": float((delta > 0).mean()),
                    "p_lgbm_gt_logreg": float((d["auc_lgbm"] > d["auc_logreg"]).mean()),
                    "oe_in_range": float(d["oe_logreg"].between(0.8, 1.25).mean()),
                    "lift_delta_mean": float((d["lift_logreg"] - d["lift_b0"]).mean()),
                    "p_lift_logreg_gt_b0": float((d["lift_logreg"] > d["lift_b0"]).mean())})
    return out


def _first_stable(rows, ok):
    return next((rows[i]["events_from"] for i in range(len(rows)) if all(ok[i:])), None)


def propose_threshold(by_events: list[dict], delta_min=0.02, p_min=0.9, oe_min=2 / 3, min_runs=5) -> dict:
    """Bornes basses de la première tranche de démissions observées à partir de laquelle la condition tient dans cette
    tranche et toutes les suivantes (tranches d'au moins 5 essais) :
    n1_auc : gain moyen d'AUC de LOGREG sur B0 >= 0,02 ; n1_strict : idem et LOGREG gagne dans >= 90 % des essais ;
    n_calibration : O/E dans [0,8 ; 1,25] dans >= 2/3 des essais ; n2_lgbm : LightGBM bat LOGREG dans >= 90 % des essais."""
    rows = [r for r in by_events if r["runs"] >= min_runs]
    return {
        "criteria": {"delta_min": delta_min, "p_min": p_min, "oe_min": oe_min, "min_runs": min_runs},
        "n1_auc": _first_stable(rows, [r["delta_mean"] >= delta_min for r in rows]),
        "n1_strict": _first_stable(rows, [r["delta_mean"] >= delta_min and r["p_logreg_gt_b0"] >= p_min for r in rows]),
        "n_calibration": _first_stable(rows, [r["oe_in_range"] >= oe_min for r in rows]),
        "n2_lgbm": _first_stable(rows, [r["p_lgbm_gt_logreg"] >= p_min for r in rows]),
    }


def naive_eval_frame(pred_main: pd.DataFrame, pred_naive: pd.DataFrame) -> pd.DataFrame:
    """Aligne les prédictions : *_nom = nominal/nominal ; * = naïf/naïf ; *_alt = appris en naïf, appliqué au nominal."""
    keep = ["employee_id", "as_of"] + [c for c in ("B0", "LOGREG", "LGBM") if c in pred_main]
    nom = pred_main[keep].rename(columns={c: f"{c}_nom" for c in keep[2:]})
    return pred_naive.merge(nom, on=["employee_id", "as_of"], how="inner", validate="one_to_one")

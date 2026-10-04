"""Volet ML hors ligne : protocole temporel, évaluation, équité, étude Q1, bundle de production LOGREG.

python ml/train/run.py --db data/app.db --sim data/sim/mixte_medium_s1 --naive-csv data/ml/panel-naive-app.csv --bundle
python ml/train/run.py golden-status models/turnover/<version> <écart max rapporté par scripts/model.ts verify>
"""
import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import date
from pathlib import Path

import numpy as np

ML_DIR = str(Path(__file__).resolve().parents[1])
sys.path.insert(0, ML_DIR)
os.environ["PYTHONPATH"] = os.pathsep.join(filter(None, [ML_DIR, os.environ.get("PYTHONPATH")]))

from train import bundle as BU  # noqa: E402
from train import data as D  # noqa: E402
from train import evaluate as EV  # noqa: E402
from train import fairness as FA  # noqa: E402
from train import models as MD  # noqa: E402
from train import protocol as P  # noqa: E402
from train import study as ST  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
MODELS_DIR = D.ROOT / "models" / "turnover"
MAIN_MODELS = ["B0", "LOGREG", "LOGREG_PROD", "LOGREG_PLATT_IN", "LOGREG_NW", "LGBM"]
PAIRS = (("LOGREG", "B0"), ("LOGREG_PROD", "B0"), ("LGBM", "LOGREG"), ("LGBM", "LOGREG_PROD"),
         ("LOGREG_PROD", "LOGREG"), ("LOGREG", "LOGREG_NW"))
NAIVE_PAIRS = (("LOGREG", "LOGREG_nom"), ("LOGREG_alt", "LOGREG_nom"), ("LGBM", "LGBM_nom"), ("LGBM_alt", "LGBM_nom"),
               ("B0", "B0_nom"))


def clean(o, sig=4):
    """Arrondi à `sig` chiffres significatifs, NaN/inf -> null (JSON strict pour Node)."""
    if isinstance(o, dict):
        return {str(k): clean(v, sig) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v, sig) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        o = float(o)
        return float(f"{o:.{sig}g}") if np.isfinite(o) else None
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def log(msg):
    print(msg, flush=True)


def fixed_lgbm(infos) -> dict:
    """Hyperparamètres LightGBM les plus retenus par le protocole (pour la courbe d'apprentissage)."""
    keys = Counter((i["lgbm"]["num_leaves"], i["lgbm"]["min_child_samples"]) for i in infos)
    nl, mc = keys.most_common(1)[0][0]
    rounds = int(np.median([i["lgbm"]["n_rounds"] for i in infos]))
    return {"lgbm": {"params": {"num_leaves": nl, "min_child_samples": mc}, "n_rounds": rounds}}


def bundle_metrics(name, ev, origins_eval, per_origin, cur, fair, mi, rate) -> dict:
    lp = ev["models"]["LOGREG_PROD"]
    comp = {m: {k: ev["models"][m].get(k) for k in ("auc", "pr_auc", "lift_at_k", "precision_at_k", "oe_ratio", "slope", "brier")}
            | {"auc_ci": ev["models"][m]["ci"]["auc"]} for m in ev["models"]}
    top_mi = {a: mi[a]["features"][:5] for a in ("sex", "age_band")}
    return {
        "horizon_months": 6,
        "auc": lp["auc"], "auc_ci": lp["ci"]["auc"],
        "pr_auc": lp["pr_auc"], "pr_auc_ci": lp["ci"]["pr_auc"],
        "brier": lp["brier"],
        "eval": {"n": ev["n"], "n_pos": ev["n_pos"], "base_rate": ev["base_rate"], "n_employees": ev["n_employees"],
                 "period": f"{origins_eval[0]} → {origins_eval[1]} (6 origines glissantes, test sur les 6 mois suivant chaque origine)",
                 "dataset": name,
                 "protocol": "Recette de production rejouée à chaque origine : C et Platt choisis hors échantillon sur les 6 derniers "
                             "mois d'historique à horizon clos, coefficients réajustés sur tout l'historique. IC 95 % : bootstrap "
                             f"groupé par salarié ({ev['n_boot']} tirages)."},
        "calibration": {"method": "platt", "oe_ratio": lp["oe_ratio"], "oe_ci": lp["ci"]["oe_ratio"], "slope": lp["slope"],
                        "slope_ci": lp["ci"]["slope"], "intercept": lp["cal_intercept"],
                        "by_horizon": [{"horizon": 6, "oe_ratio": lp["oe_ratio"], "slope": lp["slope"], "brier": lp["brier"]}],
                        "bins": cur["bins"]},
        "lift": {"k_rate": rate, "lift_at_k": lp["lift_at_k"], "lift_ci": lp["ci"]["lift_at_k"], "precision_at_k": lp["precision_at_k"],
                 "recall_at_k": lp["recall_at_k"], "curve": cur["lift_curve"]},
        "decision_curve": cur["decision_curve"],
        "fairness": {"min_group_size": fair["min_group_size"], "sex": fair["sex"], "age_band": fair["age_band"],
                     "note": "Simulateur : démonstration de l'outil, interprétation réservée aux données client. Sexe et âge ne sont "
                             "pas des variables du modèle ; information mutuelle variable-attribut en nats (share = part de l'entropie).",
                     "mutual_information": top_mi},
        "comparison": {"models": comp, "diffs": ev["diffs"], "oracle_subset": ev.get("oracle_subset")},
        "per_origin": per_origin,
        "golden": {"status": "A_VERIFIER", "max_abs_diff": None},
    }


def run_study(args):
    t0 = time.perf_counter()
    spec = D.load_spec()
    names = D.feature_names(spec)
    rules = spec["b0_rules"]
    meta, X = D.load_panel(args.db, spec)
    settings = D.load_settings(args.db)
    rate = settings["capacity_rate"]
    y = meta["y6"].to_numpy()
    month = meta["month"].to_numpy()
    b0 = MD.b0_points(X, names, rules)
    origins = P.default_origins(month)
    name = args.name or Path(args.db).stem
    n_boot = 50 if args.quick else args.n_boot
    log(f"Base {args.db} : {len(meta)} snapshots à suivi complet, {int(y.sum())} positifs ({y.mean():.2%}), "
        f"{meta['employee_id'].nunique()} salariés, capacité {rate:.0%}")
    res = {"dataset": name, "db": str(args.db), "n_rows": len(meta), "n_pos": int(y.sum()), "base_rate": float(y.mean()),
           "n_employees": int(meta["employee_id"].nunique()), "events": P.events(meta, np.ones(len(meta), bool)),
           "panel": f"{D.month_label(month.min())} → {D.month_label(month.max())}", "capacity_rate": rate,
           "data_hash": D.data_hash(meta)}

    log("Protocole temporel (origines glissantes)")
    pred, infos = P.run_protocol(meta, X, names, rules, origins, models=MAIN_MODELS, log=log)
    oracle = D.load_oracle(args.sim) if args.sim else None
    if oracle is not None:
        pred = pred.merge(oracle, on=["matricule", "as_of"], how="left", validate="many_to_one")
    res["origins"] = infos
    log(f"Évaluation (bootstrap groupé, {n_boot} tirages)")
    ev = EV.evaluate(pred, MAIN_MODELS, rate, n_boot=n_boot, pairs=PAIRS, oracle="oracle" if oracle is not None else None)
    res["evaluation"] = ev
    res["per_origin"] = EV.per_origin(pred, MAIN_MODELS, rate)
    res["curves"] = {m: EV.curves(pred, m) for m in ("LOGREG_PROD", "LOGREG", "LGBM")}
    log(f"  AUC B0 {ev['models']['B0']['auc']:.3f} · LOGREG {ev['models']['LOGREG']['auc']:.3f} · "
        f"LOGREG_PROD {ev['models']['LOGREG_PROD']['auc']:.3f} · LGBM {ev['models']['LGBM']['auc']:.3f}"
        + (f" · oracle {ev['oracle_subset']['auc']['ORACLE']:.3f} (sous-ensemble)" if "oracle_subset" in ev else ""))

    log("Modèle final (toutes les données à suivi complet)")
    final = MD.train_logreg_prod(X, y, month)
    res["final_model"] = {"C": final.C, "platt_a": final.a, "platt_b": final.b, "tuning": final.extra["tuning"],
                          "calibration_rows": final.extra["calibration_rows"], "in_sample_oe": float(y.mean() / final.proba(X).mean()),
                          "coef": dict(zip(names, map(float, final.coef)))}

    log("Équité")
    res["fairness"] = FA.group_report(pred, "LOGREG_PROD", rate, n_boot=100 if args.quick else 500)
    res["proxies"] = FA.proxy_mutual_information(meta, X, names, score=final.proba(X))

    if not args.skip_q1:
        Xn = None
        if args.naive_csv:
            log("Q1b : variables naïves (date d'événement)")
            Xn = D.align_features(meta, D.load_feature_csv(args.naive_csv, names), names)
            res["naive_changed_rows"] = {n: float((Xn[:, j] != X[:, j]).mean()) for j, n in enumerate(names) if (Xn[:, j] != X[:, j]).any()}
            pred_n, _ = P.run_protocol(meta, Xn, names, rules, origins, models=("B0", "LOGREG", "LGBM"), X_alt=X, log=None)
            frame = ST.naive_eval_frame(pred, pred_n)
            cols = ["B0_nom", "B0", "LOGREG_nom", "LOGREG", "LOGREG_alt", "LGBM_nom", "LGBM", "LGBM_alt"]
            res["q1b_naive"] = EV.evaluate(frame, cols, rate, n_boot=n_boot, pairs=NAIVE_PAIRS, oracle=None)
        log("Q1a : inflation selon le découpage")
        res["q1a_splits"] = ST.split_inflation(meta, X, b0, origins, reps=1 if args.quick else args.reps, X_naive=Xn,
                                               b0_naive=MD.b0_points(Xn, names, rules) if Xn is not None else None, log=log)
        if not args.skip_curve:
            log("Q1d : courbe d'apprentissage")
            reps = {100: 2, 200: 2, 400: 1, 800: 1} if args.quick else None
            res["q1d_curve"] = ST.learning_curve(meta, X, b0, origins, fixed_lgbm(infos), rate, reps=reps, log=log)

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{name}.json"
    out.write_text(json.dumps(clean(res, 6), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    log(f"Résultats : {out}")

    if args.bundle:
        version = args.version or f"logreg-v1-{date.today():%Y%m%d}"
        p_all = final.proba(X)
        test_span = (pred["as_of"].min()[:7], pred["as_of"].max()[:7])
        metrics = bundle_metrics(name, ev, test_span, res["per_origin"], res["curves"]["LOGREG_PROD"], res["fairness"],
                                 res["proxies"], rate)
        b = BU.build_bundle(final, names, spec["fsv"], version, base_rate=float(y.mean()), data_hash=res["data_hash"],
                            train_rows=len(meta), train_from=meta["as_of"].min(), train_to=meta["as_of"].max(),
                            metrics=clean(metrics),
                            extra={"hyperparameters": {"C": final.C, "penalty": "l2", "class_weight": "balanced",
                                                       "calibration_rows": final.extra["calibration_rows"]},
                                   "dataset": name})
        idx = BU.pick_golden_rows(X, p_all)
        gold = BU.golden(b, X[idx])
        diff = float(np.max(np.abs(np.array([g["p"] for g in gold]) - p_all[idx])))
        d = BU.write_bundle(MODELS_DIR / version, b, gold)
        log(f"Bundle {version} écrit dans {d} (golden {len(gold)} lignes, écart formule/numpy {diff:.1e})")
    log(f"Durée totale {time.perf_counter() - t0:.0f} s")


def golden_status(bundle_dir: str, max_diff: str):
    f = Path(bundle_dir) / "model.json"
    b = json.loads(f.read_text(encoding="utf-8"))
    d = float(max_diff)
    b["metrics"]["golden"] = {"status": "OK" if d <= 1e-9 else "ECHEC", "max_abs_diff": d, "rows": 200,
                              "checked_by": "npx tsx scripts/model.ts verify"}
    f.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"metrics.golden = {b['metrics']['golden']}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "golden-status":
        return golden_status(*sys.argv[2:4])
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(D.ROOT / "data" / "app.db"))
    ap.add_argument("--sim", help="dossier du simulateur (ground_truth/oracle_prob6.csv)")
    ap.add_argument("--naive-csv", help="panel naïf exporté par scripts/export-panel.ts --mode naive")
    ap.add_argument("--name", help="nom du jeu (résultats ml/train/results/<nom>.json)")
    ap.add_argument("--n-boot", type=int, default=1000)
    ap.add_argument("--reps", type=int, default=5, help="répétitions des découpages aléatoires (Q1a)")
    ap.add_argument("--skip-q1", action="store_true")
    ap.add_argument("--skip-curve", action="store_true")
    ap.add_argument("--quick", action="store_true", help="essai rapide (bootstrap 50, répétitions réduites)")
    ap.add_argument("--bundle", action="store_true", help="écrit models/turnover/logreg-v1-<AAAAMMJJ>/")
    ap.add_argument("--version")
    run_study(ap.parse_args())


if __name__ == "__main__":
    main()

"""Évaluation hors ligne (origines glissantes) et export du bundle ABSENTEISME.

python -m ml.absenteeism.run --db data/app.db [--bundle models/absenteeism] [--out ml/absenteeism/results]
Lecture seule (mode=ro). Aucun écrit dans la base.
"""
import argparse
import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import model as M
from . import series as S

VAL = ("2023-06", "2024-05")
TEST = ("2024-06", "2026-05")
CALIB_MONTHS = 24
LEVEL = 0.8
GRID = [
    dict(alpha=a, offset=o, weight=w, split=s)
    for a in (0.01, 0.1, 1.0, 10.0)
    for o in ("ma12", "none")
    for w in ("none", "sqrt_size")
    for s in ("pooled", "family")
]


def family(scope):
    return "EQUIPE" if scope == "EQUIPE" else "AGREGE"


def weight(ex, kind):
    return 1.0 if kind == "none" else math.sqrt(sum(ex.own[1]) / 12.0)


def train(exs, cfg, h):
    groups = {"ALL": exs} if cfg["split"] == "pooled" else {f: [e for e in exs if family(e.scope) == f] for f in ("EQUIPE", "AGREGE")}
    out = {}
    for g, lst in groups.items():
        lst = [e for e in lst if e.h == h]
        out[g] = M.ridge_dict(M.fit_ridge([e.x for e in lst], [e.y for e in lst], cfg["alpha"], cfg["offset"], [weight(e, cfg["weight"]) for e in lst]))
    return out


def model_for(models, scope):
    return models["ALL"] if "ALL" in models else models[family(scope)]


def rolling(by_origin, origins, cfg, lgbm=False):
    """Prévisions hors échantillon : à l'origine O, apprentissage sur les exemples dont la cible t <= O - 1."""
    preds = []
    all_o = sorted(by_origin)
    for o in origins:
        train_ex = [e for oo in all_o if oo < o for e in by_origin[oo] if e.origin + e.h <= o - 1]
        for h in M.HORIZONS:
            mods = train(train_ex, cfg, h)
            lg = fit_lgbm([e for e in train_ex if e.h == h]) if lgbm else None
            for e in by_origin[o]:
                if e.h != h:
                    continue
                p = M.predict_one(model_for(mods, e.scope), e.x)
                row = dict(unit=e.unit, scope=e.scope, origin=o, h=h, y=e.y, pred=p, s=M.scale(p, e.own[1]),
                           naive_s=M.naive_seasonal(e), ma3=M.moving_average(e, 3), ma12=M.moving_average(e, 12))
                if lg is not None:
                    row["lgbm"] = max(0.0, float(lg.predict(np.array([e.x]))[0]) + e.x[M.FEATURES.index("ma12")])
                preds.append(row)
    return preds


def fit_lgbm(exs):
    import lightgbm as lgb

    X = np.array([e.x for e in exs])
    y = np.array([e.y - e.x[M.FEATURES.index("ma12")] for e in exs])
    m = lgb.LGBMRegressor(n_estimators=200, learning_rate=0.03, num_leaves=15, min_child_samples=50, subsample=0.8,
                          subsample_freq=1, colsample_bytree=0.8, random_state=0, verbose=-1, n_jobs=2)
    return m.fit(X, y)


def quantiles(resid_rows, o):
    """Quantiles des résidus normalisés hors échantillon, cibles dans les CALIB_MONTHS mois <= O - 1, par famille et horizon."""
    q = {}
    for f in ("EQUIPE", "AGREGE"):
        for h in M.HORIZONS:
            z = [(r["y"] - r["pred"]) / r["s"] for r in resid_rows
                 if family(r["scope"]) == f and r["h"] == h and o - CALIB_MONTHS <= r["origin"] + h <= o - 1]
            if len(z) < 20:
                continue
            q[(f, h)] = (float(np.quantile(z, (1 - LEVEL) / 2)), float(np.quantile(z, 1 - (1 - LEVEL) / 2)))
    return q


def add_intervals(preds, calib_rows):
    cache = {}
    for r in preds:
        if r["origin"] not in cache:
            cache[r["origin"]] = quantiles(calib_rows, r["origin"])
        q = cache[r["origin"]].get((family(r["scope"]), r["h"]))
        if q is None:
            r["lo"] = r["hi"] = None
            continue
        r["lo"] = max(0.0, r["pred"] + q[0] * r["s"])
        r["hi"] = r["pred"] + q[1] * r["s"]


def mae(rows, key):
    return float(np.mean([abs(r[key] - r["y"]) for r in rows]))


def wape(rows, key):
    den = sum(r["y"] for r in rows)
    return float(sum(abs(r[key] - r["y"]) for r in rows) / den) if den > 0 else None


def smape(rows, key):
    v = [0.0 if r[key] + r["y"] == 0 else 2 * abs(r[key] - r["y"]) / (abs(r[key]) + abs(r["y"])) for r in rows]
    return float(np.mean(v))


def block_boot(rows, stat, n=1000, block=3, seed=7):
    """IC 95 % par bootstrap de blocs de `block` origines consécutives (garde la corrélation entre unités d'un même mois)."""
    origins = sorted({r["origin"] for r in rows})
    by_o = {}
    for r in rows:
        by_o.setdefault(r["origin"], []).append(r)
    blocks = [origins[i:i + block] for i in range(0, len(origins) - block + 1)]
    rng = random.Random(seed)
    k = math.ceil(len(origins) / block)
    vals = []
    for _ in range(n):
        sample = [r for _b in range(k) for o in rng.choice(blocks) for r in by_o[o]]
        v = stat(sample)
        if v is not None and not math.isnan(v):
            vals.append(v)
    return [float(np.quantile(vals, 0.025)), float(np.quantile(vals, 0.975))]


METHODS = [("pred", "Ridge (modèle)"), ("naive_s", "Naïf saisonnier"), ("ma3", "Moyenne mobile 3 mois"), ("ma12", "Moyenne mobile 12 mois")]


def evaluate(rows, with_lgbm):
    methods = METHODS + ([("lgbm", "LightGBM (comparaison)")] if with_lgbm else [])
    out = {}
    for scope in ("ENTREPRISE", "DEPARTEMENT", "EQUIPE"):
        for h in M.HORIZONS:
            rs = [r for r in rows if r["scope"] == scope and r["h"] == h]
            if not rs:
                continue
            cell = {"n": len(rs), "units": len({r["unit"] for r in rs}), "mean_rate": float(np.mean([r["y"] for r in rs]))}
            for key, _label in methods:
                cell[key] = {"mae": mae(rs, key), "wape": wape(rs, key), "smape": smape(rs, key)}
            for base in ("naive_s", "ma3", "ma12"):
                ratio = lambda s, b=base: (mae(s, "pred") / mae(s, b)) if mae(s, b) > 0 else None  # noqa: E731
                cell[f"ratio_vs_{base}"] = {"value": ratio(rs), "ci95": block_boot(rs, ratio)}
            iv = [r for r in rs if r["lo"] is not None]
            if iv:
                cov = lambda s: float(np.mean([r["lo"] <= r["y"] <= r["hi"] for r in s]))  # noqa: E731
                cell["interval"] = {"level": LEVEL, "n": len(iv), "coverage": cov(iv), "ci95": block_boot(iv, cov),
                                    "mean_width": float(np.mean([r["hi"] - r["lo"] for r in iv]))}
            out[f"{scope}|{h}"] = cell
    return out


def selection_score(rows):
    s = []
    for scope in ("ENTREPRISE", "DEPARTEMENT", "EQUIPE"):
        rs = [r for r in rows if r["scope"] == scope]
        if rs:
            s.append(mae(rs, "pred") / mae(rs, "ma12"))
    return float(np.mean(s))


def pct(x, d=2):
    return "–" if x is None else f"{100 * x:.{d}f}".replace(".", ",")


def tables(res):
    lines = ["| Portée | h | n | Taux moyen | Ridge MAE | Naïf saisonnier | MM 3 mois | MM 12 mois"
             + (" | LightGBM" if res["with_lgbm"] else "") + " | Ridge / MM12 [IC 95 %] | Couverture 80 % [IC 95 %] | Largeur moy. |",
             "|---|---|---|---|---|---|---|---|" + ("---|" if res["with_lgbm"] else "") + "---|---|---|"]
    for key, c in res["test"].items():
        scope, h = key.split("|")
        r = c["ratio_vs_ma12"]
        iv = c.get("interval")
        lg = f" | {pct(c['lgbm']['mae'], 3)}" if res["with_lgbm"] else ""
        lines.append(
            f"| {scope} | {h} | {c['n']} | {pct(c['mean_rate'])} % | {pct(c['pred']['mae'], 3)} | {pct(c['naive_s']['mae'], 3)} | "
            f"{pct(c['ma3']['mae'], 3)} | {pct(c['ma12']['mae'], 3)}{lg} | {r['value']:.3f} [{r['ci95'][0]:.3f} ; {r['ci95'][1]:.3f}] | "
            + (f"{pct(iv['coverage'], 1)} % [{pct(iv['ci95'][0], 1)} ; {pct(iv['ci95'][1], 1)}] | {pct(iv['mean_width'], 2)} pt |" if iv else "– | – |")
        )
    lines += ["", "| Portée | h | Ridge WAPE | Naïf s. WAPE | MM3 WAPE | MM12 WAPE | Ridge sMAPE | Naïf s. sMAPE | MM3 sMAPE | MM12 sMAPE |",
              "|---|---|---|---|---|---|---|---|---|---|"]
    for key, c in res["test"].items():
        scope, h = key.split("|")
        lines.append(f"| {scope} | {h} | " + " | ".join(f"{pct(c[k]['wape'], 1)} %" for k in ("pred", "naive_s", "ma3", "ma12")) + " | "
                     + " | ".join(f"{pct(c[k]['smape'], 1)} %" for k in ("pred", "naive_s", "ma3", "ma12")) + " |")
    return "\n".join(lines) + "\n"


def golden_cases(exs, bundle, n=200, seed=3):
    rng = random.Random(seed)
    picked = rng.sample(exs, min(n, len(exs)))
    cases = []
    for e in picked:
        m = bundle["models"][str(e.h)]
        mod = m["ALL"] if "ALL" in m else m[family(e.scope)]
        x = M.features(e.h, e.scope, e.own, e.parent, e.company, e.cal_t, e.cal_t12)
        p = M.predict_one(mod, x)
        q = bundle["intervals"]["quantiles"][family(e.scope)][str(e.h)]
        s = M.scale(p, e.own[1])
        cases.append({"h": e.h, "scope": e.scope, "own": [list(e.own[0]), list(e.own[1])], "parent": [list(e.parent[0]), list(e.parent[1])],
                      "company": [list(e.company[0]), list(e.company[1])], "cal_t": e.cal_t, "cal_t12": e.cal_t12,
                      "x": x, "value": p, "lower": max(0.0, p + q[0] * s), "upper": p + q[1] * s})
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/app.db")
    ap.add_argument("--out", default="ml/absenteeism/results")
    ap.add_argument("--bundle", default=None, help="dossier parent des bundles (models/absenteeism)")
    ap.add_argument("--no-lgbm", action="store_true")
    ap.add_argument("--bundle-only", action="store_true", help="réutilise la configuration retenue dans <out>/evaluation.json")
    args = ap.parse_args()

    data = S.load(args.db)
    last = data.months[-1]
    first_origin = data.months[0] + 11
    cal_cache = {}
    by_origin = {o: M.examples_at(data, o, cal_cache=cal_cache) for o in range(first_origin, last)}
    val = list(range(S.mi(VAL[0]), S.mi(VAL[1]) + 1))
    test = list(range(S.mi(TEST[0]), S.mi(TEST[1]) + 1))
    print(f"mois {S.ml(data.months[0])} → {S.ml(last)} ; origines {S.ml(first_origin)} → {S.ml(last - 1)}")

    out = Path(args.out)
    if args.bundle_only:
        res = json.loads((out / "evaluation.json").read_text(encoding="utf-8"))
        best = res["selected"]
        oos = rolling(by_origin, list(range(S.mi("2022-06"), last)), best)
        export_bundle(args, data, by_origin, best, oos, res, first_origin, cal_cache)
        return
    scores = []
    for cfg in GRID:
        rows = rolling(by_origin, val, cfg)
        scores.append((selection_score(rows), cfg))
        print(f"  validation {cfg} : {scores[-1][0]:.4f}")
    best = min(scores, key=lambda t: t[0])[1]
    print(f"retenu : {best}")

    calib_from = S.mi("2022-06")
    oos = rolling(by_origin, list(range(calib_from, last)), best, lgbm=False)
    test_rows = [r for r in rolling(by_origin, test, best, lgbm=not args.no_lgbm)]
    add_intervals(test_rows, oos)
    res = {
        "db": str(args.db), "months": [S.ml(data.months[0]), S.ml(last)], "validation_origins": list(VAL), "test_origins": list(TEST),
        "selected": best, "selection": [{"score": s, **c} for s, c in scores], "with_lgbm": not args.no_lgbm,
        "test": evaluate(test_rows, not args.no_lgbm),
    }
    out.mkdir(parents=True, exist_ok=True)
    (out / "evaluation.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "tables.md").write_text(tables(res), encoding="utf-8")
    print(tables(res))

    if args.bundle:
        export_bundle(args, data, by_origin, best, oos, res, first_origin, cal_cache)


def export_bundle(args, data, by_origin, best, oos, res, first_origin, cal_cache):
    last = data.months[-1]
    # Modèle final : cibles t <= dernier mois - 1 ; quantiles : résidus hors échantillon des CALIB_MONTHS derniers mois.
    origin = last
    train_ex = [e for oo in by_origin for e in by_origin[oo] if e.origin + e.h <= origin - 1]
    models = {str(h): train(train_ex, best, h) for h in M.HORIZONS}
    q = quantiles(oos, origin)
    version = f"abs-ridge-v1-{datetime.now(timezone.utc):%Y%m%d}"
    bundle = {
        "version": version, "kind": "RIDGE_DIRECT", "topic": "ABSENTEISME",
        "target": "taux mensuel d'absence hors santé non planifiée (injustifiée, sans solde, autre)",
        "features": M.FEATURES, "horizons": list(M.HORIZONS), "config": best, "models": models,
        "intervals": {"level": LEVEL, "rate_floor": M.RATE_FLOOR, "method": "quantiles des résidus hors échantillon normalisés",
                      "quantiles": {f: {str(h): list(q[(f, h)]) for h in M.HORIZONS} for f in ("EQUIPE", "AGREGE")}},
        "visibility_lag_days": S.LAG_DAYS, "min_group": S.MIN_GROUP,
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "data_hash": f"sha256:{S.data_hash(args.db)}",
        "train_rows": len(train_ex), "train_from": S.ml(first_origin), "train_to": S.ml(origin - 1),
        "metrics": {"test_origins": list(TEST), "cells": {k: {"mae": v["pred"]["mae"], "mae_naive_seasonal": v["naive_s"]["mae"],
                    "mae_ma3": v["ma3"]["mae"], "mae_ma12": v["ma12"]["mae"], "ratio_vs_ma12": v["ratio_vs_ma12"],
                    "coverage80": v.get("interval", {}).get("coverage")} for k, v in res["test"].items()}},
    }
    final_ex = M.examples_at(data, origin, with_target=False, cal_cache=cal_cache)
    series_units = {}
    for e in final_ex:
        if e.h == 1:
            series_units[e.unit] = {"own": [e.own[0], e.own[1]], "parent_unit": e.parent_unit}
    gold = {"cases": golden_cases([e for oo in by_origin for e in by_origin[oo]], bundle),
            "series": {"as_of": S.ds(S.m_end(origin)), "units": series_units,
                       "company": [final_ex[0].company[0], final_ex[0].company[1]] if final_ex else None,
                       "forecasts": [{"unit": e.unit, "h": e.h, "x": e.x,
                                      "value": M.predict_one(model_for(models[str(e.h)], e.scope), e.x)} for e in final_ex]}}
    d = Path(args.bundle) / version
    d.mkdir(parents=True, exist_ok=True)
    (d / "model.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (d / "golden.json").write_text(json.dumps(gold, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"bundle : {d}")


if __name__ == "__main__":
    main()

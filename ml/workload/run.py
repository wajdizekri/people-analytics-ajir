"""Charge de travail : prévision des heures sup par équipe / département (1-3 mois) et règle de surcharge individuelle.

python ml/workload/run.py --db data/dev-ai-load.db --name mixte_medium_s1 --bundle
python ml/workload/run.py --db data/ml-charge_medium_s1.db --name charge_medium_s1
"""
import argparse
import json
import math
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workload import bundle as BU  # noqa: E402
from workload import data as D  # noqa: E402
from workload import evaluate as EV  # noqa: E402
from workload import features as F  # noqa: E402
from workload import rule as RU  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
MODELS_DIR = D.ROOT / "models" / "workload"
N_TEST = 24
FIRST_ORIGIN = 17  # fenêtre saisonnière centrée T-18..T-7
TENSION_Q = 0.85
ABLATIONS = {
    "sans_calendrier_tunisien": F.CAL_FEATURES,
    "sans_effectif_departs": F.STAFF_FEATURES,
    "sans_saisonnalite": F.SEASON_FEATURES,
}


def clean(o, sig=5):
    if isinstance(o, dict):
        return {str(k): clean(v, sig) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v, sig) for v in o]
    if isinstance(o, (float, np.floating)):
        f = float(o)
        if not math.isfinite(f):
            return None
        return float(f"{f:.{sig}g}")
    if isinstance(o, np.integer):
        return int(o)
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--bundle", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    P = D.load_panel(a.db)
    vol = D.voluntary_exits(a.db)
    risk = D.risk_levels(a.db)
    S = F.build_samples(P, range(FIRST_ORIGIN, P.n_obs))
    tests = list(range(P.n_obs - 1 - N_TEST, P.n_obs - 1))
    print(f"panel {P.ot_min.shape} {D.ym(P.m0)} -> {D.ym(P.m0 + P.n_obs - 1)} ; lignes {({k: len(v) for k, v in S.items()})} ({time.time() - t0:.0f} s)")

    team_train = [r for r in S["EQUIPE"] if r["h"] == 1 and not math.isnan(r["y"]) and r["T"] <= tests[0]]
    tension_h = round(float(np.quantile([r["I_T"] for r in team_train], TENSION_Q)), 1)
    res = {
        "name": a.name, "db": a.db, "run_date": date.today().isoformat(), "data_hash": P.data_hash,
        "months": [D.ym(P.m0), D.ym(P.m0 + P.n_obs - 1)],
        "test_origins": [D.ym(P.m0 + tests[0]), D.ym(P.m0 + tests[-1])],
        "rows": {k: len(v) for k, v in S.items()},
        "groups_last_origin": {k: len({r["key"] for r in v if r["O"] == P.n_obs - 1}) for k, v in S.items()},
        "forecast": {}, "ablations": {}, "tension": {"threshold_h": tension_h, "quantile": TENSION_Q},
    }
    for scope, rows in S.items():
        out = EV.rolling(rows, tests)
        res["forecast"][scope] = EV.summarize(out)
        res["ablations"][scope] = {}
        for name, drop in ABLATIONS.items():
            cols = [c for c in F.FEATURES if c not in drop]
            abl = EV.summarize(EV.rolling(rows, tests, cols))
            res["ablations"][scope][name] = {h: {"mae": v["mae"]["RIDGE"], "coverage": v["coverage"]} for h, v in abl.items()}
        lo = [dict(r, lo_flag=r["lo"]) for r in out]
        res["tension"][scope] = {
            "RIDGE": EV.tension_eval(out, -1, tension_h),
            "RIDGE_BORNE_BASSE": EV.tension_eval(lo, -1, tension_h, "lo_flag"),
            "MOYENNE_MOBILE_3": EV.tension_eval(out, -1, tension_h, "MOYENNE_MOBILE_3"),
            "NAIF_SAISONNIER": EV.tension_eval(out, -1, tension_h, "NAIF_SAISONNIER"),
        }
        s = res["forecast"][scope]["all"]
        print(f"{scope}: MAE ridge {s['mae']['RIDGE']:.3f} / MM3 {s['mae']['MOYENNE_MOBILE_3']:.3f} / saisonnier {s['mae']['NAIF_SAISONNIER']:.3f} ; couverture {s['coverage']:.3f} ({time.time() - t0:.0f} s)")
    res["rule"] = RU.evaluate(P, vol, risk)
    res["rule"]["champion"] = list(risk["champion"]) if risk["champion"] else None

    if a.bundle:
        models, s_default = BU.train_final(S, P.n_obs)
        all_team = [r for r in S["EQUIPE"] if r["h"] == 1 and not math.isnan(r["y"])]
        tension_final = round(float(np.quantile([r["I_T"] for r in all_team], TENSION_Q)), 1)
        version = f"workload-ridge-v1-{date.today().strftime('%Y%m%d')}"
        rule = {"threshold_h": RU.DEFAULT[0], "consecutive_months": RU.DEFAULT[1], "priority_risk_levels": ["ELEVE", "MOYEN"],
                "settings": {"threshold_h": "workload_ot_threshold_h", "consecutive_months": "workload_ot_months"}}
        metrics = clean({k: res[k] for k in ("forecast", "ablations", "tension", "test_origins", "rule")})
        bundle = BU.build(version, models, s_default, tension_final, rule, P.data_hash, D.ym(P.m0), D.ym(P.m0 + P.n_obs - 1), metrics)
        recent = {k: [r for r in v if r["O"] >= P.n_obs - 1 - N_TEST] for k, v in S.items()}
        last = [r for v in S.values() for r in v if r["O"] == P.n_obs - 1]
        gold = {"rows": BU.golden_rows(bundle, recent), "features": BU.features_block(last, D.month_end(P.m0 + P.n_obs - 1))}
        out = BU.write(MODELS_DIR / version, bundle, gold)
        res["bundle"] = {"version": version, "path": str(out), "tension_threshold_h": tension_final,
                         "alphas": {s: {h: m["alpha"] for h, m in v.items()} for s, v in models.items()}, "s_default": s_default}
        print(f"bundle : {out}")
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{a.name}.json").write_text(json.dumps(clean(res), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"résultats : {RESULTS / (a.name + '.json')} ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()

"""Fourchettes à couverture vérifiée (prédiction conforme) : nouvelle version du bundle ABSENTEISME.

python -m ml.absenteeism.conformal --db data/app.db --source models/absenteeism/abs-ridge-v1-20260930 --version abs-ridge-v2-20261004
Lecture seule de la base. Les ridges du bundle source sont repris tels quels ; seul le champ additif `conformal` change les
bornes (src/lib/ai/absenteeism/model.ts, parité via golden.json). La version source n'est jamais modifiée.

Découpage temporel, sans fuite :
- prévisions hors échantillon : à chaque origine O, ridge réentraîné sur les cibles t <= O - 1 (protocole de run.py) ;
- calibration : prévisions dont la cible t vérifie T0 - 24 < t <= T0, toutes observées à la première origine de test T0 ;
- test : prévisions des origines T0 .. T1 (cibles > T0), jamais utilisées pour caler les quantiles.
Score signé z = (y - ŷ) / s, s = échelle de l'intervalle v1 (Poisson approchée) ; quantiles par portée (entreprise,
département, équipe) et horizon.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import model as M
from . import run as R
from . import series as S

LEVEL = 0.8
CALIB_MONTHS = 24
TEST = R.TEST
SCOPES = ("ENTREPRISE", "DEPARTEMENT", "EQUIPE")
METHOD = "split conformal à rangs sur scores signés (y - ŷ) / s, par portée et horizon"


def signed_interval(scores, level=LEVEL):
    """Intervalle conforme [z(i), z(j)] des scores de calibration triés, élargi pour contenir 0.

    m = ceil((n + 1) level) écarts, i = floor((n + 1 - m) / 2), j = i + m : pour un score futur échangeable,
    P(z(i) <= Z <= z(j)) >= (j - i) / (n + 1) >= level. None si n est trop petit (n < 9 à 80 %).
    Même calcul que conformalInterval (src/lib/ai/conformal.ts).
    """
    z = sorted(float(v) for v in scores if math.isfinite(float(v)))
    n = len(z)
    m = math.ceil((n + 1) * level - 1e-9)
    i = (n + 1 - m) // 2
    j = i + m
    if i < 1 or j > n:
        return None
    return (min(z[i - 1], 0.0), max(z[j - 1], 0.0))


def band(value, s, q):
    """Mêmes opérations que forecastUnit (model.ts) : borne basse ramenée à 0."""
    return max(0.0, value + q[0] * s), value + q[1] * s


def _mean(v):
    return float(np.mean(v)) if len(v) else None


def stats(rows, key):
    """Couverture et largeur moyenne des bornes (lo, hi) rangées sous `key` ; lignes sans bornes ignorées."""
    rs = [r for r in rows if r.get(key) is not None]
    return {"n": len(rs), "coverage": _mean([r[key][0] <= r["y"] <= r[key][1] for r in rs]),
            "width": _mean([r[key][1] - r[key][0] for r in rs])}


def coverage_cell(rows, with_ci=True):
    """Cellule lue par l'interface : couverture conforme (après) et procédure v1 (avant) sur les mêmes prévisions."""
    months = sorted({r["origin"] + r["h"] for r in rows})
    after, before = stats(rows, "cf"), stats(rows, "proc")
    cell = {"months": len(months), "from": S.ml(months[0]), "to": S.ml(months[-1]), "n": after["n"],
            "coverage": after["coverage"], "target": LEVEL, "width": after["width"],
            "before": before["coverage"], "width_before": before["width"], "by_h": {}}
    for h in M.HORIZONS:
        rh = [r for r in rows if r["h"] == h]
        a, b, v1 = stats(rh, "cf"), stats(rh, "proc"), stats(rh, "v1")
        cell["by_h"][str(h)] = {"n": a["n"], "coverage": a["coverage"], "width": a["width"], "before": b["coverage"],
                                "width_before": b["width"], "v1_shipped": v1["coverage"]}
    if with_ci:
        flags = [dict(origin=r["origin"], c=float(r["cf"][0] <= r["y"] <= r["cf"][1])) for r in rows]
        cell["ci95"] = R.block_boot(flags, lambda s: float(np.mean([f["c"] for f in s])))
    return cell


def pct(x, d=1):
    return "–" if x is None else f"{100 * x:.{d}f}".replace(".", ",")


def table(res):
    lines = ["| Portée | h | n test | Avant : procédure v1 | Avant : bandes v1 publiées (calibration) | Après : conforme | Largeur avant → après |",
             "|---|---|---|---|---|---|---|"]
    for sc in SCOPES:
        c = res["test"][sc]
        for h in M.HORIZONS:
            b = c["by_h"][str(h)]
            cal = res["calibration_v1_shipped"][sc][str(h)]
            lines.append(f"| {sc} | {h} | {b['n']} | {pct(b['before'])} % | {pct(cal['coverage'])} % | {pct(b['coverage'])} % | "
                         f"{pct(b['width_before'], 2)} → {pct(b['width'], 2)} pt |")
        lines.append(f"| {sc} | tous | {c['n']} | {pct(c['before'])} % | | **{pct(c['coverage'])} %** "
                     f"[{pct(c['ci95'][0])} ; {pct(c['ci95'][1])}] | {pct(c['width_before'], 2)} → {pct(c['width'], 2)} pt |")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/app.db")
    ap.add_argument("--source", default="models/absenteeism/abs-ridge-v1-20260930")
    ap.add_argument("--version", default=None, help="défaut : abs-ridge-v2-<AAAAMMJJ>")
    ap.add_argument("--models", default="models/absenteeism")
    ap.add_argument("--out", default="ml/absenteeism/results")
    args = ap.parse_args()

    src = Path(args.source)
    b1 = json.loads((src / "model.json").read_text(encoding="utf-8"))
    g1 = json.loads((src / "golden.json").read_text(encoding="utf-8"))
    cfg = b1["config"]

    data = S.load(args.db)
    last = data.months[-1]
    first_origin = data.months[0] + 11
    t0, t1 = S.mi(TEST[0]), S.mi(TEST[1])
    cal_lo = t0 - CALIB_MONTHS
    start = max(first_origin + 2 * max(M.HORIZONS), cal_lo + 1 - max(M.HORIZONS))
    cal_cache = {}
    by_origin = {o: M.examples_at(data, o, cal_cache=cal_cache) for o in range(first_origin, last)}
    oos = R.rolling(by_origin, list(range(start, t1 + 1)), cfg)
    print(f"prévisions hors échantillon : {len(oos)} (origines {S.ml(start)} → {S.ml(t1)})")

    calib = [r for r in oos if cal_lo < r["origin"] + r["h"] <= t0]
    test = [dict(r) for r in oos if t0 <= r["origin"] <= t1]

    q, n_cal, parity = {}, {}, []
    for sc in SCOPES:
        for h in M.HORIZONS:
            z = [(r["y"] - r["pred"]) / r["s"] for r in calib if r["scope"] == sc and r["h"] == h]
            iv = signed_interval(z)
            if iv is None:
                raise SystemExit(f"calibration insuffisante : {sc} h={h} ({len(z)} scores)")
            q.setdefault(sc, {})[str(h)] = [iv[0], iv[1]]
            n_cal[f"{sc}|{h}"] = len(z)
            if sc != "EQUIPE":
                parity.append({"scope": sc, "h": h, "level": LEVEL, "scores": z, "interval": [iv[0], iv[1]]})

    # Avant : procédure v1 (quantiles glissants 10 % / 90 % des 24 mois <= O - 1, par famille) et quantiles publiés v1
    R.add_intervals(test, oos)
    v1q = b1["intervals"]["quantiles"]
    for r in test:
        r["proc"] = (r["lo"], r["hi"]) if r["lo"] is not None else None
        r["v1"] = band(r["pred"], r["s"], v1q[R.family(r["scope"])][str(r["h"])])
        r["cf"] = band(r["pred"], r["s"], q[r["scope"]][str(r["h"])])
    cal_rows = [dict(r) for r in calib]
    for r in cal_rows:
        r["v1"] = band(r["pred"], r["s"], v1q[R.family(r["scope"])][str(r["h"])])
        r["cf"] = band(r["pred"], r["s"], q[r["scope"]][str(r["h"])])

    coverage = {sc: coverage_cell([r for r in test if r["scope"] == sc]) for sc in SCOPES}
    res = {
        "db": str(args.db), "source_version": b1["version"], "level": LEVEL, "method": METHOD,
        "calibration": {"targets": [S.ml(cal_lo + 1), S.ml(t0)], "months": CALIB_MONTHS, "n": n_cal},
        "test": coverage,
        "test_window": {"origins": list(TEST), "targets": [S.ml(t0 + 1), S.ml(t1 + max(M.HORIZONS))]},
        "calibration_v1_shipped": {sc: {str(h): stats([r for r in cal_rows if r["scope"] == sc and r["h"] == h], "v1") for h in M.HORIZONS} for sc in SCOPES},
        "calibration_conformal": {sc: {str(h): stats([r for r in cal_rows if r["scope"] == sc and r["h"] == h], "cf") for h in M.HORIZONS} for sc in SCOPES},
        "quantiles": q,
        "data_hash": f"sha256:{S.data_hash(args.db)}", "source_data_hash": b1.get("data_hash"),
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "conformal.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "conformal.md").write_text(table(res), encoding="utf-8")
    print(table(res))

    version = args.version or f"abs-ridge-v2-{datetime.now(timezone.utc):%Y%m%d}"
    b2 = json.loads(json.dumps(b1))
    b2["version"] = version
    b2["metrics"]["conformal"] = {"level": LEVEL, "coverage": {sc: coverage[sc]["coverage"] for sc in SCOPES},
                                  "before": {sc: coverage[sc]["before"] for sc in SCOPES}}
    b2["conformal"] = {
        "method": METHOD, "level": LEVEL, "source_version": b1["version"],
        "calibrated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_hash": res["data_hash"], "score": "(y - ŷ) / sqrt(max(ŷ ; rate_floor) / jours ouvrés mensuels moyens)",
        "calibration": {"targets": res["calibration"]["targets"], "months": CALIB_MONTHS, "n": n_cal},
        "test": {"origins": list(TEST), "targets": res["test_window"]["targets"],
                 "months": coverage["ENTREPRISE"]["months"]},
        "quantiles": q, "coverage": coverage,
    }
    g2 = json.loads(json.dumps(g1))
    for c in g2["cases"]:
        c["lower"], c["upper"] = band(c["value"], M.scale(c["value"], c["own"][1]), q[c["scope"]][str(c["h"])])
    d = Path(args.models) / version
    if d.exists():
        raise SystemExit(f"{d} existe déjà : choisissez une autre version (--version)")
    d.mkdir(parents=True)
    (d / "model.json").write_text(json.dumps(b2, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (d / "golden.json").write_text(json.dumps(g2, separators=(",", ":")) + "\n", encoding="utf-8")
    (d / "conformal_parity.json").write_text(json.dumps({"conformal_parity": parity}) + "\n", encoding="utf-8")
    print(f"bundle : {d}")


if __name__ == "__main__":
    main()

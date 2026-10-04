"""Fourchettes à couverture vérifiée (prédiction conforme) : nouvelles versions des bundles EFFECTIF et MASSE_SALARIALE.

python -m ml.workforce.conformal --db data/app.db --version-date 20261004    # ~8 min avec la variante LOGREG
Lecture seule de la base. Méthode, fenêtres, a priori et saisonnalité des bundles source sont repris tels quels ; seul le
champ additif `conformal` change les bornes (engine.py / engine.ts, parité via golden.json). Les versions source ne sont
jamais modifiées.

Découpage temporel, sans fuite :
- prévisions hors échantillon : protocole de run.py (état, taux et saisonnalité recalculés à chaque origine avec les seules
  données <= origine ; LOGREG réentraîné à chaque origine), origines 2021-09 → dernier mois - 1 ;
- calibration : prévisions dont la cible t vérifie T0 - 24 < t <= T0, toutes observées à la première origine de test T0 ;
- test : prévisions des origines >= T0 (cibles > T0), jamais utilisées pour caler les quantiles.
Score signé (y - ŷ) / échelle (écart-type stock-flux pour l'effectif, prévision pour la masse) ; quantiles par niveau
(entreprise, départements), horizon et source des démissions, élargis pour croître avec l'horizon.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import run as R
from .queries import ROOT, connect_ro
from .state import month_end, shift

LEVEL = 0.8
CALIB_MONTHS = 24
TEST_FROM = "2024-09"
LEVELS = ("total", "dept")
TARGETS = {"hc": "EFFECTIF", "mass": "MASSE_SALARIALE"}
METHOD = "split conformal à rangs sur scores signés (y - ŷ) / échelle, par niveau, horizon et source des démissions"


def signed_interval(scores, level=LEVEL):
    """Intervalle conforme [z(i), z(j)] des scores triés, élargi pour contenir 0 ; None si n < 9 (à 80 %).
    Même calcul que conformalInterval (src/lib/ai/conformal.ts)."""
    z = sorted(float(v) for v in scores if math.isfinite(float(v)))
    n = len(z)
    m = math.ceil((n + 1) * level - 1e-9)
    i = (n + 1 - m) // 2
    j = i + m
    if i < 1 or j > n:
        return None
    return (min(z[i - 1], 0.0), max(z[j - 1], 0.0))


def widen(pairs):
    """Bornes qui s'élargissent avec l'horizon (bas décroissant, haut croissant) : n'enlève jamais de couverture."""
    out, lo, hi = [], 0.0, 0.0
    for a, b in pairs:
        lo, hi = min(lo, a), max(hi, b)
        out.append([lo, hi])
    return out


def band(yhat, scale, q):
    return max(0.0, yhat + q[0] * scale), yhat + q[1] * scale


def _mean(v):
    return float(np.mean(v)) if len(v) else None


def stats(rows, key):
    return {"n": len(rows), "coverage": _mean([r[key][0] <= r["y"] <= r[key][1] for r in rows]),
            "width": _mean([(r[key][1] - r[key][0]) / r["y"] for r in rows])}


def coverage_cell(rows):
    months = sorted({shift(r["origin"], r["h"]) for r in rows})
    a, b = stats(rows, "cf"), stats(rows, "proc")
    cell = {"months": len(months), "from": months[0], "to": months[-1], "n": a["n"], "coverage": a["coverage"],
            "target": LEVEL, "width": a["width"], "before": b["coverage"], "width_before": b["width"],
            "width_unit": "part de la valeur observée", "by_h": {}}
    for h in range(1, R.H + 1):
        rh = [r for r in rows if r["h"] == h]
        if not rh:
            continue
        a, b, v1 = stats(rh, "cf"), stats(rh, "proc"), stats(rh, "v1")
        cell["by_h"][str(h)] = {"n": a["n"], "coverage": a["coverage"], "width": a["width"], "before": b["coverage"],
                                "width_before": b["width"], "v1_shipped": v1["coverage"]}
    return cell


def pct(x, d=1):
    return "–" if x is None else f"{100 * x:.{d}f}".replace(".", ",")


def table(res):
    lines = ["| Série | Source | Niveau | n test | Avant : procédure v1 | Après : conforme | h1 avant → après | h6 avant → après | h12 avant → après | Largeur relative avant → après |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for target, cells in res["test"].items():
        for key, c in cells.items():
            variant, lvl = key.split(":")
            hs = [c["by_h"].get(str(h)) for h in (1, 6, 12)]
            lines.append(f"| {TARGETS[target]} | {variant} | {lvl} | {c['n']} | {pct(c['before'])} % | **{pct(c['coverage'])} %** | "
                         + " | ".join(f"{pct(x['before'], 0)} → {pct(x['coverage'], 0)} %" if x else "–" for x in hs)
                         + f" | {pct(c['width_before'])} → {pct(c['width'])} % |")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "app.db"))
    ap.add_argument("--source-effectif", default=str(ROOT / "models" / "workforce" / "effectif-v1-20260930"))
    ap.add_argument("--source-masse", default=str(ROOT / "models" / "workforce" / "masse-v1-20260930"))
    ap.add_argument("--version-date", default=datetime.now(timezone.utc).strftime("%Y%m%d"))
    ap.add_argument("--no-logreg", action="store_true")
    args = ap.parse_args()

    src = {"hc": json.loads((Path(args.source_effectif) / "model.json").read_text(encoding="utf-8")),
           "mass": json.loads((Path(args.source_masse) / "model.json").read_text(encoding="utf-8"))}
    con = connect_ro(args.db)
    hist = R.load_history(con)
    last = hist["months"][-1]
    origins = R.months_between(R.FIRST, shift(last, -1))
    panel = None
    if not args.no_logreg:
        from ml.train.data import load_panel

        panel = load_panel(args.db, complete_only=False)
        R.log(f"panel {panel[1].shape}")
    bt = R.run_backtest(con, hist, panel, origins)

    t0 = TEST_FROM
    cal_from = shift(t0, -CALIB_MONTHS + 1)
    variants = [v for v in R.VARIANTS if any(s["variant"] == v for s in bt["scores"])]
    rows = [dict(s, signed=(s["y"] - s["yhat"]) / s["scale"]) for s in bt["scores"] if s["scale"] > 0]
    calib = [r for r in rows if cal_from <= shift(r["origin"], r["h"]) <= t0]
    test = [r for r in rows if r["origin"] >= t0]

    quantiles, coverage, n_cal, parity, cal_v1 = {}, {}, {}, [], {}
    for target in TARGETS:
        quantiles[target], coverage[target], cal_v1[target] = {}, {}, {}
        for variant in variants:
            proc = R.quantiles(bt["scores"], variant, target, lambda o: R.in_range(o, R.CALIB))
            v1 = src[target]["interval"][variant]
            quantiles[target][variant] = {}
            for lvl in LEVELS:
                pairs = []
                for h in range(1, R.H + 1):
                    z = [r["signed"] for r in calib if r["variant"] == variant and r["target"] == target and r["level"] == lvl and r["h"] == h]
                    iv = signed_interval(z)
                    if iv is None:
                        raise SystemExit(f"calibration insuffisante : {target} {variant} {lvl} h={h} ({len(z)} scores)")
                    pairs.append(iv)
                    n_cal[f"{target}|{variant}|{lvl}|{h}"] = len(z)
                    if lvl == "total" and h in (1, 6, 12):
                        parity.append({"target": target, "variant": variant, "tier": lvl, "h": h, "level": LEVEL, "scores": z, "interval": list(iv)})
                q = widen(pairs)
                quantiles[target][variant][lvl] = q
                sel = [r for r in test if r["variant"] == variant and r["target"] == target and r["level"] == lvl]
                for r in sel:
                    i = r["h"] - 1
                    r["cf"] = band(r["yhat"], r["scale"], q[i])
                    r["proc"] = band(r["yhat"], r["scale"], [-proc[lvl][i], proc[lvl][i]])
                    r["v1"] = band(r["yhat"], r["scale"], [-v1[lvl][i], v1[lvl][i]])
                coverage[target][f"{variant}:{lvl}"] = coverage_cell(sel)
                cs = [r for r in calib if r["variant"] == variant and r["target"] == target and r["level"] == lvl]
                for r in cs:
                    r["v1"] = band(r["yhat"], r["scale"], [-v1[lvl][r["h"] - 1], v1[lvl][r["h"] - 1]])
                cal_v1[target][f"{variant}:{lvl}"] = stats(cs, "v1")
                R.log(f"{target} {variant} {lvl} : couverture test {coverage[target][f'{variant}:{lvl}']['coverage']:.3f}")

    test_targets = [shift(t0, 1), last]
    res = {
        "db": args.db, "source_versions": {TARGETS[t]: src[t]["version"] for t in TARGETS}, "level": LEVEL, "method": METHOD,
        "calibration": {"targets": [cal_from, t0], "months": CALIB_MONTHS, "n": n_cal},
        "test_window": {"origins": [t0, shift(last, -1)], "targets": test_targets},
        "test": coverage, "calibration_v1_shipped": cal_v1, "quantiles": quantiles,
        "data_hash": f"sha256:{R.data_hash(con)}", "source_data_hash": src["hc"].get("data_hash"),
    }
    out = ROOT / "ml" / "workforce" / "results"
    (out / "conformal.json").write_text(json.dumps(res, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "conformal.md").write_text(table(res), encoding="utf-8")
    print(table(res))

    calibrated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ve, vm = f"effectif-v2-{args.version_date}", f"masse-v2-{args.version_date}"
    bundles = {}
    for target, version in (("hc", ve), ("mass", vm)):
        b = json.loads(json.dumps(src[target]))
        b["version"] = version
        if target == "mass":
            b["effectif_version"] = ve
        cov = coverage[target]
        b["metrics"]["conformal"] = {"level": LEVEL, "coverage": {k: c["coverage"] for k, c in cov.items()}, "before": {k: c["before"] for k, c in cov.items()}}
        b["conformal"] = {
            "method": METHOD, "level": LEVEL, "source_version": src[target]["version"], "calibrated_at": calibrated_at,
            "data_hash": res["data_hash"],
            "score": "(y - ŷ) / écart-type stock-flux" if target == "hc" else "(y - ŷ) / ŷ",
            "calibration": {"targets": [cal_from, t0], "months": CALIB_MONTHS},
            "test": {"origins": res["test_window"]["origins"], "targets": test_targets, "months": len(R.months_between(test_targets[0], test_targets[1]))},
            "quantiles": quantiles[target], "coverage": cov,
        }
        bundles[target] = b
    be, bm = bundles["hc"], bundles["mass"]
    ref = R.reference(con, be, bm, month_end(last))
    old = src["hc"]["metrics"].get("reference", {})
    same = old.get("total_hc") is not None and all(abs(a - b) <= 1e-9 * max(1.0, abs(b)) for a, b in zip(ref["total_hc"], old["total_hc"]))
    if same:
        be["metrics"]["reference"] = ref
        bm["metrics"]["reference"] = {"asOf": ref["asOf"], "total_mass": ref["total_mass"], "raise": ref["state"]["raise"]}
    else:
        R.log("base de calibration différente de la base d'entraînement : projection de référence de la version source conservée")
        be["conformal"]["reference_note"] = "projection de référence de la version source (base de calibration différente)"
    gold = R.golden_cases(be, bm)
    meta = {"bundles": {"EFFECTIF": ve, "MASSE_SALARIALE": vm}}
    for target, version in (("hc", ve), ("mass", vm)):
        d = ROOT / "models" / "workforce" / version
        if d.exists():
            raise SystemExit(f"{d} existe déjà : choisissez une autre date (--version-date)")
        R.write_bundle(d, bundles[target], [{**meta, **g} for g in gold])
        # golden.json est une liste de cas (format v1, lu tel quel) : la parité du calcul des quantiles va dans un fichier à part
        parity_t = [p for p in parity if p["target"] == target]
        (d / "conformal_parity.json").write_text(json.dumps({"conformal_parity": parity_t}) + "\n", encoding="utf-8")
    R.log(f"bundles : models/workforce/{ve}, models/workforce/{vm}")


if __name__ == "__main__":
    main()

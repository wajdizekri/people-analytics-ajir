"""Fourchettes à couverture vérifiée (prédiction conforme) : nouvelle version du bundle CHARGE_TRAVAIL.

python ml/workload/conformal.py --db data/app.db --source models/workload/workload-ridge-v1-20260930 --version workload-ridge-v2-20261004
Lecture seule de la base. Les ridges du bundle source sont repris tels quels ; seul le champ additif `conformal` change les
bornes (src/lib/ai/workload/model.ts, parité via golden.json). La version source n'est jamais modifiée.

Découpage temporel, sans fuite (indices de mois du panel) :
- prévisions hors échantillon : à chaque origine O, ridge réentraîné sur les cibles T <= O (protocole de evaluate.py) ;
- calibration : prévisions dont la cible T vérifie T0 - 12 < T <= T0, toutes observées à la première origine de test T0 ;
- test : prévisions des origines T0 .. T1 (24 dernières origines, cibles > T0), jamais utilisées pour caler les quantiles.
Score signé (z[T] - ẑ) / s sur l'échelle log, s = échelle de bruit du groupe (ou s_default du bundle) ; quantiles par
portée (équipe, département) et horizon. La v1 choisissait alpha et le quantile sur la même fenêtre : ici la fenêtre de
calibration ne sert à aucun choix du modèle.
"""
import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from workload import data as D  # noqa: E402
from workload import evaluate as EV  # noqa: E402
from workload import features as F  # noqa: E402

LEVEL = 0.8
CALIB_MONTHS = 12
N_TEST = 24
FIRST_ORIGIN = 17
METHOD = "split conformal à rangs sur scores signés (z - ẑ) / s (échelle log), par portée et horizon"


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


def to_hours(zc, s, q):
    """(bas, haut) en heures sup par ETP : mêmes opérations que predictGroup (model.ts)."""
    return max(0.0, math.expm1(zc + q[0] * s)), max(0.0, math.expm1(zc + q[1] * s))


def predict_conformal(m, q, x, zbar12, s):
    """(valeur, bas, haut) : ridge du bundle puis bornes conformes ; s déjà remplacé par s_default si absent."""
    y = m["intercept"]
    for j, v in enumerate(x):
        y += m["coef"][j] * ((float(v) - m["mean"][j]) / m["std"][j])
    zc = zbar12 + y
    lo, hi = to_hours(zc, s, q)
    return max(0.0, math.expm1(zc)), lo, hi


def rolling_z(rows, origins):
    """Prévisions hors échantillon sur l'échelle log (même apprentissage que EV.rolling), avec le quantile de la procédure v1."""
    obs = [r for r in rows if not math.isnan(r["y"])]
    s_proc = float(np.median([r["s"] for r in obs if r["s"] is not None]))
    X = EV.arrays(obs)
    H = np.array([r["h"] for r in obs])
    T = np.array([r["T"] for r in obs])
    Or = np.array([r["O"] for r in obs])
    out = []
    for O in origins:
        for h in F.HORIZONS:
            tr = np.nonzero((H == h) & (T <= O))[0]
            te = np.nonzero((H == h) & (Or == O))[0]
            if not len(te) or not len(tr):
                continue
            m, alpha, qv1 = EV.fit_select([obs[i] for i in tr], None, s_proc, O - 12, X[tr])
            for i, p in zip(te, m.predict(X[te])):
                r = obs[i]
                out.append({"key": r["key"], "O": O, "h": h, "T": r["T"], "y": r["y"], "p": float(p), "zbar12": r["zbar12"],
                            "s": r["s"], "I_T": r["I_T"], "q_proc": qv1, "s_proc": r["s"] if r["s"] is not None else s_proc})
    return out


def _mean(v):
    return float(np.mean(v)) if len(v) else None


def stats(rows, key):
    return {"n": len(rows), "coverage": _mean([r[key][0] <= r["I_T"] <= r[key][1] for r in rows]),
            "width": _mean([r[key][1] - r[key][0] for r in rows])}


def coverage_cell(rows, ym):
    months = sorted({r["T"] for r in rows})
    a, b = stats(rows, "cf"), stats(rows, "proc")
    cell = {"months": len(months), "from": ym(months[0]), "to": ym(months[-1]), "n": a["n"], "coverage": a["coverage"],
            "target": LEVEL, "width": a["width"], "before": b["coverage"], "width_before": b["width"], "by_h": {}}
    for h in F.HORIZONS:
        rh = [r for r in rows if r["h"] == h]
        a, b, v1 = stats(rh, "cf"), stats(rh, "proc"), stats(rh, "v1")
        cell["by_h"][str(h)] = {"n": a["n"], "coverage": a["coverage"], "width": a["width"], "before": b["coverage"],
                                "width_before": b["width"], "v1_shipped": v1["coverage"]}
    # IC 95 % : bootstrap par groupe (toutes les origines d'un groupe tirées ensemble), comme evaluate._boot_delta
    keys = np.array([r["key"] for r in rows])
    c = np.array([float(r["cf"][0] <= r["I_T"] <= r["cf"][1]) for r in rows])
    uk, inv = np.unique(keys, return_inverse=True)
    sums, cnt = np.bincount(inv, weights=c, minlength=len(uk)), np.bincount(inv, minlength=len(uk))
    rng = np.random.default_rng(7)
    bs = []
    for _ in range(1000):
        k = rng.integers(0, len(uk), len(uk))
        bs.append(sums[k].sum() / cnt[k].sum())
    cell["ci95"] = [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]
    return cell


def pct(x, d=1):
    return "–" if x is None else f"{100 * x:.{d}f}".replace(".", ",")


def table(res):
    lines = ["| Portée | h | n test | Avant : procédure v1 | Avant : bandes v1 publiées (calibration) | Après : conforme | Largeur avant → après (h) |",
             "|---|---|---|---|---|---|---|"]
    for sc in F.SCOPES:
        c = res["test"][sc]
        for h in F.HORIZONS:
            b = c["by_h"][str(h)]
            cal = res["calibration_v1_shipped"][sc][str(h)]
            lines.append(f"| {sc} | {h} | {b['n']} | {pct(b['before'])} % | {pct(cal['coverage'])} % | {pct(b['coverage'])} % | "
                         f"{b['width_before']:.2f} → {b['width']:.2f} |".replace(".", ","))
        lines.append(f"| {sc} | tous | {c['n']} | {pct(c['before'])} % | | **{pct(c['coverage'])} %** [{pct(c['ci95'][0])} ; {pct(c['ci95'][1])}] | "
                     f"{c['width_before']:.2f} → {c['width']:.2f} |".replace(".", ","))
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/app.db")
    ap.add_argument("--source", default="models/workload/workload-ridge-v1-20260930")
    ap.add_argument("--version", default=None, help="défaut : workload-ridge-v2-<AAAAMMJJ>")
    a = ap.parse_args()

    src = Path(a.source)
    b1 = json.loads((src / "model.json").read_text(encoding="utf-8"))
    g1 = json.loads((src / "golden.json").read_text(encoding="utf-8"))
    s_def = b1["interval"]["s_default"]

    P = D.load_panel(a.db)
    ym = lambda i: D.ym(P.m0 + i)  # noqa: E731
    t1 = P.n_obs - 2
    t0 = t1 - N_TEST + 1
    cal_lo = t0 - CALIB_MONTHS
    origins = list(range(max(FIRST_ORIGIN + 13, cal_lo + 1 - max(F.HORIZONS)), t1 + 1))
    S = F.build_samples(P, range(FIRST_ORIGIN, P.n_obs))
    print(f"panel {D.ym(P.m0)} → {ym(P.n_obs - 1)} ; test {ym(t0)} → {ym(t1)} ; calibration (cibles) {ym(cal_lo + 1)} → {ym(t0)}")

    q, n_cal, parity, coverage, cal_v1, cal_cf = {}, {}, [], {}, {}, {}
    for scope in F.SCOPES:
        oos = rolling_z(S[scope], origins)
        for r in oos:
            r["sc"] = r["s"] if r["s"] is not None else s_def[scope]
            r["zc"] = r["zbar12"] + r["p"]
        calib = [r for r in oos if cal_lo < r["T"] <= t0]
        test = [r for r in oos if t0 <= r["O"] <= t1]
        q[scope] = {}
        for h in F.HORIZONS:
            z = [(r["y"] - r["p"]) / r["sc"] for r in calib if r["h"] == h]
            iv = signed_interval(z)
            if iv is None:
                raise SystemExit(f"calibration insuffisante : {scope} h={h} ({len(z)} scores)")
            q[scope][str(h)] = [iv[0], iv[1]]
            n_cal[f"{scope}|{h}"] = len(z)
            if scope == "DEPARTEMENT":
                parity.append({"scope": scope, "h": h, "level": LEVEL, "scores": z, "interval": [iv[0], iv[1]]})
        for r in calib + test:
            qv1 = b1["models"][scope][str(r["h"])]["q"]
            r["v1"] = to_hours(r["zc"], r["sc"], [-qv1, qv1])
            r["cf"] = to_hours(r["zc"], r["sc"], q[scope][str(r["h"])])
            r["proc"] = to_hours(r["zc"], r["s_proc"], [-r["q_proc"], r["q_proc"]])
        coverage[scope] = coverage_cell(test, ym)
        cal_v1[scope] = {str(h): stats([r for r in calib if r["h"] == h], "v1") for h in F.HORIZONS}
        cal_cf[scope] = {str(h): stats([r for r in calib if r["h"] == h], "cf") for h in F.HORIZONS}
        print(f"{scope} : couverture test {coverage[scope]['coverage']:.3f} (avant {coverage[scope]['before']:.3f})")

    targets = [ym(cal_lo + 1), ym(t0)]
    res = {
        "db": a.db, "source_version": b1["version"], "level": LEVEL, "method": METHOD,
        "calibration": {"targets": targets, "months": CALIB_MONTHS, "n": n_cal},
        "test": coverage, "test_window": {"origins": [ym(t0), ym(t1)], "targets": [ym(t0 + 1), ym(P.n_obs - 1)]},
        "calibration_v1_shipped": cal_v1, "calibration_conformal": cal_cf, "quantiles": q,
        "data_hash": f"sha256:{P.data_hash}", "source_data_hash": b1.get("data_hash"),
    }
    out = Path(__file__).resolve().parent / "results"
    out.mkdir(exist_ok=True)
    (out / "conformal.json").write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "conformal.md").write_text(table(res), encoding="utf-8")
    print(table(res))

    version = a.version or f"workload-ridge-v2-{datetime.now(timezone.utc):%Y%m%d}"
    b2 = json.loads(json.dumps(b1))
    b2["version"] = version
    b2["metrics"]["conformal"] = {"level": LEVEL, "coverage": {s: coverage[s]["coverage"] for s in F.SCOPES},
                                  "before": {s: coverage[s]["before"] for s in F.SCOPES}}
    b2["conformal"] = {
        "method": METHOD, "level": LEVEL, "source_version": b1["version"],
        "calibrated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "data_hash": res["data_hash"],
        "score": "(z[T] - ẑ) / s, z = log(1 + heures sup par ETP), s = échelle de bruit du groupe (s_default si absente)",
        "calibration": {"targets": targets, "months": CALIB_MONTHS, "n": n_cal},
        "test": {"origins": res["test_window"]["origins"], "targets": res["test_window"]["targets"], "months": coverage["EQUIPE"]["months"]},
        "quantiles": q, "coverage": coverage,
    }
    g2 = json.loads(json.dumps(g1))
    for r in g2["rows"]:
        m = b2["models"][r["scope"]][str(r["h"])]
        s = r["s"] if r["s"] is not None else s_def[r["scope"]]
        r["value"], r["lower"], r["upper"] = predict_conformal(m, q[r["scope"]][str(r["h"])], r["x"], r["zbar12"], s)
    d = D.ROOT / "models" / "workload" / version
    if d.exists():
        raise SystemExit(f"{d} existe déjà : choisissez une autre version (--version)")
    d.mkdir(parents=True)
    (d / "model.json").write_text(json.dumps(b2, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (d / "golden.json").write_text(json.dumps(g2, separators=(",", ":")) + "\n", encoding="utf-8")
    (d / "conformal_parity.json").write_text(json.dumps({"conformal_parity": parity}) + "\n", encoding="utf-8")
    print(f"bundle : {d}")


if __name__ == "__main__":
    main()

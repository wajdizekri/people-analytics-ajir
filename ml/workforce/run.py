"""Protocole temporel (origines glissantes), bundles models/workforce/<version>/ et résultats ml/workforce/results/<nom>.json.

python -m ml.workforce.run --db data/app.db --name mixte_medium_s1 --bundle
Lecture seule de la base (mode=ro)."""
import argparse
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .engine import CAUSES, month_index, month_label, project
from .fit import baseline, conformal_q, monotone, point_metrics, season_regression
from .queries import ROOT, connect_ro, rows
from .state import build_state, month_end, month_start, shift

LEVEL = 0.8
H = 12
CALIB = ("2021-09", "2022-09")
TEST = ("2023-09", "2025-08")
FIRST = "2021-09"
VARIANTS = ("TAUX", "LOGREG")
RESIGN = ("DEMISSION", "ABANDON")
OTHER = ("LICENCIEMENT", "DECES", "MUTATION", "AUTRE")

EFFECTIF_SPEC = {
    "kind": "STOCK_FLUX",
    "topic": "EFFECTIF",
    "horizon": H,
    "prob6_months": 6,
    "windows": {"rates_months": 24, "hires_months": 12, "hire_salary_months": 12, "cdd_months": 24, "min_hires_salary": 3},
    "retirement": {"age": 60, "lag_days": 15, "q_prior": 1.0, "min_cases": 5},
    "cdd": {"q_prior": 0.2, "min_cases": 20},
}
MASSE_SPEC = {
    "kind": "REGRESSION_LOG_SAISONNIERE",
    "topic": "MASSE_SALARIALE",
    "windows": {"level_months": 12},
    "raise_fallback": 0.05,
}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def months_between(a: str, b: str) -> list[str]:
    return [month_label(i) for i in range(month_index(a), month_index(b) + 1)]


def clean(o, sig=6):
    if isinstance(o, float):
        if math.isnan(o) or math.isinf(o):
            return None
        return float(f"{o:.{sig}g}")
    if isinstance(o, dict):
        return {k: clean(v, sig) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v, sig) for v in o]
    if isinstance(o, np.generic):
        return clean(o.item(), sig)
    return o


def load_history(con):
    agg = rows(con, "aggregates", {"from": "0000-01", "to": "9999-12"})
    hc = {(a["month"], a["department_id"]): float(a["headcount"]) for a in agg}
    mass = {(a["month"], a["department_id"]): float(a["payroll_mass"]) for a in agg}
    entries = {(a["month"], a["department_id"]): float(a["entries"]) for a in agg}
    base = {(b["month"], b["department_id"]): float(b["base"]) for b in rows(con, "baseMass", {"from": "0000-01", "to": "9999-12"})}
    months = sorted({a["month"] for a in agg})
    depts = [d["id"] for d in rows(con, "departments")]
    return {"hc": hc, "mass": mass, "entries": entries, "base": base, "months": months, "depts": depts}


def series(hist: dict, key: str, dept) -> dict:
    src = hist[key]
    if dept is None:
        out = {}
        for m in hist["months"]:
            vals = [src[(m, d)] for d in hist["depts"] if (m, d) in src]
            if vals:
                out[m] = sum(vals)
        return out
    return {m: src[(m, dept)] for m in hist["months"] if (m, dept) in src}


def logreg_prob6(panel, origin: str) -> dict:
    from ml.train.models import train_logreg_prod

    meta, X = panel
    o = month_index(origin)
    mon = meta["month"].to_numpy()
    tr = mon + 6 <= o
    y = meta["y6"].to_numpy()
    m = train_logreg_prod(X[tr], y[tr], mon[tr])
    te = mon == o
    p = m.proba(X[te])
    return {int(e): float(v) for e, v in zip(meta["employee_id"].to_numpy()[te], p)}


def bundle_for_origin(spec_m: dict, season: list[float]) -> dict:
    flat = {"dept": [0.0] * H, "total": [0.0] * H}
    return {**spec_m, "season": season, "interval": {"TAUX": flat, "LOGREG": flat}}


def effectif_bundle_stub() -> dict:
    flat = {"dept": [0.0] * H, "total": [0.0] * H}
    return {**EFFECTIF_SPEC, "interval": {"TAUX": flat, "LOGREG": flat}}


def actual_exits(con, origin: str) -> dict:
    out = {"resign": 0.0, "other": 0.0, "cdd": 0.0, "retire": 0.0}
    for x in rows(con, "exits", {"fromDate": month_start(shift(origin, 1)), "toDate": month_end(shift(origin, H))}):
        r = x["reason"]
        k = "resign" if r in RESIGN else "other" if r in OTHER else "cdd" if r == "FIN_CDD" else "retire" if r == "RETRAITE" else None
        if k:
            out[k] += x["n"]
    return out


def run_backtest(con, hist: dict, panel, origins: list[str]) -> dict:
    be = effectif_bundle_stub()
    records, scores, components = [], [], []
    hc_s = {d: series(hist, "hc", d) for d in [None, *hist["depts"]]}
    ms_s = {d: series(hist, "mass", d) for d in [None, *hist["depts"]]}
    ent_total = series(hist, "entries", None)
    for o in origins:
        t0 = time.time()
        season = season_regression(hist["base"], hist["mass"], o)["season"]
        bm = bundle_for_origin(MASSE_SPEC, season)
        p6 = logreg_prob6(panel, o) if panel is not None else None
        for variant in VARIANTS:
            if variant == "LOGREG" and p6 is None:
                continue
            st = build_state(con, month_end(o), be, bm, p6 if variant == "LOGREG" else None)
            pr = project(be, bm, st, {"hiringPct": 100.0})
            outs = [(None, pr["total"])] + [(d["id"], d) for d in pr["departments"]]
            for dept, out in outs:
                lvl = "total" if dept is None else "dept"
                for h in range(1, H + 1):
                    m = shift(o, h)
                    y_hc, y_ms = hc_s[dept].get(m), ms_s[dept].get(m)
                    if y_hc is None:
                        continue
                    yhat, sd = out["hc"][h - 1], out["hcSd"][h - 1]
                    records.append({"origin": o, "level": lvl, "dept": dept, "h": h, "target": "hc", "method": f"modele_{variant.lower()}", "y": y_hc, "yhat": yhat})
                    scores.append({"origin": o, "variant": variant, "target": "hc", "level": lvl, "h": h, "score": abs(y_hc - yhat) / sd if sd > 0 else float("nan"), "scale": sd, "y": y_hc, "yhat": yhat})
                    if out["mass"] is not None and y_ms is not None:
                        ym = out["mass"][h - 1]
                        records.append({"origin": o, "level": lvl, "dept": dept, "h": h, "target": "mass", "method": f"modele_{variant.lower()}", "y": y_ms, "yhat": ym})
                        scores.append({"origin": o, "variant": variant, "target": "mass", "level": lvl, "h": h, "score": abs(y_ms - ym) / ym, "scale": ym, "y": y_ms, "yhat": ym})
            if shift(o, H) <= hist["months"][-1]:
                act = actual_exits(con, o)
                exp = {c: sum(pr["total"]["exits"][c]) for c in CAUSES}
                components.append({
                    "origin": o, "variant": variant, "expected": exp, "actual": act,
                    "hires_expected": sum(pr["total"]["hires"]),
                    "hires_actual": sum(ent_total.get(shift(o, h), 0.0) for h in range(1, H + 1)),
                    "resign6_expected": sum(pr["total"]["exits"]["resign"][:6]),
                })
        for dept in [None, *hist["depts"]]:
            lvl = "total" if dept is None else "dept"
            for h in range(1, H + 1):
                m = shift(o, h)
                if hc_s[dept].get(m) is None:
                    continue
                for kind in ("naive", "snaive", "trend"):
                    records.append({"origin": o, "level": lvl, "dept": dept, "h": h, "target": "hc", "method": kind, "y": hc_s[dept][m], "yhat": baseline(hc_s[dept], o, h, kind)})
                if ms_s[dept].get(m) is not None:
                    for kind in ("naive", "snaive", "snaive_growth", "trend"):
                        records.append({"origin": o, "level": lvl, "dept": dept, "h": h, "target": "mass", "method": kind, "y": ms_s[dept][m], "yhat": baseline(ms_s[dept], o, h, kind)})
        log(f"origine {o} ({time.time() - t0:.1f} s)")
    return {"records": records, "scores": scores, "components": components}


def in_range(o: str, rng: tuple[str, str]) -> bool:
    return rng[0] <= o <= rng[1]


def quantiles(scores: list[dict], variant: str, target: str, origins_ok) -> dict:
    out = {}
    for lvl in ("dept", "total"):
        q = [conformal_q([s["score"] for s in scores if s["variant"] == variant and s["target"] == target and s["level"] == lvl and s["h"] == h and origins_ok(s["origin"])], LEVEL) for h in range(1, H + 1)]
        out[lvl] = monotone(q)
    return out


def summarize(bt: dict) -> dict:
    recs = [r for r in bt["records"] if in_range(r["origin"], TEST)]
    methods = sorted({r["method"] for r in recs})
    point = {}
    for target in ("hc", "mass"):
        point[target] = {}
        for lvl in ("total", "dept"):
            point[target][lvl] = {}
            for meth in methods:
                sel = [r for r in recs if r["target"] == target and r["level"] == lvl and r["method"] == meth]
                if not sel:
                    continue
                point[target][lvl][meth] = {
                    "all": point_metrics(sel),
                    "by_h": [point_metrics([r for r in sel if r["h"] == h]) for h in range(1, H + 1)],
                }
    coverage = {}
    for variant in VARIANTS:
        for target in ("hc", "mass"):
            q = quantiles(bt["scores"], variant, target, lambda o: in_range(o, CALIB))
            cov = {}
            for lvl in ("total", "dept"):
                test = [s for s in bt["scores"] if s["variant"] == variant and s["target"] == target and s["level"] == lvl and in_range(s["origin"], TEST)]
                if not test:
                    continue
                by_h = []
                for h in range(1, H + 1):
                    sel = [s for s in test if s["h"] == h]
                    hw = [q[lvl][h - 1] * s["scale"] for s in sel]
                    by_h.append({
                        "n": len(sel), "q": q[lvl][h - 1],
                        "coverage": float(np.mean([abs(s["y"] - s["yhat"]) <= w for s, w in zip(sel, hw)])),
                        "rel_width": float(np.mean([2 * w / s["y"] for s, w in zip(sel, hw)])),
                    })
                allcov = float(np.mean([abs(s["y"] - s["yhat"]) <= q[lvl][s["h"] - 1] * s["scale"] for s in test]))
                cov[lvl] = {"all": allcov, "by_h": by_h}
            coverage[f"{variant}:{target}"] = cov
    comp = {}
    for variant in VARIANTS:
        sel = [c for c in bt["components"] if c["variant"] == variant and in_range(c["origin"], TEST)]
        if not sel:
            continue
        comp[variant] = {
            "n_origins": len(sel),
            "expected": {k: float(np.mean([c["expected"][k] for c in sel])) for k in ("resign", "other", "cdd", "retire", "known")},
            "actual": {k: float(np.mean([c["actual"][k] for c in sel])) for k in ("resign", "other", "cdd", "retire")},
            "hires_expected": float(np.mean([c["hires_expected"] for c in sel])),
            "hires_actual": float(np.mean([c["hires_actual"] for c in sel])),
        }
    return {"point": point, "coverage": coverage, "components": comp}


def data_hash(con) -> str:
    h = hashlib.sha256()
    for a in rows(con, "aggregates", {"from": "0000-01", "to": "9999-12"}):
        h.update(f"{a['month']}|{a['department_id']}|{a['headcount']}|{a['entries']}|{a['payroll_mass']}\n".encode())
    for r in con.execute("SELECT employee_id, exit_date, reason FROM exit_event ORDER BY id"):
        h.update(f"{r}\n".encode())
    return h.hexdigest()


def golden_cases(be: dict, bm: dict, n: int = 16, seed: int = 20260930) -> list[dict]:
    rng = np.random.default_rng(seed)
    grades = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", None]
    cases = []
    for c in range(n):
        nd = int(rng.integers(1, 5))
        source = "LOGREG" if c % 2 else "TAUX"
        depts = []
        for i in range(nd):
            level = None if (c % 7 == 3 and i == 0) else float(rng.uniform(-0.02, 0.12))
            depts.append({
                "id": 10 + i, "code": f"D{i}", "name": f"Département {i}", "hc0": 0,
                "mass0": None if c % 5 == 4 else float(rng.uniform(5e4, 5e5)),
                "resignRate": float(rng.uniform(0, 0.02)), "otherRate": float(rng.uniform(0, 0.005)),
                "hiresPerMonth": float(rng.uniform(0, 4)), "hireSalary": float(rng.uniform(800, 2500)),
                "avgBase": float(rng.uniform(900, 2600)), "level": level,
            })
        members = []
        for _ in range(int(rng.integers(0, 70)) if c else 0):
            d = int(rng.integers(0, nd))
            depts[d]["hc0"] += 1
            members.append({
                "d": d, "base": float(rng.uniform(600, 4200)),
                "p6": (None if rng.random() < 0.2 else float(rng.uniform(0, 0.6))) if source == "LOGREG" else None,
                "cdd": int(rng.integers(1, H + 1)) if rng.random() < 0.3 else None,
                "ret": int(rng.integers(1, H + 1)) if rng.random() < 0.1 else None,
                "known": int(rng.integers(1, H + 3)) if rng.random() < 0.05 else None,
                "grade": grades[int(rng.integers(0, len(grades)))],
            })
        state = {
            "asOf": "", "month0": month_label(2025 * 12 + int(rng.integers(0, 36))), "resignSource": source,
            "qCdd": float(rng.uniform(0, 0.4)), "qRet": float(rng.uniform(0.5, 1)),
            "raise": float(rng.uniform(0, 0.08)), "drift": float(rng.uniform(-0.001, 0.003)),
            "levelTotal": None if c % 7 == 3 else float(rng.uniform(0, 0.1)), "departments": depts, "members": members,
        }
        state["asOf"] = month_end(state["month0"])
        scenario = {"hiringPct": [0.0, 50.0, 100.0, 150.0, 237.5][c % 5], "raise": None if c % 3 == 0 else float(rng.uniform(0, 0.1))}
        cases.append({"state": state, "scenario": scenario, "output": project(be, bm, state, scenario)})
    return cases


def write_bundle(out_dir: Path, bundle: dict, golden: list[dict]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "model.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "golden.json").write_text(json.dumps(golden, ensure_ascii=False), encoding="utf-8")


def reference(con, be: dict, bm: dict, as_of: str) -> dict:
    st = build_state(con, as_of, be, bm, None)
    pr = project(be, bm, st, {"hiringPct": 100.0})
    return {
        "asOf": as_of, "resignSource": st["resignSource"],
        "state": {k: st[k] for k in ("qCdd", "qRet", "raise", "drift", "levelTotal")} | {"members": len(st["members"])},
        "total_hc": pr["total"]["hc"], "total_hc_lower": pr["total"]["hcLower"], "total_hc_upper": pr["total"]["hcUpper"],
        "total_mass": pr["total"]["mass"],
        "dept_hc12": {d["code"]: d["hc"][H - 1] for d in pr["departments"]},
        "exits_12": {c: sum(pr["total"]["exits"][c]) for c in CAUSES},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "app.db"))
    ap.add_argument("--name", default="mixte_medium_s1")
    ap.add_argument("--bundle", action="store_true")
    ap.add_argument("--no-logreg", action="store_true")
    ap.add_argument("--version-date", default=datetime.now(timezone.utc).strftime("%Y%m%d"))
    args = ap.parse_args()

    con = connect_ro(args.db)
    hist = load_history(con)
    last = hist["months"][-1]
    origins = months_between(FIRST, shift(last, -H))
    panel = None
    if not args.no_logreg:
        from ml.train.data import load_panel

        panel = load_panel(args.db, complete_only=False)
        log(f"panel {panel[1].shape}")
    bt = run_backtest(con, hist, panel, origins)
    summary = summarize(bt)

    season_final = season_regression(hist["base"], hist["mass"], last)
    all_ok = lambda o: True  # noqa: E731
    interval_e = {"level": LEVEL, "method": "conforme normalisé (|erreur| / écart-type stock-flux), toutes origines"}
    interval_m = {"level": LEVEL, "method": "conforme relatif (|erreur| / prévision), toutes origines"}
    for v in VARIANTS:
        if any(s["variant"] == v for s in bt["scores"]):
            interval_e[v] = quantiles(bt["scores"], v, "hc", all_ok)
            interval_m[v] = quantiles(bt["scores"], v, "mass", all_ok)

    trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dh = f"sha256:{data_hash(con)}"
    ve, vm = f"effectif-v1-{args.version_date}", f"masse-v1-{args.version_date}"
    protocol = {
        "origins": [origins[0], origins[-1]], "calibration": list(CALIB), "test": list(TEST), "horizon": H,
        "level": LEVEL, "resignation_model": "LOGREG recette de production réentraînée à chaque origine (t + 6 <= origine)",
    }
    point = summary["point"]
    be = {
        "version": ve, **EFFECTIF_SPEC, "interval": interval_e,
        "trained_at": trained_at, "data_hash": dh, "train_from": hist["months"][0], "train_to": last,
        "metrics": clean({"protocol": protocol, "test": {"total": point["hc"]["total"], "dept": {k: v["all"] for k, v in point["hc"]["dept"].items()}},
                          "coverage": {k.split(":")[0]: v for k, v in summary["coverage"].items() if k.endswith(":hc")},
                          "components": summary["components"]}),
    }
    bm = {
        "version": vm, **MASSE_SPEC, "effectif_version": ve, "season": season_final["season"],
        "regression": clean({k: v for k, v in season_final.items() if k != "season"}), "interval": interval_m,
        "trained_at": trained_at, "data_hash": dh, "train_from": hist["months"][0], "train_to": last,
        "metrics": clean({"protocol": protocol, "test": {"total": point["mass"]["total"], "dept": {k: v["all"] for k, v in point["mass"]["dept"].items()}},
                          "coverage": {k.split(":")[0]: v for k, v in summary["coverage"].items() if k.endswith(":mass")}}),
    }
    ref = reference(con, be, bm, month_end(last))
    be["metrics"]["reference"] = ref
    bm["metrics"]["reference"] = {"asOf": ref["asOf"], "total_mass": ref["total_mass"], "raise": ref["state"]["raise"]}

    per_origin = []
    for o in origins:
        row = {"origin": o}
        for meth in ("modele_taux", "modele_logreg", "naive", "snaive", "trend"):
            for tgt in ("hc", "mass"):
                sel = {r["h"]: r for r in bt["records"] if r["origin"] == o and r["level"] == "total" and r["method"] == meth and r["target"] == tgt}
                if 12 in sel:
                    row[f"{tgt}:{meth}:h12"] = sel[12]["yhat"]
                    row[f"{tgt}:y:h12"] = sel[12]["y"]
        per_origin.append(row)
    results = {
        "name": args.name, "db": args.db, "generated_at": trained_at, "data_hash": dh, "protocol": protocol,
        "season_final": season_final, "summary": summary, "per_origin": per_origin,
        "components_by_origin": bt["components"], "reference": ref, "versions": {"EFFECTIF": ve, "MASSE_SALARIALE": vm},
    }
    out = ROOT / "ml" / "workforce" / "results" / f"{args.name}.json"
    out.write_text(json.dumps(clean(results), ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"résultats : {out}")

    if args.bundle:
        gold = golden_cases(be, bm)
        meta = {"bundles": {"EFFECTIF": ve, "MASSE_SALARIALE": vm}}
        write_bundle(ROOT / "models" / "workforce" / ve, be, [{**meta, **g} for g in gold])
        write_bundle(ROOT / "models" / "workforce" / vm, bm, [{**meta, **g} for g in gold])
        log(f"bundles : models/workforce/{ve}, models/workforce/{vm}")


if __name__ == "__main__":
    main()

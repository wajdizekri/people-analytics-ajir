"""Profils types de départs volontaires : k-moyennes hors ligne, choix de k, description en mots, bundle de production.

python -m ml.typology.run --db data/app.db [--boot 200] [--bundle] [--mechanisms <sim>/ground_truth/mechanisms.csv]
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import chi2_contingency
from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score

from .cluster import bundle_assign, bundle_distances, choose_k, evaluate_k, fit_preprocess, standardize
from .data import ROOT, data_hash, load_departures, load_spec
from .describe import describe_profiles

# Variables professionnelles à la veille du départ (feature_snapshot) et transformation. Exclus : sexe, âge, situation
# familiale, gouvernorat, santé (ADR-009), retards, régularité d'arrivée, jours sans badge, absences courtes et facteur
# de Bradford (rien qui ressemble à une détection d'abus), évaluations, contexte d'équipe. Le contrat (0/1) n'entre pas
# dans les distances (une variable binaire standardisée y domine) : comme la famille de métier, il décrit les profils.
FEATURES = [
    ("tenure_months", "log1p"),
    ("months_since_promotion", "none"),
    ("raise_pct_12m", "none"),
    ("compa_ratio", "none"),
    ("overtime_h_avg_3m", "log1p"),
    ("absence_rate_12m", "sqrt"),
    ("training_hours_12m", "log1p"),
]
K_GRID = (3, 4, 5, 6, 7, 8)  # fusions comprises, profils retenus de K_RANGE[0] à K_RANGE[1]
K_RANGE = (3, 6)
MIN_PROFILE_SIZE = 20
MIN_PROFILE_SHARE = 0.05
MIN_TRAIN_DEPARTURES = 60
VERSION = "typo-kmeans-v1-20261004"  # = TYPOLOGY_VERSION de src/lib/ai/typology/bundle.ts
POPULATION = ("Démissions et abandons de poste visibles à la référence ; variables à la dernière fin de mois avant la "
              "démission (au plus 6 mois avant), opposés au traitement exclus")


def num(v, digits: int = 6):
    """Nombre JSON valide pour TypeScript (NaN -> null)."""
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), digits)


def clean(o):
    """Valeurs JSON strictes (NaN -> null, types numpy -> Python)."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if math.isnan(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o


def cramers_v(a, b) -> float | None:
    t = pd.crosstab(pd.Series(a), pd.Series(b))
    if min(t.shape) < 2:
        return None
    chi2 = chi2_contingency(t.to_numpy(), correction=False)[0]
    return float(math.sqrt(chi2 / (t.to_numpy().sum() * (min(t.shape) - 1))))


def shares(labels, values, ids) -> dict:
    out = {}
    for pid in ids:
        v = pd.Series(values[labels == pid]).value_counts(normalize=True)
        out[str(pid)] = {str(k): round(float(x), 4) for k, x in v.items()}
    out["ensemble"] = {str(k): round(float(x), 4) for k, x in pd.Series(values).value_counts(normalize=True).items()}
    return out


def golden_rows(bundle: dict, Xm: np.ndarray, rng) -> list[dict]:
    n = len(Xm)
    take = rng.choice(n, min(150, n), replace=False)
    lo, hi = Xm.min(axis=0), Xm.max(axis=0)
    span = np.where(hi > lo, hi - lo, 1.0)
    synth = rng.uniform(lo - 0.2 * span, hi + 0.2 * span, size=(50, Xm.shape[1]))
    rows = [Xm[i] for i in np.sort(take)] + list(synth)
    return [{"x": [float(v) for v in r], "d": bundle_distances(bundle, r), "profile": bundle_assign(bundle, r)} for r in rows]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/app.db")
    ap.add_argument("--boot", type=int, default=200)
    ap.add_argument("--k-grid", default=",".join(str(k) for k in K_GRID))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--bundle", action="store_true")
    ap.add_argument("--version", default=VERSION)
    ap.add_argument("--mechanisms", default=None, help="vérité terrain du simulateur (validation externe, jamais importée)")
    ap.add_argument("--results", default=str(ROOT / "ml" / "typology" / "results" / "results.json"))
    a = ap.parse_args()

    spec = load_spec()
    all_names = [f["name"] for f in spec["features"]]
    names = [f for f, _ in FEATURES]
    transforms = [t for _, t in FEATURES]
    meta, X, info = load_departures(a.db, spec)
    n = len(meta)
    if n < MIN_TRAIN_DEPARTURES:
        raise SystemExit(f"{n} départs classables : il en faut au moins {MIN_TRAIN_DEPARTURES} pour décrire des profils.")
    feature_index = [all_names.index(f) for f in names]
    Xm = X[:, feature_index]
    pre = fit_preprocess(Xm, transforms)
    Z = standardize(Xm, pre)
    min_size = max(MIN_PROFILE_SIZE, math.ceil(MIN_PROFILE_SHARE * n))

    grid = [int(k) for k in a.k_grid.split(",")]
    cands, seen = [], set()
    for k in grid:
        c = evaluate_k(Z, k, min_size, a.boot, a.seed, skip_stability=True)
        if K_RANGE[0] <= c["k_effective"] <= K_RANGE[1] and c["k_effective"] not in seen:
            seen.add(c["k_effective"])
            c = evaluate_k(Z, k, min_size, a.boot, a.seed)
        cands.append(c)
        s = c["stability"]
        print(f"k={k} -> {c['k_effective']} profils (fusions {c['merges']}), tailles {c['sizes']}, silhouette {c['silhouette']:.3f}, "
              f"ARI {s['ari_mean']:.3f} [{s['ari_ci95'][0]:.3f} ; {s['ari_ci95'][1]:.3f}], Jaccard min {s['jaccard_min']:.3f}", flush=True)
    if not seen:
        # Repli : aucune partition dans la plage, stabilité calculée pour toutes
        cands = [evaluate_k(Z, k, min_size, a.boot, a.seed) for k in grid]
    pick, rule = choose_k(cands, *K_RANGE)
    centers = pick["centers"]

    core = {"transform": transforms, "clip": pre["clip"], "standardization": {"mean": pre["mean"], "std": pre["std"]},
            "centers": [[float(v) for v in c] for c in centers]}
    dist = np.array([bundle_distances(core, row) for row in Xm])
    labels = dist.argmin(axis=1)
    profiles = describe_profiles(names, Xm, Z, labels, meta["jobFamily"].to_numpy(), X[:, all_names.index("tenure_months")],
                                 X[:, all_names.index("contract_cdd")])
    for p in profiles:
        p["id"] = p.pop("index") + 1
        p["stability"] = round(pick["stability"]["jaccard"][p["id"] - 1], 4)
    bundle_ids = [p["id"] for p in profiles]
    ids = np.array(bundle_ids)[labels]

    bundle = {
        "version": a.version, "kind": "KMEANS", "topic": "TYPOLOGIE_DEPARTS", "fsv": spec["fsv"], "population": POPULATION,
        "features": names, "feature_index": feature_index, **core,
        "profiles": [{"id": p["id"], "label": p["label"], "traits": p["traits"], "size": p["size"], "share": round(p["share"], 6),
                      "median_tenure_months": p["median_tenure_months"], "stability": p["stability"]} for p in profiles],
        "k": int(len(centers)), "k_grid": grid, "min_profile_size": int(min_size),
        "selection": {"rule": rule, "candidates": [{"k": c["k"], "k_effective": c["k_effective"], "merges": c["merges"], "sizes": c["sizes"],
                                                     "silhouette": num(c["silhouette"]), "ari_mean": num(c["stability"]["ari_mean"]),
                                                     "jaccard_min": num(c["stability"]["jaccard_min"])} for c in cands]},
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "data_hash": f"sha256:{data_hash(meta)}",
        "reference_date": info["ref"], "train_rows": n, "train_from": info["first_exit"], "train_to": info["last_exit"],
        "metrics": {"silhouette": round(pick["silhouette"], 6), "ari_mean": round(pick["stability"]["ari_mean"], 6),
                    "ari_ci95": [round(v, 6) for v in pick["stability"]["ari_ci95"]], "jaccard_min": round(pick["stability"]["jaccard_min"], 6),
                    "n_boot": a.boot, "departures": info["departures"], "unclassified": info["unclassified"]},
    }

    out = {
        "summary": {**info, "variables": names, "transforms": transforms, "min_profile_size": int(min_size),
                    "describe": {f: {"mean": float(Xm[:, j].mean()), "median": float(np.median(Xm[:, j])), "p10": float(np.quantile(Xm[:, j], 0.1)),
                                     "p90": float(np.quantile(Xm[:, j], 0.9))} for j, f in enumerate(names)}},
        "candidates": [{k: v for k, v in c.items() if k != "centers"} for c in cands],
        "contract_cdd_by_profile": {str(pid): round(float((X[:, all_names.index("contract_cdd")][ids == pid]).mean()), 4) for pid in bundle_ids},
        "chosen": {"k": pick["k"], "k_effective": pick["k_effective"], "rule": rule},
        "profiles": bundle["profiles"],
        # Audit d'équité hors ligne (ADR-009) : agrégats seulement, jamais dans le bundle
        "fairness": {"cramers_v_sex": cramers_v(ids, meta["sex"]), "cramers_v_age_band": cramers_v(ids, meta["age_band"]),
                     "sex_by_profile": shares(ids, meta["sex"].to_numpy(), bundle_ids),
                     "age_band_by_profile": shares(ids, meta["age_band"].to_numpy(), bundle_ids)},
        "job_family_by_profile": shares(ids, meta["jobFamily"].to_numpy(), bundle_ids),
    }
    if a.mechanisms:
        mech = pd.read_csv(a.mechanisms, sep=";", dtype=str)[["matricule", "mechanism"]].drop_duplicates("matricule", keep="last")
        j = meta.assign(profile=ids)[["matricule", "profile"]].merge(mech, on="matricule", how="left")
        known = j["mechanism"].notna()
        out["mechanisms"] = {
            "matched": int(known.sum()), "unmatched": int((~known).sum()),
            "ari": float(adjusted_rand_score(j.loc[known, "mechanism"], j.loc[known, "profile"])),
            "nmi": float(normalized_mutual_info_score(j.loc[known, "mechanism"], j.loc[known, "profile"])),
            "crosstab": {str(k): {str(m): int(v) for m, v in row.items()} for k, row in pd.crosstab(j.loc[known, "profile"], j.loc[known, "mechanism"]).iterrows()},
        }

    if a.bundle:
        d = ROOT / "models" / "typology" / a.version
        d.mkdir(parents=True, exist_ok=True)
        rng = np.random.default_rng(3)
        golden = {
            "version": a.version, "rows": golden_rows(bundle, Xm, rng),
            "selection": {"reference_date": info["ref"], "fsv": spec["fsv"], "rows": [[int(e), str(t)] for e, t in meta[["exitId", "asOf"]].itertuples(index=False)],
                          "sizes": {str(p["id"]): p["size"] for p in profiles}},
        }
        (d / "model.json").write_text(json.dumps(clean(bundle), ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        (d / "golden.json").write_text(json.dumps(golden, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        out["bundle"] = {"dir": str(d.relative_to(ROOT)).replace("\\", "/"), "version": a.version}

    Path(a.results).parent.mkdir(parents=True, exist_ok=True)
    Path(a.results).write_text(json.dumps(clean(out), ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"\n{info['departures']} départs volontaires, {n} classables, {info['unclassified']} non classés (dont {info['opposed']} opposés) ; "
          f"taille minimale {min_size}. Choix : k={pick['k_effective']} ({rule}).")
    for p in profiles:
        print(f"  [{p['id']}] {p['label']} : {p['size']} ({p['share'] * 100:.1f} %), ancienneté médiane {p['median_tenure_months']:.0f} mois, stabilité {p['stability']:.2f}")
        for t in p["traits"]:
            print(f"      - {t['text']}")
    f = out["fairness"]
    print(f"Équité (hors ligne) : V de Cramér profil x sexe {f['cramers_v_sex']}, profil x tranche d'âge {f['cramers_v_age_band']}")
    if "mechanisms" in out:
        print(f"Mécanismes simulés : ARI {out['mechanisms']['ari']:.3f}, NMI {out['mechanisms']['nmi']:.3f}")


if __name__ == "__main__":
    main()

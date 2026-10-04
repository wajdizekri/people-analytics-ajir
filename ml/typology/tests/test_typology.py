"""Profils de départs : sélection, prétraitement, garde de taille minimale, choix de k, description sans attribut sensible."""
import json
import re
import sqlite3

import numpy as np
import pytest

from ml.typology.cluster import (bundle_assign, bundle_distances, bundle_prepare, choose_k, evaluate_k, fit_preprocess, merge_small,
                                 kmeans, nearest, standardize)
from ml.typology.data import load_departures
from ml.typology.describe import describe_profiles
from ml.typology.run import FEATURES

NAMES = [f for f, _ in FEATURES]
TRANSFORMS = [t for _, t in FEATURES]
SENSITIVE = re.compile(r"\b(sexe|femmes?|hommes?|âge|ans|gouvernorat|mari[ée]s?|célibataires?|enfants?|santé|maladie|maternité)\b", re.I)


def blobs(sizes, rng):
    """Départs synthétiques dans l'ordre de FEATURES : jeunes embauchés peu augmentés (en CDD), seniors sans promotion,
    heures sup, formés et augmentés. Renvoie (X, profil vrai, CDD)."""
    protos = [
        [8, 8, 0.0, 0.9, 2, 0.01, 4],
        [180, 90, 0.03, 1.0, 3, 0.01, 12],
        [60, 30, 0.05, 1.0, 25, 0.02, 8],
        [40, 20, 0.08, 1.15, 5, 0.04, 30],
    ]
    rows, lab = [], []
    for c, n in enumerate(sizes):
        p = np.array(protos[c], dtype=float)
        noise = rng.normal(0, 1, (n, len(p))) * np.array([3, 3, 0.005, 0.02, 1.5, 0.004, 2])
        rows.append(np.maximum(p + noise, 0))
        lab += [c] * n
    lab = np.array(lab)
    return np.vstack(rows), lab, (lab == 0).astype(float)


def test_bundle_math_matches_vectorized_preprocessing():
    rng = np.random.default_rng(1)
    X, _, _ = blobs([40, 40, 40], rng)
    pre = fit_preprocess(X, TRANSFORMS)
    Z = standardize(X, pre)
    bundle = {"transform": TRANSFORMS, "clip": pre["clip"], "standardization": {"mean": pre["mean"], "std": pre["std"]},
              "centers": [list(Z[0]), list(Z[50])], "profiles": [{"id": 1}, {"id": 2}]}
    for i in range(len(X)):
        assert np.allclose(bundle_prepare(bundle, X[i]), Z[i], atol=1e-12)
    assert bundle_distances(bundle, X[0])[0] == pytest.approx(0, abs=1e-20)
    assert bundle_assign(bundle, X[0]) == 1 and bundle_assign(bundle, X[50]) == 2
    assert bundle_prepare(bundle, [-5] + list(X[0][1:]))[0] == bundle_prepare(bundle, [0] + list(X[0][1:]))[0]


def test_merge_small_enforces_min_size():
    rng = np.random.default_rng(2)
    X, _, _ = blobs([100, 100, 8], rng)
    Z = standardize(X, fit_preprocess(X, TRANSFORMS))
    centers, merges = merge_small(Z, kmeans(Z, 3, seed=0), min_size=20)
    sizes = np.bincount(nearest(Z, centers))
    assert merges == 1 and len(centers) == 2 and sizes.min() >= 20


def test_choose_k_finds_the_four_profiles():
    rng = np.random.default_rng(3)
    X, truth, _ = blobs([70, 60, 50, 40], rng)
    Z = standardize(X, fit_preprocess(X, TRANSFORMS))
    cands = [evaluate_k(Z, k, min_size=20, n_boot=15) for k in (3, 4, 5)]
    pick, rule = choose_k(cands)
    assert pick["k_effective"] == 4, rule
    two, _ = choose_k([dict(cands[0], k_effective=2)] + cands[1:])
    assert two["k_effective"] >= 3
    assert pick["stability"]["ari_mean"] > 0.9


def test_descriptions_in_words_without_sensitive_attribute():
    rng = np.random.default_rng(4)
    X, truth, cdd = blobs([70, 60, 50], rng)
    pre = fit_preprocess(X, TRANSFORMS)
    Z = standardize(X, pre)
    families = np.array(["Production"] * 70 + ["IT"] * 60 + ["Finance"] * 50)
    profiles = describe_profiles(NAMES, X, Z, truth, families, X[:, 0], cdd)
    labels = [p["label"] for p in profiles]
    assert len(set(labels)) == 3
    young = {(t["feature"], t["direction"]) for t in profiles[0]["traits"]}
    senior = {(t["feature"], t["direction"]) for t in profiles[1]["traits"]}
    assert young & {("tenure_months", "BAISSE"), ("months_since_promotion", "BAISSE"), ("raise_pct_12m", "BAISSE"), ("contract_cdd", "HAUSSE")}
    assert senior & {("tenure_months", "HAUSSE"), ("months_since_promotion", "HAUSSE")}
    for p in profiles:
        effects = [abs(t["effect"]) for t in p["traits"] if t["direction"] != "PROCHE"]
        assert effects == sorted(effects, reverse=True)
        assert 3 <= len(p["traits"]) <= 4
        for t in p["traits"]:
            assert not SENSITIVE.search(t["text"].replace("hors santé", "")), t["text"]
            assert len(t["text"].split()) <= 20, t["text"]
            assert t["feature"] in NAMES or t["feature"] == "contract_cdd" or t["feature"].startswith("job_family:")
        assert "absence" not in p["label"].lower()
    assert "promotion récente" not in profiles[0]["label"].lower()
    assert sum(p["size"] for p in profiles) == len(X)


@pytest.fixture()
def db(tmp_path):
    f = tmp_path / "t.db"
    c = sqlite3.connect(f)
    c.executescript("""
        CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE department (id INTEGER PRIMARY KEY, code TEXT, name TEXT);
        CREATE TABLE employee (id INTEGER PRIMARY KEY, matricule TEXT, sex TEXT, birth_date TEXT, department_id INTEGER, job_family TEXT);
        CREATE TABLE exit_event (id INTEGER PRIMARY KEY, employee_id INTEGER, exit_date TEXT, reason TEXT, resignation_date TEXT, recorded_at TEXT);
        CREATE TABLE feature_snapshot (employee_id INTEGER, as_of TEXT, fsv TEXT, values_json TEXT, partial_history INTEGER);
        CREATE TABLE employee_opposition (employee_id INTEGER PRIMARY KEY);
        INSERT INTO app_setting VALUES ('data_end_date', '2026-08-31');
        INSERT INTO department VALUES (1, 'PROD', 'Production');
    """)
    v = json.dumps([1.0] * 25)
    for i in range(1, 8):
        c.execute("INSERT INTO employee VALUES (?, ?, 'F', '1990-01-01', 1, 'Production')", (i, f"M{i}"))
    c.executemany("INSERT INTO exit_event VALUES (?, ?, ?, ?, ?, ?)", [
        (1, 1, "2025-07-31", "DEMISSION", "2025-06-15", "2025-06-16"),  # snapshot 2025-05-31 retenu (pas 2025-06-30)
        (2, 2, "2025-07-31", "ABANDON", None, "2025-07-31"),  # événement = sortie - 1 mois (2025-07-01 pour SQLite) : 2025-06-30
        (3, 3, "2025-07-31", "FIN_CDD", None, "2025-07-31"),  # non volontaire
        (4, 4, "2026-08-20", "DEMISSION", None, "2026-09-03"),  # saisie après la référence
        (5, 5, "2025-07-31", "DEMISSION", "2025-06-15", "2025-06-16"),  # opposé au traitement
        (6, 6, "2025-07-31", "DEMISSION", "2025-06-15", "2025-06-16"),  # dernier snapshot trop ancien
    ])
    for e, as_of in [(1, "2025-04-30"), (1, "2025-05-31"), (1, "2025-06-30"), (2, "2025-05-31"), (2, "2025-06-30"), (3, "2025-05-31"),
                     (5, "2025-05-31"), (6, "2024-11-30")]:
        c.execute("INSERT INTO feature_snapshot VALUES (?, ?, 'v1', ?, 0)", (e, as_of, v))
    c.execute("INSERT INTO employee_opposition VALUES (5)")
    c.commit()
    c.close()
    return f


def test_departures_selection_rules(db):
    meta, X, info = load_departures(db)
    assert info["departures"] == 4  # 1, 2, 5, 6 (FIN_CDD et saisie tardive exclus)
    assert info["opposed"] == 1 and info["classified"] == 2 and info["unclassified"] == 2
    assert dict(zip(meta["exitId"], meta["asOf"])) == {1: "2025-05-31", 2: "2025-06-30"}
    assert X.shape == (2, 25)
    assert set(meta["age_band"]) == {"30-44 ans"}

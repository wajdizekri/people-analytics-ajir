"""k-moyennes sur variables transformées, bornées et standardisées ; taille minimale par profil ; choix de k par
silhouette et stabilité bootstrap. Les fonctions bundle_* suivent la même suite d'opérations que
src/lib/ai/typology/model.ts (parité vérifiée par golden.json)."""
import math

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score

CLIP_QUANTILES = (0.01, 0.99)


def fit_preprocess(X: np.ndarray, transforms: list[str], clip_quantiles=CLIP_QUANTILES) -> dict:
    """Transformation (log1p, racine carrée), bornes aux quantiles, moyenne et écart-type (population) des valeurs bornées."""
    T = apply_transforms(X, transforms)
    lo = np.quantile(T, clip_quantiles[0], axis=0)
    hi = np.quantile(T, clip_quantiles[1], axis=0)
    C = np.clip(T, lo, hi)
    return {"transform": list(transforms), "clip": [[float(a), float(b)] for a, b in zip(lo, hi)],
            "mean": [float(v) for v in C.mean(axis=0)], "std": [float(v) for v in C.std(axis=0)]}


def apply_transforms(X: np.ndarray, transforms: list[str]) -> np.ndarray:
    T = np.array(X, dtype=float, copy=True)
    for j, t in enumerate(transforms):
        if t == "log1p":
            T[:, j] = np.log1p(np.maximum(T[:, j], 0.0))
        elif t == "sqrt":
            T[:, j] = np.sqrt(np.maximum(T[:, j], 0.0))
        elif t != "none":
            raise ValueError(f"transformation inconnue : {t}")
    return T


def standardize(X: np.ndarray, pre: dict) -> np.ndarray:
    T = apply_transforms(X, pre["transform"])
    lo = np.array([c[0] for c in pre["clip"]])
    hi = np.array([c[1] for c in pre["clip"]])
    std = np.array(pre["std"])
    return (np.clip(T, lo, hi) - np.array(pre["mean"])) / np.where(std == 0, 1.0, std)


def nearest(Z: np.ndarray, centers: np.ndarray) -> np.ndarray:
    d = ((Z[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
    return d.argmin(axis=1)


def kmeans(Z: np.ndarray, k: int, seed: int, n_init: int = 50) -> np.ndarray:
    km = KMeans(n_clusters=k, n_init=n_init, random_state=seed, algorithm="lloyd", max_iter=500, tol=1e-8)
    km.fit(Z)
    return km.cluster_centers_


def refine(Z: np.ndarray, centers: np.ndarray) -> np.ndarray:
    km = KMeans(n_clusters=len(centers), init=centers, n_init=1, algorithm="lloyd", max_iter=500, tol=1e-8)
    km.fit(Z)
    return km.cluster_centers_


def merge_small(Z: np.ndarray, centers: np.ndarray, min_size: int, min_k: int = 2) -> tuple[np.ndarray, int]:
    """Garde petites populations : tant qu'un profil compte moins de min_size départs, son centre est retiré et ses
    membres rejoignent le profil le plus proche (k-moyennes relancées depuis les centres restants). Renvoie
    (centres, nombre de fusions)."""
    merges = 0
    while len(centers) > min_k:
        sizes = np.bincount(nearest(Z, centers), minlength=len(centers))
        if sizes.min() >= min_size:
            break
        centers = refine(Z, np.delete(centers, int(sizes.argmin()), axis=0))
        merges += 1
    return centers, merges


def order_by_size(Z: np.ndarray, centers: np.ndarray) -> np.ndarray:
    sizes = np.bincount(nearest(Z, centers), minlength=len(centers))
    order = sorted(range(len(centers)), key=lambda c: (-sizes[c], tuple(np.round(centers[c], 12))))
    return centers[order]


def fit_profiles(Z: np.ndarray, k: int, min_size: int, seed: int = 0, n_init: int = 50) -> tuple[np.ndarray, int]:
    centers, merges = merge_small(Z, kmeans(Z, k, seed, n_init), min_size)
    return order_by_size(Z, centers), merges


def jaccard(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / union) if union else 0.0


def stability(Z: np.ndarray, centers: np.ndarray, k: int, min_size: int, n_boot: int, seed: int) -> dict:
    """Rééchantillonnage bootstrap : même procédure (k-moyennes + fusion) sur chaque échantillon, puis affectation de tous
    les départs aux centres obtenus. ARI avec la partition de référence ; par profil, Jaccard maximal (Hennig, 2007)."""
    ref = nearest(Z, centers)
    rng = np.random.default_rng(seed)
    n = len(Z)
    aris, jac = [], np.zeros((n_boot, len(centers)))
    for b in range(n_boot):
        idx = rng.integers(0, n, n)
        cb, _ = merge_small(Z[idx], kmeans(Z[idx], k, seed=b + 1, n_init=10), min_size)
        lab = nearest(Z, cb)
        aris.append(adjusted_rand_score(ref, lab))
        for c in range(len(centers)):
            A = ref == c
            jac[b, c] = max(jaccard(A, lab == d) for d in range(len(cb)))
    aris = np.array(aris)
    return {"ari_mean": float(aris.mean()), "ari_ci95": [float(np.quantile(aris, 0.025)), float(np.quantile(aris, 0.975))],
            "jaccard": [float(v) for v in jac.mean(axis=0)], "jaccard_min": float(jac.mean(axis=0).min()), "n_boot": n_boot}


STABLE_ARI = 0.6
STABLE_JACCARD = 0.6


def choose_k(candidates: list[dict], k_min: int = 3, k_max: int = 6) -> tuple[dict, str]:
    """Parmi les partitions de k_min à k_max profils après fusion (la première obtenue pour chaque nombre de profils), les
    stables (ARI moyen et Jaccard minimal >= 0,6) ; parmi elles la meilleure silhouette (à 0,005 près, le moins de
    profils). Sans partition stable, la plus stable (ARI moyen) ; sans partition dans la plage, toutes sont candidates."""
    seen, pool = set(), []
    for c in candidates:
        if k_min <= c["k_effective"] <= k_max and c["k_effective"] not in seen:
            seen.add(c["k_effective"])
            pool.append(c)
    note = ""
    if not pool:
        pool, note = list(candidates), f" (aucune partition de {k_min} à {k_max} profils après fusion)"
    stable = [c for c in pool if c["stability"]["ari_mean"] >= STABLE_ARI and c["stability"]["jaccard_min"] >= STABLE_JACCARD]
    if stable:
        best = max(c["silhouette"] for c in stable)
        pick = min((c for c in stable if c["silhouette"] >= best - 0.005), key=lambda c: c["k_effective"])
        return pick, "silhouette maximale parmi les partitions stables (ARI et Jaccard minimal >= 0,6)" + note
    pick = max(pool, key=lambda c: (round(c["stability"]["ari_mean"], 3), -c["k_effective"]))
    return pick, "aucune partition stable : partition la plus stable (ARI moyen)" + note


def evaluate_k(Z: np.ndarray, k: int, min_size: int, n_boot: int, seed: int = 0, skip_stability: bool = False) -> dict:
    """skip_stability : partition hors plage ou déjà obtenue avec un plus petit k (bootstrap inutile)."""
    centers, merges = fit_profiles(Z, k, min_size, seed)
    lab = nearest(Z, centers)
    sizes = np.bincount(lab, minlength=len(centers))
    sil = float(silhouette_score(Z, lab)) if len(centers) > 1 else float("nan")
    stab = ({"ari_mean": float("nan"), "ari_ci95": [float("nan")] * 2, "jaccard": [], "jaccard_min": float("nan"), "n_boot": 0}
            if skip_stability else stability(Z, centers, k, min_size, n_boot, seed + 1000))
    return {"k": k, "k_effective": int(len(centers)), "merges": merges, "centers": centers, "sizes": [int(s) for s in sizes],
            "silhouette": sil, "inertia": float(((Z - centers[lab]) ** 2).sum()), "stability": stab}


# ---------- Exécution du bundle (même suite d'opérations que src/lib/ai/typology/model.ts) ----------

def bundle_prepare(bundle: dict, raw) -> list[float]:
    st = bundle["standardization"]
    z = []
    for j, v in enumerate(raw):
        x = float(v)
        if bundle["transform"][j] == "log1p":
            x = math.log1p(max(x, 0.0))
        elif bundle["transform"][j] == "sqrt":
            x = math.sqrt(max(x, 0.0))
        lo, hi = bundle["clip"][j]
        x = min(max(x, lo), hi)
        s = st["std"][j]
        z.append((x - st["mean"][j]) / (1.0 if s == 0 else s))
    return z


def bundle_distances(bundle: dict, raw) -> list[float]:
    z = bundle_prepare(bundle, raw)
    out = []
    for c in bundle["centers"]:
        d = 0.0
        for j in range(len(z)):
            diff = z[j] - c[j]
            d += diff * diff
        out.append(d)
    return out


def bundle_assign(bundle: dict, raw) -> int:
    d = bundle_distances(bundle, raw)
    best = 0
    for i in range(1, len(d)):
        if d[i] < d[best]:
            best = i
    return bundle["profiles"][best]["id"]

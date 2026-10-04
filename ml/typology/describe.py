"""Description des profils en mots : traits les plus distinctifs (écart standardisé au groupe de tous les départs),
libellé court, taille, part. Aucun attribut sensible (ADR-009) : seules les variables du modèle, le contrat et la famille
de métier servent de traits ; les absences ne nomment jamais un profil."""
import numpy as np

NBSP = " "
TRAIT_EFFECT = 0.25  # écart minimal (en écarts-types) pour un trait « marqué »
LABEL_EFFECT = 0.5  # écart minimal pour nommer le profil
DESCRIPTOR_EFFECT = 0.5  # sur-représentation du CDD ou d'une famille de métier citée comme trait
MAX_TRAITS = 4
MIN_TRAITS = 3

# stat : statistique décrite (médiane, moyenne ou part) ; fmt : format de la valeur
VARIABLES = {
    "tenure_months": {
        "stat": "median", "fmt": "months", "neutral": "Ancienneté",
        "low": "arrivées récentes", "high": "grande ancienneté",
        "text": "Ancienneté médiane de {v}, contre {ref} pour l'ensemble des départs",
    },
    "months_since_promotion": {
        "stat": "median", "fmt": "months", "neutral": "Délai depuis la dernière promotion",
        "low": "promotion récente", "high": "sans promotion depuis longtemps",
        "text": "Sans promotion depuis {v} en médiane (ou depuis l'embauche), contre {ref} pour l'ensemble",
    },
    "raise_pct_12m": {
        "stat": "mean", "fmt": "pct1", "neutral": "Augmentation sur 12 mois",
        "low": "peu ou pas augmentés", "high": "augmentés récemment",
        "text": "Augmentation moyenne de {v} sur 12 mois, contre {ref} pour l'ensemble des départs",
    },
    "compa_ratio": {
        "stat": "median", "fmt": "pct0", "neutral": "Salaire par rapport à la médiane du poste",
        "low": "salaire sous la médiane du poste", "high": "salaire au-dessus de la médiane du poste",
        "text": "Salaire médian à {v} de la médiane du poste, contre {ref} pour l'ensemble",
    },
    "overtime_h_avg_3m": {
        "stat": "mean", "fmt": "hours", "neutral": "Heures supplémentaires",
        "low": "peu d'heures supplémentaires", "high": "heures supplémentaires élevées",
        "text": "Heures supplémentaires : {v} par mois en moyenne sur 3 mois, contre {ref} pour l'ensemble",
    },
    "absence_rate_12m": {
        "stat": "mean", "fmt": "pct1", "neutral": "Absences hors santé", "low": None, "high": None,
        "text": "Taux d'absence hors santé de {v} sur 12 mois, contre {ref} pour l'ensemble",
    },
    "training_hours_12m": {
        "stat": "mean", "fmt": "hours", "neutral": "Formation sur 12 mois",
        "low": "peu de formation", "high": "formation soutenue",
        "text": "Formation : {v} sur 12 mois en moyenne, contre {ref} pour l'ensemble",
    },
    "contract_cdd": {
        "stat": "mean", "fmt": "pct0", "neutral": "Part de CDD",
        "low": None, "high": "surtout en CDD",
        "text": "{v} en CDD au moment du départ, contre {ref} pour l'ensemble",
    },
}


def fr_number(x: float, digits: int) -> str:
    s = f"{x:,.{digits}f}"
    return s.replace(",", " ").replace(".", ",").replace(" ", NBSP)


def fmt_value(v: float, kind: str) -> str:
    if kind == "months":
        return f"{fr_number(round(v), 0)}{NBSP}mois"
    if kind == "pct0":
        return f"{fr_number(v * 100, 0)}{NBSP}%"
    if kind == "pct1":
        return f"{fr_number(v * 100, 1)}{NBSP}%"
    if kind == "hours":
        return f"{fr_number(v, 0 if abs(v) >= 10 else 1)}{NBSP}h"
    raise ValueError(kind)


def stat(values: np.ndarray, kind: str) -> float:
    return float(np.median(values)) if kind == "median" else float(np.mean(values))


def capitalize(s: str) -> str:
    return s[:1].upper() + s[1:]


def describe_profiles(names: list[str], X_model: np.ndarray, Z: np.ndarray, labels: np.ndarray, families: np.ndarray,
                      tenure: np.ndarray, contract: np.ndarray | None = None) -> list[dict]:
    """names, X_model (valeurs brutes), Z (standardisées) : variables du modèle dans l'ordre du bundle ; labels : indice
    de profil (ordre des centres) ; families : famille de métier ; tenure : ancienneté brute (mois) ; contract : 1 si CDD.
    Contrat et famille de métier sont des descripteurs : cités seulement s'ils sont sur-représentés dans le profil."""
    n = len(labels)
    k = int(labels.max()) + 1 if n else 0
    indicators = {} if contract is None else {"contract_cdd": (np.asarray(contract) == 1).astype(float)}
    for f in sorted(set(families)):
        indicators[f"job_family:{f}"] = (families == f).astype(float)
    profiles = []
    for c in range(k):
        m = labels == c
        model = []
        for j, name in enumerate(names):
            spec = VARIABLES[name]
            model.append({"feature": name, "effect": float(Z[m, j].mean() - Z[:, j].mean()),
                          "v": stat(X_model[m, j], spec["stat"]), "ref": stat(X_model[:, j], spec["stat"])})
        descriptors = []
        for key, ind in indicators.items():
            p = ind.mean()
            if 0 < p < 1:
                descriptors.append({"feature": key, "effect": float((ind[m].mean() - p) / np.sqrt(p * (1 - p))),
                                    "v": float(ind[m].mean()), "ref": float(p)})
        model.sort(key=lambda t: -abs(t["effect"]))
        descriptors = sorted((t for t in descriptors if t["effect"] >= DESCRIPTOR_EFFECT), key=lambda t: -t["effect"])
        marked = sorted([t for t in model if abs(t["effect"]) >= TRAIT_EFFECT] + descriptors, key=lambda t: -abs(t["effect"]))[:MAX_TRAITS]
        weak = [t for t in model if t not in marked]
        chosen = marked + weak[: max(0, MIN_TRAITS - len(marked))]
        traits = [trait_text(t, t in marked) for t in chosen]
        # Nom : variables de carrière, de salaire et de travail d'abord, puis contrat et famille de métier. Sans promotion,
        # le délai depuis la promotion vaut l'ancienneté : un délai court chez des arrivées récentes n'est pas une promotion.
        recent = next((t["effect"] < 0 for t in model if t["feature"] == "tenure_months"), False)
        label_parts = [short_label(t) for t in model if abs(t["effect"]) >= LABEL_EFFECT and short_label(t)
                       and not (t["feature"] == "months_since_promotion" and t["effect"] < 0 and recent)]
        label_parts += [short_label(t) for t in descriptors]
        profiles.append({
            "index": c, "label_parts": label_parts, "traits": traits, "size": int(m.sum()),
            "share": float(m.sum() / n) if n else 0.0, "median_tenure_months": float(np.median(tenure[m])) if m.any() else None,
        })
    return name_profiles(profiles)


def trait_text(t: dict, marked: bool) -> dict:
    if t["feature"].startswith("job_family:"):
        fam = t["feature"].split(":", 1)[1]
        text = f"{fmt_value(t['v'], 'pct0')} dans la famille {fam}, contre {fmt_value(t['ref'], 'pct0')} pour l'ensemble des départs"
        return {"feature": t["feature"], "direction": "HAUSSE", "effect": round(t["effect"], 6), "text": text}
    spec = VARIABLES[t["feature"]]
    v, ref = fmt_value(t["v"], spec["fmt"]), fmt_value(t["ref"], spec["fmt"])
    if marked:
        return {"feature": t["feature"], "direction": "HAUSSE" if t["effect"] > 0 else "BAISSE", "effect": round(t["effect"], 6),
                "text": spec["text"].format(v=v, ref=ref)}
    return {"feature": t["feature"], "direction": "PROCHE", "effect": round(t["effect"], 6),
            "text": f"{spec['neutral']} proche de l'ensemble des départs : {v} contre {ref}"}


def short_label(t: dict) -> str | None:
    if t["feature"].startswith("job_family:"):
        return f"surtout {t['feature'].split(':', 1)[1]}"
    spec = VARIABLES[t["feature"]]
    return spec["high"] if t["effect"] > 0 else spec["low"]


def name_profiles(profiles: list[dict]) -> list[dict]:
    """Libellé = deux traits les plus marqués ; « Départs sans trait marqué » sinon ; un troisième trait, puis le rang,
    départagent deux libellés identiques."""
    def base(p, n_parts):
        parts = p["label_parts"][:n_parts]
        return capitalize(", ".join(parts)) if parts else "Départs sans trait marqué"

    for p in profiles:
        p["label"] = base(p, 2)
    for _ in range(2):
        seen = {}
        for p in profiles:
            seen.setdefault(p["label"], []).append(p)
        for same in (g for g in seen.values() if len(g) > 1):
            for p in same:
                longer = base(p, 3)
                p["label"] = longer if longer != p["label"] else f"{p['label']} ({p['index'] + 1})"
    for p in profiles:
        del p["label_parts"]
    return profiles

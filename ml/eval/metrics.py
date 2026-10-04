"""Fonctions pures : règle de détection, appariement détections / événements, métriques."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import average_precision_score


def hot_mask(z: np.ndarray, threshold: float) -> np.ndarray:
    """Semaine « chaude » : z défini et strictement supérieur au seuil (comme detectAnomalies)."""
    z = np.asarray(z, dtype=float)
    return np.where(np.isnan(z), False, z > threshold)


def rule_fires(z: np.ndarray, threshold: float, k: int, lo: int, hi: int) -> list[int]:
    """Indices w de [lo, hi] où la règle se déclenche : k semaines chaudes consécutives se terminant en w,
    la semaine w - k n'étant pas chaude (un seul signalement par épisode). Réplique detectAnomalies."""
    hot = hot_mask(z, threshold)
    n = len(hot)

    def h(i: int) -> bool:
        return 0 <= i < n and bool(hot[i])

    out = []
    for w in range(max(lo, k - 1), min(hi, n - 1) + 1):
        if all(h(i) for i in range(w - k + 1, w + 1)) and not h(w - k):
            out.append(w)
    return out


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    """Chevauchement de deux intervalles de dates ISO fermés."""
    return a_start <= b_end and b_start <= a_end


@dataclass
class Event:
    anomaly_id: int
    type: str
    start: str
    end: str
    members: frozenset
    held_out: int = 0
    department_id: int | None = None


@dataclass
class Detection:
    key: str
    start: str
    end: str
    members: frozenset
    score: float = float("nan")
    matched: list = field(default_factory=list)


def match(detections: list[Detection], events: list[Event]) -> dict[int, list[int]]:
    """Une détection correspond à un événement si les périodes se chevauchent et si au moins un salarié touché
    appartient au groupe signalé. Renvoie {anomaly_id: [indices des détections]} et remplit Detection.matched."""
    hits: dict[int, list[int]] = {e.anomaly_id: [] for e in events}
    for i, d in enumerate(detections):
        d.matched = []
        for e in events:
            if overlaps(d.start, d.end, e.start, e.end) and d.members & e.members:
                d.matched.append(e.anomaly_id)
                hits[e.anomaly_id].append(i)
    return hits


def days_between(a: str, b: str) -> int:
    return int((np.datetime64(b) - np.datetime64(a)) / np.timedelta64(1, "D"))


def event_metrics(detections: list[Detection], events: list[Event], months: float) -> dict:
    """Rappel et délai par type, précision et faux positifs par mois (toutes détections confondues)."""
    hits = match(detections, events)
    types = sorted({e.type for e in events})
    per_type = {}
    for t in types:
        evs = [e for e in events if e.type == t]
        found = [e for e in evs if hits[e.anomaly_id]]
        delays = [min(days_between(e.start, detections[i].end) for i in hits[e.anomaly_id]) for e in found]
        per_type[t] = {
            "events": len(evs),
            "detected": len(found),
            "recall": len(found) / len(evs) if evs else None,
            "delay_median_days": float(np.median(delays)) if delays else None,
            "delay_min_days": int(min(delays)) if delays else None,
            "delay_max_days": int(max(delays)) if delays else None,
            "detections_attributed": sum(1 for d in detections if any(_type_of(events, a) == t for a in d.matched)),
        }
    tp = sum(1 for d in detections if d.matched)
    fp = len(detections) - tp
    return {
        "detections": len(detections),
        "true_detections": tp,
        "false_detections": fp,
        "precision": tp / len(detections) if detections else None,
        "fp_per_month": fp / months if months else None,
        "recall_all": sum(1 for e in events if hits[e.anomaly_id]) / len(events) if events else None,
        "per_type": per_type,
    }


def _type_of(events: list[Event], anomaly_id: int) -> str | None:
    for e in events:
        if e.anomaly_id == anomaly_id:
            return e.type
    return None


def average_precision(y_true, scores) -> float | None:
    """PR-AUC (précision moyenne, sklearn) ; None s'il n'y a aucun positif."""
    y = np.asarray(y_true, dtype=int)
    if y.sum() == 0 or y.sum() == len(y):
        return None
    s = np.nan_to_num(np.asarray(scores, dtype=float), nan=-1e9)
    return float(average_precision_score(y, s))


def binom_sf(k: int, n: int, p: float) -> float:
    """P(X >= k) pour X ~ Binomiale(n, p)."""
    from scipy.stats import binom

    return float(binom.sf(k - 1, n, p)) if n > 0 else 1.0

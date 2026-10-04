"""Indicateur individuel de surcharge soutenue (règle explicable, pas de modèle) et sa validation temporelle.

Surcharge à la fin du mois m : salarié actif, heures sup pointées du mois > seuil pendant au moins N mois consécutifs
(un mois sans aucun pointage rompt la série). Validation : départ volontaire (démission, abandon) dans ]m, m + 6 mois],
mois à suivi complet uniquement ; croisement avec le niveau de risque publié du mois.
"""
import numpy as np

from .data import Panel, month_end

THRESHOLDS = (15.0, 20.0, 25.0)
CONSECUTIVE = (2, 3, 4)
DEFAULT = (20.0, 3)


def streaks(P: Panel, thr: float) -> np.ndarray:
    over = (P.days > 0) & (P.ot_min / 60.0 > thr)
    s = np.zeros(over.shape, dtype=np.int64)
    for c in range(over.shape[1]):
        s[:, c] = np.where(over[:, c], (s[:, c - 1] if c else 0) + 1, 0)
    return s


def _future_exit(P: Panel, vol: dict, horizon=6) -> np.ndarray:
    """(E, M) : départ volontaire dans ]fin(m), fin(m + horizon)]."""
    E, M = P.act.shape
    y = np.zeros((E, M), dtype=bool)
    ends = [month_end(P.m0 + c) for c in range(M + horizon)]
    for k, eid in enumerate(P.emp_ids):
        d = vol.get(int(eid))
        if d is None:
            continue
        for c in range(M):
            y[k, c] = ends[c] < d <= ends[c + horizon]
    return y


def evaluate(P: Panel, vol: dict, risk: dict, n_boot=500, seed=11):
    y = _future_exit(P, vol)
    first, last = 12, P.n_obs - 7
    pop = P.act[:, first : last + 1] & (P.days[:, first : last + 1] > 0)
    Y = y[:, first : last + 1]
    lv = np.full(pop.shape, "", dtype=object)
    for k, eid in enumerate(P.emp_ids):
        for c in range(first, last + 1):
            lv[k, c - first] = risk["levels"].get((int(eid), month_end(P.m0 + c)), "")
    hi_risk = (lv == "ELEVE") | (lv == "MOYEN")
    base = float(Y[pop].mean())
    out = {"months": [month_end(P.m0 + first)[:7], month_end(P.m0 + last)[:7]], "person_months": int(pop.sum()), "base_rate": base, "grid": []}
    for thr in THRESHOLDS:
        st = streaks(P, thr)
        for N in CONSECUTIVE:
            F = (st[:, first : last + 1] >= N) & pop
            nxt = (st[:, first + 1 : last + 2] >= N)
            act_next = P.act[:, first + 1 : last + 2]
            row = {
                "threshold_h": thr,
                "months": N,
                "flagged_share": float(F.sum() / pop.sum()),
                "rate_flagged": float(Y[F].mean()) if F.any() else None,
                "rate_others": float(Y[pop & ~F].mean()),
                "lift": float(Y[F].mean() / base) if F.any() else None,
                "persistence": float(nxt[F & act_next].mean()) if (F & act_next).any() else None,
                "flagged_with_risk_share": float(hi_risk[F].mean()) if F.any() else None,
                "rate_flagged_risk": float(Y[F & hi_risk].mean()) if (F & hi_risk).any() else None,
                "rate_flagged_norisk": float(Y[F & ~hi_risk].mean()) if (F & ~hi_risk).any() else None,
                "rate_risk_only": float(Y[pop & hi_risk & ~F].mean()) if (pop & hi_risk & ~F).any() else None,
            }
            if (thr, N) == DEFAULT:
                rng = np.random.default_rng(seed)
                E = pop.shape[0]
                fy = (F & Y).sum(1)
                fn = F.sum(1)
                py, pn = (pop & Y).sum(1), pop.sum(1)
                bs = []
                for _ in range(n_boot):
                    k = rng.integers(0, E, E)
                    if fn[k].sum():
                        bs.append((fy[k].sum() / fn[k].sum()) / (py[k].sum() / pn[k].sum()))
                row["lift_ci95"] = [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]
                row["flagged_last_month"] = int(((st[:, P.n_obs - 1] >= N) & P.act[:, P.n_obs - 1]).sum())
                row["active_last_month"] = int(P.act[:, P.n_obs - 1].sum())
            out["grid"].append(row)
    return out

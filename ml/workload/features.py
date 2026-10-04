"""Variables de prévision des heures sup par groupe (équipe = rattachés directs d'un manager, département).

Groupe à l'origine O (fin de mois) : salariés actifs en fin de O rattachés au manager (ou au département) à cette date.
Série du groupe = celle de ces membres (composition à l'origine), mois par mois :
    I[m] = Σ heures sup pointées / ETP présents,  ETP = Σ jours pointés / jours ouvrés du mois
Cible : z[T] - zbar12 avec z = log(1 + I), T = O + h (h = 1..3), zbar12 = moyenne de z sur O-11..O.
"""
import math

import numpy as np

from .data import STD_MONTH_DAYS, Panel

MIN_MEMBERS = 5  # MIN_GROUP_SIZE : aucune prévision d'équipe sous ce seuil
MIN_VALID_12 = 6  # mois valides requis sur les 12 derniers
FTE_MIN = 1.0  # ETP minimal pour qu'un mois de la série soit défini
S_FLOOR = 0.03  # plancher de l'échelle de bruit (log)
HORIZONS = (1, 2, 3)
SCOPES = ("EQUIPE", "DEPARTEMENT")

CAL_FEATURES = ["ramadan_T", "summer_su_T", "bridges_T", "workdays_T", "ramadan_diff", "summer_su_diff", "bridges_diff", "workdays_diff"]
STAFF_FEATURES = ["log_headcount", "headcount_change_3m", "unfilled_exits_3m"]
SEASON_FEATURES = ["seas_group", "seas_dept"] + [f"m{k:02d}" for k in range(2, 13)]
FEATURES = ["z_last_dev", "z_3m_dev", "seas_group", "seas_dept", "trend_6m"] + CAL_FEATURES + STAFF_FEATURES + [f"m{k:02d}" for k in range(2, 13)]


def group_series(P: Panel, O: int, scope: str):
    """Groupes à l'origine O (colonne) : clés, effectifs, séries I et z (colonnes 0..n_obs-1), département de rattachement."""
    key = P.mgr[:, O] if scope == "EQUIPE" else P.dept[:, O]
    ok = key >= 0
    keys, inv = np.unique(key[ok], return_inverse=True)
    G, M = len(keys), P.n_obs
    OT = np.zeros((G, M))
    D = np.zeros((G, M))
    np.add.at(OT, inv, P.ot_min[ok] / 60.0)
    np.add.at(D, inv, P.days[ok])
    wd = np.array([P.cal.get(P.m0 + c)[0] for c in range(M)])
    fte = D / wd[None, :]
    with np.errstate(invalid="ignore", divide="ignore"):
        I = np.where(fte >= FTE_MIN, OT / np.where(fte > 0, fte, 1.0), np.nan)
    z = np.log1p(I)
    n = np.bincount(inv, minlength=G)
    if scope == "EQUIPE":
        pos = {int(e): k for k, e in enumerate(P.emp_ids)}
        home = np.array([P.dept[pos[int(k)], O] if int(k) in pos else -1 for k in keys])
    else:
        home = keys.copy()
    return {"keys": keys, "n": n, "I": I, "z": z, "fte": fte, "home": home, "members": [np.nonzero(ok)[0][inv == g] for g in range(G)]}


def _nanmean(a):
    v = a[~np.isnan(a)]
    return float(v.mean()) if len(v) else math.nan


def _trend(z, O):
    xs, ys = [], []
    for m in range(O - 5, O + 1):
        if m >= 0 and not math.isnan(z[m]):
            xs.append(m - O)
            ys.append(z[m])
    if len(xs) < 3:
        return 0.0
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / sxx


def _seasonal(z, T):
    """Écart saisonnier observé un an avant la cible : z[T-12] - moyenne de z sur la fenêtre centrée T-18..T-7."""
    if T - 18 < 0 or math.isnan(z[T - 12]):
        return 0.0
    w = z[T - 18 : T - 6]
    v = w[~np.isnan(w)]
    if len(v) < MIN_VALID_12:
        return 0.0
    return float(z[T - 12] - v.mean())


def _scale(z, O):
    d = [z[m] - z[m - 1] for m in range(max(1, O - 11), O + 1) if not (math.isnan(z[m]) or math.isnan(z[m - 1]))]
    if len(d) < 3:
        return None
    return max(S_FLOOR, math.sqrt(sum(x * x for x in d) / len(d) / 2))


def origin_rows(P: Panel, O: int, scope: str, dept_series=None, horizons=HORIZONS):
    """Lignes (une par groupe éligible et horizon) à l'origine O. Cible renseignée si T observé."""
    gs = dept_series if (scope == "DEPARTEMENT" and dept_series is not None) else group_series(P, O, scope)
    ds = dept_series if dept_series is not None else (gs if scope == "DEPARTEMENT" else group_series(P, O, "DEPARTEMENT"))
    dpos = {int(k): g for g, k in enumerate(ds["keys"])}
    rows = []
    for g, key in enumerate(gs["keys"]):
        n = int(gs["n"][g])
        if scope == "EQUIPE" and n < MIN_MEMBERS:
            continue
        z, I = gs["z"][g], gs["I"][g]
        if O - 11 < 0:
            continue
        w12 = z[O - 11 : O + 1]
        if (~np.isnan(w12)).sum() < MIN_VALID_12:
            continue
        zbar12 = _nanmean(w12)
        zbar3 = _nanmean(z[O - 2 : O + 1])
        zbar3 = zbar12 if math.isnan(zbar3) else zbar3
        zlast = zbar3 if math.isnan(z[O]) else float(z[O])
        s = _scale(z, O)
        members = gs["members"][g]
        prev = P.mgr[:, O - 3] if scope == "EQUIPE" else P.dept[:, O - 3]
        was = prev == key if O - 3 >= 0 else np.zeros(len(prev), dtype=bool)
        n3 = int(was.sum())
        departs = int((was & ~P.act[:, O]).sum())
        hires = int((P.hire_col[members] > O - 3).sum())
        hc_change = (n - n3) / n3 if n3 > 0 else 0.0
        unfilled = max(0, departs - hires) / n3 if n3 > 0 else 0.0
        hd = int(gs["home"][g])
        dz = ds["z"][dpos[hd]] if hd in dpos else z
        I12 = _nanmean(I[O - 11 : O + 1])
        for h in horizons:
            T = O + h
            wdT, ramT, suT, brT = P.cal.get(P.m0 + T)
            wdP, ramP, suP, brP = P.cal.get(P.m0 + T - 12)
            moy = (P.m0 + T) % 12 + 1
            x = [
                zlast - zbar12,
                zbar3 - zbar12,
                _seasonal(z, T),
                _seasonal(dz, T),
                _trend(z, O),
                ramT,
                suT,
                brT,
                wdT / STD_MONTH_DAYS,
                ramT - ramP,
                suT - suP,
                brT - brP,
                (wdT - wdP) / STD_MONTH_DAYS,
                math.log(n),
                hc_change,
                unfilled,
            ] + [1.0 if moy == k else 0.0 for k in range(2, 13)]
            obs = T < P.n_obs and not math.isnan(z[T])
            rows.append(
                {
                    "scope": scope,
                    "key": int(key),
                    "home": hd,
                    "O": O,
                    "h": h,
                    "T": T,
                    "n": n,
                    "x": x,
                    "zbar12": zbar12,
                    "s": s,
                    "I12": I12,
                    "y": float(z[T] - zbar12) if obs else math.nan,
                    "I_T": float(I[T]) if obs else math.nan,
                    "I_last": float(I[O]),
                    "I_ma3": _nanmean(I[O - 2 : O + 1]),
                    "I_seas": float(I[T - 12]),
                }
            )
    return rows


def build_samples(P: Panel, origins, scopes=SCOPES):
    out = {s: [] for s in scopes}
    for O in origins:
        dept = group_series(P, O, "DEPARTEMENT")
        for s in scopes:
            out[s].extend(origin_rows(P, O, s, dept_series=dept))
    return out

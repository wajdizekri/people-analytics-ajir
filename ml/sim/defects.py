"""Défauts de qualité injectés dans l'export (~2 % des lignes des fichiers volumineux), étiquetés."""
import numpy as np
import pandas as pd

SPEC = {
    "attendance.csv": [("POINTAGE_SANS_SORTIE", 0.011), ("DOUBLON", 0.005), ("MATRICULE_INCONNU", 0.003)],
    "absences.csv": [("ABSENCE_FIN_AVANT_DEBUT", 0.010), ("DOUBLON", 0.006), ("MATRICULE_INCONNU", 0.004)],
    "payroll.csv": [("SALAIRE_SOUS_SMIG", 0.008), ("DOUBLON", 0.007), ("MATRICULE_INCONNU", 0.005)],
}


def _unknown(rng, known, k):
    out = []
    while len(out) < k:
        m = f"M{int(rng.integers(90000, 100000)):05d}"
        if m not in known:
            out.append(m)
    return out


def inject(df: pd.DataFrame, file: str, rng, known: set, offset: int = 0, eligible_smig=None):
    """Renvoie (df modifié, défauts). offset = lignes de données déjà écrites (ligne 1 = en-tête)."""
    n = len(df)
    if n == 0:
        return df, []
    df = df.reset_index(drop=True).copy()
    order = rng.permutation(n)
    picks = {}
    for kind, rate in SPEC[file]:
        pool = order
        if kind == "SALAIRE_SOUS_SMIG" and eligible_smig is not None:
            pool = pool[eligible_smig[pool]]
        k = int(rng.binomial(n, rate))
        chosen = np.sort(pool[:k])
        picks[kind] = chosen
        order = np.setdiff1d(order, chosen, assume_unique=True)
        order = order[rng.permutation(len(order))]
    details = {}
    if len(sel := picks.get("POINTAGE_SANS_SORTIE", [])):
        details["POINTAGE_SANS_SORTIE"] = ["sortie d'origine " + x for x in df.loc[sel, "check_out"]]
        df.loc[sel, "check_out"] = ""
        df.loc[sel, "worked_minutes"] = 0
        df.loc[sel, "overtime_minutes"] = 0
    if len(sel := picks.get("ABSENCE_FIN_AVANT_DEBUT", [])):
        details["ABSENCE_FIN_AVANT_DEBUT"] = ["fin d'origine " + x for x in df.loc[sel, "end_date"]]
        start = pd.to_datetime(df.loc[sel, "start_date"])
        df.loc[sel, "end_date"] = (start - pd.to_timedelta(rng.integers(1, 6, len(sel)), unit="D")).dt.strftime("%Y-%m-%d").values
    if len(sel := picks.get("SALAIRE_SOUS_SMIG", [])):
        details["SALAIRE_SOUS_SMIG"] = [f"base d'origine {x}" for x in df.loc[sel, "base_salary"]]
        df.loc[sel, "base_salary"] = (df.loc[sel, "base_salary"].astype(float) / 10).round(3)
    if len(sel := picks.get("MATRICULE_INCONNU", [])):
        details["MATRICULE_INCONNU"] = ["matricule d'origine " + x for x in df.loc[sel, "matricule"]]
        df.loc[sel, "matricule"] = _unknown(rng, known, len(sel))
    rep = np.ones(n, np.int64)
    dup = picks.get("DOUBLON", np.array([], int))
    rep[dup] = 2
    first_pos = np.cumsum(rep) - rep
    out = df.iloc[np.repeat(np.arange(n), rep)].reset_index(drop=True)
    records = []
    for kind, sel in picks.items():
        for j, i in enumerate(sel):
            line = offset + first_pos[i] + 2
            if kind == "DOUBLON":
                records.append((file, int(line + 1), kind, df.at[i, "matricule"], f"copie de la ligne {int(line)}"))
            else:
                records.append((file, int(line), kind, df.at[i, "matricule"], details[kind][j]))
    return out, records

"""Évaluation du contrôle qualité de l'import (src/lib/import) contre les défauts injectés (defects.csv)."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from . import common as C

# défaut injecté -> règle attendue de l'import
EXPECTED_RULE = {
    ("attendance.csv", "POINTAGE_SANS_SORTIE"): "POINTAGE_SANS_SORTIE",
    ("attendance.csv", "DOUBLON"): "POINTAGE_DUPLIQUE",
    ("attendance.csv", "MATRICULE_INCONNU"): "MATRICULE_INCONNU",
    ("absences.csv", "ABSENCE_FIN_AVANT_DEBUT"): "FIN_AVANT_DEBUT",
    ("absences.csv", "DOUBLON"): "DOUBLON",
    ("absences.csv", "MATRICULE_INCONNU"): "MATRICULE_INCONNU",
    ("payroll.csv", "SALAIRE_SOUS_SMIG"): "SALAIRE_SOUS_SMIG",
    ("payroll.csv", "DOUBLON"): "DOUBLON",
    ("payroll.csv", "MATRICULE_INCONNU"): "MATRICULE_INCONNU",
}
LINE_RULES_WITHOUT_LINE = {"PAIE_INCOMPLETE", "VARIATION_VOLUME", "FIN_DONNEES_AVANCE"}


def load_defects(sim_dir: Path = C.SIM_DIR) -> pd.DataFrame:
    return C.read_csv(sim_dir / "ground_truth" / "defects.csv")


def load_rejections(path: Path) -> pd.DataFrame:
    r = C.read_csv(path)
    r["line"] = r["line"].astype("Int64")
    return r


def line_level(defects: pd.DataFrame, rej: pd.DataFrame) -> dict:
    """Appariement ligne à ligne (fichier, ligne) : taux de détection par type, règle déclenchée, lignes signalées
    sans défaut injecté."""
    per_line = rej.dropna(subset=["line"])
    per_line = per_line[~per_line["rule"].isin(LINE_RULES_WITHOUT_LINE)]
    m = defects.merge(per_line[["file", "line", "rule", "severity"]], on=["file", "line"], how="left")
    by_type = []
    for (f, t), g in m.groupby(["file", "defect_type"], sort=True):
        exp = EXPECTED_RULE.get((f, t))
        lines = g.drop_duplicates(["file", "line"])
        flagged = g.dropna(subset=["rule"]).drop_duplicates(["file", "line"])
        right = g[g["rule"] == exp].drop_duplicates(["file", "line"])
        by_type.append(
            {
                "file": f,
                "defect_type": t,
                "expected_rule": exp,
                "injected": len(lines),
                "flagged": len(flagged),
                "flagged_expected_rule": len(right),
                "detection_rate": len(flagged) / len(lines),
                "other_rules": sorted(set(g["rule"].dropna()) - {exp}),
                "severity": sorted(set(right["severity"].dropna())),
            }
        )
    keys = set(zip(defects["file"], defects["line"]))
    extra = per_line[[(f, l) not in keys for f, l in zip(per_line["file"], per_line["line"])]]
    false_flags = extra.groupby(["file", "rule", "severity"]).size().reset_index(name="n").to_dict("records")
    return {"by_type": by_type, "flagged_lines": int(per_line[["file", "line"]].drop_duplicates().shape[0]), "false_flags": false_flags}


def table_agreement(defects: pd.DataFrame, table: pd.DataFrame) -> list[dict]:
    """Table import_rejection de data/app.db (détail plafonné à DETAIL_CAP lignes par fichier et par règle) :
    part des lignes détaillées qui correspondent à un défaut injecté du type attendu."""
    rev = {(f, r): t for (f, t), r in EXPECTED_RULE.items()}
    m = table.merge(defects[["file", "line", "defect_type"]], on=["file", "line"], how="left")
    out = []
    for (f, rule), g in m.groupby(["file", "rule"], sort=True):
        exp = rev.get((f, rule))
        out.append(
            {
                "file": f,
                "rule": rule,
                "rows": len(g),
                "with_line": int(g["line"].notna().sum()),
                "matching_defect": int((g["defect_type"] == exp).sum()) if exp else 0,
                "injected_total": int((defects["file"].eq(f) & defects["defect_type"].eq(exp)).sum()) if exp else 0,
            }
        )
    return out


def payroll_incomplete_causes(sim_dir: Path, defects: pd.DataFrame, rej: pd.DataFrame, month: str) -> dict:
    """Salariés en poste sans paie du dernier mois (PAIE_INCOMPLETE) : leur ligne de paie du mois a-t-elle été
    rejetée à cause d'un défaut injecté ?"""
    missing = rej.loc[rej["rule"] == "PAIE_INCOMPLETE", "message"].str.extract(r"(M\d+)$")[0].dropna().tolist()
    d = defects[defects["file"] == "payroll.csv"].copy()
    d["original"] = d["detail"].str.extract(r"matricule d'origine (M\d+)")[0].fillna(d["matricule"])
    wanted = set(d["line"])
    months = {}
    with open(sim_dir / "payroll.csv", encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n").split(";")
        mi = header.index("month")
        for n, line in enumerate(fh, start=2):
            if n in wanted:
                months[n] = line.split(";")[mi]
    d["month"] = d["line"].map(months)
    hit = d[d["month"] == month].groupby("original")["defect_type"].apply(lambda s: sorted(set(s))).to_dict()
    causes = {m: hit.get(m, ["AUCUN_DEFAUT"]) for m in missing}
    counts: dict[str, int] = {}
    for v in causes.values():
        k = "+".join(v)
        counts[k] = counts.get(k, 0) + 1
    return {"missing": len(missing), "by_cause": counts}


def payroll_ratio_check(sim_dir: Path, defects: pd.DataFrame, ratio: float = 2.0) -> dict:
    """Prototype de règle de cohérence (non intégrée à l'import) : brut > ratio x base. Sur les lignes sans défaut,
    et sur les lignes SALAIRE_SOUS_SMIG (base divisée par 10 par le simulateur)."""
    p = C.read_csv(sim_dir / "payroll.csv")
    p["line"] = range(2, len(p) + 2)
    d = defects[defects["file"] == "payroll.csv"]
    p = p.merge(d[["line", "defect_type"]], on="line", how="left")
    r = p["gross_salary"] / p["base_salary"]
    clean = p["defect_type"].isna()
    smig = p["defect_type"] == "SALAIRE_SOUS_SMIG"
    return {
        "ratio": ratio,
        "clean_rows": int(clean.sum()),
        "clean_flagged": int((clean & (r > ratio)).sum()),
        "clean_max_ratio": float(r[clean].max()),
        "smig_defects": int(smig.sum()),
        "smig_flagged": int((smig & (r > ratio)).sum()),
    }


def score_decomposition(report: dict, defects: pd.DataFrame) -> dict:
    """Décomposition exacte du score qualité : moyenne des ok/lignes des fichiers de données x complétude paie."""
    files = {f: v for f, v in report["files"].items() if f != "users.csv" and v["present"]}
    n = len(files)
    q = report["quality"]
    completeness = 1 - q["activeWithoutPayroll"] / q["activeCount"] if q["activeCount"] else 1.0
    row_score = sum((v["ok"] / v["rows"]) if v["rows"] else 1.0 for v in files.values()) / n
    loss = {}
    for f, v in files.items():
        for rule, cnt in v["rules"].items():
            if rule in LINE_RULES_WITHOUT_LINE or rule == "POINTAGE_SANS_SORTIE":
                continue
            loss[f"{f}:{rule}"] = cnt / v["rows"] / n
    dup = defects[defects["defect_type"] == "DOUBLON"].groupby("file").size().to_dict()
    clean_rows = {f: v["rows"] - dup.get(f, 0) for f, v in files.items()}
    injected_rej = defects[defects["defect_type"] != "POINTAGE_SANS_SORTIE"].groupby("file").size().to_dict()
    clean_ok = {f: v["ok"] + injected_rej.get(f, 0) - dup.get(f, 0) for f, v in files.items()}
    clean_row_score = sum(clean_ok[f] / clean_rows[f] if clean_rows[f] else 1.0 for f in files) / n
    return {
        "files": n,
        "row_score": row_score,
        "completeness": completeness,
        "score": row_score * completeness,
        "reported_score": q["score"],
        "loss_by_rule_points": {k: 100 * v for k, v in sorted(loss.items(), key=lambda x: -x[1])},
        "loss_completeness_points": 100 * row_score * (1 - completeness),
        "clean_row_score_expected": clean_row_score,
    }


def build_clean_export(sim_dir: Path, out: Path, defects: pd.DataFrame) -> dict:
    """Export AJIR corrigé : doublons supprimés, valeurs d'origine restaurées (fin d'absence, matricule, salaire de
    base, heure de sortie). Sert à vérifier l'absence de rejet sur des données propres."""
    out.mkdir(parents=True, exist_ok=True)
    fixes = {
        "ABSENCE_FIN_AVANT_DEBUT": ("end_date", r"fin d'origine (.+)$"),
        "MATRICULE_INCONNU": ("matricule", r"matricule d'origine (.+)$"),
        "SALAIRE_SOUS_SMIG": ("base_salary", r"base d'origine (.+)$"),
        "POINTAGE_SANS_SORTIE": ("check_out", r"sortie d'origine (.+)$"),
    }
    stats = {}
    for src in sorted(sim_dir.glob("*.csv")):
        d = defects[defects["file"] == src.name]
        drop = set(d.loc[d["defect_type"] == "DOUBLON", "line"])
        patch = {}
        for r in d[d["defect_type"] != "DOUBLON"].itertuples():
            col, rx = fixes[r.defect_type]
            patch[int(r.line)] = (col, pd.Series([r.detail]).str.extract(rx)[0].iloc[0])
        n_out = 0
        with open(src, encoding="utf-8", newline="") as fi, open(out / src.name, "w", encoding="utf-8", newline="") as fo:
            header = fi.readline()
            cols = header.rstrip("\r\n").split(";")
            fo.write(header)
            for n, line in enumerate(fi, start=2):
                if n in drop:
                    continue
                if n in patch:
                    col, val = patch[n]
                    parts = line.rstrip("\r\n").split(";")
                    parts[cols.index(col)] = val
                    line = ";".join(parts) + "\n"
                fo.write(line)
                n_out += 1
        stats[src.name] = {"rows": n_out, "dropped": len(drop), "patched": len(patch)}
    return stats


def evaluate(sim_dir: Path = C.SIM_DIR, export: Path = C.EXPORT_DIR) -> dict:
    defects = load_defects(sim_dir)
    full = load_rejections(export / "rejections_full.csv")
    rep = json.loads((export / "rejections_full.json").read_text(encoding="utf-8"))
    table = load_rejections(export / "rejections_table.csv")
    res = {
        "defects": len(defects),
        "full": line_level(defects, full),
        "table_capped": table_agreement(defects, table),
        "table_rows": len(table),
        "import": {k: rep[k] for k in ("status", "qualityScore", "rowsOk", "rowsRejected")},
        "score": score_decomposition(rep["report"], defects),
        "payroll_incomplete": payroll_incomplete_causes(sim_dir, defects, full, rep["report"]["quality"]["payrollMonth"]),
        "payroll_ratio_check": payroll_ratio_check(sim_dir, defects),
    }
    clean = export / "rejections_clean.json"
    if clean.exists():
        c = json.loads(clean.read_text(encoding="utf-8"))
        res["clean_import"] = {
            "status": c["status"],
            "qualityScore": c["qualityScore"],
            "rowsRejected": c["rowsRejected"],
            "rules": c["report"]["rules"],
            "quality": c["report"]["quality"],
        }
    return res

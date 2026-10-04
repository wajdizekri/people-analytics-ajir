import pandas as pd
import pytest

from ml.eval import quality as Q


def _defects():
    return pd.DataFrame(
        [
            ("absences.csv", 3, "DOUBLON", "M1", "copie de la ligne 2"),
            ("absences.csv", 4, "ABSENCE_FIN_AVANT_DEBUT", "M2", "fin d'origine 2024-01-10"),
            ("payroll.csv", 2, "MATRICULE_INCONNU", "M99999", "matricule d'origine M1"),
        ],
        columns=["file", "line", "defect_type", "matricule", "detail"],
    )


def test_line_level_taux_et_faux_rejets():
    rej = pd.DataFrame(
        [
            ("absences.csv", 3, "DOUBLON", "REJET", ""),
            ("absences.csv", 4, "FIN_AVANT_DEBUT", "REJET", ""),
            ("payroll.csv", 2, "MATRICULE_INCONNU", "REJET", ""),
            ("payroll.csv", 7, "SALAIRE_SOUS_SMIG", "REJET", ""),
            ("payroll.csv", None, "PAIE_INCOMPLETE", "AVERTISSEMENT", "Aucune paie en 2024-01 pour le salarié en poste M3"),
        ],
        columns=["file", "line", "rule", "severity", "message"],
    )
    rej["line"] = rej["line"].astype("Int64")
    r = Q.line_level(_defects(), rej)
    assert all(t["detection_rate"] == 1.0 for t in r["by_type"])
    assert r["false_flags"] == [{"file": "payroll.csv", "rule": "SALAIRE_SOUS_SMIG", "severity": "REJET", "n": 1}]


def test_decomposition_du_score():
    report = {
        "files": {
            "a.csv": {"present": True, "rows": 100, "ok": 98, "rules": {"DOUBLON": 2}},
            "b.csv": {"present": True, "rows": 10, "ok": 10, "rules": {}},
            "users.csv": {"present": True, "rows": 5, "ok": 5, "rules": {}},
        },
        "quality": {"score": 0.9801, "activeCount": 100, "activeWithoutPayroll": 1},
    }
    d = pd.DataFrame([("a.csv", 5, "DOUBLON", "M1", ""), ("a.csv", 9, "DOUBLON", "M1", "")], columns=["file", "line", "defect_type", "matricule", "detail"])
    s = Q.score_decomposition(report, d)
    assert s["row_score"] == pytest.approx(0.99)
    assert s["score"] == pytest.approx(0.99 * 0.99)
    assert s["loss_by_rule_points"]["a.csv:DOUBLON"] == pytest.approx(1.0)
    assert s["clean_row_score_expected"] == pytest.approx(1.0)


def test_export_nettoye(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "absences.csv").write_text(
        "matricule;start_date;end_date;days;category;recorded_at\n"
        "M1;2024-01-02;2024-01-02;1;AUTRE;2024-01-03\n"
        "M1;2024-01-02;2024-01-02;1;AUTRE;2024-01-03\n"
        "M2;2024-01-08;2024-01-05;3;AUTRE;2024-01-11\n",
        encoding="utf-8",
    )
    (src / "payroll.csv").write_text("matricule;month;base_salary;gross_salary;overtime_hours;recorded_at\nM99999;2024-01;900;1000;0;2024-02-01\n", encoding="utf-8")
    stats = Q.build_clean_export(src, tmp_path / "out", _defects())
    assert stats["absences.csv"] == {"rows": 2, "dropped": 1, "patched": 1}
    lines = (tmp_path / "out" / "absences.csv").read_text(encoding="utf-8").splitlines()
    assert lines[2] == "M2;2024-01-08;2024-01-10;3;AUTRE;2024-01-11"
    assert (tmp_path / "out" / "payroll.csv").read_text(encoding="utf-8").splitlines()[1].startswith("M1;2024-01;")

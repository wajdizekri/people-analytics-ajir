import numpy as np
import pandas as pd


def test_turnover_and_absenteeism(run):
    _, st = run
    assert 0.08 <= st["turnover_annual"] <= 0.17
    assert 0.50 <= st["voluntary_share"] <= 0.72
    assert 0.03 <= st["absenteeism_excl_leave"] <= 0.05
    assert 16 <= st["annual_leave_days_per_fte"] <= 24
    assert 0.02 <= st["late_rate"] <= 0.08


def test_contract_mix_and_injections(run):
    _, st = run
    mix = st["contract_mix_end"]
    assert 0.62 <= mix["CDI"] <= 0.80 and 0.13 <= mix["CDD"] <= 0.26
    assert 0.03 <= mix["SIVP"] <= 0.10 and 0.01 <= mix["STAGE"] <= 0.05
    assert 0.01 <= st["anomalies"]["employee_month_share"] <= 0.02
    assert 0.015 <= st["defects"]["share_rows"] <= 0.025
    mech = st["resignation_mechanisms"]
    assert min(mech.values()) > 0


def test_oracle_is_calibrated_and_discriminant(run):
    _, st = run
    o = st["oracle"]
    assert 0.74 <= o["auc"] <= 0.92
    assert 0.015 <= o["observed_rate"] <= 0.06
    assert abs(o["mean_prob"] - o["observed_rate"]) < 0.012


def test_salaries_and_calendar_effects(run):
    d, _ = run
    pay = pd.read_csv(d / "payroll.csv", sep=";", dtype={"matricule": str})
    con = pd.read_csv(d / "contracts.csv", sep=";", dtype=str, keep_default_na=False)
    stage = set(con.loc[con["contract_type"].isin(["STAGE", "SIVP"]), "matricule"])
    regular = pay[~pay["matricule"].isin(stage)]
    assert (regular["base_salary"] >= 528.32).mean() > 0.985
    assert 800 <= regular["base_salary"].median() <= 2500
    att = pd.read_csv(d / "attendance.csv", sep=";", dtype=str, keep_default_na=False)
    cal = pd.read_csv(d / "ground_truth" / "calendar.csv", sep=";", dtype=str, keep_default_na=False)
    att = att.merge(cal, on="date")
    att = att[att["check_out"] != ""]
    worked = att["worked_minutes"].astype(int) - att["overtime_minutes"].astype(int)
    short = (att["is_ramadan"] == "1") | (att["is_seance_unique"] == "1")
    assert worked[short].median() < worked[~short].median() - 60
    ci = att["check_in"].str[:2].astype(int) * 60 + att["check_in"].str[3:].astype(int)
    assert 465 <= np.median(ci[~short]) <= 480

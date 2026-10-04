import json
import re

import pandas as pd

CONTRACT = {
    "departments.csv": "code;name",
    "employees.csv": "matricule;last_name;first_name;sex;birth_date;hire_date;department_code;job_family;job_title;grade;"
                     "manager_matricule;governorate;marital_status",
    "contracts.csv": "matricule;contract_type;start_date;end_date",
    "exits.csv": "matricule;exit_date;exit_reason;resignation_date;recorded_at",
    "career_events.csv": "matricule;date;event_type;old_value;new_value;recorded_at",
    "attendance.csv": "matricule;date;check_in;check_out;worked_minutes;overtime_minutes;late_minutes",
    "absences.csv": "matricule;start_date;end_date;days;category;recorded_at",
    "payroll.csv": "matricule;month;base_salary;gross_salary;overtime_hours;recorded_at",
    "trainings.csv": "matricule;training_code;title;mandatory;start_date;end_date;due_date;hours;status",
    "evaluations.csv": "matricule;eval_date;score;recorded_at",
    "users.csv": "login;matricule;role;email;active",
}
DATE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def load(d, f):
    return pd.read_csv(d / f, sep=";", dtype=str, keep_default_na=False)


def dates_ok(s, allow_empty=False):
    s = s[s != ""] if allow_empty else s
    return s.str.match(DATE).all()


def test_eleven_files_with_exact_headers(run):
    d, _ = run
    assert sorted(p.name for p in d.glob("*.csv")) == sorted(CONTRACT)
    for f, header in CONTRACT.items():
        raw = (d / f).read_bytes()
        assert not raw.startswith(b"\xef\xbb\xbf"), f
        assert b"\r\n" not in raw[:10000], f
        text = raw.decode("utf-8")
        assert text.split("\n", 1)[0] == header, f
        assert len(load(d, f)) > 0, f


def test_values_follow_contract(run):
    d, _ = run
    emp = load(d, "employees.csv")
    assert emp["matricule"].is_unique
    assert set(emp["sex"]) <= {"F", "M"}
    assert emp["grade"].str.match(r"^G[1-8]$").all()
    assert dates_ok(emp["birth_date"]) and dates_ok(emp["hire_date"])
    assert set(emp["department_code"]) <= set(load(d, "departments.csv")["code"])
    assert set(emp["job_family"]) == {"IT", "Finance", "Production", "Commercial", "Support"}
    con = load(d, "contracts.csv")
    assert set(con["contract_type"]) <= {"CDI", "CDD", "SIVP", "STAGE"}
    assert dates_ok(con["start_date"]) and dates_ok(con["end_date"], True)
    assert (con.loc[con["contract_type"] == "CDI", "end_date"] == "").all()
    ex = load(d, "exits.csv")
    assert set(ex["exit_reason"]) <= {"DEMISSION", "ABANDON", "FIN_CDD", "LICENCIEMENT", "RETRAITE", "DECES", "MUTATION", "AUTRE"}
    assert dates_ok(ex["exit_date"]) and dates_ok(ex["resignation_date"], True) and dates_ok(ex["recorded_at"])
    car = load(d, "career_events.csv")
    assert set(car["event_type"]) == {"PROMOTION", "AUGMENTATION", "MUTATION", "CHANGEMENT_MANAGER", "CHANGEMENT_POSTE"}
    assert not car.duplicated(["matricule", "date", "event_type"]).any()
    prom = car[car["event_type"] == "PROMOTION"]
    assert prom["old_value"].str.match(r"^G[1-8]$").all() and prom["new_value"].str.match(r"^G[1-8]$").all()
    aug = car[car["event_type"] == "AUGMENTATION"]
    assert (aug["new_value"].astype(float) > aug["old_value"].astype(float)).all()
    att = load(d, "attendance.csv")
    assert dates_ok(att["date"]) and att["check_in"].str.match(TIME).all()
    co = att["check_out"]
    assert co[co != ""].str.match(TIME).all()
    for c in ("worked_minutes", "overtime_minutes", "late_minutes"):
        assert (att[c].astype(int) >= 0).all()
    ab = load(d, "absences.csv")
    assert set(ab["category"]) <= {"CONGE_ANNUEL", "MALADIE", "MATERNITE", "ABSENCE_INJUSTIFIEE", "CONGE_SANS_SOLDE", "AUTRE"}
    assert (ab["days"].astype(float) > 0).all()
    pay = load(d, "payroll.csv")
    assert pay["month"].str.match(MONTH).all()
    assert (pay["gross_salary"].astype(float) >= 0).all()
    tr = load(d, "trainings.csv")
    assert set(tr["mandatory"]) <= {"0", "1"} and set(tr["status"]) <= {"PLANIFIEE", "EN_COURS", "TERMINEE", "ABANDONNEE"}
    assert (tr.loc[tr["mandatory"] == "1", "due_date"] != "").all()
    ev = load(d, "evaluations.csv")
    assert ev["score"].astype(int).between(1, 5).all()
    assert (pd.to_datetime(ev["recorded_at"]) - pd.to_datetime(ev["eval_date"])).dt.days.between(30, 120).all()
    us = load(d, "users.csv")
    assert set(us["role"]) == {"ADMIN", "RH", "MANAGER"} and us["login"].is_unique
    assert {"admin", "rh.demo"} <= set(us["login"])
    mgr = us[us["role"] == "MANAGER"]
    assert (mgr["login"] == "mgr." + mgr["matricule"]).all()
    assert set(mgr["matricule"]) <= set(emp["matricule"])


def test_no_attendance_on_absence_or_non_working_days(run):
    d, _ = run
    cal = load(d / "ground_truth", "calendar.csv")
    off = set(cal.loc[(cal["is_weekend"] == "1") | (cal["is_holiday"] == "1"), "date"])
    att = load(d, "attendance.csv")
    assert not att["date"].isin(off).any()
    ab = load(d, "absences.csv")
    ab = ab[ab["end_date"] >= ab["start_date"]].drop_duplicates()
    a = att[["matricule", "date"]].drop_duplicates().copy()
    a["t"] = pd.to_datetime(a["date"])
    ab = ab.assign(t=pd.to_datetime(ab["start_date"]), end=pd.to_datetime(ab["end_date"]))
    m = pd.merge_asof(a.sort_values("t"), ab[["matricule", "t", "end"]].sort_values("t"), on="t", by="matricule")
    assert not (m["end"].notna() & (m["t"] <= m["end"])).any()


def test_resignation_timeline(run):
    d, _ = run
    ex = load(d, "exits.csv")
    dem = ex[ex["exit_reason"] == "DEMISSION"]
    blank = (dem["resignation_date"] == "").mean()
    assert 0.25 <= blank <= 0.55
    has = dem[dem["resignation_date"] != ""]
    gap = (pd.to_datetime(has["exit_date"]) - pd.to_datetime(has["resignation_date"])).dt.days
    assert gap.between(0, 31).all() and gap.median() >= 28
    att = load(d, "attendance.csv")
    last = att.groupby("matricule")["date"].max()
    notice = has[has["matricule"].isin(last.index)]
    assert (last[notice["matricule"]].values > notice["resignation_date"].values).mean() > 0.9


def test_ground_truth(run):
    d, st = run
    gt = d / "ground_truth"
    cfg = json.loads((gt / "config.json").read_text(encoding="utf-8"))
    assert cfg["oracle_reps"] >= 50
    lat = load(gt, "latent_monthly.csv")
    assert list(lat.columns)[:5] == ["matricule", "month", "engagement", "manager_quality", "market_pressure"]
    orc = load(gt, "oracle_prob6.csv")
    p = orc["prob6"].astype(float)
    assert p.between(0, 1).all() and orc["as_of"].nunique() == 16
    mech = load(gt, "mechanisms.csv")
    assert set(mech["mechanism"]) == {"OFFRE_EXTERNE", "SEUIL_ENGAGEMENT", "EVENEMENT_PERSONNEL"}
    an = load(gt, "anomalies.csv")
    assert {"PIC_EQUIPE", "LUNDI_VENDREDI", "DERIVE", "ROTATION_EQUIPE"} <= set(an["type"])
    assert set(an.loc[an["held_out"] == "1", "type"]) == {"ROTATION_EQUIPE"}
    df = load(gt, "defects.csv")
    assert set(df["defect_type"]) == {"POINTAGE_SANS_SORTIE", "DOUBLON", "ABSENCE_FIN_AVANT_DEBUT", "MATRICULE_INCONNU",
                                      "SALAIRE_SOUS_SMIG"}
    att = (d / "attendance.csv").read_text(encoding="utf-8").split("\n")
    for _, r in df[(df["file"] == "attendance.csv") & (df["defect_type"] == "POINTAGE_SANS_SORTIE")].head(50).iterrows():
        assert att[int(r["line"]) - 1].split(";")[3] == ""

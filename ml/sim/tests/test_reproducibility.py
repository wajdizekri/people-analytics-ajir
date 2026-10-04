import hashlib
from pathlib import Path

import numpy as np

from sim.calendar_tn import TunisianCalendar
from sim.run import simulate


def digest(d):
    files = sorted(p for p in d.rglob("*.csv"))
    return {p.relative_to(d).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def test_same_seed_same_files(tmp_path):
    a = simulate("small", "mixte", 7, out=tmp_path / "a", verbose=False, n0=150, months=12, reps=50)
    b = simulate("small", "mixte", 7, out=tmp_path / "b", verbose=False, n0=150, months=12, reps=50)
    c = simulate("small", "mixte", 8, out=tmp_path / "c", verbose=False, n0=150, months=12, reps=50)
    da, db, dc = digest(Path(a["out_dir"])), digest(Path(b["out_dir"])), digest(Path(c["out_dir"]))
    assert len(da) == 11 + 6
    assert da == db
    assert da["employees.csv"] != dc["employees.csv"]


def test_charge_scenario_runs(tmp_path):
    st = simulate("small", "charge", 1, out=tmp_path, verbose=False, n0=150, months=12, oracle=False)
    assert st["rows"]["attendance.csv"] > 0 and "oracle" not in st


def test_tunisian_calendar():
    cal = TunisianCalendar(np.datetime64("2024-01", "M"), np.datetime64("2026-08-31"))
    day = {str(d): i for i, d in enumerate(cal.days)}
    assert cal.is_holiday[day["2024-03-20"]] and not cal.is_working[day["2024-03-20"]]
    assert cal.is_ramadan[day["2024-03-15"]] and not cal.is_ramadan[day["2024-04-15"]]
    assert cal.is_seance_unique[day["2025-07-15"]] and not cal.is_seance_unique[day["2025-09-15"]]
    assert cal.is_bridge[day["2026-08-14"]] and cal.is_bridge[day["2024-04-08"]]
    assert cal.is_weekend[day["2026-08-29"]] and not cal.is_working[day["2026-08-30"]]
    assert "Aïd" in cal.holiday_name[day["2025-06-06"]] or "Aïd" in cal.holiday_name[day["2025-06-07"]]

"""Visibilité as-of du panel formation (mêmes cas que tests/ai/training/features.test.ts)."""
import sqlite3

import pytest

from ml.training.panel import Source, is_open, late, open_rows

T = "2025-06-30"


@pytest.fixture()
def src(tmp_path):
    f = tmp_path / "t.db"
    c = sqlite3.connect(f)
    c.executescript("""
        CREATE TABLE employee (id INTEGER PRIMARY KEY, matricule TEXT, hire_date TEXT, manager_id INTEGER);
        CREATE TABLE exit_event (id INTEGER PRIMARY KEY, employee_id INTEGER, exit_date TEXT, recorded_at TEXT);
        CREATE TABLE career_event (id INTEGER PRIMARY KEY, employee_id INTEGER, date TEXT, type TEXT, old_value TEXT, new_value TEXT, recorded_at TEXT);
        CREATE TABLE training (id INTEGER PRIMARY KEY, employee_id INTEGER, code TEXT, mandatory INTEGER, start_date TEXT, end_date TEXT, due_date TEXT, hours REAL, status TEXT);
        CREATE TABLE attendance_daily (employee_id INTEGER, date TEXT, overtime_minutes INTEGER);
        CREATE TABLE employee_opposition (employee_id INTEGER PRIMARY KEY);
        CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO app_setting VALUES ('data_end_date', '2025-12-31');
        INSERT INTO employee VALUES (1, 'M', '2010-01-01', NULL), (2, 'M2', '2010-01-01', NULL), (3, 'E1', '2020-01-15', 1),
                                    (4, 'E2', '2019-01-01', 1), (5, 'E3', '2019-01-01', 1), (6, 'E4', '2019-01-01', 2), (7, 'OPP', '2019-01-01', 1);
        INSERT INTO exit_event VALUES (1, 4, '2025-06-15', '2025-07-05'), (2, 5, '2025-06-15', '2025-06-16');
        INSERT INTO career_event VALUES (1, 6, '2025-06-01', 'CHANGEMENT_MANAGER', 'M', 'M2', '2025-07-10');
        INSERT INTO training VALUES
          (1, 3, 'OPEN', 1, '2025-07-08', NULL, '2025-07-10', 4, 'PLANIFIEE'),
          (2, 3, 'DONE_LATER', 1, '2025-07-20', '2025-07-20', '2025-08-15', 7, 'TERMINEE'),
          (3, 3, 'FAR', 1, '2025-12-01', NULL, '2025-12-31', 4, 'PLANIFIEE'),
          (4, 3, 'ABANDON', 1, NULL, NULL, '2025-07-05', 4, 'ABANDONNEE'),
          (5, 3, 'PAST_OK', 1, '2025-02-20', '2025-02-20', '2025-03-01', 4, 'TERMINEE'),
          (6, 3, 'PAST_LATE', 1, '2024-06-11', '2024-06-11', '2024-06-01', 4, 'TERMINEE'),
          (7, 3, 'FACULTATIVE', 0, NULL, NULL, '2025-07-10', 4, 'PLANIFIEE'),
          (8, 4, 'E2_OPEN', 1, '2025-08-01', NULL, '2025-08-20', 4, 'PLANIFIEE'),
          (9, 5, 'E3_OPEN', 1, '2025-08-01', NULL, '2025-08-20', 4, 'PLANIFIEE'),
          (10, 6, 'E4_OPEN', 1, '2025-08-01', NULL, '2025-08-20', 4, 'PLANIFIEE'),
          (11, 7, 'OPP_OPEN', 1, '2025-08-01', NULL, '2025-08-20', 4, 'PLANIFIEE');
        INSERT INTO employee_opposition VALUES (7);
        INSERT INTO attendance_daily VALUES (3, '2025-03-31', 600), (3, '2025-04-01', 60), (3, '2025-06-30', 120), (3, '2025-07-01', 600);
    """)
    c.commit()
    s = Source(c)
    c.close()
    return s


def test_population_as_of(src):
    rows = {tr["code"]: f for tr, f in open_rows(src, T)}
    assert sorted(rows) == ["DONE_LATER", "E2_OPEN", "E4_OPEN", "OPEN"]
    assert rows["DONE_LATER"]["days_to_due"] == 46 and rows["DONE_LATER"]["started"] == 0 and rows["DONE_LATER"]["due_summer"] == 1


def test_history_and_load(src):
    f = dict(open_rows(src, T).__next__()[1])
    assert f["emp_past_n"] == 2 and f["emp_late_rate"] == 0.5 and f["emp_margin_days"] == -0.5
    assert f["open_mandatory_others"] == 1 and f["tenure_months"] == 65 and f["new_hire"] == 0
    assert f["overtime_h_3m"] == pytest.approx((60 + 120) / 60 / 3)


def test_manager_and_exit_visibility(src):
    assert src.manager_at(6, T) == 1 and src.manager_at(6, "2025-07-31") == 2
    assert src.active(4, T) and not src.active(5, T) and not src.active(4, "2025-07-31")


def test_open_and_late_rules():
    base = {"id": 1, "eid": 1, "code": "X", "start": None, "end": None, "hours": 4.0}
    assert is_open({**base, "due": "2025-10-28", "status": "PLANIFIEE"}, T)
    assert not is_open({**base, "due": "2025-10-29", "status": "PLANIFIEE"}, T)
    assert not is_open({**base, "due": T, "status": "PLANIFIEE"}, T)
    assert not is_open({**base, "due": "2025-07-10", "status": "TERMINEE"}, T)
    assert late({**base, "due": "2025-07-10", "status": "TERMINEE", "end": "2025-07-11"}) == 1
    assert late({**base, "due": "2025-07-10", "status": "TERMINEE", "end": "2025-07-10"}) == 0

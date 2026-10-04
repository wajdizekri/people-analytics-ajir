import json
import sqlite3

import numpy as np
import pytest

from train import data as D

SPEC = D.load_spec()
NAMES = D.feature_names(SPEC)


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "panel.db"
    con = sqlite3.connect(path)
    for f in sorted((D.ROOT / "drizzle").glob("*.sql")):
        con.executescript(f.read_text(encoding="utf-8").replace("--> statement-breakpoint", ""))
    con.execute("INSERT INTO app_setting (key, value) VALUES ('data_end_date', '2025-12-31'), ('capacity_rate', '0.03')")
    emps = [(1, "A1", "F", "1990-01-15"), (2, "B1", "M", "1970-06-01"), (3, "C1", "M", None)]
    for i, mat, sex, birth in emps:
        con.execute("INSERT INTO employee (id, matricule, last_name, first_name, sex, birth_date, hire_date) VALUES (?, ?, 'N', 'P', ?, ?, '2015-01-01')",
                    (i, mat, sex, birth))
    con.execute("INSERT INTO exit_event (employee_id, exit_date, reason, resignation_date, recorded_at) "
                "VALUES (2, '2025-05-20', 'DEMISSION', '2025-04-20', '2025-05-25')")
    for as_of in ("2025-01-31", "2025-02-28", "2025-06-30", "2025-07-31"):
        for i in (1, 2, 3):
            if i == 2 and as_of > "2025-04-20":
                continue
            vals = [float(i * 100 + j) for j in range(len(NAMES))]
            con.execute("INSERT INTO feature_snapshot (employee_id, as_of, fsv, values_json) VALUES (?, ?, 'v1', ?)",
                        (i, as_of, json.dumps(vals)))
    con.commit()
    con.close()
    return path


def test_panel_keeps_complete_followup_and_feature_order(db):
    meta, X = D.load_panel(db)
    assert set(meta["as_of"]) == {"2025-01-31", "2025-02-28", "2025-06-30"}
    assert X.shape == (len(meta), len(NAMES))
    row = meta.index[(meta["employee_id"] == 3) & (meta["as_of"] == "2025-06-30")][0]
    assert X[row].tolist() == [300.0 + j for j in range(len(NAMES))]
    assert meta.loc[meta["employee_id"] == 2, "y6"].tolist() == [1, 1]
    assert meta.loc[meta["employee_id"] != 2, "y6"].sum() == 0
    assert meta["month"].iloc[0] == 2025 * 12
    a = meta.set_index(["employee_id", "as_of"])
    assert a.loc[(1, "2025-01-31"), "age_band"] == "30-44 ans"
    assert a.loc[(2, "2025-01-31"), "age_band"] == "45 ans et plus"
    assert a.loc[(3, "2025-01-31"), "age_band"] == "inconnu"
    assert len(D.load_panel(db, complete_only=False)[0]) == len(meta) + 2


def test_db_is_opened_read_only(db):
    con = D.connect_ro(db)
    with pytest.raises(sqlite3.OperationalError):
        con.execute("DELETE FROM app_setting")
    con.close()
    assert D.load_settings(db)["capacity_rate"] == 0.03


def test_align_features_and_hash(db, tmp_path):
    meta, X = D.load_panel(db)
    csv = tmp_path / "naive.csv"
    rows = ["employee_id;as_of;partial_history;" + ";".join(NAMES)]
    for (eid, as_of), x in zip(meta[["employee_id", "as_of"]].itertuples(index=False), X):
        rows.append(f"{eid};{as_of};0;" + ";".join(str(v + 1) for v in x))
    csv.write_text("\n".join([rows[0]] + rows[1:][::-1]), encoding="utf-8")
    Xn = D.align_features(meta, D.load_feature_csv(csv, NAMES), NAMES)
    assert np.array_equal(Xn, X + 1)
    assert D.data_hash(meta) == D.data_hash(meta.copy()) and len(D.data_hash(meta)) == 64
    with pytest.raises(ValueError):
        D.align_features(meta, D.load_feature_csv(csv, NAMES).iloc[1:], NAMES)

import pandas as pd


def test_hierarchy_has_no_cycle_and_known_managers(run):
    d, _ = run
    emp = pd.read_csv(d / "employees.csv", sep=";", dtype=str, keep_default_na=False)
    mgr = dict(zip(emp["matricule"], emp["manager_matricule"]))
    assert set(v for v in mgr.values() if v) <= set(mgr)
    assert all(k != v for k, v in mgr.items())
    for start in mgr:
        seen, cur = set(), start
        while cur:
            assert cur not in seen, f"cycle depuis {start}"
            seen.add(cur)
            cur = mgr[cur]


def test_active_teams_have_five_to_twelve_members(run):
    d, _ = run
    emp = pd.read_csv(d / "employees.csv", sep=";", dtype=str, keep_default_na=False)
    ex = pd.read_csv(d / "exits.csv", sep=";", dtype=str, keep_default_na=False)
    active = emp[~emp["matricule"].isin(ex["matricule"])]
    heads = active[active["manager_matricule"] == ""]
    assert len(heads) == 8
    sizes = active[active["manager_matricule"] != ""].groupby("manager_matricule").size()
    assert sizes.median() >= 5 and sizes.quantile(0.9) <= 13

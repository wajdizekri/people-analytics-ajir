import numpy as np
import pandas as pd

from train import study as ST


def test_threshold_is_first_stable_bin():
    rows = []
    for events, delta, oe in [(5, 0.0, 0.5), (15, 0.03, 0.9), (25, 0.01, 0.9), (40, 0.05, 1.0), (60, 0.06, 1.0), (120, 0.07, 1.0)]:
        for k in range(10):
            rows.append({"events": events, "auc_b0": 0.6, "auc_logreg": 0.6 + delta + (0.001 if k else -0.0005),
                         "auc_lgbm": 0.59, "oe_logreg": oe, "lift_logreg": 3.0, "lift_b0": 2.0})
    by_events = ST.summarize_by_events(pd.DataFrame(rows))
    assert [b["events_from"] for b in by_events] == [0, 10, 20, 30, 50, 100]
    th = ST.propose_threshold(by_events)
    assert th["n1_auc"] == 30 and th["n1_strict"] == 30 and th["n_calibration"] == 10 and th["n2_lgbm"] is None
    assert all(b["p_lift_logreg_gt_b0"] == 1 and b["lift_delta_mean"] == 1 for b in by_events)


def test_naive_frame_aligns_rows():
    main = pd.DataFrame({"employee_id": [1, 2], "as_of": ["2025-01-31"] * 2, "B0": [1.0, 2.0], "LOGREG": [0.1, 0.2], "LGBM": [0.3, 0.4]})
    naive = pd.DataFrame({"employee_id": [2, 1], "as_of": ["2025-01-31"] * 2, "B0": [3.0, 4.0], "LOGREG": [0.5, 0.6],
                          "LOGREG_alt": [0.7, 0.8]})
    f = ST.naive_eval_frame(main, naive)
    assert f.set_index("employee_id").loc[1, "LOGREG_nom"] == 0.1 and f.set_index("employee_id").loc[1, "LOGREG"] == 0.6
    assert np.isfinite(f["LGBM_nom"]).all()

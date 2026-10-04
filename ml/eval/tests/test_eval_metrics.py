import math

import numpy as np
import pytest

from ml.eval import common as C
from ml.eval.anomalies import interpolated_ap
from ml.eval.metrics import Detection, Event, average_precision, event_metrics, match, rule_fires

NAN = math.nan


def test_rule_fires_reproduit_la_regle_des_semaines_consecutives():
    z = np.array([0, 4, 4, 4, 0, 4, 4, NAN, 4])
    assert rule_fires(z, 3.5, 2, 0, 8) == [2, 6]
    assert rule_fires(z, 3.5, 1, 0, 8) == [1, 5, 8]
    assert rule_fires(z, 3.5, 3, 0, 8) == [3]
    assert rule_fires(np.array([3.5, 3.5]), 3.5, 1, 0, 1) == []  # strictement supérieur au seuil


def test_rule_fires_regarde_avant_la_fenetre():
    z = np.array([4.0, 4.0, 4.0, 4.0])
    assert rule_fires(z, 3.5, 2, 2, 3) == []  # épisode commencé avant la fenêtre : déjà signalé
    assert rule_fires(z, 3.5, 2, 1, 3) == [1]


def test_appariement_temps_et_groupe():
    ev = [Event(1, "PIC_EQUIPE", "2024-03-06", "2024-03-20", frozenset({10, 11}))]
    dets = [
        Detection("T1", "2024-03-04", "2024-03-17", frozenset({11, 12})),
        Detection("T2", "2024-03-04", "2024-03-17", frozenset({20})),
        Detection("T1", "2024-04-01", "2024-04-14", frozenset({11, 12})),
    ]
    hits = match(dets, ev)
    assert hits == {1: [0]}
    assert [d.matched for d in dets] == [[1], [], []]


def test_event_metrics_precision_fp_et_delai():
    ev = [
        Event(1, "PIC_EQUIPE", "2024-03-06", "2024-03-20", frozenset({10})),
        Event(2, "DERIVE", "2024-06-01", "2024-09-01", frozenset({30})),
    ]
    dets = [Detection("T1", "2024-03-04", "2024-03-17", frozenset({10})), Detection("T9", "2024-05-06", "2024-05-19", frozenset({99}))]
    m = event_metrics(dets, ev, months=2)
    assert m["precision"] == 0.5 and m["fp_per_month"] == 0.5 and m["recall_all"] == 0.5
    assert m["per_type"]["PIC_EQUIPE"]["delay_median_days"] == 11  # fin de la 2e semaine - début injecté
    assert m["per_type"]["DERIVE"]["recall"] == 0


def test_average_precision_et_ap_interpolee():
    assert average_precision([0, 1, 0, 1], [0.1, 0.9, 0.2, 0.8]) == pytest.approx(1.0)
    assert average_precision([0, 0], [0.1, 0.2]) is None
    assert interpolated_ap(np.array([0.5, 1.0]), np.array([1.0, 0.5])) == pytest.approx(0.75)


def test_semaines_du_mois_identiques_au_worker():
    assert C.weeks_of_month("2021-03") == ("2021-02-22", "2021-03-29")
    assert C.weeks_of_month("2026-08") == ("2026-07-20", "2026-08-31")
    assert C.monday_of("2024-12-30") == "2024-12-30" and C.monday_of("2025-01-05") == "2024-12-30"


@pytest.mark.skipif(not (C.EXPORT_DIR / "anomaly_table.csv").exists(), reason="exports d'évaluation absents (scripts/eval-anomalies.ts scores)")
def test_replication_exacte_de_la_table_anomaly():
    from ml.eval import anomalies as A

    ctx = A.Context()
    tab = A.table_detections(ctx, C.EXPORT_DIR / "anomaly_table.csv")
    assert A.same_detections(tab, A.python_detections(ctx, "cal", "batch", 3.5, 2)) == {"both": len(tab), "only_first": 0, "only_second": 0}

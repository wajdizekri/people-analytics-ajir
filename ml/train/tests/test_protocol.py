import numpy as np
import pytest

from train import models as MD
from train import protocol as P

MONTHS = np.repeat(np.arange(24248, 24248 + 66), 3)


@pytest.mark.parametrize("origin", P.default_origins(MONTHS))
def test_split_has_no_label_overlap(origin):
    sp = P.make_split(MONTHS, origin)
    tr, ca, te, hi = (MONTHS[m] for m in (sp.train, sp.cal, sp.test, sp.history))
    assert tr.max() + P.HORIZON <= ca.min()
    assert ca.max() + P.HORIZON <= origin
    assert hi.max() + P.HORIZON <= origin
    assert te.min() == origin and te.max() == origin + P.HORIZON - 1
    assert len(np.unique(ca)) == P.CAL_MONTHS
    assert not (sp.train & sp.cal).any() and not (sp.cal & sp.test).any() and not (sp.history & sp.test).any()


def test_default_origins_cover_last_complete_months():
    o = P.default_origins(MONTHS)
    assert len(o) == 6 and np.all(np.diff(o) == 6)
    assert o[-1] + P.HORIZON - 1 == MONTHS.max()
    assert P.make_split(MONTHS, o[0]).train.any()


def test_inner_validation_is_temporal():
    fit, val = MD.inner_split(MONTHS)
    assert MONTHS[fit].max() + 6 <= MONTHS[val].min()
    assert len(np.unique(MONTHS[val])) == 6 and MONTHS[val].max() == MONTHS.max()

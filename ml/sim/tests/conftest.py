import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sim.run import simulate  # noqa: E402


@pytest.fixture(scope="session")
def run(tmp_path_factory):
    out = tmp_path_factory.mktemp("sim")
    st = simulate("small", "mixte", 3, out=out, verbose=False, n0=800, months=48, reps=50)
    return Path(st["out_dir"]), st

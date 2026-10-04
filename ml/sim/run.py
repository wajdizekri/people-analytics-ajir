"""CLI du simulateur : python ml/sim/run.py --config small|medium|large --scenario mixte|charge --seed N [--out data/sim]"""
import argparse
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sim import anomalies as A  # noqa: E402
from sim import config as C  # noqa: E402
from sim import daily as D  # noqa: E402
from sim import stats as ST  # noqa: E402
from sim.engine import Simulation  # noqa: E402
from sim.export import Exporter  # noqa: E402

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "data" / "sim"


def simulate(config="small", scenario="mixte", seed=1, out=DEFAULT_OUT, oracle=True, verbose=True, **overrides) -> dict:
    t0 = time.perf_counter()
    out_dir = Path(out) / f"{scenario}_{config}_s{seed}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    sim = Simulation(config, scenario, seed, oracle=oracle, **overrides).run()
    t1 = time.perf_counter()
    plan = A.plan(sim)
    ex = Exporter(sim, out_dir)
    agg = D.generate(sim, plan, ex.attendance_sink)
    t2 = time.perf_counter()
    ex.absences()
    ex.payroll(agg)
    ex.referentials()
    st = ST.compute(sim, agg, plan, ex)
    st["durations_s"] = dict(population=round(t1 - t0, 1), daily=round(t2 - t1, 1), total=round(time.perf_counter() - t0, 1))
    ex.ground_truth(plan, st)
    st["durations_s"]["total"] = round(time.perf_counter() - t0, 1)
    st["out_dir"] = str(out_dir)
    if verbose:
        print(f"Simulation {scenario}/{config}, graine {seed} -> {out_dir}")
        print(ST.summary(st))
        print(f"Durées : {st['durations_s']}")
    return st


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Simulateur RH à vérité terrain (export AJIR + ground_truth/)")
    ap.add_argument("--config", choices=sorted(C.SIZES), default="small")
    ap.add_argument("--scenario", choices=sorted(C.SCENARIOS), default="mixte")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--no-oracle", action="store_true", help="saute le calcul Monte-Carlo de oracle_prob6.csv")
    a = ap.parse_args()
    simulate(a.config, a.scenario, a.seed, a.out, oracle=not a.no_oracle)


if __name__ == "__main__":
    main()

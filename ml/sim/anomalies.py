"""Anomalies d'absentéisme injectées et étiquetées (vérité terrain, hors maladie et maternité)."""
import numpy as np

from . import latent as L
from . import org as O
from .daily import C_AUT, C_CSS, C_INJ

# type, portée, poids, réservé à l'évaluation
TYPES = [
    ("PIC_EQUIPE", "EQUIPE", 0.25, 0),  # pic collectif d'une équipe pendant 2 à 4 semaines
    ("LUNDI_VENDREDI", "SALARIE", 0.20, 0),  # absences d'un jour collées au week-end, 2 à 4 mois
    ("PONTS", "SALARIE", 0.15, 0),  # absences collées aux fériés et aux ponts, 6 à 12 mois
    ("DERIVE", "SALARIE", 0.20, 0),  # dérive progressive des absences courtes, 4 à 6 mois
    ("ROTATION_EQUIPE", "EQUIPE", 0.20, 1),  # type libre : un membre absent chaque jour à tour de rôle, 6 à 8 semaines
]


class Plan:
    def __init__(self):
        self.rows = []
        self.episodes = {}

    def add_episode(self, e, s, d, cat, rid):
        self.episodes.setdefault(int(e), []).append((int(s), int(d), int(cat), int(rid)))

    def episodes_for(self, emps):
        for e in emps:
            for s, d, c, rid in self.episodes.get(int(e), ()):
                yield int(e), s, d, c, rid

    def set_injected(self, days):
        for r, k in zip(self.rows, days):
            r["injected_days"] = int(k)


def _active(sim):
    F, n = sim.F, sim.n
    hire, ex = F["hire"][:n], F["exit_day"][:n]
    ex = np.where(ex >= 0, ex, 10**9)
    return (hire[:, None] <= sim.mend[None, :]) & (ex[:, None] >= sim.mstart[None, :]) & (sim.panel["ct"][:n] != L.CT_STAGE)


def plan(sim) -> Plan:
    rng, cal, T = sim.rng_anom, sim.cal, sim.T
    act = _active(sim)
    target = sim.p.anomaly_rate * act.sum()
    used = np.zeros_like(act)
    team_m = sim.panel["team"][: sim.n]
    weights = np.array([t[2] for t in TYPES])
    pl = Plan()
    covered, aid, tries = 0, 0, 0
    wd_months = cal.wd_month
    while covered < target and tries < 20000:
        tries += 1
        typ, scope, _, held = TYPES[rng.choice(len(TYPES), p=weights / weights.sum())]
        m0 = int(rng.integers(1, max(T - 2, 2)))
        s = cal.wd_first[m0] + int(rng.integers(0, cal.wd_count[m0]))
        if scope == "EQUIPE":
            teams = np.unique(team_m[act[:, m0] & (team_m[:, m0] >= 0), m0])
            if not len(teams):
                continue
            t = int(rng.choice(teams))
            members = np.nonzero(act[:, m0] & (team_m[:, m0] == t))[0]
            if len(members) < 5:
                continue
            length = int(rng.integers(10, 21)) if typ == "PIC_EQUIPE" else int(rng.integers(30, 41))
        else:
            cand = np.nonzero(act[:, m0] & ~used[:, m0])[0]
            if not len(cand):
                continue
            members = np.array([int(rng.choice(cand))])
            t = int(team_m[members[0], m0])
            months = {"LUNDI_VENDREDI": (2, 5), "PONTS": (6, 13), "DERIVE": (4, 7)}[typ]
            length = int(sum(cal.wd_count[m0:m0 + int(rng.integers(*months))]))
        e_wd = min(s + length, cal.n_wd) - 1
        ms = np.arange(wd_months[s], wd_months[e_wd] + 1)
        if used[np.ix_(members, ms)].any():
            continue
        span = np.arange(s, e_wd + 1)
        mgr = int(sim.team_manager_panel[t, m0]) if t >= 0 else -1
        dept = int(sim.F["dept"][members[0]]) if t < 0 else int(sim.team_dept[t])
        base = len(pl.rows)
        for i, e in enumerate(members):
            pl.rows.append(dict(anomaly_id=aid + 1, type=typ, scope=scope, department_code=O.DEPT_CODES[dept],
                                manager=mgr, e=int(e), start=int(cal.wd_days[s]), end=int(cal.wd_days[e_wd]),
                                injected_days=0, held_out=held))
        if typ == "PIC_EQUIPE":
            p = rng.uniform(0.12, 0.22)
            for i, e in enumerate(members):
                days = span[rng.random(len(span)) < p]
                for d in days:
                    pl.add_episode(e, d, 2 if rng.random() < 0.2 else 1, _cat(rng), base + i)
        elif typ == "ROTATION_EQUIPE":
            for d in span[rng.random(len(span)) < 0.8]:
                i = int(rng.integers(len(members)))
                pl.add_episode(members[i], d, 1, C_AUT if rng.random() < 0.5 else C_INJ, base + i)
        elif typ == "LUNDI_VENDREDI":
            wk = cal.wd_weekday[span]
            for d in span[((wk == 0) | (wk == 4)) & (rng.random(len(span)) < 0.35)]:
                pl.add_episode(members[0], d, 1, C_INJ if rng.random() < 0.8 else C_AUT, base)
        elif typ == "PONTS":
            for d in span[cal.wd_near_hol[span] & (rng.random(len(span)) < 0.7)]:
                pl.add_episode(members[0], d, 1, C_CSS if rng.random() < 0.5 else C_INJ, base)
        else:
            ramp = np.linspace(0, 0.12, len(span))
            for d in span[rng.random(len(span)) < ramp]:
                pl.add_episode(members[0], d, 1, C_INJ if rng.random() < 0.7 else C_AUT, base)
        used[np.ix_(members, ms)] = True
        covered += int(act[np.ix_(members, ms)].sum())
        aid += 1
    pl.employee_months = covered
    pl.total_employee_months = int(act.sum())
    return pl


def _cat(rng):
    u = rng.random()
    return C_INJ if u < 0.6 else (C_AUT if u < 0.85 else C_CSS)

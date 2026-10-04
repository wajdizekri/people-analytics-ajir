"""Simulation mensuelle : population, carrière, sorties, remplacements, organisation, oracle."""
import numpy as np

from . import config as C
from . import latent as L
from . import names as N
from . import org as O
from .calendar_tn import TunisianCalendar, add_months, add_years

BIG = 10**6
F_, M_ = 0, 1  # codes de sexe

FIELDS = dict(
    mat=(object, ""), last=(object, ""), first=(object, ""), title=(object, ""),
    sex=(np.int8, 0), birth=(np.int64, 0), hire=(np.int64, 0), gov=(np.int16, 0), marital=(np.int8, 0),
    dept=(np.int8, 0), fam=(np.int8, 0), team=(np.int32, -1), manages=(np.int32, -1), role=(np.int8, 0),
    grade=(np.int8, 1), salary=(np.float64, 0.0), stipend=(np.float64, 0.0), ctype=(np.int8, 0),
    cend=(np.int64, -1), cend_m=(np.int64, BIG), n_renew=(np.int8, 0),
    alive=(bool, False), exit_day=(np.int64, -1), exit_reason=(np.int8, 0), post_m=(np.int32, -1),
    post_day=(np.int64, -1), trig_m=(np.int32, -1), E_trig=(np.float32, 0.0), resign_kept=(bool, True),
    mgr_exit=(np.int32, -1), was_mgr=(bool, False), last_birth_m=(np.int32, -99),
    frailty=(np.float32, 1.0), arr_off=(np.float32, 0.0), arr_sd=(np.float32, 5.0), p_late=(np.float32, 0.03),
    mq_self=(np.float32, 0.0),
    E=(np.float64, 0.0), D=(np.float64, 0.0), H=(np.float64, 3.0), mu=(np.float64, 0.0), P=(np.float64, 0.0),
    B=(np.float64, 0.0), mq=(np.float64, 0.0), perf_dev=(np.float64, 0.0), pbase=(np.float64, 0.0),
    m_prom=(np.int32, 0), ot_prop=(np.float64, 0.0), ot1=(np.float64, 0.0), ot2=(np.float64, 0.0),
    ot3=(np.float64, 0.0), age_m=(np.int32, 0), tenure_m=(np.int32, 0), post_in=(np.int32, -1),
    posted=(bool, False), abandon=(bool, False), mech=(np.int8, 0), last_score=(np.int8, 3),
    m_eval=(np.int32, 99), ot_elig=(bool, False),
)
PANEL = dict(E=np.float32, P=np.float32, O=np.float32, sal=np.float64, team=np.int32, mq=np.float32,
             mkt=np.float32, ct=np.int8, grade=np.int8)


class Simulation:
    def __init__(self, size="small", scenario="mixte", seed=1, n0=None, months=None, reps=None, oracle=True):
        spec = dict(C.SIZES[size])
        self.n0 = n0 or spec["n0"]
        self.T = months or spec["months"]
        self.reps = reps or spec["oracle_reps"]
        self.size, self.scenario, self.seed = size, scenario, seed
        self.p = C.SCENARIOS[scenario]
        streams = np.random.SeedSequence(seed).spawn(7)
        (self.rng, self.rng_oracle, self.rng_daily, self.rng_anom, self.rng_def, self.rng_train,
         self.rng_misc) = [np.random.default_rng(s) for s in streams]
        end = np.datetime64(C.END_DATE)
        self.end_day = int(end.astype(np.int64))
        self.extraction_day = self.end_day + C.EXTRACTION_LAG_DAYS
        self.start_month = end.astype("datetime64[M]") - (self.T - 1)
        self.cal = TunisianCalendar(self.start_month, end)
        months = self.start_month + np.arange(self.T)
        self.mstart = months.astype("datetime64[D]").astype(np.int64)
        self.mend = ((months + 1).astype("datetime64[D]") - 1).astype(np.int64)
        self.moy = months.astype(np.int64) % 12 + 1
        self.month_str = np.datetime_as_string(months)
        self.start_day = int(self.mstart[0])
        self.oracle_on = oracle
        self.oracle_months = [m for m in range(self.T) if (self.T - 1 - m) % 3 == 0]
        self.contracts, self.career, self.evals, self.life, self.vacancies = [], [], [], [], []
        self.oracle_rows = []
        self.next_mat = 10001
        self.stepped_m = -1
        self.n = 0
        cap = int(self.n0 * (1.3 + 0.3 * self.T / 12)) + 64
        self.F = {k: np.full(cap, d, dtype=t) for k, (t, d) in FIELDS.items()}
        self.panel = {k: np.zeros((cap, self.T), dtype=t) for k, t in PANEL.items()}
        self.panel["team"][:] = -1
        gw = np.array([w for _, w in N.GOVERNORATES], float)
        self.gov_p = gw / gw.sum()
        self._init_population()

    # ------------------------------------------------------------------ utilitaires
    def month_of(self, days):
        d = np.asarray(days, dtype=np.int64).astype("datetime64[D]")
        return (d.astype("datetime64[M]") - self.start_month).astype(np.int64)

    def ref(self, m):
        return O.ref_table(m, self.T - 1)

    def _grow(self, k):
        cap = len(self.F["mat"])
        if self.n + k <= cap:
            return
        new = max(cap * 2, self.n + k)
        for key, arr in self.F.items():
            t, d = FIELDS[key]
            ext = np.full(new, d, dtype=t)
            ext[:cap] = arr
            self.F[key] = ext
        for key, arr in self.panel.items():
            ext = np.zeros((new, self.T), dtype=arr.dtype)
            if key == "team":
                ext[:] = -1
            ext[:cap] = arr
            self.panel[key] = ext

    def _alloc(self, k):
        self._grow(k)
        idx = np.arange(self.n, self.n + k)
        self.n += k
        return idx

    def manager_of(self, idx):
        t = self.F["team"][idx]
        return np.where(t >= 0, self.team_manager[np.maximum(t, 0)], -1)

    def mq_of(self, idx):
        mgr = self.manager_of(idx)
        return np.where(mgr >= 0, self.F["mq_self"][np.maximum(mgr, 0)], self.p.mq_head)

    def work_team(self, idx):
        return np.where(self.F["manages"][idx] >= 0, self.F["manages"][idx], self.F["team"][idx])

    def mat(self, e):
        return self.F["mat"][e] if e >= 0 else ""

    def _event(self, e, day, kind, old, new, lag=(0, 20)):
        rec = int(day) + int(self.rng.integers(lag[0], lag[1] + 1))
        self.career.append((int(e), int(day), kind, str(old), str(new), rec))

    def _marital_for(self, age, rng):
        p_mar = 0.92 / (1 + np.exp(-(age - 29) / 3))
        u = rng.random(len(age))
        st = np.where(u < p_mar, 1, 0)
        v = rng.random(len(age))
        st = np.where((st == 1) & (age > 35) & (v < 0.05), 2, st)
        st = np.where((st == 1) & (age > 50) & (v > 0.97), 3, st)
        return st.astype(np.int8)

    def _identity(self, idx, sex, rng):
        F = self.F
        k = len(idx)
        F["sex"][idx] = sex
        F["first"][idx] = [N.FEMALE[rng.integers(len(N.FEMALE))] if s == F_ else N.MALE[rng.integers(len(N.MALE))]
                           for s in sex]
        F["last"][idx] = [N.LAST[i] for i in rng.integers(len(N.LAST), size=k)]
        F["gov"][idx] = rng.choice(len(N.GOVERNORATES), size=k, p=self.gov_p)
        F["frailty"][idx] = rng.gamma(1.3, 1 / 1.3, k)
        F["arr_off"][idx] = rng.normal(-8, 5, k)
        F["arr_sd"][idx] = rng.uniform(3, 11, k)
        F["p_late"][idx] = rng.beta(1.2, 40, k)
        F["mq_self"][idx] = rng.standard_normal(k)
        F["mu"][idx] = rng.normal(0, self.p.mu_sd, k)
        F["H"][idx] = self.p.threshold_median * np.exp(rng.normal(0, self.p.threshold_sd, k))
        F["pbase"][idx] = rng.standard_normal(k)
        F["perf_dev"][idx] = rng.normal(0, 0.4, k)
        prop = rng.gamma(1.6, np.asarray(C.OT_MEAN)[F["fam"][idx]] / 1.6) * self.p.ot_mult
        F["ot_prop"][idx] = prop
        F["ot1"][idx] = F["ot2"][idx] = F["ot3"][idx] = prop

    def _assign_mats(self, idx):
        for e in idx:
            self.F["mat"][e] = f"M{self.next_mat:05d}"
            self.next_mat += 1

    def _set_ot_elig(self, idx):
        F = self.F
        F["ot_elig"][idx] = (F["grade"][idx] <= 5) & (F["role"][idx] <= O.ROLE_LEAD) & (F["ctype"][idx] != L.CT_STAGE)

    # ------------------------------------------------------------------ population initiale
    def _init_population(self):
        rng, p, F = self.rng, self.p, self.F
        teams, positions = O.build(self.n0, rng)
        self.team_dept, self.team_fam = teams["dept"], teams["fam"]
        self.team_parent, self.team_level = teams["parent"], teams["level"]
        self.n_teams = len(self.team_dept)
        self.team_manager = np.full(self.n_teams, -1, np.int64)
        self.team_wbar = rng.normal(0, p.w_team_sd, self.n_teams)
        self.W = self.team_wbar.copy()
        self.mkt = rng.normal(0, p.mkt_sigma / np.sqrt(1 - p.mkt_rho**2), 5)
        self.team_manager_panel = np.full((self.n_teams, self.T), -1, np.int64)

        k = len(positions)
        order = rng.permutation(k)
        positions = [positions[i] for i in order]
        idx = self._alloc(k)
        for key in ("dept", "fam", "team", "manages", "role"):
            F[key][idx] = [q[key] for q in positions]
        role = F["role"][idx]
        fam = F["fam"][idx]
        age = np.where(role == O.ROLE_HEAD, rng.uniform(45, 59, k),
                       np.where(role == O.ROLE_MID, rng.uniform(38, 56, k),
                                np.where(role == O.ROLE_LEAD, rng.uniform(31, 54, k),
                                         np.clip(22 + rng.gamma(2.0, 5.5, k), 22, 59.5))))
        fam_off = np.array([0.5, 0.3, -0.4, 0.0, -0.2])[fam]
        g_staff = np.clip(1 + np.floor(0.12 * (age - 22) + rng.normal(0.8, 1.0, k) + fam_off), 1, 6)
        g = np.where(role == O.ROLE_HEAD, np.where(rng.random(k) < 0.6, 8, 7),
                     np.where(role == O.ROLE_MID, rng.choice([6, 7], k),
                              np.where(role == O.ROLE_LEAD, rng.choice([4, 5, 6], k, p=[0.25, 0.4, 0.35]), g_staff))).astype(np.int64)
        ct = np.full(k, L.CT_CDI, np.int8)
        staff = np.nonzero(role == O.ROLE_STAFF)[0]

        def pick(pool, n_pick, w):
            if n_pick <= 0 or len(pool) == 0:
                return np.array([], int)
            w = w / w.sum()
            return rng.choice(pool, size=min(n_pick, len(pool)), replace=False, p=w)

        tgt = C.CONTRACT_TARGET
        pool = staff[g[staff] <= 2]
        st = pick(pool, round(tgt["STAGE"] * k), np.ones(len(pool)))
        ct[st] = L.CT_STAGE
        pool = staff[(g[staff] <= 3) & (ct[staff] == L.CT_CDI)]
        sv = pick(pool, round(tgt["SIVP"] * k), np.ones(len(pool)))
        ct[sv] = L.CT_SIVP
        pool = staff[ct[staff] == L.CT_CDI]
        cd = pick(pool, round(tgt["CDD"] * k), np.where(age[pool] <= 40, 3.0, 1.0))
        ct[cd] = L.CT_CDD
        age[st] = rng.uniform(21, 25, len(st))
        g[st] = 1
        age[sv] = np.minimum(age[sv], rng.uniform(23, 30, len(sv)))
        g[sv] = np.minimum(g[sv], 2)
        age[cd] = np.minimum(age[cd], rng.uniform(23, 45, len(cd)))

        max_ten = np.maximum((age - 21.5) * 12, 1)
        ten = np.where(ct == L.CT_STAGE, rng.uniform(0, 3, k),
                       np.where(ct == L.CT_SIVP, rng.uniform(0, 22, k),
                                np.where(ct == L.CT_CDD, rng.uniform(0, 40, k),
                                         np.where(role == O.ROLE_STAFF, rng.exponential(84, k), 24 + rng.exponential(110, k)))))
        ten = np.minimum(ten, max_ten)
        start = self.start_day
        hire = start - 1 - np.floor(ten * 30.44).astype(np.int64) - rng.integers(0, 28, k)
        birth = hire - np.floor((age - ten / 12) * 365.25).astype(np.int64)
        F["hire"][idx], F["birth"][idx] = hire, birth
        F["grade"][idx] = g.astype(np.int8)
        F["ctype"][idx] = ct
        sex = np.where(rng.random(k) < np.asarray(C.FEMALE_SHARE)[fam], F_, M_).astype(np.int8)
        sex[role >= O.ROLE_MID] = np.where(rng.random((role >= O.ROLE_MID).sum()) < 0.25, F_, M_)
        self._identity(idx, sex, rng)
        age_now = (start - birth) / 365.25
        F["marital"][idx] = self._marital_for(age_now, rng)
        m_start = self.start_month
        F["age_m"][idx] = (m_start - 1 - birth.astype("datetime64[D]").astype("datetime64[M]")).astype(np.int64)
        F["tenure_m"][idx] = np.maximum((m_start - 1 - hire.astype("datetime64[D]").astype("datetime64[M]")).astype(np.int64), 0)
        ref0 = self.ref(0)
        ten_y = ten / 12
        compa = np.exp(rng.normal(-0.01, 0.08, k)) * (1 - 0.01 * np.clip(ten_y - 5, 0, 15))
        sal = ref0[fam, g] * compa
        sal = np.where(ct == L.CT_SIVP, sal * C.SIVP_PAY, sal)
        F["salary"][idx] = np.where(ct == L.CT_STAGE, ref0[fam, g] * 0.95, np.maximum(sal, C.SALARY_FLOOR))
        F["stipend"][idx] = np.where(ct == L.CT_STAGE, rng.uniform(*C.STAGE_STIPEND, k).round(0), 0.0)
        F["m_prom"][idx] = np.minimum(F["tenure_m"][idx], rng.exponential(30, k).astype(np.int32))
        F["alive"][idx] = True
        F["was_mgr"][idx] = role >= O.ROLE_LEAD
        for e in idx:
            if F["manages"][e] >= 0:
                self.team_manager[F["manages"][e]] = e
                F["title"][e] = O.manager_title(F["dept"][e], F["fam"][e], F["role"][e])
            else:
                F["title"][e] = O.staff_title(rng, F["dept"][e], F["fam"][e], F["grade"][e])
        self._set_ot_elig(idx)
        by_hire = idx[np.argsort(hire, kind="stable")]
        self._assign_mats(by_hire)
        self._initial_history(idx)
        self._burn_in(idx, 24)

    def _initial_history(self, idx):
        """Contrats, dernière promotion, dernière augmentation et dernière évaluation antérieurs à la période."""
        rng, F, start = self.rng, self.F, self.start_day
        start_m = self.start_month
        last_jan = int((start_m - 1).astype("datetime64[Y]").astype("datetime64[D]").astype(np.int64))
        dec = (start_m - 1).astype("datetime64[Y]").astype("datetime64[M]") - 1
        if (start_m - 1).astype(np.int64) % 12 == 11:
            dec = start_m - 1
        dec_day = int(dec.astype("datetime64[D]").astype(np.int64)) + 14
        m_eval0 = int((start_m - 1 - dec).astype(np.int64))
        perf = F["pbase"][idx] + F["perf_dev"][idx]
        score = np.clip(np.rint(3.1 + 0.6 * perf + rng.normal(0, 0.55, len(idx))), 1, 5).astype(np.int8)
        for i, e in enumerate(idx):
            h, ct = int(F["hire"][e]), int(F["ctype"][e])
            if ct == L.CT_CDI:
                if F["tenure_m"][e] >= 30 and rng.random() < 0.6:
                    s2 = int(add_months(h, 24))
                    self.contracts.append((e, L.CT_CDD, h, s2 - 1))
                    self.contracts.append((e, L.CT_CDI, s2, -1))
                else:
                    self.contracts.append((e, L.CT_CDI, h, -1))
            else:
                s, n_ren = h, 0
                while True:
                    dur = {L.CT_CDD: int(rng.integers(12, 25)), L.CT_SIVP: 12, L.CT_STAGE: int(rng.integers(4, 7))}[ct]
                    end = int(add_months(s, dur)) - 1
                    self.contracts.append((e, ct, s, end))
                    if end >= start + 20:
                        break
                    s, n_ren = end + 1, n_ren + 1
                F["cend"][e] = end
                F["cend_m"][e] = int(self.month_of(end))
                F["n_renew"][e] = min(n_ren, 1)
            if ct == L.CT_STAGE:
                continue
            m_prom = int(F["m_prom"][e])
            if F["grade"][e] > 1 and m_prom < F["tenure_m"][e] - 1:
                d = int(add_months(self.mstart[0], -(m_prom + 1)))
                self._event(e, d, "PROMOTION", f"G{F['grade'][e] - 1}", f"G{F['grade'][e]}", (0, 30))
            if h <= last_jan - 120:
                pct = (2 + 1.5 * (score[i] - 1)) / 100
                self._event(e, last_jan, "AUGMENTATION", f"{F['salary'][e] / (1 + pct):.3f}", f"{F['salary'][e]:.3f}", (5, 45))
            if h <= dec_day - 182 and rng.random() >= self.p.eval_missing:
                d = dec_day + int(rng.integers(-10, 12))
                self.evals.append((e, d, int(score[i]), d + int(rng.integers(30, 121))))
                F["last_score"][e] = score[i]
                F["m_eval"][e] = m_eval0

    def _burn_in(self, idx, months):
        p, rng = self.p, self.rng
        S = {k: self.F[k][idx].copy() for k in L.KEYS}
        S["mq"] = self.mq_of(idx)
        team = self.work_team(idx)
        ref = self.ref(0)
        mkt = self.mkt.copy()
        W = self.W.copy()
        for b in range(months):
            moy = (b % 12) + 1
            mkt = p.mkt_rho * mkt + p.mkt_sigma * rng.standard_normal(5)
            W = p.w_rho * W + (1 - p.w_rho) * (self.team_wbar + np.asarray(C.WORKLOAD_SEASON)[self.team_fam, moy - 1]) \
                + p.w_sigma * rng.standard_normal(self.n_teams)
            S["tenure_m"] = S["tenure_m"] + 1
            L.engagement_update(S, dict(ref=ref, mkt=mkt[S["fam"]], W=W[team]), p, rng, oracle=False)
            S["tenure_m"] = S["tenure_m"] - 1
            reset = S["D"] > S["H"]
            S["D"][reset] = 0.0
            S["E"][reset] = S["mu"][reset]
        for k in ("E", "D", "P", "B", "perf_dev", "ot1", "ot2", "ot3"):
            self.F[k][idx] = S[k]
        self.mkt, self.W = mkt, W

    # ------------------------------------------------------------------ embauches
    def _pick_contract(self, grade):
        F = self.F
        alive = F["alive"][: self.n]
        ct = F["ctype"][: self.n][alive]
        tot = max(len(ct), 1)
        tgt = C.CONTRACT_TARGET
        base = dict(zip((L.CT_CDI, L.CT_CDD, L.CT_SIVP), self.p.hire_mix))
        names = {L.CT_CDI: "CDI", L.CT_CDD: "CDD", L.CT_SIVP: "SIVP"}
        types, w = [], []
        for c, b in base.items():
            if c == L.CT_SIVP and grade > 3:
                continue
            share = (ct == c).sum() / tot
            t = tgt[names[c]]
            types.append(c)
            w.append(b * np.exp(np.clip(self.p.hire_gain * (t - share) / t, -5, 5)))
        w = np.array(w)
        return types[self.rng.choice(len(types), p=w / w.sum())]

    def hire(self, team, role, grade, ctype, day, manages=-1, dept=None, fam=None):
        rng, F, p = self.rng, self.F, self.p
        e = int(self._alloc(1)[0])
        dept = int(self.team_dept[team]) if dept is None else dept
        fam = int(self.team_fam[team if team >= 0 else manages]) if fam is None else fam
        F["dept"][e], F["fam"][e], F["team"][e], F["manages"][e] = dept, fam, team, manages
        F["role"][e], F["grade"][e], F["ctype"][e] = role, grade, ctype
        if role == O.ROLE_HEAD:
            age = rng.uniform(42, 55)
        elif role == O.ROLE_MID:
            age = rng.uniform(36, 52)
        elif role == O.ROLE_LEAD:
            age = rng.uniform(30, 48)
        elif ctype == L.CT_STAGE:
            age = rng.uniform(21, 25)
        elif ctype == L.CT_SIVP:
            age = rng.uniform(23, 29)
        elif ctype == L.CT_CDD:
            age = 23 + rng.gamma(2, 3) + 1.2 * (grade - 1)
        else:
            age = 25 + rng.gamma(2, 4) + 1.5 * (grade - 1)
        age = min(age, 55)
        sex = np.array([F_ if rng.random() < (C.FEMALE_SHARE[fam] if role < O.ROLE_MID else 0.25) else M_], np.int8)
        self._identity(np.array([e]), sex, rng)
        F["hire"][e] = day
        F["birth"][e] = day - int(age * 365.25) - int(rng.integers(0, 365))
        F["marital"][e] = self._marital_for(np.array([age]), rng)[0]
        F["age_m"][e] = int((np.int64(day).astype("datetime64[D]").astype("datetime64[M]")
                             - np.int64(F["birth"][e]).astype("datetime64[D]").astype("datetime64[M]")).astype(np.int64))
        F["tenure_m"][e] = 0
        m = int(self.month_of(day))
        ref = self.ref(min(m, self.T - 1))
        base = ref[fam, grade] * np.exp(rng.normal(0.02, 0.07))
        if ctype == L.CT_SIVP:
            base *= C.SIVP_PAY
        F["salary"][e] = base if ctype == L.CT_STAGE else max(base, C.SALARY_FLOOR)
        F["stipend"][e] = round(rng.uniform(*C.STAGE_STIPEND)) if ctype == L.CT_STAGE else 0.0
        F["E"][e] = F["mu"][e] + rng.normal(0.2, 0.3)
        F["D"][e] = 0.0
        F["pbase"][e] = rng.normal(-0.1, 1.0)
        F["alive"][e] = True
        F["was_mgr"][e] = manages >= 0
        F["title"][e] = O.manager_title(dept, fam, role) if manages >= 0 else O.staff_title(rng, dept, fam, grade)
        self._set_ot_elig(np.array([e]))
        if ctype == L.CT_CDI:
            end = -1
        else:
            dur = {L.CT_CDD: int(rng.integers(12, 25)), L.CT_SIVP: 12, L.CT_STAGE: int(rng.integers(4, 7))}[ctype]
            end = int(add_months(day, dur)) - 1
        F["cend"][e] = end
        F["cend_m"][e] = BIG if end < 0 else int(self.month_of(end))
        self.contracts.append((e, ctype, day, end))
        self._assign_mats([e])
        if manages >= 0:
            self.team_manager[manages] = e
        if m <= self.stepped_m:
            self._panel_one(e, m)
        return e

    def _panel_one(self, e, m):
        F, P = self.F, self.panel
        P["E"][e, m], P["sal"][e, m], P["team"][e, m] = F["E"][e], F["salary"][e], F["team"][e]
        P["ct"][e, m], P["grade"][e, m], P["mq"][e, m] = F["ctype"][e], F["grade"][e], self.mq_of(np.array([e]))[0]

    def _add_vacancy(self, team, grade, after, m_exit, stage=False):
        delay = int(self.rng.choice([1, 2, 3], p=[0.5, 0.35, 0.15]))
        if not stage:
            u = self.rng.random()
            grade = max(1, grade - (2 if u < 0.1 else 1 if u < 0.45 else 0))
        self.vacancies.append(dict(team=int(team), grade=int(grade), after=int(after), fill_m=m_exit + delay, stage=stage))

    def _hire_due(self, m):
        F, rng = self.F, self.rng
        alive = F["alive"][: self.n]
        n_alive = alive.sum()
        n_stage = (alive & (F["ctype"][: self.n] == L.CT_STAGE)).sum()
        pending = sum(1 for v in self.vacancies if v["stage"])
        leafs = np.nonzero(self.team_level == 2)[0]
        for _ in range(int(round(C.CONTRACT_TARGET["STAGE"] * n_alive)) - n_stage - pending):
            self.vacancies.append(dict(team=int(rng.choice(leafs)), grade=1, after=int(self.mstart[m]) - 1, fill_m=m, stage=True))
        keep = []
        for v in self.vacancies:
            if v["fill_m"] != m:
                keep.append(v)
                continue
            day = self.cal.random_wd(rng, m, after=v["after"])
            if day is None:
                v["fill_m"] += 1
                keep.append(v)
                continue
            ct = L.CT_STAGE if v["stage"] else self._pick_contract(v["grade"])
            grade = v["grade"] if ct not in (L.CT_SIVP, L.CT_STAGE) else min(v["grade"], 2 if ct == L.CT_SIVP else 1)
            self.hire(v["team"], O.ROLE_STAFF, grade, ct, day)
        self.vacancies = keep

    # ------------------------------------------------------------------ mois
    def run(self):
        for m in range(self.T):
            self._month(m)
        self._finalize()
        return self

    def _month(self, m):
        p, rng, F = self.p, self.rng, self.F
        moy = int(self.moy[m])
        self.mkt = p.mkt_rho * self.mkt + p.mkt_sigma * rng.standard_normal(5)
        season = np.asarray(C.WORKLOAD_SEASON)[self.team_fam, moy - 1]
        self.W = p.w_rho * self.W + (1 - p.w_rho) * (self.team_wbar + season) + p.w_sigma * rng.standard_normal(self.n_teams)
        ref = self.ref(m)
        self._hire_due(m)
        idx = np.nonzero(F["alive"][: self.n])[0]
        S = {k: F[k][idx].copy() for k in L.KEYS}
        S["mq"] = self.mq_of(idx)
        env = dict(ref=ref, mkt=self.mkt[S["fam"]], W=self.W[self.work_team(idx)])
        ev = L.step(S, env, p, rng, m, moy, oracle=False)
        for k in L.KEYS:
            F[k][idx] = S[k]
        self.stepped_m = m
        self._apply_events(m, idx, S, ev)
        self._life_events(m, idx)
        self._org_moves(m, idx)
        P = self.panel
        P["E"][idx, m], P["P"][idx, m], P["O"][idx, m] = F["E"][idx], F["P"][idx], ev["O"]
        P["sal"][idx, m], P["team"][idx, m], P["mq"][idx, m] = F["salary"][idx], F["team"][idx], S["mq"]
        P["mkt"][idx, m], P["ct"][idx, m], P["grade"][idx, m] = env["mkt"], F["ctype"][idx], F["grade"][idx]
        self.team_manager_panel[:, m] = self.team_manager
        self._close_month(m)
        if self.oracle_on and m in self.oracle_months:
            self._oracle(m)

    def _apply_events(self, m, idx, S, ev):
        F, rng, p = self.F, self.rng, self.p
        ms, me = int(self.mstart[m]), int(self.mend[m])
        changed = np.nonzero(np.abs(F["salary"][idx] - ev["sal0"]) > 0.005)[0]
        lag = (5, 45) if self.moy[m] == 1 else (0, 30)
        for i in changed:
            self._event(idx[i], ms, "AUGMENTATION", f"{ev['sal0'][i]:.3f}", f"{F['salary'][idx[i]]:.3f}", lag)
        for i in np.nonzero(ev["promoted"])[0]:
            e = idx[i]
            g = int(F["grade"][e])
            self._event(e, ms, "PROMOTION", f"G{g - 1}", f"G{g}", (0, 30))
            if F["manages"][e] < 0 and O.BAND[g] != O.BAND[g - 1]:
                old = F["title"][e]
                F["title"][e] = O.staff_title(rng, F["dept"][e], F["fam"][e], g)
                self._event(e, ms, "CHANGEMENT_POSTE", old, F["title"][e], (0, 30))
            self._set_ot_elig(np.array([e]))
        for i in np.nonzero(ev["score"] > 0)[0]:
            d = self.cal.random_wd(rng, m)
            self.evals.append((idx[i], d, int(ev["score"][i]), d + int(rng.integers(30, 121))))
        trig = idx[ev["trig"]]
        F["trig_m"][trig] = m
        F["E_trig"][trig] = F["E"][trig]
        for e in idx[ev["post_now"]]:
            d = self.cal.random_wd(rng, m)
            F["post_m"][e], F["post_day"][e] = m, d
            exit_d = int(add_months(d, 1))
            if F["ctype"][e] != L.CT_CDI and F["cend"][e] >= d:
                exit_d = min(exit_d, int(F["cend"][e]))
            F["exit_day"][e] = exit_d
            ab = bool(F["abandon"][e])
            F["exit_reason"][e] = L.R_ABANDON if ab else L.R_DEM
            F["resign_kept"][e] = (not ab) and rng.random() >= p.resignation_blank
        for i in np.nonzero(ev["exit"] > 0)[0]:
            e, r = idx[i], int(ev["exit"][i])
            if r in (L.R_FIN_CDD, L.R_AUTRE):
                d = int(F["cend"][e])
            elif r in (L.R_RETRAITE, L.R_MUTATION):
                d = me
            elif r == L.R_DECES:
                d = ms + int(rng.integers(0, me - ms + 1))
            else:
                d = self.cal.random_wd(rng, m)
            F["exit_day"][e], F["exit_reason"][e] = d, r
        for i in np.nonzero(ev["renew"])[0]:
            e = idx[i]
            start = int(F["cend"][e]) + 1
            nt = int(ev["new_type"][i])
            end = -1 if nt == L.CT_CDI else int(add_months(start, int(ev["new_dur"][i]))) - 1
            self.contracts.append((e, nt, start, end))
            F["cend"][e] = end
            F["cend_m"][e] = BIG if end < 0 else int(self.month_of(end))
            self._set_ot_elig(np.array([e]))
        for i in np.nonzero(ev["stage_convert"])[0]:
            self._stage_end(idx[i], m)

    def _stage_end(self, e, m):
        F, rng = self.F, self.rng
        end = int(F["cend"][e])
        dept = F["dept"][e]
        opts = [j for j, v in enumerate(self.vacancies)
                if not v["stage"] and v["fill_m"] >= m and v["grade"] <= 3 and self.team_dept[v["team"]] == dept]
        if not opts or rng.random() > 0.6:
            F["exit_day"][e], F["exit_reason"][e] = end, L.R_AUTRE
            return
        v = self.vacancies.pop(opts[rng.integers(len(opts))])
        start = end + 1
        nt = L.CT_SIVP if rng.random() < 0.6 else L.CT_CDD
        dur = 12 if nt == L.CT_SIVP else int(rng.integers(12, 25))
        new_end = int(add_months(start, dur)) - 1
        self.contracts.append((e, nt, start, new_end))
        old_mgr = self.manager_of(np.array([e]))[0]
        F["team"][e] = v["team"]
        F["fam"][e] = self.team_fam[v["team"]]
        new_mgr = self.manager_of(np.array([e]))[0]
        if new_mgr != old_mgr:
            self._event(e, start, "CHANGEMENT_MANAGER", self.mat(old_mgr), self.mat(new_mgr))
        g = min(v["grade"], 2)
        F["grade"][e], F["ctype"][e], F["cend"][e], F["n_renew"][e] = g, nt, new_end, 0
        F["cend_m"][e] = int(self.month_of(new_end))
        ref = self.ref(min(int(self.month_of(start)), self.T - 1))
        F["salary"][e] = max(ref[F["fam"][e], g] * (C.SIVP_PAY if nt == L.CT_SIVP else 0.97), C.SALARY_FLOOR)
        old_title = F["title"][e]
        F["title"][e] = O.staff_title(rng, F["dept"][e], F["fam"][e], g)
        if F["title"][e] != old_title:
            self._event(e, start, "CHANGEMENT_POSTE", old_title, F["title"][e])
        self._set_ot_elig(np.array([e]))

    def _life_events(self, m, idx):
        F, rng = self.F, self.rng
        n = len(idx)
        age = F["age_m"][idx] / 12
        mar, sex = F["marital"][idx], F["sex"][idx]
        u = rng.random((6, n))
        wed = (mar == 0) & (age >= 23) & (age <= 40) & (u[0] < 0.07 / 12)
        since = m - F["last_birth_m"][idx]
        mat = (mar == 1) & (sex == F_) & (age >= 23) & (age <= 42) & (since >= 18) & (u[1] < 0.09 / 12)
        pat = (mar == 1) & (sex == M_) & (age >= 24) & (age <= 50) & (since >= 12) & (u[2] < 0.07 / 12)
        grief = u[3] < 0.15 / 12
        div = (mar == 1) & (u[4] < 0.004 / 12)
        wid = (mar == 1) & (age > 50) & (u[5] < 0.003 / 12)
        F["marital"][idx[wed]] = 1
        F["marital"][idx[div]] = 2
        F["marital"][idx[wid]] = 3
        F["last_birth_m"][idx[mat | pat]] = m
        for sel, cat, k in ((wed, "AUTRE", 3), (pat, "AUTRE", 2), (grief, "AUTRE", 2)):
            for e in idx[sel]:
                self.life.append((int(e), self.cal.random_wd(rng, m), cat, k))
        for e in idx[mat]:
            self.life.append((int(e), int(self.mstart[m]) + int(rng.integers(0, 28)), "MATERNITE", 30))

    def _move(self, e, v, day, m):
        F = self.F
        old_team, old_dept = int(F["team"][e]), int(F["dept"][e])
        old_mgr = self.manager_of(np.array([e]))[0]
        F["team"][e] = v["team"]
        F["dept"][e] = self.team_dept[v["team"]]
        new_mgr = self.manager_of(np.array([e]))[0]
        if F["dept"][e] != old_dept:
            self._event(e, day, "MUTATION", O.DEPT_CODES[old_dept], O.DEPT_CODES[F["dept"][e]])
        if new_mgr != old_mgr:
            self._event(e, day, "CHANGEMENT_MANAGER", self.mat(old_mgr), self.mat(new_mgr))
        self._add_vacancy(old_team, int(F["grade"][e]), day, m)

    def _org_moves(self, m, idx):
        F, rng = self.F, self.rng
        ok = ((F["role"][idx] == O.ROLE_STAFF) & (F["ctype"][idx] != L.CT_STAGE) & ~F["posted"][idx]
              & (F["post_in"][idx] < 0) & (F["tenure_m"][idx] >= 12) & (F["exit_day"][idx] < 0))
        u = rng.random((3, len(idx)))
        for kind, sel in (("MUT", ok & (u[0] < 0.008 / 12)), ("TRANS", ok & (u[1] < 0.01 / 12))):
            for e in idx[sel]:
                dept, fam = F["dept"][e], F["fam"][e]
                opts = [j for j, v in enumerate(self.vacancies)
                        if not v["stage"] and v["fill_m"] > m and self.team_fam[v["team"]] == fam
                        and v["team"] != F["team"][e]
                        and ((self.team_dept[v["team"]] != dept) if kind == "MUT" else (self.team_dept[v["team"]] == dept))]
                if not opts:
                    continue
                v = self.vacancies.pop(opts[rng.integers(len(opts))])
                self._move(e, v, self.cal.random_wd(rng, m), m)
        for e in idx[ok & (u[2] < 0.015 / 12)]:
            old = F["title"][e]
            new = O.staff_title(rng, F["dept"][e], F["fam"][e], F["grade"][e], avoid=old)
            if new != old:
                F["title"][e] = new
                F["B"][e] += 0.25
                self._event(e, self.cal.random_wd(rng, m), "CHANGEMENT_POSTE", old, new)

    def _close_month(self, m):
        F = self.F
        me = int(self.mend[m])
        alive = np.nonzero(F["alive"][: self.n])[0]
        ex = alive[(F["exit_day"][alive] >= 0) & (F["exit_day"][alive] <= me)]
        ex = ex[np.argsort(F["exit_day"][ex], kind="stable")]
        if len(ex) == 0:
            return
        F["mgr_exit"][ex] = self.manager_of(ex)
        F["alive"][ex] = False
        for e in ex:
            d = int(F["exit_day"][e])
            t = int(F["manages"][e])
            if t >= 0:
                if d + 1 <= self.end_day:
                    F["manages"][e] = -1
                    self._succession(t, d + 1, m, int(e))
            elif F["ctype"][e] != L.CT_STAGE:
                self._add_vacancy(F["team"][e], int(F["grade"][e]), d, m)

    def _succession(self, t, day, m, old):
        F, rng = self.F, self.rng
        level = int(self.team_level[t])
        role = O.LEVEL_ROLE[level]
        parent = int(self.team_parent[t])
        alive = np.nonzero(F["alive"][: self.n])[0]
        members = alive[F["team"][alive] == t]
        free = members[~F["posted"][members] & (F["post_in"][members] < 0) & (F["ctype"][members] == L.CT_CDI)
                       & (F["exit_day"][members] < 0)]
        if level == 2:
            cands = free[(F["role"][free] == O.ROLE_STAFF) & (F["grade"][free] >= 3) & (F["tenure_m"][free] >= 24)]
        else:
            cands = free[(F["manages"][free] >= 0) & (F["grade"][free] >= 5)]
        if len(cands) and rng.random() < 0.6:
            sc = F["grade"][cands] + F["pbase"][cands] + F["perf_dev"][cands] + rng.normal(0, 0.5, len(cands))
            c = int(cands[np.argmax(sc)])
            sub = int(F["manages"][c])
            old_grade = int(F["grade"][c])
            F["team"][c], F["manages"][c], F["role"][c], F["was_mgr"][c] = parent, t, role, True
            F["fam"][c] = self.team_fam[t]
            g = max(old_grade, int(O.ROLE_MIN_GRADE[role]))
            if g == old_grade and sub < 0 and rng.random() < 0.5:
                g = min(g + 1, int(L.MAX_GRADE_ROLE[role]))
            if g > old_grade:
                F["grade"][c], F["m_prom"][c] = g, 0
                F["B"][c] += self.p.prom_boost
                self._event(c, day, "PROMOTION", f"G{old_grade}", f"G{g}", (0, 30))
            ref = self.ref(min(int(self.month_of(day)), self.T - 1))
            old_sal = F["salary"][c]
            F["salary"][c] = max(old_sal * rng.uniform(1.06, 1.12), ref[F["fam"][c], g] * 0.97)
            self._event(c, day, "AUGMENTATION", f"{old_sal:.3f}", f"{F['salary'][c]:.3f}", (0, 30))
            old_title = F["title"][c]
            F["title"][c] = O.manager_title(F["dept"][c], F["fam"][c], role)
            if F["title"][c] != old_title:
                self._event(c, day, "CHANGEMENT_POSTE", old_title, F["title"][c], (0, 30))
            self._set_ot_elig(np.array([c]))
            self.team_manager[t] = c
            if parent >= 0:
                self._event(c, day, "CHANGEMENT_MANAGER", self.mat(old), self.mat(self.team_manager[parent]))
            if sub >= 0:
                self._succession(sub, day, m, c)
            else:
                self._add_vacancy(t, old_grade, day, m)
            new = c
        else:
            g = min(int(O.ROLE_MIN_GRADE[role]) + int(rng.random() < 0.4), int(L.MAX_GRADE_ROLE[role]))
            new = self.hire(parent, role, g, L.CT_CDI, day, manages=t, dept=int(self.team_dept[t]),
                            fam=int(self.team_fam[t]))
        alive = np.nonzero(F["alive"][: self.n])[0]
        for mb in alive[(F["team"][alive] == t) & (alive != new)]:
            if F["hire"][mb] < day:
                self._event(mb, day, "CHANGEMENT_MANAGER", self.mat(old), self.mat(new))

    # ------------------------------------------------------------------ oracle
    def _oracle(self, m):
        """Vraie probabilité de démission dans ]t, t+6 mois] par continuations Monte-Carlo de l'état latent."""
        F, p, R, rng = self.F, self.p, self.reps, self.rng_oracle
        alive = np.nonzero(F["alive"][: self.n])[0]
        pop = alive[F["ctype"][alive] != L.CT_STAGE]
        sim = pop[~F["posted"][pop]]
        n = len(sim)
        prob = np.zeros(len(pop))
        if n:
            S = {k: np.tile(F[k][sim], R) for k in L.KEYS}
            S["mq"] = np.tile(self.mq_of(sim), R)
            fam_t = np.tile(F["fam"][sim], R)
            team_t = np.tile(self.work_team(sim), R)
            rep = np.repeat(np.arange(R), n)
            mkt = np.tile(self.mkt, (R, 1))
            W = np.tile(self.W, (R, 1))
            hit = np.zeros(R * n, bool)
            live = np.ones(R * n, bool)
            season = np.asarray(C.WORKLOAD_SEASON)
            for k in range(1, 7):
                mm = m + k
                moy = int((self.moy[m] + k - 1) % 12 + 1)
                mkt = p.mkt_rho * mkt + p.mkt_sigma * rng.standard_normal((R, 5))
                W = (p.w_rho * W + (1 - p.w_rho) * (self.team_wbar + season[self.team_fam, moy - 1])
                     + p.w_sigma * rng.standard_normal((R, self.n_teams)))
                env = dict(ref=self.ref(mm), mkt=mkt[rep, fam_t], W=W[rep, team_t])
                ev = L.step(S, env, p, rng, mm, moy, oracle=True)
                hit |= ev["post_now"] & live
                live &= ~ev["post_now"] & (ev["exit"] == 0)
            prob[np.isin(pop, sim)] = hit.reshape(R, n).mean(0)
        t = int(self.mend[m])
        t6 = int(add_months(t, 6))
        eligible = ((F["hire"][pop] <= int(add_months(t, -1)))
                    & ((F["ctype"][pop] == L.CT_CDI) | ((F["ctype"][pop] == L.CT_CDD) & (F["cend"][pop] > t6)))
                    & (add_years(F["birth"][pop], 60) > t6) & ~F["posted"][pop])
        self.oracle_rows.append((m, pop.copy(), prob, eligible))

    def _finalize(self):
        F = self.F
        rows = []
        for m, pop, prob, elig in self.oracle_rows:
            t = int(self.mend[m])
            t6 = int(add_months(t, 6))
            pd = F["post_day"][pop]
            vol = np.isin(F["exit_reason"][pop], (L.R_DEM, L.R_ABANDON))
            y = (pd > t) & (pd <= t6) & vol
            rows.append(dict(m=m, e=pop, prob=prob, eligible=elig, y6=y, complete=t6 <= self.end_day))
        self.oracle_table = rows

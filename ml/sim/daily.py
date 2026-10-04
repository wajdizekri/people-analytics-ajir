"""Absences et pointages quotidiens : matrices salarié x jour ouvré, traitées par blocs de salariés."""
import numpy as np

from . import latent as L

CATS = ["", "MATERNITE", "MALADIE", "CONGE_ANNUEL", "CONGE_SANS_SOLDE", "ABSENCE_INJUSTIFIEE", "AUTRE"]
C_MAT, C_MAL, C_CA, C_CSS, C_INJ, C_AUT = range(1, 7)
HEALTH = (C_MAT, C_MAL)

SICK_BASE = 0.16  # épisodes de maladie par salarié et par mois (avant saison et fragilité)
SICK_SEASON = np.array([1.5, 1.5, 1.1, 0.9, 0.8, 0.6, 0.6, 0.6, 0.9, 1.0, 1.1, 1.5])
SICK_LEN = (np.array([1, 2, 3, 4, 5, 7, 10, 15, 21, 30]), np.array([.33, .25, .15, .08, .05, .05, .04, .02, .02, .01]))
LEAVE_Q = np.array([.45, .40, .45, .50, .50, .50, .10, .10, .50, .45, .40, .65])  # petits blocs de congé par mois
SHORT_LEN = (np.array([1, 2, 3, 4, 5]), np.array([.3, .3, .2, .1, .1]))
BRIDGE_P = 0.4
INJ_BASE = 0.05  # absences injustifiées par mois (engagement moyen)
CSS_BASE = 0.012  # congés sans solde par mois
NOBADGE_BASE = 0.003
OT_CHUNKS = (np.array([60, 90, 120, 150, 180]), np.array([.3, .3, .2, .1, .1]))
ABS_LAG = {C_CA: (0, 3), C_MAL: (1, 12), C_MAT: (3, 15), C_CSS: (0, 8), C_INJ: (2, 15), C_AUT: (0, 8)}


def signal_matrix(sim) -> np.ndarray:
    """Intensité des signaux faibles par salarié et mois : phase de départ (1-3 mois) puis préavis."""
    F, T, n, p = sim.F, sim.T, sim.n, sim.p
    trig, post, mech = F["trig_m"][:n], F["post_m"][:n], F["mech"][:n]
    exit_m = np.where(F["exit_day"][:n] >= 0, sim.month_of(np.maximum(F["exit_day"][:n], 0)), 10**6)
    months = np.arange(T)[None, :]
    last = np.where(post >= 0, post, np.where(trig >= 0, np.minimum(trig + 2, exit_m), -1))
    phase = (trig[:, None] >= 0) & (months >= trig[:, None]) & (months <= last[:, None])
    sig = np.where(phase, np.asarray(p.signal_amp)[mech][:, None], 0.0)
    notice = (post[:, None] >= 0) & (months > post[:, None]) & (months <= exit_m[:, None])
    return np.where(notice, p.signal_notice, sig).astype(np.float32)


def _cover(n, W, rows, starts, durs):
    diff = np.zeros((n, W + 1), np.int32)
    np.add.at(diff, (rows, starts), 1)
    np.add.at(diff, (rows, np.minimum(starts + durs, W)), -1)
    return np.cumsum(diff[:, :W], axis=1) > 0


def _draw(rng, spec, k):
    return rng.choice(spec[0], size=k, p=spec[1])


def generate(sim, plan, sink):
    """Génère absences et pointages ; appelle sink(chunk) par bloc. Renvoie les agrégats mensuels."""
    rng, cal, F, P = sim.rng_daily, sim.cal, sim.F, sim.panel
    W, T, n_all = cal.n_wd, sim.T, sim.n
    wdm = cal.wd_month
    nwd = cal.wd_count[wdm].astype(float)
    sig_all = signal_matrix(sim)
    emp = np.nonzero(F["hire"][:n_all] <= sim.end_day)[0]
    agg = dict(ot=np.zeros((n_all, T), np.int32), unpaid=np.zeros((n_all, T), np.int16),
               expected=np.zeros((n_all, T), np.int16), absdays=np.zeros((7, n_all, T), np.int16),
               nobadge=np.zeros((n_all, T), np.int16), late=np.zeros((n_all, T), np.int16))
    life = {}
    for e, day, cat, k in sim.life:
        life.setdefault(e, []).append((day, cat, k))
    inj_days = np.zeros(len(plan.rows), np.int64)
    J = np.arange(W)
    season_col = SICK_SEASON[cal.wd_moy - 1]
    years = sorted(set(sim.month_str.astype("U4")))
    chunk = max(100, int(2_000_000 // max(W, 1)))
    for c0 in range(0, len(emp), chunk):
        e = emp[c0:c0 + chunk]
        n = len(e)
        first = cal.wd_index(F["hire"][e], "left")
        exit_d = np.where(F["exit_day"][e] >= 0, F["exit_day"][e], sim.end_day + 10**5)
        last_exp = cal.wd_index(exit_d, "right") - 1
        ab = (F["exit_reason"][e] == L.R_ABANDON) & (F["post_day"][e] >= 0)
        last_pres = np.where(ab, cal.wd_index(np.maximum(F["post_day"][e], 0), "left") - 1, last_exp)
        expected = (J >= first[:, None]) & (J <= last_exp[:, None])
        can = expected & (J <= last_pres[:, None])
        Em = P["E"][e][:, wdm]
        Pm = np.minimum(P["P"][e][:, wdm], 0)
        sig = sig_all[e][:, wdm]
        ct = P["ct"][e][:, wdm]

        age = (sim.start_day + (sim.end_day - sim.start_day) / 2 - F["birth"][e]) / 365.25
        agef = np.clip(1 + 0.015 * (age - 35), 0.7, 1.5)
        p_sick = SICK_BASE * season_col[None, :] / nwd[None, :] * F["frailty"][e][:, None] * agef[:, None]
        r, c = np.nonzero((rng.random((n, W)) < p_sick) & can)
        mal = _cover(n, W, r, c, _draw(rng, SICK_LEN, len(r)))

        hire_m = sim.month_of(F["hire"][e])
        tf = np.clip((np.arange(T)[None, :] - hire_m[:, None]) / 6, 0, 1)
        q = LEAVE_Q[sim.moy - 1][None, :] * tf
        r, m = np.nonzero(rng.random((n, T)) < q)
        starts = cal.wd_first[m] + np.floor(rng.random(len(r)) * cal.wd_count[m]).astype(int)
        rows, st, du = [r], [starts], [_draw(rng, SHORT_LEN, len(r))]
        for y in years:
            ms = [i for i, s in enumerate(sim.month_str) if s.startswith(y)]
            mo = {int(s[5:7]): i for i, s in zip(ms, sim.month_str[ms])}
            u = rng.random(n)
            take = u < 0.85
            month = np.where(rng.random(n) < 0.5, 7, 8)
            month = np.where(rng.random(n) < 0.1, rng.integers(1, 13, n), month)
            mi = np.array([mo.get(int(x), -1) for x in month])
            ok = take & (mi >= 0)
            rr = np.nonzero(ok)[0]
            mm = mi[ok]
            s0 = cal.wd_first[mm] + np.floor(rng.random(len(rr)) * cal.wd_count[mm]).astype(int)
            rows.append(rr), st.append(s0), du.append(rng.integers(6, 13, len(rr)))
        posted = np.nonzero((F["post_day"][e] >= 0) & (F["exit_day"][e] <= sim.end_day) & ~ab
                            & (rng.random(n) < 0.45))[0]
        k = rng.integers(3, 11, len(posted))
        rows.append(posted), st.append(np.maximum(last_exp[posted] - k + 1, 0)), du.append(k)
        rows, st, du = np.concatenate(rows), np.concatenate(st), np.concatenate(du)
        ca = _cover(n, W, rows, st, du) | (cal.wd_bridge[None, :] & (rng.random((n, W)) < BRIDGE_P))
        ca &= ct != L.CT_STAGE

        p_inj = INJ_BASE / nwd * np.exp(-0.6 * Em) * (1 + 3 * sig) * (1 - 0.6 * Pm)
        r, c = np.nonzero((rng.random((n, W)) < p_inj) & can)
        inj = _cover(n, W, r, c, np.where(rng.random(len(r)) < 0.85, 1, 2))
        p_css = CSS_BASE / nwd * np.exp(-0.4 * Em) * (1 - 1.2 * Pm) * (1 + 1.5 * sig)
        r, c = np.nonzero((rng.random((n, W)) < p_css) & can)
        css = _cover(n, W, r, c, rng.integers(1, 6, len(r)))
        r, c = np.nonzero((rng.random((n, W)) < 0.3 * sig / nwd) & can)
        rows_a, st_a, du_a = [r], [c], [np.ones(len(r), int)]
        rows_m, st_m, du_m = [], [], []
        for i, ee in enumerate(e):
            for day, cat, k in life.get(int(ee), ()):
                s = int(cal.wd_index(day))
                if s >= W:
                    continue
                if cat == "MATERNITE":
                    rows_m.append(i), st_m.append(s), du_m.append(max(int(cal.wd_index(day + k)) - s, 1))
                else:
                    rows_a.append([i]), st_a.append([s]), du_a.append([k])
        aut = _cover(n, W, np.concatenate([np.atleast_1d(x) for x in rows_a]).astype(int),
                     np.concatenate([np.atleast_1d(x) for x in st_a]).astype(int),
                     np.concatenate([np.atleast_1d(x) for x in du_a]).astype(int))
        mat = _cover(n, W, np.array(rows_m, int), np.array(st_m, int), np.array(du_m, int))

        cat = np.zeros((n, W), np.int8)
        for code, mask in ((C_MAT, mat), (C_MAL, mal), (C_CA, ca), (C_CSS, css), (C_INJ, inj), (C_AUT, aut)):
            cat[(cat == 0) & mask & can] = code

        arow = np.full((n, W), -1, np.int32)
        acat = np.zeros((n, W), np.int8)
        pos = {int(x): i for i, x in enumerate(e)}
        for ee, s, d, cc, rid in plan.episodes_for(e):
            i = pos[ee]
            arow[i, s:s + d] = rid
            acat[i, s:s + d] = cc
        injm = (arow >= 0) & (cat == 0) & can
        cat[injm] = acat[injm]
        if injm.any():
            inj_days += np.bincount(arow[injm], minlength=len(plan.rows))

        p_nb = NOBADGE_BASE + 0.02 * sig + 0.004 * (Em < -1)
        nobadge = expected & (cat == 0) & (~can | (rng.random((n, W)) < p_nb))
        present = expected & (cat == 0) & ~nobadge

        episodes = []
        for code in range(1, 7):
            M = cat == code
            if not M.any():
                continue
            s_mask = M & ~np.concatenate([np.zeros((n, 1), bool), M[:, :-1]], axis=1)
            e_mask = M & ~np.concatenate([M[:, 1:], np.zeros((n, 1), bool)], axis=1)
            rs, cs = np.nonzero(s_mask)
            _, ce = np.nonzero(e_mask)
            lo, hi = ABS_LAG[code]
            end_days = cal.wd_days[ce]
            episodes.append(dict(e=e[rs], start=cal.wd_days[cs], end=end_days, days=ce - cs + 1,
                                 cat=np.full(len(rs), code, np.int8),
                                 recorded=end_days + rng.integers(lo, hi + 1, len(rs))))

        bounds = cal.wd_first
        agg["expected"][e] = np.add.reduceat(expected.astype(np.int32), bounds, axis=1)
        agg["nobadge"][e] = np.add.reduceat(nobadge.astype(np.int32), bounds, axis=1)
        for code in range(1, 7):
            agg["absdays"][code][e] = np.add.reduceat((cat == code).astype(np.int32), bounds, axis=1)
        agg["unpaid"][e] = agg["absdays"][C_CSS][e] + agg["absdays"][C_INJ][e]

        r, c = np.nonzero(present)
        k = len(r)
        mon = wdm[c]
        eg = e[r]
        sig_k = sig[r, c]
        late_evt = rng.random(k) < F["p_late"][eg] * (1 + 2 * sig_k)
        a = (F["arr_off"][eg] + F["arr_sd"][eg] * (1 + 0.8 * sig_k) * rng.standard_normal(k)
             + late_evt * rng.uniform(12, 50, k))
        s0 = cal.wd_start[c]
        check_in = s0 + np.maximum(np.rint(a), -45).astype(np.int64)
        late = np.where(check_in - s0 > 10, check_in - s0, 0)
        npres = np.bincount(r * T + mon, minlength=n * T).reshape(n, T)
        O = P["O"][e][r, mon]
        p_ot = np.clip(O * 60 / (np.maximum(npres[r, mon], 1) * 102), 0, 0.95)
        ot = np.where(rng.random(k) < p_ot, _draw(rng, OT_CHUNKS, k), 0)
        d_out = np.clip(np.rint(rng.normal(4, 6, k)), -15, 25).astype(np.int64)
        check_out = cal.wd_end[c] + d_out + ot
        worked = check_out - check_in - cal.wd_break[c]
        agg["ot"][e] = np.bincount(r * T + mon, weights=ot, minlength=n * T).reshape(n, T)
        agg["late"][e] = np.bincount(r * T + mon, weights=(late > 0), minlength=n * T).reshape(n, T)
        sink(dict(e=eg, day=cal.wd_days[c], check_in=check_in, check_out=check_out, worked=worked, ot=ot, late=late),
             episodes)
    plan.set_injected(inj_days)
    return agg

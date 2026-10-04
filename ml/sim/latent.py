"""Dynamique latente mensuelle, partagée par la simulation et par l'oracle Monte-Carlo.

Aucune sortie n'est tirée d'un logit des variables observées : la démission survient par
(a) une offre externe (Poisson par famille) acceptée selon l'engagement latent,
(b) le dépassement d'un seuil individuel d'insatisfaction cumulée (CUSUM de l'engagement),
(c) un événement personnel indépendant de tout le reste.
"""
import numpy as np

from . import config as C

CT_CDI, CT_CDD, CT_SIVP, CT_STAGE = 0, 1, 2, 3
CONTRACTS = ["CDI", "CDD", "SIVP", "STAGE"]
R_NONE, R_DEM, R_ABANDON, R_FIN_CDD, R_LIC, R_RETRAITE, R_DECES, R_MUTATION, R_AUTRE = range(9)
REASONS = ["", "DEMISSION", "ABANDON", "FIN_CDD", "LICENCIEMENT", "RETRAITE", "DECES", "MUTATION", "AUTRE"]
M_NONE, M_OFFRE, M_SEUIL, M_PERSO = range(4)
MECHANISMS = ["", "OFFRE_EXTERNE", "SEUIL_ENGAGEMENT", "EVENEMENT_PERSONNEL"]

GRADE_PROM = np.array([0, 1.3, 1.2, 1.0, 0.8, 0.5, 0.3, 0.2, 0.0])
MAX_GRADE_ROLE = np.array([6, 7, 7, 8])

KEYS = ("fam", "grade", "role", "ctype", "salary", "E", "D", "H", "mu", "P", "B", "mq", "perf_dev", "pbase",
        "m_prom", "ot_prop", "ot1", "ot2", "ot3", "age_m", "tenure_m", "cend_m", "n_renew", "post_in", "posted",
        "abandon", "mech", "last_score", "m_eval", "ot_elig")


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def engagement_update(S, env, p, rng, oracle: bool):
    """Heures sup, chocs, engagement et insatisfaction cumulée. Modifie S, renvoie les heures sup du mois."""
    n = S["E"].shape[0]
    S["perf_dev"] = 0.9 * S["perf_dev"] + 0.2 * rng.standard_normal(n)
    leaving = (S["post_in"] >= 0) | S["posted"]
    O = (S["ot_prop"] * np.exp(env["W"] + 0.3 * rng.standard_normal(n) - 0.045)
         * np.where(leaving, 0.45, 1.0) * np.exp(0.12 * np.clip(S["E"], -2, 2)))
    O = np.where(S["ot_elig"], np.minimum(O, 60.0), 0.0)
    S["ot3"], S["ot2"], S["ot1"] = S["ot2"], S["ot1"], O
    ot_avg = (S["ot1"] + S["ot2"] + S["ot3"]) / 3
    S["B"] = S["B"] * 0.85
    S["P"] = S["P"] * p.pshock_decay
    hit = rng.random(n) < p.pshock_rate / 12
    S["P"] = np.where(hit, S["P"] - rng.uniform(0.6, 1.6, n), S["P"])
    if oracle:
        change = rng.random(n) < p.mgr_change_rate
        S["mq"] = np.where(change, rng.standard_normal(n), S["mq"])
    compa = S["salary"] / env["ref"][S["fam"], S["grade"]]
    stag = np.minimum(np.maximum(S["m_prom"] - 36, 0) / 24, 2.0)
    over = np.maximum(ot_avg - p.ot_threshold, 0) / 10
    target = (S["mu"] + p.beta_compa * (compa - 1) - p.beta_stag * stag - p.beta_ot * over + p.beta_mgr * S["mq"]
              - p.beta_mkt * env["mkt"] + S["B"] + S["P"] + p.honeymoon * np.exp(-S["tenure_m"] / 4))
    S["E"] = p.phi * S["E"] + (1 - p.phi) * target + p.sigma_e * rng.standard_normal(n)
    S["D"] = np.maximum(0.0, p.cusum_decay * S["D"] + p.cusum_ref - S["E"])
    return O


def step(S, env, p, rng, m: int, moy: int, oracle: bool = False) -> dict:
    """Un mois de dynamique pour les individus de S (tableaux 1D). Renvoie les événements du mois."""
    n = S["E"].shape[0]
    for k in ("age_m", "tenure_m", "m_prom", "m_eval"):
        S[k] += 1
    waiting = S["post_in"] > 0
    S["post_in"] = np.where(waiting, S["post_in"] - 1, S["post_in"])
    active = ~S["posted"]
    stage = S["ctype"] == CT_STAGE
    regular = active & ~stage
    ref = env["ref"]
    sal0 = S["salary"].copy()

    if moy == 1:
        elig = regular & (S["tenure_m"] >= 4)
        pct = np.clip(2 + 1.5 * (S["last_score"] - 1) + rng.normal(0, 0.4, n), 2, 8) / 100
        S["salary"] = np.where(elig, S["salary"] * (1 + pct), S["salary"])
    promoted = np.zeros(n, bool)
    if moy in (1, 7):
        perf = S["pbase"] + S["perf_dev"]
        h = p.prom_rate * np.exp(0.7 * perf) * GRADE_PROM[S["grade"]] * (S["m_prom"] >= 18)
        promoted = regular & (S["grade"] < MAX_GRADE_ROLE[S["role"]]) & (rng.random(n) < h)
        if promoted.any():
            g = S["grade"][promoted] + 1
            S["grade"][promoted] = g
            new_ref = ref[S["fam"][promoted], g]
            k = int(promoted.sum())
            S["salary"][promoted] = np.maximum(S["salary"][promoted] * rng.uniform(1.06, 1.12, k),
                                               new_ref * 0.95 * np.exp(rng.normal(0, 0.04, k)))
            S["m_prom"][promoted] = 0
            S["B"][promoted] += p.prom_boost
    S["salary"] = np.where(stage, S["salary"], np.maximum(S["salary"], C.SALARY_FLOOR))

    score = np.zeros(n, np.int8)
    if moy == 12:
        elig = regular & (S["tenure_m"] >= 6)
        perf = S["pbase"] + S["perf_dev"]
        s = np.clip(np.rint(3.1 + 0.6 * perf + 0.25 * S["E"] + rng.normal(0, 0.5, n)), 1, 5).astype(np.int8)
        rec = elig & (rng.random(n) >= p.eval_missing)
        score[rec] = s[rec]
        S["last_score"] = np.where(rec, s, np.where(elig, 3, S["last_score"])).astype(np.int8)
        S["m_eval"] = np.where(elig, 0, S["m_eval"])

    O = engagement_update(S, env, p, rng, oracle)

    can = regular & (S["post_in"] < 0)
    age_y = S["age_m"] / 12
    lam = (np.asarray(p.offer_rate)[S["fam"]] * np.exp(p.offer_mkt * env["mkt"])
           * np.clip(np.exp(-0.04 * (age_y - 30)), 0.3, 2.0) * np.where(S["ctype"] == CT_CDI, 1.0, 1.4)) / 12
    pacc = sigmoid(p.accept_a - p.accept_b * S["E"])
    t_off = can & (rng.random(n) < 1 - np.exp(-lam * pacc))
    t_seuil = can & (S["D"] > S["H"])
    t_perso = can & (rng.random(n) < p.personal_exit_rate / 12)
    trig = t_off | t_seuil | t_perso
    mech_new = np.zeros(n, np.int8)
    if trig.any():
        mech_new[trig] = np.where(t_seuil, M_SEUIL, np.where(t_off, M_OFFRE, M_PERSO))[trig]
        u = rng.random(n)
        lead = np.zeros(n, np.int32)
        for mk in (M_OFFRE, M_SEUIL, M_PERSO):
            cp = np.cumsum(p.lead_p[mk - 1])
            sel = trig & (mech_new == mk)
            lead[sel] = np.searchsorted(cp, u[sel] * cp[-1], "right")
        S["post_in"] = np.where(trig, lead, S["post_in"])
        S["mech"] = np.where(trig, mech_new, S["mech"])
        ab_p = p.abandon_share * (S["grade"] <= 3) * np.where(S["E"] < -1, 2.0, 1.0) * 1.6
        S["abandon"] = np.where(trig, rng.random(n) < ab_p, S["abandon"])
    post_now = active & (S["post_in"] == 0)
    S["posted"] = S["posted"] | post_now
    S["post_in"] = np.where(post_now, -1, S["post_in"])

    cand = active & ~post_now
    exit_code = np.zeros(n, np.int8)
    mut = cand & ~stage & (rng.random(n) < p.ext_mutation_rate / 12)
    in_window = (S["m_eval"] >= 1) & (S["m_eval"] <= 6)
    lic_h = np.where(S["last_score"] == 1, p.dismiss_1, np.where(S["last_score"] == 2, p.dismiss_2, 0.0)) * in_window
    lic = cand & ~stage & (rng.random(n) < lic_h)
    ce = cand & (S["ctype"] != CT_CDI) & (S["cend_m"] == m)
    perf = S["pbase"] + S["perf_dev"]
    pexit = np.clip(np.asarray(p.contract_exit)[S["ctype"]] * np.exp(-0.5 * perf - 0.4 * S["E"])
                    * np.where(S["post_in"] >= 0, 4.0, 1.0), 0, 0.97)
    ce_exit = ce & (rng.random(n) < pexit)
    retire = cand & (S["age_m"] >= 720)
    death = cand & (rng.random(n) < 0.00006 * np.exp(0.075 * (age_y - 40)))
    exit_code[mut] = R_MUTATION
    exit_code[lic] = R_LIC
    exit_code[ce_exit] = np.where(stage[ce_exit], R_AUTRE, R_FIN_CDD)
    exit_code[retire] = R_RETRAITE
    exit_code[death] = R_DECES

    renew = ce & (exit_code == 0) & ~stage
    stage_convert = ce & (exit_code == 0) & stage
    new_type = np.full(n, -1, np.int8)
    new_dur = np.zeros(n, np.int32)
    if renew.any():
        u = rng.random(n)
        cdd = S["ctype"] == CT_CDD
        to_cdi = cdd & ((S["n_renew"] >= p.cdd_max_renew) | (u < p.cdd_to_cdi))
        new_type[renew & cdd] = np.where(to_cdi, CT_CDI, CT_CDD)[renew & cdd]
        sivp = renew & (S["ctype"] == CT_SIVP)
        v, w = rng.random(n), rng.random(n)
        new_type[sivp] = np.where((S["n_renew"] == 0) & (v < p.sivp_renew), CT_SIVP,
                                  np.where(w < p.sivp_to_cdd, CT_CDD, CT_CDI))[sivp]
        dur = np.where(new_type == CT_SIVP, 12, rng.integers(12, 25, n))
        new_dur = np.where(renew & (new_type != CT_CDI), dur, 0).astype(np.int32)
        same = new_type == S["ctype"]
        S["n_renew"] = np.where(renew, np.where(same, S["n_renew"] + 1, 0), S["n_renew"]).astype(np.int8)
        S["ctype"] = np.where(renew, new_type, S["ctype"]).astype(np.int8)
        S["cend_m"] = np.where(renew, np.where(new_type == CT_CDI, 10**6, m + new_dur), S["cend_m"])
    return dict(sal0=sal0, promoted=promoted, score=score, O=O, trig=trig, mech=mech_new, post_now=post_now,
                exit=exit_code, renew=renew, new_type=new_type, new_dur=new_dur, stage_convert=stage_convert)

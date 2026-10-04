"""Formations obligatoires (échéance) et facultatives ; statut photographié à la fin de période."""
import math

import numpy as np

from . import latent as L

MANDATORY = [("SST", "Santé et sécurité au travail", 7), ("INC", "Sécurité incendie et évacuation", 4),
             ("DATA", "Protection des données personnelles", 3), ("ETH", "Code de conduite et éthique", 3),
             ("ISO", "Système de management de la qualité ISO 9001", 6)]
ONBOARDING = ("ACC", "Parcours d'accueil et d'intégration", 7)
COMMON = [("FOR-EXCEL", "Excel avancé", 14), ("FOR-ANG", "Anglais professionnel", 30), ("FOR-COMM", "Communication interpersonnelle", 14),
          ("FOR-TEMPS", "Gestion du temps et des priorités", 7), ("FOR-CYBER", "Cybersécurité : bonnes pratiques", 4),
          ("FOR-FR", "Rédaction professionnelle", 14)]
BY_FAMILY = [
    [("FOR-PY", "Python pour l'analyse de données", 28), ("FOR-SCRUM", "Gestion de projet agile (Scrum)", 21), ("FOR-CLOUD", "Architecture cloud", 35)],
    [("FOR-IFRS", "Normes IFRS", 21), ("FOR-FISC", "Fiscalité tunisienne", 14), ("FOR-CDG", "Contrôle de gestion avancé", 21)],
    [("FOR-LEAN", "Lean manufacturing", 21), ("FOR-MAINT", "Maintenance préventive", 14), ("FOR-5S", "Méthode 5S", 7)],
    [("FOR-NEGO", "Négociation commerciale", 14), ("FOR-VENTE", "Techniques de vente", 14), ("FOR-CRM", "Gestion de la relation client", 7)],
    [("FOR-PAIE", "Législation sociale et paie", 14), ("FOR-ACCUEIL", "Accueil et qualité de service", 7), ("FOR-ARCH", "Archivage et GED", 7)],
]
MGMT = ("FOR-MGMT", "Management d'équipe", 21)


def _status(start, end, end_day, abandoned):
    if abandoned:
        return "ABANDONNEE", start if start <= end_day else -1, -1
    if end <= end_day:
        return "TERMINEE", start, end
    if start <= end_day:
        return "EN_COURS", start, -1
    return "PLANIFIEE", start, -1


def generate(sim):
    """Renvoie une liste de tuples (e, code, titre, obligatoire, début, fin, échéance, heures, statut) ; -1 = vide."""
    rng, F, P = sim.rng_train, sim.F, sim.panel
    end_day, start_day = sim.end_day, sim.start_day
    rows = []
    years = sorted({int(s[:4]) for s in sim.month_str})
    for e in np.nonzero(F["hire"][: sim.n] <= end_day)[0]:
        hire = int(F["hire"][e])
        ex = int(F["exit_day"][e]) if F["exit_day"][e] >= 0 else 10**9
        stage = F["ctype"][e] == L.CT_STAGE
        seen = set()

        def eng(day):
            m = int(np.clip(sim.month_of(day), 0, sim.T - 1))
            return float(np.clip(P["E"][e, m], -2.5, 2.5))

        def add(code, title, mand, start, hours, due, abandon_p):
            dur = max(1, math.ceil(hours / 7))
            end = start + (dur - 1 if hours <= 21 else 7 * (dur - 1))
            if start >= ex:
                if mand and due is not None and due - 30 < ex:
                    status, s, en = "ABANDONNEE", -1, -1
                else:
                    return
            else:
                ab = rng.random() < abandon_p or end >= ex
                status, s, en = _status(start, end, end_day, ab)
            key = (code, due if due is not None else s)
            if key in seen:
                return
            seen.add(key)
            rows.append((int(e), code, title, int(mand), s, en, -1 if due is None else due, hours, status))

        if hire >= start_day:
            d = hire + int(rng.exponential(10 * math.exp(-0.3 * eng(hire))))
            add(ONBOARDING[0], ONBOARDING[1], 1, d, ONBOARDING[2], hire + 30, 0.0)
        if stage:
            continue
        for y in years:
            code, title, hours = MANDATORY[y % len(MANDATORY)]
            a = int(np.datetime64(f"{y}-02-01").astype(np.int64)) + int(rng.integers(0, 240))
            if a < max(hire + 30, start_day) or a > end_day or a >= ex:
                continue
            due = a + int(rng.integers(60, 121))
            mean = 40 * math.exp(-0.35 * eng(a)) * (1.8 if F["trig_m"][e] >= 0 and sim.month_of(a) >= F["trig_m"][e] else 1.0)
            add(f"{code}-{y}", title, 1, a + int(rng.exponential(mean)), hours, due, 0.0)
        perf = float(F["pbase"][e])
        lo, hi = max(hire, start_day), min(ex, end_day)
        years_in = max(0.0, (hi - lo) / 365.25)
        k = rng.poisson(0.8 * math.exp(0.3 * perf + 0.2 * eng(lo)) * years_in)
        fam = int(F["fam"][e])
        pool = COMMON + BY_FAMILY[fam] + ([MGMT] if F["was_mgr"][e] else [])
        for _ in range(k):
            d = int(lo + rng.integers(0, max(hi - lo, 1) + 45))
            wd = int(sim.cal.wd_days[min(sim.cal.wd_index(d), sim.cal.n_wd - 1)]) if d <= end_day else d
            code, title, hours = pool[rng.integers(len(pool))]
            add(code, title, 0, wd, hours, None, 0.04 * math.exp(-0.8 * eng(wd)))
    return rows

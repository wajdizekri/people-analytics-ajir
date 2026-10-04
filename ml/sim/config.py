"""Configuration commentée du simulateur RH à vérité terrain.

Toutes les constantes de calage sont ici ; les modules n'ont pas de nombre magique métier.
"""
from dataclasses import dataclass, replace

END_DATE = "2026-08-31"  # dernier jour simulé (fin de mois)
EXTRACTION_LAG_DAYS = 15  # l'export AJIR est tiré 15 j après la fin : une saisie plus tardive n'y figure pas
SMIG = 528.32  # SMIG mensuel 48 h (TND), identique au réglage smig_monthly de l'application
SALARY_FLOOR = 560.0  # aucun salaire CDI/CDD simulé ne descend sous ce plancher
STAGE_STIPEND = (250.0, 450.0)  # gratification mensuelle des stagiaires (TND)
MARKET_GROWTH = 0.045  # croissance annuelle des salaires de marché (référence du compa-ratio)
OT_PREMIUM = 1.25  # majoration des heures supplémentaires
MONTHLY_HOURS = 173.33  # base horaire mensuelle (40 h x 52 / 12)
EMAIL_DOMAIN = "example.com"

SIZES = {
    # n0 : effectif initial ; months : durée simulée ; oracle_reps : continuations Monte-Carlo par salarié
    "small": dict(n0=300, months=36, oracle_reps=64),
    "medium": dict(n0=1200, months=72, oracle_reps=64),
    "large": dict(n0=2500, months=96, oracle_reps=50),
}

FAMILIES = ["IT", "Finance", "Production", "Commercial", "Support"]
F_IT, F_FIN, F_PROD, F_COM, F_SUP = range(5)

# code, libellé, part de l'effectif, mix de familles des équipes
DEPARTMENTS = [
    ("DSI", "Direction des systèmes d'information", 0.13, {"IT": 0.9, "Support": 0.1}),
    ("FIN", "Direction administrative et financière", 0.09, {"Finance": 0.9, "Support": 0.1}),
    ("PROD", "Direction de la production", 0.28, {"Production": 0.92, "Support": 0.08}),
    ("COM", "Direction commerciale", 0.15, {"Commercial": 0.9, "Support": 0.1}),
    ("RH", "Direction des ressources humaines", 0.07, {"Support": 1.0}),
    ("LOG", "Direction logistique", 0.12, {"Production": 0.75, "Support": 0.25}),
    ("QUAL", "Direction qualité", 0.09, {"Production": 0.85, "Support": 0.15}),
    ("ACH", "Direction des achats", 0.07, {"Commercial": 0.6, "Finance": 0.2, "Support": 0.2}),
]

# Salaire de base médian (TND/mois) par grade G1..G8 au 2026-08, puis coefficient par famille.
# Le marché croît de MARKET_GROWTH par an : la grille est actualisée à rebours sur la période.
GRADE_PAY_2026 = [0, 900, 1080, 1320, 1650, 2100, 2750, 3650, 4900]
FAMILY_PAY = [1.18, 1.07, 0.93, 1.00, 0.90]
SIVP_PAY = 0.85  # un SIVP est payé 85 % de la médiane du grade

# Part des femmes par famille, heures sup moyennes (h/mois) par famille
FEMALE_SHARE = [0.35, 0.55, 0.32, 0.45, 0.60]
OT_MEAN = [8.0, 6.0, 11.0, 5.0, 4.0]

# Saisonnalité de la charge (log-multiplicateur des heures sup) par famille et mois (janv..déc)
WORKLOAD_SEASON = [
    [0.0, 0.0, 0.0, 0.0, 0.05, 0.1, -0.25, -0.3, 0.05, 0.0, 0.05, 0.15],  # IT
    [0.3, 0.3, 0.2, 0.0, 0.0, 0.0, -0.25, -0.3, 0.0, 0.0, 0.0, 0.15],  # Finance (clôture)
    [0.0, 0.05, 0.15, 0.15, 0.15, 0.1, -0.2, -0.35, 0.1, 0.15, 0.15, 0.0],  # Production
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.25, -0.3, 0.05, 0.1, 0.2, 0.25],  # Commercial
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.25, -0.3, 0.0, 0.0, 0.0, 0.0],  # Support
]

# Mix contractuel visé (stock) : ~70 % CDI, ~20 % CDD, ~7 % SIVP, ~3 % STAGE
CONTRACT_TARGET = {"CDI": 0.70, "CDD": 0.20, "SIVP": 0.07, "STAGE": 0.03}


@dataclass(frozen=True)
class Params:
    # --- engagement latent AR(1) mensuel : E_t = phi E_{t-1} + (1-phi) cible + bruit ---
    phi: float = 0.85
    sigma_e: float = 0.27  # bruit mensuel : règle la prévisibilité (AUC oracle)
    mu_sd: float = 0.45  # hétérogénéité individuelle du niveau de base
    beta_compa: float = 2.5  # effet de (compa-ratio - 1)
    beta_stag: float = 0.30  # par tranche de 24 mois sans promotion au-delà de 36 mois (plafond 2 tranches)
    beta_ot: float = 0.30  # par tranche de 10 h sup/mois (moyenne 3 mois) au-delà du seuil
    ot_threshold: float = 15.0
    beta_mgr: float = 0.45  # qualité de manager latente (aucune variable observée)
    beta_mkt: float = 0.15  # un marché tendu dégrade l'engagement
    honeymoon: float = 0.4  # bonus d'arrivée (décroît en ~4 mois)
    prom_boost: float = 0.6  # bonus transitoire après promotion
    pshock_rate: float = 0.35  # événements personnels négatifs par an (baisse transitoire, non observée)
    pshock_decay: float = 0.75
    mq_head: float = 0.3  # qualité de « manager » des chefs de département (direction générale)
    # --- (a) offres externes : Poisson par famille, acceptées selon l'engagement ---
    offer_rate: tuple = (0.49, 0.245, 0.155, 0.33, 0.16)  # offres/an : IT, Finance, Production, Commercial, Support
    offer_mkt: float = 0.6  # sensibilité au choc de marché de la famille
    accept_a: float = -4.0  # P(acceptation) = sigmoid(a - b * engagement)
    accept_b: float = 4.2
    # --- (b) seuil individuel d'engagement cumulé (CUSUM) ---
    cusum_ref: float = -1.35  # l'insatisfaction s'accumule quand l'engagement passe sous ce niveau
    cusum_decay: float = 0.92
    threshold_median: float = 3.0
    threshold_sd: float = 0.35  # log-écart-type du seuil individuel
    # --- (c) événements personnels indépendants (déménagement, études, conjoint...) ---
    personal_exit_rate: float = 0.011  # par an
    abandon_share: float = 0.04  # part des départs volontaires en abandon de poste (grades G1-G3)
    # --- marché et charge ---
    mkt_rho: float = 0.9
    mkt_sigma: float = 0.2
    w_rho: float = 0.8
    w_sigma: float = 0.18
    w_team_sd: float = 0.25  # hétérogénéité durable de charge entre équipes
    ot_mult: float = 1.0
    # --- autres sorties et carrière ---
    prom_rate: float = 0.04  # probabilité de base de promotion par campagne (janvier, juillet)
    eval_missing: float = 0.05
    dismiss_1: float = 0.025  # hazard mensuel de licenciement dans les 6 mois suivant une note de 1
    dismiss_2: float = 0.002
    ext_mutation_rate: float = 0.002  # mutation vers une autre société du groupe (sortie MUTATION), par an
    contract_exit: tuple = (0.0, 0.12, 0.22, 0.65)  # non-renouvellement au terme : CDI, CDD, SIVP, STAGE
    cdd_to_cdi: float = 0.35  # titularisation au terme d'un CDD (sinon renouvellement)
    cdd_max_renew: int = 2  # au-delà, titularisation obligatoire
    sivp_renew: float = 0.5  # renouvellement unique d'un SIVP
    sivp_to_cdd: float = 0.85  # SIVP non renouvelé et gardé : CDD (sinon CDI)
    hire_mix: tuple = (0.10, 0.58, 0.32)  # recrutements CDI, CDD, SIVP avant régulation vers le mix cible
    hire_gain: float = 8.0  # force de rappel du mix contractuel des recrutements
    mgr_change_rate: float = 0.012  # oracle : changement de manager (mensuel) hors réorganisation simulée
    # --- signaux faibles avant démission (1 à 3 mois) ---
    signal_amp: tuple = (0.0, 0.8, 1.0, 0.5)  # aucun, offre, seuil, personnel
    signal_notice: float = 0.4
    lead_p: tuple = ((0.35, 0.45, 0.20), (0.20, 0.40, 0.40), (0.40, 0.40, 0.20))  # délai décision -> démission (0,1,2 mois)
    # --- bruit d'étiquette et saisie ---
    reason_noise: float = 0.04  # part des démissions exportées avec le motif AUTRE
    resignation_blank: float = 0.40  # part des démissions sans resignation_date
    # --- injections ---
    anomaly_rate: float = 0.015  # part des salarié-mois touchés par une anomalie d'absentéisme


SCENARIOS = {
    # Mécanismes mélangés : offres ~50 %, seuil ~35 %, personnel ~15 % des démissions
    "mixte": Params(),
    # Charge dominante : heures sup plus fortes et plus variables, effet sur l'engagement triplé ;
    # le seuil d'insatisfaction cumulée devient le premier mécanisme (~50 % des démissions)
    "charge": replace(
        Params(),
        beta_ot=0.9,
        ot_threshold=10.0,
        w_sigma=0.28,
        w_team_sd=0.45,
        ot_mult=1.35,
        beta_compa=1.8,
        sigma_e=0.33,
        cusum_ref=-1.85,
        threshold_sd=0.5,
        offer_rate=(0.24, 0.12, 0.08, 0.17, 0.08),
        personal_exit_rate=0.008,
    ),
}

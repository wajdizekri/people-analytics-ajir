"""Organisation : départements, équipes hiérarchisées (5 à 12 membres), intitulés de poste, grille salariale."""
import math

import numpy as np

from . import config as C

ROLE_STAFF, ROLE_LEAD, ROLE_MID, ROLE_HEAD = 0, 1, 2, 3
ROLE_MIN_GRADE = np.array([1, 4, 6, 7])
BAND = np.array([0, 0, 0, 1, 1, 2, 2, 3, 3])  # grade -> tranche d'intitulé
LEVEL_ROLE = {0: ROLE_HEAD, 1: ROLE_MID, 2: ROLE_LEAD}
DEPT_CODES = [d[0] for d in C.DEPARTMENTS]
MAIN_FAMILY = [C.FAMILIES.index(max(d[3], key=d[3].get)) for d in C.DEPARTMENTS]

_IT = [["Technicien support informatique", "Technicien réseau"], ["Développeur", "Administrateur systèmes"],
       ["Ingénieur études et développement", "Ingénieur réseaux et sécurité"], ["Architecte logiciel", "Chef de projet informatique"]]
_FIN = [["Aide-comptable", "Agent de recouvrement"], ["Comptable", "Assistant trésorerie"],
        ["Contrôleur de gestion", "Comptable principal"], ["Responsable comptable", "Auditeur interne"]]
_PROD = [["Opérateur de production", "Agent de maintenance"], ["Technicien de production", "Technicien de maintenance"],
         ["Ingénieur de production", "Ingénieur méthodes"], ["Responsable d'atelier", "Responsable maintenance"]]
_COM = [["Assistant commercial", "Téléconseiller"], ["Commercial terrain", "Chargé de clientèle"],
        ["Ingénieur commercial", "Chef de produit"], ["Responsable grands comptes", "Responsable export"]]
_SUP = [["Agent administratif", "Secrétaire"], ["Assistant de direction", "Gestionnaire administratif"],
        ["Chargé de mission", "Juriste"], ["Responsable administratif", "Chargé d'études senior"]]
TITLES = {
    ("*", "IT"): _IT,
    ("*", "Finance"): _FIN,
    ("*", "Production"): _PROD,
    ("*", "Commercial"): _COM,
    ("*", "Support"): _SUP,
    ("ACH", "Finance"): [["Assistant achats", "Agent de facturation"], ["Gestionnaire fournisseurs", "Comptable fournisseurs"],
                         ["Analyste coûts", "Contrôleur achats"], ["Responsable budget achats", "Auditeur achats"]],
    ("LOG", "Production"): [["Magasinier", "Cariste"], ["Agent logistique", "Technicien logistique"],
                            ["Planificateur logistique", "Ingénieur supply chain"], ["Responsable entrepôt", "Responsable transport"]],
    ("QUAL", "Production"): [["Contrôleur qualité", "Agent de laboratoire"], ["Technicien qualité", "Technicien métrologie"],
                             ["Ingénieur qualité", "Auditeur qualité"], ["Responsable assurance qualité", "Responsable HSE"]],
    ("ACH", "Commercial"): [["Assistant achats", "Approvisionneur"], ["Acheteur", "Approvisionneur senior"],
                            ["Acheteur senior", "Chef de projet achats"], ["Responsable achats stratégiques", "Responsable approvisionnement"]],
    ("RH", "Support"): [["Agent administratif RH", "Agent d'accueil"], ["Assistant RH", "Gestionnaire paie"],
                        ["Chargé de recrutement", "Chargé de formation"], ["Responsable développement RH", "Juriste droit social"]],
}
DEPT_SUFFIX = {"DSI": "développement", "FIN": "comptabilité", "PROD": "production", "COM": "ventes",
               "RH": "administration du personnel", "LOG": "logistique", "QUAL": "contrôle qualité", "ACH": "achats"}
FAM_SUFFIX = ["informatique", "finance", "production", "commerciale", "services généraux"]
MID_SUFFIX = {"DSI": "informatique", "FIN": "comptable et financier", "PROD": "production", "COM": "commercial",
              "RH": "ressources humaines", "LOG": "logistique", "QUAL": "qualité", "ACH": "achats"}
HEAD_TITLE = {"DSI": "Directeur des systèmes d'information", "FIN": "Directeur administratif et financier",
              "PROD": "Directeur de production", "COM": "Directeur commercial", "RH": "Directeur des ressources humaines",
              "LOG": "Directeur logistique", "QUAL": "Directeur qualité", "ACH": "Directeur des achats"}


def staff_title(rng, dept: int, fam: int, grade: int, avoid: str | None = None) -> str:
    code, fname = DEPT_CODES[dept], C.FAMILIES[fam]
    table = TITLES.get((code, fname), TITLES[("*", fname)])
    opts = [t for t in table[BAND[grade]] if t != avoid] or table[BAND[grade]]
    return opts[rng.integers(len(opts))]


def manager_title(dept: int, fam: int, role: int) -> str:
    code = DEPT_CODES[dept]
    if role == ROLE_HEAD:
        return HEAD_TITLE[code]
    if role == ROLE_MID:
        return f"Chef de service {MID_SUFFIX[code]}"
    suffix = DEPT_SUFFIX[code] if fam == MAIN_FAMILY[dept] else FAM_SUFFIX[fam]
    return f"Chef d'équipe {suffix}"


def ref_table(m: int, last_month: int) -> np.ndarray:
    """Salaire de marché médian [famille, grade] au mois m (index 0..8, grade 0 inutilisé)."""
    growth = (1 + C.MARKET_GROWTH) ** ((m - last_month) / 12)
    return np.outer(C.FAMILY_PAY, C.GRADE_PAY_2026) * growth


def _dept_sizes(n0: int) -> list[int]:
    shares = np.array([d[2] for d in C.DEPARTMENTS])
    raw = n0 * shares / shares.sum()
    sizes = np.floor(raw).astype(int)
    for i in np.argsort(-(raw - sizes))[: n0 - sizes.sum()]:
        sizes[i] += 1
    return sizes.tolist()


def _plan(rem: int, rng):
    base = max(1, round(rem / 9.5))
    for L in sorted(range(1, base + 4), key=lambda x: abs(x - base)):
        if L <= 6:
            K, top_staff, per_mid, mid_staff = 0, max(0, 5 - L), [], []
        else:
            K = math.ceil(L / 6)
            per_mid = [L // K + (1 if i < L % K else 0) for i in range(K)]
            mid_staff = [max(0, 5 - x) for x in per_mid]
            top_staff = max(0, 5 - K) + int(rng.integers(0, 2))
        leaf_staff = rem - K - top_staff - sum(mid_staff) - L
        if 5 * L <= leaf_staff <= 12 * L:
            return L, K, top_staff, per_mid, mid_staff, leaf_staff
    raise ValueError(f"département de {rem + 1} personnes impossible à structurer")


def _split(total: int, k: int, rng) -> list[int]:
    sizes = np.full(k, 5)
    extra = total - 5 * k
    while extra > 0:
        room = np.nonzero(sizes < 12)[0]
        add = rng.multinomial(extra, np.ones(len(room)) / len(room))
        add = np.minimum(add, 12 - sizes[room])
        sizes[room] += add
        extra -= int(add.sum())
    return sizes.tolist()


def build(n0: int, rng):
    """Construit équipes et postes. Retourne (teams, positions).

    teams : dict de listes (dept, fam, parent, level) ; positions : liste de dicts
    (dept, fam, team = équipe dont le poste est membre, manages = équipe dirigée, role).
    """
    teams = {"dept": [], "fam": [], "parent": [], "level": []}
    positions = []

    def new_team(d, f, parent, level):
        for k, v in zip(("dept", "fam", "parent", "level"), (d, f, parent, level)):
            teams[k].append(v)
        return len(teams["dept"]) - 1

    def pos(d, f, team, manages, role):
        positions.append(dict(dept=d, fam=f, team=team, manages=manages, role=role))

    for d, n_d in enumerate(_dept_sizes(n0)):
        mix = C.DEPARTMENTS[d][3]
        fams = [C.FAMILIES.index(k) for k in mix]
        probs = np.array(list(mix.values()))
        main = MAIN_FAMILY[d]
        L, K, top_staff, per_mid, mid_staff, leaf_staff = _plan(n_d - 1, rng)
        top = new_team(d, main, -1, 0)
        pos(d, main, -1, top, ROLE_HEAD)
        support = C.FAMILIES.index("Support")
        for _ in range(top_staff):
            pos(d, support if rng.random() < 0.5 else main, top, -1, ROLE_STAFF)
        parents = [top] * L
        if K:
            parents = []
            for k in range(K):
                mt = new_team(d, main, top, 1)
                pos(d, main, top, mt, ROLE_MID)
                for _ in range(mid_staff[k]):
                    pos(d, main, mt, -1, ROLE_STAFF)
                parents += [mt] * per_mid[k]
        for parent, size in zip(parents, _split(leaf_staff, L, rng)):
            f = fams[rng.choice(len(fams), p=probs / probs.sum())]
            lt = new_team(d, f, parent, 2)
            pos(d, f, parent, lt, ROLE_LEAD)
            for _ in range(size):
                pos(d, f, lt, -1, ROLE_STAFF)
    teams = {k: np.array(v) for k, v in teams.items()}
    return teams, positions

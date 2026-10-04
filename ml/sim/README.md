# Simulateur RH à vérité terrain

Génère un export AJIR complet (les 11 CSV de `docs/CONVENTIONS.md`) et un dossier `ground_truth/` qui n'est
jamais importé. Python 3.13 hors ligne : numpy, pandas, scipy, holidays, pytest.

```
python ml/sim/run.py --config small|medium|large --scenario mixte|charge --seed N [--out data/sim] [--no-oracle]
npm run sim -- --config medium --seed 2
python -m pytest ml/sim/tests -q
```

Sortie : `data/sim/<scenario>_<config>_s<seed>/`. `small` = 300 salariés initiaux sur 36 mois, `medium` = 1 200 sur 72 mois,
`large` = 2 500 sur 96 mois ; la période se termine le 2026-08-31 et l'export est « extrait » le 2026-09-15 (les saisies
plus tardives n'y figurent pas). Durées mesurées (Windows, un cœur) : small 4 s, medium 35 s, large 90 s, oracle compris.

## Modules

| Fichier | Rôle |
|---|---|
| `config.py` | Paramètres commentés : tailles, grille salariale, mix contractuel, scénarios `mixte` et `charge` |
| `calendar_tn.py` | Calendrier tunisien (fériés `holidays` TN dont fêtes religieuses, Ramadan = 30 j avant l'Aïd el-Fitr, séance unique juillet-août, ponts) |
| `org.py` | 8 départements, 5 familles, équipes de 5 à 12 sur 2-3 niveaux, intitulés de poste, grille G1-G8 |
| `latent.py` | Dynamique mensuelle partagée par la simulation et l'oracle (engagement, offres, seuil, sorties concurrentes) |
| `engine.py` | Boucle mensuelle vectorisée : population, carrière, contrats, successions de managers, remplacements, oracle |
| `daily.py` | Absences et pointages sur des matrices salarié x jour ouvré (par blocs, sans boucle salarié-jour) |
| `anomalies.py`, `defects.py` | Injections étiquetées d'anomalies d'absentéisme et de défauts de qualité |
| `trainings.py` | Formations obligatoires (échéance) et facultatives |
| `export.py`, `stats.py`, `run.py` | Écriture des CSV, statistiques de calage, CLI |

## Mécanisme de départ (non circulaire)

Aucune sortie n'est tirée d'un logit des variables observées. Chaque mois :

- **Engagement latent** AR(1) : `E = 0,85 E + 0,15 cible + 0,27 ε`, la cible combinant compa-ratio (salaire / marché
  famille x grade), stagnation (mois sans promotion au-delà de 36), heures sup (moyenne 3 mois au-delà d'un seuil),
  **qualité de manager latente** (propriété du manager, aucune variable exportée), choc de marché de la famille,
  événements personnels transitoires, bonus d'arrivée et de promotion.
- **Démission** déclenchée par (a) une offre externe (Poisson par famille, modulée par le marché, l'âge et le contrat),
  acceptée avec `sigmoid(-4 - 4,2 E)` ; (b) le dépassement d'un seuil individuel par l'insatisfaction cumulée
  `D = max(0, 0,92 D + (-1,35 - E))` ; (c) un événement personnel indépendant de tout (1,1 %/an).
- Décision puis démission 0 à 2 mois plus tard : **signaux faibles** pendant 1 à 3 mois (absences courtes non
  justifiées, heures sup divisées par ~2, arrivées plus dispersées et retards, jours sans badge), puis préavis d'un mois
  pendant lequel les pointages continuent (préavis borné au terme d'un CDD). ~8 % d'abandons de poste (surtout G1-G3).
- Sorties concurrentes : fin de CDD / SIVP (non-renouvellement), fin de stage, licenciement dans les 6 mois d'une note
  1 ou 2, retraite à 60 ans, décès, mutation groupe. Remplacement du poste 1 à 3 mois après la sortie ; un manager
  sortant est remplacé le lendemain (promotion interne ou recrutement externe), ce qui génère les `CHANGEMENT_MANAGER`.

Scénario `charge` : charge d'équipe plus forte et plus variable, effet des heures sup triplé ; le seuil
d'insatisfaction devient le premier mécanisme (~50 % des démissions).

## Réalisme de l'export

Noms et prénoms tunisiens romanisés, gouvernorats, situation familiale (mariages, naissances), contrats ~70/20/7/3 %
CDI/CDD/SIVP/STAGE maintenus par les recrutements, salaires log-normaux par famille x grade (plancher 560 TND,
croissance de marché 4,5 %/an), augmentations de janvier 2 à 8 % selon la note, promotions en janvier et juillet.
Pointage lundi-vendredi : 08:00-17:00 (pause 1 h), Ramadan 08:00-14:00, séance unique 07:30-13:30 ; retard si arrivée
> 10 min (`late_minutes` = minutes de retard). `absences.days` = jours ouvrés couverts ; `recorded_at` = fin + 0 à 15 j.
Paie : `gross = base x prorata + heures sup x base / 173,33 x 1,25 - base / 26 x jours non payés` (sans solde,
injustifiés) ; les stagiaires ont une gratification sous le SMIG (acceptée par l'import pour STAGE et SIVP).
Évaluations saisies 30 à 120 j après la campagne de décembre ; 5 % manquantes. 4 % des démissions exportées en `AUTRE`,
40 % sans `resignation_date`.

## Vérité terrain (`ground_truth/`)

| Fichier | Contenu |
|---|---|
| `config.json`, `stats.json` | Paramètres complets, définition de la cible, statistiques de calage |
| `latent_monthly.csv` | `matricule;month;engagement;manager_quality;market_pressure;personal_shock;overtime_target_h;phase` (phase `DEPART` / `PREAVIS`) |
| `oracle_prob6.csv` | `matricule;as_of;prob6;eligible;y6;followup_complete` : vraie probabilité de démission ou abandon dans ]t, t+6 mois] par ≥ 50 continuations Monte-Carlo de l'état latent, un mois sur trois ; `eligible` reproduit la règle d'éligibilité de CONVENTIONS |
| `mechanisms.csv` | Mécanisme déclencheur de chaque démission, date vraie, motif et date exportés |
| `anomalies.csv` | Une ligne par salarié touché : type, portée, manager, période, jours injectés, `held_out` |
| `defects.csv` | `file;line;defect_type;matricule;detail` (ligne 1 = en-tête), identique aux rejets de l'import |
| `calendar.csv` | Calendrier au format `dim_date` |

Anomalies (1,5 % des salarié-mois, hors maladie et maternité) : `PIC_EQUIPE` (2 à 4 semaines), `LUNDI_VENDREDI`,
`PONTS`, `DERIVE` et `ROTATION_EQUIPE`, type libre réservé à l'évaluation (`held_out = 1`). Défauts (~1,9 % des lignes
pointage/absences/paie) : pointage sans sortie, doublons, fin d'absence avant début, matricule inconnu, salaire de base
sous le SMIG (CDI/CDD).

## Calage obtenu (graine 1)

| Jeu | Turnover/an | Part volontaire | Absentéisme hors congés | Congés/an | AUC oracle | Démissions offre / seuil / perso |
|---|---|---|---|---|---|---|
| mixte small | 14,5 % | 58 % | 3,9 % | 20,6 j | 0,836 | 35 / 30 / 10 |
| mixte medium | 13,1 % | 62 % | 3,7 % | 19,7 j | 0,844 | 314 / 193 / 57 |
| mixte large | 12,0 % | 59 % | 3,7 % | 20,1 j | 0,818 | 742 / 427 / 199 |

Sur medium, graines 1 à 4 : turnover 11 à 13 %, part volontaire 60 à 62 %, AUC oracle 0,83 à 0,84 ; scénario
`charge` : turnover 12 à 13 %, AUC 0,85. Taux de démission à 6 mois des éligibles ≈ 3,5 %, oracle calibré (p moyen = taux
observé). L'import TypeScript du projet accepte l'export avec un score qualité de ~99 % ; ses rejets correspondent ligne à
ligne à `defects.csv`.

## Limites

- L'oracle fige l'organisation : les changements de manager y suivent un hazard moyen au lieu des successions simulées.
- Le seuil (b) est très prévisible (AUC ~0,98), les offres le sont moyennement (~0,79) et les événements personnels pas
  du tout : l'AUC globale dépend du mélange, donc du scénario.
- Turnover et absentéisme sont calés sur des ordres de grandeur plausibles, pas sur des statistiques ArabSoft ou INS.

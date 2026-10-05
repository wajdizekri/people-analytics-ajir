# Résultats de l'IA « charge de travail »

Prévision des heures supplémentaires par équipe et par département à 1-3 mois, indicateur individuel de surcharge
soutenue et recommandations. Tous les chiffres viennent de `ml/workload/results/<jeu>.json`, produits par
`ml/workload/run.py` le 30/09/2026 ; le bundle de production est `models/workload/workload-ridge-v1-20260930/`.

**Statut des résultats.** Données simulées (`ml/sim`) : ces chiffres valident la méthode (protocole, absence de fuite,
intervalles, parité Python / TypeScript), pas une valeur métier. Dans le simulateur, les heures sup d'un salarié suivent
`propension individuelle × exp(charge latente de l'équipe)` avec une charge d'équipe AR(1) saisonnière par famille de
métier ; ni l'effectif ni les postes vacants n'y modifient la charge des présents (voir « Limites »).

## 1. Données et définitions

| Jeu | Base | Période | Salariés | Rôle |
|---|---|---|---|---|
| `mixte_medium_s1` (principal) | `data/dev-ai-load.db` (copie de `data/app.db`) | 2020-09 → 2026-08 | 2 445 | apprentissage du bundle, évaluation |
| `charge_medium_s1` (réplication) | `data/ml-charge_medium_s1.db` | 2020-09 → 2026-08 | 2 394 | scénario « charge dominante » : heures sup plus fortes et plus variables, effet sur les départs triplé |

- **Intensité** d'un groupe au mois m : `I = Σ heures sup pointées / ETP`, `ETP = Σ jours pointés / jours ouvrés du mois`
  (`dim_date`, hors week-ends et fériés). Unité : heures sup par ETP et par mois. Mois non défini si ETP < 1.
- **Groupe à l'origine O** (fin de mois) : salariés actifs en fin de O rattachés au même manager (équipe = rattachés
  directs, `CHANGEMENT_MANAGER` rejoués à la date) ou au même département (`MUTATION` rejouées). La série du groupe est
  celle de ses membres actuels, historique compris (composition à l'origine) : un changement de manager ne remet pas
  l'historique d'une équipe à zéro. Équipes de moins de 5 personnes (`MIN_GROUP_SIZE`) jamais prévues.
- **Cible** : `z[T] − zbar12`, `z = log(1 + I)`, T = O + h (h = 1, 2, 3), `zbar12` = moyenne de z sur O-11..O
  (≥ 6 mois valides requis).
- **Variables (27)**, calculées à l'origine : niveau récent (dernier mois, moyenne 3 mois), saisonnalité (écart du même
  mois un an plus tôt à sa moyenne centrée, pour le groupe et pour son département ; indicatrices de mois), tendance
  6 mois, calendrier tunisien du mois cible et écart au même mois N-1 (part de jours de Ramadan, de séance unique d'été,
  de ponts, jours ouvrés), effectif (log), variation d'effectif sur 3 mois, départs non remplacés sur 3 mois
  (`max(0, sorties − embauches) / effectif à O-3`).

Lignes (origine × groupe × horizon) : 25 557 équipe et 1 320 département (mixte) ; 154 équipes et 8 départements
prévisibles à la dernière origine (2026-08).

## 2. Protocole temporel

Origines glissantes : 24 origines de test O = 2024-08 → 2026-07 (horizons clos au plus tard en 2026-08). Pour chaque
origine et chaque horizon :

```
lignes d'apprentissage : cible T <= O (connue à l'origine)
  ajustement  : T <= O-12          -> choix de alpha (MAE en heures) sur la calibration
  calibration : O-12 < T <= O      -> quantile conforme de |résidu| / échelle de bruit du groupe
  modèle final réajusté sur tout T <= O, prévision des groupes de l'origine O
```

- Ridge standardisée, alpha dans {0,3 … 10 000} (alphas retenus 0,3 à 3 000, grille non saturée).
- Intervalle à 80 % : conforme normalisé, `ẑ ± q · s`, s = écart-type des variations mensuelles de z du groupe sur
  12 mois / √2 (plancher 0,03 ; médiane de la portée si moins de 3 variations).
- Baselines sur les mêmes lignes : **naïf saisonnier** (I du même mois N-1), **moyenne mobile 3 mois**, **dernier mois**.
- IC 95 % des différences de MAE par bootstrap groupé par groupe (1 000 tirages).

## 3. Prévision : résultats

MAE en heures sup par ETP et par mois. Δ = MAE ridge − MAE de la meilleure baseline de la ligne [IC 95 %].
Couverture de l'intervalle à 80 % (sous la borne basse / au-dessus de la borne haute).

**`mixte_medium_s1`**

| Portée | h | Lignes | Moyenne I | Ridge | Naïf saisonnier | Moy. mobile 3 m | Dernier mois | Gain vs meilleure | Δ [IC 95 %] | Couverture 80 % | Largeur |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Équipe | 1 | 3 713 | 7,53 | **1,78** | 2,98 | 1,87 | 2,04 | 4,8 % | −0,09 [−0,12 ; −0,06] | 80,4 % (10,4 / 9,2) | 6,2 |
| Équipe | 2 | 3 560 | 7,55 | **1,94** | 2,98 | 2,04 | 2,22 | 5,0 % | −0,10 [−0,14 ; −0,07] | 81,0 % (10,5 / 8,5) | 6,8 |
| Équipe | 3 | 3 406 | 7,58 | **2,06** | 2,96 | 2,18 | 2,34 | 5,6 % | −0,12 [−0,16 ; −0,08] | 81,6 % (10,5 / 7,9) | 7,3 |
| Département | 1 | 192 | 7,07 | **0,52** | 0,83 | 0,55 | 0,57 | 5,7 % | −0,03 [−0,08 ; 0,02] | 76,6 % (10,4 / 13,0) | 1,6 |
| Département | 2 | 184 | 7,11 | **0,57** | 0,84 | 0,63 | 0,62 | 7,2 % | −0,04 [−0,10 ; 0,02] | 78,8 % (10,3 / 10,9) | 1,7 |
| Département | 3 | 176 | 7,14 | **0,61** | 0,82 | 0,73 | 0,72 | 15,6 % | −0,11 [−0,18 ; −0,05] | 77,3 % (9,7 / 13,1) | 1,9 |

Tous horizons : équipes 1,92 contre 2,02 (moyenne mobile, −5,1 %, IC [−0,13 ; −0,07]) et 2,97 (naïf saisonnier) ;
départements 0,57 contre 0,63 (dernier mois, −10,4 %, IC [−0,11 ; −0,01]).

**`charge_medium_s1` (réplication)**

| Portée | h | Ridge | Naïf saisonnier | Moy. mobile 3 m | Dernier mois | Δ vs meilleure [IC 95 %] | Couverture 80 % |
|---|---|---|---|---|---|---|---|
| Équipe | 1 | **2,26** | 3,94 | 2,37 | 2,43 | −0,11 [−0,15 ; −0,08] | 80,0 % |
| Équipe | 2 | **2,56** | 3,95 | 2,69 | 2,82 | −0,13 [−0,18 ; −0,08] | 79,6 % |
| Équipe | 3 | **2,78** | 3,97 | 2,96 | 3,07 | −0,18 [−0,24 ; −0,13] | 79,4 % |
| Département | 1 | 0,64 | 1,10 | 0,64 | **0,63** | +0,01 [−0,06 ; 0,08] | 78,6 % |
| Département | 2 | 0,75 | 1,09 | 0,79 | 0,75 | 0,00 [−0,07 ; 0,08] | 80,4 % |
| Département | 3 | 0,83 | 1,09 | 0,85 | 0,84 | −0,00 [−0,10 ; 0,09] | 76,7 % |

Lecture :

- Au niveau **équipe**, la ridge bat les trois baselines à chaque horizon, sur les deux jeux, avec des IC qui excluent 0 ;
  le gain est modeste (5 à 6 % sur la moyenne mobile), l'essentiel du bruit d'une équipe de 5 à 12 personnes restant
  imprévisible. Le naïf saisonnier est le plus mauvais : un mois isolé d'il y a un an est trop bruité à cette échelle.
- Au niveau **département**, gain de 10 % sur `mixte` (significatif tous horizons confondus, pas à h = 1 et 2 pris
  isolément) et **aucun gain** sur `charge` : on ne peut pas y préférer la ridge au « dernier mois » sur la précision
  seule (elle garde l'avantage de fournir un intervalle).
- **Intervalles** : couverture 79 à 82 % pour les équipes (cible 80 %), 77 à 80 % pour les départements (8 groupes,
  calibration sur peu de lignes : légère sous-couverture).

### Ablations (MAE tous horizons, mêmes origines)

| Variante | Équipe mixte | Département mixte | Équipe charge | Département charge |
|---|---|---|---|---|
| Modèle complet | 1,920 | 0,566 | 2,525 | 0,739 |
| Sans calendrier tunisien | 1,922 | 0,575 | 2,517 | 0,734 |
| Sans effectif ni départs non remplacés | 1,920 | 0,563 | 2,526 | 0,728 |
| Sans saisonnalité (écarts N-1, indicatrices de mois) | 1,930 | 0,575 | 2,531 | 0,749 |

Le calendrier tunisien n'aide que les départements du jeu `mixte` (+1,6 % d'erreur sans lui) et ne sert à rien
ailleurs ; l'effectif et les départs non remplacés n'apportent rien (attendu : le simulateur ne les relie pas à la charge
des présents). La saisonnalité apporte 0,5 à 2 %. Ces variables sont conservées parce que leur effet est plausible sur
des données réelles et que la ridge les écrase quand elles sont inutiles (coefficients < 0,015 en unités d'écart-type),
mais aucun bénéfice n'est revendiqué.

## 4. Seuil de tension et recommandations collectives

Seuil = quantile 85 % de l'intensité des mois-équipe de l'apprentissage : **12,8 h par ETP** dans le bundle (13,0 à la
première origine de test, 14,3 sur `charge`). Une équipe est « en tension » si sa prévision dépasse le seuil sur l'un
des 3 mois ; « probable » si la borne basse le dépasse aussi. Évaluation sur les 10 679 prévisions d'équipe de test
(`mixte`, prévalence réelle 13,8 %) :

| Règle d'alerte | Part alertée | Précision | Rappel |
|---|---|---|---|
| Ridge : prévision >= seuil | 11,6 % | 70,8 % | 59,5 % |
| Ridge : borne basse >= seuil (« probable ») | 3,5 % | 93,0 % | 23,3 % |
| Moyenne mobile 3 mois >= seuil | 13,7 % | 66,1 % | 65,8 % |
| Naïf saisonnier >= seuil | 15,1 % | 51,3 % | 56,1 % |

Sur `charge` : précision 72,2 % (ridge), 88,4 % (borne basse, rappel 5,4 %), 60,0 % (moyenne mobile), 38,0 % (naïf
saisonnier). La ridge alerte un peu moins souvent que la moyenne mobile mais avec une meilleure précision ; la borne
basse sert à la priorité (priorité 1 = tension probable). Un seuil défini relativement à la moyenne propre de l'équipe
(+25 %) a été essayé puis écarté : la prévision, rétrécie vers la moyenne, n'alertait presque jamais (3 % des lignes,
rappel 9 %).

## 5. Surcharge individuelle soutenue (règle, pas de modèle)

Règle : salarié actif dont les heures sup pointées du mois dépassent le seuil chaque mois depuis au moins N mois
consécutifs (un mois sans pointage rompt la série). Défaut **20 h, 3 mois** (20 h = règle B0 `overtime_h_avg_3m > 20`
de `shared/features.json`) ; paramétrable par `app_setting` (`workload_ot_threshold_h`, `workload_ot_months`).
Validation temporelle : mois 2021-09 → 2026-02 (suivi à 6 mois complet), 63 391 salarié-mois ; issue = démission ou
abandon dans ]m, m + 6 mois] ; niveau de risque = run publié du mois (champion `b0-v1`).

| Seuil | N | Part signalée | Départs 6 mois signalés | Autres | Lift | Persistance m+1 | Signalés avec risque MOYEN/ÉLEVÉ | Départs : signalés + risque | Départs : signalés sans risque |
|---|---|---|---|---|---|---|---|---|---|
| 15 h | 3 | 5,77 % | 4,35 % | 3,68 % | 1,17 | 79,1 % | 41,2 % | 2,72 % | 5,49 % |
| **20 h** | **3** | **2,72 %** | **4,29 %** | **3,70 %** | **1,16 [0,71 ; 1,61]** | **72,7 %** | **41,6 %** | **2,92 %** | **5,27 %** |
| 20 h | 4 | 1,94 % | 4,38 % | 3,70 % | 1,18 | 76,0 % | 42,2 % | 3,08 % | 5,34 % |
| 25 h | 3 | 1,03 % | 3,23 % | 3,72 % | 0,87 | 61,6 % | 41,2 % | 2,24 % | 3,93 % |

Réplication `charge` (règle 20 h / 3 mois) : 2,98 % signalés, départs à 6 mois 16,55 % contre 2,78 %, **lift 5,18
[4,39 ; 6,09]** ; 6,43 à 4 mois, 6,69 à 25 h / 3 mois.

Lecture :

- La règle repère une charge **durable** (persistance d'un mois sur l'autre 67 à 76 %) sur 2 à 3 % de l'effectif :
  14 salariés sur 1 168 actifs en 2026-08 (`mixte`), 23 sur 1 175 (`charge`).
- Son lien avec le départ dépend entièrement du mécanisme : nul sur `mixte` (lift 1,16, IC contenant 1, cohérent avec
  le poids faible des heures sup dans le modèle turnover, coefficient 0,02 écart-type, `docs/RESULTATS_ML.md`), fort
  sur `charge`. La recommandation est donc motivée par la charge elle-même (entretien sur la charge), pas présentée
  comme une prédiction de départ.
- **Combinaison avec le risque de départ** : sur `mixte`, les signalés à risque MOYEN/ÉLEVÉ partent *moins* (2,9 %) que
  les autres signalés (5,3 %) ; sur `charge`, à peine plus (17,1 % contre 16,3 %). Le champion B0 compte déjà un point
  pour `overtime_h_avg_3m > 20`, ce qui rend la combinaison en partie circulaire. Le niveau de risque est donc
  seulement cité dans la justification RH ; il ne change ni la liste ni la priorité (priorité 1 = série d'au moins
  N + 1 mois, le lift croissant avec la durée sur `charge`).

## 6. Bundle, parité, enregistrement

- `models/workload/workload-ridge-v1-20260930/model.json` : 6 ridges (équipe / département × h = 1..3 ; alphas équipe
  1 000, 1 000, 300 ; département 300, 300, 30), moyennes / écarts-types, quantiles conformes, échelles par défaut
  (0,231 équipe, 0,062 département), seuil de tension 12,8 h, paramètres de la règle, `data_hash` sha256 du panel
  (employé, mois, minutes, jours) `77a75dfa…`, métriques de ce document.
- `golden.json` : 200 prévisions (100 équipe, 100 département, origines de test) et les variables des 486 lignes de la
  dernière origine (2026-08) calculées par Python sur la base.
- Parité : `predictGroup` (TS) reproduit les 200 prévisions avec un écart max de 3,6e-15 ; `loadPanel` + `groupRows`
  (TS) recalculent les 486 vecteurs de variables depuis `data/dev-ai-load.db` avec un écart max de 3,6e-15 (tolérance
  1e-9, `tests/ai/workload/parity.test.ts`, bloc base activé par `WORKLOAD_PARITY_DB`).
- Enregistré et promu CHAMPION d'abord sur `data/dev-ai-load.db` (`npm run topic-model -- register CHARGE_TRAVAIL
  models/workload/workload-ridge-v1-20260930` puis `promote`), puis CHAMPION de `data/app.db` (état vérifié le
  04/10/2026). La version calibrée `workload-ridge-v2-20261004` est livrée dans `models/` mais pas enregistrée.
- Au chargement, seule la structure du bundle est contrôlée (`validateBundle`) ; la parité est vérifiée par
  `tests/ai/workload/parity.test.ts`, pas rejouée à l'exécution (contrairement au risque de départ).

## 7. Intégration

- Étape du batch (`src/lib/ai/workload/step.ts`, déjà branchée dans `src/lib/ai/steps.ts`) : sur `dev-ai-load.db` au
  2026-08-31, 486 prévisions (154 équipes, 8 départements) + entreprise, 17 recommandations collectives (4 de priorité 1)
  et 14 individuelles (5 de priorité 1), environ 3 s à chaud ; seconde exécution identique (idempotence). `forecast` :
  horizon 1..3 = prévision et bornes à 80 % ; horizon 0 = intensité observée des 12 derniers mois à la composition de
  l'origine (lue par la page, évite 4 s de recalcul) ; ENTREPRISE = moyenne des départements pondérée par l'effectif,
  sans intervalle.
- Recommandations (`insight_recommendation`, topic `CHARGE_TRAVAIL`) : équipe → audience MANAGER (« Charge prévue
  élevée pour votre équipe en <mois> : répartir les tâches / renfort temporaire »), clé
  `CHARGE_TRAVAIL:EQUIPE:<manager>:<AAAA-Tn>` (une par trimestre du pic) ; département → audience RH ; individuelle →
  RH seule (« X cumule N mois d'heures sup au-delà de 20,0 h : entretien sur la charge », détail des 6 derniers mois),
  clé `CHARGE_TRAVAIL:SALARIE:<salarié>:<début de série>`. Une recommandation déjà réalisée ou rejetée n'est jamais
  réécrite. Salariés opposés exclus (`excludeOpposed`, `src/lib/privacy`) ; aucune donnée de santé.
- Page `/charge` (RH, MANAGER ; ADMIN redirigé et refusé par la DAL avec audit) : RH = KPI, observé / prévu par
  département, pic des équipes en tension, tables, surcharges individuelles (lecture auditée `workload.view`),
  recommandations avec changement de statut (Server Action, audit `insight.update`) ; MANAGER = équipes de sa
  hiérarchie d'au moins 5 personnes en agrégé et recommandations collectives de ces équipes seulement.

## 8. Limites

- **Simulateur** : la charge n'y dépend ni de l'effectif ni des postes vacants, et la saisonnalité est la même pour
  toutes les équipes d'une famille de métier ; les ablations ne peuvent donc pas montrer l'apport de ces variables.
  Sur données réelles, départs non remplacés et pics d'activité propres à une équipe peuvent peser davantage.
- **Composition à l'origine** : la série d'une équipe est celle de ses membres actuels ; les départs du passé en sortent
  (biais de survie modéré), compensé par la variable « départs non remplacés ».
- **Heures pointées** (`attendance_daily.overtime_minutes`), pas heures payées (`payroll_monthly`, saisies avec retard).
- **Visibilité as-of** : changements de manager, mutations et sorties datés à leur date d'effet, sans tenir compte de
  leur date de saisie (écart de quelques jours).
- **Petits effectifs** : 8 départements seulement ; IC larges et légère sous-couverture des intervalles à ce niveau.

## 9. Reproduire

```
python ml/workload/run.py --db data/dev-ai-load.db --name mixte_medium_s1 --bundle      # ~2 min
python ml/workload/run.py --db data/ml-charge_medium_s1.db --name charge_medium_s1
python -m pytest ml/workload/tests -q
$env:DATABASE_PATH="data/dev-ai-load.db"; npm run topic-model -- register CHARGE_TRAVAIL models/workload/workload-ridge-v1-20260930
npm run topic-model -- promote workload-ridge-v1-20260930
npx vitest run tests/ai/workload                          # + $env:WORKLOAD_PARITY_DB="data/dev-ai-load.db" pour la parité base
```

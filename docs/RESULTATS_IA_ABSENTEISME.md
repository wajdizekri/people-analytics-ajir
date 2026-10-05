# Résultats : prévision de l'absentéisme et recommandations collectives

Prévision à 1, 2 et 3 mois du taux mensuel d'absence **hors santé non planifiée** (absence injustifiée, congé sans solde,
autre ; maladie, maternité et congés annuels exclus) pour l'entreprise, chaque département et chaque équipe d'au moins
5 personnes, avec un intervalle de prévision à 80 %, puis recommandations collectives. Tous les chiffres ci-dessous
sortent de `python -m ml.absenteeism.run` (`ml/absenteeism/results/evaluation.json`, `tables.md`) et des tests Vitest ;
aucune valeur n'est reportée à la main. **Données simulées** (`mixte_medium_s1`, tel qu'importé dans `data/app.db`) :
les conclusions valent pour le simulateur, pas pour une entreprise réelle.

## 1. Cible et données

- **Taux mensuel d'une unité** = Σ jours d'absence / Σ jours ouvrés de présence (embauche ≤ jour ≤ sortie ; jour ouvré =
  `dim_date` hors week-end et férié). Chaque épisode est ventilé au prorata de ses jours ouvrés (même règle que K8 du
  dictionnaire). Rattachement du mois : département et manager **à la date de référence du mois** (fin de mois, ou
  sortie), reconstitués depuis `MUTATION` et `CHANGEMENT_MANAGER` ; une équipe = les subordonnés directs d'un manager.
- **Unités prévues à l'origine O** : entreprise, départements et équipes comptant au moins 5 personnes en poste à la
  fin du mois O (`MIN_GROUP_SIZE`), avec des jours ouvrés dans le mois O.
- 72 mois (2020-09 → 2026-08), 8 départements, 154 équipes éligibles au dernier mois. Taux moyen 0,80 %. Au niveau
  équipe, **49 % des mois sont à zéro** (écart-type 1,36 point pour une moyenne de 0,80) : c'est l'ordre de grandeur du
  bruit à prévoir.

## 2. Protocole (aucune fuite)

- **Origines glissantes** : à chaque origine O (fin de mois), les variables n'utilisent que les mois O-11 à O, et
  seulement les épisodes **saisis au plus tard 10 jours après la fin du mois O** (`recorded_at`, lot du 10 du mois
  suivant) ; 2,4 % des ventilations sont saisies plus tard et sont donc invisibles à l'origine.
- **Apprentissage** à l'origine O : exemples dont la cible t = O' + h vérifie t ≤ O - 1 (cibles complètes à O).
  Modèle réentraîné à chaque origine (fenêtre croissante).
- **Validation** (choix des hyperparamètres) : origines 2023-06 → 2024-05. **Test** (chiffres ci-dessous) : 24 origines
  2024-06 → 2026-05, cibles jusqu'à 2026-08, jamais utilisées pour un choix.
- **Intervalles** : quantiles 10 % et 90 % des résidus hors échantillon normalisés, z = (y - ŷ) / √(max(ŷ ; 0,2 %) / jours
  ouvrés mensuels moyens), par famille (équipe / département + entreprise) et horizon, calculés sur les prévisions
  faites aux origines antérieures dont la cible tombe dans les 24 mois ≤ O - 1.
- **IC 95 %** : bootstrap par blocs de 3 origines consécutives (1 000 tirages), qui conserve la corrélation entre unités
  d'un même mois.

## 3. Modèles comparés

- **Naïf saisonnier** : taux du même mois un an plus tôt.
- **Moyennes mobiles** sur 3 et 12 mois.
- **Ridge direct par horizon** (retenu) : 16 variables — dernier mois, moyennes 3 et 12 mois, retard saisonnier,
  moyenne 12 mois de l'unité parente, tendance (3 mois - 12 mois) de l'unité et de l'entreprise, calendrier tunisien du
  mois prévu (part de jours de Ramadan et écart avec l'année précédente, jours de pont, fériés en semaine, part de
  séance unique hors Ramadan, jours ouvrés), taille (log des jours ouvrés), indicatrices équipe / département. Cible
  exprimée en écart à la moyenne 12 mois ; variables standardisées ; prévision bornée à 0.
- **LightGBM** (comparaison seulement, non exporté) : mêmes variables et même cible, 200 arbres, 15 feuilles.

Validation : grille α ∈ {0,01 ; 0,1 ; 1 ; 10} × cible (écart à la moyenne 12 mois ou taux brut) × pondération (aucune ou
√taille) × modèle commun ou par famille ; critère = moyenne sur les trois portées du rapport MAE / MAE(moyenne 12 mois).
Retenu : **α = 0,1, écart à la moyenne 12 mois, pondération √taille, modèle commun** (score 0,938 ; les modèles séparés
par famille sont moins bons, 0,97 à 1,02).

## 4. Résultats sur la période de test

MAE en points de taux ; « Ridge / MM12 » = MAE du ridge / MAE de la moyenne mobile 12 mois (meilleure baseline).

| Portée | h | n | Taux moyen | Ridge | Naïf saisonnier | MM 3 mois | MM 12 mois | LightGBM | Ridge / MM12 [IC 95 %] | Couverture 80 % [IC 95 %] | Largeur moy. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Entreprise | 1 | 24 | 0,80 % | 0,078 | 0,123 | 0,088 | 0,094 | 0,079 | 0,836 [0,690 ; 0,954] | 75,0 % [62,5 ; 91,7] | 0,25 pt |
| Entreprise | 2 | 24 | 0,79 % | 0,075 | 0,120 | 0,106 | 0,098 | 0,083 | 0,772 [0,666 ; 0,924] | 79,2 % [62,5 ; 91,7] | 0,25 pt |
| Entreprise | 3 | 24 | 0,79 % | 0,079 | 0,118 | 0,115 | 0,097 | 0,076 | 0,810 [0,652 ; 0,927] | 70,8 % [58,3 ; 91,7] | 0,27 pt |
| Département | 1 | 192 | 0,78 % | 0,214 | 0,291 | 0,257 | 0,230 | 0,216 | 0,930 [0,888 ; 0,987] | 84,9 % [80,2 ; 89,1] | 0,76 pt |
| Département | 2 | 192 | 0,77 % | 0,215 | 0,289 | 0,276 | 0,229 | 0,214 | 0,941 [0,903 ; 1,005] | 85,4 % [81,8 ; 89,6] | 0,75 pt |
| Département | 3 | 192 | 0,77 % | 0,216 | 0,290 | 0,263 | 0,227 | 0,214 | 0,952 [0,911 ; 1,021] | 84,4 % [80,7 ; 89,1] | 0,81 pt |
| Équipe | 1 | 3 687 | 0,80 % | 0,857 | 1,092 | 0,947 | 0,904 | 0,868 | 0,949 [0,941 ; 0,958] | 80,9 % [79,8 ; 82,6] | 2,28 pt |
| Équipe | 2 | 3 652 | 0,80 % | 0,857 | 1,089 | 0,960 | 0,904 | 0,873 | 0,949 [0,940 ; 0,961] | 81,3 % [79,2 ; 82,7] | 2,30 pt |
| Équipe | 3 | 3 619 | 0,80 % | 0,858 | 1,102 | 0,976 | 0,907 | 0,871 | 0,945 [0,932 ; 0,957] | 80,4 % [78,5 ; 82,2] | 2,35 pt |

Erreurs relatives (WAPE = Σ|erreur| / Σ taux réel ; sMAPE avec 0 quand prévision et réel sont nuls) :

| Portée | h | Ridge WAPE | Naïf s. | MM3 | MM12 | Ridge sMAPE | Naïf s. | MM3 | MM12 |
|---|---|---|---|---|---|---|---|---|---|
| Entreprise | 1 | 9,8 % | 15,4 % | 11,0 % | 11,7 % | 9,8 % | 15,3 % | 10,9 % | 11,7 % |
| Entreprise | 2 | 9,5 % | 15,1 % | 13,4 % | 12,3 % | 9,4 % | 14,9 % | 13,3 % | 12,2 % |
| Entreprise | 3 | 9,9 % | 14,9 % | 14,6 % | 12,3 % | 9,8 % | 14,6 % | 14,5 % | 12,2 % |
| Département | 1 | 27,6 % | 37,5 % | 33,1 % | 29,7 % | 28,2 % | 37,7 % | 33,6 % | 30,3 % |
| Département | 2 | 27,8 % | 37,5 % | 35,7 % | 29,6 % | 28,4 % | 37,8 % | 35,7 % | 30,1 % |
| Département | 3 | 28,2 % | 37,8 % | 34,3 % | 29,6 % | 28,8 % | 38,3 % | 34,5 % | 30,3 % |
| Équipe | 1 | 106,6 % | 135,9 % | 117,9 % | 112,4 % | 129,1 % | 115,5 % | 127,8 % | 134,9 % |
| Équipe | 2 | 107,0 % | 136,0 % | 119,9 % | 112,8 % | 127,9 % | 115,1 % | 127,0 % | 134,4 % |
| Équipe | 3 | 107,0 % | 137,5 % | 121,9 % | 113,2 % | 127,8 % | 115,2 % | 128,6 % | 134,9 % |

**Lecture.**

- Le ridge a la plus petite MAE et le plus petit WAPE à toutes les portées et tous les horizons. Contre la moyenne
  12 mois (meilleure baseline partout sauf l'entreprise à h = 1), le gain est net pour l'entreprise (-16 à -23 %, IC
  entièrement sous 1), de 5 à 7 % pour les départements (IC sous 1 à h = 1, touchant 1 à h = 2 et 3) et de 5 % pour les
  équipes (IC étroit, sous 1). Entreprise à h = 1 contre la moyenne 3 mois : rapport 0,894 [0,678 ; 1,114], gain non
  démontré. Contre le naïf saisonnier, le gain est de 21 à 37 %.
- LightGBM n'apporte rien de mieux (à ±0,003 point pour l'entreprise et les départements, un peu moins bon pour les
  équipes) : le ridge est retenu, plus simple et reproductible à l'identique en TypeScript.
- Au niveau équipe, l'erreur reste de l'ordre du taux lui-même (WAPE ≈ 107 %) : avec 6 à 10 personnes, un mois tient à
  un ou deux épisodes. La prévision d'équipe sert surtout à estimer le **niveau** attendu, avec un intervalle large
  (2,3 points en moyenne). Le sMAPE n'est pas interprétable à ce niveau : il favorise le naïf saisonnier, qui prévoit 0
  quand le mois de l'année précédente était nul, cas où l'erreur vaut 0 si le mois réel l'est aussi (49 % des mois).
- **Couverture de l'intervalle à 80 %** : 80 à 81 % pour les équipes (IC 78,5-82,7 %), 84-85 % pour les départements
  (légèrement trop large), 71-79 % pour l'entreprise (24 points seulement, IC 58-92 % compatible avec 80 %).

**Ce que le modèle a appris** (bundle final, variables standardisées). La prévision vaut essentiellement la moyenne
12 mois de l'unité **rapprochée de la moyenne générale** (coefficient de ma12 : -0,0032 par écart-type, soit un poids
effectif d'environ 0,35), corrigée du dernier mois et de la tendance récente (+0,0015 et +0,0009). Deux effets
calendaires ressortent : moins de jours ouvrés dans le mois → taux plus élevé (-0,0004 par écart-type de jours ouvrés :
dans le simulateur, le nombre d'absences d'un mois ne dépend pas de sa longueur), et séance unique d'été → taux plus bas
(-0,0004 : une partie de l'effectif est en congé annuel, jours qui ne peuvent pas être des absences non planifiées mais
restent au dénominateur). Ramadan et ponts ont un coefficient quasi nul : le simulateur ne fait pas varier l'absence non
planifiée hors santé avec eux (ses effets portent sur la maladie et les congés, exclus de la cible).

## 5. Bundle, parité et mise en production

- Bundle `models/absenteeism/abs-ridge-v1-20260930/` : `model.json` (un ridge par horizon, quantiles d'intervalle par
  famille et horizon, `visibility_lag_days` = 10, `min_group` = 5, métriques de test) et `golden.json` (200 cas tirés des
  origines d'évaluation, plus les séries, unités et 489 prévisions au 2026-08-31). Entraîné sur 28 133 exemples
  (origines 2021-08 → 2026-07, cibles ≤ 2026-07).
- **Parité TypeScript** (`src/lib/ai/absenteeism/`, `tests/ai/absenteeism/parity.test.ts`) : écart maximal
  8,9 × 10⁻¹⁶ sur les variables et 8,7 × 10⁻¹⁹ sur prévision et bornes (seuil 10⁻⁹). Sur la copie de la base, les
  séries recalculées en TypeScript donnent les mêmes 163 unités éligibles, les mêmes jours ouvrés et les mêmes jours
  d'absence (écart < 10⁻⁹), et les mêmes prévisions.
- Enregistré et promu d'abord sur `data/dev-ai-abs.db` (`npm run topic-model -- register ABSENTEISME … ; promote
  abs-ridge-v1-20260930`), puis CHAMPION de `data/app.db` (état vérifié le 04/10/2026). La version calibrée
  `abs-ridge-v2-20261004` (fourchettes conformes, mêmes coefficients) est livrée dans `models/` mais pas enregistrée.
- Au chargement, seule la structure du bundle est contrôlée (`validateBundle`) ; la parité avec `golden.json` est
  vérifiée par `tests/ai/absenteeism/parity.test.ts`, pas rejouée à l'exécution (contrairement au risque de départ).
- Étape du batch (`runStep`) au 2026-08-31 : 489 prévisions (entreprise, 8 départements, 154 équipes × 3 horizons) en
  environ 0,35 à 1 s ; relancée, elle ne crée aucun doublon.

## 6. Recommandations collectives

Règles (`src/lib/ai/absenteeism/recommendations.ts`), seuils modifiables dans `app_setting` :

| Déclencheur | Condition | Action |
|---|---|---|
| Niveau prévu élevé | une prévision ≥ max(1,5 × taux entreprise sur 12 mois ; taux entreprise + 0,2 pt) (`abs_reco_seuil_niveau` = 0,5, `abs_reco_ecart_min` = 0,002) | Anticiper les remplacements sur la période prévue (priorité haute si ≥ 2 × taux entreprise) |
| Hausse | 3 derniers mois ≥ 12 mois + 0,2 pt, prévision moyenne ≥ 1,25 × taux 12 mois de l'unité (`abs_reco_seuil_hausse`) et au moins égale au taux entreprise | Équipe / département : échanger avec l'équipe sur l'organisation du travail ; entreprise : anticiper les remplacements et plan de prévention santé-sécurité avec la médecine du travail |
| Anomalie persistante | au moins 2 anomalies collectives (module anomalies) sur 3 mois (`abs_reco_anomalies_min`) | Échanger sur l'organisation ; département : aussi plan de prévention |
| Pont | le mois le plus chargé de la prévision contient un pont et dépasse le seuil de niveau | Vérifier la planification des congés autour des ponts (priorité basse) |

Chaque recommandation porte une justification chiffrée en langage RH (taux prévu, fourchette, référence, nombre de
personnes en poste, mois concerné), jamais de nom de salarié ni de donnée de santé ; jamais de portée `SALARIE`.
Audience : équipe → son manager s'il est en poste (sinon RH) ; département → son responsable (unique salarié actif du
département sans manager) sinon RH ; entreprise → RH. Clé de déduplication `abs:<unité>:<mois du calcul>:<action>` ;
une action encore « proposée » pour la même unité n'est pas reproposée les mois suivants. Le « retour à la moyenne »
d'une équipe habituellement peu absente n'est pas une hausse (règle ajoutée après un premier essai où il déclenchait
54 des 130 recommandations du mois).

Volume sur la copie de la base, table vidée avant chaque mois : 48 recommandations au 2025-02-28, 22 au 2025-05-31,
14 au 2025-11-30, 33 au 2026-04-30, 7 au 2026-08-31 (surtout des équipes : « anticiper les remplacements » et « ponts »,
quelques « échanger sur l'organisation » ; 2 au niveau département au 2025-05-31). Les règles ne sont **pas évaluées
contre un effet réel** des actions (aucune vérité terrain sur ce point dans le simulateur).

## 7. Interface et droits

Section « Prévision » de `/absenteeism` (`src/components/ai/absenteeism/`) : courbe observé (24 mois) + prévu (3 mois)
avec bande à 80 %, tableau des taux prévus et fourchettes, liste des recommandations du sujet.
- **RH** : entreprise et tous les départements ; statut de toute recommandation modifiable (proposée, réalisée,
  rejetée) avec commentaire.
- **MANAGER** : uniquement son équipe directe si elle compte au moins 5 personnes en poste ; un mois observé où
  l'équipe comptait moins de 5 présents n'a pas de taux ; il voit les recommandations qui lui sont adressées et peut
  seulement les marquer « réalisées ».
- **ADMIN** : refusé (403, tracé).
Changements de statut par Server Action → DAL (`src/lib/dal/ai-absenteeism.ts`), auditée (`insight.recommendation.update`,
OK ou REFUSE avec ancien et nouveau statut). Tests : `tests/ai/absenteeism/` (18 tests : parité, étape idempotente,
santé ignorée, seuils, périmètres, gardes petits groupes, transitions et audit).

## 8. Limites

- **Données simulées** : absences non planifiées tirées à un rythme mensuel indépendant du calendrier, d'où des effets
  Ramadan et ponts nuls ; sur données réelles, ces variables pourraient compter davantage (ou autrement).
- Une seule graine du simulateur (s1) et 24 origines de test : l'IC de l'entreprise reste large.
- L'intervalle est calibré par famille, pas par unité : un département au comportement atypique peut être mal couvert ;
  les départements sont un peu sur-couverts (85 %).
- Les taux affichés dans la section « Prévision » suivent le rattachement historique (équipe et département du mois),
  alors que les graphiques du haut de la page utilisent le rattachement actuel : écarts possibles pour les équipes
  réorganisées.
- Délai de saisie supposé : lot le 10 du mois suivant (10 jours) ; à ajuster si le calendrier des imports AJIR change.
- Le responsable de département est déduit de la hiérarchie (seul actif sans manager) : à remplacer par une donnée AJIR
  si elle existe.

## Commandes

```
python -m ml.absenteeism.run --db data/app.db --out ml/absenteeism/results                 # évaluation (lecture seule)
python -m ml.absenteeism.run --db data/app.db --bundle models/absenteeism --bundle-only    # bundle + golden
python -m pytest ml/absenteeism/tests -q
$env:DATABASE_PATH="data/dev-ai-abs.db"; npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v1-20260930
npm run topic-model -- promote abs-ridge-v1-20260930
npx vitest run tests/ai/absenteeism
```

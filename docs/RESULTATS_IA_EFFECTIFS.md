# Résultats de l'IA de projection des effectifs et de la masse salariale

Projection à 12 mois, par département et pour l'entreprise, de l'effectif de fin de mois (K1) et de la masse salariale
brute mensuelle (K10), avec intervalles à 80 % et recommandations RH. Tous les chiffres viennent de
`ml/workforce/results/mixte_medium_s1.json`, produit le 30/09/2026 par `python -m ml.workforce.run` sur `data/app.db`
(lecture seule), et de l'exécution de l'étape sur la copie de travail `data/dev-ai-wf.db`.

**Statut des résultats.** Les données sont simulées (`ml/sim`) : ces mesures valident la méthode (protocole temporel,
absence de fuite, parité Python / TypeScript), pas une précision attendue chez un client. Dans ce simulateur l'effectif
est très stable (1 059 à 1 085 salariés sur 72 mois, les embauches compensant les départs), ce qui avantage les baselines
de persistance.

## 1. Données

- 72 mois (2020-09 → 2026-08), 8 départements, 1 069 salariés dans l'effectif K1 au 31/08/2026 (CDI et CDD ; SIVP et
  stages exclus, comme `agg_kpi_monthly`).
- Cibles : `agg_kpi_monthly.headcount` et `agg_kpi_monthly.payroll_mass` (mêmes définitions que le tableau de bord).
- Modèle turnover publié dans `data/app.db` : `b0-v1` (score à règles). Ses points ne sont pas des probabilités : en
  production la projection utilise donc les **taux historiques de démission** ; les probabilités `prob6` ne sont
  additionnées que si le run publié vient d'un modèle LOGREG (vérifié sur le jeu de démonstration, § 6).

## 2. Méthode

**Effectif (modèle `effectif-v1-20260930`, `STOCK_FLUX`).** Chaque salarié présent à la date d'origine t suit une survie
mensuelle sur 12 mois :

- démission : hasard mensuel `1 − (1 − prob6)^(1/6)` si une probabilité publiée existe, sinon taux du département
  (démissions et abandons / effectif du mois précédent, 24 derniers mois) ;
- autres sorties (licenciement, décès, mutation, autre) : taux du département sur 24 mois ;
- fin de CDD : au mois du terme du contrat en vigueur, sortie avec la probabilité de non-renouvellement observée sur les
  24 mois précédents (14,7 % au 31/08/2026 : 42 sorties FIN_CDD pour 285 termes) ;
- retraite : au mois des 60 ans (+ 15 jours), probabilité observée de départ à cet âge (100 % : 18 cas sur 18) ;
- sortie déjà enregistrée (date de sortie future saisie avant t) : sortie certaine à sa date.

Embauches : rythme mensuel moyen des 12 derniers mois par département × hypothèse du scénario (100 % par défaut) ; les
embauchés subissent ensuite les taux du département. Espérance = somme des survies ; variance = Σ S(1 − S) + embauches
(Poisson). Tous les paramètres de flux sont ré-estimés à chaque calcul mensuel à partir de la base (requêtes SQL
partagées, `src/lib/ai/workforce/queries.json`) ; le bundle fige la méthode, les fenêtres, les a priori et la
calibration des intervalles.

**Masse salariale (modèle `masse-v1-20260930`, `REGRESSION_LOG_SAISONNIERE`).**
`masse(d, m) = base projetée(d, m) × exp(niveau_d + saison_mois)` où la base projetée = Σ survies × salaire de base
individuel (équivalent à effectif projeté par grade × salaire moyen du grade) + embauches × salaire moyen des embauchés
des 12 derniers mois, le tout multiplié par `(1 + hausse)^(nombre de janviers franchis) × (1 + dérive)^h`.

- saisonnalité (primes, heures supplémentaires) : régression MCO de `log(masse brute / masse de base des CDI-CDD)` sur
  effet département + effet mois (somme nulle), 576 lignes département × mois, R² 0,633, écart-type résiduel 0,0172.
  Effets mensuels (%, janvier → décembre) : −0,09 ; −0,19 ; −0,40 ; +0,34 ; −0,04 ; +0,26 ; −0,14 ; **−0,61 (août)** ;
  +0,30 ; +0,25 ; +0,21 ; +0,12 ;
- niveau du département : moyenne désaisonnalisée des 12 derniers mois observés ;
- hausse de janvier par défaut : croissance du salaire de base des salariés présents en décembre et janvier lors du
  dernier janvier (5,79 % en janvier 2026) ; dérive hors janvier (promotions) : moyenne des 11 autres mois (+0,068 %
  par mois).

**Intervalles à 80 %.** Conformes : score = |erreur| / écart-type stock-flux pour l'effectif, |erreur| / prévision pour la
masse ; quantile par horizon (rendu croissant), séparément pour les départements et l'entreprise, et selon la source des
démissions (taux ou LOGREG).

## 3. Protocole temporel

- 48 origines mensuelles 2021-09 → 2025-08, 12 horizons chacune (dernière cible 2026-08). À chaque origine t : état et
  taux calculés avec les seules données ≤ t (sorties futures connues seulement si saisies avant t, contrat en vigueur à
  t, paie ≤ t), saisonnalité ré-estimée sur les mois ≤ t.
- Variante LOGREG : recette de production du modèle turnover (`ml/train/models.py`) **réentraînée à chaque origine** sur
  les snapshots dont l'horizon est clos (`t_snapshot + 6 ≤ t`), puis appliquée aux snapshots de t.
- Calibration des intervalles sur les origines 2021-09 → 2022-09 (13 origines, toutes cibles observées avant 2023-09) ;
  **test sur les 24 origines 2023-09 → 2025-08** (288 prévisions entreprise et 2 304 prévisions département par méthode).
- Baselines calculées sur les mêmes séries : naïf (dernière valeur), naïf saisonnier (même mois de l'année précédente),
  naïf saisonnier × croissance annuelle (masse), tendance linéaire sur 24 mois.

## 4. Résultats (période de test)

### 4.1 Effectif

| Méthode | Entreprise : MAE | MAPE | h1 | h3 | h6 | h12 | Biais | Département : MAE | MAPE | h12 |
|---|---|---|---|---|---|---|---|---|---|---|
| Modèle, démissions au taux historique | 7,93 | 0,74 % | 0,43 % | 0,57 % | 0,82 % | 0,96 % | −3,0 | 2,47 | 2,10 % | 2,94 % |
| Modèle, démissions par LOGREG | 11,92 | 1,11 % | 0,49 % | 0,76 % | 1,13 % | 1,62 % | −9,6 | 3,18 | 2,53 % | 3,84 % |
| Naïf (dernière valeur) | **5,72** | **0,53 %** | 0,38 % | 0,50 % | 0,66 % | 0,51 % | 0,0 | **1,87** | **1,61 %** | 1,99 % |
| Naïf saisonnier | 7,75 | 0,72 % | 0,86 % | 0,84 % | 0,76 % | 0,51 % | +1,3 | 2,59 | 2,17 % | 1,99 % |
| Tendance linéaire 24 mois | 10,00 | 0,93 % | 0,61 % | 0,77 % | 0,97 % | 1,10 % | +1,3 | 3,12 | 2,63 % | 3,24 % |

Le modèle bat la tendance linéaire et, jusqu'à 3 mois, le naïf saisonnier (jeu égal en moyenne : 0,74 % contre 0,72 %), mais **pas la persistance** : dans ce
simulateur les embauches suivent les départs, que la persistance reproduit mécaniquement. Le biais négatif du modèle
vient des embauches (rythme des 12 derniers mois : 118,3 attendues par an contre 121,9 réalisées), pas des sorties.

### 4.2 Masse salariale brute

| Méthode | Entreprise : MAE (TND) | MAPE | h1 | h3 | h6 | h12 | Département : MAE | MAPE | h12 |
|---|---|---|---|---|---|---|---|---|---|
| Modèle, démissions au taux historique | 13 870 | 0,86 % | 0,69 % | 0,73 % | 0,79 % | 0,87 % | 3 851 | 2,10 % | 2,66 % |
| Modèle, démissions par LOGREG | 18 710 | 1,15 % | 0,72 % | 0,88 % | 1,11 % | 1,41 % | 4 753 | 2,46 % | 3,39 % |
| Naïf (dernière valeur) | 48 360 | 2,95 % | 1,11 % | 1,62 % | 2,75 % | 4,94 % | 7 009 | 3,44 % | 4,86 % |
| Naïf saisonnier | 80 680 | 4,97 % | 5,06 % | 5,00 % | 4,95 % | 4,94 % | 10 110 | 4,83 % | 4,86 % |
| Naïf saisonnier × croissance | **11 800** | **0,73 %** | 0,82 % | 0,77 % | 0,77 % | 0,65 % | **3 835** | **2,08 %** | 2,06 % |
| Tendance linéaire 24 mois | 23 020 | 1,42 % | 1,53 % | 1,84 % | 1,62 % | 1,28 % | 3 988 | 2,07 % | 2,01 % |

Le modèle divise l'erreur par 3 à 6 face au naïf saisonnier et à la persistance (qui ignorent la hausse de janvier) et
par 1,7 face à la tendance linéaire au niveau entreprise. Il est meilleur que toutes les baselines à 1 et 3 mois, mais
le naïf saisonnier corrigé de la croissance annuelle fait mieux à 6-12 mois et en moyenne (0,73 % contre 0,86 %) ; au
niveau département les trois meilleures méthodes (modèle, naïf saisonnier × croissance, tendance) sont à égalité (2,07 à 2,10 %).

### 4.3 Couverture des intervalles à 80 % (quantiles calibrés sur 2021-09 → 2022-09)

| Série (démissions au taux) | Couverture | h1 | h6 | h12 | Largeur relative à h12 |
|---|---|---|---|---|---|
| Effectif, entreprise | 99,3 % | 96 % | 100 % | 100 % | 6,8 % |
| Effectif, départements | 85,7 % | 82 % | 87 % | 86 % | 11,0 % |
| Masse, entreprise | 98,6 % | 96 % | 100 % | 100 % | 5,8 % |
| Masse, départements | 90,5 % | 90 % | 90 % | 93 % | 13,1 % |

Les intervalles sont conservateurs, surtout pour l'entreprise : les erreurs de la période de calibration (origines
avec 12 à 24 mois d'historique seulement) sont plus fortes que celles du test. Les quantiles du bundle de production
sont recalculés sur les 48 origines (effectif : 1,22 à 1,28 × l'écart-type par département, 1,83 pour l'entreprise ;
masse : 2,5 % à 5,3 % par département, 1,3 % à 1,9 % pour l'entreprise selon l'horizon).

### 4.4 Composantes des sorties sur 12 mois (moyenne des 24 origines de test)

| Composante | Attendu (taux) | Attendu (LOGREG) | Réalisé |
|---|---|---|---|
| Démissions et abandons | 78,8 | 90,2 | 82,6 |
| Fins de CDD non renouvelés | 24,2 | 23,9 | 21,2 |
| Retraites | 4,2 | 4,2 | 4,3 |
| Autres sorties | 10,9 | 10,9 | 13,0 |
| Sorties déjà enregistrées à l'origine | 3,4 | 3,4 | (incluses ci-dessus) |
| Embauches | 118,3 | 118,3 | 121,9 |

Total des sorties attendu 121,5 (taux) pour 121,1 réalisées. **Ablation LOGREG** : additionner les probabilités à 6 mois
et les prolonger à 12 mois surestime les démissions de 9 % (90,2 contre 82,6 ; 45,8 attendues sur les 6 premiers mois)
et dégrade toutes les métriques ; les taux historiques restent la source par défaut, la somme des `prob6` n'est
utilisée que lorsqu'un modèle LOGREG est champion (choix automatique, mentionné dans chaque recommandation).

## 5. Bundles, parité et enregistrement

- `models/workforce/effectif-v1-20260930/` et `models/workforce/masse-v1-20260930/` : `model.json` (méthode,
  fenêtres, a priori, saisonnalité, quantiles d'intervalle, métriques du protocole, projection de référence) et
  `golden.json` (16 cas synthétiques : état, scénario, sortie complète).
- Inférence TypeScript `src/lib/ai/workforce/engine.ts` : reproduit les 16 cas à 1e-9 près pour les deux bundles ;
  l'état recalculé en TypeScript sur `data/dev-ai-wf.db` redonne la projection de référence Python (effectif et masse
  à 1e-9, 1 069 salariés, mêmes taux) — `tests/ai/workforce/parity.test.ts`.
- Enregistrés et promus CHAMPION sur `data/dev-ai-wf.db` (`npm run topic-model -- register EFFECTIF …`, `promote`).

## 6. Production au 31/08/2026 (copie de travail)

- Étape du batch : 216 lignes `forecast` (2 sujets × 12 horizons × entreprise + 8 départements), relance idempotente
  (moins de 3 s).
- Effectif : 1 069 → 1 061,9 en août 2027 [1 036 ; 1 088] ; sorties attendues 123,1 (démissions 78,9, fins de CDD 20,3,
  retraites 10,6, autres 13,3) pour 116 embauches. Département le plus exposé : QUAL, 86 → 81,9 [76,9 ; 86,9].
- Masse brute mensuelle : 1 717 368 TND (août 2026) → 1 804 516 TND en janvier 2027 (hausse de 5,79 %) puis
  1 783 320 TND en août 2027 [1 748 587 ; 1 818 053].
- 16 recommandations RH : 7 « Préparer la succession des départs en retraite » (11 départs à 60 ans, dont un directeur
  G8), 8 « Revoir le renouvellement des CDD arrivant à terme » (≥ 2 termes dans les 3 mois), 1 « Anticiper un
  recrutement au département QUAL : sous-effectif prévu de 4 postes à 12 mois » (priorité moyenne : la borne haute
  couvre l'effectif actuel). Aucune recommandation budgétaire : aucun budget n'est paramétré dans la base (clé
  `app_setting` `budget_masse_salariale_<AAAA>`, montant annuel brut en TND ; l'écran permet aussi d'en saisir un pour
  simulation).

## 7. Écran `/previsions` (RH uniquement)

Scénario modifiable (embauches en % du rythme, hausse de janvier, budget, département des graphiques) recalculé côté
serveur sans écriture ; graphiques observé + projeté avec bande à 80 % et rappel du scénario de référence ; tableau par
département et par grade ; recommandations avec statut modifiable (Server Action, audit `insight.update`) ; consultation
auditée (`workforce.view`, avec le scénario simulé) ; ADMIN et MANAGER redirigés vers `/interdit` et refusés par la DAL
(403 audité). Mention « projection indicative » en tête et en pied de page.

## 8. Limites

- Données simulées ; embauches du simulateur calées sur les départs, d'où la force de la persistance.
- Mutations entre départements ignorées (18 dans l'historique) ; un CDD renouvelé n'est pas re-testé à son nouveau terme
  dans l'horizon.
- Retraite à 60 ans supposée (secteur privé) ; les prolongations observées plus tard ne sont pas modélisées.
- La hausse de janvier par défaut reprend celle de l'an passé ; la hausse de la masse en janvier varie de
  +3,5 % à +6,4 % selon les années de l'historique : une projection qui franchit janvier hérite de cet écart (d'où le
  scénario de hausse modifiable).

## 9. Reproduire

```
python -m ml.workforce.run --db data/app.db --name mixte_medium_s1 --bundle --version-date 20260930   # ~6 min
python -m pytest ml/workforce/tests -q
$env:DATABASE_PATH="data/dev-ai-wf.db"; npm run topic-model -- register EFFECTIF models/workforce/effectif-v1-20260930
npm run topic-model -- register MASSE_SALARIALE models/workforce/masse-v1-20260930
npm run topic-model -- promote effectif-v1-20260930; npm run topic-model -- promote masse-v1-20260930
npx vitest run tests/ai/workforce
```

# Résultats du volet ML hors ligne

Risque de démission à 6 mois : protocole temporel, comparaison B0 / régression logistique / LightGBM, étude de fuite
(Q1), calibration, équité et modèle de production `logreg-v1-20260930`. Tous les chiffres viennent de
`ml/train/results/<jeu>.json`, produits par `ml/train/run.py` le 30/09/2026 ; les tableaux sont générés par
`ml/train/report.py`.

**Statut des résultats.** Les données sont simulées (`ml/sim`). Le simulateur est un banc de test de la méthode
(protocole, absence de fuite, calibration, parité Python / TypeScript), pas une preuve de valeur métier : les AUC et les
lifts ci-dessous dépendent de son rapport signal / bruit et de son mélange de mécanismes de départ, qui ne sont calés sur
aucune donnée ArabSoft.

## 1. Données

| Jeu | Base | Snapshots à suivi complet | Positifs (taux) | Salariés | Démissions distinctes | Snapshots |
|---|---|---|---|---|---|---|
| `mixte_medium_s1` (principal) | `data/app.db` | 65 067 | 2 724 (4,19 %) | 1 704 | 484 | 2020-09 → 2026-02 |
| `mixte_medium_s2` (graine 2) | `data/ml-mixte_medium_s2.db` | 65 471 | 2 216 (3,38 %) | 1 611 | 406 | 2020-09 → 2026-02 |
| `charge_medium_s1` (scénario « charge ») | `data/ml-charge_medium_s1.db` | 65 096 | 2 508 (3,85 %) | 1 704 | 454 | 2020-09 → 2026-02 |

Les deux jeux de réplication (même protocole, mêmes grilles, 3 répétitions au lieu de 5 pour Q1a) n'ont servi à aucun
choix de méthode ; le bundle de production n'est entraîné que sur le jeu principal. Dans le scénario « charge », le
seuil d'insatisfaction porté par les heures supplémentaires est le premier mécanisme de démission.

- Panel : `feature_snapshot` (fsv `v1`, 25 variables dans l'ordre de `shared/features.json`, calculées as-of : événement
  ≤ t **et** saisie ≤ t) joint à `v_label_panel` ; seules les lignes `followup_complete = 1` servent à l'apprentissage et
  à l'évaluation. Lecture seule (`mode=ro`), aucune écriture Python dans les bases.
- Cible `y6` : démission ou abandon dans ]t, t + 6 mois] ; les autres sorties comptent 0 (risque concurrent).
- Capacité RH : `capacity_rate = 0,02` lu dans `app_setting` ; ÉLEVÉ = règle du produit (`rankAndLevel`) appliquée à
  chaque cohorte mensuelle : top `round(n × 2 %)` pris comme plafond, ex-æquo franchissant la limite exclus, B0 à 0
  point jamais ÉLEVÉ.
- Oracle : `ground_truth/oracle_prob6.csv` (vraie probabilité Monte-Carlo, un mois sur trois), joint par matricule et
  fin de mois, jamais utilisé pour apprendre.

## 2. Protocole

**Origines glissantes.** Six origines O = 2023-03, 2023-09, 2024-03, 2024-09, 2025-03, 2025-09 (mois de snapshot).
Pour chacune :

```
snapshots t :  [ apprentissage : t + 6 <= O-11 ] ... [ calibration : O-11 .. O-6 ] ... [ test : O .. O+5 ]
horizons    :   clos avant la 1re cohorte de calibration   clos au plus tard à O      ouverts après O
```

- aucune fenêtre d'étiquette ne se chevauche entre apprentissage, calibration et test ; tout ce qui sert à ajuster ou
  calibrer est connu à l'origine ;
- hyperparamètres choisis par une validation elle aussi temporelle, à l'intérieur de l'apprentissage (les 6 derniers
  mois ; ajustement sur les lignes dont l'horizon se termine avant) ; jamais de validation croisée qui mélange les
  périodes ;
- les prédictions des six fenêtres de test (2023-03 → 2026-02, 36 cohortes mensuelles) sont empilées :
  35 621 snapshots, 1 461 positifs (4,10 %), 1 384 salariés.

| Origine | Apprentissage | Lignes / démissions | Calibration | Test | Lignes / positifs | C | Platt a | LightGBM retenu |
|---|---|---|---|---|---|---|---|---|
| 2023-03 | 2020-09 → 2021-10 | 13 821 / 151 | 2022-04 → 2022-09 | 2023-03 → 2023-08 | 5 993 / 237 | 0,003 | 0,72 | 4 feuilles, 100 min, 59 arbres |
| 2023-09 | 2020-09 → 2022-04 | 19 645 / 182 | 2022-10 → 2023-03 | 2023-09 → 2024-02 | 5 959 / 270 | 0,0003 | 1,10 | 16 feuilles, 400 min, 311 arbres |
| 2024-03 | 2020-09 → 2022-10 | 25 469 / 216 | 2023-04 → 2023-09 | 2024-03 → 2024-08 | 5 881 / 253 | 0,0001 | 1,62 | 4 feuilles, 400 min, 198 arbres |
| 2024-09 | 2020-09 → 2023-04 | 31 449 / 260 | 2023-10 → 2024-03 | 2024-09 → 2025-02 | 5 908 / 237 | 0,0003 | 0,86 | 4 feuilles, 400 min, 200 arbres |
| 2025-03 | 2020-09 → 2023-10 | 37 412 / 302 | 2024-04 → 2024-09 | 2025-03 → 2025-08 | 5 954 / 237 | 3e-05 | 1,45 | 8 feuilles, 400 min, 105 arbres |
| 2025-09 | 2020-09 → 2024-04 | 43 374 / 344 | 2024-10 → 2025-03 | 2025-09 → 2026-02 | 5 926 / 227 | 3e-05 | 1,64 | 8 feuilles, 100 min, 20 arbres |

**Modèles.**

- **B0** : points des `b0_rules` de `features.json` (score à règles, jamais une probabilité ; pas de calibration).
- **LOGREG (protocole)** : variables standardisées (moyenne, écart-type de l'apprentissage), L2, pondération
  `class_weight = balanced` puis recalibration de Platt sur le logit (période de calibration) ; pas de SMOTE.
  C ∈ {3e-5 … 1} choisi par AUC de validation temporelle (arrondie à 1e-4, le plus régularisé en cas d'égalité).
- **LOGREG recette de production** : ce qui est exporté. À l'origine, tout l'historique à horizon clos (t + 6 ≤ O) ;
  C et Platt sont estimés hors échantillon (ajustement sur les lignes dont l'horizon se termine avant les 6 derniers
  mois, validation-calibration sur ces 6 mois), puis les coefficients sont réajustés sur tout l'historique avec ce C,
  Platt conservé. Le bundle final est cette recette appliquée à l'origine « fin des données ».
- **LightGBM** (comparateur hors ligne, jamais déployé) : grille 4 / 8 / 16 feuilles × 100 / 400 lignes minimum par
  feuille, taux 0,02, arrêt précoce sur la validation temporelle, `scale_pos_weight`, Platt sur le score brut.
- Ablations : LOGREG sans pondération ; LOGREG avec Platt intra-échantillon (ajusté sur les lignes d'apprentissage).

**Métriques.** AUC à 6 mois ; PR-AUC (à comparer à la prévalence) ; Brier ; observé / prévu (O/E) ; pente et ordonnée de
calibration (régression logistique de y sur logit(p)) ; precision@k, rappel et lift à la capacité (règle ÉLEVÉ par
cohorte mensuelle). IC 95 % par bootstrap groupé par salarié (1 000 tirages, tous les snapshots d'un salarié tirés
ensemble) ; différences appariées calculées sur les mêmes tirages. L'AUC empilée compare aussi des lignes de fenêtres
différentes : l'AUC par origine est donnée à côté.

## 3. Résultats principaux (`mixte_medium_s1`)

| Modèle | AUC 6 mois [IC 95 %] | PR-AUC | Brier | O/E | Pente de calibration | Précision à 2 % | Lift à 2 % | Rappel à 2 % |
|---|---|---|---|---|---|---|---|---|
| B0 (règles) | 0,560 [0,529 ; 0,590] | 0,050 [0,042 ; 0,059] | n/a | n/a | n/a | 8,5 % | 2,06 [1,10 ; 3,20] | 2,7 % |
| LOGREG (protocole) | 0,625 [0,594 ; 0,657] | 0,072 [0,059 ; 0,088] | 0,0391 | 1,00 [0,88 ; 1,12] | 0,81 [0,63 ; 1,00] | 13,1 % | 3,19 [2,30 ; 4,15] | 6,4 % |
| **LOGREG recette de production** | **0,631 [0,599 ; 0,664]** | 0,074 [0,061 ; 0,092] | 0,0390 | 1,00 [0,88 ; 1,12] | 0,84 [0,67 ; 1,02] | 13,6 % | 3,33 [2,41 ; 4,33] | 6,7 % |
| LightGBM | 0,627 [0,597 ; 0,657] | 0,074 [0,059 ; 0,096] | 0,0389 | 1,01 [0,89 ; 1,13] | 0,84 [0,62 ; 1,06] | 12,6 % | 3,06 [2,14 ; 4,06] | 6,2 % |
| LOGREG sans pondération | 0,623 [0,592 ; 0,655] | 0,073 [0,059 ; 0,090] | 0,0390 | 0,99 [0,88 ; 1,12] | 0,80 [0,62 ; 0,98] | 12,8 % | 3,12 [2,26 ; 4,09] | 6,3 % |
| LOGREG, Platt intra-échantillon | 0,637 [0,606 ; 0,669] | 0,076 [0,063 ; 0,094] | 0,0391 | 0,95 [0,84 ; 1,07] | 0,74 [0,60 ; 0,89] | 13,6 % | 3,33 [2,41 ; 4,33] | 6,7 % |

Prévalence du test 4,10 %. B0 ne classe ÉLEVÉ que 1,3 % de l'effectif (ex-æquo de points exclus à la limite), les
modèles probabilistes 2,0 %.

| Différence appariée | ΔAUC [IC 95 %] | ΔPR-AUC [IC 95 %] | Δlift à 2 % [IC 95 %] | Tirages ΔAUC ≤ 0 |
|---|---|---|---|---|
| LOGREG (protocole) − B0 | 0,065 [0,034 ; 0,096] | 0,021 [0,013 ; 0,032] | 1,13 [−0,05 ; 2,27] | 0,0 % |
| LOGREG recette − B0 | 0,071 [0,038 ; 0,103] | 0,024 [0,015 ; 0,036] | 1,27 [0,08 ; 2,39] | 0,0 % |
| LightGBM − LOGREG (protocole) | 0,002 [−0,013 ; 0,019] | 0,003 [−0,006 ; 0,013] | −0,13 [−1,05 ; 0,74] | 39,7 % |
| LightGBM − LOGREG recette | −0,003 [−0,020 ; 0,013] | −0,000 [−0,009 ; 0,009] | −0,27 [−1,08 ; 0,53] | 65,8 % |
| LOGREG recette − LOGREG (protocole) | 0,006 [−0,002 ; 0,013] | 0,003 [−0,000 ; 0,006] | 0,14 [−0,32 ; 0,61] | 7,4 % |
| LOGREG pondérée − non pondérée | 0,002 [−0,002 ; 0,006] | −0,001 [−0,004 ; 0,001] | 0,07 [−0,30 ; 0,42] | 22,8 % |

**Plafond (oracle).** Sur les 11 855 snapshots de test où l'oracle existe (un mois sur trois, 488 positifs, 4,12 %) :
oracle 0,796 [0,767 ; 0,825], LOGREG recette 0,628 [0,593 ; 0,664], LOGREG 0,621 [0,587 ; 0,656], LightGBM 0,622
[0,587 ; 0,655], B0 0,560 [0,528 ; 0,592]. L'essentiel du signal du simulateur passe par des latents sans variable
exportée (qualité du manager, offres externes, événements personnels).

**Par origine** (AUC ; lift et O/E de la recette) :

| Origine | Test (lignes / positifs) | B0 | LOGREG | Recette | LightGBM | Lift recette | O/E recette |
|---|---|---|---|---|---|---|---|
| 2023-03 | 5 993 / 237 | 0,594 | 0,664 | 0,685 | 0,652 | 2,74 | 1,11 |
| 2023-09 | 5 959 / 270 | 0,567 | 0,638 | 0,651 | 0,631 | 1,84 | 1,22 |
| 2024-03 | 5 881 / 253 | 0,552 | 0,615 | 0,618 | 0,627 | 3,15 | 0,99 |
| 2024-09 | 5 908 / 237 | 0,538 | 0,577 | 0,577 | 0,588 | 4,57 | 0,86 |
| 2025-03 | 5 954 / 237 | 0,549 | 0,645 | 0,643 | 0,652 | 3,35 | 0,93 |
| 2025-09 | 5 926 / 227 | 0,561 | 0,638 | 0,647 | 0,645 | 4,57 | 0,94 |

## 4. Calibration, lift et courbe de décision (recette de production)

Critères du plan (O/E dans [0,8 ; 1,25], pente dans [0,8 ; 1,2], lift ≥ 3 à la capacité) : O/E 1,00 [0,88 ; 1,12],
pente 0,84 [0,67 ; 1,02], lift 3,33 [2,41 ; 4,33] ; O/E par origine entre 0,86 et 1,22. Les points sont dans les cibles,
mais la borne basse de l'IC de la pente et celle du lift sortent de la plage : la pente < 1 signale des estimations un
peu trop dispersées (léger surajustement ou dérive). Le Platt intra-échantillon donne une pente de 0,74 et un O/E de
0,95 : estimer Platt hors échantillon temporel, comme la recette, est nécessaire.

| Décile | Estimation moyenne | Taux observé | Effectif |
|---|---|---|---|
| 1 | 1,58 % | 1,88 % | 3 562 |
| 2 | 2,22 % | 2,50 % | 3 562 |
| 3 | 2,63 % | 2,95 % | 3 562 |
| 4 | 2,98 % | 3,20 % | 3 562 |
| 5 | 3,33 % | 3,14 % | 3 562 |
| 6 | 3,71 % | 3,79 % | 3 562 |
| 7 | 4,17 % | 3,76 % | 3 562 |
| 8 | 4,77 % | 5,14 % | 3 562 |
| 9 | 5,76 % | 5,36 % | 3 562 |
| 10 | 9,91 % | 9,29 % | 3 563 |

| Part ciblée chaque mois | 1 % | 2 % (capacité) | 5 % | 10 % | 20 % |
|---|---|---|---|---|---|
| Précision | 13,9 % | 13,6 % | 12,2 % | 9,7 % | 7,7 % |
| Lift | 3,39 | 3,33 | 2,97 | 2,37 | 1,87 |
| Rappel | 3,4 % | 6,7 % | 14,9 % | 23,8 % | 37,4 % |

Courbe de décision (bénéfice net par salarié, seuil = coût relatif d'une action inutile) : le modèle fait jeu égal avec
« tous ciblés » à 1-2 %, le dépasse à partir de 3 % (0,0127 contre 0,0114), reste positif jusqu'à 15 % (0,0001) et
devient négatif à 20 % (−0,0003). Avec 4 % de positifs, un seuil de probabilité laisserait la classe ÉLEVÉ vide : le
produit garde la règle de capacité, la courbe reste une analyse (exportée dans `metrics.decision_curve`).

## 5. Étude Q1

### (a) Inflation selon le découpage

Même famille de modèles, hyperparamètres réglés à l'intérieur de chaque protocole avec sa propre logique (validation
tirée au hasard par ligne, par salarié, ou sur les derniers mois). 5 répétitions pour les découpages aléatoires (25 %
en test), 6 origines pour le temporel. « Fenêtre » = AUC des découpages aléatoires recalculée sur les seuls snapshots de
la fenêtre de test temporelle (2023-03 → 2026-02), pour séparer la fuite de l'effet de population (B0, qui n'apprend
rien, varie de 0,560 à 0,596 selon la population de test).

| Découpage | AUC B0 | AUC LOGREG | AUC LightGBM | Inflation LOGREG | Inflation LightGBM | LOGREG (fenêtre) | LightGBM (fenêtre) | Inflation LOGREG (fenêtre) | Inflation LightGBM (fenêtre) |
|---|---|---|---|---|---|---|---|---|---|
| aléatoire par ligne | 0,596 ± 0,008 | 0,682 ± 0,011 | 0,925 ± 0,008 | +0,044 | +0,285 | 0,663 | 0,927 | +0,026 | +0,288 |
| aléatoire par ligne + variables naïves | 0,602 ± 0,009 | 0,690 ± 0,009 | 0,932 ± 0,007 | +0,053 | +0,292 | 0,673 | 0,932 | +0,036 | +0,293 |
| par salarié | 0,595 ± 0,008 | 0,648 ± 0,023 | 0,653 ± 0,021 | +0,011 | +0,014 | 0,619 | 0,628 | −0,018 | −0,012 |
| temporel (référence) | 0,560 ± 0,019 | 0,637 ± 0,036 | 0,640 ± 0,030 | 0 | 0 | 0,637 | 0,640 | 0 | 0 |

(temporel = moyenne des AUC par origine, apprentissage sur tout l'historique à horizon clos à l'origine.)

Le découpage aléatoire par ligne est la fuite dominante : un même salarié apparaît en apprentissage et en test sur des
mois voisins, avec la même étiquette. LightGBM la mémorise (la validation aléatoire lui fait choisir 16 feuilles et
2 000 arbres) et annonce 0,925 au lieu de 0,640 (+0,29). La logistique, peu flexible, gonfle de +0,026 (fenêtre) à
+0,044. Le
découpage par salarié ne gonfle presque pas (et devient pessimiste sur la fenêtre), mais il reste inutilisable pour
régler la calibration dans le temps (dérive du taux de base, O/E par origine de 0,86 à 1,22).

Réplication (3 répétitions) : LightGBM en découpage aléatoire par ligne annonce 0,939 contre 0,651 en temporel sur la
graine 2 (+0,29) et 0,947 contre 0,700 en « charge » (+0,25) ; la logistique gonfle de +0,03 et +0,06 (+0,025 et
+0,016 sur la fenêtre) ; le découpage par salarié reste entre −0,012 et +0,034.

### (b) Variables sur la date d'événement (mode naïf) contre date de saisie

`npx tsx scripts/export-panel.ts --mode naive` recalcule les 25 variables en ignorant `recorded_at` (population et
éligibilité inchangées). Lignes modifiées : compa-ratio 48 % (paie du mois saisie le mois suivant), jours sans badge
13 %, évolution et dernière note d'évaluation 13 % et 11 % (saisies 30 à 120 jours après la campagne), taux d'absence
sur 12 mois 6 %, heures supplémentaires 4 %, puis moins de 4 % pour les autres. Même protocole temporel ; trois
lectures : as-of → as-of (honnête), naïf → naïf (ce qu'annonce une étude naïve), naïf → as-of (ce qu'obtient en
production un modèle appris en naïf, puisque la production ne voit que les saisies).

| Variante | AUC [IC 95 %] | Lift à 2 % [IC 95 %] | O/E |
|---|---|---|---|
| B0, variables as-of | 0,560 [0,529 ; 0,590] | 2,06 [1,10 ; 3,20] | n/a |
| B0, variables naïves | 0,565 [0,535 ; 0,595] | 2,27 [1,25 ; 3,47] | n/a |
| LOGREG as-of → as-of | 0,625 [0,594 ; 0,657] | 3,19 [2,30 ; 4,15] | 1,00 |
| LOGREG naïf → naïf (annoncé) | 0,634 [0,601 ; 0,665] | 3,70 [2,78 ; 4,62] | 1,00 |
| LOGREG naïf → as-of (obtenu) | 0,628 [0,599 ; 0,658] | 2,95 [2,15 ; 3,79] | 0,90 |
| LightGBM as-of → as-of | 0,627 [0,597 ; 0,657] | 3,06 [2,14 ; 4,06] | 1,01 |
| LightGBM naïf → naïf (annoncé) | 0,635 [0,606 ; 0,665] | 3,86 [2,87 ; 4,87] | 1,02 |
| LightGBM naïf → as-of (obtenu) | 0,628 [0,600 ; 0,658] | 3,65 [2,65 ; 4,63] | 0,98 |

| Différence appariée | ΔAUC [IC 95 %] | Δlift [IC 95 %] |
|---|---|---|
| LOGREG naïf → naïf − as-of → as-of | +0,009 [0,001 ; 0,017] | +0,51 [−0,00 ; 0,98] |
| LOGREG naïf → as-of − as-of → as-of | +0,003 [−0,003 ; 0,010] | −0,24 [−0,76 ; 0,25] |
| LightGBM naïf → naïf − as-of → as-of | +0,007 [−0,002 ; 0,017] | +0,80 [0,17 ; 1,45] |
| LightGBM naïf → as-of − as-of → as-of | +0,001 [−0,008 ; 0,010] | +0,59 [0,04 ; 1,14] |
| B0 naïf − B0 as-of | +0,005 [0,001 ; 0,008] | +0,21 [−0,04 ; 0,51] |

Sur ce simulateur (délais de saisie courts : absences 0 à 15 jours, paie un mois, évaluations 1 à 4 mois), la fuite par
la date de saisie est faible en AUC (+0,01) mais visible sur le lift : pour la logistique, l'étude naïve annonce un lift
de 3,70 quand le même modèle obtient 2,95 en production (écart 0,75 ; −0,24 par rapport au modèle honnête), avec un O/E
qui tombe à 0,90. Combinée au découpage aléatoire (tableau (a)), la fuite totale annoncée atteint +0,05 d'AUC pour la
logistique et +0,29 pour LightGBM.

Réplication : lift annoncé en naïf contre lift obtenu en production par la logistique 4,94 contre 4,09 (graine 2) et
7,19 contre 6,49 (« charge ») ; O/E en production 0,93 et 0,91. En « charge », le modèle appris en naïf perd 0,65 de
lift face au modèle honnête (IC [−1,28 ; −0,07]). Les AUC bougent de −0,001 à +0,013.

### (c) Gain sur B0

Sur le jeu principal, la logistique bat B0 : ΔAUC +0,065 [0,034 ; 0,096] (protocole) et +0,071 [0,038 ; 0,103]
(recette), aucun tirage bootstrap ≤ 0 ; ΔPR-AUC +0,024 [0,015 ; 0,036] ; lift à la capacité 3,33 contre 2,06 (Δ +1,27
[0,08 ; 2,39]). LightGBM n'apporte rien sur la logistique (ΔAUC +0,002 [−0,013 ; 0,019] ; −0,003 face à la recette) :
il reste un comparateur hors ligne, sans raison de l'industrialiser (ONNX, parité) sur ces données.

**Réplication.**

| Jeu | AUC B0 | AUC LOGREG | AUC recette | AUC LightGBM | Oracle | LOGREG − B0 | LightGBM − LOGREG | Lift recette / B0 | Δlift recette − B0 | O/E recette | Pente recette |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mixte s1 | 0,560 [0,529 ; 0,590] | 0,625 [0,594 ; 0,657] | 0,631 [0,599 ; 0,664] | 0,627 [0,597 ; 0,657] | 0,796 | +0,065 [0,034 ; 0,096] | +0,002 [−0,013 ; 0,019] | 3,33 / 2,06 | +1,27 [0,08 ; 2,39] | 1,00 | 0,84 |
| mixte s2 | 0,613 [0,580 ; 0,649] | 0,671 [0,637 ; 0,705] | 0,675 [0,640 ; 0,709] | 0,646 [0,611 ; 0,679] | 0,788 | +0,057 [0,020 ; 0,095] | −0,024 [−0,047 ; −0,003] | 3,38 / 3,82 | −0,44 [−1,93 ; 0,81] | 0,98 | 0,82 |
| charge s1 | 0,657 [0,619 ; 0,691] | 0,655 [0,613 ; 0,696] | 0,664 [0,623 ; 0,704] | 0,666 [0,626 ; 0,704] | 0,769 | −0,002 [−0,045 ; 0,040] | +0,011 [−0,013 ; 0,034] | 7,47 / 3,43 | +4,04 [1,92 ; 6,18] | 0,94 | 0,93 |

(Oracle : AUC sur le sous-ensemble un mois sur trois ; prévalence du test 4,10 %, 3,12 % et 2,98 %.)

- Le gain d'AUC de la logistique sur B0 se reproduit sur la seconde graine (+0,057, IC hors de 0) mais disparaît dans
  le scénario « charge » : les règles de B0 (heures supplémentaires, épisodes courts, compa-ratio) y coïncident avec le
  mécanisme dominant.
- AUC et lift à la capacité ne classent pas les modèles de la même façon : en « charge », AUC égales mais la logistique
  double le lift de B0 (7,47 contre 3,43) et gagne en PR-AUC (+0,052 [0,027 ; 0,084]) ; sur la graine 2, meilleure AUC
  mais le haut de liste de B0 est au moins aussi bon (3,82 contre 3,38, écart non significatif). Une porte de promotion
  doit regarder les deux.
- LightGBM ne bat la logistique sur aucun jeu (significativement moins bon sur la graine 2).
- Calibration de la recette : O/E 0,94 à 1,00 et pente 0,82 à 0,93 sur les trois jeux, mais O/E par origine de 0,74 à
  1,22 (graine 2) et de 0,62 à 1,30 (« charge ») : la calibration suit mal les variations de taux de base d'un semestre
  à l'autre.

### (d) Courbe d'apprentissage et règle produit B0 / LOGREG

Sous-échantillons de salariés du panel (100, 200, 400, 800, tous = 1 704), 20 / 20 / 15 / 10 / 1 tirages, recette de
production entraînée sur l'historique de ces seuls salariés à chacune des 6 origines, évaluée avec B0 sur **toute** la
cohorte de test de l'origine (évaluation appariée, AUC B0 identique). « Démissions observées » = salariés distincts
avec au moins un snapshot positif dans l'historique d'apprentissage (horizon clos à l'origine).

| Salariés tirés | Éligibles / mois | Essais | Démissions observées (médiane, min-max) | AUC LOGREG (± é.-t.) | ΔAUC vs B0 | P(LOGREG > B0) | AUC LightGBM | P(LightGBM > LOGREG) | O/E dans [0,8 ; 1,25] | Lift LOGREG | Lift B0 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 57 | 120 | 18 (6-33) | 0,582 ± 0,041 | +0,022 | 76 % | 0,565 | 30 % | 24 % | 2,41 | 2,13 |
| 200 | 116 | 120 | 37 (16-62) | 0,610 ± 0,032 | +0,050 | 97 % | 0,591 | 26 % | 41 % | 2,71 | 2,13 |
| 400 | 233 | 90 | 71 (38-108) | 0,623 ± 0,031 | +0,063 | 100 % | 0,610 | 33 % | 59 % | 3,22 | 2,13 |
| 800 | 464 | 60 | 151 (91-216) | 0,633 ± 0,036 | +0,073 | 100 % | 0,626 | 42 % | 80 % | 3,12 | 2,13 |
| 1 704 | 986 | 6 | 319 (215-418) | 0,637 ± 0,036 | +0,077 | 100 % | 0,641 | 83 % | 100 % | 3,37 | 2,13 |

| Démissions observées | Essais | ΔAUC moyen | 10e centile de ΔAUC | P(LOGREG > B0) | P(LightGBM > LOGREG) | O/E dans [0,8 ; 1,25] |
|---|---|---|---|---|---|---|
| [0 ; 10[ | 10 | +0,014 | −0,041 | 60 % | 30 % | 10 % |
| [10 ; 20[ | 67 | +0,018 | −0,027 | 72 % | 24 % | 27 % |
| [20 ; 30[ | 75 | +0,041 | +0,002 | 91 % | 28 % | 33 % |
| [30 ; 50[ | 83 | +0,049 | +0,016 | 96 % | 28 % | 43 % |
| [50 ; 75[ | 54 | +0,058 | +0,031 | 100 % | 31 % | 43 % |
| [75 ; 100[ | 38 | +0,070 | +0,036 | 100 % | 39 % | 71 % |
| [100 ; 150[ | 32 | +0,071 | +0,050 | 100 % | 34 % | 75 % |
| [150 ; 200[ | 29 | +0,069 | +0,034 | 100 % | 52 % | 83 % |
| ≥ 200 (3 tranches regroupées) | 8 | +0,067 à +0,087 | ≥ +0,045 | 100 % | 60 à 100 % | 80 à 100 % |

Critère fixé avant la lecture des résultats : première tranche de démissions observées à partir de laquelle, dans elle
et toutes les suivantes (tranches d'au moins 5 essais), la logistique bat B0 dans au moins 90 % des essais avec un gain
moyen d'AUC d'au moins 0,02. Il donne **20 démissions** sur le jeu principal, mais n'est jamais atteint sur la graine 2
(même avec toutes les données, la logistique perd l'origine 2025-09 : 83 % de victoires) ni en « charge ». Critères
plus faibles, calculés par `propose_threshold` :

| Jeu | Gain moyen d'AUC ≥ 0,02 (N1 AUC) | + 90 % de victoires (N1 strict) | O/E dans [0,8 ; 1,25] dans ≥ 2/3 des essais (N calibration) | LightGBM > LOGREG dans ≥ 90 % (N2) |
|---|---|---|---|---|
| mixte s1 | 20 | 20 | 75 | jamais |
| mixte s2 | 30 | jamais | 150 | jamais |
| charge s1 | jamais | jamais | jamais | jamais |
| 3 jeux regroupés | **30** | jamais | **150** | jamais |

Trois jeux regroupés (1 188 couples essai × origine) :

| Démissions observées | Essais | ΔAUC moyen | 10e centile de ΔAUC | P(AUC LOGREG > B0) | Δlift moyen | P(lift LOGREG > B0) | P(LightGBM > LOGREG) | O/E dans [0,8 ; 1,25] |
|---|---|---|---|---|---|---|---|---|
| [0 ; 10[ | 14 | +0,008 | −0,043 | 57 % | −0,86 | 29 % | 36 % | 29 % |
| [10 ; 20[ | 230 | +0,000 | −0,063 | 55 % | +0,06 | 51 % | 26 % | 27 % |
| [20 ; 30[ | 212 | +0,016 | −0,047 | 68 % | +0,22 | 51 % | 22 % | 30 % |
| [30 ; 50[ | 263 | +0,020 | −0,051 | 68 % | +0,92 | 66 % | 28 % | 41 % |
| [50 ; 75[ | 165 | +0,039 | −0,000 | 90 % | +1,11 | 68 % | 36 % | 36 % |
| [75 ; 100[ | 112 | +0,036 | −0,022 | 77 % | +1,45 | 71 % | 38 % | 57 % |
| [100 ; 150[ | 97 | +0,054 | +0,025 | 96 % | +1,43 | 67 % | 34 % | 59 % |
| [150 ; 200[ | 74 | +0,029 | −0,049 | 73 % | +1,70 | 70 % | 53 % | 69 % |
| [200 ; 300[ | 12 | +0,063 | +0,041 | 100 % | +1,25 | 75 % | 58 % | 67 % |
| [300 ; 400[ | 7 | +0,025 | −0,028 | 71 % | +2,22 | 71 % | 57 % | 86 % |
| ≥ 400 | 2 | +0,072 | +0,059 | 100 % | +2,77 | 100 % | 50 % | 50 % |

Le lift (colonnes Δlift, lecture exploratoire, non fixée avant) raconte une autre histoire selon le scénario : en
« charge », la logistique bat B0 à la capacité dans 97 % des essais dès 30 démissions alors que son AUC ne le bat pas ;
sur la graine 2, elle ne bat le lift de B0 dans aucune tranche de façon stable.

**Règle produit proposée** (indicative, à revoir sur le premier client) :

- **moins de 30 démissions observées** (démissions ou abandons distincts dont l'horizon de 6 mois est clos) : B0 seul ;
  la logistique y gagne en moyenne moins de 0,02 d'AUC, perd contre B0 dans 32 à 45 % des essais et son O/E sort de la
  plage dans plus de 2 essais sur 3 ;
- **à partir de 30** : la logistique peut être entraînée et enregistrée CANDIDAT ; elle n'est promue que si le backtest
  temporel sur les données du client montre une AUC non inférieure à B0 (borne basse de ΔAUC ≥ −0,02), un lift à la
  capacité au moins égal à celui de B0 et un O/E dans [0,8 ; 1,25]. Sur nos jeux, la graine 1 passe ; la graine 2
  échoue sur le lift ; « charge » échoue sur la non-infériorité d'AUC (borne basse −0,034) malgré un lift doublé : la
  marge d'AUC est à rediscuter si la capacité RH reste l'usage réel du score ;
- **sous 150 démissions**, l'O/E reste hors plage dans plus d'un essai sur trois : la probabilité doit être présentée
  comme indicative et Platt réestimé à chaque réentraînement ;
- **LightGBM** : aucun seuil N2 trouvé, pas d'industrialisation.

## 6. Équité (recette de production, test empilé, capacité 2 %)

Rapport, pas de blocage : sexe et âge ne sont pas des variables du modèle. Aucune donnée n'est affichée par l'écran
Transparence sous 30 personnes. IC 95 % par bootstrap groupé (500 tirages). Sur un simulateur, c'est une démonstration
de l'outil ; l'interprétation est réservée aux données client.

| Groupe | Snapshots | Positifs | Taux observé | Estimation moyenne | O/E [IC] | Sélection ÉLEVÉ [IC] | TPR [IC] | FPR | AUC |
|---|---|---|---|---|---|---|---|---|---|
| Femmes | 14 226 | 576 | 4,05 % | 4,05 % | 1,00 [0,82 ; 1,21] | 1,76 % [1,35 ; 2,22] | 5,7 % [3,6 ; 7,8] | 1,60 % | 0,660 |
| Hommes | 21 395 | 885 | 4,14 % | 4,15 % | 1,00 [0,83 ; 1,18] | 2,18 % [1,82 ; 2,60] | 7,3 % [4,8 ; 10,3] | 1,96 % | 0,612 |
| < 30 ans | 7 502 | 300 | 4,00 % | 4,11 % | 0,97 [0,74 ; 1,23] | 1,92 % [1,43 ; 2,53] | 6,3 % [3,3 ; 9,9] | 1,74 % | 0,644 |
| 30-44 ans | 22 064 | 943 | 4,27 % | 4,11 % | 1,04 [0,88 ; 1,22] | 2,06 % [1,73 ; 2,45] | 7,6 % [5,1 ; 10,2] | 1,81 % | 0,635 |
| 45 ans et plus | 6 055 | 218 | 3,60 % | 4,11 % | 0,88 [0,59 ; 1,18] | 1,97 % [1,32 ; 2,75] | 3,2 % [0,5 ; 6,1] | 1,92 % | 0,598 |

Calibration comparable entre sexes (O/E 1,00 et 1,00) ; les femmes sont un peu moins souvent sélectionnées (1,76 %
contre 2,18 %, IC qui se recouvrent) pour un taux observé presque égal ; les 45 ans et plus ont un TPR bas (3,2 %,
IC large) et un O/E de 0,88 (risque légèrement surestimé). Sens du préjudice retenu par le plan : le sous-ciblage d'un
groupe si ÉLEVÉ déclenche un entretien ou une révision salariale.

**Proxys (information mutuelle, un snapshot tiré par salarié, 1 704 salariés).** Âge (entropie 0,954 nats) :
`grade_level` 0,194 nats (20 % de l'entropie), `tenure_months` 0,137 (14 %), `contract_cdd` 0,062 (6,5 %),
`overtime_h_avg_3m` 0,058 (6,1 %). Sexe (0,670 nats) : aucune variable au-delà de 2,5 % (`team_size` 0,017,
`absence_rate_3m` 0,016, `team_exit_rate_6m` 0,013). Le grade et l'ancienneté portent l'âge : c'est attendu et ils sont
légitimes, mais toute règle future sur ces variables doit être relue sous cet angle.

## 7. Modèle de production exporté

`models/turnover/logreg-v1-20260930/` (format de `docs/CONVENTIONS.md`) : `model.json` + `golden.json` (200 lignes :
150 tirées au hasard, les 50 estimations les plus hautes).

- Apprentissage : 65 067 snapshots à suivi complet (`train_from` 2020-09-30, `train_to` 2026-02-28), 2 724 positifs,
  `base_rate` 0,0419, `data_hash` = sha256 des lignes (employee_id, as_of, values_json, y6) ; C = 1, L2, pondération
  équilibrée ; Platt a = 0,837, b = −3,193, estimé sur les 5 926 snapshots de 2025-09 → 2026-02 avec le modèle ajusté
  jusqu'à 2025-03 (O/E intra-échantillon sur tout l'historique 1,09 : la calibration suit le taux de base récent).
- Plus forts coefficients (unités d'écart-type, avant Platt) : compa-ratio −0,26, épisodes courts +0,25, départs de
  l'équipe +0,24, Bradford −0,18 (compensé par les autres variables d'absence, corrélées), taux d'absence 3 mois +0,16,
  CDD +0,16, jours sans badge +0,16, heures de formation −0,14, mois sans promotion +0,14.
- `metrics` (lu par l'écran Transparence) : AUC, IC, PR-AUC, Brier, bloc `eval`, `calibration` (O/E, pente, déciles),
  `lift` (capacité et courbe), `decision_curve`, `fairness` (sexe, tranche d'âge, information mutuelle),
  `comparison` (B0, LightGBM, ablations, oracle, différences appariées), `per_origin`, `golden`. Ce sont les métriques de
  la recette de production rejouée aux 6 origines, pas celles du modèle final (sans données postérieures pour
  l'évaluer).
- Parité : `npx tsx scripts/model.ts register` puis `verify` reproduisent le golden avec un écart maximal de
  1,1e-16 (tolérance 1e-9), sur une base vierge et sur `data/app.db`. Le modèle a d'abord été enregistré **CANDIDAT** ;
  il a été promu **CHAMPION** de `data/app.db` le 30/09/2026 (`model.ts promote`, `b0-v1` passe RETIRE et reste le
  repli de démarrage à froid).

## 8. Limites et menaces à la validité

- **Simulateur.** Les valeurs absolues (AUC 0,63 à 0,68, lift 3,3 à 7,5, seuils de 30 et 150 démissions) mesurent le rapport signal / bruit
  du simulateur, pas celui d'un client. Les mécanismes sont non logit par construction, ce qui évite de favoriser la
  logistique, mais l'oracle (0,80) montre que l'essentiel du signal simulé est latent : sur données réelles, l'écart
  modèle / B0 peut être plus petit ou plus grand.
- **Degrés de liberté du chercheur.** Les grilles (C jusqu'à 3e-5, feuilles LightGBM 4 à 16) ont été élargies après un
  premier passage sur `mixte_medium_s1` ; les jeux de réplication n'ont servi à aucun choix. Les critères de seuil
  « faibles » (N1 AUC, N calibration) et la lecture par le lift ont été ajoutés après avoir vu la graine 2 : ils sont
  exploratoires.
- **Scénario.** Le gain de la logistique sur B0 dépend du scénario (nul en AUC dans « charge ») : trois jeux simulés ne
  couvrent pas la variété des clients.
- **Dépendances.** Le bootstrap groupé par salarié ignore les dépendances entre salariés d'une même équipe et les chocs
  de marché communs à un mois : les IC sont probablement un peu étroits. Les six fenêtres de test se suivent (pas de
  chevauchement d'étiquettes) mais partagent la dérive du simulateur.
- **AUC empilée.** Elle mélange des origines calibrées différemment ; l'AUC par origine (tableau section 3) varie de
  0,577 à 0,685 pour la recette.
- **Oracle.** Disponible un mois sur trois ; il utilise ses propres dates vraies alors que l'évaluation utilise les
  étiquettes de `v_label_panel` (dates de démission manquantes à 42 %, démissions exportées en `AUTRE`, saisies
  tardives) : le plafond mesuré (0,796) est inférieur à l'AUC oracle du simulateur (0,844).
- **Mode naïf.** Il ne change que la visibilité des variables, pas la population : il mesure la fuite par les variables
  seules. Les délais de saisie du simulateur sont courts ; un client avec des saisies plus tardives aura une fuite plus
  forte.
- **Courbe d'apprentissage.** Les sous-échantillons viennent d'une seule entreprise : les variables d'équipe restent
  calculées sur l'organisation complète, et le test porte sur toute la cohorte ; le seuil proposé est indicatif et doit
  être revu sur les données du premier client (porte de promotion : backtest temporel, O/E, équité).
- **Calibration.** La pente (0,84) est dans la cible mais sa borne basse (0,67) en sort ; l'O/E dépend du taux de base
  récent (Platt estimé sur les 6 derniers mois) : une rupture de conjoncture exige une recalibration.
- **Coefficients.** Certaines variables corrélées ont un signe contraire à leur effet univarié (Bradford) ; l'écran
  explique par groupe, où ces effets se compensent. Aucune contrainte de signe n'est appliquée.
- **Horizons.** Seul l'horizon 6 mois est modélisé et calibré (`by_horizon` ne contient que 6).

## 9. Reproduire

```powershell
# jeux de réplication (bases séparées, jamais data/app.db)
npm run sim -- --config medium --scenario mixte --seed 2
$env:DATABASE_PATH="data/ml-mixte_medium_s2.db"; npm run db:migrate; npm run import -- data/sim/mixte_medium_s2; npm run pipeline -- --backtest
# idem pour charge_medium_s1 (--scenario charge --seed 1) avec data/ml-charge_medium_s1.db

# panel naïf (lecture seule), une fois par base
npx tsx scripts/export-panel.ts --mode naive --out data/ml/panel-naive-app.csv
$env:DATABASE_PATH="data/ml-mixte_medium_s2.db"; npx tsx scripts/export-panel.ts --mode naive --out data/ml/panel-naive-mixte_medium_s2.csv

# étude complète + bundle (≈ 22 min sur le poste de dev)
python ml/train/run.py --db data/app.db --sim data/sim/mixte_medium_s1 --naive-csv data/ml/panel-naive-app.csv --name mixte_medium_s1 --bundle
python ml/train/run.py --db data/ml-mixte_medium_s2.db --sim data/sim/mixte_medium_s2 --naive-csv data/ml/panel-naive-mixte_medium_s2.csv --name mixte_medium_s2 --reps 3
python ml/train/report.py mixte_medium_s1          # tableaux Markdown

# parité puis enregistrement (CANDIDAT, pas de promotion)
$env:DATABASE_PATH="data/ml-parity.db"; npm run db:migrate
npx tsx scripts/model.ts register models/turnover/logreg-v1-20260930; npx tsx scripts/model.ts verify logreg-v1-20260930
python ml/train/run.py golden-status models/turnover/logreg-v1-20260930 <écart max>
Remove-Item Env:DATABASE_PATH; npx tsx scripts/model.ts register models/turnover/logreg-v1-20260930; npx tsx scripts/model.ts verify logreg-v1-20260930

python -m pytest ml/train/tests -q
```

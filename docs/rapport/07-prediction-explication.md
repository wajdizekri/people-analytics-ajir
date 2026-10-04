# Chapitre 7 — Prédiction et explication du risque de démission

Ce chapitre décrit le volet prédictif du module. Il couvre la formulation du problème, les variables, le protocole d'évaluation temporel, les modèles comparés et les métriques, puis les résultats. Il présente ensuite la règle de décision, l'explication des estimations, la simulation *what-if*, l'audit d'équité, le cycle de vie du modèle (dont la règle de démarrage à froid) et les quatre IA par sujet (absentéisme, effectifs et masse salariale, formations, charge de travail). Les sections 7.13 à 7.17 décrivent enfin cinq fonctions ajoutées le 4 octobre 2026 : la recherche automatique du meilleur levier, la comparaison appariée des interventions (estimation non causale), la typologie des départs, les fourchettes de prévision conformes et la synthèse rédigée, avec l'assistant d'aide. Le chapitre correspond aux contributions C2 (protocole anti-fuite) et C3 (du score à la décision explicable).

## 7.1 Formulation

### 7.1.1 Unité d'observation

L'unité d'observation est le couple **(salarié, fin de mois t)**, appelé *snapshot*. Chaque mois, le module calcule pour chaque salarié éligible un vecteur de 25 variables, en utilisant les seules données visibles à t (chapitre 6, section 6.4), et estime la probabilité qu'il démissionne dans les six mois suivants.

### 7.1.2 Événement prédit

L'événement est la **démission ou l'abandon de poste** survenant dans l'intervalle ]t, t + 6 mois] (ADR-004). Sa date est la date de démission quand AJIR la fournit, sinon la date de sortie moins un mois de préavis. Un cas particulier est traité explicitement : une démission antérieure à t mais saisie après t n'est pas visible à t. Le salarié y est donc éligible, et il est étiqueté positif si sa sortie effective tombe dans l'horizon.

Les **autres sorties** (fin de CDD, licenciement, retraite, décès, mutation, autre) sont des **risques concurrents** : un salarié qui sort pour une autre raison avant d'avoir démissionné compte comme « non-démission » (`y6 = 0`), et non comme une observation censurée. La probabilité estimée est donc bien celle de *démissionner* dans les six mois, et non celle de démissionner « si rien d'autre n'arrivait ». La seule censure est la fin des données : un snapshot n'entre dans l'apprentissage et l'évaluation que si son horizon de six mois est clos (`followup_complete = 1`). La vue SQL `v_label_panel` est la seule définition de ces étiquettes, lue par l'entraînement Python comme par le backtest.

Ce choix est une simplification assumée par rapport au plan de cadrage initial, qui prévoyait un modèle à hasards discrets avec incidence cumulée à 3, 6 et 12 mois. La classification directe à 6 mois a été retenue par le cahier des charges v2 pour tenir le calendrier. Le chapitre 3 (section 3.4) discute ce que l'on perd avec elle.

### 7.1.3 Population scorée

Un salarié est éligible à t si :

- il est actif à t et entré depuis au moins un mois ;
- son contrat en vigueur est un CDI, ou un CDD dont le terme tombe après t + 6 mois (SIVP et stages exclus) ;
- il aura moins de 60 ans à t + 6 mois ;
- aucune démission n'est déjà visible à t.

La fin de CDD prévue est affichée comme un **fait** dans la zone Observations de la fiche, jamais prédite. La part de l'effectif non scorée est affichée sur le tableau de bord.

## 7.2 Variables

### 7.2.1 Catalogue

Le contrat de variables [shared/features.json](../../shared/features.json) (version `v1`) définit 25 variables réparties en six groupes (tableau 7.1). Il fixe pour chacune l'ordre, le groupe, la valeur d'imputation, l'unité, un éventuel plafond et le gabarit de la phrase affichée à la RH. Le calcul est écrit une seule fois, en TypeScript ([src/lib/features/compute.ts](../../src/lib/features/compute.ts)). Python relit les vecteurs stockés au lieu de les recalculer, ce qui évite deux implémentations divergentes.

*Tableau 7.1 — Les 25 variables (fsv `v1`).*

| Groupe (actionnable ?) | Variable | Définition à la date t |
|---|---|---|
| Carrière et contrat (non) | `tenure_months` | Ancienneté en mois |
| | `contract_cdd` | 1 si le contrat en vigueur est un CDD |
| | `grade_level` | Niveau de grade (1 à 8) reconstitué à t |
| | `months_since_promotion` | Mois depuis la dernière promotion visible (ancienneté à défaut), plafonné à 120 |
| | `job_change_12m` | Changement de poste dans les 12 derniers mois |
| Rémunération (oui) | `compa_ratio` | Salaire de base visible / médiane de la famille de métier × grade à t |
| | `raise_pct_12m` | Augmentation cumulée sur 12 mois |
| | `months_since_raise` | Mois depuis la dernière augmentation, plafonné à 60 |
| Temps de travail (oui) | `overtime_h_avg_3m` | Heures supplémentaires par mois sur 3 mois, rapportées aux jours disponibles |
| | `overtime_trend_6m` | Pente mensuelle des heures supplémentaires sur 6 mois (au moins 3 mois exploitables) |
| | `late_count_3m` | Nombre de retards de plus de 10 minutes sur 3 mois |
| | `arrival_std_min_3m` | Écart-type de l'heure d'arrivée sur 3 mois (au moins 5 arrivées) |
| | `no_badge_days_3m` | Jours ouvrés sans pointage ni absence déclarée sur 3 mois |
| Absences hors santé (non) | `absence_rate_3m`, `absence_rate_12m` | Taux d'absence non planifiée (injustifiée, sans solde, autre) sur 3 et 12 mois |
| | `short_episodes_12m` | Épisodes d'absence d'au plus 3 jours sur 12 mois |
| | `bradford_12m` | Facteur de Bradford S² × D sur 12 mois (S épisodes, D jours) |
| Formation et évaluation (oui) | `training_hours_12m` | Heures de formation terminées sur 12 mois |
| | `mandatory_training_overdue` | Formation obligatoire dont l'échéance est dépassée |
| | `last_eval_score`, `eval_delta`, `eval_missing` | Dernière note visible (1 à 5), évolution par rapport à la précédente, absence d'évaluation |
| Équipe (non) | `team_exit_rate_6m` | Départs volontaires sur 6 mois dans l'équipe du manager à t |
| | `manager_change_12m` | Changement de manager dans les 12 derniers mois |
| | `team_size` | Taille de l'équipe du manager à t |

Le choix des groupes suit les déterminants du départ volontaire identifiés par la littérature (chapitre 3) : rémunération et perspectives, charge de travail, retrait progressif (absences, retards), développement, contexte d'équipe. Seuls trois groupes sont **actionnables**, c'est-à-dire susceptibles de déclencher une recommandation : Rémunération, Temps de travail, Formation et évaluation.

### 7.2.2 Règles de calcul

- **Visibilité à la date de saisie** : une ligne ne compte que si son événement et sa saisie sont antérieurs ou égaux à t (chapitre 6).
- **Fenêtres tronquées** : pour un salarié entré depuis moins de 12 mois, ou si les données commencent après t − 12 mois, les fenêtres sont tronquées et l'indicateur `partial_history` est levé.
- **Masquage de la santé** : les jours de maladie et de maternité visibles à t sont retirés des jours disponibles de toutes les variables tirées des pointages et des absences (ADR-009). Un arrêt maladie ne peut donc ni augmenter les « jours sans pointage » ni faire baisser les heures supplémentaires moyennes. Le congé annuel et les absences justifiées ne comptent pas non plus comme jours sans pointage.
- **Attributs exclus** : sexe, âge, situation familiale et gouvernorat ne sont pas des variables. Ils sont conservés pour le seul audit d'équité (section 7.10).
- **Imputation fixe** : une valeur manquante (salaire non visible, trop peu d'arrivées, aucune évaluation) prend la valeur d'imputation du contrat, identique à l'entraînement et en production. Les valeurs sont arrondies à 10⁻⁶.
- **Versionnement** : toute modification du calcul impose une nouvelle version `fsv` et un recalcul de l'historique. Un modèle dont la `fsv` diffère du contrat courant est refusé au chargement.

## 7.3 Protocole d'évaluation temporel

### 7.3.1 Principe

Le protocole reproduit ce que vivra le client : apprendre sur le passé, prédire l'avenir. Il repose sur des **origines glissantes** ([ml/train/protocol.py](../../ml/train/protocol.py)). Pour chaque origine O (un mois), avec un horizon de 6 mois :

- **test** : snapshots des mois O à O + 5 ;
- **calibration** : snapshots des mois O − 11 à O − 6, dont l'horizon est clos avant O ;
- **apprentissage** : snapshots dont l'horizon se termine avant la première cohorte de calibration ;
- **historique** (recette de production) : tous les snapshots dont l'horizon est clos à l'origine.

Les étiquettes d'apprentissage ne chevauchent donc jamais la période de test. Six origines espacées de six mois sont utilisées, la dernière étant la plus récente permise par la fin des données. Les prédictions de test des six origines sont empilées pour le calcul des métriques. Les hyperparamètres (force de régularisation, grille LightGBM) sont eux aussi réglés **dans le temps** : validation sur les six derniers mois de l'historique disponible à chaque origine.

*Figure 7.1 — Schéma du protocole à origines glissantes : apprentissage, calibration, test (à produire d'après `make_split`).*

### 7.3.2 Expérience Q1

La question de recherche Q1 est traitée en trois volets ([ml/train/study.py](../../ml/train/study.py)) :

- **Q1a — Découpage.** Nous mesurons l'AUC annoncée par trois protocoles pour les mêmes modèles, réglage des hyperparamètres compris :
  - découpage **aléatoire par ligne** (snapshot) : le plus répandu dans la littérature sur l'attrition ;
  - découpage **par salarié** : aucun salarié à la fois en apprentissage et en test ;
  - découpage **temporel** : les origines glissantes décrites plus haut.

  L'estimand est l'**inflation** : AUC annoncée par un protocole moins AUC du même modèle sur le test temporel. La validation interne est tirée de la même façon que le test.
- **Q1b — Date de saisie.** Nous comparons des variables calculées sur la date d'événement (mode naïf, qui ignore `recorded_at`) à des variables calculées à la date de saisie. Trois combinaisons sont évaluées : appris et testé en naïf (ce qu'annoncerait une étude naïve), appris en naïf et appliqué aux variables de production (ce que vivrait le client), appris et testé en *as-of* (référence).
- **Q1d — Courbe d'apprentissage.** Nous tirons des sous-échantillons de 100, 200, 400 et 800 salariés, plus la population entière, avec 10 à 20 réplications selon la taille. La recette de production est entraînée sur l'historique de ces salariés, puis évaluée en appariement avec B0 sur toute la cohorte de test. Le seuil **N1** est le premier nombre de démissions observées à partir duquel, dans la tranche et toutes les suivantes, la régression logistique bat B0 dans au moins 90 % des réplications avec un gain moyen d'AUC d'au moins 0,02. Sous N1, le produit garde B0.

## 7.4 Modèles

Trois familles sont comparées (ADR-003) :

1. **B0 — score à règles.** Six règles issues du sujet initial : compa-ratio < 0,9 (2 points), taux d'absence sur 3 mois > 4 %, au moins 3 absences courtes sur 12 mois, formation obligatoire en retard, plus de 20 heures supplémentaires par mois, plus de 48 mois sans promotion (1 point chacune). Le score est un nombre de points, affiché « score à règles » et jamais comme une probabilité. B0 est la référence à battre et le **repli du produit** : sans champion, il est enregistré et promu automatiquement.
2. **Régression logistique calibrée (LOGREG).** Variables standardisées, pénalisation L2 avec force choisie sur une grille par validation temporelle, pondération des classes (« balanced ») pour compenser la rareté des démissions, puis **calibration de Platt** (Platt, 2000), c'est-à-dire une régression logistique à une variable sur le logit, estimée sur une période postérieure à l'apprentissage. Deux recettes sont évaluées :
   - *LOGREG (protocole)* : apprentissage et calibration sur des périodes disjointes (section 7.3.1) ;
   - *LOGREG, recette de production* : force de régularisation et Platt estimés hors échantillon sur les six derniers mois d'historique à horizon clos, puis coefficients réajustés sur tout l'historique avec les mêmes réglages. C'est la recette qui produit le bundle déployé.

   Deux variantes de contrôle mesurent l'effet de la pondération des classes et d'une calibration de Platt estimée sur l'échantillon d'apprentissage.
3. **LightGBM** (Ke et al., 2017) : comparateur hors ligne, jamais exécuté par l'application. Grille réduite (nombre de feuilles, effectif minimal par feuille), nombre d'arbres choisi par arrêt précoce sur la validation temporelle, même calibration de Platt. Il mesure ce que la régression logistique perd en ne captant pas les interactions et les non-linéarités.

L'entraînement utilise scikit-learn (Pedregosa et al., 2011) et LightGBM, en Python. Le modèle LOGREG retenu est exporté en JSON avec ses moyennes, écarts-types, coefficients, intercept et paramètres de Platt ([ml/train/bundle.py](../../ml/train/bundle.py)). Un jeu **golden** de 200 lignes (150 tirées au hasard et les 50 estimations les plus élevées, zone ÉLEVÉ) est joint au bundle. En production, le scorer TypeScript calcule p = σ(a · (β₀ + Σ βⱼ zⱼ) + b), avec zⱼ = (xⱼ − μⱼ) / σⱼ. Il doit reproduire le golden à 10⁻⁹ près, à l'enregistrement, à la promotion et au chargement du modèle par chaque processus (ADR-002).

## 7.5 Métriques et critères de succès

Les critères ont été figés au cadrage (cahier des charges v2, section 6), avant tout résultat :

| Critère | Métrique | Seuil |
|---|---|---|
| Discrimination | AUC à 6 mois du modèle comparée à B0 | L'intervalle de confiance à 95 % de la différence exclut 0 |
| Calibration | Ratio observé/prévu (O/E) à 6 mois | Entre 0,8 et 1,25 |
| Utilité | Lift à la capacité RH par défaut (2 % de l'effectif scoré) | ≥ 3 |
| Fidélité | Écart maximal TypeScript ↔ Python sur le golden | < 10⁻⁶ (10⁻⁹ appliqué) |
| Anti-fuite | Variables inchangées si l'on ajoute des données saisies après t | Test par propriétés |

Des métriques complémentaires sont rapportées : aire sous la courbe précision-rappel (PR-AUC), plus informative que l'AUC quand les positifs sont rares, toujours accompagnée de la prévalence ; score de Brier ; pente de calibration, obtenue par régression logistique de l'issue sur le logit de la prédiction (Cox, 1958 ; Van Calster et al., 2019) ; précision et rappel à la capacité ; courbe de décision (bénéfice net) (Vickers et Elkin, 2006).

Le **lift à la capacité** reproduit exactement la règle ÉLEVÉ du produit, mois par mois. Il est égal à la précision parmi les k salariés signalés, divisée par le taux de démission de la population.

Les **intervalles de confiance** sont obtenus par **bootstrap** (Efron et Tibshirani, 1993) **groupé par salarié** (1 000 tirages) : on tire des salariés avec remise, pas des lignes. Un même salarié apparaît en effet dans plusieurs snapshots, et les lignes ne sont pas indépendantes. Les différences entre modèles sont calculées de façon appariée, sur les mêmes tirages. Pour la même raison, le test de DeLong, qui suppose des observations indépendantes, n'est pas utilisé. L'AUC de l'**oracle** du simulateur est rapportée sur le sous-ensemble de snapshots où elle est disponible, comme plafond.

## 7.6 Résultats

Tous les chiffres de cette section proviennent de [docs/RESULTATS_ML.md](../RESULTATS_ML.md), produits par `ml/train/run.py` le 30 septembre 2026 sur le jeu principal `mixte_medium_s1`. Ils caractérisent la **méthode** sur un simulateur, pas la valeur du modèle chez un client (section 7.6.7).

### 7.6.1 Données d'évaluation

Le panel compte 65 067 snapshots à suivi complet, de septembre 2020 à février 2026, pour 1 704 salariés et 484 démissions distinctes. 2 724 snapshots sont positifs, soit une prévalence de 4,19 %. Les six origines vont de mars 2023 à septembre 2025. Empilées, leurs fenêtres de test (mars 2023 à février 2026, 36 cohortes mensuelles) totalisent 35 621 snapshots, dont 1 461 positifs (4,10 %), pour 1 384 salariés. D'une origine à l'autre, l'apprentissage grossit de 13 821 à 43 374 lignes (151 à 344 démissions observées).

### 7.6.2 Performance comparée

*Tableau 7.2 — Performance sur le test temporel empilé, IC 95 % par bootstrap groupé par salarié (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 3).*

| Modèle | AUC 6 mois [IC 95 %] | PR-AUC | Brier | O/E | Pente | Précision à 2 % | Lift à 2 % [IC 95 %] | Rappel à 2 % |
|---|---|---|---|---|---|---|---|---|
| B0 (règles) | 0,560 [0,529 ; 0,590] | 0,050 | — | — | — | 8,5 % | 2,06 [1,10 ; 3,20] | 2,7 % |
| LOGREG (protocole) | 0,625 [0,594 ; 0,657] | 0,072 | 0,0391 | 1,00 | 0,81 | 13,1 % | 3,19 [2,30 ; 4,15] | 6,4 % |
| **LOGREG, recette de production** | **0,631 [0,599 ; 0,664]** | 0,074 | 0,0390 | 1,00 | 0,84 | 13,6 % | 3,33 [2,41 ; 4,33] | 6,7 % |
| LightGBM | 0,627 [0,597 ; 0,657] | 0,074 | 0,0389 | 1,01 | 0,84 | 12,6 % | 3,06 [2,14 ; 4,06] | 6,2 % |
| LOGREG sans pondération | 0,623 [0,592 ; 0,655] | 0,073 | 0,0390 | 0,99 | 0,80 | 12,8 % | 3,12 [2,26 ; 4,09] | 6,3 % |
| LOGREG, Platt intra-échantillon | 0,637 [0,606 ; 0,669] | 0,076 | 0,0391 | 0,95 | 0,74 | 13,6 % | 3,33 [2,41 ; 4,33] | 6,7 % |

*Tableau 7.3 — Différences appariées (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 3).*

| Différence | ΔAUC [IC 95 %] | ΔPR-AUC [IC 95 %] | Δlift à 2 % [IC 95 %] |
|---|---|---|---|
| LOGREG recette − B0 | +0,071 [0,038 ; 0,103] | +0,024 [0,015 ; 0,036] | +1,27 [0,08 ; 2,39] |
| LOGREG protocole − B0 | +0,065 [0,034 ; 0,096] | +0,021 [0,013 ; 0,032] | +1,13 [−0,05 ; 2,27] |
| LightGBM − LOGREG recette | −0,003 [−0,020 ; 0,013] | −0,000 [−0,009 ; 0,009] | −0,27 [−1,08 ; 0,53] |
| LOGREG pondérée − non pondérée | +0,002 [−0,002 ; 0,006] | −0,001 [−0,004 ; 0,001] | +0,07 [−0,30 ; 0,42] |

Quatre constats se dégagent :

1. **La régression logistique bat nettement le score à règles.** L'écart d'AUC de la recette de production est de +0,071, et aucun des 1 000 tirages bootstrap n'est négatif. Le gain sur le lift à la capacité est plus incertain : son intervalle frôle zéro.
2. **LightGBM n'apporte rien** sur la logistique : l'écart d'AUC est nul, intervalle centré sur zéro. Ce résultat justifie de le laisser hors production (ADR-003). Il renseigne aussi sur le simulateur : les interactions et non-linéarités que LightGBM pourrait capter ne portent pas de signal supplémentaire dans les variables exportées.
3. **La pondération des classes ne change pas le classement.** Elle ne sert qu'à stabiliser l'apprentissage, et la calibration de Platt en corrige l'effet sur les probabilités.
4. **La calibration doit être estimée hors échantillon.** Estimée sur les données d'apprentissage, la calibration de Platt donne une AUC un peu plus haute mais une pente de 0,74 et un O/E de 0,95 : les probabilités sont trop dispersées. La recette de production, qui l'estime sur une période postérieure, obtient une pente de 0,84 et un O/E de 1,00.

**Plafond oracle.** Sur les 11 855 snapshots de test où l'oracle est disponible, la vraie probabilité du simulateur atteint une AUC de 0,796 [0,767 ; 0,825], contre 0,628 pour la recette et 0,560 pour B0. L'écart entre le modèle et l'oracle mesure la part du signal portée par des causes sans variable exportée : qualité du manager, offres externes, événements personnels. C'est le résultat attendu d'un simulateur non circulaire. Ce plafond mesuré est inférieur à l'AUC oracle publiée pour le simulateur (0,844, tableau 6.5), car l'évaluation utilise les étiquettes telles qu'exportées : dates de démission manquantes, démissions codées « autre », saisies tardives.

**Stabilité dans le temps.** L'AUC de la recette varie de 0,577 à 0,685 selon l'origine, et son O/E de 0,86 à 1,22. La dérive du taux de base d'une fenêtre à l'autre rend une recalibration régulière nécessaire.

### 7.6.3 Calibration et utilité

Par déciles d'estimation, les taux observés suivent les estimations : de 1,88 % observé pour 1,58 % estimé dans le premier décile, à 9,29 % observé pour 9,91 % estimé dans le dernier (figure 7.2). Le tableau 7.4 montre l'utilité selon la part de l'effectif ciblée chaque mois.

*Tableau 7.4 — Précision, lift et rappel selon la part ciblée, recette de production (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 4).*

| Part ciblée chaque mois | 1 % | 2 % (capacité) | 5 % | 10 % | 20 % |
|---|---|---|---|---|---|
| Précision | 13,9 % | 13,6 % | 12,2 % | 9,7 % | 7,7 % |
| Lift | 3,39 | 3,33 | 2,97 | 2,37 | 1,87 |
| Rappel | 3,4 % | 6,7 % | 14,9 % | 23,8 % | 37,4 % |

À la capacité par défaut, un salarié classé « Élevé » a donc environ une chance sur sept de démissionner dans les six mois, contre une sur vingt-cinq en moyenne. Le **rappel** reste faible (6,7 %) : la capacité d'entretiens limite la couverture bien plus que le modèle. Ce chiffre doit être présenté tel quel à la RH : le module aide à prioriser quelques entretiens, il ne repère pas la plupart des futurs démissionnaires. La courbe de décision confirme ce positionnement : le modèle dépasse la stratégie « tous ciblés » à partir d'un seuil de 3 %, et son bénéfice net devient négatif à 20 %.

*Figure 7.2 — Courbe de calibration par déciles de la recette de production (à produire depuis le bloc `calibration.bins` de `models/turnover/logreg-v1-20260930/model.json`, ou capture de la page Transparence).*

### 7.6.4 Q1a — Inflation selon le découpage

*Tableau 7.5 — AUC annoncée selon le protocole de découpage et inflation par rapport au test temporel (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 5 a).*

| Découpage | AUC B0 | AUC LOGREG | AUC LightGBM | Inflation LOGREG | Inflation LightGBM |
|---|---|---|---|---|---|
| Aléatoire par ligne | 0,596 | 0,682 | 0,925 | +0,044 | +0,285 |
| Aléatoire par ligne + variables naïves | 0,602 | 0,690 | 0,932 | +0,053 | +0,292 |
| Par salarié | 0,595 | 0,648 | 0,653 | +0,011 | +0,014 |
| Temporel (référence) | 0,560 | 0,637 | 0,640 | 0 | 0 |

Le **découpage aléatoire par ligne** est la fuite dominante. Un même salarié apparaît en apprentissage et en test sur des mois voisins, avec la même étiquette, et LightGBM mémorise ces salariés : il annonce une AUC de 0,925 au lieu de 0,640, soit +0,29. La validation, tirée elle aussi au hasard, l'y encourage en lui faisant choisir le modèle le plus complexe (16 feuilles, 2 000 arbres). La régression logistique, peu flexible, gonfle beaucoup moins : +0,044, ou +0,026 une fois l'effet de population retiré en recalculant l'AUC sur la seule fenêtre de test temporelle. Le découpage **par salarié** ne gonfle presque pas l'AUC, mais il ne permet pas de régler la calibration dans le temps.

Ce résultat nuance l'idée qu'un modèle plus flexible serait meilleur. Évalués sans fuite, LightGBM et la logistique sont à égalité ; évalués comme dans une grande partie de la littérature sur l'attrition, LightGBM paraît écraser la logistique.

### 7.6.5 Q1b — Date de saisie

Le mode naïf, qui ignore la date de saisie, modifie une part importante des valeurs de variables : 48 % pour le compa-ratio (paie du mois saisie le mois suivant), 13 % pour les jours sans pointage, 13 % et 11 % pour l'évolution et la dernière note d'évaluation, 6 % pour le taux d'absence sur 12 mois.

*Tableau 7.6 — Effet des variables naïves (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 5 b).*

| Variante (apprentissage → application) | AUC [IC 95 %] | Lift à 2 % [IC 95 %] | O/E |
|---|---|---|---|
| LOGREG *as-of* → *as-of* (honnête) | 0,625 [0,594 ; 0,657] | 3,19 [2,30 ; 4,15] | 1,00 |
| LOGREG naïf → naïf (annoncé par une étude naïve) | 0,634 [0,601 ; 0,665] | 3,70 [2,78 ; 4,62] | 1,00 |
| LOGREG naïf → *as-of* (obtenu en production) | 0,628 [0,599 ; 0,658] | 2,95 [2,15 ; 3,79] | 0,90 |
| LightGBM *as-of* → *as-of* | 0,627 [0,597 ; 0,657] | 3,06 [2,14 ; 4,06] | 1,01 |
| LightGBM naïf → naïf (annoncé) | 0,635 [0,606 ; 0,665] | 3,86 [2,87 ; 4,87] | 1,02 |
| LightGBM naïf → *as-of* (obtenu) | 0,628 [0,600 ; 0,658] | 3,65 [2,65 ; 4,63] | 0,98 |

Sur ce simulateur, dont les délais de saisie sont courts (absences de 0 à 15 jours, paie d'un mois, évaluations de 1 à 4 mois), la fuite par la date de saisie est **faible en AUC** : +0,009 [0,001 ; 0,017] pour la logistique. Elle est **visible sur le lift et la calibration**. Pour la logistique, l'étude naïve annonce un lift de 3,70, alors que le même modèle obtient 2,95 en production, avec un O/E qui tombe à 0,90. Un client dont les saisies sont plus tardives subirait une fuite plus forte.

### 7.6.6 Q1d — Courbe d'apprentissage et seuil N1

*Tableau 7.7 — Courbe d'apprentissage : sous-échantillons de salariés, évaluation appariée avec B0 sur toute la cohorte de test (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 5 d).*

| Salariés tirés | Éligibles par mois | Démissions observées (médiane) | AUC LOGREG | ΔAUC vs B0 | P(LOGREG > B0) | O/E dans [0,8 ; 1,25] | Lift LOGREG |
|---|---|---|---|---|---|---|---|
| 100 | 57 | 18 | 0,582 | +0,022 | 76 % | 24 % | 2,41 |
| 200 | 116 | 37 | 0,610 | +0,050 | 97 % | 41 % | 2,71 |
| 400 | 233 | 71 | 0,623 | +0,063 | 100 % | 59 % | 3,22 |
| 800 | 464 | 151 | 0,633 | +0,073 | 100 % | 80 % | 3,12 |
| 1 704 (tous) | 986 | 319 | 0,637 | +0,077 | 100 % | 100 % | 3,37 |

Le critère avait été fixé avant la lecture des résultats. On cherche la première tranche de démissions observées à partir de laquelle, dans elle et toutes les suivantes, la logistique bat B0 dans au moins 90 % des essais avec un gain moyen d'au moins 0,02 d'AUC. Ce seuil est **N1 = 20 démissions observées** sur le jeu principal. LightGBM n'atteint jamais 90 % de victoires sur la logistique, quelle que soit la taille.

Deux nuances s'imposent. D'une part, **la discrimination arrive avant la calibration** : avec 200 salariés tirés, la logistique bat déjà B0 dans 97 % des essais, mais son O/E n'est dans la plage cible que dans 41 % des cas. Un petit client obtiendrait un bon classement avec des probabilités peu fiables. D'autre part, le seuil dépend du rapport signal/bruit du simulateur : il est **indicatif**, et la porte de promotion doit le revérifier sur les données du premier client.

### 7.6.7 Verdict sur les critères et réponse à Q1

*Tableau 7.8 — Critères de succès figés au cadrage, recette de production.*

| Critère | Seuil | Résultat | Verdict |
|---|---|---|---|
| Discrimination vs B0 | IC de ΔAUC exclut 0 | +0,071 [0,038 ; 0,103] | Atteint |
| Calibration | O/E dans [0,8 ; 1,25] | 1,00 [0,88 ; 1,12] ; pente 0,84 [0,67 ; 1,02] | Atteint pour l'O/E ; pente dans la cible en valeur, borne basse hors cible |
| Utilité | Lift ≥ 3 à 2 % | 3,33 [2,41 ; 4,33] | Atteint en valeur ponctuelle, borne basse sous 3 |
| Fidélité TypeScript ↔ Python | < 10⁻⁶ sur le golden | Écart maximal 1,1 × 10⁻¹⁶ | Atteint |
| Anti-fuite | Variables inchangées | Test par propriétés | Couvert par test |

La réponse à la question de recherche est donc la suivante, sur ce simulateur :

- les fuites temporelles **surestiment surtout les modèles flexibles**. Le découpage aléatoire gonfle l'AUC de la logistique de +0,03 à +0,04, mais celle de LightGBM de +0,29 ; l'usage de données saisies après coup ajoute environ +0,01 d'AUC et surtout surestime le lift (3,70 annoncé contre 2,95 obtenu) ;
- une fois ces fuites neutralisées, le **gain réel** d'un modèle appris sur les règles métier est de +0,07 d'AUC et d'environ 1,3 point de lift à la capacité, sur le jeu complet. La supériorité sur B0 devient fiable dès une vingtaine de démissions observées (seuil N1), puis le gain croît avec les données ; la calibration en demande davantage ;
- le modèle appris reste loin du plafond oracle (0,63 contre 0,80), car l'essentiel du signal simulé passe par des causes que les données RH n'observent pas.

**Réplication.** Le même protocole a été rejoué sur deux jeux qui n'ont servi à aucun choix de méthode : une seconde graine du scénario mixte (`mixte_medium_s2`) et le scénario « charge », où les heures supplémentaires sont le premier mécanisme de démission ([RESULTATS_ML.md](../RESULTATS_ML.md), § 5 c).

*Tableau 7.8 bis — Réplication (AUC à 6 mois, recette de production, IC 95 % par bootstrap groupé).*

| Jeu | AUC B0 | AUC LOGREG (recette) | AUC LightGBM | LOGREG − B0 | Lift recette / B0 | O/E recette | Seuil N1 (gain d'AUC ≥ 0,02) | Seuil de calibration |
|---|---|---|---|---|---|---|---|---|
| mixte, graine 1 | 0,560 | 0,631 | 0,627 | +0,065 [0,034 ; 0,096] | 3,33 / 2,06 | 1,00 | 20 | 75 |
| mixte, graine 2 | 0,613 | 0,675 | 0,646 | +0,057 [0,020 ; 0,095] | 3,38 / 3,82 | 0,98 | 30 | 150 |
| charge | 0,657 | 0,664 | 0,666 | −0,002 [−0,045 ; 0,040] | 7,47 / 3,43 | 0,94 | jamais | jamais |
| 3 jeux regroupés | | | | | | | **30** | **150** |

Le gain d'AUC de la logistique sur B0 se reproduit sur la seconde graine, mais disparaît dans le scénario « charge », où les règles de B0 coïncident avec le mécanisme dominant ; la logistique y double pourtant le lift de B0 à la capacité. À l'inverse, sur la graine 2, la logistique a la meilleure AUC mais un haut de liste moins bon que B0 (écart non significatif). AUC et lift ne classent donc pas toujours les modèles de la même façon : une porte de promotion doit regarder les deux. LightGBM ne bat la logistique sur aucun jeu. Les critères « faibles » (seuil N1 sur le seul gain d'AUC, seuil de calibration) ont été ajoutés après la lecture de la graine 2 : ils sont exploratoires. Ils fondent néanmoins la **règle de démarrage à froid** implémentée dans le produit (section 7.11) : B0 seul sous 30 démissions observées, probabilité « indicative » sous 150.

### 7.6.8 Lecture des coefficients

Les plus forts coefficients du modèle exporté (en unités d'écart-type, avant calibration) sont cohérents avec la littérature du chapitre 3 :

- compa-ratio : −0,26 ;
- absences courtes : +0,25 ;
- départs dans l'équipe : +0,24, ce qui rejoint la contagion décrite par Felps et al. (2009) ;
- taux d'absence sur 3 mois : +0,16 ;
- contrat à durée déterminée : +0,16 ;
- jours sans pointage : +0,16 ;
- heures de formation : −0,14 ;
- mois sans promotion : +0,14.

Le facteur de Bradford a un coefficient négatif (−0,18), contraire à son effet pris isolément. Il est compensé par les autres variables d'absence, qui lui sont corrélées. L'explication par groupe (section 7.8) additionne ces effets, qui se compensent au sein du groupe Absences. Aucune contrainte de signe n'est appliquée ; c'est une limite à lever si l'on veut exposer un jour des contributions par variable.

## 7.7 Décision : du score au niveau de risque

Avec environ 4 % de démissions à six mois (section 7.6.1), un seuil fixe de probabilité est inutilisable : placé haut, il laisse la classe « Élevé » vide ; placé bas, il la remplit au-delà de ce que la RH peut traiter. Le niveau est donc fixé par la **capacité RH** (ADR-006, [src/lib/scoring/score.ts](../../src/lib/scoring/score.ts)). Chaque mois, sur les n salariés scorés, triés par score décroissant :

- **ÉLEVÉ** : au plus k = max(1, ⌊n × 2 %⌋) salariés (partie entière). La capacité est un **plafond** : des ex-æquo qui franchiraient la k-ième place restent tous hors ÉLEVÉ, pour que le niveau ne dépende jamais du matricule. Ce cas est fréquent avec les points entiers de B0, et avec B0 un score nul n'est jamais ÉLEVÉ ;
- **MOYEN** : hors ÉLEVÉ, lift (score / moyenne des scores du mois) ≥ 2 ;
- **FAIBLE** sinon.

La part de 2 % est réglable par l'administrateur. La répartition des niveaux étant en partie fixée par construction, le tableau de bord montre plutôt le nombre de salariés ÉLEVÉ par département et la part non évaluée. Le vocabulaire est contrôlé : on parle d'« exposition au risque » et de « facteurs associés », jamais de « causes » ni de « départs évités ».

## 7.8 Explicabilité

### 7.8.1 Contributions exactes par groupe

La régression logistique a une propriété précieuse : son logit est une somme. La contribution de la variable j au logit calibré, par rapport au profil moyen de l'apprentissage (zⱼ = 0), est exactement cⱼ = a · βⱼ · zⱼ, où a est la pente de Platt. La somme des contributions plus le logit du profil moyen redonne le logit du salarié. Pour un modèle linéaire à variables supposées indépendantes, cette décomposition coïncide avec les valeurs de Shapley calculées dans l'espace du logit (Lundberg et Lee, 2017). L'explication affichée est donc **exacte pour le modèle affiché**, sans approximation ni échantillonnage.

Les contributions sont **sommées par groupe** ([src/lib/scoring/model.ts](../../src/lib/scoring/model.ts), fonction `explain`). Six groupes sont plus lisibles que 25 variables, et les variables d'un même groupe sont corrélées (par exemple les deux taux d'absence), si bien que leurs contributions individuelles se compensent parfois. Les groupes sont triés par contribution absolue, avec un sens (hausse ou baisse du risque). Pour chaque groupe, la variable qui contribue le plus dans le sens du groupe fournit la phrase affichée à la RH, construite à partir du gabarit du contrat, par exemple « Salaire à 90 % de la médiane du poste ». Avec B0, l'explication est la liste des règles déclenchées et de leurs points.

### 7.8.2 Rendu selon le rôle

La même explication est rendue différemment selon le rôle, par la couche d'accès aux données :

- la **RH** voit la phrase chiffrée de chaque groupe et sa contribution ;
- le **manager** voit la **catégorie** seule (« Rémunération », « Charge de travail », « Développement des compétences »…), jamais un chiffre. Deux catégories ne lui sont jamais montrées : « Assiduité » (le groupe Absences, qui serait un signal d'absentéisme individuel) et, avec le score à règles B0, « Rémunération », qui y signifie exactement « salaire sous 90 % de la médiane ».

*Figure 7.3 — Zone « Estimation » de la fiche collaborateur, vue RH et vue manager côte à côte (captures à prendre).*

### 7.8.3 Recommandations

Les recommandations sont créées à la publication d'un calcul, pour les salariés ÉLEVÉ ou MOYEN ([src/lib/engine/recommendations.ts](../../src/lib/engine/recommendations.ts)) :

- pour chaque groupe **actionnable** présent dans les **trois premiers facteurs** et qui **augmente** le risque, l'action associée est proposée : révision salariale (Rémunération), examen de la charge de travail (Temps de travail), plan de formation (Formation et évaluation) ;
- un entretien est proposé pour tout salarié ÉLEVÉ ;
- une action n'est proposée qu'une fois par salarié et par mois scoré, et jamais en double tant qu'elle est ouverte.

Aucune recommandation n'est déclenchée par l'ancienneté, le contrat, l'équipe, les absences ou un attribut personnel. La révision salariale est réservée à la RH. Une recommandation marquée « réalisée » crée une **intervention** datée : elle garde la trace de l'action RH, qu'un réentraînement futur devra prendre en compte. L'issue observée après une action peut en effet en dépendre : un salarié resté après une intervention ne doit pas être appris sans précaution comme un faux positif. La section 7.14 compare les collaborateurs suivis à des collaborateurs similaires non suivis, sous la forme d'une estimation non causale.

Une limite doit être signalée. Le déclenchement se fait au niveau du **groupe**. Or le groupe Temps de travail contient à la fois des variables de charge (heures supplémentaires) et des signaux de retrait (retards, irrégularité d'arrivée, jours sans pointage). Un groupe dominé par des retards peut donc déclencher une suggestion « charge de travail ». Déclencher sur la variable principale du groupe, ou séparer les signaux de retrait dans un groupe non actionnable comme le prévoyait le plan de cadrage, corrigerait ce point.

## 7.9 Simulation *what-if*

La simulation *what-if*, un *Should* du cahier des charges, permet à la RH de tester un levier sur un salarié : augmentation de salaire (jusqu'à +30 %), réduction des heures supplémentaires (jusqu'à 40 h par mois), heures de formation (jusqu'à 200 h), promotion d'un grade ([src/lib/whatif/index.ts](../../src/lib/whatif/index.ts)).

Sa conception évite deux pièges :

- **les leviers agissent sur les données sources, pas sur les variables.** Le système recharge les sources du seul salarié à la date du calcul publié, puis applique le levier comme s'il avait été saisi dans AJIR à cette date. Par exemple, une promotion ajoute un événement de grade et porte le salaire au moins à la médiane du nouveau grade. Les variables sont ensuite recalculées **par les mêmes fonctions que le calcul mensuel**, et les effets de bord (compa-ratio, mois depuis la dernière augmentation, etc.) sont donc cohérents ;
- **le salarié est replacé dans la population du mois.** Son rang, son lift et son niveau avant et après sont calculés par la même fonction que la publication, face aux vecteurs des autres salariés du mois.

La réponse donne l'estimation et le niveau avant et après, la contribution par groupe avant et après, les variables modifiées et le **coût annuel** en dinars (écart de salaire mensuel × 12 × (1 + taux de charges patronales, 16,57 % par défaut, modifiable)). Elle porte la mention : « Estimation non causale : le modèle décrit des associations, pas l'effet garanti d'une action. » Rien n'est écrit en base hormis l'audit de la simulation. La fonctionnalité est réservée à la RH. Depuis le 4 octobre 2026, une recherche automatique propose les plus petites combinaisons de leviers suffisantes pour faire baisser le niveau (section 7.13).

*Figure 7.4 — Panneau what-if sur la fiche RH (capture à prendre).*

## 7.10 Équité

### 7.10.1 Démarche

L'audit d'équité ([ml/train/fairness.py](../../ml/train/fairness.py)) porte sur deux attributs exclus des variables mais conservés pour l'audit : le **sexe** et la **tranche d'âge** (moins de 30 ans, 30 à 44 ans, 45 ans et plus). Pour chaque groupe, il rapporte :

- la **calibration** : taux de démission observé, probabilité moyenne prédite, ratio O/E ;
- le **taux de sélection** à la capacité : part des salariés du groupe classés ÉLEVÉ ;
- le **taux de vrais positifs** (TPR) et de **faux positifs** (FPR) à la capacité ;
- l'AUC du groupe ;
- des intervalles de confiance par bootstrap groupé ; les groupes de moins de 30 snapshots ne sont pas affichés.

S'y ajoute une **détection de variables proxys** : l'information mutuelle entre chaque variable (et le score) et l'attribut sensible, rapportée à l'entropie de l'attribut. Une variable très informative sur le sexe ou l'âge peut réintroduire indirectement l'attribut exclu.

### 7.10.2 Pourquoi un rapport et pas un blocage

L'audit est un **rapport, jamais un blocage automatique**. Deux raisons le justifient. D'une part, les critères d'équité sont mutuellement incompatibles : quand les taux de base diffèrent entre groupes, un score ne peut être à la fois calibré dans chaque groupe et équilibré en taux d'erreurs, sauf prédiction parfaite (Kleinberg et al., 2017 ; Chouldechova, 2017). Choisir un critère est une décision de valeur, pas un calcul. D'autre part, le sens du préjudice dépend de l'usage. Si « Élevé » déclenche un entretien ou une révision salariale, le préjudice est le **sous-ciblage** d'un groupe, et c'est l'égalité des taux de vrais positifs, l'« égalité des chances » au sens de Hardt et al. (2016), qu'il faut surveiller. La décision revient donc à un humain, documentée avant toute promotion de modèle chez un client.

Sur le simulateur, l'audit est une **démonstration de l'outil** : les écarts éventuels reflètent les choix de simulation (âge lié à l'ancienneté et aux offres externes), et leur interprétation est réservée aux données client.

### 7.10.3 Résultats sur le simulateur

*Tableau 7.9 — Rapport d'équité de la recette de production, test empilé, capacité 2 %, IC 95 % par bootstrap groupé (source : [RESULTATS_ML.md](../RESULTATS_ML.md), § 6).*

| Groupe | Snapshots | Taux observé | Estimation moyenne | O/E [IC] | Sélection ÉLEVÉ [IC] | TPR [IC] | FPR | AUC |
|---|---|---|---|---|---|---|---|---|
| Femmes | 14 226 | 4,05 % | 4,05 % | 1,00 [0,82 ; 1,21] | 1,76 % [1,35 ; 2,22] | 5,7 % [3,6 ; 7,8] | 1,60 % | 0,660 |
| Hommes | 21 395 | 4,14 % | 4,15 % | 1,00 [0,83 ; 1,18] | 2,18 % [1,82 ; 2,60] | 7,3 % [4,8 ; 10,3] | 1,96 % | 0,612 |
| Moins de 30 ans | 7 502 | 4,00 % | 4,11 % | 0,97 [0,74 ; 1,23] | 1,92 % [1,43 ; 2,53] | 6,3 % [3,3 ; 9,9] | 1,74 % | 0,644 |
| 30 à 44 ans | 22 064 | 4,27 % | 4,11 % | 1,04 [0,88 ; 1,22] | 2,06 % [1,73 ; 2,45] | 7,6 % [5,1 ; 10,2] | 1,81 % | 0,635 |
| 45 ans et plus | 6 055 | 3,60 % | 4,11 % | 0,88 [0,59 ; 1,18] | 1,97 % [1,32 ; 2,75] | 3,2 % [0,5 ; 6,1] | 1,92 % | 0,598 |

La calibration est comparable entre les sexes (O/E de 1,00 pour chacun). Les femmes sont un peu moins souvent sélectionnées (1,76 % contre 2,18 %) pour un taux de démission observé presque égal, mais les intervalles se recouvrent. Les salariés de 45 ans et plus ont un taux de vrais positifs bas (3,2 %, intervalle large) et un risque légèrement surestimé (O/E de 0,88). Au regard du critère retenu, l'égalité des taux de vrais positifs, c'est ce groupe qu'une décision humaine devrait examiner en priorité sur des données réelles.

La détection de proxys montre que le **grade** et l'**ancienneté** portent une part notable de l'information sur l'âge (respectivement 20 % et 14 % de son entropie). Aucune variable ne dépasse 2,5 % de l'entropie du sexe. Grade et ancienneté sont des variables légitimes, mais toute règle future qui les utiliserait doit être relue sous l'angle de l'âge.

## 7.11 Cycle de vie du modèle

Le modèle suit un cycle outillé en ligne de commande ([scripts/model.ts](../../scripts/model.ts)), sans aucune promotion depuis l'interface :

1. **enregistrer** (`register`) : le bundle est lu, validé (schéma, `fsv`, variables connues, dimensions), son golden rejoué ; son manifeste et son empreinte sha256 sont figés en base au statut CANDIDAT ;
2. **vérifier** (`verify`) : golden rejoué, empreinte des fichiers contrôlée ;
3. **promouvoir** (`promote`) : nouvelle vérification, puis passage au statut CHAMPION ; l'ancien champion passe RETIRÉ. Un index unique partiel garantit qu'il n'existe qu'un champion. La promotion est auditée ;
4. **revenir en arrière** (`rollback`) : repromotion du champion précédent, dont le bundle est conservé.

Le modèle produit par l'étude, `logreg-v1-20260930`, a été exporté avec son jeu golden de 200 lignes, puis enregistré au statut CANDIDAT. La vérification reproduit le golden avec un écart maximal de 1,1 × 10⁻¹⁶, pour une tolérance de 10⁻⁹. Il a été appris sur les 65 067 snapshots à suivi complet, avec une calibration de Platt estimée sur les six derniers mois d'historique à horizon clos. Il a été **promu le 30/09/2026** sur la base de démonstration, puis le calcul du 31/08/2026 a été republié : 987 salariés scorés, probabilité moyenne 4,05 % (de 0,9 % à 33,9 %), 19 salariés ÉLEVÉ (plafond de 2 %, probabilités de 10 % à 34 %), 30 MOYEN ; 55 nouvelles recommandations et 15 nouvelles alertes de passage en ÉLEVÉ. Le *what-if* et la projection des effectifs utilisent désormais ses probabilités.

**Règle de démarrage à froid.** La courbe d'apprentissage (7.6.6) et sa réplication montrent qu'un LOGREG appris sur trop peu d'événements ne bat pas B0 de façon fiable et se calibre mal. Le produit l'applique à chaque calcul ([src/lib/scoring/cold-start.ts](../../src/lib/scoring/cold-start.ts)) : il compte les **démissions observées** (salariés distincts ayant démissionné ou abandonné dans les 6 mois suivant un mois où ils étaient éligibles, horizon clos et sortie saisie à la date du calcul). Sous `min_events_for_model` (30), un champion LOGREG est écarté au profit de B0 pour ce calcul, la raison est tracée dans l'audit et affichée sur la page Transparence ; sous `indicative_until_events` (150), la probabilité reste affichée mais qualifiée d'« indicative ». La base de démonstration compte 484 démissions observées au 31/08/2026 : le LOGREG est utilisé et sa probabilité n'est pas indicative. Chez un premier client, le même modèle, réentraîné sur ses données, resterait sous B0 tant que son historique est court.

Le worker et le service web revérifient le champion à son chargement, une fois par processus. Un champion invalide (golden non reproduit, fichier modifié) suspend le scoring et crée une alerte Système. La **porte de promotion** prévue au cahier des charges (backtest sur les données du client, AUC non inférieure à B0 avec une marge proposée de −0,02, lift au moins égal, O/E dans [0,8 ; 1,25], rapport d'équité lu et décision tracée) reste une procédure humaine : seule la règle de démarrage à froid est automatisée. La page Transparence présente le champion, ses métriques, sa calibration, son rapport d'équité, le statut du golden et l'historique des versions.

## 7.12 IA par sujet : absentéisme, effectifs et masse salariale, formations, charge de travail

Au-delà du risque de démission, quatre volets appliquent la même démarche à d'autres questions RH : modèle simple appris hors ligne en Python sur l'historique, **protocole à origines glissantes sans fuite** (variables visibles à la date de saisie), comparaison à des baselines naïves, bundle JSON rejoué par une inférence TypeScript à 10⁻⁹ près (jeu golden), enregistrement dans un registre par sujet (`topic_model`, un champion par sujet), étape du batch mensuel idempotente. Les prévisions sont **agrégées** (entreprise, département, équipe d'au moins 5 personnes) ; seule la formation produit un risque individuel, et aucune donnée de santé n'est utilisée. Les quatre modèles ont été promus sur la base de démonstration le 30/09/2026. Comme pour le turnover, les chiffres proviennent du simulateur : ils valident la méthode, pas une précision chez un client.

### 7.12.1 Absentéisme : prévision à 1-3 mois

Cible : taux mensuel d'absence **hors santé non planifiée** (absence injustifiée, congé sans solde, autre), rattachement de l'unité à la date du mois. Modèle : ridge direct par horizon, 16 variables (niveau récent, moyennes 3 et 12 mois, saison, unité parente, tendances, calendrier tunisien du mois prévu, taille), cible en écart à la moyenne 12 mois ; intervalle à 80 % par quantiles de résidus normalisés. Test : 24 origines (2024-06 → 2026-05), jamais utilisées pour un choix ([RESULTATS_IA_ABSENTEISME.md](../RESULTATS_IA_ABSENTEISME.md)).

*Tableau 7.10 — Absentéisme, période de test (MAE en points de taux ; rapport à la moyenne mobile 12 mois, meilleure baseline).*

| Portée | h | Ridge | Naïf saisonnier | MM 12 mois | Ridge / MM12 [IC 95 %] | Couverture 80 % |
|---|---|---|---|---|---|---|
| Entreprise | 1 | 0,078 | 0,123 | 0,094 | 0,836 [0,690 ; 0,954] | 75,0 % |
| Entreprise | 3 | 0,079 | 0,118 | 0,097 | 0,810 [0,652 ; 0,927] | 70,8 % |
| Département | 1 | 0,214 | 0,291 | 0,230 | 0,930 [0,888 ; 0,987] | 84,9 % |
| Équipe | 1 | 0,857 | 1,092 | 0,904 | 0,949 [0,941 ; 0,958] | 80,9 % |

Le ridge a la plus petite erreur à toutes les portées : −16 à −23 % contre la moyenne 12 mois pour l'entreprise, −5 à −7 % pour les départements, −5 % pour les équipes ; LightGBM n'apporte rien. Au niveau équipe, l'erreur reste de l'ordre du taux lui-même (WAPE ≈ 107 %, 49 % des mois-équipe à zéro) : la prévision estime un **niveau attendu** avec une fourchette large (2,3 points). Les effets Ramadan et ponts sont nuls, car le simulateur ne les fait pas porter sur l'absence non planifiée. Les **recommandations collectives** (anticiper les remplacements, échanger sur l'organisation, prévention santé-sécurité, congés autour des ponts) sont des règles paramétrables (`abs_reco_*`) avec une justification chiffrée ; elles ne sont pas évaluées contre un effet réel. Au 31/08/2026 : 489 prévisions (163 unités), 7 recommandations.

### 7.12.2 Effectifs et masse salariale : projection à 12 mois

Effectif : modèle stock-flux, chaque salarié présent suivant une survie mensuelle (démission au taux du département sur 24 mois, ou d'après la probabilité publiée si le champion turnover est LOGREG ; autres sorties ; fin de CDD selon le taux de non-renouvellement observé ; retraite à 60 ans ; sorties déjà saisies), plus les embauches au rythme des 12 derniers mois. Masse salariale : base projetée × effet de département et de mois (régression log, R² 0,633) × hausse de janvier. Test : 24 origines (2023-09 → 2025-08), 12 horizons ([RESULTATS_IA_EFFECTIFS.md](../RESULTATS_IA_EFFECTIFS.md)).

*Tableau 7.11 — Effectifs et masse salariale, entreprise, période de test (MAPE).*

| Méthode | Effectif | Masse salariale |
|---|---|---|
| Modèle (démissions au taux historique) | 0,74 % | 0,86 % |
| Modèle (démissions par LOGREG) | 1,11 % | 1,15 % |
| Persistance (dernière valeur) | **0,53 %** | 2,95 % |
| Naïf saisonnier (× croissance pour la masse) | 0,72 % | **0,73 %** |
| Tendance linéaire 24 mois | 0,93 % | 1,42 % |

Le résultat est à assumer tel quel : **pour l'effectif, la persistance fait mieux que le modèle**, parce que le simulateur embauche au rythme des départs (effectif stable de 1 059 à 1 085 salariés en 72 mois). Pour la masse, le modèle divise l'erreur par 3 à 6 face aux méthodes qui ignorent la hausse de janvier et gagne à 1-3 mois, mais le naïf saisonnier corrigé de la croissance fait mieux à 6-12 mois. L'ablation montre que prolonger les probabilités à 6 mois du modèle turnover sur 12 mois surestime les démissions de 9 %. L'intérêt du modèle tient donc à sa **décomposition** (démissions, fins de CDD, retraites, embauches) et au scénario modifiable, pas à sa précision. Au 31/08/2026 (champion turnover LOGREG) : effectif 1 069 → 1 055 à 12 mois, masse mensuelle 1 717 368 → 1 776 728 TND, 18 recommandations (succession des départs en retraite, renouvellement des CDD, recrutement). Les recommandations budgétaires s'activent avec le paramètre `budget_masse_salariale_<AAAA>`.

### 7.12.3 Formations obligatoires : risque de dépasser l'échéance

Unité : une formation obligatoire ouverte à la fin du mois t (échéance dans les 120 jours, non terminée, salarié actif) ; cible : non terminée à l'échéance ; 14 256 lignes, dont 13 154 étiquetées. Modèle : régression logistique L2 à 9 variables (délai restant, durée, ancienneté, marge habituelle du salarié, retards de l'équipe, heures sup, échéance en été), calibration de Platt ; salariés opposés exclus ([RESULTATS_IA_FORMATION.md](../RESULTATS_IA_FORMATION.md)).

*Tableau 7.12 — Formations, deux origines de test (IC 95 %, bootstrap groupé par salarié).*

| Métrique | Origine 30/06/2025 | Origine 30/06/2024 |
|---|---|---|
| AUC logistique / règle « échéance < 30 j et non commencée » | 0,700 / 0,601 | 0,713 / 0,598 |
| PR-AUC logistique / règle | 0,523 / 0,335 | 0,499 / 0,311 |
| Précision à capacité égale (écart) | +0,051 [−0,005 ; 0,111] | +0,055 [0,017 ; 0,090] |
| O/E | 1,104 | 1,044 |
| Précision du niveau ÉLEVÉ (p ≥ 0,50) | 0,773 | 0,764 |

Presque tout le signal vient du délai restant (0,690 d'AUC avec lui seul) : sur ce simulateur, l'engagement du salarié est peu visible. Les niveaux sont à seuils fixes (ÉLEVÉ ≥ 0,50, MOYEN ≥ 0,25), sans règle de capacité, une relance coûtant peu. Au 31/08/2026 : 187 formations ouvertes évaluées, 29 à risque élevé, 63 moyen, 29 relances RH et 1 recommandation d'équipe. Limite propre à AJIR : la date d'affectation n'est pas exportée, une formation est considérée connue 120 jours avant l'échéance.

### 7.12.4 Charge de travail : heures supplémentaires et surcharge soutenue

Cible : intensité des heures supplémentaires pointées par ETP d'une équipe ou d'un département à 1-3 mois (log, en écart à la moyenne 12 mois). Modèle : 6 ridges (portée × horizon), 27 variables (niveau récent, saisonnalité du groupe et du département, tendance, calendrier tunisien, effectif, départs non remplacés), intervalle conforme à 80 %. Test : 24 origines (2024-08 → 2026-07), réplication sur le scénario « charge » ([RESULTATS_IA_CHARGE.md](../RESULTATS_IA_CHARGE.md)).

*Tableau 7.13 — Charge de travail, tous horizons (MAE en heures sup par ETP et par mois).*

| Jeu | Portée | Ridge | Meilleure baseline | Écart [IC 95 %] | Couverture 80 % |
|---|---|---|---|---|---|
| mixte | Équipe | 1,92 | 2,02 (moyenne 3 mois) | −5,1 % [−0,13 ; −0,07] | 80 à 82 % |
| mixte | Département | 0,57 | 0,63 (dernier mois) | −10,4 % [−0,11 ; −0,01] | 77 à 79 % |
| charge | Équipe | 2,26 à 2,78 | 2,37 à 2,96 | −0,11 à −0,18 (IC hors 0) | 79 à 80 % |
| charge | Département | 0,64 à 0,83 | 0,63 à 0,84 | aucun gain | 77 à 80 % |

Le gain est modeste mais significatif pour les équipes sur les deux jeux ; il est nul pour les départements du scénario « charge ». Une équipe est « en tension » si sa prévision dépasse 12,8 h par ETP (quantile 85 % de l'apprentissage) : précision 70,8 % pour un rappel de 59,5 %, 93 % quand la borne basse dépasse aussi le seuil. La **surcharge individuelle** est une règle explicable, pas un modèle : plus de 20 h supplémentaires chaque mois depuis au moins 3 mois (paramètres `workload_ot_threshold_h`, `workload_ot_months`), soit 2,7 % des salariés-mois. Son lien avec la démission dépend entièrement du mécanisme simulé (lift 1,16, IC contenant 1, sur le jeu mixte ; 5,18 sur « charge ») : la recommandation est motivée par la charge elle-même, jamais présentée comme une prédiction de départ. Au 31/08/2026 : 486 prévisions (154 équipes, 8 départements), 17 recommandations collectives et 14 surcharges individuelles (RH seulement).

### 7.12.5 Bilan des quatre volets

Sur le simulateur, deux modèles apportent un gain net sur leurs baselines (absentéisme, formations), un gain modeste mais significatif (charge des équipes), et un ne bat pas la persistance (effectif), ce que le rapport assume. Tous partagent le même cadre : pas de fuite, parité Python / TypeScript vérifiée, intervalles de prévision dont la couverture est mesurée (puis recalibrée par prédiction conforme dans une seconde version, section 7.16), recommandations explicables et décidées par un humain, prévisions agrégées et petits groupes protégés.

## 7.13 Recherche automatique du meilleur levier

### 7.13.1 Objectif

La simulation *what-if* (section 7.9) laisse la RH essayer les leviers un à un. Avec quatre leviers et leurs bornes, les combinaisons sont nombreuses (1 429 sur la grille retenue), et il est difficile de savoir laquelle est la plus modeste. La recherche automatique répond à une question précise : **quelles sont les plus petites combinaisons de leviers qui feraient passer l'estimation du modèle sous le niveau de risque actuel** (Élevé vers Moyen ou Faible, Moyen vers Faible), avec le modèle du calcul publié et les seuils en vigueur, capacité RH et lift du niveau Moyen (section 7.7) ([RESULTATS_IA_LEVIER.md](../RESULTATS_IA_LEVIER.md)).

Sur la fiche, réservée à la RH, un bouton « Trouver les leviers les plus efficaces » affiche au plus trois pistes. Chaque carte donne les leviers, l'estimation avant et après, le niveau atteint et la hausse de salaire chargée. Le bouton « Appliquer à la simulation » pré-remplit le formulaire du *what-if* ; la RH relit les leviers et lance elle-même la simulation. Rien n'est enregistré hormis l'audit.

### 7.13.2 Méthode

- **Grille discrète** dans les bornes du *what-if* : salaire de 0 à 30 % par pas de 2,5 % (13 valeurs), heures supplémentaires retirées de 0 à 40 h par mois par pas de 10 h (5 valeurs), formation de 0 à 200 h par pas de 20 h (11 valeurs), promotion d'un grade ou non. La grille compte 13 × 5 × 11 × 2 − 1 = **1 429 combinaisons**. Un levier inapplicable (salaire de base non visible, grade maximal ou inconnu) est retiré de la grille, et l'écran le signale.
- **Coût normalisé, ou « ampleur »** : salaire / 30 % + heures supplémentaires / 40 h + formation / 200 h + 1 si promotion. Chaque levier poussé à sa limite vaut 1, et une promotion compte comme un pas fort. À ampleur égale, la combinaison qui utilise le moins de leviers passe d'abord, puis celle qui demande le moins de salaire : l'ordre est total et le résultat déterministe.
- **Sélection et dominance.** La grille est parcourue par ampleur croissante, et la première combinaison qui fait baisser le niveau est la plus petite. Une combinaison qui utilise chaque levier au moins autant qu'une piste déjà retenue est dite **dominée** : elle est écartée sans calcul, car elle ne ferait qu'en faire plus qu'une piste déjà suffisante. Le résultat est la liste des trois plus petites pistes non dominées, ou moins s'il n'en existe pas trois. Si aucune combinaison ne suffit, l'écran l'écrit (« Aucune combinaison dans les limites de la simulation ne fait baisser le niveau ; voir les facteurs associés ») et renvoie vers la zone Estimation. Un salarié déjà Faible n'est pas concerné.
- **Aucun second modèle.** Chaque essai passe par les fonctions du calcul mensuel : application des leviers aux données sources, recalcul des variables, score du modèle publié, puis niveau par la règle de capacité (ADR-006). La recherche hérite donc des deux précautions du *what-if* (section 7.9).
- **Calcul borné.** Les leviers agissent sur des sources disjointes (paie et carrière, pointages, formations), et chaque variable ne lit qu'une de ces sources. Les variables d'une combinaison se composent donc à partir de 39 recalculs au plus (25 pour le salaire et la promotion, 4 pour les heures supplémentaires, 10 pour la formation), au lieu de 1 429. Le placement dans la population du mois réutilise les scores des autres salariés, calculés une seule fois, et une recherche par dichotomie qui reproduit au bit près le départage de la règle de capacité. Chaque piste retenue est enfin recalculée en entier par le moteur *what-if* : les chiffres de la carte sont exactement ceux que donnera la simulation. Le plafond est de 1 + 39 recalculs de variables, 1 429 prédictions et 6 simulations complètes, sans aucun appel réseau.

### 7.13.3 Validation et temps de calcul

La validation repose sur un **oracle exhaustif** (35 tests). Pour chaque salarié testé, les 1 429 combinaisons sont recalculées en entier : avec B0, des salariés Élevé avec et sans piste ; avec la régression logistique, tous les salariés Élevé et Moyen. Les tests vérifient que les variables composées égalent les variables recalculées, que le placement accéléré égale la règle de capacité, et que les pistes retenues sont exactement les plus petites combinaisons suffisantes et non dominées de l'oracle. Sur le scénario de référence, le salarié F (B0, 4 points, Élevé) obtient deux pistes, « promotion seule » et « +15 % de salaire et −20 h supplémentaires », toutes deux au niveau Faible ; un pas de moins sur l'une ou l'autre ne suffit plus. Le salarié A, dont les facteurs associés (absences, formation obligatoire en retard) sont hors des leviers, n'en obtient aucune. Enfin, le *what-if* lancé avec les leviers d'une piste rend la même estimation, le même niveau, les mêmes changements et le même coût que la carte.

Les règles d'accès sont celles du *what-if* : RH seulement (refus audité pour le manager et l'ADMIN), refus pour un salarié non évalué ou opposé au traitement, audit de chaque recherche (statut, nombre de pistes, durée).

*Tableau 7.14 — Temps de la recherche, mesuré par les tests sur le poste de développement le 04/10/2026 (source : [RESULTATS_IA_LEVIER.md](../RESULTATS_IA_LEVIER.md), § 3).*

| Cas | Salariés évalués | Durée | Recalculs | Combinaisons évaluées |
|---|---|---|---|---|
| Scénario de référence (B0), salarié F | 8 | 24 ms | 42 | 485 sur 1 429 |
| Même scénario et 2 000 salariés ajoutés (paie sur 25 mois) | 2 008 | 818 ms | 43 | 53 sur 1 429 (3 pistes) |

Le budget vérifié par les tests est de moins de 10 secondes et d'au plus 46 recalculs. Sur la base de démonstration (987 salariés évalués), l'ordre de grandeur attendu est celui de la seconde ligne ; il n'a pas été mesuré dans l'application pendant le chantier.

*Figure 7.5 — Pistes proposées par la recherche du meilleur levier dans le panneau what-if (capture à prendre).*

### 7.13.4 Limites et cadrage

- **Grille discrète** : une combinaison plus fine (par exemple +13 %) n'est pas explorée ; la piste « +15 % » peut dépasser le strict nécessaire de moins d'un pas.
- **Le coût normalisé est une convention.** Il ne mesure ni le coût financier (affiché à part, pour le salaire seulement, hors formation) ni la faisabilité : budget, poste disponible pour une promotion, charge de l'équipe si l'on retire des heures supplémentaires.
- **Monotonie non garantie** : avec la régression logistique, qui n'impose aucune contrainte de signe (section 7.6.8), retirer des heures supplémentaires peut faire monter l'estimation. La recherche évalue chaque combinaison sans supposer la monotonie.
- **Niveau relatif** : le niveau dépend de la population du mois et de la capacité RH ; une piste peut ne plus suffire au calcul suivant.
- **Hypothèse de composition** : l'indépendance des sources par levier est vraie dans le calcul actuel des variables. Une variable future qui croiserait deux sources la romprait. L'oracle des tests le détecterait, et les pistes affichées resteraient exactes, puisqu'elles sont recalculées en entier ; elles seraient au pire incomplètes.

Le cadrage éthique est écrit au-dessus du bouton : « Pistes à discuter lors d'un échange, pas une décision. Estimation du modèle, non causale. » La mention non causale du *what-if* est conservée. Une piste dit seulement que **le modèle**, qui décrit des facteurs associés, classerait le salarié plus bas ; elle ne dit pas que l'action changerait sa décision de rester ou de partir. La recherche n'écrit rien en base, ne crée ni recommandation ni alerte, n'utilise que les leviers d'action (aucun attribut sensible, aucune donnée de santé) et n'existe pas côté manager.

## 7.14 Comparaison appariée des interventions (estimation non causale)

### 7.14.1 Objectif

La page Interventions, réservée à la RH, montre ce que devient le niveau de risque après une action (section 7.8.3). Cette lecture « avant / après » ne compare les collaborateurs suivis à personne. Or un niveau Élevé redescend souvent de lui-même le mois suivant : c'est le **retour vers la moyenne**. De plus, la RH choisit qui suivre, ce qui crée un **biais de sélection**. La section ajoutée compare donc, **par type d'action**, chaque collaborateur suivi à un collaborateur **non suivi au profil proche, évalué le même mois**, et affiche l'écart sur deux indicateurs avec une fourchette à 95 % ([RESULTATS_IA_INTERVENTIONS.md](../RESULTATS_IA_INTERVENTIONS.md)).

Son titre à l'écran le dit : il s'agit d'une **estimation non causale, sous hypothèses**. Elle tient compte des variables enregistrées dans AJIR, jamais des raisons invisibles du choix des personnes suivies. Aucun nombre de départs n'en est déduit et aucune décision n'en découle automatiquement.

### 7.14.2 Méthode

- **Unités et date de référence.** Un suivi est la **première** action réalisée d'un type donné pour un collaborateur : intervention enregistrée ou recommandation marquée « réalisée ». Sa date de référence t est la fin du mois qui précède l'action. Les variables sont celles du calcul mensuel, visibles à la date de saisie (ADR-005), et le niveau est celui du dernier calcul publié au plus tard à t. Aucune information postérieure à t n'entre dans le modèle de sélection.
- **Témoins.** Les candidats sont les collaborateurs évalués au même mois t, sans aucune action réalisée, tous types confondus, dans les six mois qui précèdent ou suivent t. Un témoin n'est associé à un suivi que s'il est encore présent, et sans démission, à la date de l'action de ce suivi. Les collaborateurs opposés au traitement sont exclus des deux groupes.
- **Score de propension** (Rosenbaum et Rubin, 1983). Une régression logistique ridge estime la probabilité d'être suivi à partir de 27 variables : les 25 variables du modèle de risque (aucun attribut sensible, aucune donnée de santé) et deux indicatrices des niveaux Élevé et Moyen au dernier calcul, premier facteur de sélection puisque les recommandations visent ces niveaux. Les variables sont standardisées, la pénalité vaut λ = 1 et l'intercept n'est pas pénalisé ; la pénalité garantit la convergence avec peu de suivis.
- **Appariement** 1:1 au plus proche voisin sur le logit du score, **exact sur le mois t**, dans un caliper de 0,2 écart-type du logit (Austin, 2011), sans remise. Un suivi sans voisin dans le caliper reste sans comparaison et fait baisser la part appariée.
- **Indicateurs.** Le premier est la démission dans les six mois, c'est-à-dire l'étiquette `y6` de la vue `v_label_panel` (section 7.1.2), seulement si le suivi est complet. Le second est la baisse du niveau de risque trois mois après l'action, selon la même lecture que l'avant / après de la page.
- **Écart et fourchette.** L'écart est la moyenne des différences suivi − témoin sur les paires mesurées, en points de pourcentage. La fourchette à 95 % est obtenue par **bootstrap des paires** (2 000 tirages ; Austin et Small, 2014), avec une graine fixe : la page affiche toujours la même fourchette. L'écart sans appariement figure dans « Voir les données », pour montrer ce que l'appariement corrige.
- **Diagnostics d'équilibre.** Pour chaque variable, la différence standardisée (DS) est calculée avant et après appariement, ainsi que la part des suivis appariés et le support commun. Le verdict s'affiche en mots : « Groupes comparables » si |DS| < 0,25 sur **toutes** les variables après appariement (Rubin, 2001 ; Stuart, 2010) et si au moins 80 % des suivis sont appariés ; « Comparaison fragile » sinon, avec la raison.

**Le seuil du verdict a été choisi après coup.** Le seuil prévu au départ, 0,1 sur la plus forte DS, classait 100 % des réplications de la validation en « fragile », y compris celles sans biais : avec 27 variables et une centaine de paires, le hasard seul porte la plus forte DS vers 0,2. Il a été relevé à 0,25 après lecture de la validation (section 7.14.3). C'est un degré de liberté du chercheur, à reconsidérer sur des données réelles.

**Gardes.** Sous **20 suivis comparables** pour un type d'action, l'écran affiche « Effectif insuffisant pour comparer », sans aucun chiffre ; sous 20 paires mesurées pour un indicateur, cet indicateur n'est pas chiffré. La section est réservée à la RH, et aucun nom, identifiant, score de propension ni paire ne sort de la couche d'accès aux données. L'écart est affiché dans une couleur neutre, jamais en vert « favorable », et n'est jamais multiplié par un effectif. Cinq hypothèses sont écrites à côté du chiffre : pas de facteur caché (hypothèse fausse si la RH choisit sur des informations absentes d'AJIR, comme un entretien informel, une offre externe connue ou la motivation), support commun, pas d'interférence entre collègues, action unique, issue bien mesurée.

**Exécution en TypeScript.** Contrairement aux modèles prédictifs (ADR-002), le score de propension est estimé à la volée en TypeScript. C'est un intermédiaire descriptif, jamais affiché ni stocké, qui doit être réestimé dès qu'une action est marquée « réalisée » : des coefficients figés hors ligne seraient périmés le lendemain. Le risque de divergence visé par ADR-002 est traité de la même façon que pour les modèles : un jeu golden produit par scikit-learn (900 unités, 122 suivis) est rejoué par les tests. Le TypeScript retrouve les coefficients et le caliper à moins de 10⁻⁶ près, les mêmes 108 paires et les mêmes DS (au plus 0,856 avant appariement, 0,089 après).

### 7.14.3 Validation

**Données synthétiques à effet connu.** Avec un effet constant de −10 points et une sélection confondue par une variable qui pousse aussi l'issue, les tests vérifient plusieurs propriétés. La comparaison brute est biaisée (plus de 5 points d'écart à l'effet), alors que l'estimation appariée retrouve l'effet à moins de 5 points. La plus forte DS passe de plus de 0,5 à moins de 0,1. La fourchette couvre l'effet dans au moins 80 % de 30 réplications et, sous effet nul, exclut zéro dans au plus 20 % des réplications.

**Validation semi-synthétique sur le simulateur.** Le simulateur ne modélise aucune action RH ni aucun effet d'action (ADR-010) : la comparaison directe d'une estimation à un effet simulé est impossible. Nous gardons donc les variables, les niveaux et les démissions réels du jeu `mixte_medium_s1` : mois de référence de mars 2024 à février 2026, suivi de six mois complet, soit 23 669 lignes salarié × mois pour 1 273 salariés. Nous tirons ensuite des suivis fictifs selon une règle connue, puis nous retirons une part π = 0,4 des démissions des suivis : l'effet injecté est donc connu. Quatre scénarios sont rejoués 40 fois chacun avec le code de production.

*Tableau 7.15 — Validation semi-synthétique sur la démission dans les six mois, en points de pourcentage, moyennes sur 40 réplications (source : [RESULTATS_IA_INTERVENTIONS.md](../RESULTATS_IA_INTERVENTIONS.md), § 5.3).*

| Scénario | Sélection des suivis | Effet injecté | Suivis | Effet réalisé | Estimation | Biais | Couverture 95 % | Largeur | Fourchette excluant 0 | « Groupes comparables » |
|---|---|---|---|---|---|---|---|---|---|---|
| OBS_EFFET | Variables observées (niveau, heures supplémentaires, compa-ratio) | π = 0,4 | 131 | −1,4 | −1,5 | −0,1 | 93 % | 8,5 | 5 % | 35 sur 40 |
| OBS_NUL | Variables observées | aucun | 129 | 0,0 | +0,2 | +0,2 | 93 % | 8,9 | 7 % | 34 sur 40 |
| OBS_PETIT | Variables observées | π = 0,4 | 38 | −1,5 | −1,2 | +0,3 | 80 % | 13,5 | 5 % | 1 sur 40 |
| LATENT | Niveau et engagement latent du simulateur (**non observé**) | π = 0,4 | 124 | −4,9 | **+3,9** | **+8,8** | **23 %** | 11,9 | 20 % | 35 sur 40 |

Quatre constats se dégagent :

1. **Sélection sur variables observées.** L'estimation est sans biais notable (au plus 0,3 point), et sa couverture (93 %) est proche des 95 % annoncés. Mais l'effet injecté (−1,4 point) est bien plus petit que la demi-largeur de la fourchette, d'environ 4 points : la fourchette exclut zéro dans 5 % des réplications, autant que sous effet nul (7 %). **Avec 130 suivis et un taux de démission de quelques pour cent, un effet de 1 à 2 points est indétectable.**
2. **Retour vers la moyenne.** Aucun effet n'est injecté sur le niveau de risque. Pourtant, 19 à 21 % des suivis voient leur niveau baisser dans la lecture avant / après, alors que l'écart apparié reste proche de zéro (−1,8 à +0,7 point) et que sa fourchette contient zéro dans 88 à 97 % des réplications. C'est l'apport principal de la comparaison appariée sur ce simulateur. Pour la démission, la comparaison brute était déjà peu biaisée (−0,5 à −0,1 point) : les variables de sélection prédisent faiblement la démission à six mois.
3. **Petits effectifs.** Avec environ 40 suivis, la couverture tombe à 80 %, l'erreur quadratique moyenne atteint 5,1 points et la plus forte DS 0,41 ; le verdict affiche « comparaison fragile » dans 39 réplications sur 40. Le seuil de 20 suivis est un minimum, pas une garantie.
4. **Confusion non observée (LATENT).** Quand la sélection dépend de l'engagement, variable du simulateur absente des données, **l'estimation change de signe** : +3,9 points pour un effet réalisé de −4,9. La couverture tombe à 23 %, et l'appariement ne corrige rien (biais sans appariement de +9,0 points). Or le verdict affiche « groupes comparables » dans 35 réplications sur 40 : **les groupes paraissent comparables alors que le signe est inversé**, car les diagnostics d'équilibre ne voient que les variables mesurées. C'est la première ligne de l'encadré « Ce que ce chiffre ne dit pas » de l'écran.

Avec le seuil initial de 0,1, aucune réplication n'aurait été jugée « comparable ».

### 7.14.4 Résultat sur la base de démonstration

La base de démonstration ne contient qu'une intervention : un entretien du 02/10/2026, postérieur à la fin des données. Aucun type d'action n'atteint 20 suivis comparables, et la section affiche « Effectif insuffisant pour comparer » pour chaque type, sans chiffre. Le seul résultat chiffré de la méthode est donc sa validation semi-synthétique.

### 7.14.5 Limites

- **Estimation non causale** : une confusion non observée peut inverser le signe de l'écart sans alerter les diagnostics (scénario LATENT).
- **Puissance** : avec 130 suivis, la fourchette mesure environ 9 points de large ; avec 40 suivis, sa couverture réelle tombe à 80 %.
- **Seuil du verdict choisi après la validation** (0,1, puis 0,25).
- **Appariement glouton sans remise** : le résultat dépend de l'ordre de traitement des suivis, et les suivis les plus atypiques peuvent rester sans paire ; l'écart ne porte alors que sur les suivis appariés.
- **Bootstrap des paires** : il ignore l'incertitude de l'estimation du score de propension et les dépendances entre collègues d'une même équipe ; la fourchette est probablement un peu trop étroite.
- **Baisse du niveau** : le niveau est un rang relatif à la capacité RH (ADR-006), et les sortants n'ont pas de niveau « après ».
- **Première action seulement** par type et par collaborateur ; les actions répétées ne sont pas analysées.
- **Simulateur sans action RH** : la validation prouve la méthode, pas un effet réel.

Deux variantes ont été écartées : la pondération inverse par le score, dont les poids deviennent extrêmes avec peu de suivis, et l'appariement avec remise, pour lequel le bootstrap naïf donne une variance incorrecte (Abadie et Imbens, 2008). La modélisation d'uplift, qui exige une affectation en partie contrôlée, reste une perspective (chapitre 10).

## 7.15 Typologie des départs

### 7.15.1 Objectif et population

La typologie répond à une question descriptive : **quelles grandes familles de départs volontaires observe-t-on, décrites par des données professionnelles ?** Elle complète la page Rétention, réservée à la RH, par des profils agrégés ; aucun salarié n'y est étiqueté ([RESULTATS_IA_TYPOLOGIE.md](../RESULTATS_IA_TYPOLOGIE.md)).

Un départ est une démission ou un abandon de poste dont la sortie et la saisie sont visibles au 31/08/2026 : 546 départs, du 02/11/2020 au 28/08/2026. Chacun est décrit par les variables du calcul mensuel **à la veille du départ** : celles de la dernière fin de mois avant la date de l'événement (date de démission, sinon date de sortie moins un mois, comme pour l'étiquette du modèle), au plus six mois avant. 480 départs sont classables. Les 66 autres n'ont aucune ligne de variables dans les six mois qui précèdent : arrivées trop récentes, contrat non suivi ou début d'historique. La sélection est écrite une seule fois et exécutée telle quelle par Python et par TypeScript.

### 7.15.2 Variables

Sept variables entrent dans la distance : l'ancienneté, les heures supplémentaires sur 3 mois et les heures de formation sur 12 mois, transformées par log(1 + x) ; les mois depuis la dernière promotion, l'augmentation sur 12 mois et le compa-ratio ; le taux d'absence hors santé sur 12 mois, en racine carrée. Chacune est bornée à ses quantiles de 1 % et 99 %, puis standardisée. Le contrat (CDD) et la famille de métier servent seulement à décrire les profils.

Sont exclus : le sexe, l'âge, la situation familiale, le gouvernorat et toute donnée de santé (ADR-009) ; les retards, la régularité d'arrivée, les jours sans pointage, les absences courtes et le facteur de Bradford, pour que rien ne ressemble à une détection d'abus ; les évaluations ; le contexte d'équipe ; les mois depuis la dernière augmentation, qui mesureraient surtout le mois du départ puisque les augmentations tombent en janvier. Le code TypeScript refuse un modèle qui citerait une variable hors de cette liste blanche ou un libellé sensible.

**Spécification écartée.** Un premier passage gardait l'indicatrice CDD dans la distance. Il donnait des partitions plus stables : 3 profils, ARI moyen de 0,682 [0,403 ; 0,941], Jaccard minimal de 0,718, silhouette de 0,181. Mais la variable binaire structurait le regroupement : à deux profils, la coupure était exactement CDI / CDD (0 % contre 91 % de CDD). Cette stabilité reflétait une coupure triviale, déjà connue de la RH. Le contrat est donc passé en descripteur, au prix d'une stabilité moyenne. Ce choix a été fait après lecture du premier passage, et il est rapporté comme tel.

### 7.15.3 Méthode

1. **k-moyennes** (scikit-learn, 50 initialisations, graine fixe) pour k = 3 à 8.
2. **Taille minimale** de max(20, 5 % des départs), soit **24** départs : tant qu'un profil est plus petit, son centre est retiré et les k-moyennes sont relancées depuis les centres restants. Le nombre de profils effectif peut donc être inférieur à k.
3. **Stabilité** (Hennig, 2007) : 200 rééchantillonnages bootstrap, la même procédure sur chacun, puis l'affectation de tous les départs aux centres obtenus. On mesure l'indice de Rand ajusté (ARI ; Hubert et Arabie, 1985) avec la partition de référence et, pour chaque profil, l'indice de Jaccard maximal moyen.
4. **Choix** : parmi les partitions de 3 à 6 profils effectifs, on garde les partitions stables (ARI moyen ≥ 0,6 et Jaccard minimal ≥ 0,6), puis on retient la meilleure silhouette (Rousseeuw, 1987). **Sans partition stable, une règle de repli retient la plus stable**, c'est-à-dire celle dont l'ARI moyen est le plus élevé.
5. **Description** : pour chaque profil, l'écart standardisé de chaque variable à l'ensemble des départs donne 3 ou 4 traits, écrits en mots avec la valeur du profil et celle de l'ensemble. Le libellé reprend les deux traits les plus marqués, en privilégiant la carrière, le salaire et le travail ; **les absences ne nomment jamais un profil**.

*Tableau 7.16 — Choix du nombre de profils (source : [RESULTATS_IA_TYPOLOGIE.md](../RESULTATS_IA_TYPOLOGIE.md), « Choix de k »).*

| k demandé | Profils après fusion | Tailles | Silhouette | ARI moyen [IC 95 %] | Jaccard minimal |
|---|---|---|---|---|---|
| 3 | 2 | 253, 227 | 0,167 | hors plage (moins de 3 profils) | — |
| 4 | 3 | 177, 163, 140 | 0,148 | 0,483 [0,249 ; 0,821] | 0,496 |
| **5** | **4** | **158, 124, 110, 88** | **0,137** | **0,513 [0,249 ; 0,861]** | **0,568** |
| 6 | 4 | 165, 122, 113, 80 | 0,139 | doublon de la partition à 4 profils | — |
| 7 | 5 | 145, 104, 97, 78, 56 | 0,136 | 0,401 [0,241 ; 0,613] | 0,374 |
| 8 | 5 | 142, 97, 95, 78, 68 | 0,135 | doublon de la partition à 5 profils | — |

**Aucune partition de 3 à 6 profils ne passe la règle de stabilité.** La règle de repli retient la plus stable, à 4 profils (ARI moyen de 0,513). Les silhouettes, de 0,13 à 0,17, indiquent des familles qui se chevauchent : les départs forment un continuum plus que des groupes séparés. Nous gardons ce repli plutôt que de forcer une partition.

### 7.15.4 Résultats

*Tableau 7.17 — Les quatre profils de départs volontaires ; entre parenthèses, la valeur sur l'ensemble des 480 départs classés (source : [RESULTATS_IA_TYPOLOGIE.md](../RESULTATS_IA_TYPOLOGIE.md), « Profils obtenus »).*

| Profil | Départs (part) | Ancienneté médiane | Autres traits marqués | Stabilité (Jaccard) |
|---|---|---|---|---|
| 1. Arrivées récentes, surtout en CDD | 158 (32,9 %) | 24 mois (55) | 55 % en CDD (26 %) ; sans promotion depuis 17 mois en médiane (35) ; absence hors santé de 0,6 % (1,4 %) | 0,67 |
| 2. Formation soutenue, salaire au-dessus de la médiane du poste | 124 (25,8 %) | 78,5 mois (55) | 21 h de formation sur 12 mois (12 h) ; salaire à 105 % de la médiane du poste (99 %) ; sans promotion depuis 54 mois (35) | 0,57 |
| 3. Grande ancienneté, sans promotion depuis longtemps | 110 (22,9 %) | 125 mois (55) | sans promotion depuis 64 mois (35) ; salaire à 92 % de la médiane du poste (99 %) ; 3,7 h supplémentaires par mois (7,0 h) | 0,61 |
| 4. Peu de formation | 88 (18,3 %) | 46 mois (55) | 3,1 h de formation (12 h) ; absence hors santé de 3,4 % (1,4 %) ; sans promotion depuis 24 mois (35) | 0,57 |

Le profil 3 correspond à une famille attendue : des salariés anciens, sans promotion depuis longtemps, payés sous la médiane du poste. Le profil 1 regroupe les départs précoces, souvent en CDD. Aucun profil « surcharge d'heures supplémentaires » n'apparaît : les heures supplémentaires ne distinguent nettement aucun groupe de départs. Le trait le plus marqué du profil 4 est le taux d'absence ; par choix éthique, il ne nomme pas le profil, dont le libellé vient du second trait.

**Validation externe.** Le croisement avec le mécanisme simulé de chaque démission (480 sur 480 retrouvés ; la vérité terrain n'est jamais importée dans l'application) donne un **ARI de 0,016**, proche de 0, et une information mutuelle normalisée de 0,019. Les profils ne retrouvent pas les causes simulées (offre externe, seuil d'insatisfaction, événement personnel). Ce n'est pas leur objet : ils décrivent des familles de situations observées au moment du départ, pas des causes. Des tendances existent néanmoins : le profil 1 compte 64 % de départs sur offre externe (54 % sur l'ensemble), le profil 4 50 % de départs par seuil d'insatisfaction (36 %).

**Équité.** Le V de Cramér entre profil et sexe vaut **0,048**, et la part de femmes va de 34 à 40 % selon le profil (38 % sur l'ensemble) : aucun profil n'est un indicateur indirect du sexe. Entre profil et tranche d'âge, il vaut **0,269** (0,339 au premier passage). L'âge est exclu des variables, mais l'ancienneté et la carrière en sont des **indicateurs indirects** : le profil « Arrivées récentes » compte 39 % de moins de 30 ans (30 % sur l'ensemble) et 3 % de 45 ans et plus (13 %) ; le profil « Grande ancienneté » compte 27 % de 45 ans et plus. Lire ces profils comme des profils d'âge serait un contresens, et aucune action ne doit viser une tranche d'âge.

**Exécution et affichage.** Le modèle (transformations, bornes, standardisation, quatre centres) est exporté en JSON avec un jeu golden (150 départs réels et 50 points synthétiques hors bornes), rejoué en TypeScript à 10⁻⁹ près ; sur la base de démonstration, la chaîne complète retrouve les mêmes 480 départs et les mêmes effectifs (158, 124, 110, 88). L'affectation est calculée à l'affichage, en 130 ms environ, et mise en cache pendant dix minutes. La section « Profils de départs » de la page Rétention est réservée à la RH : côté manager, dans une hiérarchie de 5 à 12 personnes, un départ par profil se déduirait ; l'ADMIN reçoit un refus audité. Un profil de moins de 5 départs est masqué, avec masquage secondaire, et aucun profil n'est affiché sous 30 départs classés.

*Figure 7.6 — Section « Profils de départs » de la page Rétention (capture à prendre).*

### 7.15.5 Limites

- **Stabilité moyenne** (ARI moyen de 0,51) et silhouettes faibles : les profils sont une lecture simplifiée d'un continuum, et deux d'entre eux (2 et 4) ont un indice de Jaccard de 0,57. Ils sont à réentraîner et à revalider sur les données d'un client avant toute communication.
- **Indicateurs indirects de l'âge** (V de Cramér de 0,27) par l'ancienneté et la carrière.
- **Fenêtre « veille du départ »** jusqu'à six mois avant la démission. Dans le simulateur, la décision précède la démission de 0 à 2 mois et s'accompagne de signaux faibles (heures supplémentaires divisées par deux, absences) : les traits d'heures supplémentaires et d'absences peuvent refléter en partie une décision déjà prise.
- **66 départs non classés** (12 %), et département et famille de métier pris à leur dernière valeur connue.
- **Spécification fixée après lecture d'un premier passage** (contrat passé en descripteur).
- **Données simulées** : les profils valident la méthode, pas une réalité d'entreprise.

## 7.16 Fourchettes de prévision conformes

### 7.16.1 Objectif

Les prévisions d'absentéisme, de charge de travail, d'effectifs et de masse salariale (section 7.12) affichent une « fourchette probable à 80 % ». La première version mesurait la couverture de ces fourchettes sans la garantir : le tableau 7.10 la montre à 75,0 % et 70,8 % pour l'absentéisme de l'entreprise. Ce travail mesure, sur une fenêtre de test, la part des valeurs observées qui tombent réellement dans les fourchettes, et la **garantit** par une calibration conforme (Vovk et al., 2005 ; Lei et al., 2018), écrite dans une nouvelle version de chaque modèle ([RESULTATS_IA_CONFORME.md](../RESULTATS_IA_CONFORME.md)). Les modèles eux-mêmes (coefficients, paramètres, saisonnalité) ne changent pas.

### 7.16.2 Méthode

- **Score signé** de chaque prévision hors échantillon : z = (y − ŷ) / s, où s est l'échelle que la version 1 utilisait déjà pour adapter la fourchette au niveau : racine de la prévision rapportée aux jours ouvrés pour l'absentéisme, échelle de bruit du groupe sur log(1 + heures supplémentaires par ETP) pour la charge, écart-type du modèle stock-flux pour l'effectif, prévision elle-même pour la masse.
- **Quantile conforme à rangs** (*split conformal*). Sur les n scores de calibration triés, on pose m = ⌈(n + 1) × 0,8⌉, i = ⌊(n + 1 − m) / 2⌋ et j = i + m ; la fourchette est [z(i) ; z(j)]. Pour une prévision future échangeable avec celles de la calibration, P(z(i) ≤ Z ≤ z(j)) ≥ (j − i) / (n + 1) ≥ 80 %. Il faut au moins 9 scores. Les bornes appliquées sont [ŷ + bas × s ; ŷ + haut × s], la borne basse étant ramenée à 0 ; elles deviennent asymétriques quand les erreurs le sont.
- **Un quantile par portée et par horizon** (calibration conforme dite « de Mondrian »). Pour l'absentéisme, l'entreprise, les départements et les équipes sont séparés ; la version 1 regroupait l'entreprise et les départements, d'où 75 % pour l'une et 85 % pour les autres. Pour la charge, les équipes et les départements sont séparés. Pour les effectifs et la masse, l'entreprise et les départements le sont aussi, selon la source des démissions projetées (taux historique ou LOGREG), avec des quantiles rendus monotones : ils ne se resserrent jamais quand l'horizon s'allonge.
- **Découpage temporel sans fuite.** La calibration utilise les prévisions hors échantillon dont la **cible** est observée au plus tard à la première origine de test. Le test porte sur les prévisions des origines suivantes, jamais utilisées pour caler un quantile. Les quantiles écrits dans le modèle sont exactement ceux mesurés sur le test, sans recalage après coup. Les fenêtres de calibration couvrent 24 mois pour l'absentéisme (2022-07 à 2024-06) et pour les effectifs (2022-10 à 2024-09), 12 mois pour la charge (2023-09 à 2024-08) ; les fenêtres de test couvrent 23 à 26 mois observés, jusqu'en août 2026.
- **« Avant »** désigne la procédure de la version 1, rejouée sur les **mêmes** prévisions de test : quantiles glissants pour l'absentéisme, quantile du résidu absolu sur les 12 mois précédents pour la charge, quantiles calés sur 2021-2022 pour les effectifs et la masse.

### 7.16.3 Résultats

*Tableau 7.18 — Couverture de la fourchette à 80 % sur la fenêtre de test, absentéisme et charge, tous horizons (source : [RESULTATS_IA_CONFORME.md](../RESULTATS_IA_CONFORME.md), § 3.1 et 3.2).*

| Sujet | Portée | Prévisions de test | Avant : procédure v1 | Après : conforme [IC 95 %] | Largeur moyenne avant → après |
|---|---|---|---|---|---|
| Absentéisme | Entreprise | 72 | 75,0 % | 93,1 % [86,1 ; 97,3] | 0,26 → 0,43 point |
| Absentéisme | Département | 576 | 84,9 % | 86,1 % [84,0 ; 88,2] | 0,78 → 0,77 point |
| Absentéisme | Équipe | 10 958 | 81,0 % | 83,3 % [82,3 ; 84,3] | 2,30 → 2,24 points |
| Charge | Équipe | 10 679 | 81,0 % | 83,0 % [81,8 ; 84,1] | 6,75 → 6,88 h |
| Charge | Département | 552 | 77,5 % | **79,5 %** [76,1 ; 83,0] | 1,76 → 1,88 h |

*Tableau 7.19 — Couverture de la fourchette à 80 % sur la fenêtre de test, effectifs et masse salariale, horizons de 1 à 12 mois (source : [RESULTATS_IA_CONFORME.md](../RESULTATS_IA_CONFORME.md), § 3.3). La largeur relative est rapportée à la valeur observée.*

| Série | Démissions projetées | Niveau | Avant : procédure v1 | Après : conforme | Largeur relative avant → après |
|---|---|---|---|---|---|
| Effectif | Taux historique | Entreprise | 100,0 % | 98,6 % | 4,7 → 3,2 % |
| Effectif | Taux historique | Départements | 90,2 % | 89,3 % | 7,6 → 7,8 % |
| Effectif | LOGREG | Entreprise | 99,0 % | 98,1 % | 7,1 → 3,6 % |
| Effectif | LOGREG | Départements | 92,6 % | 88,0 % | 9,0 → 7,8 % |
| Masse salariale | Taux historique | Entreprise | 100,0 % | 98,6 % | 5,5 → 3,1 % |
| Masse salariale | Taux historique | Départements | 93,3 % | 89,0 % | 8,7 → 7,7 % |
| Masse salariale | LOGREG | Entreprise | 100,0 % | 91,4 % | 9,1 → 3,0 % |
| Masse salariale | LOGREG | Départements | 95,2 % | 89,9 % | 9,0 → 7,6 % |

**Absentéisme.** L'entreprise passe de 75 %, sous la cible, à 93 %, au prix d'une fourchette 1,7 fois plus large ; les départements et les équipes gardent ou réduisent leur largeur et dépassent 80 %. Les bandes publiées de la version 1, calées sur 2024-08 à 2026-07, ne couvraient que 54 à 77 % de la période antérieure : la calibration dépend de la période.

**Pourquoi la fourchette de l'entreprise est plus large.** Sa couverture de 93 % dépasse la cible pour trois raisons, mesurées sur les scores de calibration :

- **la période de calibration est plus erratique que le test.** L'écart quadratique des scores de l'entreprise y va de 2,5 unités d'échelle (horizon de 1 mois) à 3,7 (3 mois), alors que les quantiles de la version 1 valaient ±1,9. Le modèle, réentraîné sur un historique croissant, se trompe moins sur la période de test : la garantie d'au moins 80 % tient, mais la couverture réalisée la dépasse ;
- **l'échantillon est petit** : 24 scores par horizon. La fourchette [z(2) ; z(22)] a une couverture attendue d'exactement 80 %, mais elle dépend de quelques mois extrêmes. À 3 mois, un seul mois fixe la borne basse à −7,2 unités (contre −3,0 à 1 mois), d'où 100 % de couverture et une largeur de 0,63 point à cet horizon ;
- **les portées ne sont plus mises en commun** : séparer l'entreprise des départements (192 + 24 scores en version 1) corrige sa sous-couverture, mais la laisse avec peu de données.

Mettre en commun les trois horizons (72 scores) stabiliserait la borne à 3 mois sans resserrer la fourchette en moyenne : la largeur moyenne resterait de 7,6 unités. Une calibration glissante sur les erreurs récentes la resserrerait, mais la procédure de la version 1, qui faisait exactement cela, couvrait 75 %. Le vrai levier est un historique plus long, ce qui n'a pas été mesuré ici.

**Charge de travail.** Les équipes passent à 83 % (+2 points, largeur quasi inchangée). Les départements passent de 77,5 % à **79,5 %, encore sous la cible** ; à l'horizon de 3 mois, leur couverture est de 75,0 %. L'intervalle de confiance reste compatible avec 80 %, mais il n'y a que 8 départements et 96 scores de calibration par horizon. Ce cas est affiché tel quel : l'écran écrit « sous la cible de 80 % » et n'arrondit jamais jusqu'à la cible.

**Effectifs et masse salariale.** La version 1 était **trop prudente** (99 à 100 % au niveau de l'entreprise), parce que ses quantiles avaient été calés sur 2021-2022, quand l'historique disponible était court et les erreurs plus fortes. La calibration conforme garde toutes les couvertures au-dessus de 80 % (88 à 99 %) et resserre nettement les fourchettes de l'entreprise, dont la largeur est divisée par 1,5 à 3. Les quantiles signés corrigent aussi le biais du modèle d'effectif, qui sous-estime les embauches, en décalant la fourchette vers le haut. Les valeurs centrales sont inchangées.

### 7.16.4 Intégration et état

Quatre nouvelles versions de modèles sont produites, pour l'absentéisme, la charge, l'effectif et la masse salariale ; les versions 1 ne sont pas modifiées. Chaque version 2 reprend le modèle de la version 1 et ajoute un champ `conformal` : méthode, fenêtres, quantiles signés et couvertures mesurées. L'inférence TypeScript utilise ces quantiles quand ils existent, et sinon exactement les bornes de la version 1 ; un modèle dont les quantiles excluraient la prévision est refusé. La parité Python ↔ TypeScript est vérifiée sur les jeux golden régénérés (20 tests Python et 113 tests TypeScript réussis le 04/10/2026). Sous chaque prévision, une ligne rappelle la couverture mesurée, par exemple : « Fourchette calibrée : sur les 26 derniers mois de test, 93 % des valeurs observées y sont tombées (cible 80 %). »

**Ces versions sont versionnées dans le dépôt, mais pas encore enregistrées ni promues sur la base de démonstration** (au 04/10/2026). D'ici leur promotion, les écrans affichent les fourchettes de la version 1, sans phrase de couverture. Les commandes d'enregistrement, de promotion et de retour arrière figurent dans le bilan ([RESULTATS_IA_CONFORME.md](../RESULTATS_IA_CONFORME.md), § 6).

### 7.16.5 Limites

- **Échangeabilité supposée** : la garantie suppose que les erreurs futures ressemblent à celles de la calibration. Avec une dérive (nouvelle organisation, données réelles), la couverture peut baisser ; la mesure est à refaire à chaque nouvelle version, avec des fenêtres décalées.
- **Petits groupes** : avec 24 scores par horizon pour l'entreprise ou 8 unités pour les départements, le quantile conforme est prudent (absentéisme de l'entreprise à 93 %) ou instable (charge des départements à 79,5 %).
- **Couverture marginale** : 80 % en moyenne sur la portée et la période, pas pour chaque unité ni chaque mois ; un département atypique peut rester mal couvert.
- **Choix antérieurs** : la configuration du ridge d'absentéisme a été choisie sur 2023-06 à 2024-05, période qui recouvre la fenêtre de calibration (32 configurations aux scores voisins, effet attendu négligeable) ; la fenêtre de test reste intacte.
- **Données simulées** : les couvertures valent pour le simulateur, pas pour une entreprise réelle.

## 7.17 Synthèse rédigée et assistant d'aide : l'IA générative en option

### 7.17.1 Cadrage : un écart assumé au cahier des charges (ADR-014)

Le cahier des charges classe l'assistant conversationnel fondé sur un grand modèle de langage en *Won't* et impose un traitement sur site, sans service externe. Deux fonctions ajoutées le 4 octobre 2026 s'en approchent : la synthèse du mois rédigée et l'assistant d'aide. L'ADR-014 fixe leur cadre :

- **le cœur des deux fonctions n'utilise aucun modèle de langage et fonctionne hors ligne** : gabarits de phrases déterministes pour la synthèse, recherche plein texte dans la documentation pour l'assistant ;
- **la reformulation par IA générative est une extension facultative, désactivée par défaut** : elle ne s'active que si une clé propre à la fonction est définie, et aucun flux ne sort sans elle ;
- elle ne reçoit **aucune donnée nominative** : une liste blanche d'agrégats pour la synthèse, la question et des extraits de documentation pour l'assistant ;
- tout texte généré est **vérifié avant affichage** ; à défaut, la version sans IA s'affiche ;
- chaque appel est audité sans son contenu.

Il s'agit d'un écart au cahier des charges, assumé et tracé par l'ADR-014 (chapitre 4). En installation sans Internet, le comportement reste strictement celui du périmètre initial. L'activation de l'option créerait un transfert vers un sous-traitant hors de Tunisie, traité dans l'analyse d'impact ([aipd.md](../conformite/aipd.md), § 7 et 8) et au chapitre 9.

### 7.17.2 Synthèse du mois rédigée

**Objectif.** En tête de la page Synthèse (RH et manager ; l'ADMIN n'y a pas accès), un encadré résume en quelques phrases les indicateurs déjà affichés pour le rôle ([RESULTATS_IA_SYNTHESE.md](../RESULTATS_IA_SYNTHESE.md)).

**Mode par défaut : phrases types.** Six phrases déterministes d'au plus 20 mots chacune (effectif, mouvements, risque élevé, absentéisme, points ouverts, mise en garde) sont construites à partir des agrégats du rôle, jamais à partir d'une liste nominative. C'est le seul mode qui fonctionne sans Internet. Côté manager, les indicateurs masqués par les gardes de petites populations (ADR-011) restent masqués.

**Option : reformulation par IA générative.** Quand la clé `SYNTHESIS_AI_API_KEY` est définie, le serveur appelle l'API Claude d'Anthropic par une simple requête HTTP, sans dépendance ajoutée. La variable générique de l'éditeur n'active rien, pour qu'un poste de développement ne transmette rien par accident. La requête contient une **charge utile en liste blanche typée** de 28 champs, chacun contrôlé par un motif strict (périmètre générique, mois, entiers, taux, heures), sans aucun texte libre, ainsi que le brouillon issu des phrases types.

**Vérification et repli.** Le texte reçu est refusé si un nombre n'appartient pas à la charge utile (nombre inventé, calculé ou arrondi). Il l'est aussi pour un nombre écrit en lettres ou au format anglais, une mise en forme, plus de 6 phrases, une phrase de plus de 20 mots, un texte tronqué ou une **formulation causale** (« à cause », « explique », « évités »…) ; « non causale » et « facteurs associés » restent permis. En cas de refus, d'erreur réseau ou HTTP, ou après 10 secondes, les phrases types s'affichent avec la mention « la reformulation par IA générative n'a pas abouti ». La page n'attend jamais l'API : la version par phrases types s'affiche d'abord. Une mention visible indique toujours la méthode employée (« Rédaction par phrases types, sans IA générative », ou reformulation « à partir des seuls agrégats ; chaque chiffre a été vérifié »). Chaque appel réel est audité (périmètre, taille de la requête, modèle, durée, raison d'un échec), sans la charge utile ni le texte.

**Validation.** 51 tests ont été écrits, l'API étant toujours simulée. Ils couvrent 12 jeux d'agrégats pour les phrases types (RH, manager en petite population, premier calcul, singuliers, grands nombres, etc.), l'absence de toute clé d'identification dans la charge utile même quand les données de la page contiennent noms et matricules, le refus des nombres inventés et du vocabulaire causal, l'absence d'appel sans clé et le repli sur chaque type d'échec. Avec les tests existants des indicateurs, 88 tests réussissent le 04/10/2026. Aucun appel réel à l'API n'a été fait.

**Limites.** Les mots « un », « une » et « aucun » ne sont pas contrôlés : un texte qui écrirait « aucune alerte » alors qu'il y en a 2 passerait la vérification des nombres. Un nombre de la charge utile peut aussi être attribué au mauvais indicateur, car la vérification porte sur l'appartenance, pas sur le sens. Enfin, la durée de conservation chez l'éditeur et l'absence d'entraînement sur les données dépendent du contrat du client et n'ont pas été vérifiées.

*Figure 7.7 — Encadré « Synthèse du mois en quelques phrases », mode phrases types (capture à prendre).*

### 7.17.3 Assistant d'aide

L'assistant prolonge l'explication à l'utilisateur (section 7.8) du côté de la **méthode** : il répond à des questions comme « comment est calculé le niveau de risque ? » à partir de la **documentation et de l'aide seulement**, jamais à partir des données des collaborateurs ([RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md)). Un champ « Poser une question… » est placé sous l'en-tête du tableau de bord (RH, manager) et de la console (ADMIN). Par défaut, une recherche plein texte (index SQLite FTS5 en mémoire, classement bm25, synonymes métier) renvoie un extrait du passage le plus pertinent avec ses sources ; sans passage pertinent, la réponse est « L'aide ne couvre pas cette question », plutôt qu'une invention. Le filtre par rôle, tiré de la session, est appliqué dans la requête avant le classement : l'ADMIN ne lit aucun passage de méthodologie ni de pilotage RH, et le manager aucun passage réservé à la RH. La reformulation par IA générative suit le même cadre que la synthèse (clé dédiée, désactivée par défaut). Seuls la question et quatre passages au plus sont transmis ; une question qui contient un matricule ou une adresse électronique ne l'est pas ; la réponse doit citer les passages fournis, sans nombre absent de ceux-ci. Les limites tiennent à une recherche **lexicale** et non sémantique, à un corpus statique qu'il faut réindexer après chaque modification de l'aide, et à l'absence de mémoire de conversation : ce n'est pas un assistant conversationnel.

## 7.18 Conclusion

Le volet prédictif est conçu pour être honnête avant d'être performant. La cible est définie sans ambiguïté, les variables ne voient que ce que la RH savait, le protocole n'autorise aucun chevauchement entre passé et futur, et l'incertitude est chiffrée par un bootstrap qui respecte la structure des données. L'explication est exacte et adaptée au rôle, la décision est bornée par la capacité humaine de traitement, et l'équité fait l'objet d'un rapport soumis à une décision humaine. Sur le simulateur, ce cadre répond à la question de recherche. Les fuites temporelles surestiment surtout les modèles flexibles. Neutralisées, elles laissent à la régression logistique un gain réel et significatif sur les règles métier (+0,07 d'AUC), avec des probabilités calibrées. LightGBM n'apporte rien de plus, et l'essentiel du signal reste hors de portée des données RH. Le même cadre, appliqué à l'absentéisme, aux effectifs, aux formations et à la charge de travail, donne des gains nets sur les baselines pour deux volets, modeste pour un, et aucun pour l'effectif, résultat assumé.

Les cinq fonctions ajoutées le 4 octobre 2026 suivent la même discipline. La recherche du meilleur levier réutilise le moteur existant au lieu d'en créer un second. La comparaison appariée des interventions affiche ses hypothèses et ses gardes, et sa validation montre qu'une confusion non observée peut en inverser le signe sans alerte. La typologie des départs rapporte une stabilité moyenne plutôt que de forcer une partition. Les fourchettes conformes mesurent et garantissent leur couverture, y compris lorsqu'elle reste sous la cible. L'IA générative, enfin, reste une option désactivée par défaut, vérifiée et sans donnée nominative. Toutes restent descriptives : elles décrivent des facteurs associés et proposent des pistes à discuter, et la décision revient à la RH.

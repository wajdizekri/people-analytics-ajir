# Inventaire des fonctions IA (état au 04/10/2026)

Classement de chaque fonction « intelligente » de l'application : modèle appris, méthode statistique, règles, IA générative ou recherche documentaire. Statuts vérifiés en lecture seule dans `data/app.db` (`model_version`, `topic_model`). Toutes les données sont **simulées** (`ml/sim`, scénario `mixte_medium_s1`) : les chiffres valident la méthode, pas une précision chez un client ([ADR-010](adr/010-simulateur-verite-terrain-non-circulaire.md)).

## 1. Modèles appris (paramètres estimés sur des données, exportés dans `models/`)

| Fonction | Algorithme | Entraînement | Artefact en service | Résultat principal | Source |
|---|---|---|---|---|---|
| Risque de départ à 6 mois | Régression logistique L2, 25 variables, recalibration de Platt | scikit-learn, `ml/train` | `turnover/logreg-v1-20260930` (CHAMPION) | AUC 0,631 [0,599 ; 0,664] ; lift 3,33 à 2 % de capacité ; O/E 1,00 | [RESULTATS_ML.md](RESULTATS_ML.md) § 3 |
| Formations en retard | Régression logistique L2, 9 variables, Platt | scikit-learn, `ml/training` | `training/formation-logreg-v1-20260930` (CHAMPION) | AUC 0,700, contre 0,601 pour la règle de référence | [RESULTATS_IA_FORMATION.md](RESULTATS_IA_FORMATION.md) |
| Prévision d'absentéisme | Ridge direct par horizon (1 à 3 mois), 16 variables | numpy, `ml/absenteeism` | `absenteeism/abs-ridge-v1-20260930` (CHAMPION) | MAE entreprise 0,77 à 0,84 × celle de la moyenne 12 mois | [RESULTATS_IA_ABSENTEISME.md](RESULTATS_IA_ABSENTEISME.md) § 4 |
| Prévision de charge (heures sup par ETP) | 6 Ridge (équipe ou département × horizon), 27 variables | numpy, `ml/workload` | `workload/workload-ridge-v1-20260930` (CHAMPION) | MAE −5,1 % (équipes), −10,4 % (départements) contre la moyenne mobile | [RESULTATS_IA_CHARGE.md](RESULTATS_IA_CHARGE.md) § 3 |
| Masse salariale | Régression linéaire (MCO) : effet département + saison | numpy, `ml/workforce` | `workforce/masse-v1-20260930` (CHAMPION) | MAPE entreprise 0,86 % | [RESULTATS_IA_EFFECTIFS.md](RESULTATS_IA_EFFECTIFS.md) § 4.2 |
| Profils de départs | k-moyennes, 4 profils (non supervisé) | scikit-learn, `ml/typology` | `typology/typo-kmeans-v1-20261004` (version fixe, hors registre) | silhouette 0,137 ; stabilité ARI 0,513 (moyenne) | [RESULTATS_IA_TYPOLOGIE.md](RESULTATS_IA_TYPOLOGIE.md) |

Comparateurs entraînés mais **non utilisés** : LightGBM pour le risque de départ (AUC 0,627, ne bat pas la logistique) et pour l'absentéisme (à ±0,003 pt du Ridge). Le type `LGBM` existe dans le schéma sans scorer ([ADR-003](adr/003-regression-logistique-en-production-lightgbm-comparateur.md)).

Versions **v2 calibrées** (fourchettes conformes, mêmes coefficients) : `abs-ridge-v2`, `workload-ridge-v2`, `effectif-v2`, `masse-v2` du 04/10, livrées dans `models/` mais **non enregistrées** dans `data/app.db` ; promotion à décider ([RESULTATS_IA_CONFORME.md](RESULTATS_IA_CONFORME.md) § 6).

## 2. Méthodes statistiques (sans paramètre appris)

| Fonction | Méthode | Résultat / remarque |
|---|---|---|
| Prévision d'effectif | Stock-flux : survie mensuelle par salarié, taux par département ré-estimés à chaque calcul | MAPE 0,74 % ; la persistance fait mieux (0,53 %) |
| Fourchettes calibrées | Prédiction conforme « split » sur les erreurs hors échantillon | v2 prêtes, non en service |
| Rétention des embauchés | Kaplan-Meier (IC de Greenwood) + test du log-rank | validé sur l'exemple de manuel Freireich |
| Comparaison des interventions | Score de propension (logistique ridge recalculée à l'affichage) + appariement 1:1 + bootstrap | estimation **non causale** ; biaisée si confusion cachée |
| Dérive | PSI par variable + observé / prévu du modèle en service | seuils 0,10 et 0,25 ; cible O/E [0,8 ; 1,25] |
| Hausses inhabituelles d'absentéisme | z robuste (médiane, MAD, plancher binomial), 2 semaines > 3,5 | précision 75 %, 0,24 fausse alerte par mois |
| Backtesting, transparence | Précision, rappel, lift, calibration, équité par sexe et âge sur le modèle en service | évaluation, pas un modèle |

## 3. Règles métier

- **Niveaux Élevé / Moyen / Faible** : les 2 % les plus à risque (capacité RH), Moyen si score ≥ 2 × la moyenne ([ADR-006](adr/006-niveaux-de-risque-par-capacite-rh.md)).
- **Score B0** (6 règles à points) : repli de démarrage à froid sous 30 démissions observées ; RETIRE dans `data/app.db`.
- **Recommandations, alertes, relances** : à partir des 3 premiers facteurs du modèle et de seuils réglables.
- **Simulation « et si ? » et recherche de leviers** : modification des données puis nouveau passage dans le modèle de risque en service ; recherche sur 1 429 combinaisons.
- **Indice de Bradford** (seuil 250), **surcharge individuelle** (> 20 h sup 3 mois de suite), **25 contrôles qualité d'import**.
- **Synthèse du mois** par phrases types (mode par défaut).

## 4. IA générative et recherche documentaire

- **Synthèse du mois et assistant d'aide en mode IA** : API Claude d'Anthropic par `fetch`, activée seulement par `SYNTHESIS_AI_API_KEY` / `ASSISTANT_AI_API_KEY`. **Désactivée** ici (aucune clé). Aucune donnée nominative envoyée ; chaque nombre du texte est contrôlé ; tout échec revient au mode sans IA ([ADR-014](adr/014-ia-generative-facultative-hors-donnees-rh.md)).
- **Assistant d'aide (mode par défaut)** : recherche plein texte SQLite FTS5 / BM25 sur 333 passages de documentation, filtrés par rôle, réponse par extrait avec sources. Pas d'embeddings, pas de modèle.

## 5. Socle technique

- Entraînement **hors ligne en Python** (numpy, pandas, scipy, scikit-learn ; LightGBM en comparateur ; joblib, holidays, pytest), en lecture seule sur la base ([ADR-002](adr/002-python-hors-ligne-modele-json-execute-en-typescript.md)).
- Export `model.json` + `golden.json`, inférence **réécrite en TypeScript** sans bibliothèque de ML. Parité vérifiée à 1e-9 près.
- Mise en service par registre (`scripts/model.ts`, `scripts/topic-model.ts`) : un CHAMPION par sujet, jamais depuis l'interface.
- Golden rejoué **à l'exécution** pour le risque de départ (sinon scoring suspendu), la formation et la typologie ; pour l'absentéisme, la charge et les effectifs, seulement dans les tests de parité.
- Variables du risque de départ : 25, en 6 groupes. **Absences de santé exclues** ([ADR-009](adr/009-exclusion-des-donnees-de-sante.md)) ; sexe, âge, situation familiale et gouvernorat exclus du modèle, gardés pour l'audit d'équité.

## 6. Limites à connaître

- Pouvoir de tri modeste pour le risque de départ (AUC 0,631 ; plafond de l'oracle du simulateur 0,796).
- Prévision d'effectif battue par la persistance ; masse salariale battue à 6-12 mois par le naïf saisonnier.
- Profils de départs moyennement stables ; l'ancienneté y sert d'indicateur indirect de l'âge.
- Aucune version Python figée (pas de `requirements.txt`).
- Tout est mesuré sur données simulées : un modèle entraîné sur le simulateur ne doit jamais évaluer de vrais salariés.

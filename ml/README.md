# ml/ — Python hors ligne

Rien ici n'est utilisé en production (l'application reste Next.js + SQLite). Python 3.13 avec numpy, pandas, scipy,
holidays et pytest (lightgbm pour l'entraînement).

- `sim/` : simulateur RH à vérité terrain. Écrit un export AJIR (`data/sim/<scenario>_<config>_s<seed>/`) importable
  par `npm run import -- <dossier>`, et un dossier `ground_truth/` jamais importé (latents, oracle, mécanismes,
  anomalies et défauts injectés). Voir [sim/README.md](sim/README.md).

```
npm run sim -- --config small --scenario mixte --seed 1
python ml/sim/run.py --config medium --seed 1
python -m pytest ml/sim/tests -q
```

## train/ — entraînement et évaluation hors ligne

Lit la base en lecture seule (`feature_snapshot` × `v_label_panel`, `followup_complete = 1`, ordre des variables de
`shared/features.json`), n'écrit jamais dans `data/app.db`. Dépendances en plus : scikit-learn, lightgbm, joblib.
Résultats détaillés et limites : [docs/RESULTATS_ML.md](../docs/RESULTATS_ML.md).

| Fichier | Rôle |
|---|---|
| `data.py` | Panel, réglages (`capacity_rate`), oracle du simulateur, panel exporté par `scripts/export-panel.ts`, empreinte sha256 des données |
| `protocol.py` | Origines glissantes : test `[O, O+5]`, calibration `[O-11, O-6]`, apprentissage `t + 6 <= O-11` (aucun chevauchement d'étiquettes) |
| `models.py` | B0 (règles), logistique L2 standardisée pondérée + Platt, recette de production, LightGBM ; réglage par validation temporelle interne |
| `metrics.py`, `evaluate.py` | AUC, PR-AUC, Brier, O/E, pente, precision@k / lift à la capacité (règle ÉLEVÉ du produit), bootstrap groupé par salarié, différences appariées |
| `fairness.py` | Sélection, TPR, FPR et calibration par sexe et tranche d'âge ; information mutuelle variable-attribut |
| `study.py` | Q1 : inflation selon le découpage, variables naïves, courbe d'apprentissage et seuil B0 → LOGREG |
| `bundle.py`, `run.py` | Bundle `models/turnover/logreg-v1-<AAAAMMJJ>/` (model.json + golden.json) et CLI |
| `report.py`, `results/` | Résultats JSON par jeu et tableaux Markdown repris dans `docs/RESULTATS_ML.md` |

```
npx tsx scripts/export-panel.ts --mode naive --out data/ml/panel-naive-app.csv     # Q1b, lecture seule
python ml/train/run.py --db data/app.db --sim data/sim/mixte_medium_s1 --naive-csv data/ml/panel-naive-app.csv --name mixte_medium_s1 --bundle
$env:DATABASE_PATH="data/ml-parity.db"; npm run db:migrate
npx tsx scripts/model.ts register models/turnover/<version>; npx tsx scripts/model.ts verify <version>
python ml/train/run.py golden-status models/turnover/<version> <écart max>          # puis register/verify sur data/app.db
python ml/train/report.py mixte_medium_s1 > tables.md
python -m pytest ml/train/tests -q
```

Réentraînement chez un client : exporter le panel sur autorisation écrite (`scripts/export-panel.ts` exclut les salariés
opposés au traitement prédictif, comme `feature_snapshot`), vérifier la règle de démarrage à froid (sous 30 démissions
observées, un LOGREG ne sera pas utilisé par le scoring ; sous 150, la probabilité reste indicative), puis promouvoir
seulement si le backtest temporel du client montre une AUC non inférieure à B0 (borne basse de ΔAUC ≥ −0,02), un lift
à la capacité au moins égal et un O/E dans [0,8 ; 1,25] ([docs/RESULTATS_ML.md](../docs/RESULTATS_ML.md) § 5d).

## IA par sujet (absentéisme, effectifs et masse salariale, formations, charge de travail)

Même principe que `train/` : lecture seule de la base (`mode=ro`), protocole à origines glissantes sans fuite
(visibilité à la date de saisie), comparaison à des baselines simples, bundle JSON `models/<sujet>/<version>/`
(`model.json` + `golden.json`) rejoué par l'inférence TypeScript de `src/lib/ai/<sujet>/` à 1e-9 près, enregistrement par
`npm run topic-model -- register <SUJET> <dossier>` puis `promote <version>` (registre `topic_model`, un champion par
sujet). En production, l'étape du batch (`runAiSteps`) recalcule les prévisions et les recommandations chaque mois ;
Python n'est jamais exécuté. Données simulées : les chiffres valident la méthode, pas une précision chez un client.

| Dossier | Question | Modèle retenu | Baselines | Résultat principal (test) | Bundle | Détail |
|---|---|---|---|---|---|---|
| `absenteeism/` | Taux mensuel d'absence hors santé non planifiée à 1-3 mois (entreprise, départements, équipes ≥ 5) | Ridge direct par horizon, 16 variables, intervalle à 80 % conforme | naïf saisonnier, moyennes 3 et 12 mois, LightGBM | MAE −16 à −23 % contre la moyenne 12 mois pour l'entreprise, −5 à −7 % département, −5 % équipe ; couverture 80-81 % (équipes) | `models/absenteeism/abs-ridge-v1-20260930` | [RESULTATS_IA_ABSENTEISME.md](../docs/RESULTATS_IA_ABSENTEISME.md) |
| `workforce/` | Effectif (K1) et masse salariale brute (K10) à 12 mois, entreprise et départements | Stock-flux (survies par salarié) ; régression log saisonnière pour la masse | persistance, naïf saisonnier (× croissance), tendance 24 mois | Effectif : MAPE 0,74 %, battu par la persistance (0,53 %) ; masse : MAPE 0,86 %, meilleur à 1-3 mois, battu à 6-12 mois par le naïf saisonnier × croissance (0,73 %) | `models/workforce/effectif-v1-20260930`, `masse-v1-20260930` | [RESULTATS_IA_EFFECTIFS.md](../docs/RESULTATS_IA_EFFECTIFS.md) |
| `training/` | Formation obligatoire ouverte non terminée à l'échéance | Régression logistique L2 + Platt, 9 variables | règle « échéance < 30 j et non commencée » | AUC 0,700 contre 0,601 (origine 06/2025) ; précision à capacité égale +5 points | `models/training/formation-logreg-v1-20260930` | [RESULTATS_IA_FORMATION.md](../docs/RESULTATS_IA_FORMATION.md) |
| `workload/` | Heures sup par ETP des équipes et départements à 1-3 mois ; surcharge individuelle soutenue | 6 ridges (log), intervalle conforme ; règle 20 h × 3 mois | naïf saisonnier, moyenne mobile 3 mois, dernier mois | Équipes : MAE 1,92 contre 2,02 (−5 %, IC hors 0), couverture 80-82 % ; départements −10 % (`mixte`), nul (`charge`) | `models/workload/workload-ridge-v1-20260930` | [RESULTATS_IA_CHARGE.md](../docs/RESULTATS_IA_CHARGE.md) |

```
python -m ml.absenteeism.run --db data/app.db --out ml/absenteeism/results            # évaluation
python -m ml.absenteeism.run --db data/app.db --bundle models/absenteeism --bundle-only # bundle + golden
python -m ml.workforce.run --db data/app.db --name mixte_medium_s1 --bundle --version-date 20260930
python -m ml.training.run --db data/dev-ai-train.db --boot 1000 --bundle --version formation-logreg-v1-20260930
python ml/workload/run.py --db data/dev-ai-load.db --name mixte_medium_s1 --bundle
python -m pytest ml -q                                                                 # 67 tests (30/09/2026)
npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v1-20260930   # idem pour chaque sujet
npm run topic-model -- promote abs-ridge-v1-20260930
```

`eval/` : évaluation hors ligne des anomalies d'absentéisme et des contrôles qualité de l'import contre la vérité
terrain du simulateur ([docs/RESULTATS_ANOMALIES_QUALITE.md](../docs/RESULTATS_ANOMALIES_QUALITE.md)).

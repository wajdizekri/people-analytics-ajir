# ADR-002 — Python hors ligne, modèle exporté en JSON et exécuté en TypeScript

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 5 (« règle d'architecture ») ; [docs/CONVENTIONS.md](../CONVENTIONS.md) § « Format du bundle modèle » ; [src/lib/scoring/](../../src/lib/scoring/)

## Contexte

L'écosystème data (numpy, pandas, scikit-learn, LightGBM) est en Python, mais le client ne doit installer ni Python ni Docker, et la stack de production est Node.js. Le risque principal d'une séparation « entraînement Python / inférence TypeScript » est une divergence silencieuse entre les deux implémentations (standardisation, calibration, ordre des variables, arrondis).

## Décision

1. **Python sert uniquement hors ligne** : simulateur ([ml/sim/](../../ml/sim/)) et entraînement/évaluation ([ml/train/](../../ml/train/), en cours de livraison). Python lit la base en lecture seule (`mode=ro`) et n'y écrit jamais.
2. **Les variables sont calculées une seule fois, en TypeScript** ([src/lib/features/](../../src/lib/features/)) et stockées dans `feature_snapshot` ; Python les relit (ou relit l'export de [scripts/export-panel.ts](../../scripts/export-panel.ts)) au lieu de les recalculer. Le contrat commun (ordre, groupes, imputation, règles B0) est [shared/features.json](../../shared/features.json), versionné par `fsv`.
3. **Le modèle est exporté en JSON** (`models/turnover/<version>/model.json`) : variables, moyennes et écarts-types, coefficients, intercept, calibration de Platt `(a, b)`, taux de base, métadonnées (date, empreinte des données, métriques). Formule exécutée en TypeScript : `z_j = (x_j − mean_j) / std_j`, `logit = intercept + Σ coef_j z_j`, `p = sigmoid(a · logit + b)` ([src/lib/scoring/model.ts](../../src/lib/scoring/model.ts)).
4. **Jeu de contrôle « golden »** : `golden.json` contient des vecteurs `x` et la probabilité `p` calculée par Python ; le scorer TypeScript doit la reproduire à **1e-9** près (`GOLDEN_TOLERANCE`). Le contrôle est exécuté à l'enregistrement (`register`), à la vérification (`verify`, avec empreinte sha256 des fichiers), à la promotion (`promote`) et **au chargement du champion** par chaque processus (`loadChampionState`, résultat mis en cache par processus).
5. **Cycle de vie par CLI** ([scripts/model.ts](../../scripts/model.ts)) : `register` (statut CANDIDAT, manifeste figé en base), `verify`, `promote` (un seul CHAMPION, index unique partiel), `rollback` (repromotion du champion précédent), `list`. Aucune promotion depuis l'interface.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Service Python d'inférence (FastAPI) | Python en production et second backend : exclus par le cahier |
| ONNX + onnxruntime-node | Justifié pour LightGBM seulement ; dépendance native lourde pour un modèle linéaire (Could, voir [ADR-003](003-regression-logistique-en-production-lightgbm-comparateur.md)) |
| Entraînement en TypeScript (IRLS via ml-matrix), prévu au plan détaillé | Aurait permis le réentraînement sur site sans Python ; non retenu dans le cahier v2, qui garde Python hors ligne pour l'entraînement ; reste une perspective |
| Recalculer les variables en Python | Deux implémentations des variables : risque de fuite et de divergence ; rejeté |

## Conséquences

- Aucune dépendance Python ni Docker chez le client ; le modèle est un fichier texte auditable, versionné et vérifié.
- La fidélité TypeScript ↔ Python est testée mécaniquement (critère d'acceptation du cahier : écart < 1e-6 ; seuil appliqué : 1e-9).
- Un bundle dont la `fsv` diffère du contrat courant, qui cite une variable inconnue ou dont les dimensions sont incohérentes est refusé (`checkBundle`) ; un champion invalide suspend le scoring et crée une alerte SYSTEME.
- Seules deux familles sont exécutables : `B0` (règles) et `LOGREG`. Le type `LGBM` existe dans le schéma (`model_version.kind`) mais n'a pas de scorer.
- Réentraîner chez un client suppose d'extraire une copie de la base vers un poste disposant de Python (ou d'entraîner sur site avec Python installé temporairement) : limite documentée.
- État au 29/09/2026 : seul le bundle `b0-v1` est présent dans [models/turnover/](../../models/turnover/) ; la chaîne `ml/train` (export LOGREG + golden) est livrée en parallèle, voir `docs/RESULTATS_ML.md` une fois produit.

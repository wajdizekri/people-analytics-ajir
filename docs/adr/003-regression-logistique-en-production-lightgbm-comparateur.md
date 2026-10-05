# ADR-003 — Régression logistique en production, LightGBM comme comparateur

- **Statut** : acceptée (le passage de LightGBM en production reste un Could)
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 6 « Modèles et protocole » ; [src/lib/scoring/model.ts](../../src/lib/scoring/model.ts) ; [shared/features.json](../../shared/features.json) ; [ml/train/models.py](../../ml/train/models.py)

## Contexte

Les démissions sont rares (environ 3,5 % des salariés éligibles à 6 mois sur le simulateur) et les clients petits : quelques dizaines d'événements par fenêtre de test chez un client de 400 salariés. Le produit doit expliquer chaque estimation par des facteurs lisibles, s'exécuter en TypeScript ([ADR-002](002-python-hors-ligne-modele-json-execute-en-typescript.md)) et disposer d'un repli sans modèle appris.

## Décision

Trois modèles, trois rôles :

1. **B0 — score à règles** (`kind: "B0"`), issu des règles du sujet initial : compa-ratio < 0,9 (2 points), taux d'absence 3 mois > 4 %, au moins 3 absences courtes sur 12 mois, formation obligatoire en retard, plus de 20 h supplémentaires par mois, plus de 48 mois sans promotion (1 point chacun) ([shared/features.json](../../shared/features.json), `b0_rules`). C'est la baseline à battre et le **repli du produit** : si aucun champion n'existe, `ensureChampion` enregistre et promeut `b0-v1` automatiquement. Son score est un nombre de points, affiché « Score à règles », jamais comme une probabilité (`toEstimate`), et le lift n'est pas montré.
2. **Régression logistique calibrée** (`kind: "LOGREG"`) : **modèle de production visé**. Variables standardisées, pénalisation L2, pondération des classes, calibration de Platt sur une période postérieure à l'apprentissage. Explication **exacte** : contribution de la variable j au logit calibré, relativement au profil moyen, `a · coef_j · z_j`, sommée par groupe (`explain`).
3. **LightGBM** : **comparateur hors ligne** dans l'étude (Python), jamais exécuté par l'application.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| LightGBM en production | Explications non exactes (SHAP approché), parité ONNX à maintenir, gain incertain sur de petits effectifs ; reporté (Could) si la courbe d'apprentissage le justifie pour les gros clients |
| Modèle à hasards discrets et incidence cumulée (CIF à 3, 6, 12 mois) avec Shapley par groupes, prévu au plan détaillé | Complexité (panel landmark, h_autre, Shapley interventionnel) incompatible avec le calendrier ; le cahier v2 retient une classification directe à 6 mois |
| Réseaux de neurones, Cox, forêts de survie | Won't : peu de données, explicabilité faible, pas d'exécution simple en TypeScript |
| Seuil fixe de probabilité | Classe « Élevé » presque vide vu la rareté ; remplacé par la capacité RH ([ADR-006](006-niveaux-de-risque-par-capacite-rh.md)) |

## Conséquences

- Les explications affichées sont exactes pour le modèle affiché (additivité en log-odds), regroupées en 6 groupes ; la RH reçoit une phrase chiffrée (« Salaire à 90 % de la médiane du poste »), le manager la catégorie seule.
- Même scorer, même classement, même explication pour B0 et LOGREG : seul l'affichage change (points ou probabilité).
- La régression logistique ne capte pas d'interaction non déclarée ; LightGBM sert précisément à mesurer ce manque dans l'étude (Q1).
- État au 29/09/2026 : le champion de la base de démonstration était `b0-v1` (AUC 0,58 sur le backtest selon [docs/DEMO.md](../DEMO.md)).
- État au 04/10/2026 : `logreg-v1-20260930` est CHAMPION de `data/app.db` (promu le 30/09/2026) ; `b0-v1` est RETIRE et reste le repli de démarrage à froid (moins de 30 démissions observées, `src/lib/scoring/cold-start.ts`). Le schéma prévoit `kind = "LGBM"` sans scorer associé.

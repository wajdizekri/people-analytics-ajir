# ADR-005 — Visibilité « as-of » par date de saisie

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 2 (Q1, C2) et § 6 ; [src/lib/features/compute.ts](../../src/lib/features/compute.ts) ; [src/lib/features/features.test.ts](../../src/lib/features/features.test.ts) ; [src/lib/import/index.ts](../../src/lib/import/index.ts)

## Contexte

Dans AJIR, beaucoup d'informations sont saisies après les faits : absences déclarées en retard, régularisations de paie, évaluations saisies 1 à 4 mois après la campagne, démissions enregistrées tardivement. Calculer une variable « au 30 juin » avec des lignes saisies en août produit une **fuite temporelle** : le modèle paraît meilleur en étude qu'il ne le sera en production. Mesurer cette surestimation est la question de recherche Q1.

## Décision

- Chaque table source porte une **date d'événement** et, quand AJIR la fournit, une **date de saisie** `recorded_at`.
- Une ligne n'est utilisée pour la coupure t que si **date d'événement ≤ t et date de saisie ≤ t** (`isVisible(date, rec, t)`). La règle s'applique aux variables, à l'éligibilité (sorties et démissions visibles), à l'état reconstitué du grade et du manager (`stateAt`) et aux médianes de salaire.
- **Délais de repli** quand `recorded_at` est absent de l'export (appliqués à l'import, paramétrables) :

| Source | Date de saisie retenue si absente |
|---|---|
| `absences.csv` | `end_date + lag_absence_days` (défaut 10 jours) |
| `evaluations.csv` | `eval_date + lag_evaluation_days` (défaut 90 jours) |
| `payroll.csv` | fin du mois de paie |
| `career_events.csv` | date de l'événement |
| `exits.csv` | `resignation_date`, sinon `exit_date` |

- Sources **sans date de saisie** dans le contrat d'export : pointages (saisis en temps réel), formations, contrats ; leur date d'événement fait foi.
- **Test anti-fuite par perturbation** (fast-check) : ajouter des lignes datées ou saisies après t ne change aucune variable ; calcul individuel, calcul par lot et backfill donnent le même résultat.
- **Mode naïf** réservé à l'expérience Q1 (`ComputeOptions.naive`) : ignore `recorded_at` dans les variables, population inchangée ; exposé seulement par [scripts/export-panel.ts](../../scripts/export-panel.ts) (base ouverte en lecture seule), jamais par le worker.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Date d'événement seule | Fuite temporelle ; surestime la performance (c'est l'objet de Q1) |
| Agrégats bitemporels (somme par mois d'événement × mois de saisie), prévus au plan | Plus rapide sur de gros volumes, mais plus complexe ; les variables sont calculées en mémoire sur les lignes brutes, ce qui suffit au volume visé |
| Instantané figé de la base à chaque fin de mois | Stockage et exploitation lourds ; ne permet pas le backfill sur l'historique |

## Conséquences

- Les variables d'un mois passé calculées aujourd'hui sont celles que le produit aurait calculées ce mois-là (backfill = production), ce qui rend le backtest honnête.
- Les délais de repli introduisent une hypothèse : le rapport doit en donner la sensibilité (Q1) et les valeurs doivent être mesurées chez le client (P90 à P95 du délai réel).
- Limites connues : les formations n'ont pas de date de saisie et leur **statut est l'état courant** (une formation terminée aujourd'hui peut compter comme terminée à une date passée si `end_date ≤ t`) ; la hiérarchie utilisée par la **sécurité** est celle du dernier import, pas celle de la date consultée (voir [ADR-007](007-couche-acces-donnees-au-lieu-rls.md)).

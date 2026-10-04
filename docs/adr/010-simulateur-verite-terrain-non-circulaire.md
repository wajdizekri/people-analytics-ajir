# ADR-010 — Simulateur à vérité terrain non circulaire

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 4 (M2) et § 6 « Données » ; [ml/sim/README.md](../../ml/sim/README.md) ; [ml/sim/latent.py](../../ml/sim/latent.py), [ml/sim/engine.py](../../ml/sim/engine.py)

## Contexte

Aucune donnée client n'est garantie pendant le PFE. Un jeu fictif tiré au hasard ne prouve rien ; un simulateur dont les départs seraient générés par un logit des variables observées serait **circulaire** : la régression logistique retrouverait exactement le mécanisme et paraîtrait parfaite. Il faut en outre pouvoir chiffrer la performance maximale atteignable (plafond « oracle ») et évaluer la détection d'anomalies sur des cas étiquetés.

## Décision

- **Simulateur Python hors ligne** qui produit un export **au format exact du contrat AJIR** (les 11 CSV de [docs/CONVENTIONS.md](../CONVENTIONS.md)), importé par le même `runImport` que les données client, plus un dossier `ground_truth/` **jamais importé**.
- **Départs sans hasard logit** : un engagement latent AR(1) évolue chaque mois, poussé par le compa-ratio, la stagnation, la charge, une **qualité de manager latente sans variable exportée**, des chocs de marché et des événements personnels. La démission survient par (a) une offre externe (processus de Poisson par famille de métier) acceptée selon l'engagement, (b) le franchissement d'un seuil individuel d'insatisfaction cumulée, (c) un événement personnel indépendant de tout. Signaux faibles 1 à 3 mois avant, pointages qui continuent pendant le préavis, 4 % de motifs bruités, 40 % de démissions sans date de démission.
- **Sorties concurrentes** générées : fin de CDD ou SIVP, fin de stage, licenciement après une mauvaise évaluation, retraite à 60 ans, décès, mutation.
- **Réalisme tunisien** : calendrier (fériés civils et religieux, Ramadan, séance unique d'été, ponts), contrats CDI/CDD/SIVP/stage, grille G1 à G8 en TND, SMIG, noms et gouvernorats ; délais de saisie générés (absences, paie, évaluations) pour exercer la règle de visibilité ([ADR-005](005-visibilite-as-of-par-date-de-saisie.md)).
- **Vérité terrain** : latents mensuels, mécanisme de chaque démission, **oracle** `prob6` estimé par au moins 50 continuations Monte-Carlo de l'état latent, anomalies d'absentéisme injectées et étiquetées (dont un type réservé à l'évaluation), défauts de qualité injectés (≈ 1,9 % des lignes) identiques aux rejets de l'import.
- **Deux scénarios** (`mixte`, `charge`) × graines, trois tailles (`small` 300, `medium` 1 200, `large` 2 500 salariés initiaux ; 36 à 96 mois se terminant au 31/08/2026).

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Seed déterministe du sujet initial | Conservé pour les tests seulement ; aucune valeur de preuve pour le ML |
| Départs tirés d'un logit des variables | Circularité : le modèle retrouverait son propre mécanisme |
| Jeu public (IBM HR Attrition, Employee Turnover) seul | Statique, sans dates calendaires, sans pointages ni risques concurrents ; ne permet pas l'expérience de fuite ; reste un positionnement (Should) |
| Données client seulement | Non garanties ; bonus pour le test final |

## Conséquences

- La performance mesurée est bornée par l'oracle (AUC oracle ≈ 0,82 à 0,85 selon la taille et le scénario) et dépend du mélange des mécanismes : un résultat sur simulateur est une **preuve de méthode**, pas de valeur métier ; le rapport le dit explicitement.
- L'import de production est testé sur un export réaliste de 1,5 million de pointages (base de démonstration : score qualité 98,1 %, rejets correspondant aux défauts injectés).
- Limites documentées : l'oracle fige l'organisation ; le calage (turnover ≈ 12 à 14 %/an, part volontaire ≈ 60 %, absentéisme ≈ 3,7 %) repose sur des ordres de grandeur plausibles, pas encore sur des statistiques ArabSoft ou INS ; un modèle entraîné sur le simulateur ne doit jamais scorer un vrai client.

# ADR-004 — Cible : démission à 6 mois, autres sorties en risques concurrents

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 6 « Cible et population » ; [drizzle/0003_label_panel_unknown_resignation.sql](../../drizzle/0003_label_panel_unknown_resignation.sql) ; `eligibleContract` dans [src/lib/features/compute.ts](../../src/lib/features/compute.ts)

## Contexte

Le sujet initial parlait de « risque de turnover » sans le définir. Or un modèle entraîné sur « toute sortie » apprend surtout les dates de fin de CDD et les départs en retraite, qui sont connus d'avance et sur lesquels la RH n'a pas de levier. AJIR ne stocke pas toujours la date de démission (40 % des démissions sans `resignation_date` dans le simulateur), et un salarié peut quitter l'entreprise pour une autre raison avant d'avoir démissionné.

## Décision

- **Événement prédit** : démission ou abandon de poste (`exit_reason ∈ {DEMISSION, ABANDON}`) dans la fenêtre **]t, t + 6 mois]**, t étant une fin de mois.
- **Date de l'événement** : `resignation_date` si elle existe, sinon `exit_date − 1 mois` (préavis par défaut, à valider selon la convention collective).
- **Autres sorties** (fin de CDD, licenciement, retraite, décès, mutation, autre) : **risques concurrents** ; elles comptent comme « non-démission » (`y6 = 0`), elles ne sont pas censurées. La probabilité affichée est donc celle de démissionner dans les 6 mois.
- **Seule censure** : la fin des données. `followup_complete = 1` si `t + 6 mois ≤ data_end_date` ; l'entraînement et l'évaluation n'utilisent que ces lignes.
- **Démission posée mais saisie après t** : si la démission est antérieure à t mais saisie après t (`recorded_at > t`), le salarié reste éligible à t (la démission n'y est pas visible) ; il est étiqueté `y6 = 1` si sa sortie effective tombe dans l'horizon (migration `0003`).
- **Population scorée** à t (fonction `eligibleContract`) : salarié actif à t, entré depuis au moins 1 mois, contrat en vigueur CDI, ou CDD dont le terme est postérieur à t + 6 mois ; SIVP et stages exclus ; âge inférieur à 60 ans à t + 6 mois (retraite) ; pas de démission déjà visible à t. La fin de CDD prévue est affichée comme un **fait** dans la zone Observations de la fiche, jamais prédite.
- **Définition unique** : la vue SQL `v_label_panel` est la seule définition des étiquettes, lue par Python (entraînement) et par le backtest.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Toute sortie comme événement | Le modèle apprendrait les fins de contrat et la retraite ; pas de levier RH |
| Autres sorties censurées (analyse de survie « cause-specific ») | Surestime la probabilité affichée de démission ; plus complexe à expliquer |
| Incidence cumulée à 3, 6 et 12 mois avec hasard concurrent `h_autre` (plan détaillé) | Hors calendrier ; horizon unique retenu par le cahier v2 |
| Garder les CDD courts avec un hasard de non-renouvellement | Mélange un fait prévisible et un comportement ; exclusion plus simple et lisible |

## Conséquences

- La prévalence est faible (≈ 3,5 % à 6 mois sur le simulateur) : métriques de discrimination, calibration et lift à capacité plutôt que précision brute.
- La part d'effectif non scorée (SIVP, stagiaires, CDD courts, nouveaux entrants, proches de la retraite) est affichée sur le tableau de bord (`nonScored`).
- Les étiquettes proches de `data_end_date` sont incomplètes pendant 6 mois : elles restent en base mais sont exclues de l'entraînement.
- Le préavis d'un mois et l'âge de 60 ans sont codés en dur dans la vue et dans `eligibleContract` : à paramétrer si la convention collective du client diffère (voir le glossaire de [docs/DICTIONNAIRE.md](../DICTIONNAIRE.md)).

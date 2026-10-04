# ADR-009 — Exclusion des données de santé

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 1, § 6 et § 7 ; [src/lib/features/spec.ts](../../src/lib/features/spec.ts) ; [src/lib/features/compute.ts](../../src/lib/features/compute.ts) ; [src/lib/anomalies/index.ts](../../src/lib/anomalies/index.ts) ; [src/lib/aggregates/index.ts](../../src/lib/aggregates/index.ts)

## Contexte

Les absences pour maladie et maternité sont des données de santé, sensibles au sens de la loi organique n° 2004-63 et de la Convention 108. Les utiliser pour estimer un risque individuel pénaliserait les salariés malades ou enceintes (biais de santé et de sexe) et exposerait le client juridiquement. L'exclusion doit aussi porter sur les variables **dérivées** des pointages : un jour de maladie apparaît comme un jour « sans badge » et fait baisser les heures supplémentaires.

## Décision

- **Marquage à l'import** : `absence_episode.is_health = 1` pour les catégories `MALADIE` et `MATERNITE` ; le motif médical n'est jamais importé, seule la catégorie l'est.
- **Aucune variable ni aucun score individuel n'utilise ces épisodes** :
  - les variables d'absence ne comptent que `ABSENCE_INJUSTIFIEE`, `CONGE_SANS_SOLDE` et `AUTRE` (`COUNTED_ABSENCE`) ; congé annuel et santé exclus ;
  - **masquage** : les jours de santé visibles à t sont retirés des jours ouvrés disponibles de toutes les variables tirées des pointages (heures supplémentaires rapportées aux jours disponibles, retards, régularité d'arrivée, jours sans badge, taux d'absence) ;
  - propriété testée (fast-check) : un salarié avec un arrêt maladie a les mêmes variables que si ces jours étaient retirés de sa fenêtre ([src/lib/features/features.test.ts](../../src/lib/features/features.test.ts)).
- **Absentéisme** : les indicateurs du tableau de bord et de la page Absentéisme sont « hors santé non planifié » ; la détection d'anomalies (collective et Bradford) ignore les jours de santé.
- **Affichage** : la RH voit sur la fiche un total de jours d'absence pour santé sur 12 mois (fait observé, dans la zone Observations), jamais le détail ; le manager ne voit aucune donnée d'absence individuelle. Les agrégats conservent `absence_days_health` séparément pour un suivi collectif.
- Sexe, âge, situation familiale et gouvernorat sont exclus des variables et conservés uniquement pour l'audit d'équité hors ligne.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Utiliser toutes les absences | Biais de santé et de sexe, risque juridique |
| Supprimer les absences de santé à l'import | Fausserait les jours sans badge et l'absentéisme collectif ; le masquage explicite est plus juste |
| Anonymiser le motif mais garder les jours dans les variables | Le jour de maladie resterait un signal individuel |

## Conséquences

- Une partie du signal de désengagement (absences courtes déclarées « maladie ») est volontairement perdue ; c'est un choix éthique assumé et écrit dans le rapport.
- Si un client code des arrêts de santé sous `AUTRE`, ils seront comptés : la table de correspondance des motifs AJIR doit être validée à l'installation.
- Le total de jours de santé affiché à la RH reste une donnée sensible visible ; il n'entre dans aucun calcul.

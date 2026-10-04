# ADR-011 — Gardes de petites populations côté manager

- **Statut** : acceptée
- **Date** : 29/09/2026
- **Références** : [src/lib/dal/pilotage-metrics.ts](../../src/lib/dal/pilotage-metrics.ts) (`MIN_GROUP_SIZE`, `smallGroupMask`, `countPresent`) ; [src/lib/dal/dashboard.ts](../../src/lib/dal/dashboard.ts) (`smallGroupGuard`, `restrictDashboardQuery`) ; [src/lib/dal/absenteeism.ts](../../src/lib/dal/absenteeism.ts) (`guardSeries`) ; [tests/pilotage/small-groups.test.ts](../../tests/pilotage/small-groups.test.ts)

## Contexte

Le manager voit des indicateurs agrégés sur sa hiérarchie, souvent petite (5 à 12 personnes). Un taux d'absentéisme ou un nombre de sorties calculé sur une ou deux personnes, ou obtenu par différence entre deux agrégats (« mon équipe » moins « mon équipe filtrée »), révèle une information individuelle qu'il n'est pas censé connaître (absences d'un collaborateur identifiable, démission d'un salarié). Le cahier des charges n'en parle pas ; c'est une exigence de minimisation déduite de la loi 2004-63.

## Décision

- **Seuil** `MIN_GROUP_SIZE = 5` personnes.
- **Tableau de bord manager** :
  - les filtres contrat, âge et ancienneté sont **ignorés et signalés** (recoupements trop fins) ; seuls période, département et niveau restent ;
  - taux d'absentéisme, turnover glissant et nombres de sorties valent `null` (affichés comme masqués, `smallPopulation = true`) si la population concernée compte moins de 5 personnes présentes sur la période, **ou** si, avec un filtre, le complément dans son périmètre compte entre 1 et 4 personnes ;
  - population de référence : tous les présents pour l'absentéisme, les seuls contrats de travail (hors stages et SIVP) pour sorties et turnover.
- **Page Absentéisme manager** : axe « équipe » imposé ; une série est masquée si le groupe compte moins de 5 membres ou moins de 5 actifs ; **masquage secondaire** (`smallGroupMask`) : si l'ensemble masqué totalise moins de 5 personnes, les plus petits groupes visibles sont masqués à leur tour, pour qu'aucun groupe ne se déduise par différence avec le total ; même contrôle période par période ; le total est masqué sous 5 ; au plus 8 séries, les autres comptant comme masquées.
- **Anomalies collectives** : une équipe ou un département n'est suivi séparément que s'il compte au moins 5 actifs en fin de période (même constante).
- **Catégories de facteurs** : jamais « Assiduité » (`ABSENCES`) pour le manager, ni « Rémunération » avec un score à règles B0 (qui y signifie exactement « salaire sous 90 % de la médiane ») ; action `REVISION_SALARIALE` réservée à la RH (`managerVisibleGroup`, `RH_ONLY_ACTIONS`).
- **Transparence (RH)** : les lignes du rapport d'équité sous l'effectif minimal du fichier de métriques (30 par défaut) sont masquées.
- La **RH n'est pas soumise** à ces gardes (vue entreprise, responsable du traitement).

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Aucun masquage | Ré-identification triviale dans une équipe de 5 à 10 personnes |
| Bruit différentiel (differential privacy) | Chiffres faux et incompréhensibles pour un manager ; disproportionné |
| Agréger au département les équipes de moins de 8 (plan détaillé) | Révélerait l'équipe par différence avec le département ; masquage retenu |
| k-anonymat strict sur tous les croisements | Trop restrictif pour un tableau de bord opérationnel |

## Conséquences

- Un manager d'une petite équipe voit l'effectif et les niveaux de risque mais pas les taux : comportement attendu et expliqué à l'écran.
- Testé : population d'un seul salarié, filtre isolant un petit groupe ou son complément, masquage secondaire, absentéisme par équipe ([tests/pilotage/small-groups.test.ts](../../tests/pilotage/small-groups.test.ts)).
- Le seuil est une constante de code, non un paramètre administrable ; le rendre réglable supposerait de relancer les tests de non-déductibilité.

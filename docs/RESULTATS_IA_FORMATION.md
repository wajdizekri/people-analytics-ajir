# Résultats IA — Formations obligatoires

Tous les chiffres viennent de `python -m ml.training.run --db data/dev-ai-train.db --boot 1000 --bundle --version formation-logreg-v1-20260930` (copie de travail de `data/app.db`, simulation `mixte_medium`, données jusqu'au 31/08/2026). Détail brut : [ml/training/results/results.json](../ml/training/results/results.json).

## Question et cible

À une date de coupure t (fin de mois), pour chaque formation **obligatoire ouverte** : sera-t-elle terminée à son échéance ?

- **Ouverte à t** : échéance dans ]t, t + 120 j], statut autre que `ABANDONNEE`, pas terminée à t (`TERMINEE` avec fin ≤ t), salarié actif à t (sortie visible si `exit_date ≤ t` et `recorded_at ≤ t`). Les formations déjà en retard à t ne sont pas modélisées (le retard est constaté) : elles sont listées à part.
- **Cible** : y = 1 si la formation n'est pas `TERMINEE` avec une fin ≤ échéance.
- **Exclusions** : salariés opposés au traitement (`employee_opposition`) ; salarié sorti avant l'échéance (formation sans objet) ; coupures dont l'horizon n'est pas clos (t + 120 j > 31/08/2026).

Panel : 14 256 lignes (t, formation), dont 13 154 étiquetées ; 6 034 formations, 1 811 salariés. Taux de retard : 22,4 % des lignes, 13,5 % des formations (une formation en retard reste ouverte plus longtemps, donc apparaît dans plus de coupures).

## Variables (visibles à t uniquement)

| Variable | Définition | Modèle |
|---|---|---|
| `days_to_due`, `log_days_to_due` | jours restants avant l'échéance (et leur log) | oui |
| `hours` | durée de la formation | oui |
| `log_tenure`, `new_hire` | ancienneté en mois (log(1 + x)) ; arrivé depuis moins de 3 mois | oui |
| `emp_margin_days` | marge moyenne (échéance − fin, bornée à ±120 j) des formations obligatoires du salarié échues à t ; non terminée à t : échéance − t | oui (imputée 43,3 j) |
| `team_late_rate_12m` | part en retard des formations obligatoires échues sur 12 mois dans l'équipe (même manager à t, règle `stateAt`), hors salarié ; manquante sous 5 formations | oui (imputée 0,113) |
| `overtime_h_3m` | heures supplémentaires par mois sur les 3 mois civils jusqu'à t | oui |
| `due_summer` | échéance en juillet ou août | oui |
| `started` | commencée à t (statut `EN_COURS`/`TERMINEE` et début ≤ t) | non : variance nulle |
| `emp_past_n`, `emp_late_rate` | nombre de formations obligatoires échues, part en retard | non (phrase RH seulement) |
| `emp_overdue_other`, `open_mandatory_others` | autre formation en retard / autre formation ouverte | non : 0,3 % et 0,2 % de lignes non nulles |

Points de visibilité :

- La **date de début d'une formation planifiée n'est jamais lue** : dans l'historique reconstruit, c'est la date réelle (fuite du futur) ; seul `start ≤ t` est utilisé.
- `started` n'a aucune variance : toutes les formations obligatoires simulées durent un jour (3 à 7 h), une formation ouverte à t n'est donc jamais commencée. « L'avancement » ne peut pas être appris sur ces données.
- `emp_late_rate` a été retirée du modèle : redondante avec `emp_margin_days` (écart d'AUC ≤ 0,003 sur les deux origines) et de signe contre-intuitif quand les deux sont présentes, ce qui aurait rendu les facteurs illisibles.

## Protocole temporel

Pour une origine O : **apprentissage** sur les coupures dont l'horizon est clos 6 mois avant O ; **calibration** (choix de C par AUC, puis Platt) sur les 6 mois de coupures suivants dont l'horizon est clos à O ; **test** sur les coupures des 12 mois après O dont l'horizon est clos à la fin des données. Aucune étiquette de test n'est connue à l'apprentissage. IC à 95 % par bootstrap groupé par salarié (1 000 tirages).

| Origine | Apprentissage | Calibration | Test | Lignes de test (formations, salariés) | Taux de retard du test |
|---|---|---|---|---|---|
| 30/06/2024 | 11/2020 → 08/2023 (7 069) | 09/2023 → 02/2024 (641) | 07/2024 → 06/2025 | 2 433 (1 260, 962) | 22,7 % |
| 30/06/2025 | 11/2020 → 08/2024 (9 482) | 09/2024 → 02/2025 (696) | 07/2025 → 04/2026 | 1 794 (966, 774) | 24,5 % |

**Baseline** : règle « échéance < 30 jours et non commencée » (score binaire).

## Résultats (test, IC 95 %)

| Métrique | Origine 30/06/2025 | Origine 30/06/2024 |
|---|---|---|
| AUC régression logistique | **0,700** [0,673 ; 0,724] | 0,713 [0,690 ; 0,735] |
| AUC baseline | 0,601 [0,586 ; 0,616] | 0,598 [0,586 ; 0,611] |
| Écart d'AUC | +0,098 [0,074 ; 0,119] | +0,114 [0,097 ; 0,133] |
| PR-AUC régression logistique | **0,523** [0,469 ; 0,570] | 0,499 [0,453 ; 0,546] |
| PR-AUC baseline | 0,335 [0,294 ; 0,374] | 0,311 [0,277 ; 0,345] |
| Précision de la règle baseline | 0,590 [0,517 ; 0,654] | 0,555 [0,498 ; 0,614] |
| Précision@k régression, k = nb de lignes signalées par la baseline chaque mois | 0,641 [0,567 ; 0,713] | 0,609 [0,547 ; 0,669] |
| Écart de précision à capacité égale | +0,051 [−0,005 ; 0,111] | +0,055 [0,017 ; 0,090] |
| Précision@10 % par mois | 0,609 [0,524 ; 0,694] | 0,561 [0,494 ; 0,631] |
| Brier | 0,159 [0,144 ; 0,176] | 0,152 [0,137 ; 0,165] |
| O/E (observé / attendu) | 1,104 [0,975 ; 1,236] | 1,044 [0,924 ; 1,161] |
| Pente de calibration | 1,128 [0,957 ; 1,304] | 1,401 [1,253 ; 1,579] |

Lecture :

- La régression dépasse nettement la baseline en classement (AUC +0,10, PR-AUC +0,19). À **capacité de relance égale**, le gain de précision est d'environ 5 points ; il est significatif sur l'origine 2024 mais pas sur 2025 (l'IC contient 0).
- Presque tout le signal vient du **délai restant** : la régression limitée à `days_to_due` et à son log atteint déjà une AUC de 0,690 (2025) et de 0,701 (2024). Les autres variables ajoutent environ 0,01 d'AUC. L'historique d'équipe et les heures supplémentaires ont un apport négligeable ; les heures supplémentaires ont même un coefficient négatif (plus d'heures supplémentaires, un peu moins de retard).
- **Calibration** : les probabilités sont un peu trop prudentes en haut de distribution. Décile supérieur 2025 : 0,571 estimé contre 0,672 observé ; déciles 1 à 8 à ±0,05 près. O/E proche de 1 sur l'ensemble.

## Niveaux du produit

Seuils fixes du bundle : **ÉLEVÉ** si p ≥ 0,50 (retard plus probable que non), **MOYEN** si p ≥ 0,25 (≈ 2 × le taux par formation), FAIBLE sinon. Pas de règle de capacité : une relance coûte peu.

| Origine | Lignes ÉLEVÉ | Précision ÉLEVÉ | Rappel ÉLEVÉ | Précision MOYEN+ | Rappel MOYEN+ |
|---|---|---|---|---|---|
| 30/06/2025 | 5,4 % | 0,773 [0,685 ; 0,848] | 0,171 [0,142 ; 0,198] | 0,496 [0,436 ; 0,555] | 0,467 [0,431 ; 0,500] |
| 30/06/2024 | 4,4 % | 0,764 [0,690 ; 0,845] | 0,147 [0,123 ; 0,172] | 0,489 [0,435 ; 0,541] | 0,464 [0,431 ; 0,496] |

## Modèle de production

`models/training/formation-logreg-v1-20260930/` : `model.json`, `golden.json` (200 lignes), `golden-features.json` (300 lignes (t, formation) avec leurs variables brutes). Même recette avec l'origine au 31/08/2026 : coefficients appris sur les coupures 11/2020 → 10/2025, C = 0,3 choisi et Platt (a = 0,930, b = −0,050) ajusté sur 11/2025 → 04/2026.

Coefficients (variables standardisées) : `log_days_to_due` −0,817 ; `new_hire` −0,296 ; `log_tenure` +0,121 ; `emp_margin_days` −0,078 ; `overtime_h_3m` −0,054 ; `days_to_due` −0,044 ; `due_summer` +0,038 ; `team_late_rate_12m` +0,033 ; `hours` +0,019.

**Parité TypeScript** :

- probabilité (`golden.json`, 200 lignes) : écart max 5,6 × 10⁻¹⁷, vérifiée à chaque chargement par l'étape du batch (tolérance 10⁻⁹) ;
- variables (`golden-features.json`, 300 lignes × 15 variables, recalculées en TypeScript sur `data/dev-ai-train.db`) : écart max 8,9 × 10⁻¹⁶, aucune différence sur les valeurs manquantes.

Enregistrement et promotion sur la copie de travail :

```
$env:DATABASE_PATH="data/dev-ai-train.db"
npm run topic-model -- register FORMATION models/training/formation-logreg-v1-20260930
npm run topic-model -- promote formation-logreg-v1-20260930
```

## Inférence au 31/08/2026 (copie de travail)

L'étape `src/lib/ai/training/step.ts` évalue 187 formations obligatoires ouvertes : 29 à risque élevé (p moyenne 0,69), 63 moyen, 95 faible. Elle produit 29 relances RH et 1 recommandation d'équipe, en 0,7 s. Une deuxième exécution sur le même mois donne un état identique.

Recommandations (`insight_recommendation`, topic `FORMATION`) :

- `RELANCE_FORMATION` (RH, salarié) pour chaque risque ÉLEVÉ : « Relancer X pour la formation « Y », échéance dans N jours » ; priorité 1 si l'échéance tombe dans les 30 jours ; `dedup_key = FORMATION:RELANCE:<formation>`.
- `PLANIFIER_TEMPS_FORMATION` (manager direct à t, équipe) dès 3 formations à risque moyen ou élevé ; texte sans nom ni probabilité ; `dedup_key = FORMATION:EQUIPE:<manager>:<AAAA-MM>`.
- Une recommandation déjà réalisée ou rejetée n'est jamais réécrite. Les salariés opposés au traitement sont exclus (`excludeOpposed` de `src/lib/privacy`).

## Limites

- **Données simulées** : le simulateur tire le délai de démarrage d'une loi exponentielle autour d'une date d'affectation. Le risque dépend donc surtout du délai restant, et l'engagement latent n'est que faiblement visible dans les variables. Les résultats ne valent que pour ce simulateur.
- **Date d'affectation absente de l'export AJIR** : une formation est considérée connue dès que son échéance tombe dans les 120 jours. Certaines lignes historiques précèdent donc l'affectation réelle.
- **Statut photographié à la fin de l'export** : l'état à t est reconstruit à partir des dates. Une formation `TERMINEE` sans date de fin est exclue ; un abandon n'est pas daté.
- **Avancement non modélisé**, faute de formations obligatoires de plusieurs jours dans les données.
- Les lignes d'une même formation sur plusieurs coupures sont corrélées : c'est pourquoi le bootstrap est groupé par salarié.

## Reproduire

```
python -m ml.training.run --db data/dev-ai-train.db --boot 1000 --bundle --version formation-logreg-v1-20260930
python -m pytest ml/training/tests -q
npx vitest run tests/ai/training
```

# Résultats IA — Profils types de départs

Tous les chiffres viennent de `python -m ml.typology.run --db data/app.db --boot 200 --bundle --mechanisms <sim>/ground_truth/mechanisms.csv` (copie de travail de `data/app.db`, simulation `mixte_medium_s1`, données au 31/08/2026). Détail brut : [ml/typology/results/results.json](../ml/typology/results/results.json). Bundle : [models/typology/typo-kmeans-v1-20261004](../models/typology/typo-kmeans-v1-20261004/).

## En bref

- 546 départs volontaires (démissions et abandons) visibles au 31/08/2026 ; 480 classables, 66 non classés (aucune ligne de variables dans les 6 mois avant la démission ; 0 opposé au traitement).
- **4 profils** retenus. **Aucune partition de 3 à 6 profils ne passe la règle de stabilité** : la règle de repli s'applique (partition la plus stable), avec une stabilité **moyenne** : ARI bootstrap 0,51 [0,25 ; 0,86], Jaccard par profil de 0,57 à 0,67.
- Profils descriptifs, non causaux : ils ne retrouvent pas les mécanismes simulés (ARI 0,016).
- Affichage RH seule sur `/retention`, agrégé, aucun salarié étiqueté.

## Question et population

Quelles grandes familles de départs volontaires observe-t-on, décrites par des données professionnelles ?

- **Départ** : `exit_event` de motif `DEMISSION` ou `ABANDON`, sortie et saisie ≤ référence.
- **Variables à la veille du départ** : la ligne `feature_snapshot` (fsv `v1`, calculée une seule fois en TypeScript, ADR-002) de la dernière fin de mois **avant** la date de l'événement (date de démission, sinon sortie − 1 mois, comme `v_label_panel`), au plus 6 mois avant. Les signaux faibles qui suivent la décision restent possibles dans cette fenêtre (voir Limites).
- Sélection écrite une seule fois ([src/lib/ai/typology/queries.json](../src/lib/ai/typology/queries.json)), exécutée telle quelle par Python et TypeScript : même population par construction.
- Opposés au traitement (`employee_opposition`) : comptés dans les départs, jamais classés.
- Période couverte : départs du 02/11/2020 au 28/08/2026.

## Variables

| Variable (features.json) | Transformation | Rôle |
|---|---|---|
| `tenure_months` | log(1 + x) | distance |
| `months_since_promotion` (vaut l'ancienneté sans promotion, borné à 120) | aucune | distance |
| `raise_pct_12m` | aucune | distance |
| `compa_ratio` | aucune | distance |
| `overtime_h_avg_3m` | log(1 + x) | distance |
| `absence_rate_12m` (hors santé, hors congés) | racine carrée | distance |
| `training_hours_12m` | log(1 + x) | distance |
| `contract_cdd` | — | descripteur (cité s'il est sur-représenté) |
| famille de métier | — | descripteur (cité si sur-représentée) |

Chaque variable de distance est bornée à ses quantiles 1 % et 99 % puis standardisée (moyenne, écart-type de population) ; bornes et moyennes sont dans le bundle.

**Exclus** : sexe, âge, situation familiale, gouvernorat, toute donnée de santé (ADR-009) ; retards, régularité d'arrivée, jours sans badge, absences courtes, facteur de Bradford (rien qui ressemble à une détection d'abus) ; évaluations ; contexte d'équipe ; `months_since_raise` (augmentations annuelles de janvier : la variable mesurerait surtout le mois du départ). Le code TypeScript refuse un bundle qui citerait une variable hors liste blanche (`TYPOLOGY_ALLOWED_FEATURES`) ou un libellé sensible.

## Méthode

1. k-moyennes (scikit-learn, 50 initialisations, graine 0, un seul fil) pour k = 3 à 8.
2. **Taille minimale** : max(20, 5 % des départs) = **24**. Tant qu'un profil compte moins de 24 départs, son centre est retiré et les k-moyennes sont relancées depuis les centres restants (fusion). Le nombre de profils effectif peut donc être inférieur à k.
3. **Stabilité** (Hennig, 2007) : 200 rééchantillonnages bootstrap ; même procédure (k-moyennes + fusion) sur chaque échantillon, puis affectation de tous les départs aux centres obtenus. ARI avec la partition de référence et, par profil, Jaccard maximal moyen.
4. **Choix** : parmi les partitions de 3 à 6 profils effectifs (la première obtenue pour chaque nombre), les stables (ARI moyen ≥ 0,6 et Jaccard minimal ≥ 0,6) ; parmi elles la meilleure silhouette. **Sans partition stable : la plus stable (ARI moyen).**
5. **Description** : pour chaque profil, écart standardisé de chaque variable au groupe de tous les départs ; 3 à 4 traits les plus marqués (|écart| ≥ 0,25 ; descripteurs ≥ 0,5), en mots, avec la valeur du profil (médiane, moyenne ou part) et celle de l'ensemble. Libellé = les deux traits les plus marqués (≥ 0,5), variables de carrière, salaire et travail d'abord, puis contrat et famille ; les absences ne nomment jamais un profil ; « promotion récente » n'est pas utilisée pour des arrivées récentes (le délai depuis la promotion y vaut l'ancienneté).

## Choix de k

| k demandé | Profils après fusion | Tailles | Silhouette | ARI moyen [IC 95 %] | Jaccard minimal |
|---|---|---|---|---|---|
| 3 | 2 (1 fusion) | 253, 227 | 0,167 | hors plage | — |
| 4 | 3 (1 fusion) | 177, 163, 140 | 0,148 | 0,483 [0,249 ; 0,821] | 0,496 |
| **5** | **4 (1 fusion)** | **158, 124, 110, 88** | **0,137** | **0,513 [0,249 ; 0,861]** | **0,568** |
| 6 | 4 (2 fusions) | 165, 122, 113, 80 | 0,139 | doublon de 4 profils | — |
| 7 | 5 (2 fusions) | 145, 104, 97, 78, 56 | 0,136 | 0,401 [0,241 ; 0,613] | 0,374 |
| 8 | 5 (3 fusions) | 142, 97, 95, 78, 68 | 0,135 | doublon de 5 profils | — |

Aucune partition n'atteint ARI ≥ 0,6 et Jaccard minimal ≥ 0,6 : **repli sur la plus stable, 4 profils** (ARI 0,513). Les silhouettes (0,13 à 0,17) indiquent des familles qui se chevauchent : les départs forment un continuum plus que des groupes séparés. Nous gardons ce repli plutôt que de forcer une partition.

**Spécification écartée.** Un premier passage gardait `contract_cdd` (0/1) dans les distances. Il donnait des partitions plus stables : 3 profils avec ARI 0,682 [0,403 ; 0,941], Jaccard minimal 0,718, silhouette 0,181. Mais la variable binaire standardisée y structurait le regroupement : à 2 profils, la coupure était exactement CDI / CDD (0 % contre 91 % de CDD). Cette stabilité reflétait surtout une coupure triviale, déjà connue de la RH. Le contrat est donc passé en descripteur, au prix d'une stabilité moyenne. La partition à 3 profils de ce premier passage n'a pas été examinée en détail. Au premier passage, le V de Cramér profil × tranche d'âge valait 0,339 et l'ARI avec les mécanismes −0,013.

## Profils obtenus

| Profil | Départs | Part | Ancienneté médiane | Stabilité (Jaccard) |
|---|---|---|---|---|
| Arrivées récentes, surtout en CDD | 158 | 32,9 % | 24 mois | 0,67 (moyenne) |
| Formation soutenue, salaire au-dessus de la médiane du poste | 124 | 25,8 % | 78,5 mois | 0,57 (faible) |
| Grande ancienneté, sans promotion depuis longtemps | 110 | 22,9 % | 125 mois | 0,61 (moyenne) |
| Peu de formation | 88 | 18,3 % | 46 mois | 0,57 (faible) |

Traits (valeur du profil, contre l'ensemble des départs) :

1. **Arrivées récentes, surtout en CDD** : ancienneté médiane 24 mois (55) ; sans promotion depuis 17 mois en médiane, ou depuis l'embauche (35) ; 55 % en CDD (26 %) ; taux d'absence hors santé 0,6 % (1,4 %).
2. **Formation soutenue, salaire au-dessus de la médiane du poste** : 21 h de formation sur 12 mois (12 h) ; salaire médian à 105 % de la médiane du poste (99 %) ; sans promotion depuis 54 mois (35) ; ancienneté médiane 78 mois (55).
3. **Grande ancienneté, sans promotion depuis longtemps** : ancienneté médiane 125 mois (55) ; sans promotion depuis 64 mois (35) ; salaire médian à 92 % de la médiane du poste (99 %) ; 3,7 h supplémentaires par mois (7,0 h).
4. **Peu de formation** : taux d'absence hors santé 3,4 % (1,4 %) ; 3,1 h de formation (12 h) ; sans promotion depuis 24 mois (35) ; ancienneté médiane 46 mois (55). Le trait le plus marqué (absences) ne nomme pas le profil, par choix éthique : le libellé vient du second trait.

Lecture : le profil 3 correspond à la famille attendue « seniors sans promotion depuis longtemps, salaire sous la médiane du poste » ; le profil 1 aux départs précoces, souvent en CDD. Aucun profil « surcharge d'heures supplémentaires » n'apparaît à 4 profils : les heures supplémentaires ne distinguent nettement aucun groupe de départs. Familles de métier : aucune n'est sur-représentée au point d'être citée (écart < 0,5).

## Validation externe (vérité terrain du simulateur, jamais importée)

Croisement avec le mécanisme simulé de chaque démission (480 sur 480 retrouvés) : **ARI 0,016, NMI 0,019**. Les profils ne retrouvent pas les causes simulées (offre externe, seuil d'insatisfaction, événement personnel), et ce n'est pas leur objet : ils décrivent des **familles de situations observées** au moment du départ, pas des causes. Tendances : le profil 1 compte 64 % de départs sur offre externe (ensemble 54 %), le profil 4 50 % de départs par seuil d'insatisfaction (ensemble 36 %).

## Éthique et équité (audit hors ligne, agrégats dans results.json seulement)

- **Sexe** : V de Cramér profil × sexe **0,048** ; part de femmes de 34 % à 40 % selon le profil (ensemble 38 %). Aucun profil n'est un indicateur indirect du sexe.
- **Âge** : V de Cramér profil × tranche d'âge **0,269** (valeur finale ; 0,339 au premier passage). L'âge est exclu des variables, mais l'ancienneté et la carrière en sont des **indicateurs indirects** : le profil « Arrivées récentes » compte 39 % de moins de 30 ans (ensemble 30 %) et 3 % de 45 ans et plus (13 %) ; « Grande ancienneté » compte 27 % de 45 ans et plus. C'est une **limite** : lire ces profils comme des profils d'âge serait un contresens, et aucune action ne doit viser une tranche d'âge.
- Aucune donnée de santé ; absences hors santé seulement, agrégées sur 12 mois, jamais dans un libellé.
- **Aucune lecture causale** : « facteurs associés, pas des causes », « estimation descriptive et non causale » à l'écran.
- **Aucun salarié étiqueté** : l'affectation d'un départ au profil le plus proche sert seulement à compter. Rien de nominatif dans le DTO.
- **Opposition** : `excludeOpposed` avant toute affectation ; un opposé reste compté parmi les départs, non classé.
- **Rôles** : RH seule. Le manager n'a pas la section (DAL `null`) : dans une hiérarchie de 5 à 12 personnes, un départ par profil se déduirait. ADMIN : 403 audité (`retention.view`).
- **Petites populations** (ADR-011, appliqué aussi à la RH ici) : à l'entraînement, profil ≥ 24 départs ; à l'affichage, profil sous 5 départs masqué avec masquage secondaire (`smallGroupMask`), département détaillé à partir de 5 départs classés et profil cité s'il y réunit 5 départs, aucun profil sous 30 départs classés.

## Exécution en production

- Bundle `models/typology/typo-kmeans-v1-20261004/` : `model.json` (variables, positions dans `feature_snapshot`, transformations, bornes, standardisation, 4 centres, profils, traits, effectifs, stabilité, métriques) et `golden.json` (150 départs réels et 50 points synthétiques hors bornes : distances et profil ; sélection complète et effectifs).
- TypeScript ([src/lib/ai/typology/model.ts](../src/lib/ai/typology/model.ts)) : même suite d'opérations que `bundle_*` (Python). **Parité golden à 1e-9** contrôlée au chargement et par les tests ; parité de la chaîne complète sur `data/app.db` : mêmes 480 départs (départ, coupure) et mêmes effectifs 158 / 124 / 110 / 88.
- **Pas de migration** : le registre `topic_model` n'accepte que `AI_TOPICS` (`src/db/schema.ts`, non modifiable dans ce chantier). Le modèle est chargé comme un bundle par version fixée (`TYPOLOGY_VERSION`, [bundle.ts](../src/lib/ai/typology/bundle.ts)), golden rejoué au premier chargement, cache par processus ; bundle absent ou invalide : état explicite à l'écran. **Aucune commande d'enregistrement ni de promotion** n'est nécessaire.
- Calcul à l'affichage (pas d'étape de batch ni de table) : sélection et affectation ~130 ms, mises en **cache mémoire** indexé sur le modèle, la référence et la version des données (dernier import, agrégats, run publié, `feature_snapshot`, oppositions, sorties), durée de vie 10 min ([src/lib/dal/typology.ts](../src/lib/dal/typology.ts)).
- UI : section « Profils de départs » de `/retention` (barres horizontales triées des parts, une carte par profil, tableau « Voir les données », profil le plus fréquent par département, encarts « Comment lire » et « Limites »).

## Limites

- **Stabilité moyenne** (ARI 0,51) et silhouettes faibles : les profils sont une lecture simplifiée d'un continuum ; deux profils (2 et 4) ont un Jaccard de 0,57. À réentraîner et revalider sur les données d'un client avant toute communication.
- Indicateurs indirects de l'âge (V = 0,27) par l'ancienneté et la carrière.
- Fenêtre « veille du départ » jusqu'à 6 mois avant la démission ; dans le simulateur, la décision précède la démission de 0 à 2 mois et s'accompagne de signaux faibles (heures supplémentaires divisées par deux, absences) : les traits d'heures supplémentaires et d'absences peuvent en partie refléter la décision déjà prise.
- 66 départs non classés (12 %) : arrivées trop récentes, contrat non suivi ou début d'historique (pas de ligne de variables dans les 6 mois avant la démission).
- Département et famille de métier : derniers connus.
- Données simulées : les profils valident la méthode, pas une réalité d'entreprise.

## Reproduction

```
python -m pytest ml/typology/tests -q                                  # 5 tests
python -m ml.typology.run --db data/app.db --boot 200 --bundle --mechanisms <sim>/ground_truth/mechanisms.csv
npx vitest run tests/ia-typologie tests/retention --maxWorkers=1      # 65 tests (9 fichiers)
```

Réentraîner : nouvelle version dans `ml/typology/run.py` (`VERSION`) et `src/lib/ai/typology/bundle.ts` (`TYPOLOGY_VERSION`), puis relancer les tests de parité.

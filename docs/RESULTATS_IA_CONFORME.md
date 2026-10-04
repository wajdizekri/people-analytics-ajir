# Résultats : fourchettes de prévision à couverture vérifiée (prédiction conforme)

Les prévisions d'absentéisme (`/absenteeism`), de charge (`/charge`) et d'effectifs / masse salariale (`/previsions`)
affichent une « fourchette probable à 80 % ». Ce chantier **mesure** la part des valeurs observées qui tombent réellement
dans ces fourchettes et la **garantit** par une calibration conforme, écrite dans une nouvelle version de chaque modèle.
Tous les chiffres sortent de `ml/<sujet>/conformal.py` (`ml/<sujet>/results/conformal.json` et `conformal.md`), exécutés le
04/10/2026 sur la copie `data/app.db` (empreintes de données identiques à celles des versions source). **Données simulées**
(`mixte_medium_s1`) : les couvertures valent pour le simulateur, pas pour une entreprise réelle.

## 1. Méthode

- **Score signé** de chaque prévision hors échantillon : `z = (y − ŷ) / s`, avec l'échelle `s` déjà utilisée par la v1
  (fourchette adaptative au niveau) : absentéisme `s = √(max(ŷ ; 0,2 %) / jours ouvrés mensuels moyens)` ; charge, échelle
  de bruit du groupe sur l'échelle `log(1 + heures sup par ETP)` ; effectif, écart-type stock-flux ; masse, la prévision.
- **Quantile conforme à rangs** (split conformal, `signed_interval` en Python, `conformalInterval` en TypeScript) : sur les
  `n` scores de calibration triés, `m = ⌈(n + 1) × 0,8⌉`, `i = ⌊(n + 1 − m) / 2⌋`, `j = i + m`, fourchette `[z(i) ; z(j)]`.
  Pour une prévision future échangeable avec la calibration, `P(z(i) ≤ Z ≤ z(j)) ≥ (j − i) / (n + 1) ≥ 80 %`. Bornes
  élargies pour contenir la prévision (bas ≤ 0 ≤ haut) ; au moins 9 scores sont nécessaires.
- **Par groupe** (conforme « Mondrian ») : un quantile par portée et par horizon. Absentéisme : entreprise, départements et
  équipes séparés (la v1 regroupait entreprise et départements, d'où 75 % pour l'une et 85 % pour les autres) ; charge :
  équipes et départements ; effectifs et masse : entreprise et départements, par source des démissions (taux ou LOGREG),
  quantiles rendus croissants avec l'horizon (bas décroissant, haut croissant : ne retire jamais de couverture).
- **Bornes appliquées** : `[ŷ + bas × s ; ŷ + haut × s]` (borne basse ramenée à 0) ; pour la charge, sur l'échelle log puis
  `expm1`. Les fourchettes deviennent asymétriques quand les erreurs le sont.

## 2. Découpage temporel (aucune fuite)

Prévisions hors échantillon : protocole de chaque sujet (modèle réentraîné à chaque origine avec les seules données
connues à l'origine). Calibration : prévisions dont la **cible** est observée au plus tard à la première origine de test
T0 ; test : prévisions des origines ≥ T0, jamais utilisées pour caler un quantile. Les quantiles écrits dans le bundle sont
**exactement ceux mesurés sur le test** (pas de recalage après coup).

| Sujet | Calibration (mois cibles) | Test : origines | Test : mois observés | Scores de calibration par horizon |
|---|---|---|---|---|
| Absentéisme | 2022-07 → 2024-06 (24 mois) | 2024-06 → 2026-05, h = 1 à 3 | 2024-07 → 2026-08 (26 mois) | entreprise 24, départements 192, équipes 3 647 à 3 699 |
| Charge de travail | 2023-09 → 2024-08 (12 mois) | 2024-08 → 2026-07, h = 1 à 3 | 2024-09 → 2026-08 (24 mois) | départements 96, équipes 1 858 à 1 859 |
| Effectifs et masse | 2022-10 → 2024-09 (24 mois) | 2024-09 → 2026-07, h = 1 à 12 (horizons observés) | 2024-10 → 2026-08 (23 mois) | entreprise 24, départements 192 |

« Avant » = procédure de la version source rejouée sur les **mêmes** prévisions de test (absentéisme : quantiles glissants
10 % / 90 % des 24 mois précédant l'origine, par famille ; charge : quantile du `|résidu|` calé sur les 12 mois précédant
l'origine, sur la fenêtre qui servait aussi à choisir alpha ; effectifs : quantiles calés sur les origines 2021-09 → 2022-09).
« Bandes v1 publiées (calibration) » = quantiles du bundle v1 appliqués à la fenêtre de calibration, qu'ils n'ont pas vue.

## 3. Couvertures mesurées sur la fenêtre de test

### 3.1 Absentéisme (`abs-ridge-v2-20261004`)

| Portée | h | n test | Avant : procédure v1 | Bandes v1 publiées (calibration) | Après : conforme | Largeur moyenne avant → après |
|---|---|---|---|---|---|---|
| Entreprise | 1 | 24 | 75,0 % | 58,3 % | 91,7 % | 0,25 → 0,32 pt |
| Entreprise | 2 | 24 | 79,2 % | 58,3 % | 87,5 % | 0,25 → 0,36 pt |
| Entreprise | 3 | 24 | 70,8 % | 54,2 % | 100,0 % | 0,27 → 0,63 pt |
| **Entreprise** | tous | 72 | 75,0 % | | **93,1 %** [86,1 ; 97,3] | 0,26 → 0,43 pt |
| Département | 1 | 192 | 84,9 % | 73,4 % | 84,9 % | 0,76 → 0,76 pt |
| Département | 2 | 192 | 85,4 % | 74,0 % | 85,4 % | 0,75 → 0,74 pt |
| Département | 3 | 192 | 84,4 % | 70,3 % | 88,0 % | 0,82 → 0,82 pt |
| **Département** | tous | 576 | 84,9 % | | **86,1 %** [84,0 ; 88,2] | 0,78 → 0,77 pt |
| Équipe | 1 | 3 687 | 80,9 % | 77,2 % | 81,5 % | 2,28 → 2,22 pt |
| Équipe | 2 | 3 652 | 81,4 % | 76,1 % | 83,4 % | 2,30 → 2,23 pt |
| Équipe | 3 | 3 619 | 80,7 % | 74,3 % | 85,0 % | 2,34 → 2,27 pt |
| **Équipe** | tous | 10 958 | 81,0 % | | **83,3 %** [82,3 ; 84,3] | 2,30 → 2,24 pt |

IC 95 % : bootstrap par blocs de 3 origines (comme `run.py`). Lecture : l'entreprise passe de 75 % (sous la cible) à 93 %
au prix d'une fourchette 1,7 fois plus large (24 scores seulement par horizon : le quantile conforme est alors prudent,
surtout à 3 mois) ; départements et équipes gardent ou réduisent leur largeur et dépassent 80 %. Les quantiles v1 publiés,
calés sur 2024-08 → 2026-07, ne couvraient que 54 à 77 % de la période antérieure : la calibration dépend de la période.

**Pourquoi 93 % pour l'entreprise, et pas 80 %.** Trois causes, mesurées sur les scores de calibration
(`conformal_parity.json`) :

- **Période de calibration plus erratique que le test** : les scores de l'entreprise y ont un écart quadratique de 2,5
  (h = 1) à 3,7 (h = 3) unités d'échelle, quand les quantiles v1, calés sur 2024-08 → 2026-07, valaient ±1,9 ; le modèle,
  réentraîné sur un historique croissant, se trompe moins sur la période de test. La garantie conforme (≥ 80 %) tient,
  mais la couverture réalisée dépasse la cible.
- **Petit échantillon** : 24 scores par horizon. La fourchette [z(2) ; z(22)] a une couverture attendue de 80 % exactement,
  mais elle dépend de quelques mois extrêmes : à 3 mois, un seul mois fixe la borne basse à −7,2 unités (contre −3,0 à
  1 mois), d'où 100 % de couverture et une largeur de 0,63 point à h = 3.
- **Pas de mise en commun** : la v1 mêlait entreprise et départements (192 + 24 scores) ; séparer l'entreprise corrige sa
  sous-couverture (75 %) mais la laisse avec peu de données.

**Une calibration par horizon ou adaptative la resserrerait-elle ?** Elle est déjà par horizon et adaptative (score
normalisé par l'échelle Poisson) : c'est justement le découpage par horizon qui élargit h = 3. Mettre en commun les trois
horizons (72 scores) donnerait [−3,77 ; 3,85] : h = 3 bien plus étroit (largeur 7,6 au lieu de 11,1 unités), h = 1 et 2
plus larges (5,6 et 6,3), **largeur moyenne inchangée** (7,6) ; cela stabilise la borne de h = 3 sans resserrer en moyenne.
Une calibration glissante sur les erreurs les plus récentes (procédure v1, ou conforme adaptatif de type ACI) resserrerait
la fourchette, mais la procédure v1, qui faisait exactement cela, couvrait 75 % : sous la cible. Le vrai levier est la
quantité de données (historique plus long, recalibration à chaque nouvelle version) ; non mesuré ici, à reprendre sur
données réelles.

### 3.2 Charge de travail (`workload-ridge-v2-20261004`)

| Portée | h | n test | Avant : procédure v1 | Bandes v1 publiées (calibration) | Après : conforme | Largeur moyenne avant → après |
|---|---|---|---|---|---|---|
| Équipe | 1 | 3 713 | 80,4 % | 78,8 % | 82,2 % | 6,19 → 6,43 h |
| Équipe | 2 | 3 560 | 81,0 % | 76,1 % | 83,1 % | 6,78 → 6,92 h |
| Équipe | 3 | 3 406 | 81,6 % | 74,2 % | 83,6 % | 7,33 → 7,32 h |
| **Équipe** | tous | 10 679 | 81,0 % | | **83,0 %** [81,8 ; 84,1] | 6,75 → 6,88 h |
| Département | 1 | 192 | 76,6 % | 82,3 % | 78,1 % | 1,63 → 1,66 h |
| Département | 2 | 184 | 78,8 % | 68,8 % | 85,3 % | 1,73 → 2,04 h |
| Département | 3 | 176 | 77,3 % | 83,3 % | 75,0 % | 1,93 → 1,94 h |
| **Département** | tous | 552 | 77,5 % | | **79,5 %** [76,1 ; 83,0] | 1,76 → 1,88 h |

IC 95 % : bootstrap par groupe (1 000 tirages). Lecture : équipes à 83 % (+2 points, largeur quasi inchangée) ;
départements de 77,5 % à **79,5 %, encore sous la cible** (IC compatible avec 80 %, 8 départements seulement, 96 scores de
calibration par horizon) : l'écran le dit (« sous la cible de 80 % »).

### 3.3 Effectifs et masse salariale (`effectif-v2-20261004`, `masse-v2-20261004`)

Largeur relative = (haut − bas) / valeur observée, moyenne sur le test. n test = 210 prévisions par niveau (origines × horizons
observés, 12 à 23 origines selon l'horizon) et 8 départements.

| Série | Démissions | Niveau | Avant : procédure v1 | Après : conforme | h1 avant → après | h6 avant → après | h12 avant → après | Largeur relative avant → après |
|---|---|---|---|---|---|---|---|---|
| Effectif | taux | entreprise | 100,0 % | **98,6 %** | 100 → 87 % | 100 → 100 % | 100 → 100 % | 4,7 → 3,2 % |
| Effectif | taux | départements | 90,2 % | **89,3 %** | 85 → 84 % | 92 → 88 % | 91 → 93 % | 7,6 → 7,8 % |
| Effectif | LOGREG | entreprise | 99,0 % | **98,1 %** | 96 → 91 % | 100 → 100 % | 100 → 92 % | 7,1 → 3,6 % |
| Effectif | LOGREG | départements | 92,6 % | **88,0 %** | 88 → 82 % | 93 → 88 % | 90 → 89 % | 9,0 → 7,8 % |
| Masse | taux | entreprise | 100,0 % | **98,6 %** | 100 → 96 % | 100 → 100 % | 100 → 100 % | 5,5 → 3,1 % |
| Masse | taux | départements | 93,3 % | **89,0 %** | 93 → 89 % | 94 → 90 % | 97 → 92 % | 8,7 → 7,7 % |
| Masse | LOGREG | entreprise | 100,0 % | **91,4 %** | 100 → 96 % | 100 → 89 % | 100 → 83 % | 9,1 → 3,0 % |
| Masse | LOGREG | départements | 95,2 % | **89,9 %** | 93 → 89 % | 95 → 94 % | 95 → 96 % | 9,0 → 7,6 % |

Lecture : la v1 était **trop prudente** (99 à 100 % au niveau entreprise : quantiles calés sur 2021-2022, quand
l'historique disponible était court et les erreurs plus fortes). La calibration sur les 24 mois précédant le test garde
toutes les couvertures au-dessus de 80 % (88 à 99 %) et resserre nettement les fourchettes de l'entreprise (largeur divisée
par 1,5 à 3). Les quantiles signés corrigent aussi le biais du modèle d'effectif (embauches sous-estimées) en décalant la
fourchette vers le haut. La projection de référence recalculée avec les versions v2 redonne les mêmes valeurs centrales que
la v1 (même base).

## 4. Dans l'application

- **Nouvelles versions** (les v1 ne sont pas modifiées) : `models/absenteeism/abs-ridge-v2-20261004`,
  `models/workload/workload-ridge-v2-20261004`, `models/workforce/effectif-v2-20261004`, `models/workforce/masse-v2-20261004`.
  Mêmes modèles que la v1 (coefficients, paramètres, saisonnalité recopiés) ; champ additif `conformal` : méthode, fenêtres,
  `quantiles` signés, `coverage` (par portée : mois de test, n, couverture après et avant, largeur, IC, détail par horizon).
  `golden.json` régénéré avec les bornes conformes ; `conformal_parity.json` : scores de calibration et quantiles Python.
- **Inférence TypeScript rétro-compatible** : `forecastUnit` (absentéisme), `predictGroup` (charge) et `project` (effectifs,
  masse ; même changement dans `ml/workforce/engine.py`) utilisent `conformal.quantiles` s'il existe, portée par portée, et
  sinon exactement les bornes v1. `validateBundle` refuse des quantiles conformes qui excluraient la prévision.
- **Écrans** : sous chaque prévision, une ligne `CoverageNote` (`src/components/ai/conformal/coverage-note.tsx`) lue dans le
  bundle du modèle qui a produit les prévisions (`readConformal`, `src/lib/ai/conformal.ts`) : « Fourchette calibrée : sur les
  26 derniers mois de test, 93 % des valeurs observées y sont tombées (cible 80 %). » ; sous la cible : « …, 79,5 % des
  valeurs observées y sont tombées, sous la cible de 80 %. » (jamais arrondi jusqu'à la cible). Bulle « ? » : terme
  `fourchetteCalibree` ajouté en fin de `src/lib/help/terms.ts`. `/absenteeism` : portée affichée (entreprise, département ou
  équipe du manager) ; `/charge` : sous le tableau des équipes et celui des départements (RH), sous le graphique des équipes
  (manager) ; `/previsions` : sous les graphiques d'effectif et de masse (niveau et source des démissions affichés ; « Mesure
  faite pour le scénario de référence. » si le scénario est simulé). Aucune phrase avec un modèle v1.
- **DAL** : `getWorkload` renvoie aussi `modelVersion` au manager (seule donnée ajoutée, un nom de version de modèle).

## 5. Tests

Exécutés le 04/10/2026 dans le worktree `wt/conforme` :

- `python -m pytest ml/absenteeism/tests ml/workload/tests ml/workforce/tests -q` : **20 passés** (dont 9 nouveaux :
  rangs exacts, couverture sur données synthétiques, équivalence des quantiles symétriques avec la v1, repli LOGREG → taux,
  élargissement avec l'horizon).
- `npx vitest run tests/ia-conforme tests/ai --maxWorkers=1` : **21 fichiers, 113 tests passés, 4 ignorés** (les 4 parités
  sur bases de travail `data/dev-ai-*.db`, absentes du worktree). `tests/ia-conforme` (34 tests) : quantile conforme sur
  données synthétiques (rangs exacts, couverture moyenne ≥ 80 % avec 24 scores, proche de 80 % sur grand échantillon, score
  normalisé qui couvre petites et grandes unités), rétro-compatibilité sans champ `conformal` (golden v1 reproduits,
  quantiles symétriques = bornes v1, repli par portée), parité golden des 4 versions et des quantiles Python ↔ TypeScript,
  phrase de couverture (cible atteinte, « sous la cible », pas d'arrondi jusqu'à la cible, rien pour un modèle v1), rendu
  de `/charge` (RH et manager) et `/previsions` (dont le scénario simulé). `tests/ai` passe avec les versions v2, qui
  sont désormais les plus récentes dans `models/`.
- `npx eslint` sur les fichiers modifiés : 0 erreur. `npx tsc --noEmit` : seules les 2 erreurs `LayoutProps` connues
  (types générés par Next absents du worktree) ; une 3e erreur dans `tests/ia-conforme/parity.test.ts` (accès possiblement
  indéfini) a été corrigée ensuite.

## 6. Enregistrement et promotion (à lancer par l'orchestrateur après la fusion)

Sur la base de production (`data/app.db`, ou la base visée par `DATABASE_PATH`) :

```
npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v2-20261004
npm run topic-model -- register CHARGE_TRAVAIL models/workload/workload-ridge-v2-20261004
npm run topic-model -- register EFFECTIF models/workforce/effectif-v2-20261004
npm run topic-model -- register MASSE_SALARIALE models/workforce/masse-v2-20261004
npm run topic-model -- promote abs-ridge-v2-20261004
npm run topic-model -- promote workload-ridge-v2-20261004
npm run topic-model -- promote effectif-v2-20261004
npm run topic-model -- promote masse-v2-20261004
```

Les fourchettes affichées changent au prochain calcul mensuel (`runAiSteps`) pour l'absentéisme et la charge (lignes
`forecast`), immédiatement pour `/previsions` (projection recalculée à l'affichage). Retour arrière : `promote` des versions
`*-v1-20260930`.

## 7. Limites

- **Échangeabilité supposée** : la garantie de 80 % suppose que les erreurs futures ressemblent à celles de la fenêtre de
  calibration. Avec une dérive (nouvelle organisation, données réelles), la couverture peut baisser : la mesure affichée est
  celle de la fenêtre de test, à refaire à chaque nouvelle version.
- **Petits groupes** : entreprise (24 scores par horizon) et départements (8 unités) ; le quantile conforme est alors prudent
  (entreprise d'absentéisme à 93 %, fourchette plus large) ou instable (départements de charge à 79,5 %).
- **Couverture marginale** : 80 % en moyenne sur la portée et la période, pas pour chaque unité ni chaque mois ; un
  département atypique peut rester mal couvert. Les prévisions d'un même mois sont corrélées : les IC le prennent en compte
  (blocs d'origines, groupes), les n bruts surestiment l'information.
- **Choix antérieurs** : la configuration du ridge d'absentéisme (α, cible, pondération) a été choisie en 2023-06 → 2024-05,
  période qui recouvre la fenêtre de calibration (32 configurations aux scores voisins, effet attendu négligeable) ; le test
  reste intact.
- Quantiles figés à la date de calibration : une version plus récente doit être recalibrée avec les mêmes scripts (fenêtres
  décalées) pour rester vérifiée.

## 8. Reproduire

```
python -m ml.absenteeism.conformal --db data/app.db --version abs-ridge-v2-20261004        # ~2 min
python ml/workload/conformal.py --db data/app.db --version workload-ridge-v2-20261004      # ~2 min
python -m ml.workforce.conformal --db data/app.db --version-date 20261004                   # ~8 min (LOGREG compris)
python -m pytest ml/absenteeism/tests ml/workload/tests ml/workforce/tests -q
npx vitest run tests/ia-conforme tests/ai --maxWorkers=1
```

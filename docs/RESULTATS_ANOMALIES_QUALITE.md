# Résultats : détection d'anomalies d'absentéisme et contrôle qualité de l'import

Évaluation chiffrée, contre la vérité terrain du simulateur, de deux briques du module : la détection d'anomalies
d'absentéisme (`src/lib/anomalies`) et le contrôle qualité de l'import AJIR (`src/lib/import`). Tous les chiffres
ci-dessous sortent de `python -m ml.eval.run --s2` (fichiers `ml/eval/results/anomalies.json`, `quality.json`,
`tables.md`) ; aucune valeur n'est reportée à la main. matplotlib n'étant pas installé, les résultats sont donnés en
tableaux (pas de figure).

## 1. Ce qui est évalué

**Détection collective** (équipes et départements d'au moins 5 personnes en poste) : taux hebdomadaire d'absence non
planifiée hors santé (injustifiée, sans solde, autre) ; attendu = médiane des 26 semaines précédentes corrigée d'un
facteur de classe de semaine (Ramadan, férié ou pont, séance unique) ; écart normalisé par
`max(1,4826 x MAD, écart binomial avec un plancher de 2 %)` ; signalement si **z > 3,5 deux semaines consécutives**.

**Signal individuel** (RH seulement) : facteur de Bradford sur 12 mois glissants (épisodes² x jours, mêmes catégories),
signalement à partir de 250.

**Import** : règles de `src/lib/import/rules.ts` (rejets, corrections, avertissements) et score qualité = moyenne,
sur les 10 fichiers de données, de lignes acceptées / lignes lues, multipliée par la complétude de la paie du dernier
mois ; import bloqué sous 95 %.

## 2. Protocole

**Données.** Jeu principal `data/sim/mixte_medium_s1` (1 200 salariés initiaux, 72 mois, 2 445 salariés au total),
tel qu'importé dans `data/app.db` avec le pipeline complet (`--backtest`). Validation hors échantillon sur
`mixte_medium_s2`. Tout le travail se fait sur des copies `data/eval-*.db` ; `data/app.db` n'est jamais écrit.

**Vérité terrain.** `ground_truth/anomalies.csv` : 118 anomalies injectées (hors maladie et maternité). Les 6 qui
commencent avant la première semaine évaluée (2021-02-22, période de référence initiale) sont exclues, restent **112** :
31 pics d'équipe, 25 rotations d'équipe (type libre `held_out`, jamais utilisé pour régler la méthode), 22 lundi/vendredi,
11 ponts, 23 dérives. `defects.csv` : 32 533 défauts d'import étiquetés (fichier, ligne, type).

**Deux modes d'exécution.**
- *batch* : un seul appel sur 2021-03 → 2026-08, comme `npm run pipeline -- --backtest` ; c'est ce qui a rempli la table
  `anomaly` de `data/app.db`.
- *mensuel* : un appel par mois (66 appels), comme le worker ; rejoué par `scripts/eval-anomalies.ts replay`.

**Appariement.** Une détection collective correspond à une anomalie injectée si les périodes se chevauchent **et** si au
moins un salarié touché appartient au groupe signalé. Rappel = part des anomalies avec au moins une détection ;
précision = part des détections qui correspondent à au moins une anomalie (tous types) ; faux positifs par mois = détections
sans correspondance / 66 mois ; délai = fin de la deuxième semaine signalée − début injecté (délai « statistique ») et,
en mode mensuel, date du lot (le 10 du mois suivant) − début injecté (délai « opérationnel »).

**PR-AUC.** (1) Au niveau (équipe, semaine) : score z de la semaine, ou min des z de deux semaines consécutives ;
positif = la semaine chevauche une anomalie du type avec un membre dans l'équipe ; un type contre les semaines sans aucune
anomalie ; précision moyenne (scikit-learn). (2) Au niveau événement : z de 2 à 12 (pas 0,25) avec k = 2, précision du
type = détections attribuées au type / (attribuées + fausses), aire sous la courbe interpolée depuis un rappel nul.

**Contrôle du hasard.** L'appariement est permissif pour les anomalies individuelles longues (ponts : 9 mois en moyenne) :
le rappel « par hasard » est estimé en décalant toutes les détections de ±26 et ±52 semaines.

**Réplication.** La règle est réimplémentée en Python sur les z exportés par `anomalyScores` : **64/64 détections
identiques** à la table de `data/app.db` (63/63 sans facteur calendrier ; 59/59 en mensuel sans calendrier ; 58/58 plus 2
en mensuel avec calendrier, le facteur étant recalculé à chaque appel). Graine 2 : 64/64. Les balayages de seuils utilisent
cette réplication ; les chiffres nominaux viennent des tables produites par le code TypeScript.

## 3. Détection collective

### 3.1 Table `anomaly` de `data/app.db` (batch, z > 3,5, 2 semaines)

| Type injecté | Événements | Détectés | Rappel | Délai médian (min–max) |
|---|---|---|---|---|
| Pic d'équipe | 31 | 27 | 87,1 % | 16 j (10–24) |
| Rotation d'équipe (réservé à l'évaluation) | 25 | 18 | 72,0 % | 18 j (11–47) |
| Lundi/vendredi | 22 | 2 | 9,1 % | 80 j (69–90) |
| Ponts | 11 | 0 | 0,0 % | – |
| Dérive | 23 | 1 | 4,3 % | 156 j |

64 détections collectives (63 équipes, 1 département), **48 vraies, précision 75,0 %, 16 fausses soit 0,24 par mois**
pour environ 155 équipes suivies. 4 des 16 fausses chevauchent la phase de départ simulée d'un membre (signaux faibles
avant démission : absences courtes non justifiées), c'est-à-dire un phénomène réel du simulateur mais pas une anomalie
étiquetée.

Rejeu **mensuel** (mode worker) : 58 détections, précision 75,9 %, 0,21 fausse par mois ; rappel pic 80,6 %, rotation
64,0 %. **Délai opérationnel** (lot du 10 du mois suivant) : médiane 35 j pour les pics (16–53), 41 j pour les rotations
(20–66). Le mode mensuel perd 7 détections du batch (4 vraies) : la composition des équipes est reconstruite à partir du
manager **actuel** de chaque salarié, et une équipe qui compte 5 personnes en fin de période n'en comptait pas
forcément 5 aux mois concernés.

**Ce que la méthode détecte.** Les deux types collectifs, y compris la rotation (type libre jamais vu pendant la mise
au point) : un membre absent chaque jour à tour de rôle ne fait pas de pic individuel mais élève le taux d'équipe
(taux médian de l'équipe pendant l'anomalie : 9,4 %, contre 0,81 % en moyenne). **Ce qu'elle ne détecte pas.** Les trois types individuels : une anomalie lundi/vendredi injecte en moyenne
7,7 jours sur 13 semaines, soit moins de 2 points sur les ~32 jours-personne hebdomadaires d'une équipe, loin des
8,7 % requis (voir ci-dessous). Les 2 lundi/vendredi et la dérive « détectés » coïncident pour 2 d'entre eux avec un
pic d'équipe, et le hasard en attend 0,5 et 1,25 (tableau 3.3) ; ces motifs relèvent du signal individuel (§ 5).

**Structure du score.** Sur les semaines d'équipes suivies, **99,05 % ont un attendu nul** (médiane des 26 semaines = 0 ;
taux moyen 0,81 %, effectif médian 32 jours-personne par semaine). Le MAD est donc nul et le score se réduit à un test
binomial contre le plancher de 2 % : z > 3,5 revient à plus de 8,7 % d'absence, soit 3 jours d'absence non planifiée
dans la semaine pour une équipe de 6 à 7 personnes, deux semaines de suite. Le plancher, et non la médiane, fixe la
sensibilité au niveau équipe.

### 3.2 Sensibilité au seuil z et à la règle des k semaines consécutives (batch)

| k | z | Détections | Précision | FP/mois | Pic | Rotation | Délai pic (j) | Délai rotation (j) |
|---|---|---|---|---|---|---|---|---|
| 1 | 2,5 | 1 463 | 12,9 % | 19,32 | 100 % | 100 % | 6 | 6 |
| 1 | 3,0 | 927 | 16,3 % | 11,76 | 100 % | 100 % | 9 | 9 |
| 1 | 3,5 | 643 | 18,8 % | 7,91 | 100 % | 100 % | 9 | 9 |
| 1 | 4,0 | 427 | 23,0 % | 4,98 | 100 % | 96 % | 9 | 11 |
| 2 | 2,5 | 190 | 38,9 % | 1,76 | 90 % | 100 % | 13 | 16 |
| 2 | 3,0 | 95 | 62,1 % | 0,55 | 87 % | 96 % | 16 | 16 |
| **2** | **3,5** | **64** | **75,0 %** | **0,24** | **87 %** | **72 %** | **16** | **18** |
| 2 | 4,0 | 47 | 87,2 % | 0,09 | 84 % | 48 % | 16 | 16 |
| 3 | 2,5 | 59 | 91,5 % | 0,08 | 77 % | 96 % | 22 | 23 |
| 3 | 3,0 | 44 | 95,5 % | 0,03 | 61 % | 88 % | 23 | 23 |
| 3 | 3,5 | 32 | 96,9 % | 0,02 | 52 % | 60 % | 23 | 25 |
| 3 | 4,0 | 24 | 100,0 % | 0,00 | 48 % | 36 % | 23 | 25 |

La règle « deux semaines consécutives » est ce qui rend la méthode exploitable : à seuil égal (3,5), passer de 1 à
2 semaines divise les faux positifs par 33 (7,91 → 0,24 par mois) pour une perte de 13 points de rappel sur les pics
et 28 sur les rotations, et 7 à 9 jours de délai. Trois semaines coûtent encore une semaine de délai.

### 3.3 Types individuels : rappel observé / rappel par hasard

| k | z | Lundi/vendredi | Ponts | Dérive |
|---|---|---|---|---|
| 1 | 2,5 | 68 % / 44 % | 91 % / 68 % | 70 % / 50 % |
| 1 | 3,5 | 41 % / 24 % | 64 % / 34 % | 35 % / 27 % |
| 2 | 2,5 | 23 % / 7 % | 18 % / 14 % | 17 % / 9 % |
| 2 | 3,5 | 9 % / 2 % | 0 % / 0 % | 4 % / 5 % |
| 3 | 2,5 | 18 % / 1 % | 0 % / 5 % | 4 % / 4 % |

Les rappels élevés en k = 1 viennent surtout du volume de détections (jusqu'à 19 fausses par mois) : décalées d'un
semestre, les mêmes détections « retrouvent » déjà 44 à 68 % de ces anomalies.

### 3.4 PR-AUC en faisant varier le seuil du score robuste

| Type | Semaines positives | Prévalence | PR-AUC z semaine | PR-AUC min z sur 2 semaines | PR-AUC événement (k = 2) |
|---|---|---|---|---|---|
| Pic d'équipe | 155 | 0,38 % | 0,357 | 0,317 | 0,850 |
| Rotation d'équipe | 245 | 0,60 % | 0,120 | 0,341 | 0,687 |
| Lundi/vendredi | 285 | 0,70 % | 0,016 | 0,025 | 0,034 |
| Ponts | 331 | 0,81 % | 0,012 | 0,011 | 0,006 |
| Dérive | 436 | 1,07 % | 0,020 | 0,024 | 0,059 |

Au niveau semaine, la PR-AUC vaut environ 90 fois la prévalence pour les pics, 20 fois (z semaine) à 50 fois (deux
semaines) pour les rotations, et seulement 1,3 à 3,3 fois pour les types individuels. Le minimum sur deux semaines triple la PR-AUC des
rotations (0,120 → 0,341) : leur signal est modéré mais persistant. Toutes anomalies confondues, la PR-AUC événement
(k = 2) vaut 0,512.

## 4. Ablation du facteur calendrier tunisien

Facteurs estimés sur les données (taux de la classe / taux des semaines normales) : Ramadan 1,086 ; férié ou pont 0,983 ;
séance unique 0,819. Le simulateur ne module presque pas l'absentéisme non planifié selon le calendrier (la baisse
estivale vient vraisemblablement de l'éviction par les congés annuels, attribués en priorité). Pour mesurer l'apport du facteur quand l'effet existe, deux
scénarios de stress ajoutent sur une copie des absences d'un jour « normales » (catégorie AUTRE, taux de base 0,83 %
par jour) : A = Ramadan x 1,5 et jours collés aux fériés x 2 (482 épisodes) ; B = Ramadan x 2 et fériés x 3
(1 003 épisodes) (`python -m ml.eval.stress`). Détection rejouée par le code TypeScript avec `calendarAdjust` à
`false` puis `true`.

Fausses détections **sans → avec** facteur, selon la période signalée (une période peut compter dans plusieurs colonnes) :

| Scénario | Ramadan | Aïd | Pont | Férié | Séance unique | Normale | Total FP | Détections |
|---|---|---|---|---|---|---|---|---|
| Simulé, batch, z 3,5 | 0 → 0 | 1 → 1 | 1 → 1 | 2 → 2 | 3 → 3 | 12 → 12 | 16 → 16 | 63 → 64 |
| Simulé, mensuel, z 3,5 | 0 → 0 | 1 → 0 | 1 → 1 | 3 → 2 | 4 → 4 | 10 → 10 | 15 → 14 | 59 → 58 |
| Simulé, batch, z 3 | 4 → 1 | 4 → 2 | 4 → 4 | 12 → 9 | 7 → 5 | 23 → 23 | 38 → 36 | 97 → 95 |
| Stress A, batch, z 3,5 | 1 → 0 | 1 → 0 | 1 → 1 | 2 → 1 | 4 → 3 | 12 → 12 | 17 → 15 | 64 → 62 |
| Stress B, batch, z 3,5 | 1 → 0 | 1 → 0 | 1 → 1 | 2 → 2 | 4 → 4 | 12 → 12 | 17 → 16 | 64 → 63 |
| Stress B, batch, z 3 | 11 → 1 | 7 → 2 | 5 → 4 | 19 → 9 | 15 → 6 | 23 → 23 | 46 → 36 | 107 → 93 |

Lecture : au réglage nominal, le facteur ne change presque rien (0 à 2 fausses détections sur 66 mois), parce que le
plancher de 2 % domine la variance des petites équipes : même un Ramadan à x 2 (+0,8 point) reste loin des ~9 points
nécessaires. Il devient déterminant dès qu'on abaisse le seuil ou que l'effet saisonnier est fort : au scénario B et
z = 3, **10 fausses détections évitées sur 46 ; 10 des 11 fausses détections du Ramadan et 5 des 7 de l'Aïd
disparaissent**. Aucune anomalie d'équipe n'est perdue (27 pics et 24 rotations détectés dans les deux cas) ; seule une
dérive trouvée par hasard sort du lot, et quelques détections vraies sont décalées d'une ou deux semaines. En été, le facteur 0,82 rend la détection un peu plus sensible (une vraie détection de plus en
juillet-août sur les données simulées). Le test unitaire existant (Ramadan à 10 % contre 1 %) reste la démonstration
qualitative du mécanisme.

## 5. Signal individuel (Bradford)

La table de `data/app.db` ne contient qu'un calcul, en fin de période (fenêtre 2025-09-07 → 2026-09-06) : **16 salariés
signalés sur 1 168 en poste (1,4 %)**, dont 13 font partie d'une anomalie injectée dans la fenêtre (4 lundi/vendredi,
2 dérives, 1 ponts, 3 membres de pics, 3 de rotations) ; 1 des 3 autres est en phase de départ simulée.

Pour une évaluation complète, le facteur est recalculé chaque mois comme le ferait le worker (66 calculs, 77 475
unités salarié x mois, `bradfordScores`). Détection d'une anomalie = salarié signalé à un calcul dont la fenêtre de
12 mois chevauche l'anomalie ; précision = part des signalements dont la fenêtre chevauche une anomalie injectée
(tous types) du salarié.

| Seuil | Signalés / mois | Salariés signalés au moins une fois | Précision | Lundi/ven. | Ponts | Dérive | Membres pic | Membres rotation | Délai médian LV / ponts / dérive |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 3,91 % | 455 (19,7 %) | 62,0 % | 91 % | 100 % | 87 % | 42 % | 53 % | 62 / 131 / 135 j |
| 150 | 2,98 % | 353 (15,3 %) | 70,1 % | 86 % | 100 % | 83 % | 35 % | 48 % | 65 / 158 / 142 j |
| **250** | **1,70 %** | **222 (9,6 %)** | **78,7 %** | **77 %** | **73 %** | **74 %** | 24 % | 33 % | **75 / 198 / 163 j** |
| 400 | 0,69 % | 103 (4,5 %) | 86,6 % | 59 % | 64 % | 39 % | 10 % | 16 % | 89 / 229 / 170 j |
| 600 | 0,43 % | 60 (2,6 %) | 92,0 % | 50 % | 64 % | 30 % | 6 % | 9 % | 109 / 265 / 170 j |

PR-AUC du facteur de Bradford (salarié x mois, un type contre les unités sans anomalie) : lundi/vendredi 0,446
(prévalence 0,41 %), ponts 0,344 (0,29 %), dérive 0,274 (0,45 %), membres de rotation 0,343 (3,00 %), membres de pic
0,243 (3,04 %). Au seuil 250, 26 % des signalements non expliqués par une anomalie injectée tombent pendant la phase de
départ simulée du salarié.

Bradford retrouve donc les trois motifs individuels que la détection collective manque, mais tard (2,5 à 6,5 mois) et
sans dire lequel : le signal est un volume d'absences courtes, pas un motif.

## 6. Améliorations testées (prototypes Python, non intégrés au code TypeScript)

**Tests individuels typés.** Test binomial mensuel sur les jours d'absence courte comptée (épisodes de 3 jours ouvrés
au plus) : part tombant un lundi ou un vendredi sur 3 mois, ou collée à un bloc chômé contenant un férié sur 6 mois,
contre la part de ces jours parmi les jours ouvrés ; signal si au moins 3 jours ciblés et p < 0,01.

| Test | Signalés / mois | Salariés | Précision | Lundi/ven. | Ponts | Délai médian |
|---|---|---|---|---|---|---|
| Lundi/vendredi (graine 1) | 0,05 % | 18 | 100,0 % | 77 % | 0 % | 75 j |
| Ponts (graine 1) | 0,17 % | 27 | 74,2 % | 9 % | 100 % | 103 j |
| Lundi/vendredi (graine 2) | 0,08 % | 26 | 90,5 % | 79 % | 0 % | 69 j |
| Ponts (graine 2) | 0,19 % | 26 | 78,6 % | 3 % | 94 % | 111 j |

À rappel égal sur le lundi/vendredi (77 %), le test typé signale environ 30 fois moins que Bradford 250 (0,05 %
contre 1,70 % des salariés par mois) et nomme le motif ; le test des ponts retrouve 100 % des anomalies « ponts » en 103 jours
contre 73 % en 198 jours pour Bradford. Les résultats tiennent sur la graine 2. À porter en TypeScript comme signal RH
complémentaire, sous la même réserve que Bradford (« à vérifier, sans présumer de la cause »).

**Règle collective combinée** « z > 4 deux semaines ou z > 2,5 trois semaines » :

| Règle | Graine | Détections | Précision | FP/mois | Pic | Rotation | Délai pic / rotation |
|---|---|---|---|---|---|---|---|
| Nominale (k 2, z 3,5) | 1 | 64 | 75,0 % | 0,24 | 87 % | 72 % | 16 / 18 j |
| Combinée | 1 | 72 | 84,7 % | 0,17 | 84 % | 96 % | 16 / 19 j |
| Nominale (k 2, z 3,5) | 2 | 64 | 73,4 % | 0,26 | 74 % | 83 % | 12 / 17 j |
| Combinée | 2 | 69 | 75,4 % | 0,26 | 78 % | 88 % | 12 / 19 j |

Le gain net observé sur la graine 1 (qui a servi à la choisir) se réduit sur la graine 2 à +4 points de rappel sur
les pics et les rotations, précision +2 points, faux positifs inchangés : amélioration modeste, à ne pas surinterpréter.

**Contrôle qualité.** Une règle de cohérence « brut > 2 x base » signale 699/699 (graine 1) et 693/693 (graine 2)
salaires de base divisés par 10, y compris celui que la règle SMIG manque (§ 7), et aucune des 84 743 lignes de paie
saines (ratio brut/base maximal 1,328). À valider sur des paies réelles (primes, 13e mois) avant de l'ajouter.
**Ajoutée le 30/09/2026** comme avertissement `PAIE_BRUT_INCOHERENT` (ligne importée, score qualité inchangé), évaluée
après le rejet SMIG : import complet rejoué sur les deux graines avec le SMIG daté (528,320 TND jusqu'à fin 2025, 554,736
TND ensuite), scores identiques (0,981 et 0,9894), aucun faux rejet SMIG, aucun avertissement hors défaut ; en graine 2,
l'avertissement signale la ligne 32002, seul salaire divisé par 10 que la règle SMIG laisse passer.

## 7. Contrôle qualité de l'import

`import_rejection` ne garde le détail que des 1 000 premières lignes par fichier et par règle (`DETAIL_CAP`), les
comptes complets étant dans `report_json`. Trois règles de `attendance.csv` dépassent ce plafond dans `data/app.db`.
L'évaluation ligne à ligne rejoue donc l'import sur une base neuve (`scripts/eval-anomalies.ts import`, plafond levé
pour l'évaluation uniquement, comptes et score inchangés : 0,981, 15 448 rejets, comme dans `data/app.db`).

| Fichier | Défaut injecté | Règle attendue | Injectés | Signalés par la règle | Taux | Sévérité |
|---|---|---|---|---|---|---|
| absences.csv | ABSENCE_FIN_AVANT_DEBUT | FIN_AVANT_DEBUT | 642 | 642 | 100 % | rejet |
| absences.csv | DOUBLON | DOUBLON | 445 | 445 | 100 % | rejet |
| absences.csv | MATRICULE_INCONNU | MATRICULE_INCONNU | 243 | 243 | 100 % | rejet |
| attendance.csv | DOUBLON | POINTAGE_DUPLIQUE | 7 739 | 7 739 | 100 % | rejet |
| attendance.csv | MATRICULE_INCONNU | MATRICULE_INCONNU | 4 605 | 4 605 | 100 % | rejet |
| attendance.csv | POINTAGE_SANS_SORTIE | POINTAGE_SANS_SORTIE | 17 085 | 17 085 | 100 % | avertissement |
| payroll.csv | DOUBLON | DOUBLON | 650 | 650 | 100 % | rejet |
| payroll.csv | MATRICULE_INCONNU | MATRICULE_INCONNU | 425 | 425 | 100 % | rejet |
| payroll.csv | SALAIRE_SOUS_SMIG | SALAIRE_SOUS_SMIG | 699 | 699 | 100 % | rejet |

- **Détection : 32 533 / 32 533**, chaque défaut par la règle attendue, à la ligne près. Pour un doublon, c'est la
  copie (seconde occurrence) qui est rejetée.
- **Faux rejets : aucun.** Aucune ligne n'est signalée hors `defects.csv`. Contre-épreuve : l'export corrigé (doublons
  retirés, valeurs d'origine restaurées) s'importe avec **0 rejet et un score de 1,000**.
- **Table de `data/app.db`** : ses 6 104 lignes détaillées rattachées à une ligne correspondent toutes à un défaut du
  type attendu ; les 17 autres sont des avertissements `PAIE_INCOMPLETE` sans numéro de ligne.
- **`PAIE_INCOMPLETE` (17 salariés en poste sans paie d'août 2026)** : les 17 sont des conséquences de défauts injectés,
  leur ligne d'août ayant été rejetée (11 salaires sous le SMIG, 6 matricules inconnus). Ce ne sont pas de faux signaux.

**Impact sur le score.** 0,981 = 0,9952 (lignes) x 0,9857 (complétude de la paie). Points perdus par règle :

| Règle | Points |
|---|---|
| Complétude paie (17 salariés sur 1 191) | 1,421 |
| absences FIN_AVANT_DEBUT | 0,093 |
| payroll SALAIRE_SOUS_SMIG | 0,081 |
| payroll DOUBLON | 0,075 |
| absences DOUBLON | 0,064 |
| attendance POINTAGE_DUPLIQUE | 0,050 |
| payroll MATRICULE_INCONNU | 0,049 |
| absences MATRICULE_INCONNU | 0,035 |
| attendance MATRICULE_INCONNU | 0,030 |

Les 17 fiches de paie manquantes coûtent trois fois plus (1,42 point) que les 15 448 lignes rejetées (0,48 point) :
la complétude multiplie le score, et chaque fichier pèse 1/10 quel que soit son volume (les 12 344 pointages rejetés
pèsent 0,08 point, les 699 salaires sous le SMIG 0,08 point). Le score reflète donc surtout l'état de la paie du dernier
mois ; c'est cohérent avec son rôle de garde-fou du scoring, mais à expliquer dans l'écran « santé des données ».
`POINTAGE_SANS_SORTIE` est un avertissement : la ligne est importée sans heure de sortie et ne compte pas dans le score.

**Graine 2.** 32 432 défauts : 32 431 signalés par la règle attendue, 0 faux rejet, score 0,9894 (7 salariés sans paie
du dernier mois, tous dus à des défauts). Le seul défaut manqué est un `SALAIRE_SOUS_SMIG` dont la base, divisée par
10, vaut 539,80 TND, au-dessus du SMIG (528,32) : ce n'est pas une erreur de la règle mais une erreur de saisie qu'elle
ne peut pas voir (d'où la règle de cohérence du § 6).

## 8. Limites

- **Données simulées.** Les taux (rappel, faux positifs) dépendent des intensités choisies dans `ml/sim/anomalies.py` ;
  ils classent les méthodes entre elles plus qu'ils ne prédisent la production. Le simulateur n'a presque pas d'effet
  calendaire sur l'absentéisme non planifié : l'apport du facteur n'est mesurable que sur les scénarios de stress, dont
  les multiplicateurs sont des hypothèses.
- **Composition des équipes statique.** La détection rattache chaque salarié à son manager actuel (`employees.csv` n'a
  pas d'historique) : 22 % des salariés touchés par une anomalie d'équipe ont aujourd'hui un autre manager qu'au moment
  de l'injection. Reconstruire l'historique depuis les événements `CHANGEMENT_MANAGER` corrigerait cela.
- **Appariement permissif** (un membre en commun suffit), d'où le contrôle par décalage temporel pour les types
  individuels ; la précision Bradford compte comme expliqué tout signalement dont la fenêtre de 12 mois contient une
  anomalie du salarié, même une anomalie d'équipe où il n'a eu qu'un ou deux jours.
- **Délais de saisie ignorés.** La détection lit toutes les absences importées ; une absence saisie après le lot
  mensuel (jusqu'à 15 jours dans le simulateur) manquerait à ce lot.
- **Réglages choisis sur la graine 1.** Seuls les résultats de la graine 2 sont hors échantillon ; la règle combinée n'y
  garde qu'un gain modeste.
- **Qualité.** Seuls les 5 types de défauts que le simulateur sait injecter sont évalués ; les autres règles (dates et
  valeurs invalides, cycles hiérarchiques, sorties avant embauche…) ne sont couvertes que par les tests unitaires de
  `src/lib/import`. Le taux de 100 % tient aussi au fait que règles et défauts ont été conçus ensemble.

## 9. Code ajouté

`src/lib/anomalies/index.ts`, ajouts sans effet sur le comportement nominal (table `anomaly` rejouée à l'identique,
80/80 lignes, scores égaux) :
- `detectAnomalies(sqlite, fromWeek, toWeek, opts?)` avec `DetectOptions` : `zThreshold` (défaut 3,5),
  `consecutiveWeeks` (défaut 2), `calendarAdjust` (défaut `true` ; `false` = facteurs de classe de semaine à 1),
  `bradfordThreshold` (défaut : paramètre `bradford_threshold`), `alerts` (défaut `true`).
- `anomalyScores(sqlite, fromWeek, toWeek, { calendarAdjust })` : z, taux, attendu et effectif de tous les groupes
  (`monitored` = au moins 5 en poste), sans écriture.
- `bradfordScores(sqlite, toWeek)` : facteur de Bradford de tous les salariés en poste, sans écriture (le calcul est
  partagé avec `detectBradford`).
- Tests : `src/lib/anomalies/options.test.ts` (6 tests) ; les 7 tests existants passent inchangés.

`scripts/eval-anomalies.ts` (tsx, CommonJS ; refuse toute base qui ne s'appelle pas `eval-*.db`) : `scores`,
`replay`, `import`. `ml/eval/` : `metrics.py` (règle, appariement, PR-AUC), `anomalies.py`, `quality.py`,
`stress.py`, `run.py`, tests pytest (`ml/eval/tests`, 10 tests).

## 10. Reproduire

Depuis `people-analytics/` (PowerShell ou bash), environ 10 minutes au total.

```
# copie de travail (lecture seule de data/app.db)
python -c "import sqlite3; s=sqlite3.connect('file:data/app.db?mode=ro', uri=True); d=sqlite3.connect('data/eval-base.db'); s.backup(d)"

# exports TypeScript
npx tsx scripts/eval-anomalies.ts scores --db data/eval-base.db --out data/eval-out
npx tsx scripts/eval-anomalies.ts replay --db data/eval-base.db --mode monthly --out data/eval-out/replay_monthly_nominal.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-base.db --mode monthly --no-calendar --out data/eval-out/replay_monthly_nocal.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-base.db --mode batch --no-calendar --out data/eval-out/replay_batch_nocal.csv
npx tsx scripts/eval-anomalies.ts import --dir data/sim/mixte_medium_s1 --db data/eval-import.db --out data/eval-out/rejections_full.csv

# stress calendrier
python -m ml.eval.stress --ramadan 1.5 --ferie 2 --out data/eval-stress-a.db
python -m ml.eval.stress --ramadan 2 --ferie 3 --out data/eval-stress-b.db
npx tsx scripts/eval-anomalies.ts replay --db data/eval-stress-a.db --mode batch --out data/eval-out/stress_a_cal.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-stress-a.db --mode batch --no-calendar --out data/eval-out/stress_a_nocal.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-stress-b.db --mode batch --out data/eval-out/stress_b_cal.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-stress-b.db --mode batch --no-calendar --out data/eval-out/stress_b_nocal.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-stress-b.db --mode batch --z 3 --out data/eval-out/stress_b_cal_z3.csv
npx tsx scripts/eval-anomalies.ts replay --db data/eval-stress-b.db --mode batch --z 3 --no-calendar --out data/eval-out/stress_b_nocal_z3.csv

# export corrigé (contre-épreuve des faux rejets)
python -c "from ml.eval import quality as Q, common as C; Q.build_clean_export(C.SIM_DIR, C.EXPORT_DIR / 'clean_mixte_medium_s1', Q.load_defects())"
npx tsx scripts/eval-anomalies.ts import --dir data/eval-out/clean_mixte_medium_s1 --db data/eval-import-clean.db --out data/eval-out/rejections_clean.csv

# graine 2 (base importée avec pipeline : data/ml-mixte_medium_s2.db, copiée en lecture seule)
python -c "import sqlite3; s=sqlite3.connect('file:data/ml-mixte_medium_s2.db?mode=ro', uri=True); d=sqlite3.connect('data/eval-s2.db'); s.backup(d)"
npx tsx scripts/eval-anomalies.ts scores --db data/eval-s2.db --out data/eval-out-s2
npx tsx scripts/eval-anomalies.ts import --dir data/sim/mixte_medium_s2 --db data/eval-import-s2.db --out data/eval-out-s2/rejections_full.csv

# évaluation et tests
python -m ml.eval.run --s2
python -m pytest ml/eval/tests -q
npx vitest run src/lib/anomalies
```

# Chapitre 6 — Données : contrat AJIR, qualité, calendrier et simulateur

Un modèle de démission ne vaut que par les données qui l'alimentent et par la façon dont on les date. Ce chapitre décrit le contrat d'export AJIR, les contrôles de qualité à l'import, le calendrier tunisien, la règle de visibilité à la date de saisie, puis le simulateur à vérité terrain qui remplace, pendant le PFE, les données client indisponibles. Il correspond à la contribution C1.

## 6.1 Contrat d'export AJIR

### 6.1.1 Format

Le module lit un **dossier par export**, contenant onze fichiers CSV (tableau 6.1). Le format est fixé dans [docs/CONVENTIONS.md](../CONVENTIONS.md) : séparateur `;`, encodage UTF-8, en-tête obligatoire, dates `YYYY-MM-DD`, mois `YYYY-MM`, heures `HH:MM`, décimales avec un point, champ vide pour une valeur absente. Seuls `departments.csv` et `employees.csv` sont obligatoires ; un module AJIR non déployé chez un client (formation, évaluation…) se traduit par un fichier absent.

*Tableau 6.1 — Fichiers de l'export AJIR.*

| Fichier | Contenu | Date de saisie |
|---|---|---|
| `departments.csv` | Code et libellé des départements | — |
| `employees.csv` | Matricule, identité, sexe, date de naissance, date d'embauche, département, famille de métier, intitulé, grade (G1 à G8), matricule du manager, gouvernorat, situation familiale | — |
| `contracts.csv` | Type (CDI, CDD, SIVP, stage), début, fin | — |
| `exits.csv` | Date de sortie, motif (démission, abandon, fin de CDD, licenciement, retraite, décès, mutation, autre), date de démission | `recorded_at` |
| `career_events.csv` | Promotion, augmentation, mutation, changement de manager, changement de poste, avec ancienne et nouvelle valeur | `recorded_at` |
| `attendance.csv` | Un pointage par jour ouvré : arrivée, départ, minutes travaillées, heures supplémentaires, retard | temps réel |
| `absences.csv` | Début, fin, jours ouvrés, catégorie (congé annuel, maladie, maternité, absence injustifiée, congé sans solde, autre) | `recorded_at` |
| `payroll.csv` | Mois, salaire de base, brut, heures supplémentaires payées | `recorded_at` |
| `trainings.csv` | Code, intitulé, caractère obligatoire, dates, échéance, heures, statut | — |
| `evaluations.csv` | Date et note de 1 à 5 | `recorded_at` |
| `users.csv` | Identifiant, matricule, rôle, adresse électronique, actif | — |

Deux choix de ce contrat méritent d'être soulignés. D'abord, le **motif d'absence** se réduit à une catégorie : aucun motif médical n'est importé, et les catégories maladie et maternité sont marquées « santé » dès l'import (ADR-009). Ensuite, la **date de saisie** `recorded_at` accompagne chaque source saisie en différé. C'est elle qui rend possible la règle de visibilité de la section 6.4.

### 6.1.2 Import

L'import ([src/lib/import/](../../src/lib/import/)) lit chaque fichier en flux (csv-parse), valide chaque ligne par un schéma zod, applique les règles métier et écrit par lots de 5 000 lignes. Il est **idempotent** : réimporter le même export met à jour les lignes existantes (clés naturelles : matricule, salarié et date, salarié et mois) au lieu de les dupliquer. Les fichiers sont traités dans l'ordre des dépendances : départements, salariés, hiérarchie, contrats, sorties, carrière, paie, absences, formations, évaluations, pointages, puis comptes utilisateurs.

La **hiérarchie** est résolue en seconde passe. Un manager inexistant est ignoré, et un cycle hiérarchique (A manage B qui manage A) est rompu en détachant le membre de plus petit matricule, avec un signalement. La **fin des données** (`data_end_date`) est fixée au dernier pointage accepté. Elle n'est jamais reculée, et une avance de plus de 45 jours d'un import à l'autre est signalée. C'est elle qui borne la publication d'un calcul et définit la censure des étiquettes.

## 6.2 Contrôles de qualité

### 6.2.1 Règles

L'import applique 24 règles, réparties en trois niveaux de gravité (tableau 6.2). Chaque déclenchement est enregistré dans `import_rejection` avec le fichier, la ligne, la règle, un message lisible et la ligne brute. Le détail est plafonné à 1 000 occurrences par fichier et par règle, au-delà desquelles seul le compte est conservé.

*Tableau 6.2 — Règles de contrôle de l'import ([src/lib/import/rules.ts](../../src/lib/import/rules.ts)).*

| Gravité | Effet | Règles |
|---|---|---|
| Rejet (16) | Ligne non importée | En-tête invalide, ligne mal formée, champ obligatoire manquant, date invalide, valeur invalide, matricule en double, ligne en double, matricule inconnu, département inconnu, sortie antérieure à l'embauche, fin antérieure au début, absence hors de la période d'emploi, salaire de base inférieur au SMIG, pointage en double, pointage postérieur à la date d'import, pointage hors de la période d'emploi |
| Correction (4) | Ligne importée, champ neutralisé | Grade inconnu (grade ignoré), manager inexistant (rattachement ignoré), cycle hiérarchique (rattachement rompu), sortie sans motif valide (motif « autre ») |
| Avertissement (4) | Contrôle informatif | Pointage sans sortie, salarié actif sans paie du mois, variation de volume supérieure à 30 % par rapport à l'import précédent, fin des données avancée anormalement |

Le contrôle du SMIG utilise un paramètre réglable (`smig_monthly`, 528,320 TND par défaut pour le régime de 48 heures). Il ne s'applique pas aux stagiaires ni aux SIVP, dont la gratification peut être inférieure. La valeur par défaut est celle de l'année 2025, fixée par le décret n° 2024-419 du 9 juillet 2024. Le décret n° 2026-67 du 30 avril 2026 l'a portée à 554,736 TND à compter du 1er janvier 2026, puis à 582,400 TND en 2027 (Décret n° 2024-419, 2024 ; Décret n° 2026-67, 2026). Le paramètre doit donc être mis à jour à l'installation. Surtout, un contrôle à valeur unique ne convient pas à un historique pluriannuel : un salaire de 2025 conforme au SMIG de 2025 serait rejeté avec le SMIG de 2026. Un barème daté du SMIG serait plus juste (chapitre 10).

### 6.2.2 Score de qualité et blocage

Le score de qualité combine deux termes :

- la **moyenne, sur les fichiers de données présents, de la part de lignes acceptées** (un fichier à l'en-tête invalide compte 0) ;
- la **complétude de la paie** : part des salariés en poste pendant le mois de paie qui ont un bulletin.

Le score est le produit des deux. Sous le seuil `quality_threshold` (95 % par défaut), le lot passe au statut BLOQUE et une alerte Données critique est créée. Tout calcul de score est ensuite refusé tant qu'un import conforme n'a pas eu lieu. Les lignes valides restent néanmoins écrites : le blocage protège la décision (le score), pas la consultation. Un lot conforme mais comportant des rejets crée une alerte Données d'attention qui résume les trois règles les plus fréquentes.

L'écran **Santé des données** présente, pour chaque lot, le statut, le score, le détail par fichier et par règle, et les lignes rejetées avec leur motif (figure 6.1).

*Figure 6.1 — Écran « Santé des données » (capture à prendre sur la base de démonstration, lot `mixte_medium_s1`).*

### 6.2.3 Évaluation du contrôle de qualité

Le contrôle de qualité a été évalué contre la vérité terrain du simulateur. Le rapport complet figure dans [docs/RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md), section 7. L'import de l'export `mixte_medium_s1` a été rejoué sur une base neuve, avec le plafond de détail levé pour l'évaluation seulement. Les 32 533 défauts injectés (tableau 6.3) y sont tous signalés par la règle attendue, à la ligne près. Aucune ligne saine n'est rejetée : l'export corrigé (doublons retirés, valeurs d'origine restaurées) s'importe avec 0 rejet et un score de 1,000.

*Tableau 6.3 — Défauts injectés et règles déclenchées, jeu `mixte_medium_s1` (source : [RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md), § 7).*

| Fichier | Défaut injecté | Règle | Injectés | Signalés | Gravité |
|---|---|---|---|---|---|
| absences.csv | Fin avant début | FIN_AVANT_DEBUT | 642 | 642 | Rejet |
| absences.csv | Doublon | DOUBLON | 445 | 445 | Rejet |
| absences.csv | Matricule inconnu | MATRICULE_INCONNU | 243 | 243 | Rejet |
| attendance.csv | Doublon | POINTAGE_DUPLIQUE | 7 739 | 7 739 | Rejet |
| attendance.csv | Matricule inconnu | MATRICULE_INCONNU | 4 605 | 4 605 | Rejet |
| attendance.csv | Pointage sans sortie | POINTAGE_SANS_SORTIE | 17 085 | 17 085 | Avertissement |
| payroll.csv | Doublon | DOUBLON | 650 | 650 | Rejet |
| payroll.csv | Matricule inconnu | MATRICULE_INCONNU | 425 | 425 | Rejet |
| payroll.csv | Salaire sous le SMIG | SALAIRE_SOUS_SMIG | 699 | 699 | Rejet |

Le score de qualité du lot est de **0,981**, pour 15 448 lignes rejetées. Il se décompose en 0,9952 pour les lignes acceptées et 0,9857 pour la complétude de la paie. Les 17 salariés en poste sans bulletin du dernier mois coûtent 1,42 point, soit trois fois plus que les 15 448 lignes rejetées (0,48 point). Ces 17 absences de paie sont elles-mêmes des conséquences de défauts injectés : leur ligne d'août a été rejetée. Chaque fichier pesant un dixième du score quel que soit son volume, le score reflète surtout l'état de la paie du dernier mois. C'est cohérent avec son rôle de garde-fou du calcul, mais l'écran de santé des données doit l'expliquer.

Sur une seconde graine (`mixte_medium_s2`), 32 431 des 32 432 défauts sont signalés, sans faux rejet (score 0,9894). Le seul défaut manqué est un salaire divisé par dix qui reste au-dessus du SMIG (539,80 TND). La règle SMIG ne peut pas voir cette erreur de saisie ; une règle de cohérence « brut > 2 × base », prototypée, la détecte sans faux positif sur les deux graines, mais doit être validée sur des paies réelles (primes, treizième mois) avant d'être ajoutée.

Ce taux de 100 % doit être lu avec prudence. Règles et défauts ont été conçus ensemble, et seuls les cinq types de défauts que le simulateur sait injecter sont évalués ; les autres règles (dates invalides, cycles hiérarchiques, sorties avant embauche…) ne sont couvertes que par les tests unitaires de l'import.

### 6.2.4 Délais de repli

AJIR ne fournit pas toujours la date de saisie. Dans ce cas, l'import applique un **délai de repli** par source (tableau 6.4), paramétrable. Le plan de cadrage recommandait de fixer ces délais au 90e ou 95e centile du délai réel observé chez le client ; en l'absence de données client, ce sont des valeurs prudentes à mesurer lors d'un pilote.

*Tableau 6.4 — Date de saisie retenue quand `recorded_at` est absente (ADR-005).*

| Source | Date de saisie retenue |
|---|---|
| Absences | Fin de l'absence + `lag_absence_days` (10 jours par défaut) |
| Évaluations | Date d'évaluation + `lag_evaluation_days` (90 jours par défaut) |
| Paie | Dernier jour du mois de paie |
| Carrière | Date de l'événement |
| Sorties | Date de démission, sinon date de sortie |

## 6.3 Calendrier tunisien

L'absentéisme et les pointages n'ont de sens que rapportés aux jours ouvrés, et les jours ouvrés tunisiens dépendent d'un calendrier que les bibliothèques génériques connaissent mal. La table `dim_date` ([src/lib/calendar/](../../src/lib/calendar/)) qualifie chaque jour selon cinq indicateurs :

- **week-end** : samedi et dimanche, la semaine de travail simulée allant du lundi au vendredi ;
- **férié** :
  - fêtes civiles à date fixe : Nouvel An, Indépendance (20 mars), Martyrs (9 avril), Travail (1er mai), République (25 juillet), Femme (13 août), Évacuation (15 octobre) ;
  - fête de la Révolution, qui a changé de date : 14 janvier jusqu'en 2021, 17 décembre à partir de 2021, par le décret présidentiel n° 2021-223 cité dans le code ;
  - fêtes religieuses datées selon l'Hégire : Ras el Am el Hijri, Mouled, Aïd el-Fitr et Aïd el-Idha (ces deux dernières sur deux jours chacune) ;
- **Ramadan** : du 1er Ramadan à la veille de l'Aïd el-Fitr ;
- **pont** : jour ouvré isolé entre un férié et un week-end, ou entre deux fériés ;
- **séance unique** : du 1er juillet au 31 août, et pendant le Ramadan.

Les fêtes religieuses posent une difficulté propre : leur date dépend de l'observation lunaire annoncée en Tunisie et peut différer d'un jour du calendrier astronomique. Le code embarque une table des dates tunisiennes de 2019 à 2030, corrigée quand la date locale est connue, avec un repli sur le calendrier Umm al-Qura de la bibliothèque ICU hors de cette plage. Ces dates sont marquées comme **estimées, à relire chaque année**. Leur justesse conditionne directement la détection d'anomalies d'absentéisme, puisque le Ramadan et les semaines de pont modifient le taux d'absence attendu (chapitre 8).

## 6.4 Visibilité à la date de saisie (*as-of*)

### 6.4.1 Le problème

Dans un système RH, beaucoup d'informations sont saisies après les faits : une absence déclarée en retard, une régularisation de paie, une évaluation saisie des semaines après la campagne, une démission enregistrée tardivement. Si l'on calcule une variable « au 30 juin » avec toutes les lignes présentes en base aujourd'hui, on utilise des informations que la RH n'avait pas au 30 juin. Le modèle paraît alors meilleur en étude qu'il ne le sera en production. C'est une **fuite temporelle**, et la mesurer est l'objet de la question Q1.

### 6.4.2 La règle

Une ligne source n'est utilisée pour la date de coupure t que si **sa date d'événement est ≤ t et sa date de saisie est ≤ t** (ADR-005). La règle s'applique uniformément :

- aux **variables** : rémunération, carrière, absences, évaluations ;
- à l'**éligibilité** : un salarié dont la sortie ou la démission n'est pas encore saisie à t reste éligible à t ;
- à l'**état reconstitué** du grade et du manager à t, déduit des événements de carrière visibles ;
- aux **médianes de salaire** par famille de métier et grade, qui servent au ratio de rémunération (*compa-ratio*).

Les pointages sont supposés saisis en temps réel et les formations n'ont pas de date de saisie : pour elles, la date d'événement fait foi. Il en découle une limite connue : le **statut** d'une formation est son état courant, si bien qu'une formation terminée aujourd'hui peut compter comme terminée à une date passée si sa date de fin y est antérieure.

### 6.4.3 Garanties

Trois propriétés sont vérifiées par des tests automatisés ([src/lib/features/features.test.ts](../../src/lib/features/features.test.ts)) :

1. **anti-fuite par perturbation** : ajouter des lignes datées ou saisies après t ne change aucune variable (test par propriétés, fast-check) ;
2. **cohérence des modes de calcul** : le calcul pour un salarié, le calcul par lot du mois et le recalcul historique (*backfill*) donnent les mêmes valeurs. Les variables d'un mois passé recalculées aujourd'hui sont donc celles que le produit aurait calculées ce mois-là, ce qui rend le backtest honnête ;
3. **masquage de la santé** : un salarié en arrêt maladie a les mêmes variables que si ces jours étaient retirés de sa fenêtre (chapitre 7).

Un **mode naïf**, qui ignore la date de saisie, existe pour la seule expérience Q1. Il n'est accessible que par un script d'export qui ouvre la base en lecture seule, jamais par le worker.

## 6.5 Simulateur RH à vérité terrain

### 6.5.1 Pourquoi un simulateur

Aucune donnée client n'était garantie pendant le PFE. Il fallait pourtant développer, tester et surtout **évaluer** une méthode de prédiction. Trois options existaient (ADR-010) :

- le **seed déterministe** du sujet initial : utile pour les tests, mais un modèle entraîné sur des données tirées au hasard ne prouve rien ;
- un **jeu public** comme IBM HR Attrition : statique, sans dates calendaires, sans pointages ni risques concurrents, il ne permet pas l'expérience de fuite temporelle (chapitre 3) ;
- un **simulateur** qui produit un export au format AJIR, dont les causes sont connues.

Nous avons retenu le simulateur, en gardant le seed pour les tests unitaires. Le simulateur ([ml/sim/](../../ml/sim/)) est écrit en Python, hors ligne. Il produit les onze fichiers du contrat, importés par le même code que les données client, et un dossier `ground_truth/` **jamais importé** dans l'application.

### 6.5.2 Population et organisation

Trois tailles sont disponibles : `small` (300 salariés initiaux sur 36 mois), `medium` (1 200 sur 72 mois) et `large` (2 500 sur 96 mois). La période simulée se termine le 31 août 2026, et l'export est « extrait » le 15 septembre 2026 : une saisie plus tardive n'y figure pas. L'entreprise simulée compte huit directions (systèmes d'information, administrative et financière, production, commerciale, ressources humaines, logistique, qualité, achats) et cinq familles de métiers. Les équipes comptent 5 à 12 personnes sur deux ou trois niveaux hiérarchiques. La grille salariale va de G1 à G8, en dinars.

Le réalisme tunisien porte sur plusieurs dimensions : noms et prénoms romanisés, gouvernorats, situation familiale ; mix contractuel d'environ 70 % CDI, 20 % CDD, 7 % SIVP et 3 % stages ; salaires log-normaux par famille et grade, avec un plancher au-dessus du SMIG pour les CDI et CDD ; augmentations de janvier de 2 à 8 % selon la note ; promotions en janvier et juillet. Les horaires sont de 8 h à 17 h en temps normal, de 8 h à 14 h pendant le Ramadan et de 7 h 30 à 13 h 30 en séance unique d'été. Un retard est compté au-delà de 10 minutes. La paie est calculée à partir du salaire de base, du prorata, des heures supplémentaires majorées de 25 % et des jours non payés. Le calendrier des jours fériés, du Ramadan, de la séance unique et des ponts est celui de la section 6.3.

### 6.5.3 Mécanisme de départ non circulaire

C'est le point méthodologique central. Si les départs étaient tirés d'une régression logistique des variables observées, un modèle logistique retrouverait exactement le mécanisme de génération et paraîtrait parfait : la conclusion serait **circulaire**. Le simulateur évite ce piège par construction (figure 6.2) :

- **aucune sortie n'est tirée d'un logit des variables exportées** ;
- un **engagement latent** évolue chaque mois selon un processus autorégressif d'ordre 1 : E ← 0,85 E + 0,15 × cible + 0,27 ε. La cible combine le compa-ratio, la stagnation (mois sans promotion au-delà de 36), les heures supplémentaires au-delà d'un seuil, une **qualité de manager latente** (propriété du manager, sans aucune variable exportée), un choc de marché par famille de métier, des événements personnels transitoires et des effets d'arrivée et de promotion ;
- la démission est déclenchée par l'un de trois mécanismes :
  - (a) une **offre externe**, qui arrive selon un processus de Poisson par famille de métier (modulé par le marché, l'âge et le contrat) et qui est acceptée avec une probabilité décroissante de l'engagement ;
  - (b) le **franchissement d'un seuil individuel** par l'insatisfaction cumulée D ← max(0 ; 0,92 D + (−1,35 − E)) ;
  - (c) un **événement personnel** indépendant de tout, de l'ordre de 1,1 % par an ;
- la démission suit la décision de 0 à 2 mois. Pendant 1 à 3 mois, des **signaux faibles** apparaissent : absences courtes non justifiées, heures supplémentaires divisées par deux environ, arrivées plus dispersées, retards, jours sans pointage. Un **préavis** d'un mois suit, pendant lequel les pointages continuent. Environ 8 % des départs volontaires sont des abandons de poste, surtout aux grades G1 à G3.

*Figure 6.2 — Mécanisme de départ du simulateur : engagement latent → trois déclencheurs (offre, seuil, événement personnel) → signaux faibles → préavis → sortie (à produire d'après [ml/sim/README.md](../../ml/sim/README.md)).*

Plusieurs causes restent **invisibles aux variables** : la qualité du manager, les chocs de marché, les événements personnels. Le bruit de l'export s'y ajoute : 4 % des démissions sont exportées avec le motif « autre », 40 % n'ont pas de date de démission. La performance atteignable par un modèle est donc bornée, et cette borne est connue (section 6.5.5).

### 6.5.4 Sorties concurrentes et délais de saisie

Le simulateur génère aussi les sorties qui ne sont pas des démissions, et qui jouent le rôle de risques concurrents : non-renouvellement de CDD ou de SIVP, fin de stage, licenciement dans les six mois suivant une note de 1 ou 2, retraite à 60 ans, décès, mutation dans le groupe. Un poste libéré est remplacé en 1 à 3 mois. Un manager sortant est remplacé le lendemain, par promotion interne ou recrutement, ce qui produit les changements de manager observés.

Les **délais de saisie** sont générés pour exercer la règle de visibilité : absences saisies de 0 à 15 jours après leur fin, évaluations saisies de 30 à 120 jours après la campagne de décembre (5 % d'évaluations manquantes), régularisations de paie.

### 6.5.5 Vérité terrain

Le dossier `ground_truth/` contient ce qu'aucune entreprise réelle ne connaît :

- `latent_monthly.csv` : l'engagement, la qualité du manager, la pression du marché, les chocs personnels et la phase (départ, préavis) de chaque salarié chaque mois ;
- `mechanisms.csv` : le mécanisme déclencheur de chaque démission, sa date vraie, le motif et la date exportés ;
- `oracle_prob6.csv` : la **vraie probabilité** de démission ou d'abandon dans les six mois, estimée par au moins 50 continuations Monte-Carlo de l'état latent, un mois sur trois. Elle reproduit la règle d'éligibilité de l'application ;
- `anomalies.csv` : les anomalies d'absentéisme injectées (1,5 % des salarié-mois, hors maladie et maternité), de cinq types : pic d'équipe de 2 à 4 semaines, absences les lundis et vendredis, absences autour des ponts, dérive progressive, et un type « rotation d'équipe » réservé à l'évaluation (`held_out`) ;
- `defects.csv` : les défauts de qualité injectés (environ 1,9 % des lignes de pointage, d'absence et de paie) : pointage sans sortie, doublons, fin d'absence avant le début, matricule inconnu, salaire de base sous le SMIG ;
- `config.json`, `stats.json`, `calendar.csv` : paramètres, statistiques de calage, calendrier.

L'oracle joue un double rôle. Il fournit le **plafond de performance** : aucun modèle fondé sur les données exportées ne peut, en espérance, faire mieux que la vraie probabilité. Il permet aussi de vérifier que le simulateur n'est pas trivial, c'est-à-dire que ce plafond n'est pas proche de 1.

### 6.5.6 Calage

Le tableau 6.5 reprend les statistiques de calage publiées dans [ml/sim/README.md](../../ml/sim/README.md) pour la graine 1 du scénario « mixte ». Le scénario alternatif « charge » renforce l'effet de la charge de travail : le seuil d'insatisfaction y devient le premier mécanisme, avec environ la moitié des démissions.

*Tableau 6.5 — Calage du simulateur, scénario « mixte », graine 1 (source : [ml/sim/README.md](../../ml/sim/README.md)).*

| Jeu | Turnover/an | Part volontaire | Absentéisme hors congés | Congés/an | AUC oracle | Démissions offre / seuil / personnel |
|---|---|---|---|---|---|---|
| small | 14,5 % | 58 % | 3,9 % | 20,6 j | 0,836 | 35 / 30 / 10 |
| medium | 13,1 % | 62 % | 3,7 % | 19,7 j | 0,844 | 314 / 193 / 57 |
| large | 12,0 % | 59 % | 3,7 % | 20,1 j | 0,818 | 742 / 427 / 199 |

Sur la taille `medium`, les graines 1 à 4 donnent un turnover de 11 à 13 %, une part volontaire de 60 à 62 % et une AUC oracle de 0,83 à 0,84 ; le scénario « charge » donne une AUC oracle de 0,85. Le taux de démission à 6 mois parmi les salariés éligibles est d'environ 3,5 %, et l'oracle est calibré (probabilité moyenne égale au taux observé). Mesuré sur les étiquettes construites à partir de l'export (vue `v_label_panel`), le taux du panel d'évaluation du jeu principal est de 4,19 % (chapitre 7). Ces ordres de grandeur sont **plausibles mais pas calés sur des statistiques d'ArabSoft ou de l'Institut national de la statistique**, ce que nous signalons comme limite.

### 6.5.7 Tests du simulateur

Le simulateur est lui-même testé (pytest, [ml/sim/tests/](../../ml/sim/tests/)) :

- **contrat** : onze fichiers aux en-têtes exacts, valeurs conformes au contrat, aucun pointage un jour d'absence ou chômé, chronologie démission → préavis → sortie cohérente, fichiers de vérité terrain présents ;
- **hiérarchie** : aucun cycle, managers connus, équipes actives de 5 à 12 personnes ;
- **ordres de grandeur** : turnover, absentéisme, mix contractuel, taux d'injection, oracle calibré et discriminant, salaires, effets du calendrier ;
- **reproductibilité** : même graine, mêmes fichiers ; le scénario « charge » s'exécute ; le calendrier tunisien est correct.

### 6.5.8 Limites

Un résultat obtenu sur simulateur est une **preuve de méthode, pas une preuve de valeur métier**. Nous retenons quatre limites :

1. **Le mélange des mécanismes détermine la difficulté.** Le seuil d'insatisfaction est très prévisible, les offres externes le sont moyennement et les événements personnels ne le sont pas du tout. L'AUC globale dépend donc du scénario ; c'est pourquoi deux scénarios sont prévus.
2. **L'oracle fige l'organisation.** Dans ses continuations, les changements de manager suivent un taux moyen, et non les successions simulées.
3. **Le calage n'est pas encore validé** sur des statistiques réelles, ni par une revue de réalisme par des RH.
4. **Ce que le simulateur ne génère pas n'existe pas pour le modèle** : il ne contient ni conflit interpersonnel, ni projet de vie documenté, ni effet d'une politique RH. Un modèle entraîné sur le simulateur ne doit **jamais** scorer un vrai client : chez un client, le modèle doit être réentraîné et validé sur ses propres données.

## 6.6 Conclusion

Les données qui alimentent le module sont désormais maîtrisées de bout en bout. Le contrat d'export est fixé, les rejets sont motivés et le score de qualité bloque le calcul quand l'export est défaillant. Le calendrier est tunisien, et chaque donnée n'est utilisée qu'à partir du moment où la RH pouvait la connaître. Le simulateur fournit un banc d'essai réaliste dont la vérité est connue, sans circularité. Le chapitre suivant s'appuie sur ce socle pour construire, évaluer et expliquer l'estimation du risque de démission.

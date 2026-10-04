### T1. Table anomaly de data/app.db (pipeline --backtest, un appel)

| Type injecté | Événements | Détectés | Rappel | Délai médian (min–max) | Détections attribuées |
|---|---|---|---|---|---|
| Pic d'équipe | 31 | 27 | 87,1 % | 16 j (10–24) | 28 |
| Rotation d'équipe (réservé) | 25 | 18 | 72,0 % | 18 j (11–47) | 19 |
| Lundi/vendredi | 22 | 2 | 9,1 % | 80 j (69–90) | 2 |
| Ponts | 11 | 0 | 0,0 % | – | 0 |
| Dérive | 23 | 1 | 4,3 % | 156 j (156–156) | 1 |

Détections collectives : 64 ; vraies : 48 ; précision 75,0 % ; fausses : 16 soit 0,24 par mois ; dont 4 chevauchant la phase de départ simulée d'un membre.

### T2. Rejeu mensuel (mode worker, 66 appels)

| Type injecté | Événements | Détectés | Rappel | Délai médian (min–max) | Détections attribuées |
|---|---|---|---|---|---|
| Pic d'équipe | 31 | 25 | 80,6 % | 16 j (10–24) | 26 |
| Rotation d'équipe (réservé) | 25 | 16 | 64,0 % | 18 j (11–47) | 17 |
| Lundi/vendredi | 22 | 2 | 9,1 % | 80 j (69–90) | 2 |
| Ponts | 11 | 0 | 0,0 % | – | 0 |
| Dérive | 23 | 1 | 4,3 % | 156 j (156–156) | 1 |

Détections : 58 ; précision 75,9 % ; 0,21 fausses par mois.

### T3. Sensibilité au seuil z et au nombre k de semaines consécutives (batch, rappel par type)

| k | z | Détections | Précision | FP/mois | Pic | Rotation | Lundi/ven. | Ponts | Dérive | Délai pic | Délai rotation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2,5 | 1 463 | 12,9 % | 19,32 | 100 % | 100 % | 68 % | 91 % | 70 % | 6 | 6 |
| 1 | 3,0 | 927 | 16,3 % | 11,76 | 100 % | 100 % | 45 % | 91 % | 61 % | 9 | 9 |
| 1 | 3,5 | 643 | 18,8 % | 7,91 | 100 % | 100 % | 41 % | 64 % | 35 % | 9 | 9 |
| 1 | 4,0 | 427 | 23,0 % | 4,98 | 100 % | 96 % | 18 % | 45 % | 13 % | 9 | 11 |
| 2 | 2,5 | 190 | 38,9 % | 1,76 | 90 % | 100 % | 23 % | 18 % | 17 % | 13 | 16 |
| 2 | 3,0 | 95 | 62,1 % | 0,55 | 87 % | 96 % | 14 % | 0 % | 4 % | 16 | 16 |
| 2 | 3,5 | 64 | 75,0 % | 0,24 | 87 % | 72 % | 9 % | 0 % | 4 % | 16 | 18 |
| 2 | 4,0 | 47 | 87,2 % | 0,09 | 84 % | 48 % | 0 % | 0 % | 4 % | 16 | 16 |
| 3 | 2,5 | 59 | 91,5 % | 0,08 | 77 % | 96 % | 18 % | 0 % | 4 % | 22 | 23 |
| 3 | 3,0 | 44 | 95,5 % | 0,03 | 61 % | 88 % | 0 % | 0 % | 4 % | 23 | 23 |
| 3 | 3,5 | 32 | 96,9 % | 0,02 | 52 % | 60 % | 0 % | 0 % | 4 % | 23 | 25 |
| 3 | 4,0 | 24 | 100,0 % | 0,00 | 48 % | 36 % | 0 % | 0 % | 4 % | 23 | 25 |

### T3b. Types individuels : rappel observé / rappel par hasard (détections décalées de ±26 et ±52 semaines)

| k | z | Lundi/ven. | Ponts | Dérive |
|---|---|---|---|---|
| 1 | 2,5 | 68 % / 44 % | 91 % / 68 % | 70 % / 50 % |
| 1 | 3,0 | 45 % / 31 % | 91 % / 55 % | 61 % / 46 % |
| 1 | 3,5 | 41 % / 24 % | 64 % / 34 % | 35 % / 27 % |
| 1 | 4,0 | 18 % / 17 % | 45 % / 20 % | 13 % / 11 % |
| 2 | 2,5 | 23 % / 7 % | 18 % / 14 % | 17 % / 9 % |
| 2 | 3,0 | 14 % / 2 % | 0 % / 0 % | 4 % / 7 % |
| 2 | 3,5 | 9 % / 2 % | 0 % / 0 % | 4 % / 5 % |
| 2 | 4,0 | 0 % / 0 % | 0 % / 0 % | 4 % / 4 % |
| 3 | 2,5 | 18 % / 1 % | 0 % / 5 % | 4 % / 4 % |
| 3 | 3,0 | 0 % / 0 % | 0 % / 0 % | 4 % / 4 % |
| 3 | 3,5 | 0 % / 0 % | 0 % / 0 % | 4 % / 3 % |
| 3 | 4,0 | 0 % / 0 % | 0 % / 0 % | 4 % / 3 % |

### T4. PR-AUC en faisant varier le seuil du score robuste

| Type | Unités positives (semaine) | Prévalence | PR-AUC z semaine | PR-AUC min z sur 2 semaines | PR-AUC événement (k=2, z de 2 à 12, précision du type) |
|---|---|---|---|---|---|
| Pic d'équipe | 155 | 0,38 % | 0,357 | 0,317 | 0,850 |
| Rotation d'équipe (réservé) | 245 | 0,60 % | 0,120 | 0,341 | 0,687 |
| Lundi/vendredi | 285 | 0,70 % | 0,016 | 0,025 | 0,034 |
| Ponts | 331 | 0,81 % | 0,012 | 0,011 | 0,006 |
| Dérive | 436 | 1,07 % | 0,020 | 0,024 | 0,059 |

### T5. Ablation du facteur calendrier : fausses détections sans → avec facteur

| Scénario | Ramadan | Aïd | Pont | Férié | Séance unique | Semaine normale | Total FP | Détections |
|---|---|---|---|---|---|---|---|---|
| simule_batch_z3.5 | 0 → 0 | 1 → 1 | 1 → 1 | 2 → 2 | 3 → 3 | 12 → 12 | 16 → 16 | 63 → 64 |
| simule_mensuel_z3.5 | 0 → 0 | 1 → 0 | 1 → 1 | 3 → 2 | 4 → 4 | 10 → 10 | 15 → 14 | 59 → 58 |
| stress_A_batch_z3.5 | 1 → 0 | 1 → 0 | 1 → 1 | 2 → 1 | 4 → 3 | 12 → 12 | 17 → 15 | 64 → 62 |
| stress_B_batch_z3.5 | 1 → 0 | 1 → 0 | 1 → 1 | 2 → 2 | 4 → 4 | 12 → 12 | 17 → 16 | 64 → 63 |
| stress_B_batch_z3 | 11 → 1 | 7 → 2 | 5 → 4 | 19 → 9 | 15 → 6 | 23 → 23 | 46 → 36 | 107 → 93 |
| simule_batch_z3 | 4 → 1 | 4 → 2 | 4 → 4 | 12 → 9 | 7 → 5 | 23 → 23 | 38 → 36 | 97 → 95 |

### T6. Règles collectives alternatives (batch)

| Règle | Détections | Précision | FP/mois | Pic | Rotation | Délai pic | Délai rotation |
|---|---|---|---|---|---|---|---|
| nominal k=2 z>3,5 | 64 | 75,0 % | 0,24 | 87 % | 72 % | 16 | 18 |
| k=3 z>2,5 | 59 | 91,5 % | 0,08 | 77 % | 96 % | 22 | 23 |
| k=2 z>4 ou k=3 z>2,5 | 72 | 84,7 % | 0,17 | 84 % | 96 % | 16 | 19 |
| nominal k=2 z>3,5 (graine 2) | 64 | 73,4 % | 0,26 | 74 % | 83 % | 12 | 17 |
| k=3 z>2,5 (graine 2) | 51 | 76,5 % | 0,18 | 57 % | 88 % | 19 | 23 |
| k=2 z>4 ou k=3 z>2,5 (graine 2) | 69 | 75,4 % | 0,26 | 78 % | 88 % | 12 | 19 |

### T7. Signal individuel Bradford (66 calculs mensuels)

| Seuil | Signalés / mois | Salariés signalés au moins une fois | Précision | Lundi/ven. | Ponts | Dérive | Membres pic | Membres rotation | Délai médian LV / ponts / dérive (j) |
|---|---|---|---|---|---|---|---|---|---|
| 100 | 3,91 % | 455 (19,7 %) | 62,0 % | 91 % | 100 % | 87 % | 42 % | 53 % | 62 / 131 / 135 |
| 150 | 2,98 % | 353 (15,3 %) | 70,1 % | 86 % | 100 % | 83 % | 35 % | 48 % | 65 / 158 / 142 |
| 250 | 1,70 % | 222 (9,6 %) | 78,7 % | 77 % | 73 % | 74 % | 24 % | 33 % | 75 / 198 / 163 |
| 400 | 0,69 % | 103 (4,5 %) | 86,6 % | 59 % | 64 % | 39 % | 10 % | 16 % | 89 / 229 / 170 |
| 600 | 0,43 % | 60 (2,6 %) | 92,0 % | 50 % | 64 % | 30 % | 6 % | 9 % | 109 / 265 / 170 |

PR-AUC du facteur de Bradford (unités salarié x mois) :

| Type | Unités positives | Prévalence | PR-AUC |
|---|---|---|---|
| Pic d'équipe | 2 267 | 3,04 % | 0,243 |
| Rotation d'équipe (réservé) | 2 231 | 3,00 % | 0,343 |
| Lundi/vendredi | 299 | 0,41 % | 0,446 |
| Ponts | 207 | 0,29 % | 0,344 |
| Dérive | 323 | 0,45 % | 0,274 |

### T8. Prototypes de tests individuels typés (alpha 0,01, au moins 3 jours ciblés)

| Test | Fenêtre | Signalés / mois | Salariés | Précision | Lundi/ven. | Ponts | Dérive | Délai LV / ponts (j) |
|---|---|---|---|---|---|---|---|---|
| lundi_vendredi | 3 mois | 0,05 % | 18 | 100,0 % | 77 % | 0 % | 0 % | 75 / – |
| ponts | 6 mois | 0,17 % | 27 | 74,2 % | 9 % | 100 % | 0 % | 135 / 103 |
| lundi_vendredi (graine 2) | 3 mois | 0,08 % | 26 | 90,5 % | 79 % | 0 % | 0 % | 69 / – |
| ponts (graine 2) | 6 mois | 0,19 % | 26 | 78,6 % | 3 % | 94 % | 5 % | 69 / 111 |

### T9. Défauts injectés et règles de l'import (rejeu sans plafond de détail)

| Fichier | Défaut injecté | Règle attendue | Injectés | Signalés par la règle | Taux | Sévérité |
|---|---|---|---|---|---|---|
| absences.csv | ABSENCE_FIN_AVANT_DEBUT | FIN_AVANT_DEBUT | 642 | 642 | 100,0 % | REJET |
| absences.csv | DOUBLON | DOUBLON | 445 | 445 | 100,0 % | REJET |
| absences.csv | MATRICULE_INCONNU | MATRICULE_INCONNU | 243 | 243 | 100,0 % | REJET |
| attendance.csv | DOUBLON | POINTAGE_DUPLIQUE | 7 739 | 7 739 | 100,0 % | REJET |
| attendance.csv | MATRICULE_INCONNU | MATRICULE_INCONNU | 4 605 | 4 605 | 100,0 % | REJET |
| attendance.csv | POINTAGE_SANS_SORTIE | POINTAGE_SANS_SORTIE | 17 085 | 17 085 | 100,0 % | AVERTISSEMENT |
| payroll.csv | DOUBLON | DOUBLON | 650 | 650 | 100,0 % | REJET |
| payroll.csv | MATRICULE_INCONNU | MATRICULE_INCONNU | 425 | 425 | 100,0 % | REJET |
| payroll.csv | SALAIRE_SOUS_SMIG | SALAIRE_SOUS_SMIG | 699 | 699 | 100,0 % | REJET |

Paie incomplète : 17 salariés en poste sans paie du dernier mois, causes : {'SALAIRE_SOUS_SMIG': 11, 'MATRICULE_INCONNU': 6}. Import de l'export nettoyé : statut OK, score 1, 0 rejet. Règle de cohérence prototypée brut > 2,0 x base : 699/699 défauts SMIG, 0 ligne saine signalée sur 84 743 (ratio sain max 1,328).

### T10. Perte de score qualité par règle (points de pourcentage)

| Règle | Points perdus |
|---|---|
| absences.csv:FIN_AVANT_DEBUT | 0,093 |
| payroll.csv:SALAIRE_SOUS_SMIG | 0,081 |
| payroll.csv:DOUBLON | 0,075 |
| absences.csv:DOUBLON | 0,064 |
| attendance.csv:POINTAGE_DUPLIQUE | 0,050 |
| payroll.csv:MATRICULE_INCONNU | 0,049 |
| absences.csv:MATRICULE_INCONNU | 0,035 |
| attendance.csv:MATRICULE_INCONNU | 0,030 |
| complétude paie (PAIE_INCOMPLETE) | 1,421 |

### T11. Graine 2 (mixte_medium_s2, hors échantillon)

Réplication Python de la table : {'both': 64, 'only_first': 0, 'only_second': 0}. Collectif : 64 détections, précision 73,4 %, 0,26 FP/mois. Bradford 250 : 1,58 % signalés par mois, précision 82,7 %.

| Type | Événements | Rappel collectif (table) | Rappel Bradford 250 |
|---|---|---|---|
| Pic d'équipe | 23 | 73,9 % | 21,5 % |
| Rotation d'équipe (réservé) | 24 | 83,3 % | 36,4 % |
| Lundi/vendredi | 29 | 0,0 % | 82,8 % |
| Ponts | 16 | 6,2 % | 87,5 % |
| Dérive | 22 | 0,0 % | 59,1 % |

Qualité graine 2 : score 0,9894, lignes signalées sans défaut : 0 groupe(s), paie incomplète : {'missing': 7, 'by_cause': {'SALAIRE_SOUS_SMIG': 6, 'MATRICULE_INCONNU': 1}} ; brut > 2 x base : 693/693 défauts SMIG, 0 ligne saine signalée.

| Fichier | Défaut | Injectés | Signalés | Taux |
|---|---|---|---|---|
| absences.csv | ABSENCE_FIN_AVANT_DEBUT | 726 | 726 | 100,00 % |
| absences.csv | DOUBLON | 402 | 402 | 100,00 % |
| absences.csv | MATRICULE_INCONNU | 294 | 294 | 100,00 % |
| attendance.csv | DOUBLON | 7 714 | 7 714 | 100,00 % |
| attendance.csv | MATRICULE_INCONNU | 4 620 | 4 620 | 100,00 % |
| attendance.csv | POINTAGE_SANS_SORTIE | 16 959 | 16 959 | 100,00 % |
| payroll.csv | DOUBLON | 598 | 598 | 100,00 % |
| payroll.csv | MATRICULE_INCONNU | 426 | 426 | 100,00 % |
| payroll.csv | SALAIRE_SOUS_SMIG | 693 | 692 | 99,86 % |

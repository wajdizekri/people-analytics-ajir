# ADR-006 — Niveaux de risque fixés par la capacité RH (plafond, ex-æquo)

- **Statut** : acceptée
- **Date** : 28/09/2026 (règle des ex-æquo précisée le 29/09/2026)
- **Références** : cahier des charges v2 § 6 « Décision » ; `rankAndLevel` dans [src/lib/scoring/score.ts](../../src/lib/scoring/score.ts) ; [src/lib/settings.ts](../../src/lib/settings.ts)

## Contexte

Avec environ 3,5 % de démissions à 6 mois, un seuil fixe de probabilité laisserait la classe « Élevé » presque vide (ou pleine si le seuil est bas), et le nombre de salariés signalés varierait d'un mois à l'autre sans rapport avec la capacité de la RH à mener des entretiens. Le score à règles B0 produit des points entiers : de nombreux salariés sont ex-æquo, et départager par l'identifiant rendrait le niveau dépendant du matricule.

## Décision

Chaque mois, sur la population scorée (n salariés), triée par score décroissant :

- **k = max(1, ⌊n × `capacity_rate`⌋)**, `capacity_rate` = 2 % par défaut, réglable par l'administrateur (0,5 % à 20 %). Partie entière (et non arrondi, bug B1 corrigé le 30/09/2026) : dès que la capacité atteint un entretien, k ne la dépasse jamais (75 scorés à 2 % → 1, et non 2). En dessous (moins de 50 scorés à 2 %), k = 1 : la RH garde une priorité par mois plutôt qu'aucune ; ce cas ne concerne que de très petites populations.
- **ÉLEVÉ** : rang ≤ k **et** score strictement supérieur au score du (k+1)-ième. La capacité est un **plafond** : des ex-æquo qui franchiraient la k-ième place restent **tous** hors ÉLEVÉ, jamais départagés par l'identifiant. Avec B0, un score nul n'est jamais ÉLEVÉ.
- **MOYEN** : hors ÉLEVÉ et **lift ≥ `medium_lift`** (2 par défaut), avec `lift = score / moyenne des scores du mois` ; avec B0, score strictement positif exigé.
- **FAIBLE** sinon.
- Le **rang** reste un ordre total (ex-æquo ordonnés par identifiant) pour l'affichage et la pagination ; il ne sert jamais à fixer le niveau.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Seuil de probabilité fixe (ex. 0,28 issu d'un coût-bénéfice) | Classe ÉLEVÉ vide ou instable ; l'analyse coût-bénéfice reste une information de la page Transparence |
| Top-k strict avec départage par identifiant | Niveau arbitraire pour les ex-æquo, fréquent avec les points entiers de B0 |
| Déciles de score | Pas de lien avec la capacité d'entretiens |
| k trimestriel et exclusion des salariés vus en entretien depuis 90 jours (plan détaillé) | Non implémenté ; k est mensuel et ne tient pas compte des entretiens réalisés |

## Conséquences

- Le nombre d'ÉLEVÉ est borné et prévisible (20 sur 987 scorés dans la base de démonstration au 31/08/2026) ; il peut être inférieur à k en cas d'ex-æquo à la frontière.
- La répartition FAIBLE/MOYEN/ÉLEVÉ est en partie fixée par construction ; le tableau de bord la montre par département avec la part non évaluée, et le lift moyen (RH, modèle LOGREG seulement).
- Le paramètre s'applique au **prochain** calcul ; un changement est audité (`settings.update`).
- Le what-if réutilise exactement `rankAndLevel` pour replacer le salarié simulé dans la population du mois.

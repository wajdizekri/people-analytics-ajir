# Comparaison appariée des collaborateurs suivis et non suivis (estimation non causale)

Chantier « 5 IA », agent CAUSAL, 04/10/2026. Écran : /interventions (RH seulement), section « Comparaison avec des collaborateurs similaires (estimation non causale) ».

> **Statut** : livré sur la branche `ia/causal`. Chiffres produits par les commandes du § 8 (golden Python, `npx vitest run tests/ia-causal tests/insights`, validation semi-synthétique sur `mixte_medium_s1`).

## 1. Question et réponse courte

L'avant / après de /interventions ne compare les collaborateurs suivis à personne : un niveau Élevé redescend souvent de lui-même le mois suivant (retour vers la moyenne), et la RH choisit qui suivre. La section ajoutée compare, **par type d'action**, chaque collaborateur suivi à un collaborateur **non suivi au profil proche, évalué le même mois**, et affiche l'écart sur deux indicateurs avec une fourchette à 95 %.

C'est une **estimation non causale, sous hypothèses** : elle tient compte des variables enregistrées dans AJIR, jamais des raisons invisibles du choix des personnes suivies. Aucun nombre de départs n'en est déduit, aucune décision n'en découle automatiquement.

Validation semi-synthétique sur le simulateur (§ 5.3) : quand le choix des suivis repose sur des variables observées, l'estimation est sans biais notable (couverture de 93 %) et neutralise le retour vers la moyenne de l'avant / après (20 % de « niveaux en baisse » sans aucun effet, écart apparié proche de zéro). Quand il repose sur une variable non observée, l'écart change de signe sans que les diagnostics le signalent. Avec une centaine de suivis, un effet de 1 à 2 points sur la démission reste indétectable.

Sur la base de démonstration (`mixte_medium_s1`), une seule action est enregistrée : chaque type affiche « Effectif insuffisant pour comparer ».

## 2. Livrables

| Fichier | Rôle |
|---|---|
| [src/lib/matching/](../src/lib/matching/) | Bibliothèque pure (sans base) : régression logistique ridge, appariement, différences standardisées, bootstrap, gardes |
| [src/lib/dal/intervention-impact.ts](../src/lib/dal/intervention-impact.ts) | DAL `getMatchedComparison(ctx)` : RH seulement, construit les unités as-of, renvoie des agrégats |
| [src/app/(app)/interventions/matched-comparison.tsx](../src/app/(app)/interventions/matched-comparison.tsx) | Section de la page : écart, fourchette, équilibre en mots, « Ce que ce chiffre ne dit pas », « Voir les données » |
| [src/app/(app)/interventions/page.tsx](../src/app/(app)/interventions/page.tsx) | Branchement de la section après « Ce qui change après l'action » ; phrase ajoutée à l'avertissement |
| [src/lib/dal/interventions.ts](../src/lib/dal/interventions.ts) | `ACTIONS_SQL` exporté (même définition des actions réalisées que la page) |
| [ml/matching/reference.py](../ml/matching/reference.py) | Référence Python (scikit-learn + appariement réimplémenté) : golden rejoué par les tests |
| [ml/matching/validate.ts](../ml/matching/validate.ts) | Validation semi-synthétique sur le simulateur, avec le code de production |
| [tests/ia-causal/](../tests/ia-causal/) | Effet connu, équilibre, caliper, gardes, rôles, opposition, rendu et vocabulaire |

## 3. Méthode

**Unités.** Un suivi = la **première** action réalisée d'un type donné pour un collaborateur (intervention enregistrée ou recommandation marquée « réalisée », même requête que la page), hors collaborateurs opposés au traitement prédictif. Sa date « as of » t est la **fin du mois précédant l'action** : variables de `feature_snapshot` calculées avec la règle de visibilité à la date de saisie (ADR-005), niveau de risque du dernier calcul publié au plus tard à t (règle « avant » de la page). Aucune information postérieure à t n'entre dans le score de propension.

**Témoins (ensemble à risque).** Collaborateurs évalués au même t (donc éligibles au sens d'ADR-004), sans **aucune** action réalisée, tous types confondus, dans les 6 mois avant ou après t. Un témoin n'est associé à un suivi que s'il est encore présent et sans démission à la date de l'action de ce suivi. Un suivi déjà sorti ou démissionnaire à la date de l'action est écarté.

**Variables.** Les 25 variables du modèle de risque (`shared/features.json`, aucune donnée de santé, aucun attribut sensible) et deux indicatrices « risque élevé » et « risque moyen » au dernier calcul : les recommandations visent ces niveaux, c'est le premier facteur de sélection.

**Score de propension.** Régression logistique ridge « suivi ou non », variables standardisées (écart-type de population), λ = 1 sur les coefficients, intercept non pénalisé, Newton-Raphson avec réduction du pas. La pénalité garantit la convergence avec peu de suivis ou des groupes séparés.

**Appariement.** 1:1 au plus proche voisin sur le logit du score, **exact sur le mois t**, caliper = 0,2 écart-type du logit (Austin, 2011), **sans remise** (un témoin sert une fois), suivis traités du score le plus élevé au plus faible, égalités départagées par une clé stable. Un suivi sans voisin dans le caliper reste sans comparaison (il compte dans la part appariée).

**Indicateurs.**
- *Démission dans les 6 mois* : `y6` de `v_label_panel` (démission ou abandon dans ]t, t + 6 mois], ADR-004), seulement si le suivi est complet. Avec la règle d'ensemble à risque, l'événement compté est postérieur à la date de l'action, des deux côtés.
- *Niveau de risque en baisse 3 mois après* : niveau au calcul publié dans les 3 mois suivant le mois de l'action plus bas qu'au calcul précédant l'action (même lecture que l'avant / après). Paires mesurées seulement si les deux niveaux existent des deux côtés.

**Écart et fourchette.** Écart = moyenne des différences suivi − témoin sur les paires mesurées (part, affichée en points). Fourchette percentile à 95 % par **bootstrap des paires** (2 000 tirages, Austin et Small, 2014), graine fixe : la page affiche toujours la même fourchette. L'écart « sans appariement » (suivis contre tous les candidats du même mois) figure dans « Voir les données » pour montrer ce que l'appariement corrige.

**Diagnostics.** Différences standardisées (DS) avant et après appariement pour chaque variable, dénominateur √((s²suivis + s²témoins)/2) calculé avant appariement ; part des suivis appariés ; support commun (part des suivis dont le score est dans l'étendue des témoins du même mois). Verdict affiché en mots :
- « Groupes comparables » : |DS| < 0,25 sur **toutes** les variables après appariement (Rubin, 2001 ; Stuart, 2010) et au moins 80 % des suivis appariés ;
- « Comparaison fragile » sinon, avec la raison (variables encore très déséquilibrées, nommées ; part appariée).

Le tableau « Voir l'équilibre des groupes » donne toutes les DS ; sous 0,1, l'écart est négligeable. Le seuil de 0,1 sur la plus forte DS, prévu au départ, a été **relevé à 0,25 après lecture de la validation** (§ 5.3) : avec 27 variables et une centaine de paires, le hasard seul porte ce maximum vers 0,2, et la règle à 0,1 classait 100 % des réplications en « fragile », y compris celles sans biais.

**Gardes.**
- Moins de **20 suivis comparables** pour un type : « Effectif insuffisant pour comparer », aucun chiffre.
- Moins de **20 paires mesurées** pour un indicateur : aucun chiffre pour cet indicateur (ni écart, ni taux, ni écart brut).
- **Rôles** : même matrice que la page (RH seulement, `ensureRole` audité `interventions.view` en cas de refus) ; le manager et l'ADMIN n'y ont pas accès. Aucun nom, identifiant, score de propension ni paire ne sort de la DAL.
- **Opposition** : collaborateurs opposés exclus des suivis et des témoins.
- Écart en bleu neutre, jamais en vert « favorable » ; aucun nombre de départs, aucune multiplication par l'effectif.

### Choix « TypeScript à la volée » plutôt que « coefficients Python en JSON » (ADR-002)

ADR-002 réserve Python à l'entraînement **du modèle prédictif** exposé aux utilisateurs, exécuté ensuite en TypeScript. Le score de propension n'est pas un modèle de prédiction : c'est un intermédiaire descriptif, propre à l'ensemble des actions déjà enregistrées, jamais affiché ni stocké. Il doit être réestimé dès qu'une action est marquée « réalisée » : des coefficients figés hors ligne seraient faux le jour suivant. L'estimation porte sur 27 variables et au plus quelques dizaines de milliers de lignes mois-personne : Newton-Raphson converge en quelques itérations, sans dépendance. Le risque de divergence TypeScript ↔ Python visé par ADR-002 est traité de la même façon : un golden produit par scikit-learn (`ml/matching/reference.py`) est rejoué par `tests/ia-causal/logistic.test.ts` (coefficients et caliper à 1e-6, mêmes paires, mêmes DS).

## 4. Hypothèses (écrites à côté du chiffre dans l'écran)

1. **Pas de facteur caché** : à variables observées égales, suivis et non-suivis avaient le même risque. Fausse si la RH choisit sur des informations absentes d'AJIR (entretien informel, offre externe connue, motivation).
2. **Support commun** : pour chaque suivi, des non-suivis comparables existent le même mois (contrôlé par la part appariée et le support commun).
3. **Pas d'interférence** : l'action sur un collaborateur ne change pas l'issue de ses collègues témoins.
4. **Action unique** : les autres actions concomitantes sont écartées des témoins, mais pas des suivis.
5. **Issue bien mesurée** : motif de sortie correctement codé, préavis d'un mois par défaut (ADR-004).

## 5. Validation

### 5.1 Fidélité TypeScript ↔ Python

Golden de 900 unités, 3 strates, 5 variables, 122 suivis (`tests/ia-causal/fixtures/matching-golden.json`, scikit-learn `newton-cholesky`, contrôlé contre un Newton numpy à 3,3 × 10⁻¹³ près). Le TypeScript retrouve intercept, coefficients et caliper à moins de 10⁻⁶ (relatif), **les mêmes 108 paires** et les mêmes DS (|DS| max 0,856 avant, 0,089 après).

### 5.2 Données synthétiques à effet connu (`tests/ia-causal/matching.test.ts`)

Effet additif constant sur la probabilité de l'issue (−10 points), sélection confondue par une variable qui pousse aussi l'issue :
- la comparaison brute est biaisée (écart brut − effet > 5 points), l'estimation appariée retrouve l'effet à moins de 5 points ;
- DS maximale > 0,5 avant, < 0,1 après ;
- couverture de la fourchette à 95 % ≥ 80 % sur 30 réplications, fourchette excluant zéro dans au plus 20 % des réplications sous effet nul ;
- caliper, absence de remise, appariement exact par mois, exclusion des témoins sortis avant la date de l'action, déterminisme.

### 5.3 Simulateur (ADR-010)

**Le simulateur ne modélise pas l'effet des interventions RH** : `ml/sim` génère engagement, offres externes, seuils d'insatisfaction et événements personnels, mais aucune action RH ni effet d'action. Une comparaison « estimation appariée contre effet simulé » directe est donc impossible.

Validation **semi-synthétique** à la place (`ml/matching/validate.ts`, code de production) : on garde les variables, niveaux de risque et démissions réels de `mixte_medium_s1` (mois t de mars 2024 à février 2026, suivi de 6 mois complet), on tire des suivis fictifs selon une règle connue, puis on retire une part π = 0,4 des démissions des suivis (effet injecté connu, réalisé sur les suivis appariés). Quatre scénarios, 40 réplications chacun :

| Scénario | Règle de sélection | Effet injecté | Suivis visés |
|---|---|---|---|
| OBS_EFFET | niveau Élevé / Moyen, heures sup, compa-ratio (toutes observées) | π = 0,4 | 150 |
| OBS_NUL | idem | aucun | 150 |
| OBS_PETIT | idem | π = 0,4 | 40 |
| LATENT | niveau + engagement latent du simulateur (**non observé**) | π = 0,4 | 150 |

Panel : 23 669 lignes salarié × mois, 1 273 salariés, mois t de mars 2024 à février 2026 ; 40 réplications par scénario (792 s au total). Résultats bruts : [ml/matching/results/validation-mixte_medium_s1.json](../ml/matching/results/validation-mixte_medium_s1.json). Écarts en points de pourcentage, moyennes sur les réplications.

**Démission dans les 6 mois** (effet réalisé = part des démissions retirées chez les suivis appariés) :

| Scénario | Suivis | Effet réalisé | Estimation | Biais | RMSE | Couverture 95 % | Largeur | Exclut 0 | Biais sans appariement | Part appariée | DS max après | « Groupes comparables » |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OBS_EFFET | 131 (110–151) | −1,4 | −1,5 | −0,1 | 2,1 | 93 % | 8,5 | 5 % | −0,3 | 98 % | 0,20 | 35 / 40 |
| OBS_NUL | 129 | 0,0 | +0,2 | +0,2 | 2,3 | 93 % | 8,9 | 7 % | −0,5 | 98 % | 0,21 | 34 / 40 |
| OBS_PETIT | 38 (27–50) | −1,5 | −1,2 | +0,3 | 5,1 | 80 % | 13,5 | 5 % | −0,1 | 97 % | 0,41 | 1 / 40 |
| LATENT | 124 | −4,9 | **+3,9** | **+8,8** | 9,4 | **23 %** | 11,9 | 20 % | +9,0 | 98 % | 0,21 | 35 / 40 |

**Niveau de risque en baisse 3 mois après** (aucun effet injecté, vérité = 0) :

| Scénario | Suivis « en baisse » (lecture avant / après) | Écart apparié | Fourchette contenant 0 |
|---|---|---|---|
| OBS_EFFET | 19,7 % | −0,5 | 97 % |
| OBS_NUL | 20,8 % | +0,7 | 88 % |
| OBS_PETIT | 21,1 % | −1,2 | 95 % |
| LATENT | 18,8 % | −1,8 | 95 % |

Lecture :
- **Sélection sur variables observées** : estimation sans biais notable (≤ 0,3 point), couverture de 93 %, proche des 95 % annoncés. Mais l'effet injecté (−1,4 point) est bien plus petit que la demi-largeur de la fourchette (environ 4 points) : la fourchette exclut zéro dans 5 % des réplications, autant que sous effet nul (7 %). Avec 130 suivis et un taux de démission de quelques pour cent, un effet de cet ordre est indétectable.
- **Retour vers la moyenne** : sans aucun effet, 19 à 21 % des suivis voient leur niveau baisser dans la lecture avant / après ; l'écart apparié reste proche de zéro (−1,8 à +0,7 point). C'est l'apport principal de la comparaison appariée sur ce simulateur. Pour la démission, la comparaison brute y est déjà peu biaisée (−0,5 à −0,1 point) : les variables de sélection prédisent faiblement la démission à 6 mois.
- **Petits effectifs** (≈ 40 suivis) : couverture de 80 % seulement, RMSE de 5 points, DS max de 0,41 ; le verdict affiche « comparaison fragile » dans 39 réplications sur 40. Le seuil de 20 suivis est un minimum, pas une garantie.
- **Confusion non observée** (LATENT) : l'estimation change de signe (+3,9 points pour un effet réel de −4,9) et la couverture tombe à 23 %, alors que le verdict affiche « groupes comparables » dans 35 réplications sur 40. Les diagnostics d'équilibre ne voient que les variables mesurées : c'est la première ligne de l'encadré « Ce que ce chiffre ne dit pas ».

Verdict recalculé à partir du fichier de résultats avec la règle retenue (DS max < 0,25 et part appariée ≥ 80 %) ; avec la règle initiale à 0,1, aucune réplication n'était « comparable ».

## 6. Diagnostics sur la base de démonstration

Une intervention (entretien du 02/10/2026, postérieure à la fin des données) : aucun type n'atteint 20 suivis comparables. La section affiche « Effectif insuffisant pour comparer » pour chaque type, sans chiffre.

## 7. Limites

- **Non causal** : une confusion non observée peut inverser le signe de l'écart sans alerter les diagnostics (scénario LATENT, § 5.3) ; la DS ne contrôle que les variables mesurées.
- **Puissance** : avec 130 suivis, un écart de 1 à 2 points sur la démission reste dans la fourchette (largeur ≈ 9 points) ; avec 40 suivis, la couverture réelle tombe à 80 %.
- **Seuil du verdict choisi après la validation** (0,1 → 0,25, § 3) : degré de liberté du chercheur, à reconsidérer sur des données réelles.
- **Appariement glouton sans remise** : dépend de l'ordre des suivis ; les suivis les plus atypiques peuvent rester sans paire, l'écart porte alors sur les suivis appariés seulement.
- **Bootstrap des paires** : ignore l'incertitude de l'estimation du score de propension et les dépendances entre collègues d'une même équipe ; la fourchette est probablement un peu trop étroite.
- **Indicateur « niveau en baisse »** : le niveau est un rang relatif (capacité RH, ADR-006) ; les sortants n'ont pas de niveau « après » et sortent de cet indicateur.
- **Première action seulement** par type et par collaborateur ; actions répétées non analysées.
- **Simulateur** : sans action RH, la validation est semi-synthétique ; elle prouve la méthode, pas un effet réel.

## 8. Commandes

```
python ml/matching/reference.py                                    # golden tests/ia-causal/fixtures/matching-golden.json
npx vitest run tests/ia-causal tests/insights --maxWorkers=1
npx tsx ml/matching/validate.ts --db data/app.db --sim ../../people-analytics/data/sim/mixte_medium_s1 --reps 40
npx eslint src/lib/matching src/lib/dal/intervention-impact.ts "src/app/(app)/interventions" ml/matching/validate.ts
npx tsc --noEmit
```

Aucun modèle à enregistrer ni à promouvoir : le score de propension est réestimé à chaque affichage.

## 9. Alternatives écartées

| Alternative | Raison |
|---|---|
| Pondération inverse par le score (IPW) | Poids extrêmes avec peu de suivis ; moins lisible qu'une paire « collaborateur similaire » |
| Appariement avec remise | Variance du bootstrap naïf incorrecte (Abadie et Imbens, 2008) ; témoins réutilisés difficiles à expliquer |
| Coefficients estimés hors ligne en Python | Périmés dès la prochaine action réalisée (§ 3) |
| Comparateur actif (recommandations rejetées) | Groupes plus homogènes mais effectifs très faibles ; le motif du rejet est lui-même un facteur de confusion |
| Modèle d'uplift | Exige une affectation en partie contrôlée ; reste une perspective (rapport, chapitre 10) |

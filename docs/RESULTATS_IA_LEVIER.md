# Résultats de l'IA « leviers les plus efficaces »

Sur la fiche collaborateur (RH seulement), le panneau « et si ? » propose un bouton **« Trouver les leviers les plus
efficaces »**. Il cherche les 2 ou 3 plus petites combinaisons de leviers qui feraient passer le niveau de risque sous le
niveau actuel (Élevé → Moyen ou Faible, Moyen → Faible), avec le modèle du calcul publié et les seuils en vigueur
(`capacity_rate`, `medium_lift`). Chaque piste s'affiche en carte (leviers, estimation avant → après, niveau atteint,
hausse de salaire chargée) avec un bouton « Appliquer à la simulation » qui pré-remplit les leviers ; la RH relit puis lance
elle-même la simulation. Rien n'est enregistré hormis l'audit.

Code : [src/lib/whatif/search.ts](../src/lib/whatif/search.ts) (recherche), [src/lib/whatif/index.ts](../src/lib/whatif/index.ts)
(moteur what-if, inchangé dans son calcul), [src/lib/dal/whatif.ts](../src/lib/dal/whatif.ts) (`searchWhatIfLevers`),
route `POST /api/employees/[id]/what-if/search`, panneau [what-if-panel.tsx](../src/components/pilotage/what-if-panel.tsx).
Tests : `tests/ia-levier/` (35 tests).

## 1. Méthode

- **Grille discrète** dans les bornes du what-if (`LEVER_LIMITS`) : salaire de 0 à 30 % par pas de 2,5 % (13 valeurs),
  heures sup retirées de 0 à 40 h par mois par pas de 10 h (5), formation de 0 à 200 h par pas de 20 h (11), promotion
  oui/non. 13 × 5 × 11 × 2 − 1 = **1 429 combinaisons**. Un levier inapplicable (salaire de base invisible, grade
  maximal ou inconnu) est retiré de la grille et signalé en note.
- **Coût normalisé (« ampleur »)** : `salaire / 30 % + heures sup / 40 h + formation / 200 h + 1 si promotion`. Chaque
  levier poussé à sa limite vaut 1 ; une promotion compte comme un pas fort (1). À ampleur égale : moins de leviers
  d'abord, puis moins de salaire (ordre total, déterministe).
- **Sélection** : la grille est parcourue par ampleur croissante ; la première combinaison qui fait baisser le niveau
  est la plus petite. Une combinaison qui utilise chaque levier au moins autant qu'une piste déjà retenue (dominée) est
  écartée sans calcul. Résultat : les 3 plus petites pistes non dominées (moins s'il n'y en a pas 3).
- **Aucune combinaison** : message « Aucune combinaison dans les limites de la simulation ne fait baisser le niveau ;
  voir les facteurs associés », avec un lien vers la zone Estimation. Niveau déjà Faible : pas de recherche.

## 2. Réutilisation du moteur et calcul borné

Pas de second modèle : les variables viennent d'`applyLevers` + `computeMonth` (mêmes fonctions que le batch), le
score de `predict` et le niveau de la règle de `rankAndLevel` (ADR-006).

- Les sources du salarié sont chargées **une fois** ; chaque essai travaille sur une copie des seules sources
  modifiées (`forkDataset` : carrière, paie, formations, pointages du salarié). `simulate` passe désormais par le même
  chemin (`loadSimulationBase` + `simulateFrom`), sans changement de résultat (tests what-if inchangés et verts).
- **Composition par famille de leviers** : les leviers agissent sur des sources disjointes (paie et carrière ;
  pointages ; formations) et chaque variable ne lit qu'une de ces sources. Les variables d'une combinaison se composent
  à partir de 39 recalculs au plus (25 salaire × promotion, 4 heures sup, 10 formation) au lieu de 1 429.
- **Placement accéléré** : scores des autres salariés calculés une fois, position par dichotomie, même départage et
  même ordre d'addition pour la moyenne que `rankAndLevel` (résultat identique au bit près, test de propriété).
- **Vérification** : chaque piste retenue est recalculée en entier par `simulateFrom` (au plus 6) ; les chiffres de la
  carte sont donc exactement ceux que donnera la simulation.
- Plafond : 1 + 39 recalculs des variables, 1 429 prédictions, 6 simulations complètes. Aucun appel réseau.

## 3. Temps mesuré (tests, poste de développement, 04/10/2026)

| Cas | Collaborateurs évalués | Durée | Recalculs | Combinaisons évaluées |
|---|---|---|---|---|
| Scénario de référence (B0), salarié F | 8 | 24 ms | 42 | 485 / 1 429 |
| Même scénario + 2 000 salariés (paie sur 25 mois) | 2 008 | 818 ms | 43 | 53 / 1 429 (3 pistes) |

Budget vérifié par les tests : moins de 10 s et au plus 46 recalculs. Sur la base de démonstration (987 évalués,
2 450 salariés), l'ordre de grandeur attendu est celui de la seconde ligne ; non mesuré dans l'application pendant le
chantier (serveur réservé à la vérification finale).

## 4. Validation

- **Oracle exhaustif** : pour chaque salarié testé (B0 : Élevé avec et sans piste ; LOGREG : tous les Élevé et Moyen),
  les 1 429 combinaisons sont recalculées en entier ; variables composées = variables recalculées, placement accéléré =
  `rankAndLevel`, pistes = plus petites combinaisons suffisantes non dominées de l'oracle.
- Salarié F (B0, 4 points, Élevé) : pistes « promotion seule » et « +15 % de salaire et −20 h sup », toutes deux au
  niveau Faible ; un pas de moins sur l'une ou l'autre ne suffit plus. Salarié A (absences et formation obligatoire en
  retard, hors leviers) : aucune combinaison.
- « Appliquer à la simulation » : le what-if lancé avec les leviers d'une piste rend exactement la même estimation, le
  même niveau, les mêmes changements appliqués et le même coût que la carte.
- Mêmes règles que le what-if : RH seulement (manager et admin 403 audités `REFUSE`, anonyme 401), 404, 409
  `NON_EVALUE` (message existant), 409 `OPPOSITION` audité avec motif, 400 (zod strict, JSON illisible), 422 audité
  `ECHEC`. Audit `whatif.search` (statut, nombre de pistes, durée) ; libellé ajouté au journal.

## 5. Limites

- Grille discrète : une combinaison plus fine (par exemple +13 %) n'est pas explorée ; la piste « +15 % » peut donc
  dépasser le strict nécessaire de moins d'un pas.
- Le coût normalisé est une convention : il ne mesure ni le coût financier (affiché à part, salaire seulement, hors
  formation) ni la faisabilité (budget, poste disponible pour une promotion, charge de l'équipe si l'on retire des
  heures sup).
- Avec la régression logistique, la monotonie n'est pas garantie (retirer des heures sup peut faire monter
  l'estimation) : la recherche évalue chaque combinaison sans la supposer.
- Le niveau dépend de la population du mois et de la capacité RH : une piste peut ne plus suffire au calcul suivant.
- La composition repose sur l'indépendance des sources par levier, vraie dans `src/lib/features/compute.ts` aujourd'hui ;
  une nouvelle variable croisant deux sources la casserait. L'oracle exhaustif des tests le détecterait, et les pistes
  affichées restent exactes (recalcul complet), au pire incomplètes.
- Le journal du droit d'accès (`src/lib/privacy/export.ts`, hors périmètre) affiche `whatif.search` sans libellé
  français : une ligne à ajouter dans `ACTION_LABEL` après fusion.

## 6. Cadrage éthique

- Texte visible au-dessus du bouton : « Pistes à discuter lors d'un échange, pas une décision. Estimation du modèle,
  non causale. » ; bandeau non causal du what-if conservé ; vocabulaire « facteurs associés », aucun chiffre de départs
  évités.
- Aucune décision automatique : la recherche n'écrit rien, ne crée ni recommandation ni alerte ; « Appliquer » ne fait
  que pré-remplir le formulaire de simulation.
- Leviers d'action seulement (salaire, heures sup, formation, promotion) : aucun attribut sensible, aucune donnée de
  santé, rien côté manager (panneau et route réservés à la RH), opposition au traitement respectée (409).

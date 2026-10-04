# Clarté et cohérence rédactionnelle

Date : 30/09/2026. Public visé : responsables RH et managers non spécialistes des données, administrateur de l'outil. Référence des définitions : [DICTIONNAIRE.md](../DICTIONNAIRE.md) et [shared/features.json](../../shared/features.json). Les textes d'aide eux-mêmes vivent dans [src/lib/help/](../../src/lib/help/) : une seule définition par concept, reprise par les bulles « ? » et par le centre d'aide.

## 1. Ton

- Neutre et professionnel. Vouvoiement. Pas d'impératif sec pour une information (« Voir la liste » convient pour un lien, pas pour une explication).
- Phrases courtes : une idée par phrase, 25 mots au plus. Une liste de trois repères plutôt qu'un paragraphe.
- Aucun terme technique sans explication : soit on le remplace (tableau § 2), soit on l'accompagne d'une bulle « ? » (`TermTip`).
- Le risque est une **estimation**, jamais une certitude ni une prédiction de décision. Les facteurs sont **associés**, jamais des causes. Aucune mention de « départ évité ».
- Pas de jugement sur une personne : « classé au niveau Élevé », pas « salarié à risque » ni « démissionnaire probable ».
- Majuscule initiale aux libellés de niveau (Élevé, Moyen, Faible, Non évalué) et aux noms d'écran (Santé des données, Mon compte). Pas de majuscule aux noms communs dans une phrase.

## 2. Vocabulaire de référence

| Terme retenu | À éviter | Remarque |
|---|---|---|
| collaborateur | salarié, employé, agent | « salarié » seulement dans un texte juridique cité. |
| niveau de risque (Élevé, Moyen, Faible, Non évalué) | score (pour dire niveau), niveau seul, « à risque » | En-tête de colonne : « Niveau de risque ». En phrase : « classé au niveau Élevé » ou « en risque élevé ». |
| estimation | prédiction, score seul | Terme générique pour le résultat du calcul. |
| probabilité à 6 mois | probabilité 6 mois, prob. | RH seulement, modèle statistique. |
| score à règles | score B0, points seuls | Modèle à règles : nombre de points, jamais présenté comme un pourcentage. |
| collaborateurs évalués | scorés, population scorée | « Non évalué » est déjà le libellé de niveau. |
| calcul mensuel, calcul des risques | run, scoring, batch | « Calcul publié » pour le calcul en vigueur. |
| modèle en service | champion | « Champion » toléré dans l'historique des versions, avec la bulle « ? ». |
| facteurs associés, catégories de facteurs (manager) | causes, raisons | |
| départ volontaire | départ (seul) quand le motif compte | Démission ou abandon de poste. |
| service de calcul (worker) | worker seul | L'administrateur garde le mot entre parenthèses la première fois. |
| traitement | job, travail, tâche | File, statut et durée des traitements. |
| simulation « et si ? » | what-if | |
| gravité (Information, Attention, Critique) | sévérité | Même mot sur les alertes et sur les contrôles d'import. |
| capacité d'entretiens RH | top-k, quota | |
| lift (RH et administrateur) | — | Toujours avec la bulle « ? » ; jamais montré au manager. |

## 3. Formats

- **Nombres** : séparateur de milliers espace fine, virgule décimale (`fmt.int`, `toLocaleString("fr-FR")`).
- **Pourcentages** : une décimale par défaut, espace insécable avant « % » (`fmt.pct`, `formatRate`). Deux décimales seulement pour un taux d'absence ou un score qualité proche d'un seuil.
- **Variation d'un taux** : en points, « +0,4 pt », jamais « +0,4 % ».
- **Lift** : « 3,3 × » (lu « 3,3 fois »), espace insécable avant « × » (`formatLiftShort`). En phrase : « 3,3 fois le risque moyen ».
- **Montants** : « 12 345 TND », sans décimale à l'écran (sauf SMIG).
- **Dates** : jj/mm/aaaa (`fmt.date`) ; mois : « août 2026 » (`formatMonth`) ; période : « mars 2025 – août 2026 (18 mois) ».
- **Durées** : unité en toutes lettres pour les jours et les mois (« 12 jours », « 3,2 mois ») ; « min » et « h » acceptés dans un tableau.
- **Unités et périodes** : chaque indicateur affiche son unité (%, TND, collaborateurs, jours) et sa période (« sur la période », « fin août 2026 », « 12 derniers mois »). Un taux sans période est une anomalie.
- **Valeur absente** : « — », expliquée par une note ou une bulle (historique insuffisant, groupe de moins de 5 personnes).
- **Pluriels** : accorder quand le nombre est connu (`jour${n > 1 ? "s" : ""}`) ; « (s) » toléré seulement dans un texte généré long.

## 4. Structure d'un écran

1. **Titre d'onglet** : « <Titre de la page> — People Analytics AJIR », identique au libellé du menu.
2. **En-tête** (`PageHeader`) : titre = libellé du menu ; sous-titre d'une ligne, adapté au rôle.
3. **Encart « À quoi sert cette page »** (`PageIntro`) : une phrase d'objectif, trois repères au plus, lien vers la rubrique de `/aide`. Il ne répète pas le sous-titre.
4. **Bulles « ? »** (`TermTip`, `InfoTip`) : sur chaque indicateur et chaque terme technique. Dans une carte cliquable, la bulle est posée à côté du lien (`CornerTip`), jamais dedans.
5. **États** : vide (`EmptyState` avec une piste d'action), erreur (`RouteError`), chargement (`RouteLoading`).

Les bulles sont filtrées par rôle : un terme réservé à la RH (lift, masse salariale, Bradford) n'est jamais rendu pour un manager.

## 5. Corrections appliquées (périmètre de cette passe)

- `/aide` : centre d'aide filtré par rôle (plan des écrans, risque de départ, tableau de bord, absentéisme, recommandations, alertes, qualité des données, transparence et backtesting, confidentialité, FAQ, glossaire).
- 404 en français : `src/app/not-found.tsx` (adresse inconnue) et `src/app/(app)/not-found.tsx` (élément introuvable dans l'application).
- Tableau de bord, Absentéisme, Santé des données, Transparence du modèle, Backtesting : encart « À quoi sert cette page » et bulles « ? » sur chaque indicateur.
- Santé des données : « Worker de calcul » → « Service de calcul » ; « Scoring » → « Calcul des risques » ; « Jobs » et « Travaux » → « Traitements » ; fraîcheur en « jours » ; « salariés » → « collaborateurs évalués ».
- Transparence : « scorés » → « évalués » ; lift au format « 3,3 × » ; « salariés » → « collaborateurs » ; « le même score » → « la même estimation ».
- Backtesting : « Salariés scorés » → « Collaborateurs évalués » ; colonne « Niveau » → « Niveau de risque » ; « Probabilité 6 mois » → « Probabilité à 6 mois » ; lift « 3,3 × » ; « champion » et « bundle » remplacés.
- Tableau de bord : « salariés filtrés » → « collaborateurs filtrés ».
- Tests e2e alignés : [tests/e2e/data-model.spec.ts](../../tests/e2e/data-model.spec.ts) (« des collaborateurs évalués », « Collaborateurs évalués (suivi complet) »).

## 6. Corrections à appliquer dans les fichiers réservés à d'autres contributeurs

Numéros de ligne relevés le 30/09/2026 ; relire la ligne avant de remplacer.

| Fichier | Texte actuel | Texte proposé |
|---|---|---|
| `src/app/(app)/employees/[id]/page.tsx:13` | `Fiche collaborateur — People Analytics` | `Fiche collaborateur — People Analytics AJIR` |
| `src/app/(app)/employees/(liste)/page.tsx:20` | titre fixe `Collaborateurs — …` | `generateMetadata` : « Mon équipe — People Analytics AJIR » pour le manager (libellé du menu) |
| `src/app/(app)/employees/(liste)/page.tsx:56` | `label: "Niveau"` | `label: "Niveau de risque"` (adapter `tests/e2e/dashboard-rh.spec.ts:54`) |
| `src/app/(app)/employees/(liste)/page.tsx:148` | `Score à règles (pts)` | `Score à règles (points)` |
| `src/app/(app)/employees/(liste)/page.tsx:151` | `"Probabilité 6 mois"` | `"Probabilité à 6 mois"` (adapter `tests/pilotage/pages.test.ts:65`) |
| `src/components/pilotage/employee-detail.tsx:394` | `Hors population scorée (contrat, ancienneté ou âge).` | `Hors du calcul : stage ou SIVP, CDD court, arrivée récente, départ à la retraite proche, démission connue ou opposition au calcul.` |
| `src/components/pilotage/employee-detail.tsx:493` | série `"Probabilité 6 mois"` | `"Probabilité à 6 mois"` |
| `src/components/pilotage/employee-detail.tsx:500` | en-tête `"Niveau"` | `"Niveau de risque"` |
| `src/components/pilotage/what-if-panel.tsx:90` | `recalculés dans la population scorée de ce mois` | `recalculés parmi les collaborateurs évalués ce mois-ci` |
| `src/components/pilotage/what-if-panel.tsx:240` | `Heures sup. en moins par mois (3 derniers mois)` | `Heures supplémentaires en moins par mois (moyenne des 3 derniers mois)` |
| `src/app/(app)/recommendations/page.tsx:83` | `Niveau actuel` | `Niveau de risque actuel` |
| `src/app/(app)/alerts/page.tsx:62, 75, 106` | `Sévérité` | `Gravité` |
| `src/app/(app)/alerts/page.tsx:92` | `aria-label="Répartition par sévérité"` | `aria-label="Répartition par gravité"` |
| `src/app/(app)/admin/page.tsx:58` | `Imports, worker et recalculs` | `Imports, service de calcul et recalculs` |
| `src/app/(app)/admin/page.tsx:111` | `Worker de calcul` | `Service de calcul` |
| `src/app/(app)/admin/page.tsx:217-218` | `Jobs sur ${DAYS} jours par type et statut` / `File de calcul du worker` | `Traitements sur ${DAYS} jours par type et statut` / `File du service de calcul` |
| `src/app/(app)/admin/page.tsx:222, 231` | `Aucun job créé sur…` / `Durée moyenne (jobs terminés) :` | `Aucun traitement lancé sur…` / `Durée moyenne (traitements terminés) :` |
| `src/app/(app)/admin/users/page.tsx:11` | `Utilisateurs — People Analytics AJIR` | `Utilisateurs et accès — People Analytics AJIR` (libellé du menu) |
| `src/app/(app)/admin/users/page.tsx:220` | `Salarié lié` | `Collaborateur lié` |
| `src/components/admin/user-create-form.tsx:54` | `Matricule du salarié` | `Matricule du collaborateur` |
| `src/components/admin/settings-form.tsx:38` | `de l'effectif scoré` | `des collaborateurs évalués` |
| `src/components/admin/settings-form.tsx:39` | `× l'estimation moyenne` | `fois l'estimation moyenne` |
| `src/lib/dal/admin.ts:235` | `Part de l'effectif scoré classée en risque élevé, alignée sur la capacité d'entretiens RH. Ex. 0,02 = 2 %.` | `Part des collaborateurs évalués classée au niveau Élevé chaque mois, selon la capacité d'entretiens RH. Exemple : 0,02 = 2 %.` |
| `src/lib/dal/admin.ts:241` | `Seuil de lift du niveau « Moyen »` | `Seuil du niveau « Moyen » (multiple du risque moyen)` |
| `src/lib/dal/admin.ts:242` | `Un salarié hors top-k passe en « Moyen » si son estimation vaut au moins ce multiple de la moyenne.` | `Un collaborateur hors du niveau Élevé est classé Moyen si son estimation atteint au moins ce multiple de la moyenne (lift).` |
| `src/lib/dal/admin.ts:249` | `l'import est bloqué et le scoring suspendu.` | `l'import est bloqué et le calcul des risques suspendu.` |
| `src/lib/dal/admin.ts:264` | `Facteur S² × D hors santé sur 12 mois…` | `Facteur de Bradford (nombre d'absences au carré × jours d'absence, hors santé, sur 12 mois) au-delà duquel un signal individuel « à vérifier » est adressé à la RH.` |
| `src/app/(app)/compte/page.tsx:20` | `Fiches collaborateurs, salaires et scores individuels` | `Fiches collaborateurs, salaires et estimations individuelles` |
| `src/app/(app)/compte/page.tsx:26` | `Recommandations, simulation what-if et backtesting` | `Recommandations, simulation « et si ? » et backtesting` |
| `src/lib/engine/recommendations.ts:105` | `Exposition au risque de départ classée « élevée » au …` | `Niveau de risque Élevé au …` |
| `src/lib/engine/recommendations.ts:107` | `Une prédiction est une estimation : à confirmer lors d'un entretien.` | `C'est une estimation, pas une certitude : à confirmer lors d'un échange.` |

Appliqué le 30/09/2026 (vérification finale) : les deux libellés de `src/lib/engine/recommendations.ts` (nouvelles alertes ; les 2 alertes antérieures encore valables de la base de démonstration ont été recalculées). Renommage fait : « Vérification a posteriori » dans le menu, l'aide, le plan des écrans, le glossaire, Mon compte, les états de chargement et d'erreur ; titre « Vérification a posteriori (backtesting) » ; URL `/backtesting` inchangée. Pour mémoire, l'arbitrage initial : renommer « Backtesting » en « Vérification a posteriori (backtesting) » dans `src/components/layout/sidebar.tsx` et dans le titre de la page. La page porte déjà un encart explicatif et le centre d'aide définit le terme.

## 7. Vérifications

- `npx vitest run tests/help` : rendu des composants d'aide, textes filtrés par rôle (aucun lift, montant ni Bradford côté manager), page `/aide` pour les trois rôles, page 404.
- `npx vitest run tests/pilotage/pages.test.ts tests/pilotage/dashboard-visuals.test.ts tests/whatif/whatif.test.ts tests/ui-admin` : rendus existants inchangés (le manager ne voit toujours ni « Lift », ni « TND », ni « Masse salariale »).
- Non vérifié : rendu visuel dans le navigateur et contrôle axe-core (`next dev` et `next build` interdits pendant les travaux parallèles).

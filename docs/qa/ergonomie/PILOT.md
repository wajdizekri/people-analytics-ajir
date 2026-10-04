# Ergonomie — tableau de bord et synthèse (agent PILOT, 04/10/2026)

Périmètre : `/dashboard`, `/synthese`, barre de filtres commune (`filters.tsx`, `filter-fields.tsx`), bandeau « À traiter » (`shortcuts.tsx`), « Quoi de neuf » de la fiche (`whats-new.tsx`). Audit par écran et par rôle (RH, manager) contre la grille de [CHANTIER_ERGONOMIE.md](../CHANTIER_ERGONOMIE.md) ; gravité Nielsen 1 à 4.

## Frictions et corrections

| # | Écran | Rôle | Gravité | Friction | Statut |
|---|---|---|---|---|---|
| P1 | Tableau de bord, filtres | RH, manager | 2 | Sous 640 px, double repli : `MobileCollapse` « Filtres » enveloppait `FilterForm`, qui repliait lui-même ses listes (« Afficher les filtres ») : deux boutons, deux appuis, et « Appliquer » / « Réinitialiser » affichés alors que les listes étaient masquées. | **Corrigé** : un seul repli, dans `FilterFields` ; listes **et** boutons repliés derrière « Afficher les filtres (n actifs) » quand il n'y a pas de recherche (avec recherche, comme /employees : recherche et boutons restent visibles) ; pas de repli pour une seule liste. Vaut pour toutes les pages qui utilisent `FilterForm`. |
| P2 | Barre de filtres (toutes pages) | tous | 2 | En desktop, grille à 4-5 colonnes + rangée de boutons : 3 rangées pour la RH du tableau de bord, 2 pour le manager. | **Corrigé** : à partir de `lg`, champs et boutons sur une ligne flexible (boutons alignés à droite, retour à la ligne si la place manque) : manager 1 rangée, RH 2 rangées à 1 440 px. Entre 640 et 1 023 px, grille à 2 colonnes inchangée. |
| P3 | Tableau de bord, filtres | RH, manager | 2 | « Période » toujours surlignée comme filtre actif et comptée « (1 actif) » à sa valeur par défaut (liste sans option « Tous »). | **Corrigé** : prop additive `defaultValue` de `FilterSelect` ; le tableau de bord la pose (12 derniers mois). |
| P4 | Tableau de bord, filtres actifs | RH, manager | 1 | Période modifiée comptée dans les filtres actifs mais absente des puces. | **Corrigé** : puce retirable « Période : 18 derniers mois × ». |
| P5 | Tableau de bord, ordre de lecture | RH, manager | 2 | Bandeau « À traiter » sous les filtres et encart d'aide de 6 lignes (charte : pas de bloc de plus de 3 lignes) : les indicateurs et les actions en attente sortaient du premier écran sur mobile. | **Corrigé** : en-tête → aide en une phrase (+ lien vers l'aide) → « À traiter » → filtres → filtres actifs → indicateurs → visuels → détail. Squelette `loading.tsx` remis dans le même ordre. |
| P6 | Bandeau « À traiter » | RH, manager | 2 | Libellé « À traiter » en petites capitales grises (hiérarchie faible) ; un compteur à zéro restait un lien « 0 nouvelle alerte › » vers une liste vide. | **Corrigé** : libellé en titre avec icône ; élément à zéro en texte coché sans lien (« Aucune nouvelle alerte », prop additive `none`) ; élément urgent marqué d'une icône d'avertissement en plus du mot « critique ». Cibles ≥ 40 px conservées. |
| P7 | Tableau de bord, indicateurs | RH, manager | 2 | Carte « Formations obligatoires réalisées » sans lien alors que /formations existe pour les deux rôles (charte § 4). | **Corrigé** : « Voir les formations à risque de retard ». |
| P8 | Tableau de bord, en-tête | manager | 1 | La phrase d'objectif du manager omettait les formations, pourtant affichées. | **Corrigé** (« … départs, absentéisme et formations. ») ; le début de phrase visé par l'E2E est inchangé. |
| P9 | Tableau de bord, 390 px | RH, manager | 1 | Grilles de visuels sans colonne explicite (piste implicite `auto`). | **Corrigé** : `grid-cols-1` (pistes `minmax(0, 1fr)`) ; les cartes ont déjà `min-w-0`. |
| P10 | Tableau de bord, visuels | RH, manager | 1 | Lien « Analyser » du visuel d'absentéisme : verbe sans objet visible (objet en texte masqué). En-tête de `VisualCard` non repliable à 390 px : un libellé long écraserait le titre. | **Non fait** (pbi.tsx hors périmètre) : demande [e9-PILOT] dans CHANTIER_VISUELS.md. |
| P11 | Tableau de bord, visuels | RH, manager | 1 | Liens d'en-tête de visuel à 32 px de haut (< 40 px de la charte pour les boutons). | **Non fait** : liens de texte, ≥ 24 px (WCAG 2.5.8) ; passer à 40 px décalerait le lien par rapport au titre sans gain net. |
| S1 | Synthèse, listes nominatives | RH, manager | 2 | « Passés en risque élevé » / « Sortis du risque élevé » ouvraient la fiche sans retour : le fil d'Ariane renvoyait à la liste complète. | **Corrigé** : `?retour=/synthese#<liste>` (fil « Synthèse du mois › Nom »). |
| S2 | Synthèse, indicateurs | RH, manager | 2 | Cartes « Collaborateurs en risque élevé » (et effectif) vers la liste sans retour vers la synthèse ; effectif sans lien. | **Corrigé** : `retour=/synthese` (accepté par /employees, demande COLLAB faite) ; carte effectif reliée à la liste, libellés alignés sur le tableau de bord (« Voir les N collaborateurs », « Voir la liste (tous contrats) »). |
| S3 | Synthèse, aide | RH, manager | 1 | Encart d'aide de 6 lignes, dont deux repères qui redisaient les titres de section. | **Corrigé** : une phrase + le repère propre au rôle (journal d'audit / masquage des petits groupes). |
| S4 | Synthèse, listes | RH, manager | 1 | Titres h3 en `text-fg` au lieu de `text-heading`. | **Corrigé**. |
| W1 | Fiche, « Quoi de neuf » | RH, manager | 1 | Pastille rouge pour tout changement de niveau de risque, y compris une baisse (charte § 5 : rouge = défavorable). | **Corrigé** : « Risque en hausse » (rouge), « Risque en baisse » (vert), inchangé (gris) : le sens est écrit, la couleur ne fait que le doubler. |

Vérifiés sans changement : titres-messages des visuels et sous-titres (mesure, unité, périmètre, période), liens d'analyse et filtrage croisé, états vides (quoi + pourquoi + action quand une action existe), puces retirables et lien unique « Réinitialiser les filtres », distinction restriction de rôle / valeur invalide, impression de la synthèse, gardes manager (aucun montant, aucune probabilité, filtres RH absents).

## Fichiers modifiés

- `src/components/pilotage/filter-fields.tsx` : repli unique (listes + boutons), `defaultValue`, champs en ligne flexible à partir de `lg`, pas de repli pour une seule liste.
- `src/components/pilotage/filters.tsx` : `FilterForm` en ligne à partir de `lg`, boutons transmis à `FilterFields`, champs cachés hors de la grille. API inchangée (props existantes, libellés, `id` des champs).
- `src/components/ux/shortcuts.tsx` : hiérarchie du bandeau, éléments à zéro sans lien, prop additive `none`.
- `src/app/(app)/dashboard/page.tsx`, `loading.tsx` : ordre de lecture, sans `MobileCollapse`, `defaultValue` de la période, puce « Période », lien formations, phrase manager, grilles.
- `src/app/(app)/synthese/page.tsx` : retours vers la synthèse, carte effectif reliée, libellés, encart d'aide.
- `src/components/insights/whats-new.tsx` : sens et couleur des changements de niveau.
- Tests : `tests/ergo-pilot/components.test.ts`, `dashboard.test.ts`, `synthese.test.ts` (rendu statique).

## Libellés E2E

Aucun libellé visé par `tests/e2e/*.spec.ts` n'a changé : « Tableau de bord » (h1), « Lire la synthèse du mois », « Indicateurs RH de l'entreprise », « Indicateurs de votre équipe (périmètre hiérarchique), hors rémunération » (correspondance partielle, phrase prolongée), libellés des cartes KPI, « Filtres actifs : aucun », « Appliquer les filtres » / lien unique « Réinitialiser les filtres », libellés « Période », « Département », « Contrat », « Niveau de risque », « non disponibles dans la vue manager », « Paramètre(s) invalide(s) ignoré(s) », tableau « … niveau de risque et par département ». À 1 440 px (viewport E2E) les listes et les boutons sont visibles sans dépliage.

## Vérifications

- `npx vitest run tests/pilotage tests/insights tests/ergo-pilot --maxWorkers=2` : 12 fichiers, 100 tests verts ; pages consommatrices de `FilterForm` : `tests/retention`, `tests/ergo-action` (alertes), `tests/help` : 6 fichiers, 60 tests verts.
- `npx eslint` sur les fichiers modifiés et `tests/ergo-pilot` : 0 erreur.
- `npx tsc --noEmit` : aucune erreur dans le périmètre ; 4 erreurs hors périmètre (session 40) : `src/app/(app)/derive/page.tsx:255`, `src/components/monitoring/data-options.ts:508`, `src/components/monitoring/model-options.ts:421`, `tests/monitoring-admin/page.test.ts:90`.
- Rendu visuel à 390 px et 1 440 px non vérifié au navigateur (Playwright interdit) : à contrôler lors des captures finales.

## Demandes

- [e9-PILOT] `pbi.tsx` (KIT, CHANTIER_VISUELS.md) : en-tête de `VisualCard` repliable sous 640 px (actions sous le titre) ; ensuite « Analyser » → « Analyser l'absentéisme » sur le tableau de bord.
- [PILOT] `absenteeism/page.tsx`, `retention/page.tsx` (IA, CHANTIER_ERGONOMIE.md) : poser `defaultValue` sur `granularite`, `axe`, `mode` (sinon listes surlignées et comptées « actives » à leur valeur par défaut).
- [PILOT] `/employees` : accepter `retour=/synthese` — **fait** par COLLAB, branché.

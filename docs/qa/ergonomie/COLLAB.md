# Ergonomie des pages collaborateurs (agent COLLAB, session aziz-pfe-e9, 04/10/2026)

Périmètre : /employees (liste et fiche), /equipes, /organigramme, `src/components/pilotage/**` (hors `filters.tsx`, `filter-fields.tsx`, `recommendation-forms.tsx`), `src/components/org-chart/**`, `src/components/insights/teams*.tsx` et `journey.tsx`. Rôles RH et MANAGER ; l'ADMIN est redirigé vers /interdit (inchangé). Grille : [CHANTIER_ERGONOMIE.md](../CHANTIER_ERGONOMIE.md). Gravité Nielsen 1 à 4. Les parcours déjà corrigés ([ERGONOMIE.md](../ERGONOMIE.md) § 4.1, § 4.3, § 4.6) n'ont pas été refaits.

Constat général : la liste (tri et pagination serveur, ligne cliquable, cartes sous 672 px, niveau en mots, export), la fiche (résumé « En bref », sommaire « Aller à », zones numérotées, toasts des décisions) et les deux écrans d'équipe suivaient déjà la charte. Les frictions restantes portaient sur les **retours contextuels** (paramètre `retour` posé par d'autres écrans mais rejeté), l'**ordre de lecture de la fiche sous lg**, l'**état de la simulation** et la **navigation dans l'organigramme**.

## Frictions

| Écran | Rôle | Grav. | Friction | Statut |
|---|---|---|---|---|
| Fiche (depuis /organigramme, /charge, /formations, /interventions, /synthese, détail d'alerte) | RH, MANAGER | 3 | `?retour=` posé par ces écrans rejeté par `safeReturn` : le fil d'Ariane affiche « Collaborateurs » / « Mon équipe » et renvoie à la liste, le contexte est perdu (H3). | **Corrigé** : `ORIGINS` complété (libellé = titre de la page d'origine, « Formations obligatoires ») ; `retour=/alerts/<id>` accepté (`/^\/alerts\/\d{1,12}$/`, libellé « Alerte »). Demandes [IA], [ACTION] traitées. |
| Liste ← Équipes, ← Synthèse | RH, MANAGER | 2 | Ouvrir les collaborateurs d'une équipe (tableau ou carte) ou la liste depuis la synthèse : aucun retour vers l'écran d'origine et ses filtres. | **Corrigé** : Équipes pose `retour=/equipes?…` (lien du nom, ligne, rectangle de la carte) ; la liste accepte `/equipes` (« Équipes » / « Mes équipes ») et `/synthese` (demande [PILOT] traitée). |
| Organigramme → fiche, liste | RH, MANAGER | 2 | Le retour ramenait à l'organigramme coloré par effectif : la couleur choisie (risque, absentéisme) était perdue. | **Corrigé** : `retour=/organigramme?couleur=…` sur « Ouvrir la fiche », « Voir l'équipe » et les noms (panneau et vue liste). |
| Fiche, sous lg | RH, MANAGER | 2 | Le Parcours (jusqu'à 12 évènements) s'intercalait entre Faits et Estimation : sur mobile et tablette, le niveau de risque arrivait après deux écrans de frise. | **Corrigé** : ordre DOM Faits → Estimation → Parcours ; à partir de lg, Faits puis Parcours à gauche, Estimation à droite sur deux rangées (`grid-rows-[auto_1fr]`, la rangée flexible absorbe la hauteur en trop). |
| Fiche, simulation « et si ? » | RH | 2 | Relance : l'ancien résultat restait affiché pendant le calcul ; leviers modifiés après un calcul : résultat périmé présenté comme actuel (H1). | **Corrigé** : squelette avant/après à chaque calcul (remplace l'ancien résultat) ; encadré « Résultat à mettre à jour » dès qu'un levier diffère des valeurs calculées. |
| Organigramme, vue liste | RH, MANAGER | 2 | Parcours au clavier par Tab uniquement (325 personnes sous M12037) ; aucune indication. | **Corrigé** : flèches haut/bas (ligne suivante), droite (déplier puis premier enfant), gauche (replier puis parent), Début/Fin ; aide visible reliée à la liste (`aria-describedby`). Sémantique `details/summary` conservée. |
| Organigramme, vue liste | RH, MANAGER | 2 | Déplier une équipe n'affichait pas son détail, alors qu'un clic sur le graphique le fait (H4). | **Corrigé** : déplier une ligne la sélectionne (sans déplacer le focus) ; « Afficher le détail » garde le focus sur le panneau. |
| Organigramme, sous lg | RH, MANAGER | 2 | Le panneau de détail est sous la hiérarchie : un clic sur un nœud ne montrait rien à l'écran (H1). | **Corrigé** : ligne « Sélection : Nom · Voir son détail » sous le titre de la hiérarchie (masquée à partir de lg). |
| Équipes | RH, MANAGER | 1 | Seul le nom de l'équipe était cliquable (grille : ligne cliquable). | **Corrigé** : `rowHref` (ligne et carte) ; équipe sans manager : nom en texte, plus de lien vers la liste entière. |
| Équipes | RH, MANAGER | 1 | KPI « Équipes suivies (N à regarder) » sans accès au détail. | **Corrigé** : « Voir les équipes à regarder » (`tension=oui`, département conservé). |
| Équipes | RH, MANAGER | 1 | Pastilles du risque en couleurs Tailwind brutes (`bg-red-700 dark:bg-red-400`…). | **Corrigé** : jetons `bg-danger`, `bg-warning`, `bg-success`. |
| Organigramme | RH, MANAGER | 1 | Pas d'accès direct à Équipes (Équipes a « Voir l'organigramme »). | **Corrigé** : action d'en-tête « Voir les équipes » / « Voir mes équipes ». |
| Liste | RH, MANAGER | 1 | Sans filtre, état vide « ne correspond aux critères » sans pourquoi. | **Corrigé** : « Aucun collaborateur actif » + raison par rôle (import AJIR ; manager : contacter la RH). Libellé filtré inchangé (E2E). |
| Fiche | RH, MANAGER | 1 | Aucun accès à l'équipe du manager (collègues directs). | **Corrigé** : « Voir l'équipe » sous le manager (`/employees?manager=`, filtré par le périmètre côté DAL). |
| Squelettes /equipes, /organigramme | RH, MANAGER | 1 | Forme différente de la page (sans bouton d'en-tête ni encadré d'explication). | **Corrigé** : `SkeletonHeader` avec action, encadré ajouté. |
| Fiche | RH | 1 | Actions principales en haut (≤ 2 + « Plus d'actions »). | **Non fait** : la fiche n'a pas d'action de page ; décider et simuler sont des sections, atteintes par le sommaire « Aller à » (pastille « N à décider ») ; un bandeau d'actions doublerait ce sommaire (H8). |
| Fiche | RH, MANAGER | 1 | `OnThisPage` sous lg (§ 4.6). | **Déjà en place** : sommaire « Aller à : 1 Faits, 2 Estimation, 3 Suggestions, Simulation » à toutes les largeurs. |
| Fiche | RH, MANAGER | 1 | Zone 1 nommée « Faits » (piste : « Observations »). | **Non fait** : titre visé par les tests E2E (`/1\.\s*Faits/`) et `tests/pilotage/pages.test.ts`. |
| Organigramme, graphique | RH, MANAGER | 1 | Canevas ECharts non parcourable au clavier. | **Non fait** : la vue Liste est l'alternative clavier (annoncée dans le libellé du graphique, choisie d'office sous 640 px). |
| Organigramme, Équipes | RH, MANAGER | 1 | Hex en dur : rampe « effectif » (`scale.ts`), rampe de tension (`teams.tsx`, `teams-treemap.tsx`), encres du graphique en arbre. | **Non fait** : aucune rampe séquentielle partagée dans `theme.ts`, et ces couleurs ne sont pas dans `DARK_COLORS` (`cssChartColor` ne les remapperait pas) ; l'arbre utilise ECharts directement (série `tree`). À reprendre si KIT ajoute une rampe séquentielle. |
| Organigramme, vue liste | RH, MANAGER | 1 | « Afficher le détail » : cible de 32 px (< 40 px de la charte). | **Non fait** : densité de l'arbre ; ≥ 24 px (WCAG 2.5.8) respecté. |

## Fichiers modifiés

- `src/app/(app)/employees/[id]/page.tsx` : `ORIGINS`, retour vers une alerte, grille Faits → Estimation → Parcours.
- `src/app/(app)/employees/(liste)/page.tsx` : retours `/equipes` et `/synthese`, libellés du fil d'Ariane, état vide.
- `src/components/pilotage/employee-detail.tsx` : « Voir l'équipe » du manager.
- `src/components/pilotage/what-if-panel.tsx` : squelette à chaque calcul, résultat périmé (`WhatIfResult` exporté).
- `src/app/(app)/equipes/page.tsx`, `loading.tsx` : retour, `rowHref`, KPI cliquable, jetons, squelette.
- `src/app/(app)/organigramme/page.tsx`, `loading.tsx` : action « Voir les équipes », squelette.
- `src/components/org-chart/org-chart-view.tsx`, `org-detail-panel.tsx`, `org-tree-list.tsx` : retour avec couleur, sélection visible sous lg, navigation au clavier, sélection au dépliage.
- Nouveau : `tests/ergo-collab/pages.test.ts` (11 tests de rendu et de logique).

## Libellés E2E

Aucun libellé visé modifié : « En bref », « 1. Faits / 2. Estimation / 3. Suggestions », « Simuler ces actions », « Réinitialiser la simulation », « Avant (calcul publié) », « Après les actions simulées », « N résultats », « Aucun collaborateur ne correspond aux critères », « Trier la liste », en-têtes de tableau, « Voir l'organigramme ». Libellés ajoutés : « Voir les équipes », « Voir mes équipes », « Voir son détail », « Voir l'équipe » (fiche), « Voir les équipes à regarder », « Résultat à mettre à jour ».

## Demandes

- Traitées pour les autres agents (marquées **[FAIT]** dans CHANTIER_ERGONOMIE.md) : [IA] origines `/formations`, `/charge` ; [ACTION] origines `/interventions` et `/alerts/<id>` ; [PILOT] `/synthese` dans la liste.
- Aucune demande ouverte de ma part.

## Vérification

- `npx vitest run tests/pilotage tests/whatif tests/org-chart tests/insights tests/ergo-collab --maxWorkers=2` : 13 fichiers, 123 tests verts.
- `npx eslint` sur les 12 fichiers touchés : 0 erreur.
- `npx tsc --noEmit` : 4 erreurs, toutes hors périmètre (session aziz-pfe-40) : `src/app/(app)/derive/page.tsx`, `src/components/monitoring/data-options.ts`, `src/components/monitoring/model-options.ts`, `tests/monitoring-admin/page.test.ts`.
- Pas de navigateur (consigne) : grille de la fiche à lg et flèches de l'organigramme vérifiées par le rendu statique et des éléments simulés, à confirmer à l'écran.

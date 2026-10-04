# Ergonomie — alertes, recommandations, interventions, export (agent ACTION, 04/10/2026)

Périmètre : `/alerts` (liste et détail), `/recommendations`, `/interventions`, `recommendation-forms.tsx`, `intervention-effects.tsx`, `src/components/export/**`. Audit par écran et par rôle contre la grille de [CHANTIER_ERGONOMIE.md](../CHANTIER_ERGONOMIE.md), après vérification de ce qui était déjà fait (ERGONOMIE.md § 4.4 et 4.5 : compteur, pagination, titre cliquable, colonne « Concerne », action dérivée du type, « alerte suivante », décision depuis la liste, tuile « En attente » cliquable étaient en place). Gravité Nielsen 1 à 4.

## Frictions et corrections

| # | Écran | Rôle | Gravité | Friction | Statut |
|---|---|---|---|---|---|
| A1 | Alertes, liste | tous | 2 | Mention de tri « les plus récentes d'abord » fausse : la liste est triée par statut (nouvelles, en cours, clôturées), puis gravité, puis date. | **Corrigé** : « nouvelles et en cours d'abord, les plus graves en tête ». |
| A2 | Alertes, filtre Type | ADMIN, manager | 2 | Types que le rôle ne reçoit jamais proposés (ADMIN : risque de départ, absentéisme ; manager : qualité des données, système) : liste toujours vide. | **Corrigé** : `TYPES_BY_ROLE` (labels.tsx), calqué sur la visibilité de la DAL ; une valeur imposée par l'URL reste dans la liste. |
| A3 | Alertes, liste → fiche | RH, manager | 2 | Lien « Concerne » vers la fiche sans retour : fil d'Ariane « Collaborateurs ». | **Corrigé** : `?retour=/alerts?…` (filtres et page conservés), fil « Alertes ». |
| A4 | Alertes, états vides | tous | 1 | Titres avec point final ; arrivée par le bandeau « À traiter » (`status=NOUVELLE`) sans message dédié. | **Corrigé** : « Aucune alerte nouvelle » + « Toutes les alertes ont été prises en charge… » ; filtré : pourquoi + « Afficher toutes les alertes ». |
| A5 | Alertes, liste | tous | 1 | Bouton d'export seul sur sa ligne entre filtres et liste. | **Corrigé** : dans l'en-tête de la liste, à côté du compteur et de la répartition par gravité (taille `sm`, 40 px). |
| A6 | Alertes, en-tête | tous | 1 | Périmètre non dit. | **Corrigé** : « Toute l'entreprise » / « Votre équipe (périmètre hiérarchique) » / « Fonctionnement de l'outil ». |
| D1 | Alerte, enchaînement | RH, manager | 2 | « Traiter l'alerte nouvelle suivante » ignorait la sélection de la liste d'origine : en triant les alertes d'absentéisme, on sautait sur un risque de départ. | **Corrigé** : type et gravité relus dans `retour` ; mention « Dans la même sélection que la liste ». |
| D2 | Alerte, suivi | tous | 2 | « Marquer comme traitée » et « Rejeter l'alerte » : aucun état en cours après la confirmation (envoi par `startTransition`, que `useFormStatus` ne voit pas). | **Corrigé** : prop `pending` de `ConfirmButton`, « Enregistrement… ». |
| D3 | Alerte → fiche | RH, manager | 2 | « Voir la fiche de … » et le nom du collaborateur sans retour. | **Corrigé** : `retour=/alerts/<id>` (accepté par la fiche à ma demande, fil « Alerte ») : on revient clôturer l'alerte sans la rechercher. |
| D4 | Alerte clôturée | tous | 1 | Plus d'action principale une fois l'alerte clôturée ; rien ne dit qu'il ne reste rien à traiter. | **Corrigé** : « alerte suivante » en primaire si clôturée ; sinon « Aucune autre alerte nouvelle (dans cette sélection). Revenir à la liste ». |
| D5 | Alerte, « Concerne » | RH, manager | 1 | Département non relié à l'absentéisme (la liste le relie). | **Corrigé**. |
| R1 | Recommandations, décision | RH | 2 | Les deux formulaires d'une ligne partagent l'état : pendant l'envoi d'une décision, l'autre bouton restait actif (double décision, refus serveur). | **Corrigé** : les deux boutons désactivés pendant l'envoi ; spinner sur celui cliqué. |
| R2 | Recommandations, rejet | RH | 1 | Confirmation sans rappel de l'objet : parmi 25 lignes, risque de rejeter la mauvaise. | **Corrigé** : « La recommandation « Entretien de rétention » pour **Nom** sera classée « Rejetée », sans intervention enregistrée… ». |
| R3 | Recommandations, état vide | RH | 1 | Titre « … ne correspond aux filtres » même sans filtre ; tuile « En attente » à 0 → liste vide sans explication. | **Corrigé** : trois cas (aucune en attente, filtres, aucune). |
| R4 | Recommandations, pagination | RH | 1 | « Page 1 sur N » sans la plage. | **Corrigé** : « 1–25 sur N ». |
| R5 | Recommandations, indicateurs | RH | 1 | « Interventions enregistrées » sans lien vers le suivi. | **Corrigé** : « Voir les interventions ». |
| R6 | Formulaire dépliable (`DecideForm`) | RH | 1 | Rejet par `window.confirm`, bouton maison sans état en cours. | **Corrigé** : `ConfirmButton` (conséquence) + `Button pending`. Mode aujourd'hui non rendu (fiche : mode « buttons », liste : `RecoDecision`). |
| I1 | Interventions → fiche | RH | 2 | Fiche ouverte sans retour. | **Corrigé** : `retour=/interventions?action&page` (origine acceptée par COLLAB). |
| I2 | Interventions, avant / après | RH | 1 | Écart en gris sans sens écrit ; aucun écart sur mobile. | **Corrigé** : « −3,1 pt, en baisse » coloré (couleur doublée du mot) ; cartes mobiles sur trois lignes (absentéisme, heures sup., recul). |
| I3 | Interventions, type sans action | RH | 1 | État vide réduit à un lien. | **Corrigé** : pourquoi + bouton « Afficher tous les types d'action ». |
| I4 | Interventions, page vide | RH | 1 | Action noyée dans le texte. | **Corrigé** : bouton « Voir les recommandations ». |
| I5 | Interventions, indicateurs et pied | RH | 1 | « collaborateur(s) » ; bande vide sous le tableau quand une seule page ; pas de plage. | **Corrigé**. |
| F1 | Fiche, « Avant / après intervention » | RH, manager | 1 | Avertissement de causalité en ambre « Attention » alors que /interventions l'affiche en note. | **Corrigé** : `Notice tone="neutral"`. |
| E1 | Impression (toutes pages) | tous | 1 | Boutons de pagination désactivés (`span`) et résumés présentés en bouton imprimés. | **Corrigé** : print.css masque tout élément porteur de la classe de `buttonClass` (plus seulement les liens). |
| E2 | Export CSV | tous | 1 | Pas d'état en cours pendant le téléchargement. | **Non fait** : lien `download` natif, le navigateur affiche le téléchargement ; suivre la fin demanderait un cookie de suivi (sur-ingénierie). |
| E3 | Impression, visuels | tous | 1 | « Voir les données » replié imprimé seul. | **Non fait** (pbi.tsx) : demande [e9-ACTION] dans CHANTIER_VISUELS.md. |
| I6 | Interventions, « Ce qui change » | RH | 1 | Tableau à 6 colonnes en défilement horizontal sur mobile. | **Non fait** : région défilable au clavier, ligne de total en place ; passer à `DataTable` serait une refonte sans gain de parcours. |

Vérifiés sans changement : statuts et gravités en mots + badge, toasts des transitions (`announce` → `toastResult`) et des décisions (émis à la réponse du serveur, même quand la ligne disparaît ; gardé tel quel plutôt que `withActionToast`, car le titre d'erreur fixe avec le motif en description ne s'exprime pas en options statiques), décision depuis la liste (date, avis, commentaire dans la boîte, motif obligatoire), verbes + objets, découpage Suspense de /alerts (vrais 403/404 du détail), ligne de total « Toutes les actions », libellés et icônes d'export et d'impression.

## Fichiers modifiés

- `src/app/(app)/alerts/labels.tsx` : `TYPES_BY_ROLE`, `withReturn`.
- `src/app/(app)/alerts/page.tsx` : tri annoncé, filtre par rôle, périmètre, états vides, export dans l'en-tête de liste, retour vers les alertes. (Ciblé, pas de réécriture.)
- `src/app/(app)/alerts/[id]/page.tsx` : alerte suivante dans la sélection, fin de sélection, liens avec retour, département relié.
- `src/app/(app)/alerts/alert-status-form.tsx` : état en cours des boutons confirmés.
- `src/app/(app)/recommendations/reco-decision.tsx` : boutons désactivés pendant l'envoi, conséquence du rejet nommée.
- `src/app/(app)/recommendations/page.tsx` : états vides, plage de pagination, lien vers les interventions.
- `src/app/(app)/interventions/page.tsx` : écarts en mots, cartes mobiles, états vides, pluriels, retour vers la liste, pagination.
- `src/components/pilotage/recommendation-forms.tsx` : `DecideForm` sans `window.confirm`.
- `src/components/insights/intervention-effects.tsx` : ton de l'avertissement.
- `src/components/export/print.css` : masquage de tout élément présenté en bouton.
- Tests : `tests/ergo-action/pages.test.ts` (alertes, recommandations, export), `tests/ergo-action/interventions.test.ts` (fixture insights).

## Libellés E2E

Aucun libellé visé par `tests/e2e/*.spec.ts` ni par `tests/ui-admin/pages.test.ts` n'a changé : « Traiter l'alerte « … » », « Prendre en charge l'alerte », « Marquer comme traitée », « Rejeter l'alerte », « Confirmer le traitement » / « Confirmer le rejet », « (facultatif ; obligatoire pour un rejet) », « Pour rejeter, expliquez pourquoi », toasts « Alerte prise en charge. » / « Alerte marquée comme traitée. », « Cette alerte est clôturée (…) », `data-field="type|concerne"`, phrase manager « Les signaux individuels d'absentéisme restent réservés à la RH. », « Voir la fiche de … », « Rejeter la recommandation », boîte « Rejeter cette recommandation ? », « Motif du rejet », « Recommandation rejetée. », libellés des indicateurs, « Appliquer » / « Statut ». Seul effet : pendant l'envoi, le nom accessible de « Marquer comme traitée » / « Rejeter l'alerte » devient « Enregistrement… » (comme « Prendre en charge » déjà) ; les E2E cliquent avant et attendent le statut.

## Vérifications

- `npx vitest run tests/pilotage tests/insights tests/export tests/ergo-action --maxWorkers=2` : 14 fichiers, 118 tests verts. `tests/ui-admin/pages.test.ts -t alerte` (détail d'alerte, non modifiable) : vert.
- `npx eslint` sur le périmètre et `tests/ergo-action` : 0 erreur.
- `npx tsc --noEmit` : aucune erreur dans le périmètre ; 4 erreurs hors périmètre (session 40) : `src/app/(app)/derive/page.tsx:255`, `src/components/monitoring/data-options.ts:508`, `src/components/monitoring/model-options.ts:421`, `tests/monitoring-admin/page.test.ts:90`.
- Hors périmètre : `tests/ui-admin/pages.test.ts` « paramètres : … bouton unique » échoue (« Revenir à » attendu, « Rétablir la valeur par défaut » rendu) : fichiers de paramètres de la session 40, sans lien avec ce chantier.
- Rendu à 390 px et 1 440 px non vérifié au navigateur (Playwright interdit).

## Demandes

- [ACTION] `employees/[id]/page.tsx` (COLLAB) : origines `/interventions` et `/alerts/<id>` — **fait** par COLLAB, branché (I1, D3).
- [e9-ACTION] `pbi.tsx` (KIT, CHANTIER_VISUELS.md) : `ChartData` replié masqué à l'impression (E3).

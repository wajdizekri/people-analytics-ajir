# Audit d'ergonomie : parcours et interactions

Date : 30/09/2026. Complète [ACCESSIBILITE.md](ACCESSIBILITE.md) (WCAG) : ici on regarde l'**efficacité des parcours**, pas la conformité.

Méthode : évaluation heuristique (10 heuristiques de Nielsen, notées H1 à H10 ci-dessous) et déroulé pas à pas des trois parcours types, un par rôle, dans le code des écrans (`src/app/(app)/**`, `src/components/**`). Gravité selon l'échelle de Nielsen : **4** bloquant, **3** majeur, **2** mineur, **1** cosmétique.

Vérifications : `npx tsc --noEmit`, `npx eslint` sur les fichiers modifiés, `npx vitest run tests/pilotage tests/ui-admin tests/whatif` (tous verts). Pas de `next dev` ni `next build` (travaux parallèles) : le rendu visuel reste à valider dans le navigateur et par la suite Playwright (voir « Restant »).

Rappel des heuristiques : H1 visibilité de l'état du système · H2 correspondance avec le monde réel · H3 contrôle et liberté · H4 cohérence et standards · H5 prévention des erreurs · H6 reconnaître plutôt que se souvenir · H7 flexibilité et efficacité · H8 esthétique et minimalisme · H9 aide à la récupération des erreurs · H10 aide et documentation.

## 1. Parcours par rôle

### RH : trouver les salariés à risque d'un département et agir

Parcours cible : Tableau de bord → filtre Département → liste des « Élevé » de ce département → fiche → décision (recommandation, entretien) → retour à la liste.

| Étape | Friction constatée | Gravité | Statut |
|---|---|---|---|
| Arrivée sur le tableau de bord | La tuile « Collaborateurs en risque élevé », seule tuile actionnable du point de vue du turnover, arrivait en 7e position, après la masse salariale. | 3 | **Corrigé** : première tuile. |
| Arrivée | Aucun accès direct à ce qui attend une action (alertes nouvelles, recommandations à décider) : il faut passer par le menu puis filtrer. | 3 | **Corrigé** : bandeau « À traiter » (nouvelles alertes, dont critiques, et recommandations à décider du département filtré). |
| Choix du département | Tableau « risque par département » trié par nom : le département le plus exposé peut être en bas. | 2 | **Corrigé** : tri par nombre d'« Élevé » puis de « Moyen » (graphique et tableau). |
| Liste → fiche → retour | Le lien « Collaborateurs » de la fiche ramène à `/employees` **sans les filtres** (département, niveau, tri, page) : il faut tout ressaisir. | 3 | **À appliquer** (fichiers interdits), §4.1. |
| Fiche → décision | Les recommandations ne se décident que depuis la fiche : pour 20 recommandations, 20 allers-retours. La tuile « N en attente de décision » de `/recommendations` n'est pas cliquable. | 2 | **À appliquer**, §4.4. |
| Depuis le backtesting ou l'absentéisme vers une fiche | Même perte de contexte au retour. | 2 | **À appliquer**, §4.1. |

### Manager : suivre son équipe

Parcours cible : Tableau de bord → alertes de l'équipe → « Mon équipe » → fiche → absentéisme de l'équipe.

| Étape | Friction constatée | Gravité | Statut |
|---|---|---|---|
| Arrivée | Les alertes nouvelles de l'équipe ne sont visibles que par le compteur du menu (ouvertes, sans distinction nouvelle / en cours). | 2 | **Corrigé** : bandeau « À traiter » → `/alerts?status=NOUVELLE`. |
| Filtres | Un filtre contrat, âge ou ancienneté forcé dans l'URL est signalé « Paramètre(s) invalide(s) ignoré(s) » : le manager croit à une erreur de saisie alors qu'il s'agit d'une restriction de rôle. | 2 | **À appliquer**, §4.2. |
| Absentéisme | Page ouverte directement sur un graphique, sans chiffre de synthèse ; l'équipe la plus touchée se lit seulement dans le tableau en bas. | 2 | **Corrigé** : tuiles de synthèse (taux, groupe le plus touché, anomalies). |
| Absentéisme → retour | Depuis le tableau de bord, aucun moyen de revenir aux filtres d'origine sauf le bouton Précédent du navigateur. | 2 | **Corrigé** : fil d'Ariane « Tableau de bord › Absentéisme » avec les filtres d'origine. |

### Administrateur : importer un export et vérifier la qualité

Parcours cible : Console → Santé des données → téléversement → suivi du traitement → contrôles qualité de l'import.

| Étape | Friction constatée | Gravité | Statut |
|---|---|---|---|
| Console | Aucune information sur le dernier import ; l'action principale (importer) n'est accessible que par un raccourci en bas de page. | 3 | **Corrigé** : boutons « Importer un export AJIR » et « Gérer les comptes » dans l'en-tête ; tuile « Dernier import (score qualité) » avec statut, en tête avec les alertes et le worker. |
| Santé des données | Le formulaire de téléversement se trouvait **sous six graphiques** de tendance. | 3 | **Corrigé** : indicateurs → import → historique → contrôles → tendances, avec un sommaire « Sur cette page ». |
| Téléversement | Un export sans `departments.csv` ou `employees.csv` était accepté puis l'import échouait dans le worker (statut ÉCHEC, alerte critique). | 3 | **Corrigé** : contrôle avant envoi, message qui nomme les fichiers manquants. |
| Téléversement | Pas d'aperçu des fichiers choisis : un fichier mal nommé n'est signalé qu'après le clic. | 2 | **Corrigé** : liste des fichiers sélectionnés, « reconnu » / « non prévu » et taille. |
| Après l'envoi | Le message indiquait un chemin serveur (`data/inbox/…`) sans dire quoi faire ; il fallait recharger la page à la main pour voir le résultat. | 3 | **Corrigé** : message orienté vers l'action, actualisation automatique toutes les 5 s tant qu'un import ou un calcul est en file (suspendable, arrêtée si le worker ne répond pas). |
| Vérification | Les tuiles « Score qualité » et « Lignes rejetées » ne menaient pas au détail des contrôles. | 2 | **Corrigé** : liens vers les contrôles de l'import concerné. |

## 2. Constats par écran (heuristiques)

| # | Écran | Rôle | Heuristique | Gravité | Constat → correction |
|---|---|---|---|---|---|
| E1 | Tableau de bord | RH, Manager | H8, H6 | 3 | Hiérarchie : risque élevé en premier, indicateurs d'effectif ensuite, tendances puis détail par département. |
| E2 | Tableau de bord | RH, Manager | H7 | 3 | Bandeau « À traiter » ([shortcuts.tsx](../../src/components/ux/shortcuts.tsx)) ; texte complet dans le lien (« 3 nouvelles alertes, dont 1 critique »), couleur doublée du mot « critique ». |
| E3 | Tableau de bord | RH, Manager | H7 | 2 | Liens d'analyse sur les visuels : « Voir les risques élevés » (anneau), « Analyser » (absentéisme mensuel), « Analyser par département » (carte de chaleur). |
| E4 | Tableau de bord | RH, Manager | H9 | 2 | États vides qui disent quoi faire : sans calcul publié, date du prochain calcul et lien vers Santé des données (RH) ; sans résultat, invitation à élargir ou réinitialiser les filtres. |
| E5 | Tableau de bord | RH | H6 | 2 | Tri des départements par exposition (voir parcours RH). |
| E6 | Absentéisme | RH, Manager | H1, H8 | 2 | Tuiles de synthèse avec courbe (taux sur la période, groupe le plus touché, anomalies collectives, signaux individuels pour la RH seule), liens vers les sections. |
| E7 | Absentéisme | RH, Manager | H3 | 2 | Retour contextuel : paramètre `retour` validé (chemin interne `/dashboard` uniquement, pas de redirection ouverte), conservé quand on change de filtre. |
| E8 | Absentéisme | RH, Manager | H7 | 2 | Lien « Alertes d'absentéisme » depuis les anomalies collectives. |
| E9 | Absentéisme | RH, Manager | H9 | 2 | État vide : suggère la granularité « Mois », renvoie la RH vers Santé des données, le manager vers la RH. |
| E10 | Santé des données | ADMIN, RH | H8, H7 | 3 | Réorganisation et sommaire (voir parcours admin). |
| E11 | Santé des données | ADMIN | H5 | 3 | Contrôle des fichiers obligatoires et aperçu avant envoi. |
| E12 | Santé des données | ADMIN, RH | H1 | 3 | Actualisation automatique pendant un traitement ([auto-refresh.tsx](../../src/components/ux/auto-refresh.tsx)). |
| E13 | Santé des données | ADMIN, RH | H9 | 2 | Import introuvable : numéro rappelé, lien vers l'historique ; historique vide : message différent selon le rôle (l'ADMIN importe, la RH attend). |
| E14 | Transparence | ADMIN, RH | H8 | 2 | Ordre KPI → tendance → détail : fiche du modèle et 4 indicateurs clés (AUC, lift, calibration, pente) en tête, puis suivi mensuel, puis évaluation détaillée, équité, variables, paramètres et versions ; sommaire « Sur cette page ». |
| E15 | Transparence | ADMIN, RH | H10 | 1 | Sans champion : indique que la mise en service passe par la procédure outillée. |
| E16 | Backtesting | RH | H4 | 1 | Titre du document aligné (« — People Analytics AJIR ») ; groupe et collaborateur en en-têtes de ligne. |
| E17 | Backtesting | RH | H6 | 1 | Effectif et ordre (« par rang ») dans le titre du tableau des salariés ; démissions en gras. |
| E18 | Backtesting | RH | H9 | 1 | Sans champion : lien vers Transparence du modèle. |
| E19 | Console | ADMIN | H4 | 1 | Libellés de liens explicites : « Voir le journal », « Voir dans le journal » (au lieu de « Journal », « Filtrer », qui annonçait un filtre sur place). |
| E20 | Tous les écrans de mon périmètre | tous | H1 | 2 | Squelettes qui reprennent la forme de l'écran (`RouteLoading` : variantes `dashboard`, `list`, `report`) au lieu d'un gabarit unique. |

## 3. Composants ajoutés (réutilisables)

- [src/components/ux/breadcrumb.tsx](../../src/components/ux/breadcrumb.tsx) : `Breadcrumb` (fil d'Ariane, `aria-current="page"` sur le dernier élément) et `safeReturn(raw, cheminsAutorisés)` (retour contextuel sans redirection ouverte).
- [src/components/ux/shortcuts.tsx](../../src/components/ux/shortcuts.tsx) : `ShortcutBar`, bandeau « À traiter ».
- [src/components/ux/on-this-page.tsx](../../src/components/ux/on-this-page.tsx) : `OnThisPage`, sommaire d'ancres pour les pages longues.
- [src/components/ux/auto-refresh.tsx](../../src/components/ux/auto-refresh.tsx) : `AutoRefresh`, actualisation pendant un traitement asynchrone, bouton Suspendre (WCAG 2.2.2), pause onglet masqué.
- [src/components/pilotage/route-states.tsx](../../src/components/pilotage/route-states.tsx) : `RouteLoading` accepte `variant` (compatible avec les appels existants).

Fichiers modifiés : `dashboard/page.tsx` et `loading.tsx`, `absenteeism/page.tsx` et `loading.tsx`, `data-health/page.tsx`, `admin-controls.tsx` et `loading.tsx`, `transparency/page.tsx` et `loading.tsx`, `backtesting/page.tsx` et `loading.tsx`, `admin/page.tsx`.

Contrats préservés : libellés visés par les tests E2E (« Collaborateurs en risque élevé », boutons « Téléverser… » et « Recalculer », lien unique « Réinitialiser », « Contrôles de l'import n° … » affiché une seule fois), DTO par rôle inchangés (aucune donnée nouvelle côté manager ; les nombres affichés dans les tuiles d'absentéisme figurent déjà dans le tableau), aucune modification de la DAL.

## 4. À appliquer après le restyle

Fichiers hors de mon périmètre d'édition (restyle ArabSoft en cours). Chaque point indique le fichier, l'élément et le changement proposé.

### 4.1 Retour contextuel vers la liste (gravité 3)

- **`src/app/(app)/employees/(liste)/page.tsx`**, lien du nom dans `Cells` : `href={`/employees/${r.id}`}` → `buildHref(`/employees/${r.id}`, { retour: buildHref("/employees", params) })` (garder `page`).
- **`src/app/(app)/employees/[id]/page.tsx`**, lien « Collaborateurs » en tête : lire `searchParams.retour` avec `safeReturn(raw, ["/employees", "/backtesting", "/absenteeism", "/recommendations", "/alerts"])` ([breadcrumb.tsx](../../src/components/ux/breadcrumb.tsx)) et remplacer le lien par `<Breadcrumb items={[{ label: libellé de l'origine, href: retour ?? "/employees" }, { label: nom du salarié }]} />`. Libellé selon l'origine : « Collaborateurs » (« Mon équipe » pour un manager), « Backtesting », « Absentéisme », « Recommandations », « Alertes ».
- Même ajout du paramètre `retour` sur les liens vers la fiche dans `backtesting/page.tsx`, `absenteeism/page.tsx` (signaux individuels), `recommendations/page.tsx` : je ne l'ai pas posé dans mes pages tant que la fiche ne le lit pas, pour ne pas créer de paramètre mort.
- **`src/app/(app)/alerts/[id]/page.tsx`**, lien « Toutes les alertes » : même mécanisme avec `retour` posé par `alerts/page.tsx` (filtres type, statut, sévérité conservés).
- **`src/app/(app)/employees/(liste)/page.tsx`** : quand l'URL contient `retour=/dashboard…` (à poser alors par le tableau de bord, voir `toList` dans `dashboard/page.tsx`), afficher `Breadcrumb` « Tableau de bord › Collaborateurs » et propager `retour` via `FilterForm hidden` et `Pagination params`.

### 4.2 Filtres (`src/components/pilotage/filters.tsx`)

- **`ActiveFilters`**, gravité 2 : distinguer les paramètres *invalides* des paramètres *non applicables au rôle*. Ajouter une prop `restricted?: string[]` (alimentée par `restrictDashboardQuery(...).dropped`) affichée en ton neutre : « Filtres contrat, âge et ancienneté non disponibles dans la vue manager : ignorés. » ; garder l'avertissement ambre pour les vraies valeurs invalides. Traduire les clés techniques (`anciennete` → « Ancienneté »).
- **`ActiveFilters`**, gravité 2 : rendre chaque filtre actif retirable (puce « Département : Production × » = lien sans ce paramètre). Attention : les tests E2E cherchent le texte « Filtres actifs : … » et un lien unique nommé « Réinitialiser » ; libeller les puces « Retirer le filtre Département » (texte masqué) pour ne pas entrer en collision.
- **`FilterForm`**, gravité 1 : n'afficher « Réinitialiser » que si au moins un filtre diffère des valeurs par défaut (comme `alerts/page.tsx`) ; bouton « Appliquer » inchangé (soumission explicite, pas d'envoi automatique au changement de liste, qui gênerait la navigation au clavier).
- **`Pagination`**, gravité 1 : liens « Première » / « Dernière » page dès que `pageCount > 3`.

### 4.3 Liste des collaborateurs (`src/app/(app)/employees/(liste)/page.tsx`)

- Gravité 2 : action « Exporter (CSV) » de la liste filtrée pour la RH (préparation des entretiens), avec audit `employee.export` côté DAL.
- Gravité 1 : pour la RH, colonne « Recommandation en attente » (oui/non, lien vers la fiche), pour voir sans ouvrir chaque fiche qui attend une décision.

### 4.4 Recommandations (`src/app/(app)/recommendations/page.tsx`)

- Tuile « Recommandations » (hint « N en attente de décision ») : `href={buildHref("/recommendations", { statut: "PROPOSEE", departement: q.departement })}`.
- Gravité 2 : décision depuis la liste. Réutiliser `DecideForm` ([recommendation-forms.tsx](../../src/components/pilotage/recommendation-forms.tsx)) dans une ligne dépliable (`<details>` « Décider ») pour les lignes `PROPOSEE`, avec les mêmes Server Actions que la fiche (`decideRecommendationAction`), et `revalidatePath("/recommendations")`.

### 4.5 Alertes (`src/app/(app)/alerts/page.tsx`, `alerts/[id]/page.tsx`)

- Liste, gravité 2 : colonne « Concerne » : lien vers la fiche quand `employeeId` est présent et que le rôle y a accès (RH, manager dans son périmètre), vers `/absenteeism?departement=` pour une alerte de département (RH).
- Liste, gravité 2 : pas de pagination (limite 200) : ajouter `Pagination` et un compteur « N alertes » au-dessus du tableau.
- Liste, gravité 1 : rendre le titre de l'alerte cliquable (cible plus grande que « Détail »).
- Détail, gravité 2 : « Collaborateur » en lien vers la fiche ; remplacer « Ouvrir l'élément concerné » par un libellé dérivé du type (« Voir la fiche », « Voir l'absentéisme », « Voir la santé des données »).
- Détail, gravité 1 : après une transition (« En cours », « Traitée »), proposer « Alerte suivante » (prochaine alerte `NOUVELLE` visible) pour enchaîner le tri.

### 4.6 Fiche collaborateur (`src/components/pilotage/employee-detail.tsx`, `what-if-panel.tsx`)

- Gravité 1 : sommaire « Sur cette page » (`OnThisPage`) vers les trois zones (Observations, Estimation, Suggestions) et la simulation, utile sous `lg` où les zones s'empilent.
- Gravité 1 : dans `what-if-panel.tsx`, message d'attente pendant le calcul sous forme de squelette des deux colonnes avant/après plutôt qu'un simple libellé de bouton.

### 4.7 Gabarit (`src/app/(app)/layout.tsx`, `sidebar.tsx`)

- Gravité 2 : champ de recherche d'un collaborateur (nom ou matricule) dans l'en-tête pour la RH et le manager, en `<form action="/employees">` avec `name="q"` : accès direct à une fiche depuis n'importe quel écran.
- Gravité 1 : le badge d'alertes du menu compte les alertes ouvertes (nouvelles et en cours) ; son lien pourrait viser `/alerts?status=NOUVELLE` quand il y a des nouvelles alertes, cohérent avec le bandeau « À traiter ».

### 4.8 Connexion (`src/app/login/**`, `src/lib/dal/context.ts`)

- Gravité 2 : après expiration de session (10 h), `pageContext` redirige vers `/login` sans mémoriser la page demandée. Ajouter `?suite=<chemin>` (validé comme `safeReturn`, chemins internes seulement) et rediriger vers ce chemin après connexion s'il est autorisé pour le rôle, sinon `homePath(role)`. `context.ts` est partagé : à arbitrer avec l'équipe sécurité.

### 4.9 Administration (`src/app/(app)/admin/audit/page.tsx`)

- Gravité 1 : pagination du journal propre à la page (« Page précédente / suivante ») : réutiliser `Pagination` de `filters.tsx` pour la cohérence avec les autres listes.

## 5. Restant

1. **Validation visuelle** : les réorganisations (santé des données, transparence, tableau de bord) sont à revoir à l'écran une fois le restyle terminé, en 320 px et en 1440 px, et par la suite Playwright (`npm run test:e2e`), non lancée ici.
2. **Filtres persistants entre écrans** : ils sont dans l'URL (partageables, conservés par Précédent), mais passer par le menu repart des valeurs par défaut. Une mémorisation par cookie n'a pas été ajoutée : elle masquerait l'état réel des filtres, et le retour contextuel (§4.1) couvre le besoin principal.
3. **Comptage des alertes nouvelles** du bandeau « À traiter » : `listAlerts(..., { limit: 500 })` ; au-delà de 500 alertes nouvelles le nombre est plafonné. Une fonction `countAlerts(ctx, { status })` dans la DAL (hors périmètre) serait plus juste et plus légère.
4. **Fichiers obligatoires de l'import** : la liste `departments.csv`, `employees.csv` est dupliquée dans `admin-controls.tsx` ; l'exporter depuis `src/lib/import/index.ts` (constante `MANDATORY`, hors périmètre) éviterait la divergence.

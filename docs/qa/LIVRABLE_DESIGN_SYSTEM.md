# Livrable — design system, connexion 3D et ergonomie

Projet : People Analytics, module d'aide à la décision RH du SIRH AJIR (ArabSoft). Période : 02 au 04/10/2026.
Sessions : 0e (design system, intégration, vérification finale), 4e (enrichissement), 40 puis a7 (visuels, menu, Paramètres), e9 puis 1a (ergonomie, marques des graphiques).
Fil conducteur : le brief initial (connexion 3D discrète, design system cohérent, responsive et WCAG AA, sans toucher à la logique métier, aux routes API ni à la base).

## 1. Résumé

- Connexion : constellation 3D (three + React Three Fiber) chargée au repos de la page. Repli SVG fixe sur écran étroit, appareil modeste, WebGL logiciel et mouvement réduit. Formulaire avec œil, erreurs reliées au champ et état « Connexion… ».
- Design system : jetons `--pa-*` en clair et en sombre (sans flash), toasts, squelettes, états vides, confirmations, mouvements de 150 à 200 ms, menu réductible, recherche Ctrl+K.
- Ergonomie et visuels : six domaines audités (gravité Nielsen), graphiques remappés en sombre, impression et export CSV.
- Aucune migration ni changement de schéma. Côté API, seules `/api/export` et `/api/search` sont neuves (chantier enrichissement).
- Vérification : tsc 0 erreur, vitest 1 079 réussis / 1 ignoré, build sans erreur ni avertissement, E2E 153 tests, 0 échec (passe complète 152/152 en 13,2 min, puis `auth.spec.ts` 15/15 après ajout du test « champs vides »), axe 0 violation (43/43 en clair, 21/21 en sombre, 1/1 menu réduit).

## 2. Plan d'amélioration

Chaque étape a un objectif, un contenu et un critère de sortie. Toutes sont réalisées ; la dernière attend le contrôle navigateur.

### Étape 1 — Socle de jetons et thème
- Objectif : une seule source de couleurs, lisible dans les deux thèmes.
- Contenu : jetons sémantiques dans `globals.css`, exposés à Tailwind (`bg-surface`, `text-fg`, `text-heading`, `border-line`, `bg-primary`, `bg-danger-soft`…). Plus aucune couleur fixe (`bg-white`, `text-slate-*`) dans les composants partagés.
- Thème : script en ligne dans `<head>`, avant le premier affichage. Choix `pa-theme` = clair, sombre ou système (défaut). Attribut `data-theme` sur `<html>`.
- Bascule `ThemeToggle` dans l'en-tête, dans Mon compte et dans la palette Ctrl+K. Changement annoncé aux lecteurs d'écran.
- `ThemeSync` repasse en clair le temps d'une impression. La classe `pa-theme-switching` coupe les transitions pendant la bascule.
- Critère : contrastes AA calculés dans les deux thèmes ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) § 7), figés par un test.

### Étape 2 — Connexion 3D
- Objectif : un élément 3D discret qui ne ralentit jamais le formulaire.
- Gabarit `AuthShell` : panneau marine à gauche dès 1 024 px, bandeau compact en dessous. Le formulaire ne recouvre jamais la scène.
- Chargement différé : la scène est un module séparé (`next/dynamic`, `ssr: false`). Elle n'est demandée qu'après `requestIdleCallback`, une fois la page au repos.
- Repli fixe : SVG rendu côté serveur, même figure et même cadrage que la caméra. Pas de fichier image à charger, net à toute résolution, couleurs du thème.
- Raisons du repli, lisibles dans `data-reason` : écran étroit (< 1 024 px), mouvement réduit, appareil modeste (≤ 2 cœurs ou ≤ 2 Go), économie de données, WebGL absent ou logiciel, erreur ou perte de contexte WebGL.
- `prefers-reduced-motion` : la scène ne se charge pas ; un changement de préférence en cours de visite est pris en compte.
- Sobriété : rotation lente (un tour en 2 min), parallaxe amortie, rendu suspendu onglet caché ou scène hors écran, `aria-hidden`, `pointer-events: none`.
- Formulaire : bouton œil (`aria-pressed`), alerte Verr. Maj., erreur générique reliée au champ, focus rendu au mot de passe, identifiant conservé, bouton « Connexion… » désactivé pendant l'envoi.
- Critère : formulaire utilisable avant la scène, aucune erreur console ni violation CSP (E2E « Connexion 3D »).

### Étape 3 — Composants
- Objectif : des briques communes, pour que chaque écran se comporte de la même façon.
- `@/components/ui` : `Button`, `ButtonLink`, `SubmitButton` (4 variantes, 40 px, état en cours, raison de désactivation), `ConfirmButton`, `toast` et `Toaster`, `SkeletonPage` et ses briques, `EmptyState`, `Notice`, `Alert`, `DataTable`, `SortHeader`, `ActionBar`, `MoreActions`, `PageHeader`, `KpiTile`, `Steps`, badges.
- `@/components/ux` : fil d'Ariane et `safeReturn`, sommaire `OnThisPage`, `MobileCollapse`, palette Ctrl+K.
- Règle : API additive, aucun export renommé ni retiré. Mode d'emploi : catalogue de [DEMANDES_COMPOSANTS.md](DEMANDES_COMPOSANTS.md).

### Étape 4 — Pages métier
- Objectif : toutes les pages sur les jetons et les composants communs.
- Contenu : 26 pages de l'application, plus connexion, activation, accès refusé et 404. Un `loading.tsx` à la forme de la page sur 23 routes. Un `error.tsx` sur 25 routes (`RouteError`).
- Branchements du chantier enrichissement : export CSV, impression, filtrage croisé depuis les graphiques, palette Ctrl+K, rétention, organigramme ([BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md)).

### Étape 5 — Visuels
- Objectif : des graphiques lisibles dans les deux thèmes, au style « Power BI » de la charte.
- Kit `pbi.tsx`, helpers `builders.ts`, wrapper `EChart` : formats français, titre qui dit le message, tableau « Voir les données ».
- Sombre : remappage à l'affichage (`darkOption`, `DARK_COLORS`, `cssChartColor`). Palette catégorielle de 6 teintes passée au validateur dataviz.
- Marques : courbe de 2 px, repère au survol seulement, barres de 24 px au plus, anneau à 56–72 %. Sous 640 px, libellés sur deux lignes avec « … ».
- Menu réductible en rail d'icônes, page Paramètres refaite, écrans de monitoring (console, santé des données, dérive, transparence, vérification a posteriori).

### Étape 6 — Ergonomie
- Objectif : supprimer les frictions de parcours, gravité 3 et 2 d'abord.
- Grille commune ([CHARTE_UI.md](CHARTE_UI.md), [CHANTIER_ERGONOMIE.md](CHANTIER_ERGONOMIE.md)) appliquée à six domaines.
- Exemples : retours contextuels (`retour=`) vers l'écran d'origine (synthèse, équipes, organigramme, alertes, interventions, charge, formations), barre de filtres en un seul repli, états en cours après confirmation, états vides « quoi + pourquoi + action », vérification des mots de passe avant envoi, recherche dans l'aide.
- Bilans : [ergonomie/](ergonomie/) (UI, PILOT, COLLAB, ACTION, IA, COMPTE, CHARTS).

### Étape 7 — Accessibilité
- Objectif : WCAG 2.2 AA dans les deux thèmes et en menu réduit.
- Contenu : focus visible partout, lien d'évitement, cibles de 40 px (24 px au moins pour les liens denses), toasts en `aria-live`, statuts en mots, alternative « Voir les données », animations neutralisées par `prefers-reduced-motion`.
- Critère : axe-core sur 43 pages en clair, 21 en sombre, 1 en menu réduit (`tests/e2e/a11y.spec.ts`). Résultat : 0 violation (43/43 en clair, 21/21 en sombre, 1/1 menu réduit).

## 3. Fichiers par domaine

Chemins vérifiés sur le disque le 04/10. Liens relatifs à ce document.

### Design system
- [globals.css](../../src/app/globals.css) : jetons `--pa-*` clair et sombre, variante `dark:`, focus, animations, `prefers-reduced-motion`, couleurs `--pa-chart-*`.
- [layout.tsx (racine)](../../src/app/layout.tsx) : script de thème, `ThemeSync`, `Toaster` monté une fois.
- [theme-script.ts](../../src/components/ui/theme-script.ts) : script avant affichage.
- [theme.tsx](../../src/components/ui/theme.tsx) : `ThemeToggle`, `useTheme`, `setTheme`, `ThemeSync`.
- [classes.ts](../../src/components/ui/classes.ts) : `cardCls`, `tableCls`, `fieldCls`.

### Connexion 3D
- [login/page.tsx](../../src/app/login/page.tsx), [login-form.tsx](../../src/app/login/login-form.tsx) : page et formulaire.
- [login/actions.ts](../../src/app/login/actions.ts), [next-path.ts](../../src/app/login/next-path.ts) : messages d'erreur et retour à la page demandée (logique d'authentification inchangée).
- [auth-shell.tsx](../../src/components/auth/auth-shell.tsx) : gabarit des pages publiques.
- [constellation.tsx](../../src/components/auth/constellation.tsx) : choix 3D ou repli, chargement différé, bornage d'erreur.
- [constellation-scene.tsx](../../src/components/auth/constellation-scene.tsx) : scène React Three Fiber.
- [constellation-static.tsx](../../src/components/auth/constellation-static.tsx) : repli SVG et variables de couleur par thème.
- [constellation-data.ts](../../src/components/auth/constellation-data.ts) : figure et caméra partagées par la 3D et le SVG.
- [constellation-support.ts](../../src/components/auth/constellation-support.ts) : `staticReason`, `isSoftwareRenderer` (fonctions pures).
- [password-field.tsx](../../src/components/auth/password-field.tsx), [password-rules.ts](../../src/components/auth/password-rules.ts) : champ commun (connexion, activation, Mon compte).
- [activation/](../../src/app/activation/) : même gabarit et même champ.

### Composants UI
- [ui/button.tsx](../../src/components/ui/button.tsx) : boutons, `FormActions`, `ActionBar`, éléments de menu.
- [ui/confirm.tsx](../../src/components/ui/confirm.tsx) : `ConfirmButton`, `ConfirmDialog`, `SubmitButton`.
- [ui/toast.tsx](../../src/components/ui/toast.tsx) : `toast`, `Toaster`, `useActionToast`, `withActionToast`, `toastResult`.
- [ui/skeleton.tsx](../../src/components/ui/skeleton.tsx) : `SkeletonPage` (4 variantes) et briques.
- [ui/data-table.tsx](../../src/components/ui/data-table.tsx), [ui/sort-header.tsx](../../src/components/ui/sort-header.tsx) : tableau trié, cartes sous 640 px, en-tête de tri serveur.
- [ui/index.tsx](../../src/components/ui/index.tsx), [ui/insight.tsx](../../src/components/ui/insight.tsx), [ui/more-actions.tsx](../../src/components/ui/more-actions.tsx), [ui/icons.tsx](../../src/components/ui/icons.tsx) : en-têtes, cartes, badges, `EmptyState`, `Notice`, `fmt`, blocs de lecture rapide, menu « Plus d'actions », icônes.
- [ux/](../../src/components/ux/) : `breadcrumb`, `on-this-page`, `mobile-collapse`, `auto-refresh`, `shortcuts`, `command-palette` et `command-palette-items`.
- [help/](../../src/components/help/) : bulles `InfoTip` et `TermTip`, `PageIntro`, explication des niveaux.
- [export/](../../src/components/export/) : `ExportButton`, `PrintButton`, `PrintHeader`, `print.css`.
- [pilotage/route-states.tsx](../../src/components/pilotage/route-states.tsx), [filters.tsx](../../src/components/pilotage/filters.tsx), [filter-fields.tsx](../../src/components/pilotage/filter-fields.tsx) : erreurs et chargements de route, barre de filtres commune.

### Layout et menu
- [(app)/layout.tsx](<../../src/app/(app)/layout.tsx>) : en-tête (recherche, date des données, thème, compte, déconnexion), lien d'évitement, `print.css`, palette.
- [layout/sidebar.tsx](../../src/components/layout/sidebar.tsx) : `NAV`, menu latéral, menu mobile, bouton « Réduire le menu », `BrandMark`.
- [layout/nav-rail.tsx](../../src/components/layout/nav-rail.tsx), [layout/nav-script.ts](../../src/components/layout/nav-script.ts) : menu réduit mémorisé (`pa-nav`), posé avant affichage.

### Graphiques
- [charts/theme.ts](../../src/components/charts/theme.ts) : palette sémantique et catégorielle, `DARK_COLORS`, `CHART_INK`.
- [charts/echart.tsx](../../src/components/charts/echart.tsx) : wrapper client (thème, formats, mobile, clic de filtrage, squelette avant hydratation).
- [charts/builders.ts](../../src/components/charts/builders.ts), [charts/pbi.tsx](../../src/components/charts/pbi.tsx), [charts/drill.ts](../../src/components/charts/drill.ts) : helpers, kit KPI et visuels, filtrage croisé.
- [monitoring/](../../src/components/monitoring/) : options des écrans de données et modèle.
- [transparency/calibration-chart.tsx](<../../src/app/(app)/transparency/calibration-chart.tsx>).

### Pages
- [(app)/](<../../src/app/(app)/>) : 26 `page.tsx`, 23 `loading.tsx`, 25 `error.tsx`, `not-found.tsx`.
- Hors gabarit : [interdit/page.tsx](../../src/app/interdit/page.tsx), [not-found.tsx](../../src/app/not-found.tsx).
- Paramètres : [admin/settings/](<../../src/app/(app)/admin/settings/>) et [components/admin/](../../src/components/admin/) (`settings-form`, `settings-labels`, `settings-nav`, `settings-row`, `settings-save-bar`, `settings-skeleton`, `settings-tables`).

### Tests
- [tests/components/design-system.test.ts](../../tests/components/design-system.test.ts) : thème, contrastes AA, graphiques sombres, toasts, squelettes, `DataTable`.
- [tests/components/](../../tests/components/) : `ui.test.ts`, `ergonomie-ui.test.ts`, `charts.test.ts`.
- [tests/ui-admin/login-constellation.test.ts](../../tests/ui-admin/login-constellation.test.ts) : choix 3D ou repli, WebGL sondé en dernier, rendus logiciels, figure.
- [tests/layout/sidebar.test.ts](../../tests/layout/sidebar.test.ts) : menu, rail, en-tête, contrastes du menu.
- [tests/search/palette.test.ts](../../tests/search/palette.test.ts) : palette Ctrl+K par rôle.
- [tests/export/](../../tests/export/) : CSV, boutons, impression en clair.
- [tests/settings/](../../tests/settings/), [tests/charts/](../../tests/charts/), [tests/charts-marks/](../../tests/charts-marks/), `tests/ergo-{pilot,collab,action,ia,compte}/`, `tests/monitoring-{admin,data,model}/`.
- E2E : [auth.spec.ts](../../tests/e2e/auth.spec.ts) (formulaire, 3 tests « Connexion 3D »), [a11y.spec.ts](../../tests/e2e/a11y.spec.ts) (axe clair, sombre, menu réduit), [navigation.spec.ts](../../tests/e2e/navigation.spec.ts) (menu par rôle, CSP, menu réduit), [admin.spec.ts](../../tests/e2e/admin.spec.ts) (Paramètres côté navigateur), plus les parcours métier.

### Docs
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (jetons, thème, mouvement, contrastes), [CHARTE_UI.md](CHARTE_UI.md) (écrans, boutons, textes, visuels).
- [DEMANDES_COMPOSANTS.md](DEMANDES_COMPOSANTS.md) (catalogue), [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md), [CHANTIER_VISUELS.md](CHANTIER_VISUELS.md), [CHANTIER_ERGONOMIE.md](CHANTIER_ERGONOMIE.md), [ergonomie/](ergonomie/) (7 bilans).
- [VERIFICATION_FINALE.md](VERIFICATION_FINALE.md), captures dans [captures/design-system/](captures/design-system/).

## 4. Installation

Commandes du brief, déjà exécutées :

```powershell
npm install three @react-three/fiber
npm install -D @types/three
```

Versions dans `package.json` : `three` ^0.186.1 et `@react-three/fiber` ^9.8.1 (dépendances), `@types/three` ^0.186.0 (développement). Versions installées : 0.186.1, 9.8.1 et 0.186.0.
- React Three Fiber 9 demande React 19 : le projet est en React 19.2.8.
- Pas de `@react-three/drei` : la scène n'utilise que le cœur de three.
- R3F 9.8 crée encore un `THREE.Clock`, déprécié depuis three r183. Seul cet avertissement est filtré, dans `constellation-scene.tsx`.
- Après un `git clone` : `npm ci` suffit, aucune étape propre à la 3D.

## 5. Comment tester

### Préparer
- Essai manuel : `npm run dev` (port 3000, base `data/app.db`).
- Essai qui écrit (toasts, rejets, Paramètres enregistrés) : serveur isolé sur une copie de base, `$env:E2E_SKIP_BUILD="1"; node tests/e2e/server.mjs` (port 3200, `data/e2e.db` ; réutilise le build `.next-e2e` s'il existe).
- Comptes : `admin` (ADMIN), `rh.demo` (RH), `mgr.M10451` (MANAGER, équipe de S. Zribi). Mots de passe de démonstration : tableau des comptes de [docs/DEMO.md](../DEMO.md) et `USERS` de [tests/e2e/helpers.ts](../../tests/e2e/helpers.ts). Ils ne sont pas recopiés ici.
- Outils : Chrome DevTools, barre d'appareils (390 × 844) et panneau Rendering (émulation `prefers-reduced-motion` et `prefers-color-scheme`).

### Sans compte : connexion 3D
1. Desktop (1 440 px) : ouvrir `/login`. Le formulaire est saisissable tout de suite. Dans l'inspecteur, `[data-constellation]` passe de `pending` à `loading` puis `3d`. Dans l'onglet Réseau, le module three n'arrive qu'après le premier affichage.
2. Accélération matérielle coupée (paramètres de Chrome) : `data-constellation="static"`, `data-reason="webgl-logiciel"` ou `"webgl-indisponible"`.
3. Mobile (390 px) : bandeau marine avec la constellation fixe, `data-reason="ecran-etroit"`, aucun défilement horizontal.
4. Mouvement réduit : activer l'émulation, recharger. Attendu : `data-reason="mouvement-reduit"`, aucune animation.
5. Thème : la bascule en haut à droite change les couleurs de la scène et du SVG sans recharger.
6. Formulaire : « Afficher le mot de passe » bascule `aria-pressed` et le type du champ. Un mauvais mot de passe affiche « Identifiant ou mot de passe incorrect… », le curseur revient au mot de passe. Pendant l'envoi, le bouton affiche « Connexion… ». Verr. Maj. active une alerte sous le champ.

### RH (`rh.demo`)
1. Thème : bouton de l'en-tête (icône seule sous 1 536 px), choisir Sombre, recharger. Attendu : pas de flash clair, graphiques recolorés. Mon compte propose les trois mêmes choix.
2. Ctrl+K (ou « / » hors champ) : saisir « absent » puis un nom de collaborateur. Les groupes Pages, Collaborateurs, Alertes ouvertes et Actions apparaissent. « Passer au thème clair » agit. Échap ferme et rend le focus.
3. Export CSV : `/employees?niveau=ELEVE`, bouton « Exporter (CSV) ». Le fichier reprend les filtres. Même bouton sur `/alerts` et `/recommendations`. L'export apparaît au journal d'audit de l'ADMIN.
4. Impression : `/synthese`, « Imprimer la synthèse ». Puis Ctrl+P sur `/dashboard` en thème sombre. Attendu : aperçu en couleurs claires, menu et en-tête masqués, pied « Page n sur N ».
5. Menu réduit : « Réduire le menu » dans l'en-tête. Rail d'icônes, bulles au survol et au focus, choix conservé au rechargement. « Déployer le menu » rétablit.
6. Retours (base E2E) : rejeter une recommandation sur `/recommendations`. Boîte de confirmation avec motif obligatoire, puis toast « Recommandation rejetée. ».
7. Squelettes : réseau ralenti (« Slow 4G »), ouvrir une entrée du menu. Le squelette a la forme de la page.

### MANAGER (`mgr.M10451`)
1. Thème et menu réduit : comme la RH.
2. Ctrl+K : seuls les collaborateurs de son périmètre sont proposés.
3. Export CSV sur la liste « Mon équipe » : colonnes du rôle, sans salaire ni probabilité.
4. Impression de `/synthese` : en-tête « Votre équipe (périmètre hiérarchique) ».
5. `/admin/settings` renvoie vers `/interdit`.

### ADMIN (`admin`)
1. Console `/admin` en sombre : anneau des rôles lisible, séparateurs à la couleur de la surface.
2. Ctrl+K : pages d'administration et actions, aucune invite à chercher un collaborateur.
3. Paramètres `/admin/settings`, sans enregistrer sur `data/app.db` :
   - modifier « Capacité mensuelle » : badge « Modifié », compteur du thème, récapitulatif ;
   - « Rétablir la valeur par défaut », puis « Annuler les modifications » ;
   - saisir 50 : erreur immédiate « Maximum 20 % », champ en `aria-invalid` ;
   - barème SMIG : « Ajouter une période » puis « Retirer la période » ;
   - au défilement, le thème en cours est surligné dans la navigation de gauche.
4. Menu réduit puis 390 px : en-tête sans débordement.

### Tests automatisés
- Unitaires ciblés : `npx vitest run tests/components tests/ui-admin/login-constellation.test.ts tests/layout tests/search tests/export tests/settings --maxWorkers=2`.
- E2E complets : `npm run test:e2e` (build `.next-e2e`, copie de base, 1 worker, port 3200).
- Connexion 3D seule : `npx playwright test tests/e2e/auth.spec.ts -g "Connexion 3D"`.
- Captures : serveur 3200 lancé, puis `node docs/qa/captures/design-system/final/ds-final-captures.mjs`.

## 6. Checklist du brief

### 6.1 Vérification finale (04/10)
- TypeScript (`npx tsc --noEmit`) : 0 erreur.
- ESLint (`npx eslint .`) : 0 problème.
- Vitest (hors `tests/security`) : 1 079 réussis, 1 ignoré, 126 fichiers, 0 échec.
- Build de production (`npx next build`) : 0 erreur, 0 avertissement, 42 pages.
- E2E Playwright (`npm run test:e2e`) : 153 tests, 0 échec (passe complète 152/152 en 13,2 min, puis `auth.spec.ts` 15/15 après ajout du test « champs vides »).
- Axe-core (43 pages en clair, 21 en sombre, 1 en menu réduit) : 0 violation (43/43 en clair, 21/21 en sombre, 1/1 menu réduit).
- Captures finales (`docs/qa/captures/design-system/final/`, 136 prévues) : 124 écrites en 11,6 min, 6 refus de rôle journalisés, 0 avertissement de stabilité, 0 erreur de page. Les 4 captures de la page de connexion ont été sautées par un bug du script (corrigé) : à refaire avec `ONLY=connexion`. Relecture : 18 défauts (1 majeur, 6 moyens, 11 mineurs), corrigés le 04/10 (voir § 7).

### 6.2 Connexion
- [x] Élément 3D discret avec Three.js et React Three Fiber. Preuve : `constellation-scene.tsx` ; capture `captures/design-system/connexion/apres/login-clair-1440.png`.
- [x] Chargé en différé, formulaire utilisable avant la scène. Preuve : `constellation.tsx` (`next/dynamic`, `requestIdleCallback`) ; E2E « 1440 px : formulaire utilisable avant la scène » ; `connexion/apres/rapport.json` (02/10 : 3D à 1 440 px, repli à 390 px, aucune erreur console ni CSP).
- [x] Image fixe de repli sur mobile. Preuve : `constellation-static.tsx`, `auth-shell.tsx` ; E2E « 390 px : repli statique » ; capture `login-clair-390.png`.
- [x] Repli sur appareil faible (≤ 2 cœurs ou ≤ 2 Go, économie de données, WebGL logiciel ou absent, perte de contexte). Preuve : `constellation-support.ts` ; `login-constellation.test.ts`. Pas de test navigateur dédié (voir § 7).
- [x] Respect de `prefers-reduced-motion`. Preuve : `staticReason` et écoute du changement dans `constellation.tsx`, règle globale de `globals.css` ; E2E « mouvement réduit : repli statique ».
- [x] Afficher ou masquer le mot de passe. Preuve : `password-field.tsx` ; E2E « formulaire : afficher le mot de passe… » ; `tests/ergo-compte/composants.test.ts`.
- [x] Erreurs explicites, reliées au champ. Preuve : `login/actions.ts`, `login-form.tsx` (`aria-invalid`, `aria-describedby`, focus ; champs vides signalés sous le champ, sans la bulle du navigateur) ; E2E « formulaire… » et « champs vides » ; capture `login-erreur-clair-1440.png`.
- [x] État de chargement. Preuve : `login-form.tsx` (`pending`, « Connexion… », `aria-busy`) ; `Button pending` testé dans `tests/components/ui.test.ts`.

### 6.3 Design system
- [x] Jetons sémantiques. Preuve : `globals.css` ; [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) § 1 ; test « jetons : contrastes WCAG AA dans les deux thèmes ».
- [x] Navigation claire. Preuve : `sidebar.tsx` (sections, `aria-current`), fil d'Ariane et `safeReturn`, lien d'évitement, palette Ctrl+K ; `tests/layout/sidebar.test.ts`, `tests/search/palette.test.ts` ; E2E `navigation.spec.ts`.
- [x] Hiérarchie. Preuve : `PageHeader`, `SectionHeader`, `text-heading`, un seul bouton primaire par zone ([CHARTE_UI.md](CHARTE_UI.md) § 1 et § 2).
- [x] Toasts. Preuve : `toast.tsx` (5 s, 8 s pour une erreur, deux zones `aria-live`, Échap) ; test « toasts » ; E2E `recommendations.spec.ts`, `alerts.spec.ts`.
- [x] Squelettes. Preuve : `skeleton.tsx`, 23 `loading.tsx` ; test « squelettes ».
- [x] États vides. Preuve : `EmptyState` (quoi + pourquoi + action) ; tests `tests/ergo-*`.
- [x] Confirmations. Preuve : `confirm.tsx` (conséquence, motif, focus piégé, Échap) ; `ergonomie-ui.test.ts` ; E2E rejet d'une recommandation.
- [x] Micro-interactions de 150 à 250 ms. Preuve : animations de 150 et 200 ms dans `globals.css` ; toutes les classes `duration-*` de `src/` valent 150 ou 200 ms, sauf le fondu de la constellation (700 ms, voir § 7).
- [x] Mode sombre et clair. Preuve : `theme-script.ts`, `theme.tsx`, `darkOption` ; `design-system.test.ts` ; captures `coeur/menu-theme-sombre.png` et `coeur/dashboard-390-sombre.png` ; axe sombre 0 violation (43/43 en clair, 21/21 en sombre, 1/1 menu réduit).

### 6.4 Responsive, accessibilité, réutilisation
- [x] Responsive à 390 px. Preuve : `DataTable` en cartes, `ActionBar` en colonne, filtres repliés, libellés de graphiques sur deux lignes ; E2E 390 px (`auth.spec.ts`, `navigation.spec.ts`) ; 22 captures pleine page à exactement 390 px de large (aucun débordement horizontal).
- [x] WCAG AA. Preuve : contrastes calculés ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) § 7), focus visible global, cibles de 40 px ; `a11y.spec.ts` : 0 violation (43/43 en clair, 21/21 en sombre, 1/1 menu réduit).
- [x] Composants réutilisables. Preuve : `@/components/ui` et `@/components/ux`, catalogue de [DEMANDES_COMPOSANTS.md](DEMANDES_COMPOSANTS.md).

### 6.5 Contraintes et livrables
- [x] Base non touchée. Preuve : `src/db/schema.ts` et `drizzle/` inchangés depuis le 30/09 (dates des fichiers), aucune migration.
- [x] Routes API non touchées par le design system. Preuve : seules `/api/export` et `/api/search` sont apparues (02/10, chantier enrichissement, hors de ce brief). Les autres routes datent du 01/10 au plus tard (vague « messages serveur »).
- [x] Logique métier préservée. Preuve : règles des chantiers (DAL en ajout seulement) ; depuis le 03/10, seuls `dal/backtest.ts`, `dal/data-monitoring.ts` et `dal/model.ts` ont bougé (ajouts pour les écrans de monitoring, autorisés par CHANTIER_VISUELS.md). Le diff git de a7 reste la preuve définitive.
- [x] Plan, liste des fichiers, checklist : ce document (§ 2, § 3, § 6).

## 7. Points restants

Par priorité.

1. **Défauts vus sur les captures du 04/10**, corrigés avant le build + E2E final sur le main fusionné (5 fonctions IA de 1a) :
   - majeur : en impression, les en-têtes des DataTable disparaissaient (`#contenu button` masqué dans print.css) ;
   - moyens : libellés coupés sans « … » à 390 px (transparence, interventions) ; aide de la palette Ctrl+K collée au bord ; bouton « Désactiver » coupé dans /admin/users ; identifiant vidé après « déjà utilisé » ; chevauchement de libellés des prévisions à 390 px ; ligne de référence qui traverse les étiquettes ;
   - mineurs (11) : flèche de variation seule sur sa ligne, graduations 0/30/60/90 à 390 px, pastille « Réussi » coupée (Mon compte, 390 px), tableau des versions coupé (390 px), arrondi titre/barres, sélection de l'organigramme en liste, borne du curseur des prévisions, contrastes sombres (légende de l'organigramme, fourchette).
   - Confirmé sur les captures : « Moyenne », anneau des rôles en sombre, rail de 64 px et sa bulle, courbes sans points, barres ≤ 23 px arrondies, impression sombre repassée en clair, sélecteur de thème à 1440/1536 px, organigramme M12037, palette et toast, écrans de monitoring.
2. **Rendu au navigateur** : menu réduit, sommaire collant, barre de filtres et grille de la fiche sont confirmés par les E2E et les captures du 04/10. Restent non capturés : bulles « ? » à 390 px, squelette du what-if, graphiques sous la ligne de flottaison des écrans de monitoring à 1440 px.
3. **Branche 3D** : à 1 440 px, l'E2E accepte la 3D comme le repli (selon le WebGL du navigateur sans tête). Il ne prouve donc pas que la scène s'affiche : la preuve reste le rapport et les captures du 02/10. Le repli « appareil modeste » n'est couvert que par le test unitaire.
4. **Fondu de la constellation à 700 ms**, hors de la plage 150–250 ms : assumé. C'est l'apparition d'un fond décoratif, pas une réponse à une action (la règle des 150–250 ms vise les retours d'interaction) ; un fondu plus court ferait « clignoter » le fond au chargement. Absent en mouvement réduit.
5. ~~Champs requis de la connexion~~ : corrigé le 04/10. Le formulaire est en `noValidate` ; un champ vide affiche « Saisissez votre identifiant. » ou « Saisissez votre mot de passe. » sous le champ, avec le curseur dedans, sans envoi (aucun échec compté). Avant l'hydratation, le serveur renvoie le même message. E2E « champs vides » dans `auth.spec.ts`.
6. ~~Docs à réaligner~~ : fait le 04/10 (palette et menu réduit dans DESIGN_SYSTEM.md § 7–8, `#recherche-entete` dans DEMANDES_COMPOSANTS.md, pastille des `KpiCard` dans BACKLOG_INTEGRATION.md, 21 pages sombres dans VERIFICATION_FINALE.md).
7. **Non faits assumés (gravité 1 à 2)** : marge droite des lignes de référence à 390 px ; `ButtonLink` sans indicateur de navigation ; 3 actions par ligne sur `/admin/users` ; export CSV sans état en cours ; canevas de l'organigramme non parcourable au clavier (la vue Liste sert d'alternative) ; rampes de couleur en dur (organigramme, équipes) ; libellés de statut des recommandations non alignés entre écrans.
8. **Dette technique** : `MARK` est déplacé dans `charts/theme.ts` (a7, commit 1df4843). Reste à vérifier les exports peut-être inutilisés de `monitoring/data-options.ts`.
9. **Hors périmètre UI** : message « Démarrage à froid » de `src/lib/scoring/cold-start.ts` en phrases de plus de 20 mots ; `caddy validate` et services WinSW à valider sur le serveur de recette.
10. **Après la vérification** : commit des corrections et des captures par a7, relance du serveur de dev, message aux sessions encore ouvertes.

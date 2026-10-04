# Vérification finale unique (à lancer quand aziz-pfe-40 et aziz-pfe-e9 ont annoncé la fin de leurs vagues)

État au 04/10/2026 ~10 h 20 (session aziz-pfe-0e) : branchements 4E A–E faits, correctif « Moyenne », fmt.model sur 7 écrans, SortHeader promu ; tsc 0, eslint 0, vitest 99 fichiers / 838 tests. Tests E2E ajoutés mais non exécutés : passe axe en thème sombre (20 pages, a11y.spec.ts) et 3 tests « Connexion 3D » (auth.spec.ts).

## Étapes, dans l'ordre
1. `npx tsc --noEmit`, `npx eslint .`, `npx vitest run --maxWorkers=2` (hors tests/security).
2. Port 3000 libre (sinon `taskkill /PID <pid> /T /F`) ; mémoire : fermer ce qui peut l'être.
3. `npx next build` : aucune erreur, relever les avertissements.
4. `npm run test:e2e` (build `.next-e2e`, copie de base, 1 worker). Corriger l'application pour chaque vrai défaut, les sélecteurs pour les libellés changés par les vagues 40/e9. Surveiller d'abord la passe axe sombre et « Connexion 3D » à 1440 px (messages console de three/R3F).
5. Captures : `E2E_SKIP_BUILD=1 node tests/e2e/server.mjs` en arrière-plan (port 3200), puis `node docs/qa/captures/design-system/final/ds-final-captures.mjs` (`BASE`, `ONLY=…` facultatifs) → 56 PNG ; relecture visuelle (étiquette « Moyenne » tableau de bord et absentéisme manager, anneau des rôles en sombre, palette Ctrl+K, toast). Arrêter le serveur 3200.
6. Écrire `docs/qa/LIVRABLE_DESIGN_SYSTEM.md` : plan d'amélioration ; fichiers par domaine (vagues design system, 4E, visuels 40, ergonomie e9 — voir docs/qa/ergonomie/*.md et CHANTIER_*.md) ; comment tester par rôle (thème, connexion 3D, Ctrl+K, export, impression) ; commandes `npm install three @react-three/fiber` et `npm install -D @types/three` (déjà faites) ; checklist chiffrée ; points restants.
7. Relancer le serveur de dev détaché (supprimer `.next\dev\cache\turbopack` s'il est corrompu) :
   `Start-Process cmd.exe -ArgumentList '/c','npm run dev -- -p 3000 > data\dev-server.log 2>&1' -WorkingDirectory 'C:\Users\stagiaire1\Desktop\aziz-pfe\people-analytics' -WindowStyle Hidden`
8. Envoyer le résultat aux sessions encore ouvertes (40, e9, 4e).

## Specs E2E du chantier visuels (écrites le 04/10, non exécutées ; tsc 0, eslint tests/e2e 0)
- a11y.spec.ts : `admin:parametres` dans DARK_PAGES ; bloc « menu réduit » (axe sur tableau de bord avec `pa-nav=rail`).
- admin.spec.ts : bloc « Paramètres côté navigateur (sans enregistrement) » — badge Modifié/Rétablir, Annuler, erreurs Maximum 20 % / Minimum 1, barème SMIG ; afterEach : aucun POST, `app_setting` inchangée.
- navigation.spec.ts : bloc « Menu réduit » (rail 60–68 px, bulles survol/focus, data-nav posé avant la nav au rechargement, 390 px sans débordement).
- Hypothèses à confirmer au premier passage : bulle du rail repérée comme `span[aria-hidden="true"]` (structure sidebar.tsx) ; script NavRail dans `<head>` ; saisies juste après `waitReady` (risque d'intermittence si l'hydratation réinitialise) ; espaces insécables avant « % » (regex existantes `/→ 3 %/` et `/Valeur par défaut : 2 %/` à passer en `\s` si elles échouent) ; snapshot complet de `app_setting` (faux échec si un traitement de fond y écrit).

## Chantier visuels (aziz-pfe-a7, ex-40) terminé le 04/10 ~12 h
- tsc 0 sur tout le projet ; vitest des suites du chantier 376/376. 6 périmètres livrés : menu + en-tête (mode réduit), Paramètres, kit de visuels (palette daltonisme, --pa-chart-*), console admin, santé des données + dérive, transparence + backtesting.
- Consignes de captures (étendre ds-final-captures.mjs si besoin) : attendre que les canevas ECharts soient peints ; prise à la taille de la fenêtre (barres collantes) ; menu déployé ET réduit ; /admin, /admin/settings, /data-health, /derive, /transparency, /backtesting en ADMIN et RH, clair et sombre ; organigramme avec mgr.M12037. Détail : CHANTIER_VISUELS.md.

## Demandes croisées graphiques (aziz-pfe-1a) terminées le 04/10 ~12 h (tsc 0)
À regarder dans les captures (bilan : docs/qa/ergonomie/CHARTS.md) :
- Courbes sans points hors survol (trait 2 px, repère 8 px au survol) : tableau de bord, /absenteeism, /charge, console admin, /transparency, fiche. Points pleins sur les courbes écrites à la main (pilotage, insights, /charge plusieurs équipes).
- Barres ≤ 24 px à bout arrondi (barres 100 % de /interventions plus fines) ; anneaux à 56–72 %.
- À 390 px : libellés de catégories coupés après deux lignes avec « … ».
- Impression en thème sombre : Ctrl+P sur /dashboard → graphiques et pastilles en couleurs claires (ThemeSync repasse en clair ; vérifier le redessin du canevas, `page.emulateMedia({ media: "print" })`).
- Sélecteur de thème : icône seule jusqu'à 1535 px, libellé dès 2xl.
- /transparency : explication des niveaux de risque (phrases découpées).

## Dépôt git
a7 a créé le dépôt (main, poussé sur GitHub privé) avec l'état du 04/10 midi. Pas de commande git ici sans prévenir a7 ; a7 fera le commit des corrections et captures de la vérification finale.

## Vague ergonomie (aziz-pfe-e9) terminée le 04/10
- vitest 962 verts / 2 ignorés ; tsc : 3 erreurs restantes dans les fichiers de 40 (derive/page.tsx:255, monitoring/data-options.ts:508, monitoring/model-options.ts:428) à revérifier après la fin de 40.
- Pendant l'envoi, « Marquer comme traitée » et « Rejeter l'alerte » affichent « Enregistrement… ».
- À regarder dans les captures : barre de filtres (un seul repli « Afficher les filtres (n actifs) », une ligne dès lg) ; ActionBar en colonne et « Trier par » de DataTable en cartes sous 640 px ; sommaire OnThisPage collant dès 1024 px ; grille de la fiche à lg, flèches de l'organigramme, squelette du what-if ; print.css élargi.
- Détail : docs/qa/CHANTIER_ERGONOMIE.md et docs/qa/ergonomie/*.md.

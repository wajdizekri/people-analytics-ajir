# Captures finales (étape 5 de VERIFICATION_FINALE.md)

## Ordre de lancement (depuis la racine du projet)

1. Après le build E2E (`.next-e2e`), serveur isolé en arrière-plan, port 3200, base `data/e2e.db` recréée à chaque lancement :
   - Git Bash : `E2E_SKIP_BUILD=1 node tests/e2e/server.mjs &`
   - PowerShell : `$env:E2E_SKIP_BUILD="1"; Start-Process node -ArgumentList 'tests/e2e/server.mjs' -NoNewWindow`
2. `node docs/qa/captures/design-system/final/ds-final-captures.mjs` (attend jusqu'à 3 min que :3200 réponde).
3. Arrêter le serveur 3200.

Options : `BASE=http://localhost:3200` ; `ONLY=<groupe|page|ancien nom>,…` (ex. `ONLY=palette,toast,connexion`, `ONLY=graphiques`, `ONLY=transparence`) ; `--liste` affiche le plan sans ouvrir de navigateur.

Le script pose le mot de passe de démonstration `MgrDemo2026pfe` de `mgr.M12037` dans `data/e2e.db` uniquement (jamais `app.db`), et seulement si `BASE` est le serveur E2E.

## Nommage

`<role>-<page>-<theme>-<menu|rail>-<largeur>[-<vue>].png`. Sans vue : haut de page à la taille de la fenêtre. Vues : `pleine` (pleine page), `graphiques-1` / `graphiques-2` (défilement jusqu'aux visuels), `bas`, `hierarchie`, `liste`, `survol`, `entete`, `entete-ouvert`, `impression`.

## Groupes et points à regarder

- **pages** (12 écrans de l'ancien script, 1440 fenêtre + 390 pleine page) : étiquette « Moyenne » (tableau de bord, absentéisme manager), anneau des rôles en sombre, barre de filtres (repli unique « Afficher les filtres (n actifs) » sous lg), ActionBar en colonne et « Trier par » en cartes sous 640 px, grille de la fiche.
- **palette**, **toast** : palette Ctrl+K (« abs »), toast d'erreur « Compte non créé ».
- **menu** : menu déployé contre rail de 64 px (RH tableau de bord, console ADMIN), clair et sombre ; bulle au survol du rail ; 390 px avec `pa-nav=rail` sans débordement de l'en-tête.
- **monitoring** : /admin, /admin/settings (haut et bas : barre d'enregistrement collante), /data-health, /derive, /transparency, /backtesting en ADMIN et RH, clair et sombre. Refus attendus et journalisés : RH sur /admin et /admin/settings, ADMIN sur /backtesting.
- **graphiques** (RH, 1440 clair et sombre, 390 clair) : courbes sans points hors survol, barres ≤ 24 px à bout arrondi, anneaux 56–72 %, libellés coupés après deux lignes avec « … » à 390 px, sommaire OnThisPage collant en haut des vues `graphiques-2` à 1440 px (pages qui en ont un), explication des niveaux de risque sur /transparency.
- **impression** : /dashboard en sombre sous `media: print` + `beforeprint` : graphiques et pastilles en couleurs claires, menu et en-tête masqués.
- **theme** : sélecteur de l'en-tête, icône seule à 1440 px, libellé à 1536 px, fermé puis ouvert.
- **organigramme-m12037** : hiérarchie complète en graphique (1440) et en liste (390), parcours au clavier dans la liste (aide visible, focus sur le premier enfant).

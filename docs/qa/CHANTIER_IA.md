# Chantier « 5 IA » (04/10/2026) — règles communes

Session aziz-pfe-1a (ex-e9), demande d'Aymen. Cinq agents, **chacun dans son worktree git** hors du dossier de l'app : `C:\Users\stagiaire1\Desktop\aziz-pfe\wt\<nom>` (branche `ia/<nom>`, partie de `cbe9ef8`). Pendant ce temps, la session aziz-pfe-ae fait la vérification finale (build, E2E, captures) dans `people-analytics` et la session aziz-pfe-a7 gère git.

## Règles absolues

- **Écrire uniquement dans ton worktree.** Chaque chemin que tu modifies commence par `C:\Users\stagiaire1\Desktop\aziz-pfe\wt\<nom>\`. Le dossier `C:\Users\stagiaire1\Desktop\aziz-pfe\people-analytics\` est en **lecture seule** (y compris `data/`). Toute commande shell commence par `cd` dans ton worktree.
- `node_modules` du worktree est une jonction vers celui de l'app : **jamais** de `npm install` / `npm ci`, aucune dépendance nouvelle (appel d'API externe : `fetch`).
- Données : `data/` n'est pas dans git. Si tu en as besoin, copie `people-analytics\data\app.db` dans `wt\<nom>\data\app.db` (copie de fichier seulement) et travaille sur la copie.
- **Deux phases (mémoire du poste : 8 Go, E2E d'ae en cours).**
  - **Phase A (maintenant)** : lire, concevoir, écrire le code, les scripts Python et les tests. **Interdit** : `vitest`, `eslint`, `tsc`, `python`, `next`, Playwright, tout serveur. À la fin de la phase A, rends un compte rendu intermédiaire commençant par « PHASE A TERMINÉE » (fichiers écrits, commandes prévues pour la phase B) et **arrête-toi**.
  - **Phase B (quand l'orchestrateur te relance)** : exécuter les scripts Python, `npx vitest run <tes dossiers> --maxWorkers=1`, `npx eslint <tes fichiers>`, puis `npx tsc --noEmit` une seule fois, et seulement si aucun autre `tsc` ne tourne (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, ligne de commande contenant `tsc`). Corriger, puis commiter.
- Git : seulement `git add` / `git commit` dans ton worktree, sur ta branche `ia/<nom>`, à la fin de la phase B. Ne pas changer l'identité de l'auteur (héritée du dépôt). Pas de push, pas de merge, pas de checkout d'une autre branche, pas de reset. Message de commit en français, terminé par la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pas de migration ni de modification de `src/db/schema.ts`, `package.json`, `src/proxy.ts`, `src/lib/dal/context.ts`, `tests/e2e/**`.
- **Fichiers de la session a7, interdits** : `src/components/charts/pbi.tsx`, `theme.ts`, `src/components/monitoring/**`, `src/components/layout/**`, `src/app/(app)/layout.tsx`, `admin/settings/**`, `admin/page.tsx`, `data-health/**`, `derive/**`, `transparency/**`, `backtesting/**`. Pas de nouvelle entrée de menu : chaque fonction s'intègre dans une page existante de ton périmètre.
- Fichiers communs, **ajouts seulement** (en fin de liste ou d'objet, pour faciliter la fusion) : `src/lib/help/content.ts`, `src/lib/help/terms.ts`, `src/components/admin/audit-labels.ts`, `src/lib/settings.ts` (`DEFAULT_SETTINGS`). Les signaler dans ton bilan.

## Éthique et conformité (le sujet et les ADR font foi)

- Lire [CONVENTIONS.md](../CONVENTIONS.md) (matrice des rôles : l'ADMIN ne voit aucune donnée RH), ADR-002 (Python hors ligne, modèle JSON exécuté en TypeScript), ADR-004, ADR-009 (aucune donnée de santé), ADR-010 (simulateur, vérité terrain), ADR-011 (gardes petites populations côté manager), [PLAN_PFE.md](../../../PLAN_PFE.md).
- **Aucune lecture causale** : vocabulaire « facteurs associés », mention « estimation non causale », aucun chiffre de « départs évités ».
- **Aucune décision automatique** (Won't du sujet) : l'IA propose, la RH décide.
- Pas de détection de fraude ni d'abus, pas de nouveau signal individuel côté manager, pas d'attribut sensible (sexe, situation familiale, gouvernorat, santé) comme variable d'action ou de regroupement.
- Ne jamais ajouter de donnée à un DTO de rôle sans garder les gardes existantes ; opposition au traitement (`excludeOpposed`, 409 `OPPOSITION`) respectée.

## UI

[CHARTE_UI.md](CHARTE_UI.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (jetons sémantiques, clair et sombre), composants de `@/components/ui` et kit `@/components/charts/pbi` en lecture. Graphique nouveau : charger la compétence `dataviz` (outil Skill). Textes en français, vouvoiement, phrases ≤ 20 mots, chiffres au format français. Libellés visés par `tests/e2e/*.spec.ts` inchangés.

## Périmètres

| Agent | Worktree | Fonction | Fichiers |
|---|---|---|---|
| LEVIER | `wt\levier` | recherche automatique du plus petit jeu de leviers qui fait baisser le niveau de risque | `src/lib/whatif/**`, route API du what-if, `src/components/pilotage/what-if-panel.tsx`, `tests/whatif/**`, `tests/ia-levier/**`, `docs/RESULTATS_IA_LEVIER.md` |
| CAUSAL | `wt\causal` | comparaison appariée (score de propension) des salariés suivis et non suivis, estimation non causale | `src/lib/dal/intervention-impact.ts`, nouveau `src/lib/matching/**`, `src/app/(app)/interventions/**`, `src/components/insights/intervention-effects.tsx`, `ml/matching/**`, `tests/ia-causal/**`, `docs/RESULTATS_IA_INTERVENTIONS.md` |
| TYPOLOGIE | `wt\typologie` | profils types de départs (regroupement hors ligne, affichage agrégé) | `ml/typology/**`, `models/typology/**`, `src/lib/ai/typology/**`, `src/lib/dal/typology.ts`, `src/app/(app)/retention/**`, `src/components/retention/**`, `tests/ia-typologie/**`, `docs/RESULTATS_IA_TYPOLOGIE.md` |
| SYNTHESE | `wt\synthese` | synthèse mensuelle rédigée (gabarit déterministe + IA générative facultative sur agrégats) | `src/lib/ai/narrative/**`, `src/app/(app)/synthese/**`, `src/lib/dal/synthesis.ts` (ajouts), `docs/conformite/aipd.md`, `docs/EXPLOITATION.md`, `deploy/env.example`, `tests/ia-synthese/**`, `docs/RESULTATS_IA_SYNTHESE.md` |
| CONFORME | `wt\conforme` | fourchettes de prévision à couverture vérifiée (prédiction conforme) | `ml/absenteeism/**`, `ml/workload/**`, `ml/workforce/**` (calibration), nouvelles versions dans `models/**`, `src/lib/ai/{absenteeism,workload,workforce}/**`, `src/components/ai/**`, `src/app/(app)/{absenteeism,charge,previsions}/**`, `tests/ia-conforme/**`, `docs/RESULTATS_IA_CONFORME.md` |

Enregistrement / promotion d'un modèle dans `app.db` : **pas pendant le chantier** ; écrire les commandes exactes dans ton bilan (l'orchestrateur les lancera après la fusion).

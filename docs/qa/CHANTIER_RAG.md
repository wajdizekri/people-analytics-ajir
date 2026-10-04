# Chantier « assistant d'aide (RAG) » (04/10/2026) — règles communes

Session aziz-pfe-1a, demande d'Aymen : un champ « Posez votre question » sur l'écran d'accueil de chaque rôle (tableau de bord RH et manager, console ADMIN), qui répond **à partir de la documentation et de l'aide seulement**, filtrées par rôle. Cinq agents en parallèle dans le worktree `C:\Users\stagiaire1\Desktop\aziz-pfe\wt\rag` (branche `ia/rag`). Le branchement dans les pages est fait par l'orchestrateur à la fin.

## Règles absolues

- **Écrire uniquement dans le worktree** `C:\Users\stagiaire1\Desktop\aziz-pfe\wt\rag\`. Le dossier `people-analytics\` est en **lecture seule** : la session aziz-pfe-ae y fait une vague de textes (titres seuls) avec 5 agents. Toute commande shell commence par `cd C:\Users\stagiaire1\Desktop\aziz-pfe\wt\rag`.
- `node_modules` est une jonction : jamais de `npm install`, **aucune dépendance nouvelle** (index : SQLite FTS5 en mémoire via better-sqlite3, déjà présent ; API Claude : `fetch`).
- Pas de migration, pas de modification de `src/db/schema.ts`, `package.json` (sauf l'ajout du script `rag:index` par l'agent CORPUS), `src/proxy.ts`, `src/lib/dal/context.ts`, `tests/e2e/**`.
- **Ne pas modifier** les pages ni `src/components/help/page-intro.tsx` : le branchement est fait par l'orchestrateur après la vague d'ae.
- **Emplacement et forme (décidé avec ae)** : l'encart « À quoi sert cette page » disparaît de toute l'app (vague « titres seuls »). L'assistant est un composant **autonome**, placé sous le `PageHeader` du tableau de bord (RH, manager) et de la console (ADMIN), **replié par défaut** : une seule ligne (champ « Poser une question » + bouton), aucun paragraphe d'explication ; le panneau de réponse ne s'ouvre qu'après une question, avec un bouton pour le refermer.
- Mémoire du poste (8 Go, agents d'ae en cours) : `npx vitest run <tes fichiers> --maxWorkers=1` ; `npx tsc --noEmit` une seule fois à la fin, seulement si aucun autre tsc ne tourne (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, ligne de commande contenant `tsc`). Dans le worktree, 2 erreurs `LayoutProps` (src/app/layout.tsx, src/app/(app)/layout.tsx) sont attendues : types générés par Next absents. Jamais `next build`, `next dev`, Playwright.
- Git : rien. L'orchestrateur commite.

## Contrat commun (figé)

`src/lib/rag/types.ts` (types `RagChunk`, `RagCorpus`, `RagHit`, `AssistantAnswer`, constantes) et les **signatures** des stubs `src/lib/rag/index.ts` (`sanitizeQuery`, `searchCorpus`) et `src/lib/rag/answer.ts` (`assistantAiConfig`, `extractiveAnswer`, `answerQuestion`). Ne pas changer une signature ; besoin d'un ajout : l'écrire dans « Demandes » ci-dessous.

## Éthique et conformité

- Le corpus ne contient **que** de la documentation : aucune donnée de salarié, aucun chiffre issu de la base.
- Filtrage par rôle **avant** classement : l'ADMIN ne lit aucun passage de méthodologie RH ou de données RH ; le manager ne lit pas les passages réservés à la RH (`roles` des entrées de `src/lib/help/content.ts` et `terms.ts`).
- IA générative facultative (`ASSISTANT_AI_API_KEY`, désactivée par défaut) : seuls la question et les passages trouvés sont envoyés ; question refusée à l'envoi si elle contient un matricule (`M` suivi de 4 chiffres ou plus) ; réponse construite uniquement à partir des passages, sources citées, sinon « l'aide ne couvre pas cette question ».
- Audit `assistant.ask` **sans le texte de la question** (longueur, nombre de passages, mode).
- Textes : français, vouvoiement, phrases ≤ 20 mots ; vocabulaire « facteurs associés », jamais de lecture causale.

## Périmètres

| Agent | Fichiers |
|---|---|
| CORPUS | `scripts/rag-index.ts`, `src/lib/rag/sources.ts`, `src/lib/rag/corpus.json` (généré), script `rag:index` dans `package.json`, `tests/rag/corpus.test.ts` |
| SEARCH | `src/lib/rag/index.ts` (remplace le stub), `src/lib/rag/synonyms.ts`, `tests/rag/search.test.ts` (corpus de test en fixture, sans dépendre de corpus.json) |
| ANSWER | `src/lib/rag/answer.ts` (remplace le stub), `tests/rag/answer.test.ts` |
| SERVICE | `src/lib/dal/assistant.ts`, `src/app/api/assistant/route.ts`, `src/lib/auth/rate-limit.ts` (ajout `RATE_RULES.assistant`), `src/components/admin/audit-labels.ts` (ajout en fin), `src/lib/privacy/export.ts` (libellé `assistant.ask`, ajout), `tests/rag/dal.test.ts`, `tests/rag/api.test.ts` |
| UI | `src/components/help/help-assistant.tsx`, export dans `src/components/help/index.ts`, `src/lib/help/content.ts` (une FAQ en fin de liste), `docs/RESULTATS_ASSISTANT.md`, `docs/EXPLOITATION.md` (section), `deploy/env.example`, `docs/conformite/aipd.md` (section), `tests/rag/ui.test.ts` |

## Demandes

<!-- format : - [AGENT] fichier — besoin — raison -->

# ADR-007 — Couche d'accès aux données à la place de la sécurité par ligne

- **Statut** : acceptée
- **Date** : 28/09/2026 (séparation des tâches ADMIN / RH ajoutée le 29/09/2026)
- **Références** : cahier des charges v2 § 3 et § 5 ; [src/lib/dal/](../../src/lib/dal/) ; [src/lib/dal/context.ts](../../src/lib/dal/context.ts) ; [docs/CONVENTIONS.md](../CONVENTIONS.md) § « Règles de sécurité »

## Contexte

SQLite n'a ni utilisateurs ni sécurité par ligne (RLS). Trois rôles aux droits très différents lisent les mêmes tables : un manager ne doit voir que sa hiérarchie, sans rémunération ni probabilité ; la RH voit tout ; l'administrateur administre l'outil. Avec les Server Components de Next.js, une donnée lue côté serveur et passée à un composant peut se retrouver dans le HTML ou dans le payload RSC même si elle n'est pas affichée : le filtrage doit donc intervenir **avant** que la donnée n'atteigne une page.

## Décision

- **Une seule couche lit la base pour l'interface et l'API** : `src/lib/dal/*`, dont chaque module importe `server-only`. Pages (Server Components), Server Actions et Route Handlers n'appellent que des fonctions de la DAL.
- **Chaque fonction reçoit un `AccessContext`** (`userId`, `login`, `role`, `employeeId`) construit côté serveur à partir de la session (`getContext`), jamais d'un paramètre client.
- **Gardes à deux niveaux** :
  - à l'entrée : `pageContext(roles)` (pages : `/login` sans session, `/interdit` si rôle insuffisant), `requireContext(roles)` (API : 401/403 JSON) ;
  - dans la DAL : `ensureRole`, `ensurePilotage`, `canSeeEmployee`, `visibility()` des alertes, `requireGlobal` des recommandations, avec **journalisation des refus** (`outcome = REFUSE`).
- **Périmètre hiérarchique** : `SCOPE_SUBQUERY`, CTE récursive `WITH RECURSIVE team` sur `employee.manager_id` à partir de `ctx.employeeId` (le manager lui-même exclu) ; `scopeFilter(ctx, colonne)` l'injecte dans toutes les requêtes de liste, de tableau de bord et d'absentéisme.
- **DTO par rôle en liste blanche** : `toRhDetailDto` / `toManagerDetailDto`, `toRhDashboardDto` / `toManagerDashboardDto`, lignes `EmployeeRowRh` / `EmployeeRowManager`. Un manager ne reçoit jamais : salaire, masse salariale, probabilité, lift, version du modèle, phrase chiffrée de facteur (`phrase_rh`), détail des absences, événements `AUGMENTATION`, action `REVISION_SALARIALE`, catégorie de facteur `ABSENCES` (ni `REMUNERATION` avec B0), signal d'absentéisme individuel.
- **Séparation des tâches** : `isGlobal(ctx)` n'est vrai que pour **RH** ; `PILOTAGE_ROLES = ["RH", "MANAGER"]`. L'**ADMIN** administre l'outil (comptes, paramètres, audit, imports, santé des données, transparence du modèle, alertes SYSTEME et DONNEES non nominatives) mais ne voit **aucune donnée nominative ni indicateur RH** : `scopeFilter` renvoie `1=0` pour lui, les pages de pilotage le redirigent vers `/interdit`, son accueil est `/admin` (`homePath`).
- **Codes HTTP** : 401 sans session, 403 hors rôle ou hors périmètre, 404 si la ressource n'existe pas (l'existence est testée avant le périmètre), 400 sur paramètre invalide (zod), 409 sur conflit d'état.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| RLS PostgreSQL | Hors stack ([ADR-001](001-stack-react-nextjs-sqlite.md)) |
| Autorisation dans le proxy (middleware) | Le proxy ne voit que la requête ; il ne peut ni filtrer des lignes ni contrôler le payload RSC ; il reste un contrôle optimiste de présence du cookie ([src/proxy.ts](../../src/proxy.ts)) |
| Vues SQL par rôle | Pas de notion d'utilisateur SQLite ; le périmètre dépend d'un paramètre de session |
| Filtrage dans les composants | Les données non affichées fuiraient dans le payload RSC |
| API taint de React | Complément possible, non utilisé ; les tests vérifient directement l'absence des clés sensibles |

## Conséquences

- Les droits sont testés au niveau des fonctions ([tests/pilotage/](../../tests/pilotage/), [tests/ui-admin/](../../tests/ui-admin/)) : liste manager limitée à la hiérarchie récursive, 403 audité hors périmètre, 404 si inexistant, parcours récursif des DTO manager sans aucune clé ni valeur de rémunération ou de probabilité, pages rendues sans ces valeurs.
- Écarts avec le cahier des charges :
  - la règle « seule la DAL interroge la base » n'est **pas vérifiée par le linter** (aucune règle `no-restricted-imports` dans [eslint.config.mjs](../../eslint.config.mjs)) ; elle repose sur la revue et la convention ;
  - la hiérarchie utilisée est celle du **dernier import** (`employee.manager_id`), pas la hiérarchie « à la date consultée » ;
  - les refus décidés à l'entrée (`pageContext`, `requireContext` sur le rôle) ne sont pas journalisés, seuls ceux de la DAL le sont.
  - la séparation des tâches n'est pas absolue : sur *Santé des données*, l'ADMIN lit les exemples de rejets d'import, dont les messages citent des matricules et parfois un montant de salaire (`SALAIRE_SOUS_SMIG`, `PAIE_INCOMPLETE`, `MATRICULE_INCONNU`) ; le journal d'audit expose aussi des identifiants de salariés ciblés.
- Toute nouvelle page doit passer par une fonction de la DAL prenant un `AccessContext` ; c'est une règle de revue de code.

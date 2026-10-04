# ADR-001 — Stack React + Next.js + SQLite

- **Statut** : acceptée (contrainte client, non négociable)
- **Date** : 28/09/2026 (cadrage v2)
- **Références** : cahier des charges v2 § 5 ; [docs/CONVENTIONS.md](../CONVENTIONS.md) ; [package.json](../../package.json)

## Contexte

Le module s'installe chez des clients AJIR (PME et ETI tunisiennes de 150 à 800 salariés), sur un seul serveur on-premise, souvent sans administrateur de base de données ni accès Internet. Le sujet initial imposait React, Next.js et SQLite ; le cahier des charges v2 conserve cette base et autorise des briques ajoutées par-dessus. Le volume visé reste modeste : environ 2 500 salariés × 96 mois pour le simulateur (quelques millions de lignes de pointage), 3 à 15 fois moins chez un client réel. La base de démonstration compte 1,56 million de pointages.

## Décision

- **React 19** pour l'interface, rendue par **Next.js 16.3 (App Router)** : Server Components pour les lectures, Server Actions pour les mutations de l'interface, Route Handlers pour l'API JSON, runtime Node.js uniquement.
- **SQLite** comme base unique, dans un seul fichier (`data/app.db`), accédé par **better-sqlite3** (synchrone, en processus) et typé par **Drizzle ORM** ; SQL brut paramétré autorisé pour les requêtes analytiques.
- Ajouts retenus : TypeScript strict, zod 4 (entrées et paramètres), Tailwind CSS 4, Apache ECharts 6, croner (planification), pino (journaux JSON), csv-parse (import en flux), @node-rs/argon2 (mots de passe), Vitest et fast-check (tests).
- Un seul dépôt, un seul langage en production (TypeScript) pour l'interface, l'API, le worker, les variables et le scorer.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| PostgreSQL (RLS, vues matérialisées, concurrence d'écriture) | Contrainte client ; un serveur de base à installer, sauvegarder et administrer chez chaque client |
| Second backend FastAPI ou Spring (Python ou Java en production) | Deux langages, deux déploiements ; Python en production explicitement exclu (Won't) |
| Redis + BullMQ pour la file de jobs | Service supplémentaire ; une table `app_job` dans SQLite suffit au volume (voir [ADR-013](013-worker-separe-et-file-de-jobs-sqlite.md)) |
| Librairie d'authentification (Auth.js) | Son mode identifiants impose des JWT non révocables (voir [ADR-012](012-sessions-opaques-plutot-que-jwt.md)) |
| shadcn/ui, TanStack Table, React Hook Form (listés au cahier) | Non retenus à ce stade : composants maison légers ([src/components/ui/index.tsx](../../src/components/ui/index.tsx)) et formulaires Server Actions natifs ; écart assumé, sans impact fonctionnel |

## Conséquences

- Positives : installation simple (Node.js + un fichier), sauvegarde par copie cohérente du fichier ([scripts/backup.ts](../../scripts/backup.ts)), aucune couche réseau entre l'application et la base, tests d'intégration sur une base réelle en quelques secondes.
- Négatives, compensées par d'autres décisions :
  - pas de sécurité par ligne → couche d'accès aux données unique ([ADR-007](007-couche-acces-donnees-au-lieu-rls.md)) ;
  - un seul écrivain à la fois → WAL, transactions courtes, worker seul écrivain de masse ([ADR-013](013-worker-separe-et-file-de-jobs-sqlite.md)) ;
  - pas de vues matérialisées → table d'agrégats `agg_kpi_monthly` recalculée par tables temporaires ([src/lib/aggregates/index.ts](../../src/lib/aggregates/index.ts)) ;
  - pas de transaction « publication » native entre plusieurs tables volumineuses → pointeur de publication ([ADR-008](008-publication-atomique-par-pointeur.md)).
- Next.js 16 impose des conventions nouvelles : `middleware` renommé `proxy` ([src/proxy.ts](../../src/proxy.ts)), `cookies()`, `headers()`, `params` asynchrones ; les modules natifs sont déclarés dans `serverExternalPackages` ([next.config.ts](../../next.config.ts)).
- Playwright et k6 (listés au cahier) ne sont pas encore intégrés : les tests d'autorisation et de DTO sont écrits en Vitest sur les fonctions de la DAL et le rendu des pages ([tests/](../../tests/)).

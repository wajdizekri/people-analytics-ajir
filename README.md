# People Analytics & Predictive Turnover — AJIR

Module d'analytique RH intégré au progiciel AJIR (ArabSoft) : tableaux de bord, absentéisme, estimation du risque de départ volontaire à 6 mois, recommandations et alertes, avec contrôle qualité des imports et transparence du modèle. Quatre IA par sujet complètent le risque de départ : prévision de l'absentéisme, projection des effectifs et de la masse salariale, risque de retard des formations obligatoires, charge de travail.

Stack : React + Next.js 16 (App Router) + SQLite (better-sqlite3, Drizzle), TypeScript strict, zod, Tailwind v4, ECharts, croner, pino, Vitest, Playwright. Python uniquement hors ligne dans `ml/` (simulateur, entraînement et évaluation des modèles, exportés en JSON et exécutés en TypeScript).

Démo pas à pas et comptes : [docs/DEMO.md](docs/DEMO.md). Règles communes : [docs/CONVENTIONS.md](docs/CONVENTIONS.md). Installation sur un serveur client : [docs/INSTALLATION.md](docs/INSTALLATION.md) ; exploitation : [docs/EXPLOITATION.md](docs/EXPLOITATION.md). Rapport : [docs/rapport/](docs/rapport/).

## État (vérification finale du 30/09/2026)

- Contrôles statiques : `tsc` et ESLint sans erreur ; `next build` de production sans erreur ni avertissement.
- Tests : Vitest 655 réussis + 1 ignoré (79 fichiers), pytest 67/67, Playwright 113/113 (dont 39 pages sans violation axe WCAG 2 AA et aucune violation CSP dans le navigateur), campagne de sécurité HTTP 60/60 (102/102 avec le durcissement) : [docs/qa/](docs/qa/).
- Performance sous 20 utilisateurs (build de production) : `/api/dashboard` p95 103 ms, `/api/employees` p95 193 ms ; calcul du dernier mois 17 s.
- Base de démonstration : run LOGREG n° 73 au 31/08/2026 ; recommandations et alertes de l'ancien calcul B0 du même mois remplacées (`npm run runs -- supersede`, audité).
- Reste à faire hors poste de développement : validation sur le serveur cible (Caddy, services WinSW, durée d'installation), scan OWASP ZAP, test utilisateur (BNF-14) ; voir [docs/qa/BACKLOG_INTEGRATION.md](docs/qa/BACKLOG_INTEGRATION.md).

## Installation

Prérequis : Node 24, npm 11 ; Python 3 avec numpy, pandas, scipy et holidays seulement pour régénérer les données simulées (`ml/README.md`).

```powershell
npm install
npm run db:migrate                          # data/app.db (DATABASE_PATH pour une autre base)
npm run seed:admin -- admin MotDePasse2026
npm run import -- data/sim/mixte_medium_s1  # export AJIR (CSV ;) → base, contrôles qualité, calendrier, agrégats
npx tsx scripts/model.ts register models/turnover/logreg-v1-20260930   # puis verify et promote (sinon score à règles B0)
npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v1-20260930   # idem pour chaque sujet, puis promote
npm run pipeline                            # variables, scoring publié, recommandations, anomalies, alertes, étapes IA
npm run build
npm run start
```

Détail des commandes de modèles : [docs/DEMO.md](docs/DEMO.md) (« Reconstruire la base de zéro »).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run db:migrate` | applique `drizzle/*.sql` et les paramètres par défaut |
| `npm run db:generate -- --name <nom>` | génère une migration après ajout au schéma |
| `npm run seed:admin -- <login> <mdp>` | crée un administrateur |
| `npm run sim -- --config small\|medium\|large --scenario mixte --seed 1` | génère `data/sim/<scenario>_<config>_s<seed>/` (+ `ground_truth/`) |
| `npm run import -- <dossier> [--user <id>]` | importe un export AJIR ; bloque le scoring sous le seuil qualité (95 %) |
| `npm run pipeline -- [--from YYYY-MM] [--to YYYY-MM] [--backtest]` | agrégats, backfill des variables, scoring, anomalies |
| `npx tsx scripts/model.ts register\|verify\|promote\|rollback\|list` | registre du modèle turnover (bundles `models/turnover/<version>/`) |
| `npm run topic-model -- register <SUJET> <dossier> \| promote <version> \| list` | registre des IA par sujet (`models/<sujet>/<version>/`) |
| `npm run runs -- list \| rollback <runId> \| supersede [--apply]` | calculs publiés, retour arrière du calcul courant ; après un recalcul du même mois avec un autre modèle, rejet des recommandations et alertes non reproposées (simulation par défaut, audité) |
| `npm run backup` · `npm run restore -- <nom>` · `npm run check-install` | sauvegarde à chaud vérifiée, restauration, contrôle global de l'installation |
| `npm run retention [-- --apply]` | purge de rétention (simulation par défaut) : sessions, prédictions, exports déposés, résidus des oppositions |
| `npx tsx scripts/export-panel.ts --out <csv>` | panel de variables pour un réentraînement hors ligne (salariés opposés exclus) |
| `npx tsx scripts/demo-passwords.ts [--manager <login>]` | mots de passe de démonstration (`rh.demo`, premier manager) |
| `npm run worker` | worker : file `app_job` (imports, scoring…) et batch mensuel le 10 à 02:00 (Africa/Tunis) |
| `npm run typecheck` · `npm run lint` · `npm test` | tsc, eslint, vitest (79 fichiers, 655 tests réussis et 1 ignoré au 30/09/2026 ; `tests/security` exclus sans `SEC_BASE_URL`) |
| `npm run test:security` · `npm run test:e2e` | attaques contre un serveur isolé (:3300, 60 tests HTTP, 102 avec le durcissement) ; Playwright de bout en bout avec axe-core (113 tests dont 39 pages auditées) |
| `python -m pytest ml` | tests Python hors ligne (67 tests) |

## Architecture

```
AJIR (export CSV) ──► import + contrôles qualité ──► SQLite (data/app.db)
                                                    │
         worker / scripts/pipeline ◄────────────────┤  agrégats mensuels, calendrier tunisien
         variables (shared/features.json, as-of)     │
         scoring (champion) → run STAGING → PUBLIE   │  prediction, prediction_factor
         recommandations, alertes, anomalies ───────►│
         IA par sujet (topic_model) ────────────────►│  forecast, training_risk, insight_recommendation
                                                    ▼
                      Next.js : DAL (autorisation, DTO par rôle) → pages + Route Handlers
```

- `src/db/` : schéma Drizzle unique et connexion (WAL). `drizzle/` : migrations, dont les triggers d'audit en ajout seul et la vue `v_label_panel` (cible `y6`).
- `src/lib/import`, `calendar`, `aggregates` : import AJIR idempotent, règles qualité, jours fériés et Ramadan, `agg_kpi_monthly`.
- `src/lib/features`, `scoring`, `engine`, `anomalies`, `jobs` : 25 variables visibles à la date t, scoring B0 / régression logistique avec contributions exactes par groupe, règle de démarrage à froid (B0 sous 30 démissions observées), publication atomique, recommandations, alertes, détection robuste d'absentéisme, file de jobs. `src/worker/` est le seul écrivain des résultats en production.
- `src/lib/ai/<sujet>` : inférence TypeScript des IA par sujet (absentéisme, effectifs et masse salariale, formations, charge de travail), vérifiée par golden, et étape du batch mensuel. `src/lib/privacy` : opposition, export du droit d'accès, masquage des rejets d'import pour l'ADMIN.
- `src/lib/dal/` : seule couche lue par l'UI et l'API ; chaque fonction reçoit un `AccessContext` (ADMIN : administration seule, sans donnée RH ; RH : toute l'entreprise ; MANAGER limité à sa hiérarchie, sans salaire ni probabilité). `src/proxy.ts` ne fait qu'une vérification optimiste du cookie.
- `src/app/(app)/` : synthèse, tableau de bord, équipes, collaborateurs et fiche (what-if), absentéisme, formations, charge de travail, prévisions des effectifs, recommandations, interventions, alertes, vérification a posteriori (`/backtesting`), santé des données, transparence, dérive, droit d'accès, aide, administration ; `src/app/api/` : API JSON (`withApi`, 401/403/400 homogènes) ; `/go/collaborateur/<matricule>` et `/api/ajir/launch` pour l'ouverture depuis AJIR.
- `ml/` : simulateur Python de l'export AJIR avec vérité terrain, entraînement et évaluation du modèle turnover (`ml/train`, [docs/RESULTATS_ML.md](docs/RESULTATS_ML.md)) et des quatre IA par sujet ([ml/README.md](ml/README.md), `docs/RESULTATS_IA_*.md`).
- Sécurité : argon2id, sessions opaques hachées à expiration glissante (2 h d'inactivité, 10 h au plus), verrouillage progressif et limitation de débit, Server Actions (CSRF natif), contrôle d'origine sur l'API, CSP, audit en ajout seul de toutes les écritures, lectures sensibles et refus ; règle ESLint réservant l'accès à la base à `src/lib`. Protection des données : santé exclue de tout calcul, droits d'accès et d'opposition outillés, purge de rétention ([docs/conformite/](docs/conformite/)).

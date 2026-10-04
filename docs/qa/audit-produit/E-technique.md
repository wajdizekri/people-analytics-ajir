# Audit produit E — Audit technique (section 17)

Date : 04/10/2026. Agent E, lecture seule.

**Périmètre** : `src/` (50 981 lignes TS/TSX), `scripts/`, `drizzle/`, `package.json`, `eslint.config.mjs`. Hors périmètre : `wt/` (chantier IA, voir `docs/qa/CHANTIER_IA.md`), couverture de tests (`COUVERTURE.md`), sécurité et performance HTTP (`SECURITE_PERF.md`), contrôle des permissions des Server Actions (audit A).

**Méthode** : lecture des docs d'architecture, des ADR et de `CONVENTIONS.md`, puis lecture ciblée du code. Grep sur `src/`, `scripts/` et `tests/` pour les imports, les exports, les motifs de typage, les `catch` et les constantes. Carte de fréquence des identifiants pour repérer le code mort. Aucune commande de build, de test ni de serveur.

## 1. Architecture

### Forces

| Force | Preuve |
|---|---|
| La DAL est la seule couche d'accès pour l'UI | 0 appel `getDb()` ni `prepare()` dans `src/app` et `src/components`. Les 32 fichiers qui appellent `getDb()` sont dans `lib/dal`, `lib/auth`, `lib/audit.ts` et `db/client.ts`. Une règle ESLint l'impose (`eslint.config.mjs:10-20`). |
| Le périmètre est défini une seule fois | Une seule CTE récursive dans `src/lib` (`dal/context.ts:95-100`), réutilisée par `scopeFilter`, `canSeeEmployee` et `visibleEmployeeIds` (`context.ts:103-124`). |
| DTO par rôle typés | Union discriminée `view: "RH" \| "MANAGER"` (`dal/employees.ts:204-206`, `dashboard.ts:486`). |
| SQL paramétré, tri par liste blanche | `orderBy` choisi dans un objet fermé (`dal/employees.ts:258-265`), paramètres nommés partout. |
| Enveloppe API commune | Les 17 Route Handlers passent par `withApi` : contrôle d'origine, `HttpError` et `ZodError` typés, `correlationId` (`lib/api.ts:21-47`). |
| Bibliothèques de calcul indépendantes de Next | `features`, `scoring`, `anomalies`, `ai/*` reçoivent `sqlite` en paramètre. Elles sont partagées par le worker, les CLI et les tests. |
| SQLite bien configuré | WAL, `busy_timeout` 5 s, `synchronous = NORMAL`, `foreign_keys` (`db/client.ts:16-19`). Connexion unique via `globalThis` (`client.ts:23-31`). 34 transactions dans `src/lib`. Migrations Drizzle 0000 à 0006 appliquées par le worker au démarrage (`worker/index.ts:13`). |
| Typage strict propre | 0 `@ts-ignore` / `@ts-expect-error`. `any` présent seulement dans 3 fichiers ECharts, avec un `eslint-disable` justifié (`charts/theme.ts:119`, `echart.tsx:84` et `273`, `drill.ts:23`). Les 5 `as unknown as` sur 8 servent aux singletons `globalThis`. |
| Validation zod centralisée dans la DAL | Les routes sans schéma local valident dans la DAL (`dal/search.ts:58`, `dal/ajir.ts:55`). Même chose pour les actions : `updateSettings`, `changeOwnPassword`. |
| États de route | 25 `error.tsx` et 23 `loading.tsx` s'appuient sur un composant commun (`pilotage/route-states.tsx`). |
| Caches versionnés sur les écrans lourds | Le tableau de bord (`dal/dashboard.ts:466`) et la dérive (`dal/drift.ts:296`) indexent leur cache sur une empreinte des données. |
| Ni TODO ni démo dans le code de production | 0 `TODO` / `FIXME` / `XXX` / `HACK`. Le seul « TODO » est une constante nommée (`derive/page.tsx:42`). Aucune donnée simulée dans `src/`. |

### Faiblesses

| Faiblesse | Preuve |
|---|---|
| Copie du code par sujet d'IA plutôt que réutilisation | Le cycle de vie de `insight_recommendation` est codé 4 fois. Les règles divergent (§ 2, T1). |
| Pas de module de formatage commun au serveur et au client | `fmt` (`ui/index.tsx:428`) et `fr` (`ai/workload/insight-kit.tsx:12`) ont des valeurs par défaut différentes. S'y ajoutent une dizaine de `dec`, une douzaine de `pct` et 5 `MONTHS_FR` locaux. |
| Pas de couche « indicateurs » | Les heures supplémentaires sont calculées à 5 endroits, avec 3 définitions (REVUE_TRANSVERSE T2). `agg_kpi_monthly` ne descend qu'au département (`schema.ts:197-216`). |
| Règles métier dans les pages | Les cibles d'acceptation du modèle sont codées en dur 10 fois dans `transparency/page.tsx`. Les verdicts sont rédigés dans la page (`formations/page.tsx:73-95`, `transparency/page.tsx:86-115`). |
| Matrice rôle → page répétée | Elle existe dans 3 sources : `pageContext([...])` de chaque page, `NAV` (`layout/sidebar.tsx`) et `login/next-path.ts:7-8`. Une dérive est constatée (T2). |
| Dépendances de couches inversées | La DAL importe de l'UI et de `app/` (T14). |
| Drizzle sous-employé | Drizzle sert au schéma et aux migrations seulement. L'instance `db` de `client.ts:28` n'est jamais utilisée. Environ 500 `prepare()` dans `src/` renvoient des lignes typées par un simple `as {…}`. |

## 2. Problèmes techniques

| # | Problème | Fichier/module | Priorité | Effort | Solution |
|---|---|---|---|---|---|
| T1 | Le même objet `insight_recommendation` a 4 implémentations de mise à jour aux règles divergentes. (1) Le commentaire est écrasé par `NULL` côté effectifs (`comment = @comment`, au lieu de `COALESCE` partout ailleurs). (2) Seule la charge de travail protège la concurrence (`AND status = @from`). (3) Le manager agit sur toute sa hiérarchie en charge et formation, mais seulement sur ses recommandations directes en absentéisme. (4) Le motif de rejet est obligatoire partout sauf en absentéisme (`rejectNeedsComment={false}`, schéma sans `refine`). (5) Trois noms d'action d'audit coexistent : `insight.update`, `training.recommendation.update`, `insight.recommendation.update`. | `dal/ai-workforce.ts:237` ; `ai-workload.ts:282,293` ; `ai-training.ts:201,209-216` ; `ai-absenteeism.ts:108,122,133,153` ; `components/ai/absenteeism/reco-status-form.tsx:8` | P1 | faible | Avant la soutenance : passer `ai-workforce.ts:237` en `COALESCE(@comment, comment)`. Trancher les règles du motif de rejet et du périmètre manager, et les écrire dans `CONVENTIONS.md`. Après : un seul `updateInsightRecommendation(ctx, topic, id, input)` (§ 4). |
| T2 | La matrice rôle → page a dérivé : `ADMIN_ALLOWED` ne contient pas `/derive`, ouvert à l'ADMIN (`sidebar.tsx:61`, `derive/page.tsx` `pageContext(["RH","ADMIN"])`). `RH_ONLY` ne contient pas `/interventions`, réservé à la RH (`sidebar.tsx:33`). Après une reconnexion avec `?next=`, l'ADMIN revient à l'accueil au lieu de la Dérive, et le MANAGER tombe sur `/interdit` au lieu de son accueil. | `app/login/next-path.ts:7-8,21-26` | P2 | faible | Ajouter les deux entrées. À terme, une table `ROUTE_ROLES` unique, lue par les pages, `NAV` et `next-path`. |
| T3 | Les deux API de formatage ne donnent pas les mêmes valeurs par défaut. `fmt.pct` : 1 décimale. `fr.rate` : 2 décimales. `fmt.month` court : « sept. 2025 ». `fr.monthShort` : « sept. 25 ». S'y ajoutent `frNumber` en double, une dizaine de `dec`, une douzaine de `pct` et 5 `MONTHS_FR` locaux (dont `dal/synthesis.ts:15-19`, `dal/drift.ts:199`, `previsions/page.tsx:17`, `backtesting/page.tsx:18`). C'est une cause technique des écarts de chiffres entre écrans. | `components/ui/index.tsx:428-470` ; `ai/workload/insight-kit.tsx:12-26` ; `lib/export/csv.ts:24` ; `charts/theme.ts:161` | P2 | moyen | Créer `src/lib/format.ts`, sans JSX, importable par la DAL et par l'UI. `fmt` et `fr` deviennent des alias. Migrer au fil de l'eau (§ 4). |
| T4 | Les cibles du modèle sont codées en dur dans la page : lift ≥ 3, O/E entre 0,8 et 1,25, pente entre 0,8 et 1,2, O/E entre 0,7 et 1,4 à 12 mois. On les trouve 10 fois dans la page, et elles doublonnent `OE_TARGET` et `CALIBRATION_TARGET`. | `transparency/page.tsx:48,57,96-98,176,229-230,281,322` ; `dal/drift.ts:22` ; `monitoring/model-options.ts:124` | P2 | faible | Une constante `MODEL_TARGETS` dans `lib/scoring`, plus une fonction pure `modelVerdict()` testable. |
| T5 | Index manquants. `intervention(recommendation_id)` est lu par des sous-requêtes corrélées, une par ligne de recommandation. `recommendation(prediction_id)` est mis à jour en boucle : environ 2 445 `UPDATE`, chacun avec un parcours complet, lors du recalcul d'un run déjà publié. `intervention(employee_id)` est lu par la fiche et la synthèse. | `db/schema.ts:302-327` ; `dal/recommendations.ts:113` ; `dal/employees.ts:480` ; `dal/interventions.ts:95` ; `scoring/score.ts:147-150` ; `dal/synthesis.ts:499,611` | P2 | faible | Migration additive `CREATE INDEX`, à passer après la vérification finale. |
| T6 | Le cache des surcharges individuelles n'est pas versionné. Sa clé ne contient que `asOf`, le seuil et le nombre de mois. Après un réimport ou un recalcul du même mois, la liste reste périmée jusqu'au redémarrage du serveur web. | `dal/ai-workload.ts:158-167` | P2 | faible | Ajouter une empreinte des données à la clé, comme `dashboard.ts:466` et `drift.ts:296`. |
| T7 | Des erreurs sont avalées sans journal. Hors worker, le logger n'est importé que par `lib/api.ts` et `lib/ai/steps.ts` : aucun appel dans `src/lib/dal`. Exemples : un bundle illisible devient « pas de seuil » sans trace ; le bilan de santé renvoie « erreur » sans la cause. | `dal/ai-workload.ts:89` ; `dal/imports.ts:488` ; `dal/drift.ts:90,104` ; `dal/model.ts:138` ; `dal/data-monitoring.ts:74` | P2 | faible | `logger.warn({ err }, …)` dans ces `catch`, sans changer le comportement. |
| T8 | Calculs complets à chaque requête, sans agrégat d'équipe. `/equipes` relit les absences et les heures sup de toute la population, avec `json_each` sur environ 2 445 identifiants et sans cache. `/organigramme` charge toute la table `employee`. Les heures sup sont calculées à 5 endroits. La latence de ces pages en build de production n'est pas mesurée par `SECURITE_PERF.md` § 9.3 : à vérifier. | `dal/teams.ts:76-114` ; `dal/org-chart.ts:310` ; `aggregates/index.ts:112` ; `ai/workload/panel.ts:100,375` ; `ai/training/features.ts:101` | P2 | moyen | D'abord mesurer `/equipes` et `/organigramme` (effort faible). Si c'est lent : cache versionné, comme pour le tableau de bord. |
| T9 | Dépendance inutilisée `date-fns` : aucun import dans `src/`, `scripts/`, `tests/` ni `shared/`. | `package.json:16` | P2 | faible | `npm uninstall date-fns`, après la vérification finale. |
| T10 | Le barème SMIG par défaut est marqué « À CONFIRMER ». Il alimente le contrôle d'import « salaire ≥ SMIG ». | `lib/settings.ts:15-19` | P2 | faible | Confirmer la source ou le signaler dans le rapport. La valeur reste modifiable dans Paramètres. |
| T11 | La Server Action de recommandation est copiée 4 fois. Les messages divergent (« Session expirée. Reconnectez-vous. » contre « Session expirée : reconnectez-vous. »). Les types de retour aussi (`ok: string` contre `ok: true`). L'une des copies est rangée dans `components/`. | `formations/actions.ts` ; `charge/actions.ts` ; `previsions/actions.ts:28` ; `components/ai/absenteeism/actions.ts:14` | P2 | moyen | Une fabrique `makeRecoAction(topic)` après la fusion du chantier IA (§ 4). |
| T12 | Composants UI en double. `KpiTile` (6 fichiers) et `KpiCard` (9 fichiers). `StatusPill`, `Icon` (deux jeux de tracés) et `fieldCls` existent dans `ui/` et dans `admin/admin-ui.tsx`. `ROLE_LABEL` est défini 4 fois. Le `RecoBoard` partagé est rangé dans `components/ai/workload/`, alors qu'il est importé par l'absentéisme et les formations. | `ui/index.tsx:192` ; `charts/pbi.tsx:232` ; `admin/admin-ui.tsx:4,30,168,181` ; `layout.tsx:13` ; `export/print-header.tsx:5` ; `help/content.ts:8` | P3 | moyen | Garder une seule version de chaque. Déplacer `RecoBoard` dans `components/ai/shared` (§ 4). |
| T13 | Helpers de dates en double. Trois fonctions portent le même nom avec des signatures différentes : `addMonths` attend « AAAA-MM » dans `calendar/` mais « AAAA-MM-JJ » dans `features/dates.ts`. `monthIndex` et `monthLabel` sont recopiés 3 fois. | `calendar/index.ts:24-43` ; `features/dates.ts:23-46` ; `dal/pilotage-metrics.ts:7-12` ; `ai/workload/panel.ts:23-24` ; `ai/workforce/engine.ts:82-83` ; `ai/absenteeism/series.ts:10` | P3 | moyen | Un seul module `lib/dates.ts` avec des noms explicites (`addMonthsYm`, `addMonthsIso`). |
| T14 | Couches inversées. La DAL importe des libellés de l'UI et de `app/`. Le contexte d'accès importe dynamiquement `app/login/next-path`, cycle signalé en commentaire. Un paramètre générique (`referenceDate`) vit dans la DAL des collaborateurs. | `dal/export.ts:3-4` ; `dal/context.ts:54,63` ; `dal/employees.ts:121` (importé par `(app)/layout.tsx:5`) | P3 | faible | Déplacer les libellés dans `lib/labels`, `safeNextPath` dans `lib/auth`, `referenceDate` dans `lib/settings`. |
| T15 | Gardes de rôle en double dans la DAL : `ensureRole`, exportée par `admin.ts` et importée par 6 modules, `ensureRh` écrite 2 fois, `ensurePilotage`. L'autorisation reste bien dans la DAL. | `dal/admin.ts:13` ; `dal/privacy.ts:24` ; `dal/ai-workforce.ts:93` ; `dal/context.ts:87` | P3 | faible | Tout regrouper dans `context.ts`, après le chantier IA (fichier gelé, `CHANTIER_IA.md:14`). |
| T16 | Vestige du développement en parallèle : `optionalModule` charge dynamiquement « les modules écrits par d'autres contributeurs ». Le calendrier et les agrégats sont ignorés en silence s'ils manquent. Les types sont recopiés à la main. | `jobs/handlers.ts:10-49,88-94` | P3 | faible | Imports statiques, comme `../ai/steps` dans le même fichier. |
| T17 | 31 fichiers de `src/` dépassent 400 lignes (liste ci-dessous). Les plus gros : `transparency/page.tsx` (1 071 lignes, 18 composants internes plus le verdict), `employee-detail.tsx` (807), `dal/admin.ts` (763, 6 sections : comptes, activation, paramètres, console, audit, modèles par sujet). | voir liste | P3 | moyen | Découper après la soutenance (§ 4). |
| T18 | Les lignes SQL sont typées par un simple `as {…}` sur environ 500 `prepare()`. Une colonne renommée ne casse pas `tsc`. | `src/lib/**` | P3 | élevé | § 4. Choix conforme à `CONVENTIONS.md`. |
| T19 | `GET /api/health` écrit une alerte (worker périmé) et avale toute exception. C'est un effet de bord dans une lecture. | `dal/imports.ts:252-263,474-490` | P3 | faible | Le documenter (choix volontaire : le worker ne peut pas s'alerter lui-même) et journaliser l'erreur (T7). |
| T20 | Aucun `PRAGMA optimize` ni `ANALYZE` : le planificateur SQLite n'a aucune statistique sur `attendance_daily`, la plus grosse table. | `db/client.ts:16-19` ; `scripts/` | P3 | faible | `PRAGMA optimize` en fin d'import ou de batch dans le worker. |
| T21 | Les tests sont répartis dans deux arborescences : 10 `*.test.ts` dans `src/lib` et `src/worker`, le reste dans `tests/`. Un helper de test (`test-db.ts`) est rangé dans `src/lib/import/`. | `src/lib/import/test-db.ts` | P3 | faible | Tout ranger dans `tests/`, après la soutenance. |
| T22 | Couleurs en dur hors jetons : niveaux de tension, encres du suivi de modèle. Six teintes de la palette d'avant le 04/10 n'ont plus aucune occurrence hors `theme.ts`. | `insights/teams.tsx:9-12` ; `insights/teams-treemap.tsx:16-17,53-72` ; `monitoring/model-options.ts:13-18` ; `charts/theme.ts:79-86` | P3 | faible | Passer par `SEMANTIC` et les variables `--pa-chart-*`. Retirer les entrées mortes. |

**Fichiers de plus de 400 lignes dans `src/`** (en lignes) : transparency/page.tsx 1071 · pilotage/employee-detail.tsx 807 · dal/admin.ts 763 · import/index.ts 721 · charts/builders.ts 676 · dashboard/page.tsx 649 · charts/pbi.tsx 639 · dal/employees.ts 638 · dal/synthesis.ts 623 · pilotage/what-if-panel.tsx 587 · previsions/page.tsx 563 · db/schema.ts 562 · aide/sections.tsx 559 · help/content.ts 527 · monitoring/model-options.ts 518 · monitoring/data-options.ts 516 · dal/imports.ts 491 · dal/dashboard.ts 489 · charge/page.tsx 477 · backtesting/page.tsx 476 · ui/index.tsx 473 · anomalies/index.ts 457 · privacy/export.ts 452 · absenteeism/page.tsx 447 · derive/page.tsx 445 · interventions/page.tsx 424 · admin/page.tsx 422 · dal/model.ts 417 · ux/command-palette.tsx 405 · data-health/page.tsx 403 · dal/teams.ts 402.

## 3. Code mort et dépendances inutilisées

Vérifié par Grep sur `src/`, `scripts/` et `tests/`. « 0 référence » signifie que l'identifiant n'apparaît qu'à sa définition.

| Élément | Emplacement | Constat |
|---|---|---|
| `date-fns` | `package.json:16` | 0 import. Toutes les autres dépendances sont importées (`tsx` sert au worker et aux CLI en production). |
| `FrChart`, `withFrenchFormat` (fichier entier) | `components/insights/fr-chart.tsx` | Importés seulement par `tests/pilotage/dashboard-visuals.test.ts:8`. |
| `toneCss` (fichier entier) | `components/monitoring/tones.ts:5` | 0 référence. |
| `donutOption`, `gaugeOption`, `donutLegendValues` (environ 130 lignes, deux sont `@deprecated`) | `charts/pbi.tsx:420-552` | Utilisés seulement par `tests/charts/pbi.test.ts`. |
| `ActionChip` | `admin/admin-ui.tsx:49` | 0 référence. |
| `psiBarsOption`, `oeLineOption` | `insights/chart-options.ts:11,38` | 0 référence. Remplacés par `monitoring/`. |
| `TENSION_TONE`, `SIGNAL_LABELS`, `DRIFT_LABELS`, `DRIFT_TONE`, `formatPsi` | `insights/labels.ts:7,19,27,28,89` | 0 référence. |
| `importLabel` | `monitoring/data-options.ts:75` | 0 référence. |
| `formatLift` | `pilotage/labels.ts:39` | 0 référence. |
| `RouteLoading` | `pilotage/route-states.tsx:27` | 0 référence. Les `loading.tsx` utilisent les squelettes. |
| `visibleTo` | `lib/help/content.ts:17` | 0 référence. |
| `IMPORT_FILES` | `lib/import/index.ts:16` | 0 référence. |
| Instance Drizzle `db` | `db/client.ts:28` | Jamais utilisée : ni `getDb().db`, ni `db.select`, nulle part. |
| `scripts/seed-dev-admin.ts` | `scripts/` | Aucune référence (ni `package.json`, ni docs, ni tests). Mot de passe de démo par défaut `DemoAjir2026` (ligne 13), base de dev uniquement. |
| Scripts hors `package.json` | `demo-passwords`, `eval-anomalies`, `export-panel`, `model`, `perf`, `seed-dev-ui` | Documentés, appelés par `npx tsx`. Ce n'est pas du code mort, mais `scripts/model.ts`, registre du modèle turnover, n'a pas d'alias `npm run`. |
| Pages hors menu | — | Aucune. Les 24 pages de premier niveau sont dans `NAV` (`layout/sidebar.tsx:18-70`). `/alerts/[id]` et `/employees/[id]` sont atteintes par lien. |
| Exports superflus | 131 exports (hors types, schéma, pages et routes) | Utilisés seulement dans leur propre fichier (constantes, helpers), en plus des exports morts listés plus haut. Ce n'est pas du code mort, juste un `export` inutile. À ne pas traiter. |

Les routes `/api/dashboard`, `/api/employees`, `/api/alerts`, `/api/me`, `/api/admin/users` et `/api/predictions/run` ne sont pas appelées par l'UI (seuls `/api/imports`, `/api/search`, `/api/employees/[id]/what-if` et `/api/privacy` le sont). Elles sont documentées et couvertes par `tests/security` : c'est une surface d'intégration, pas du code mort.

## 4. Dette à NE PAS traiter avant la soutenance

Le rapport risque / bénéfice est défavorable : E2E à 153/153 et captures en cours (VERIFICATION_FINALE.md), chantier IA à fusionner.

| Dette | Pourquoi attendre |
|---|---|
| Factoriser les 4 cycles de vie des recommandations IA : DAL, actions et formulaires (T1, T11) | Touche `charge/` et `previsions/`, en cours de modification par l'agent CONFORME (`CHANTIER_IA.md:38`), donc risque de conflit de fusion. Seul le correctif `COALESCE` de T1 vaut d'être fait avant. |
| Consolider les formatages `fmt`, `fr`, `dec` et `pct` (T3) | Change des chaînes visibles vérifiées par les specs E2E et les captures finales. |
| Découper `transparency/page.tsx`, `employee-detail.tsx` et `dal/admin.ts` (T17) | Gros diff sans gain visible. `transparency` vient d'être livrée par a7. `what-if-panel.tsx` est dans le périmètre de LEVIER. |
| Renommer les routes anglaises en français (`/absenteeism`, `/employees`, `/recommendations`…) | Liens profonds AJIR documentés (`INTEGRATION_AJIR.md`), E2E, aide et `next-path`. |
| Passer au constructeur de requêtes Drizzle, ou valider les lignes avec zod (T18) | Environ 500 requêtes : risque de régression maximal pour un gain de typage seulement. |
| Supprimer les fonctions dépréciées encore testées (`donutOption`, `gaugeOption`, `FrChart`) | Il faudrait modifier des tests. Gain nul pour la démonstration. |
| Regrouper les gardes de rôle dans `context.ts` (T15) | Fichier gelé pendant le chantier IA (`CHANTIER_IA.md:14`). |
| Agrégat mensuel au grain équipe (T8) | Nouvelle table, migration et batch. Mesurer d'abord. |
| Unifier les composants d'administration (`Icon`, `StatusPill`, `fieldCls`) avec `ui/` (T12) | Périmètre a7 tout juste terminé, plus des captures admin en clair et sombre. |
| Déplacer les tests de `src/` vers `tests/` (T21) | Aucun bénéfice pour la soutenance. Risque de casser la configuration de vitest. |

## Notes proposées

| Dimension | Note | Justification |
|---|---|---|
| Architecture | 7/10 | Séparation UI / DAL / calcul exemplaire et outillée (règle ESLint, `AccessContext`, DTO par rôle, `withApi`), typage propre. Mais la logique est dupliquée par sujet d'IA, avec des règles divergentes. Il manque des modules communs (formatage, dates, indicateurs, matrice des droits), et quelques règles métier se trouvent dans des pages de plus de 1 000 lignes. |

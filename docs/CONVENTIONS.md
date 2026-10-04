# Conventions du projet People Analytics AJIR

Référence commune pour tous les contributeurs. Cahier des charges : `../Sujet_PFE_People_Analytics_AJIR_v2.pdf`. Plan détaillé : `../PLAN_PFE.md`.

## Stack (non négociable)

React + Next.js 16 (App Router) + SQLite. Ajouts : TypeScript strict, Drizzle ORM (better-sqlite3), zod, Tailwind v4, ECharts, croner, pino, Vitest. Python uniquement hors ligne dans `ml/` (simulateur, entraînement, évaluation). **Jamais de Python en production**, jamais de second backend.

Next.js 16 : `middleware` s'appelle `proxy` (`src/proxy.ts`) ; `cookies()`, `headers()`, `params` et `searchParams` sont **async** ; lire `node_modules/next/dist/docs/` en cas de doute.

## Arborescence et propriété

| Dossier | Contenu |
|---|---|
| `src/db/schema.ts` | Schéma unique (Drizzle). Modifier = ajouter seulement, puis `npm run db:generate` |
| `src/db/client.ts` | Connexion SQLite (WAL, busy_timeout, foreign_keys) — `getDb()` |
| `src/lib/auth/` | Mots de passe argon2id, sessions opaques, login |
| `src/lib/dal/` | **Seule** couche autorisée à lire la base pour l'UI et l'API. Chaque fonction prend un `AccessContext` |
| `src/lib/import/`, `src/lib/calendar/`, `src/lib/aggregates/` | Import CSV AJIR, contrôles qualité, calendrier tunisien, agrégats |
| `src/lib/features/`, `src/lib/scoring/`, `src/lib/anomalies/`, `src/lib/jobs/` | Variables, scoring (dont démarrage à froid, `scoring/cold-start.ts`), anomalies, file de jobs |
| `src/lib/ai/<sujet>/` | IA par sujet (absenteeism, workforce, training, workload) : inférence TypeScript des bundles, étape du batch (`step.ts`), registre commun `ai/registry.ts` |
| `src/lib/privacy/` | Opposition (`opposition.ts` : `excludeOpposed`), export du droit d'accès, masquage des rejets d'import pour l'ADMIN (`mask.ts`) |
| `src/worker/` | Process worker Node (seul écrivain des résultats de calcul) |
| `src/app/(app)/...` | Pages protégées ; `src/app/api/...` Route Handlers |
| `src/components/ui/index.tsx` | Composants partagés (PageHeader, Card, KpiTile, RiskBadge, Badge, EmptyState, Notice, tableCls, fmt) |
| `src/components/charts/echart.tsx` | Wrapper ECharts client |
| `shared/features.json` | Contrat des variables (ordre, groupes, imputation, libellés, règles B0) lu par TS et Python |
| `scripts/` | CLI (tsx) : migrate, seed, import, pipeline... |
| `ml/` | Python hors ligne (uv ou pip) : `ml/sim`, `ml/train` |
| `models/turnover/<version>/` | Bundles du modèle turnover (JSON), registre `model_version` |
| `models/<sujet>/<version>/` | Bundles des IA par sujet (`absenteeism`, `workforce`, `training`, `workload`), registre `topic_model` |
| `data/` | Bases SQLite et CSV simulés (non versionnés) |

## Règles de sécurité (à respecter partout)

- Autorisation **toujours côté serveur** dans `src/lib/dal/*`, jamais dans le proxy ni dans un composant client.
- Pages : `const ctx = await pageContext(["RH"])` (redirige). API : `withApi(async (req) => { const ctx = await requireContext([...]); ... })` (401/403 JSON).
- **Séparation des tâches** : l'ADMIN administre l'outil (comptes, paramètres, audit, imports, santé des données, modèle) et ne voit **aucune donnée RH** : pas de tableau de bord, fiche, absentéisme, recommandation, what-if ni backtesting (`ensurePilotage(ctx, action)` en tête des fonctions DAL de pilotage, `isGlobal` = RH seul, `PILOTAGE_ROLES` pour les pages). Alertes ADMIN : audience `ADMIN` et alertes `DONNEES` non nominatives. Accueil par rôle : `homePath(role)` (`/admin` ou `/dashboard`). Écrans communs : Alertes (filtrées par rôle) et Mon compte (`/compte`).
- Périmètre manager : `scopeFilter(ctx, "e.id")` / `canSeeEmployee(ctx, id)` / `visibleEmployeeIds(ctx)` dans `src/lib/dal/context.ts`. Hors périmètre sur une ressource précise → **403** ; ressource inexistante → **404**.
- **DTO par rôle** : un manager ne reçoit jamais de salaire, de masse salariale, de probabilité brute, de phrase chiffrée de facteur (`phrase_rh`), ni de signal d'absentéisme individuel. Il reçoit : niveau de risque, catégories de facteurs (`phrase_manager`), KPI de son équipe hors rémunération.
- **Rejets d'import vus par l'ADMIN** (`maskRejectionMessage`, `src/lib/privacy/mask.ts`) : le matricule reste visible (nécessaire pour corriger la donnée dans AJIR) ; montants et valeurs brutes sensibles masqués quel que soit le fichier ; pour `absences.csv`, toutes les dates, catégories, durées et autres valeurs d'absence masquées. La RH voit le message d'origine.
- **Opposition** (loi 2004-63, art. 42) : tout traitement individuel filtre la liste par `excludeOpposed(sqlite, rows)` (`src/lib/privacy/opposition.ts`) avant calcul ou écriture : variables (`backfillFeatures`), panel exporté (`scripts/export-panel.ts`), scoring, effets de publication, what-if (409 `OPPOSITION`), étapes IA. L'enregistrement d'une opposition purge les résultats prédictifs individuels existants (`purgePredictiveData`).
- **Petits groupes** : côté manager, aucun taux d'absence, turnover ou nombre de sorties sur un groupe de moins de `MIN_GROUP_SIZE` (5) personnes, ni déductible par différence avec un total (`smallGroupMask`, `src/lib/dal/pilotage-metrics.ts`). Catégories jamais montrées au manager : `ABSENCES`, et `REMUNERATION` avec un score à règles B0 ; action `REVISION_SALARIALE` réservée à la RH (`managerVisibleGroup`, `RH_ONLY_ACTIONS` dans `src/lib/features/spec.ts`).
- Validation zod de toutes les entrées (query, body, formData).
- Audit (`src/lib/audit.ts`) de toutes les écritures et des lectures sensibles : ouverture de fiche (`employee.view`), consultation salaire/score, export, what-if, changement de paramètres, promotion de modèle, accès refusé (`outcome: "REFUSE"`).
- Mutations depuis l'UI : Server Actions (protégées CSRF nativement) qui appellent la DAL ; Route Handlers mutants passent par `withApi` (contrôle d'origine).
- Maladie et maternité (`absence_episode.is_health = 1`) : jamais dans une variable ni un score individuel.

## Conventions de code

- TypeScript strict, pas de `any` non justifié. Requêtes SQL brutes via `getDb().sqlite.prepare(...)` autorisées (paramètres nommés `@x`), jamais de concaténation de valeurs utilisateur.
- Dates en texte ISO (`YYYY-MM-DD`, mois `YYYY-MM`). Montants en TND (REAL).
- Libellés UI en français. Une couleur de risque est toujours accompagnée d'un libellé (`RiskBadge`).
- États loading / vide / erreur sur chaque écran (`EmptyState`, `Notice`).
- Pas de commentaires explicatifs sauf logique non évidente.
- Vérification : `npx tsc --noEmit` et `npx vitest run <dossier>`. **Ne pas lancer `next build` ni `next dev` en parallèle d'autres contributeurs** (conflit sur `.next/`).
- Chaque contributeur travaille sur sa propre base : `DATABASE_PATH=data/dev-<nom>.db`, créée par `npm run db:migrate`.

## Contrat d'export AJIR (CSV)

Un dossier par export. Séparateur `;`, UTF-8, en-tête obligatoire, dates `YYYY-MM-DD`, mois `YYYY-MM`, heures `HH:MM`, décimales avec `.`. Champs vides = valeur absente.

| Fichier | Colonnes |
|---|---|
| `departments.csv` | `code;name` |
| `employees.csv` | `matricule;last_name;first_name;sex(F/M);birth_date;hire_date;department_code;job_family;job_title;grade;manager_matricule;governorate;marital_status` |
| `contracts.csv` | `matricule;contract_type(CDI/CDD/SIVP/STAGE);start_date;end_date` |
| `exits.csv` | `matricule;exit_date;exit_reason(DEMISSION/ABANDON/FIN_CDD/LICENCIEMENT/RETRAITE/DECES/MUTATION/AUTRE);resignation_date;recorded_at` |
| `career_events.csv` | `matricule;date;event_type(PROMOTION/AUGMENTATION/MUTATION/CHANGEMENT_MANAGER/CHANGEMENT_POSTE);old_value;new_value;recorded_at` |
| `attendance.csv` | `matricule;date;check_in;check_out;worked_minutes;overtime_minutes;late_minutes` (une ligne par jour ouvré pointé) |
| `absences.csv` | `matricule;start_date;end_date;days;category(CONGE_ANNUEL/MALADIE/MATERNITE/ABSENCE_INJUSTIFIEE/CONGE_SANS_SOLDE/AUTRE);recorded_at` |
| `payroll.csv` | `matricule;month;base_salary;gross_salary;overtime_hours;recorded_at` |
| `trainings.csv` | `matricule;training_code;title;mandatory(0/1);start_date;end_date;due_date;hours;status(PLANIFIEE/EN_COURS/TERMINEE/ABANDONNEE)` |
| `evaluations.csv` | `matricule;eval_date;score;recorded_at` (score 1 à 5) |
| `users.csv` | `login;matricule;role(ADMIN/RH/MANAGER);email;active(0/1)` (synchronisation des comptes) |

`grade` : texte `G1`…`G8` (niveau = nombre). `recorded_at` = date de saisie dans AJIR (sert à la visibilité as-of). `career_events` : `AUGMENTATION` → old/new = salaire de base ; `PROMOTION` → old/new = grade ; `CHANGEMENT_MANAGER` → old/new = matricules ; `MUTATION` → codes département ; `CHANGEMENT_POSTE` → intitulés.

Le simulateur écrit aussi, **hors export AJIR**, un dossier `ground_truth/` (latents, vraies probabilités, anomalies injectées étiquetées) qui n'est jamais importé dans l'application.

## Contrats entre modules (signatures)

```ts
// src/lib/calendar/index.ts
buildCalendar(sqlite, fromYear: number, toYear: number): number            // remplit dim_date, renvoie nb de jours
// src/lib/import/index.ts
runImport(sqlite, dir: string, opts?: { userId?: number; source?: string }): Promise<ImportResult>
// ImportResult = { batchId, status: "OK"|"BLOQUE"|"ECHEC", rowsOk, rowsRejected, qualityScore, dataEndDate }
// met à jour app_setting.data_end_date (dernier pointage accepté du lot, jamais en recul ; pointages futurs ou hors emploi rejetés)
// src/lib/aggregates/index.ts
refreshAggregates(sqlite, months?: string[]): number                        // recalcule agg_kpi_monthly
// src/lib/features/index.ts
computeFeatures(sqlite, employeeId: number, asOf: string): { values: number[]; partial: boolean } | null   // null = non éligible
backfillFeatures(sqlite, fromMonth: string, toMonth: string): number        // écrit feature_snapshot (fsv courante)
// src/lib/scoring/index.ts
loadChampion(sqlite): LoadedModel | null
scoreMonth(sqlite, asOf: string): { runId: number; nScored: number }       // STAGING puis publication atomique
explain(model, values): GroupContribution[]                                // contributions exactes (log-odds) par groupe
// src/lib/anomalies/index.ts
detectAnomalies(sqlite, fromWeek: string, toWeek: string): number
// src/lib/jobs/index.ts
enqueueJob(sqlite, type, target?, payload?, userId?): number
```

## Population, cible et variables (volet ML)

- **Éligibilité à la date t (fin de mois)** : salarié actif à t, entré depuis ≥ 1 mois, contrat CDI ou CDD dont le terme dépasse t + 6 mois (SIVP et STAGE exclus), âge < 60 ans à t + 6 mois, pas de démission déjà posée à t (date de démission, sinon sortie − 1 mois).
- **Cible** : `y6` de la vue `v_label_panel` (démission ou abandon dans ]t, t+6 mois]) ; les autres sorties comptent 0 (risque concurrent). Entraîner uniquement sur `followup_complete = 1`.
- **Visibilité as-of** : une ligne source n'est utilisée que si son événement est ≤ t **et** sa date de saisie (`recorded_at`) ≤ t. Pour les sources sans `recorded_at` (pointages, formations), date d'événement seule.
- **Variables** : `shared/features.json` (fsv `v1`, 25 variables, 6 groupes, imputation fixe). Les absences `is_health` et `CONGE_ANNUEL` sont exclues des variables d'absence ; les jours d'absence justifiée sont exclus du calcul des jours sans pointage.

## Format du bundle modèle (`models/turnover/<version>/model.json`)

```json
{
  "version": "logreg-v1-20260930", "kind": "LOGREG", "fsv": "v1",
  "features": ["tenure_months", "..."],
  "standardization": { "mean": [0.0], "std": [1.0] },
  "coef": [0.0], "intercept": 0.0,
  "calibration": { "method": "platt", "a": 1.0, "b": 0.0 },
  "base_rate": 0.035,
  "trained_at": "2026-09-30T00:00:00Z", "data_hash": "sha256...", "train_rows": 0,
  "metrics": {}
}
```

Probabilité : `z_j = (x_j - mean_j) / std_j`, `logit = intercept + Σ coef_j z_j`, `p = sigmoid(a * logit + b)`. Contribution exacte de la variable j au logit par rapport au profil moyen : `a * coef_j * z_j` ; contribution d'un groupe = somme. `golden.json` à côté : `[{ "x": [...valeurs brutes...], "p": 0.0123 }]` (200 lignes) ; le scorer TS doit reproduire `p` à 1e-9 près. Un bundle `kind: "B0"` n'a que `"rules"` (celles de `features.json`) : son score est un nombre de points, affiché « score à règles », jamais comme une probabilité.

**Démarrage à froid** (`src/lib/scoring/cold-start.ts`, docs/RESULTATS_ML.md § 5d) : démissions observées à t = salariés distincts ayant un mois éligible suivi d'une démission ou d'un abandon dans les 6 mois (définition de `v_label_panel`), horizon clos à t et sortie saisie à t. Sous `min_events_for_model` (30), un champion probabiliste n'est pas utilisé : `scoreMonth` score avec B0 (`loadB0Fallback`, enregistré au besoin, jamais promu), le résultat porte `coldStart` et l'audit `scoring.publish` aussi. Sous `indicative_until_events` (150), la probabilité est « indicative ». La DAL `getTransparency` expose `coldStart` (`active`, `indicative`, `events`, `threshold`, `message`) et `publishedRun` (modèle réellement utilisé). `0` désactive la règle (tests sur petites bases).

**Niveau de risque** : ÉLEVÉ = top `capacity_rate` (défaut 2 %) de l'effectif scoré, pris comme un plafond : k = max(1, ⌊n × `capacity_rate`⌋), le minimum de 1 ne jouant que sous 1/`capacity_rate` scorés (des ex-æquo qui franchiraient la limite restent tous hors ÉLEVÉ, jamais départagés par l'id) ; MOYEN = lift (p / moyenne des p) ≥ `medium_lift` (défaut 2) ; FAIBLE sinon.

## IA par sujet

- Un sujet = un dossier `src/lib/ai/<sujet>/`, des bundles `models/<sujet>/<version>/` (`model.json`, `golden.json` rejoué à 1e-9 au chargement ou à l'enregistrement), un champion par sujet dans `topic_model` (`AI_TOPICS` : `ABSENTEISME`, `EFFECTIF`, `MASSE_SALARIALE`, `FORMATION`, `CHARGE_TRAVAIL` ; `TURNOVER` reste dans `model_version`). `npm run topic-model -- register <SUJET> <dossier> | promote <version> | list`. Chemin du bundle enregistré relatif à la racine du projet.
- Étape du batch : `runStep(sqlite, asOf)` appelée par `runAiSteps` (`src/lib/ai/steps.ts`) après le scoring, dans `runMonthlyBatch` et `scripts/pipeline.ts`. Idempotente (relance = même état) ; une erreur d'un sujet est journalisée sans arrêter les autres ; sans champion, l'étape est ignorée.
- `forecast` : prévisions **agrégées** seulement (entreprise, département, équipe ≥ `MIN_GROUP_SIZE`). `horizon` 1..12 = mois prévu avec bornes à 80 % (`lower`, `upper`) ; **`horizon = 0` = valeur observée** (historique précalculé à la composition de l'origine, sans bornes ; utilisé par la charge de travail pour éviter un recalcul à l'affichage). `as_of` = fin du dernier mois observé.
- `training_risk` : seule prédiction individuelle des IA par sujet (risque de retard d'une formation obligatoire), niveau à seuils fixes du bundle ; le manager voit le niveau et des facteurs en clair pour sa hiérarchie, jamais la probabilité. La surcharge individuelle (charge de travail) est une règle, rendue en recommandation `SALARIE` réservée à la RH.
- `insight_recommendation` : recommandations par sujet, distinctes des recommandations turnover ; `scope` ENTREPRISE / DEPARTEMENT / EQUIPE / SALARIE, `audience` RH ou MANAGER, `dedup_key` unique (une recommandation réalisée ou rejetée n'est jamais réécrite), justification en langage RH sans donnée de santé ni nom côté manager. Statut modifié par Server Action → DAL, audité `insight.recommendation.update` / `insight.update`.
- Opposition : `excludeOpposed` avant tout calcul individuel ; maladie et maternité jamais utilisées.

## Commandes

```
npm run db:migrate                     # applique drizzle/*.sql
npm run seed:admin -- admin MotDePasse1
npm run sim -- --config small          # Python : génère data/sim/<scenario>_<config>_s<seed>/
npm run import -- data/sim/<dossier>   # import AJIR
npm run pipeline -- --to 2026-08       # agrégats + variables + scoring + anomalies + alertes
npm run worker                         # worker planifié (file app_job + batch mensuel)
npm run topic-model -- list            # IA par sujet : register / promote / list
npm run backup | restore | check-install | runs | retention   # exploitation (docs/EXPLOITATION.md)
npm test                               # vitest (tests/security exclus sans SEC_BASE_URL)
npm run test:security                  # attaques contre un serveur lancé à part (SEC_BASE_URL, défaut :3300)
```

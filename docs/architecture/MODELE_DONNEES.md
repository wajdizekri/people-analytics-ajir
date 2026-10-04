# Modèle de données et diagramme de classes

Source de vérité : le schéma Drizzle [src/db/schema.ts](../../src/db/schema.ts) et les migrations [drizzle/](../../drizzle/) (`0000_init.sql` tables et index, `0001_audit_triggers.sql` triggers d'ajout seul et vue `v_label_panel`, `0002` sévérité des rejets, `0003` nouvelle définition de la vue). La signification de chaque colonne est donnée dans [docs/DICTIONNAIRE.md](../DICTIONNAIRE.md).

La base compte **28 tables et 1 vue**, organisées en cinq familles :

| Famille | Tables | Écrivain |
|---|---|---|
| Sources AJIR (lecture seule pour l'application) | `department`, `employee`, `contract`, `exit_event`, `career_event`, `attendance_daily`, `absence_episode`, `payroll_monthly`, `training`, `evaluation` | import (worker ou CLI) |
| Calendrier et imports | `dim_date`, `import_batch`, `import_rejection` | CLI (`buildCalendar`), import |
| Agrégats | `agg_kpi_monthly` | `refreshAggregates` (worker ou CLI) |
| Couche ML, résultats de calcul et objets métier | `feature_snapshot`, `model_version`, `scoring_run`, `prediction`, `prediction_factor`, `recommendation`, `intervention`, `anomaly`, `alert`, vue `v_label_panel` | worker ou CLI ; Next.js ne modifie que les statuts (alertes, recommandations) et crée les interventions |
| Application | `app_user`, `session`, `audit_log`, `app_job`, `app_setting` | Next.js et worker |

Notation : trait plein = clé étrangère **déclarée** en base (`REFERENCES`, contrôlée car `foreign_keys = ON`) ; trait pointillé = référence **logique** portée par une colonne `*_id` sans contrainte (choix de l'implémentation : les tables de résultats et d'application ne bloquent pas un réimport des sources).

## 1. Vue d'ensemble des relations

```mermaid
erDiagram
  department ||--o{ employee : "rattache"
  employee |o..o{ employee : "manage (manager_id)"
  employee ||--o{ contract : "contrats"
  employee ||--o{ exit_event : "sortie"
  employee ||--o{ career_event : "carrière"
  employee ||--o{ attendance_daily : "pointages"
  employee ||--o{ absence_episode : "absences"
  employee ||--o{ payroll_monthly : "paie"
  employee ||--o{ training : "formations"
  employee ||--o{ evaluation : "évaluations"
  dim_date ||..o{ attendance_daily : "jour (date)"
  import_batch ||--o{ import_rejection : "rejets"
  department ||..o{ agg_kpi_monthly : "agrégé par"
  employee ||..o{ feature_snapshot : "variables à t"
  feature_snapshot ||..|| v_label_panel : "étiquette y6"
  model_version ||..o{ scoring_run : "modèle du run"
  scoring_run ||--o{ prediction : "prédictions"
  employee ||..o{ prediction : "évalué"
  prediction ||--o{ prediction_factor : "facteurs"
  prediction |o..o{ recommendation : "déclenche"
  employee ||..o{ recommendation : "concerne"
  recommendation |o..o{ intervention : "réalisée en"
  employee ||..o{ intervention : "bénéficie"
  employee |o..o{ anomaly : "signal individuel"
  department |o..o{ anomaly : "signal collectif"
  employee |o..o{ alert : "concerne"
  department |o..o{ alert : "concerne"
  employee |o..o| app_user : "compte lié (racine du périmètre)"
  app_user ||--o{ session : "sessions"
  app_user |o..o{ audit_log : "auteur"
  app_user |o..o{ app_job : "demandeur"
  app_user |o..o{ import_batch : "lance"
  app_user |o..o{ app_setting : "modifie"
  app_user |o..o{ model_version : "promeut"
```

## 2. Sources AJIR, calendrier, imports et agrégats

```mermaid
erDiagram
  department {
    integer id PK
    text code UK "code AJIR"
    text name
  }
  employee {
    integer id PK
    text matricule UK "matricule AJIR"
    text last_name
    text first_name
    text sex "F ou M, audit d'équité seulement"
    text birth_date
    text hire_date
    integer department_id FK
    text job_family
    text job_title
    text grade "G1 à G8"
    integer manager_id "référence logique vers employee.id"
    text governorate "audit seulement"
    text marital_status "audit seulement"
    text status "ACTIF ou SORTI"
    text exit_date
  }
  contract {
    integer id PK
    integer employee_id FK
    text type "CDI, CDD, SIVP, STAGE"
    text start_date
    text end_date
  }
  exit_event {
    integer id PK
    integer employee_id FK
    text exit_date
    text reason "DEMISSION, ABANDON, FIN_CDD…"
    text resignation_date
    text recorded_at "date de saisie"
  }
  career_event {
    integer id PK
    integer employee_id FK
    text date
    text type "PROMOTION, AUGMENTATION…"
    text old_value
    text new_value
    text recorded_at
  }
  attendance_daily {
    integer employee_id PK, FK
    text date PK
    text check_in
    text check_out
    integer worked_minutes
    integer overtime_minutes
    integer late_minutes
  }
  absence_episode {
    integer id PK
    integer employee_id FK
    text start_date
    text end_date
    real days
    text category
    integer is_health "1 = maladie ou maternité"
    text recorded_at
  }
  payroll_monthly {
    integer employee_id PK, FK
    text month PK "AAAA-MM"
    real base_salary "TND"
    real gross_salary "TND"
    real overtime_hours
    text recorded_at
  }
  training {
    integer id PK
    integer employee_id FK
    text code
    text title
    integer mandatory
    text start_date
    text end_date
    text due_date
    real hours
    text status
  }
  evaluation {
    integer id PK
    integer employee_id FK
    text eval_date
    real score "1 à 5"
    text recorded_at
  }
  dim_date {
    text date PK
    integer is_weekend
    integer is_holiday
    text holiday_name
    integer is_ramadan
    integer is_bridge
    integer is_seance_unique
  }
  import_batch {
    integer id PK
    text source
    text started_at
    text finished_at
    text status "EN_COURS, OK, BLOQUE, ECHEC"
    integer rows_ok
    integer rows_rejected
    real quality_score
    text report_json
    integer user_id "référence logique vers app_user.id"
  }
  import_rejection {
    integer id PK
    integer batch_id FK
    text file
    integer line
    text rule
    text message
    text raw
    text severity "REJET, CORRECTION, AVERTISSEMENT"
  }
  agg_kpi_monthly {
    text month PK
    integer department_id PK "référence logique"
    integer headcount
    integer entries
    integer exits
    integer voluntary_exits
    real absence_days_non_health
    real absence_days_health
    real workable_days
    integer late_count
    real overtime_hours
    real payroll_mass
    real training_hours
    integer trainings_done
    integer trainings_due
  }

  department ||--o{ employee : "rattache"
  employee |o..o{ employee : "manage"
  employee ||--o{ contract : "contrats"
  employee ||--o{ exit_event : "sortie"
  employee ||--o{ career_event : "carrière"
  employee ||--o{ attendance_daily : "pointages"
  employee ||--o{ absence_episode : "absences"
  employee ||--o{ payroll_monthly : "paie"
  employee ||--o{ training : "formations"
  employee ||--o{ evaluation : "évaluations"
  dim_date ||..o{ attendance_daily : "jour"
  import_batch ||--o{ import_rejection : "rejets"
  department ||..o{ agg_kpi_monthly : "agrégé par"
```

Index : `employee(department_id)`, `employee(manager_id)`, `contract(employee_id)`, `exit_event(employee_id)`, `career_event(employee_id, date)`, `attendance_daily(date)` (supprimé puis reconstruit pendant un import de pointages de plus de 16 Mo), `absence_episode(employee_id, start_date)`, `training(employee_id)`, `evaluation(employee_id, eval_date)`, `import_rejection(batch_id)`. Unicité applicative : l'import n'accepte qu'une sortie par salarié, un contrat par (salarié, date de début), une absence par (salarié, date de début), un événement par (salarié, date, type).

## 3. Couche ML, résultats de calcul et objets métier

```mermaid
erDiagram
  feature_snapshot {
    integer employee_id PK "référence logique"
    text as_of PK "fin de mois"
    text fsv PK "version du jeu de variables"
    text values_json "25 valeurs, ordre de features.json"
    integer partial_history
  }
  v_label_panel {
    integer employee_id "vue"
    text as_of
    text fsv
    text exit_reason
    text event_date "démission, sinon sortie moins 1 mois"
    integer y6 "démission ou abandon dans l'horizon 6 mois"
    integer followup_complete
  }
  model_version {
    integer id PK
    text version UK
    text kind "B0, LOGREG, LGBM"
    text status "CANDIDAT, CHAMPION, RETIRE"
    text fsv
    text bundle_path
    text manifest_json "sha256, bundle, golden"
    text metrics_json
    text created_at
    text promoted_at
    integer promoted_by
  }
  scoring_run {
    integer id PK
    text as_of UK "unique avec model_version_id"
    integer model_version_id UK "référence logique"
    text status "STAGING, PUBLIE, ECHEC"
    text started_at
    text finished_at
    integer n_scored
    text error
  }
  prediction {
    integer id PK
    integer run_id FK
    integer employee_id "référence logique"
    text as_of
    real prob6 "probabilité, ou points pour B0"
    text level "FAIBLE, MOYEN, ELEVE"
    integer rank
    real lift
    integer model_version_id
  }
  prediction_factor {
    integer id PK
    integer prediction_id FK
    text group_code
    real contribution "log-odds, ou points pour B0"
    integer rank
    text direction "HAUSSE ou BAISSE"
    text top_feature
    real top_feature_value
    text phrase_rh "RH seulement"
    text phrase_manager
  }
  recommendation {
    integer id PK
    integer employee_id
    integer prediction_id
    text action_code
    text trigger_group
    text status "PROPOSEE, REALISEE, REJETEE"
    text feedback "PERTINENTE ou NON_PERTINENTE"
    text comment
    text created_at
    text updated_at
    integer updated_by
  }
  intervention {
    integer id PK
    integer employee_id
    integer recommendation_id
    text date
    text action_code
    integer created_by
  }
  anomaly {
    integer id PK
    text scope "EQUIPE, DEPARTEMENT, SALARIE"
    integer department_id
    integer manager_id
    integer employee_id
    text period_start
    text period_end
    text metric
    real observed
    real expected
    real score
    text message
    text created_at
  }
  alert {
    integer id PK
    text type "TURNOVER, ABSENTEISME, DONNEES, SYSTEME"
    text severity "INFO, ATTENTION, CRITIQUE"
    text status "NOUVELLE, EN_COURS, TRAITEE, REJETEE"
    text audience "RH, MANAGER, ADMIN"
    integer department_id
    integer manager_id
    integer employee_id
    text title
    text message
    text link
    text dedup_key UK
    text comment
    text created_at
    text updated_at
    integer updated_by
  }
  employee {
    integer id PK
  }

  employee ||..o{ feature_snapshot : "variables à t"
  feature_snapshot ||..|| v_label_panel : "étiquette"
  model_version ||..o{ scoring_run : "modèle"
  scoring_run ||--o{ prediction : "contient"
  employee ||..o{ prediction : "évalué"
  prediction ||--o{ prediction_factor : "expliquée par"
  prediction |o..o{ recommendation : "déclenche"
  employee ||..o{ recommendation : "concerne"
  recommendation |o..o{ intervention : "réalisée en"
  employee |o..o{ anomaly : "signal"
  employee |o..o{ alert : "concerne"
```

Contraintes notables : index unique partiel `model_one_champion` (un seul `CHAMPION`) ; index unique `run_asof_model` sur `(as_of, model_version_id)` (non partiel : un run en échec est supprimé avant d'être recalculé) ; `alert.dedup_key` unique (création idempotente `INSERT OR IGNORE`) ; index `prediction(run_id, employee_id)`, `prediction(employee_id, as_of)`, `prediction_factor(prediction_id)`, `recommendation(employee_id)`, `anomaly(period_start)`, `alert(status, type)`, `feature_snapshot(as_of, fsv)`.

## 4. Application : comptes, sessions, audit, jobs, paramètres

```mermaid
erDiagram
  app_user {
    integer id PK
    text login UK
    text password_hash "argon2id, NULL tant que non activé"
    text role "ADMIN, RH, MANAGER"
    integer employee_id "référence logique, obligatoire pour MANAGER"
    text email
    integer active
    integer failed_attempts
    text locked_until
    text activation_token_hash "SHA-256"
    text activation_expires_at
    text created_at
  }
  session {
    text id PK "SHA-256 du jeton"
    integer user_id FK
    text created_at
    text expires_at
    text ip
    text user_agent
  }
  audit_log {
    integer id PK
    text at
    integer user_id
    text action
    text target_type
    text target_id
    text outcome "OK, REFUSE, ECHEC"
    text detail_json
    text ip
  }
  app_job {
    integer id PK
    text type "IMPORT, AGGREGATE, FEATURES, SCORING, ANOMALIES, BATCH_MENSUEL"
    text target
    text status "EN_FILE, EN_COURS, TERMINE, ECHEC"
    text payload_json
    text created_at
    text started_at
    text finished_at
    text heartbeat_at
    text error
    integer created_by
  }
  app_setting {
    text key PK
    text value
    text updated_at
    integer updated_by
  }
  employee {
    integer id PK
  }

  employee |o..o| app_user : "compte lié"
  app_user ||--o{ session : "sessions"
  app_user |o..o{ audit_log : "auteur"
  app_user |o..o{ app_job : "demandeur"
  app_user |o..o{ app_setting : "modifie"
```

Contraintes notables : triggers `audit_log_no_update` et `audit_log_no_delete` (`RAISE(ABORT)`) ; index unique partiel `job_one_active` sur `(type, target)` pour les jobs `EN_FILE` ou `EN_COURS` ; index `session(user_id)`, `audit_log(at)`, `app_job(status)`.

## 5. Diagramme de classes de la couche applicative

Le code est fonctionnel (modules TypeScript exportant des fonctions et des types), pas orienté objet ; le diagramme représente chaque module comme une classe stéréotypée « module » et chaque type structurant comme une classe de données. Il montre la règle centrale : toute lecture passe par la DAL avec un `AccessContext`, et le calcul (variables, scoring, moteur) est indépendant de Next.js.

```mermaid
classDiagram
  direction LR
  class AccessContext {
    +number userId
    +string login
    +Role role
    +number employeeId
  }
  class DalContext {
    <<module>>
    +getContext() AccessContext
    +requireContext(roles) AccessContext
    +pageContext(roles) AccessContext
    +ensurePilotage(ctx, action) void
    +scopeFilter(ctx, column) SqlClause
    +canSeeEmployee(ctx, employeeId) boolean
  }
  class DalEmployees {
    <<module>>
    +listEmployees(ctx, query) EmployeeListDto
    +getEmployeeDetail(ctx, id, meta) EmployeeDetailDto
    +getPublishedRun() PublishedRun
  }
  class EmployeeDetailRh {
    <<DTO>>
    +view RH
    +compensation
    +absences
    +EstimationRh estimation
    +recommendations
  }
  class EmployeeDetailManager {
    <<DTO>>
    +view MANAGER
    +EstimationManager estimation
    +recommendations
  }
  class DalDashboard {
    <<module>>
    +getDashboard(ctx, query) DashboardDto
  }
  class DalAlerts {
    <<module>>
    +listAlerts(ctx, filters) List~AlertDTO~
    +updateAlert(ctx, id, input) AlertDTO
  }
  class DalRecommendations {
    <<module>>
    +listRecommendations(ctx, query) RecommendationListDto
    +decideRecommendation(ctx, input) Result
  }
  class Features {
    <<module>>
    +computeMonth(dataset, t) List~FeatureVector~
    +backfillFeatures(sqlite, from, to) number
  }
  class FeatureVector {
    +number employeeId
    +List~number~ values
    +boolean partial
  }
  class LoadedModel {
    +string version
    +string kind
    +string fsv
    +ModelBundle bundle
    +List~number~ idx
  }
  class GroupContribution {
    +string group
    +number contribution
    +string direction
    +string phraseRh
    +string phraseManager
  }
  class Scoring {
    <<module>>
    +predict(model, values) number
    +explain(model, values) List~GroupContribution~
    +rankAndLevel(model, rows, capacityRate, mediumLift) List~ScoredRow~
    +scoreMonth(sqlite, asOf, options) ScoreResult
  }
  class Engine {
    <<module>>
    +applyPublicationEffects(sqlite, runId) Effects
    +createAlert(sqlite, input) boolean
  }
  class Jobs {
    <<module>>
    +enqueueJob(sqlite, type, target) number
    +claimNextJob(sqlite) Job
    +recoverStale(sqlite) Recovery
    +runMonthlyBatch(sqlite, month) BatchSummary
  }

  DalContext ..> AccessContext : construit
  DalEmployees ..> AccessContext : reçoit
  DalDashboard ..> AccessContext : reçoit
  DalAlerts ..> AccessContext : reçoit
  DalRecommendations ..> AccessContext : reçoit
  DalEmployees ..> DalContext : périmètre
  DalEmployees ..> EmployeeDetailRh : renvoie si RH
  DalEmployees ..> EmployeeDetailManager : renvoie si MANAGER
  Features ..> FeatureVector : produit
  Scoring ..> LoadedModel : utilise
  Scoring ..> FeatureVector : lit
  Scoring ..> GroupContribution : produit
  Scoring ..> Engine : après publication
  Jobs ..> Features : batch
  Jobs ..> Scoring : batch
```

## Descriptions textuelles des cas d'utilisation (vue données)

Pour chacun des 8 cas majeurs décrits dans [CAS_UTILISATION.md](CAS_UTILISATION.md) : acteur, préconditions sur les données, tables lues et écrites dans le scénario nominal, et effet des alternatives sur les données.

| Cas | Acteur | Préconditions (données) | Scénario nominal : lecture → écriture | Alternatives |
|---|---|---|---|---|
| UC-01 S'authentifier | tous | `app_user` actif avec `password_hash` | lit `app_user` → écrit `app_user.failed_attempts`, `session`, `audit_log` | échec : `app_user.failed_attempts`/`locked_until`, `audit_log` REFUSE ; déconnexion : suppression de `session` |
| UC-02 Importer un export AJIR | Administrateur, Worker | aucun `app_job` IMPORT actif | lit les CSV, `app_setting` (seuil, SMIG, délais) → écrit `app_job`, `import_batch`, les dix tables sources, `import_rejection`, `app_setting.data_end_date`, `app_user`, `alert` (DONNEES), `audit_log` | BLOQUE ou ECHEC : `import_batch.status`, alerte CRITIQUE ; les lignes valides restent écrites |
| UC-03 Batch mensuel | Worker | dernier `import_batch` non BLOQUE, `model_version` champion | lit sources, `dim_date`, `model_version` → écrit `agg_kpi_monthly`, `feature_snapshot`, `scoring_run`, `prediction`, `prediction_factor`, `app_setting.current_run_id`, `recommendation`, `alert`, `anomaly`, `audit_log`, `app_job` | échec : `scoring_run.status = ECHEC`, `alert` SYSTEME, pointeur inchangé |
| UC-04 Tableau de bord | RH, Manager | `agg_kpi_monthly` à jour, run publié | lit `agg_kpi_monthly` (ou les sources), `prediction` du run courant, `employee`, `department` → aucune écriture | ADMIN : `audit_log` REFUSE |
| UC-05 Fiche collaborateur | RH, Manager | salarié existant | lit `employee`, `contract`, `payroll_monthly`, `absence_episode`, `training`, `evaluation`, `career_event`, `prediction`, `prediction_factor`, `recommendation`, `intervention` → écrit `audit_log` (`employee.view` OK) | hors périmètre : `audit_log` REFUSE seulement |
| UC-06 Traiter une alerte | RH, Manager, Administrateur | `alert` visible | lit `alert` → écrit `alert.status`, `comment`, `updated_*`, `audit_log` | transition invalide ou conflit : aucune écriture ; hors visibilité : `audit_log` REFUSE |
| UC-07 Décider d'une recommandation | RH | `recommendation.status = PROPOSEE` | lit `recommendation` → écrit `recommendation` et `intervention` (même transaction), `audit_log` | rejet : `recommendation` seule ; déjà traitée : aucune écriture |
| UC-08 What-if | RH | run publié, `prediction` du salarié, `model_version.manifest_json` | lit les sources du salarié, `feature_snapshot` du mois → écrit `audit_log` seulement | 409/422 : `audit_log` ECHEC ou aucune écriture |

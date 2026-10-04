# Dictionnaire des données, des KPI et des variables

Référence pour le rapport de PFE (annexe « dictionnaire des variables et des KPI, glossaire RH »). Toutes les définitions sont tirées du code au 30/09/2026 : schéma [src/db/schema.ts](../src/db/schema.ts), import [src/lib/import/](../src/lib/import/), agrégats [src/lib/aggregates/index.ts](../src/lib/aggregates/index.ts), indicateurs [src/lib/dal/pilotage-metrics.ts](../src/lib/dal/pilotage-metrics.ts) et [src/lib/dal/dashboard.ts](../src/lib/dal/dashboard.ts), variables [src/lib/features/compute.ts](../src/lib/features/compute.ts) et [shared/features.json](../shared/features.json). Les points marqués **à valider** dépendent du client, de la réglementation tunisienne ou d'une décision d'encadrement.

Sommaire : 1. Conventions · 2. Tables · 3. Paramètres · 4. Contrôles qualité de l'import · 5. KPI · 6. Population, cible et décision · 7. Les 25 variables · 7 bis. Variables des IA par sujet · 8. Glossaire RH tunisien

## 1. Conventions

- **Types SQLite** : `INTEGER` (entiers et booléens 0/1), `REAL` (montants en TND, taux, jours fractionnaires), `TEXT` (dates ISO `AAAA-MM-JJ`, mois `AAAA-MM`, horodatages ISO 8601 UTC `AAAA-MM-JJTHH:MM:SS.sssZ`, énumérations, JSON).
- **Horodatage par défaut** : `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- **Source** : « AJIR `fichier.colonne` » = colonne de l'export CSV (contrat dans [docs/CONVENTIONS.md](CONVENTIONS.md)) ; « calcul » = valeur produite par le module cité ; « application » = saisie dans l'interface.
- **PK** clé primaire, **FK** clé étrangère déclarée, **UK** unicité, **réf.** référence logique non contrainte.
- **t** : date de coupure, toujours une fin de mois.

## 2. Tables

### 2.1 Sources AJIR (écrites par l'import uniquement)

#### `department` — départements

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | identifiant interne | calcul |
| `code` | TEXT | UK, non nul | code du département dans AJIR | AJIR `departments.code` |
| `name` | TEXT | non nul | libellé | AJIR `departments.name` |

#### `employee` — salariés

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | identifiant interne (utilisé dans les URL `/employees/{id}`) | calcul |
| `matricule` | TEXT | UK, non nul | matricule AJIR, clé de rapprochement de tous les fichiers | AJIR `employees.matricule` |
| `last_name`, `first_name` | TEXT | non nul | nom, prénom | AJIR |
| `sex` | TEXT | `F` ou `M` | sexe ; **jamais une variable**, audit d'équité seulement | AJIR `employees.sex` |
| `birth_date` | TEXT | | date de naissance ; éligibilité (âge), filtre d'âge, audit d'équité | AJIR |
| `hire_date` | TEXT | non nul | date d'embauche | AJIR |
| `department_id` | INTEGER | FK `department.id` | département courant | AJIR `department_code` résolu |
| `job_family` | TEXT | | famille de métier (référence du compa-ratio) | AJIR |
| `job_title` | TEXT | | intitulé de poste | AJIR |
| `grade` | TEXT | `G1`…`G8`, sinon NULL | grade courant | AJIR ; valeur hors `G1-G8` neutralisée (CORRECTION `GRADE_INCONNU`) |
| `manager_id` | INTEGER | réf. `employee.id` | manager direct courant ; racine du périmètre de sécurité | AJIR `manager_matricule` résolu ; NULL si inexistant ou cycle rompu |
| `governorate` | TEXT | | gouvernorat ; audit seulement | AJIR |
| `marital_status` | TEXT | | situation familiale ; audit seulement | AJIR |
| `status` | TEXT | `ACTIF` / `SORTI`, défaut `ACTIF` | `SORTI` si `exit_date ≤ data_end_date` | calcul (import) |
| `exit_date` | TEXT | | dernière date de sortie connue | calcul : `MAX(exit_event.exit_date)` |

#### `contract` — contrats

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | | calcul |
| `employee_id` | INTEGER | FK `employee.id` | salarié | AJIR `contracts.matricule` |
| `type` | TEXT | `CDI`, `CDD`, `SIVP`, `STAGE` | nature du contrat | AJIR `contracts.contract_type` |
| `start_date` | TEXT | non nul | début ; unicité applicative (salarié, début) | AJIR |
| `end_date` | TEXT | | terme prévu (CDD, SIVP, stage) ; NULL pour un CDI | AJIR |

Pas de date de saisie : le contrat en vigueur à t est le dernier dont `start_date ≤ t`.

#### `exit_event` — sorties

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | | calcul |
| `employee_id` | INTEGER | FK `employee.id` | une sortie par salarié (contrôle `DOUBLON`) | AJIR `exits.matricule` |
| `exit_date` | TEXT | non nul, ≥ embauche | dernier jour dans l'entreprise | AJIR |
| `reason` | TEXT | `DEMISSION`, `ABANDON`, `FIN_CDD`, `LICENCIEMENT`, `RETRAITE`, `DECES`, `MUTATION`, `AUTRE` | motif ; inconnu ou absent → `AUTRE` (CORRECTION `SORTIE_SANS_MOTIF`) | AJIR `exits.exit_reason` |
| `resignation_date` | TEXT | | date de la démission ; si absente, estimée à `exit_date − 1 mois` dans l'étiquette | AJIR |
| `recorded_at` | TEXT | non nul | date de saisie ; défaut : `resignation_date`, sinon `exit_date` | AJIR ou calcul |

#### `career_event` — historique de carrière

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | | calcul |
| `employee_id` | INTEGER | FK | | AJIR `career_events.matricule` |
| `date` | TEXT | non nul | date d'effet | AJIR |
| `type` | TEXT | `PROMOTION`, `AUGMENTATION`, `MUTATION`, `CHANGEMENT_MANAGER`, `CHANGEMENT_POSTE` | nature | AJIR `event_type` |
| `old_value`, `new_value` | TEXT | | PROMOTION : grades ; AUGMENTATION : salaires de base ; CHANGEMENT_MANAGER : matricules ; MUTATION : codes département ; CHANGEMENT_POSTE : intitulés | AJIR |
| `recorded_at` | TEXT | non nul | date de saisie ; défaut `date` | AJIR ou calcul |

Sert à reconstituer le grade et le manager à t (variables) et le département à la date de chaque mois (agrégats).

#### `attendance_daily` — pointages journaliers

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `employee_id` | INTEGER | PK, FK | | AJIR `attendance.matricule` |
| `date` | TEXT | PK | jour pointé (≤ date d'import, dans la période d'emploi) | AJIR |
| `check_in` | TEXT | `HH:MM`, non nul à l'import | heure d'arrivée | AJIR |
| `check_out` | TEXT | | heure de sortie ; absente → AVERTISSEMENT `POINTAGE_SANS_SORTIE` | AJIR |
| `worked_minutes` | INTEGER | ≥ 0, défaut 0 | minutes travaillées | AJIR |
| `overtime_minutes` | INTEGER | ≥ 0, défaut 0 | minutes supplémentaires | AJIR |
| `late_minutes` | INTEGER | ≥ 0, défaut 0 | minutes de retard | AJIR |

Pas de date de saisie (pointage en temps réel). Le dernier pointage accepté fixe `data_end_date`.

#### `absence_episode` — absences

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | | calcul |
| `employee_id` | INTEGER | FK | | AJIR `absences.matricule` |
| `start_date`, `end_date` | TEXT | non nuls, fin ≥ début, dans la période d'emploi | bornes de l'épisode | AJIR |
| `days` | REAL | > 0 | jours d'absence déclarés (jours ouvrés couverts) | AJIR |
| `category` | TEXT | `CONGE_ANNUEL`, `MALADIE`, `MATERNITE`, `ABSENCE_INJUSTIFIEE`, `CONGE_SANS_SOLDE`, `AUTRE` | catégorie ; le motif médical n'est jamais importé | AJIR |
| `is_health` | INTEGER | 0/1 | 1 pour `MALADIE` et `MATERNITE` : donnée de santé, exclue de toute variable et de tout score | calcul (import) |
| `recorded_at` | TEXT | non nul | date de saisie ; défaut `end_date + lag_absence_days` | AJIR ou calcul |

#### `payroll_monthly` — paie mensuelle

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `employee_id` | INTEGER | PK, FK | | AJIR `payroll.matricule` |
| `month` | TEXT | PK, `AAAA-MM` | mois de paie | AJIR |
| `base_salary` | REAL | ≥ SMIG sauf SIVP et stage (REJET `SALAIRE_SOUS_SMIG`) | salaire de base mensuel en TND | AJIR |
| `gross_salary` | REAL | ≥ 0 | salaire brut du mois en TND (masse salariale) | AJIR |
| `overtime_hours` | REAL | ≥ 0, défaut 0 | heures supplémentaires payées | AJIR |
| `recorded_at` | TEXT | non nul | date de saisie ; défaut fin du mois | AJIR ou calcul |

#### `training` — formations

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | | calcul |
| `employee_id` | INTEGER | FK | | AJIR `trainings.matricule` |
| `code` | TEXT | non nul | code de la formation | AJIR `training_code` |
| `title` | TEXT | non nul | intitulé | AJIR |
| `mandatory` | INTEGER | 0/1 | formation obligatoire | AJIR |
| `start_date`, `end_date` | TEXT | fin ≥ début | dates de réalisation | AJIR |
| `due_date` | TEXT | | échéance d'une formation obligatoire | AJIR |
| `hours` | REAL | ≥ 0 | durée en heures | AJIR |
| `status` | TEXT | `PLANIFIEE`, `EN_COURS`, `TERMINEE`, `ABANDONNEE` | **état courant** (non historisé) | AJIR |

Pas de date de saisie.

#### `evaluation` — évaluations annuelles

| Colonne | Type | Contraintes | Sens | Source |
|---|---|---|---|---|
| `id` | INTEGER | PK | | calcul |
| `employee_id` | INTEGER | FK | | AJIR `evaluations.matricule` |
| `eval_date` | TEXT | non nul | date de l'évaluation (campagne) | AJIR |
| `score` | REAL | 1 à 5 | note | AJIR |
| `recorded_at` | TEXT | non nul | date de saisie ; défaut `eval_date + lag_evaluation_days` | AJIR ou calcul |

### 2.2 Calendrier et imports

#### `dim_date` — calendrier tunisien

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `date` | TEXT PK | jour | calcul `buildCalendar` ([src/lib/calendar/index.ts](../src/lib/calendar/index.ts)) |
| `is_weekend` | INTEGER | samedi ou dimanche | calcul |
| `is_holiday` | INTEGER | jour férié (fixe ou religieux) | calcul ([tn-dates.ts](../src/lib/calendar/tn-dates.ts)) |
| `holiday_name` | TEXT | libellé(s) du férié | calcul |
| `is_ramadan` | INTEGER | jour de Ramadan (du 1er Ramadan à la veille de l'Aïd el-Fitr) | calcul |
| `is_bridge` | INTEGER | pont : jour ouvré isolé entre un férié et un week-end (ou deux fériés) ; **reste ouvré** dans `dim_date` | calcul |
| `is_seance_unique` | INTEGER | séance unique : 1er juillet–31 août et Ramadan | calcul |

#### `import_batch` — lots d'import

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `id` | INTEGER PK | numéro de lot | calcul |
| `source` | TEXT | nom du dossier importé | calcul |
| `started_at`, `finished_at` | TEXT | horodatages | calcul |
| `status` | TEXT | `EN_COURS`, `OK`, `BLOQUE` (score < seuil), `ECHEC` | calcul |
| `rows_ok`, `rows_rejected` | INTEGER | lignes acceptées, lignes rejetées (tous fichiers) | calcul |
| `quality_score` | REAL | score qualité (§ 5, K15) ; NULL si ECHEC | calcul |
| `report_json` | TEXT | rapport complet : par fichier (lignes, OK, rejets, règles, durée), qualité, fin des données, synchronisation des comptes, erreur | calcul |
| `user_id` | INTEGER | réf. `app_user.id` : auteur (NULL en CLI sans `--user`) | application |

#### `import_rejection` — rejets et corrections motivés

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `id` | INTEGER PK | | calcul |
| `batch_id` | INTEGER FK | lot | calcul |
| `file` | TEXT | fichier CSV | calcul |
| `line` | INTEGER | ligne du fichier (NULL pour un contrôle global) | calcul |
| `rule` | TEXT | code de règle (§ 4) | calcul |
| `message` | TEXT | motif lisible (≤ 500 caractères) | calcul |
| `raw` | TEXT | ligne brute (≤ 300 caractères) | AJIR |
| `severity` | TEXT | `REJET` (ligne non importée), `CORRECTION` (importée avec un champ neutralisé), `AVERTISSEMENT` (informatif) | calcul |

Au plus 1 000 lignes détaillées par fichier et par règle ; les comptages exhaustifs sont dans `report_json`.

### 2.3 Agrégats

#### `agg_kpi_monthly` — mesures mensuelles par département

Clé `(month, department_id)` ; département à la date de référence du mois (fin de mois, ou date de sortie si antérieure), reconstitué depuis les `MUTATION`. Recalculé par `refreshAggregates`. Formules détaillées au § 5.

| Colonne | Type | Sens |
|---|---|---|
| `month` | TEXT PK | mois `AAAA-MM` |
| `department_id` | INTEGER PK | réf. `department.id` |
| `headcount` | INTEGER | effectif de fin de mois, hors stages et SIVP (K1) |
| `entries` | INTEGER | entrées du mois (K2) |
| `exits` | INTEGER | sorties du mois (K3) |
| `voluntary_exits` | INTEGER | sorties volontaires du mois (K4) |
| `absence_days_non_health` | REAL | jours d'absence non planifiée hors santé, ventilés au prorata des jours ouvrés (K7) |
| `absence_days_health` | REAL | jours d'absence de santé, même ventilation (suivi collectif seulement) |
| `workable_days` | REAL | jours ouvrables : présents en fin de mois (tous contrats) × jours ouvrés du mois (K7) |
| `late_count` | INTEGER | jours pointés avec retard > 0 minute (non affiché) |
| `overtime_hours` | REAL | heures supplémentaires pointées (non affiché) |
| `payroll_mass` | REAL | masse salariale brute du mois en TND (K10) |
| `training_hours` | REAL | heures des formations terminées dans le mois (non affiché) |
| `trainings_done` | INTEGER | formations obligatoires échues dans le mois et terminées (K9) |
| `trainings_due` | INTEGER | formations obligatoires échues dans le mois (K9) |

### 2.4 Couche ML, résultats et objets métier

#### `feature_snapshot` — variables à une date

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `employee_id` | INTEGER PK | salarié éligible à `as_of` | calcul |
| `as_of` | TEXT PK | fin de mois de coupure t | calcul |
| `fsv` | TEXT PK | version du jeu de variables (`v1`) | [shared/features.json](../shared/features.json) |
| `values_json` | TEXT | tableau des 25 valeurs dans l'ordre de `features.json` (§ 7) | calcul `computeMonth` |
| `partial_history` | INTEGER | 1 si la fenêtre de 12 mois est tronquée (embauche ou début des pointages) | calcul |

Seuls les salariés éligibles à t ont une ligne (§ 6.1).

#### Vue `v_label_panel` — étiquettes (seule définition)

| Colonne | Sens |
|---|---|
| `employee_id`, `as_of`, `fsv` | clé du snapshot |
| `exit_reason` | motif de sortie (NULL si pas de sortie) |
| `event_date` | `COALESCE(resignation_date, exit_date − 1 mois)` |
| `y6` | 1 si démission ou abandon avec `event_date ∈ ]as_of, as_of + 6 mois]`, ou démission antérieure à `as_of` mais saisie après `as_of` avec sortie effective dans `]as_of, as_of + 6 mois]` ; 0 sinon (autres sorties comprises) |
| `followup_complete` | 1 si `as_of + 6 mois ≤ data_end_date` (seules ces lignes servent à l'entraînement et à l'évaluation) |

#### `model_version` — registre des modèles

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `id` | INTEGER PK | | calcul |
| `version` | TEXT UK | ex. `b0-v1`, `logreg-v1-…` | bundle `model.json` |
| `kind` | TEXT | `B0`, `LOGREG` ; `LGBM` prévu sans scorer | bundle |
| `status` | TEXT | `CANDIDAT`, `CHAMPION` (un seul, index unique partiel), `RETIRE` | CLI `scripts/model.ts` |
| `fsv` | TEXT | version des variables attendue | bundle |
| `bundle_path` | TEXT | dossier du bundle, relatif au projet | CLI |
| `manifest_json` | TEXT | `{ sha256, bundle, golden }` figé à l'enregistrement | calcul |
| `metrics_json` | TEXT | métriques hors ligne (AUC, calibration, lift à capacité, équité, golden…) | bundle |
| `created_at`, `promoted_at` | TEXT | horodatages | calcul |
| `promoted_by` | INTEGER | réf. `app_user.id` | CLI `--user` |

#### `scoring_run` — calculs

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | identifiant du run (valeur de `current_run_id` quand il est courant) |
| `as_of` | TEXT | fin de mois scorée ; UK avec `model_version_id` |
| `model_version_id` | INTEGER | réf. `model_version.id` |
| `status` | TEXT | `STAGING`, `PUBLIE`, `ECHEC` |
| `started_at`, `finished_at` | TEXT | horodatages |
| `n_scored` | INTEGER | salariés scorés |
| `error` | TEXT | message d'échec |

#### `prediction` — estimation individuelle

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `run_id` | INTEGER FK | run |
| `employee_id` | INTEGER | réf. `employee.id` |
| `as_of` | TEXT | fin de mois |
| `prob6` | REAL | LOGREG : probabilité calibrée de démission ou abandon dans les 6 mois ; **B0 : nombre de points** (jamais présenté comme une probabilité) |
| `level` | TEXT | `FAIBLE`, `MOYEN`, `ELEVE` (§ 6.3) |
| `rank` | INTEGER | rang dans le mois (1 = plus exposé ; ex-æquo ordonnés par identifiant) |
| `lift` | REAL | `prob6 / moyenne des prob6 du run` (K12) |
| `model_version_id` | INTEGER | modèle utilisé |

#### `prediction_factor` — facteurs associés (au plus 6 par prédiction)

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `prediction_id` | INTEGER FK | prédiction |
| `group_code` | TEXT | `CARRIERE`, `REMUNERATION`, `TEMPS_TRAVAIL`, `ABSENCES`, `FORMATION_EVAL`, `EQUIPE` |
| `contribution` | REAL | LOGREG : `Σ_j∈groupe a · coef_j · z_j` (log-odds calibré, par rapport au profil moyen) ; B0 : points des règles déclenchées du groupe |
| `rank` | INTEGER | rang par valeur absolue de contribution |
| `direction` | TEXT | `HAUSSE` (augmente le risque) ou `BAISSE` |
| `top_feature`, `top_feature_value` | TEXT, REAL | variable du groupe dont la contribution va le plus dans le sens du groupe, et sa valeur |
| `phrase_rh` | TEXT | phrase chiffrée pour la RH (ex. « Salaire à 90 % de la médiane du poste ») ; jamais transmise au manager |
| `phrase_manager` | TEXT | catégorie seule (libellé manager du groupe) |

#### `recommendation`

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `id` | INTEGER PK | | calcul |
| `employee_id` | INTEGER | réf. salarié | calcul |
| `prediction_id` | INTEGER | réf. prédiction déclenchante | calcul |
| `action_code` | TEXT | `REVISION_SALARIALE` (Revue de la rémunération), `CHARGE_TRAVAIL` (Revue de la charge de travail), `PLAN_FORMATION` (Plan de formation et de développement), `ENTRETIEN` (Entretien de rétention) | calcul |
| `trigger_group` | TEXT | groupe déclencheur, ou `NIVEAU_ELEVE` pour l'entretien | calcul |
| `status` | TEXT | `PROPOSEE`, `REALISEE`, `REJETEE` | application (RH) |
| `feedback` | TEXT | `PERTINENTE` / `NON_PERTINENTE` | application (RH) |
| `comment` | TEXT | commentaire (obligatoire au rejet) | application |
| `created_at`, `updated_at` | TEXT | horodatages | calcul |
| `updated_by` | INTEGER | réf. `app_user.id` | application |

#### `intervention` — action RH réalisée

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `employee_id` | INTEGER | salarié |
| `recommendation_id` | INTEGER | recommandation réalisée |
| `date` | TEXT | date de réalisation (non future) |
| `action_code` | TEXT | action |
| `created_by` | INTEGER | réf. `app_user.id` |

#### `anomaly` — signaux d'absentéisme

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `scope` | TEXT | `EQUIPE`, `DEPARTEMENT` (collectif) ou `SALARIE` (Bradford, RH seulement) |
| `department_id`, `manager_id`, `employee_id` | INTEGER | cible (manager = équipe) |
| `period_start`, `period_end` | TEXT | deux semaines consécutives (collectif) ; fenêtre de 12 mois (Bradford) |
| `metric` | TEXT | `taux_absence_hebdo` ou `bradford_12m` |
| `observed` | REAL | taux moyen des deux semaines, ou facteur de Bradford |
| `expected` | REAL | taux attendu corrigé du calendrier, ou seuil |
| `score` | REAL | plus petit des deux z robustes, ou facteur / seuil |
| `message` | TEXT | explication en français (« à vérifier » pour le signal individuel) |
| `created_at` | TEXT | horodatage |

#### `alert`

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `type` | TEXT | `TURNOVER`, `ABSENTEISME`, `DONNEES`, `SYSTEME` |
| `severity` | TEXT | `INFO`, `ATTENTION`, `CRITIQUE` |
| `status` | TEXT | `NOUVELLE`, `EN_COURS`, `TRAITEE`, `REJETEE` |
| `audience` | TEXT | `RH`, `MANAGER` (manager du périmètre et RH), `ADMIN` |
| `department_id`, `manager_id`, `employee_id` | INTEGER | cible, sert au routage |
| `title`, `message` | TEXT | contenu |
| `link` | TEXT | lien interne (seuls les chemins relatifs sont renvoyés) |
| `dedup_key` | TEXT UK | clé d'idempotence (voir [architecture/ETATS.md](architecture/ETATS.md)) |
| `comment` | TEXT | commentaire de traitement |
| `created_at`, `updated_at`, `updated_by` | | suivi |

### 2.4 bis IA par sujet ([src/lib/ai/](../src/lib/ai/), migration `0004_ai_topics`)

#### `topic_model` — registre des modèles par sujet

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `topic` | TEXT | `ABSENTEISME`, `EFFECTIF`, `MASSE_SALARIALE`, `FORMATION`, `CHARGE_TRAVAIL` (`TURNOVER` reste dans `model_version`) |
| `version` | TEXT UK | ex. `abs-ridge-v1-20260930` |
| `kind` | TEXT | méthode : `RIDGE_DIRECT`, `STOCK_FLUX`, `REGRESSION_LOG_SAISONNIERE`, `LOGREG`, `RIDGE_LOG` |
| `status` | TEXT | `CANDIDAT`, `CHAMPION`, `RETIRE` ; un seul CHAMPION par sujet (index unique partiel `topic_model_one_champion`) |
| `bundle_path` | TEXT | dossier du bundle, relatif à la racine du projet (`models/<sujet>/<version>`) |
| `metrics_json` | TEXT | métriques du protocole d'évaluation (copie de `model.json`) |
| `created_at`, `promoted_at` | TEXT | enregistrement, dernière promotion |

Écrit par `npm run topic-model -- register | promote`.

#### `forecast` — prévisions agrégées (jamais individuelles)

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `topic` | TEXT | `ABSENTEISME` (taux), `EFFECTIF` (salariés), `MASSE_SALARIALE` (TND brut mensuel), `CHARGE_TRAVAIL` (heures sup par ETP et par mois) |
| `scope` | TEXT | `ENTREPRISE`, `DEPARTEMENT`, `EQUIPE` (équipe = rattachés directs d'un manager, au moins 5 personnes) |
| `department_id`, `manager_id` | INTEGER | unité (réf.) ; NULL pour l'entreprise |
| `as_of` | TEXT | fin du dernier mois observé (origine) |
| `month` | TEXT | mois prévu (`AAAA-MM`) |
| `horizon` | INTEGER | **1 à 12 = prévision** (absentéisme et charge 1-3, effectif et masse 1-12) ; **0 = valeur observée** du mois `month` (historique de 12 mois précalculé par la charge de travail à la composition de l'origine, sans bornes) |
| `value` | REAL | valeur prévue ou observée |
| `lower`, `upper` | REAL | intervalle de prévision à 80 % (NULL pour l'observé et l'entreprise en charge de travail) |
| `model_version` | TEXT | réf. `topic_model.version` |
| `created_at` | TEXT | |

Réécrit à l'identique à chaque exécution de l'étape pour une même origine (idempotence).

#### `training_risk` — risque de retard d'une formation obligatoire

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `training_id`, `employee_id` | INTEGER | réf. formation ouverte (échéance dans ]t, t + 120 j]) et salarié |
| `as_of` | TEXT | t |
| `prob` | REAL | probabilité (Platt) de ne pas terminer à l'échéance ; jamais montrée au manager |
| `level` | TEXT | `ELEVE` (p ≥ 0,50), `MOYEN` (p ≥ 0,25), `FAIBLE` : seuils fixes du bundle, sans règle de capacité |
| `factors_json` | TEXT | contributions et phrases RH |
| `model_version` | TEXT | réf. `topic_model.version` |

Salariés opposés exclus ; purgé au-delà de `retention_prediction_months`.

#### `insight_recommendation` — recommandations par sujet

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `topic` | TEXT | sujet émetteur |
| `scope` | TEXT | `ENTREPRISE`, `DEPARTEMENT`, `EQUIPE`, `SALARIE` |
| `audience` | TEXT | `RH` ou `MANAGER` (le manager ne reçoit que des recommandations collectives de sa hiérarchie) |
| `department_id`, `manager_id`, `employee_id` | INTEGER | unité visée (réf.) |
| `action_code` | TEXT | ex. `ANTICIPER_REMPLACEMENTS`, `RELANCE_FORMATION`, `PLANIFIER_TEMPS_FORMATION`, succession, renouvellement de CDD, recrutement, charge d'équipe, entretien sur la charge |
| `title`, `rationale` | TEXT | action et justification chiffrée en langage RH, sans donnée de santé ; sans nom ni probabilité côté manager |
| `priority` | INTEGER | 1 haute, 2 moyenne, 3 basse |
| `status` | TEXT | `PROPOSEE`, `REALISEE`, `REJETEE` |
| `comment`, `updated_at`, `updated_by` | TEXT, TEXT, INTEGER | décision (audit `insight.recommendation.update` ou `insight.update`) |
| `dedup_key` | TEXT UK | ex. `abs:<unité>:<mois>:<action>`, `FORMATION:RELANCE:<formation>`, `CHARGE_TRAVAIL:EQUIPE:<manager>:<AAAA-Tn>` ; une recommandation décidée n'est jamais réécrite |
| `created_at` | TEXT | |

### 2.5 Application

#### `app_user` — comptes

| Colonne | Type | Sens | Source |
|---|---|---|---|
| `id` | INTEGER PK | | calcul |
| `login` | TEXT UK | identifiant | AJIR `users.login`, administrateur ou `seed:admin` |
| `password_hash` | TEXT | hachage argon2id ; NULL tant que le compte n'est pas activé | application |
| `role` | TEXT | `ADMIN`, `RH`, `MANAGER` | AJIR `users.role` ou administrateur |
| `employee_id` | INTEGER | réf. salarié ; obligatoire pour un MANAGER (racine du périmètre) | AJIR `users.matricule` résolu |
| `email` | TEXT | | AJIR ou administrateur |
| `active` | INTEGER | compte actif | AJIR `users.active` ou administrateur |
| `failed_attempts`, `locked_until` | INTEGER, TEXT | verrouillage progressif | calcul |
| `activation_token_hash`, `activation_expires_at` | TEXT | empreinte SHA-256 du lien d'activation, expiration (7 jours) | calcul |
| `created_at` | TEXT | | calcul |

#### `session`

| Colonne | Type | Sens |
|---|---|---|
| `id` | TEXT PK | SHA-256 du jeton (le jeton n'est que dans le cookie) |
| `user_id` | INTEGER FK | compte |
| `created_at`, `expires_at` | TEXT | création ; expiration glissante (2 h après la dernière requête, jamais au-delà de création + 10 h) ; lignes expirées purgées |
| `ip`, `user_agent` | TEXT | premier `X-Forwarded-For`, agent (≤ 200 caractères) |

#### `audit_log` — journal en ajout seul

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `at` | TEXT | horodatage |
| `user_id` | INTEGER | auteur (NULL : système ou anonyme) |
| `action` | TEXT | `domaine.verbe` (liste dans [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) § 6.7) |
| `target_type`, `target_id` | TEXT | cible |
| `outcome` | TEXT | `OK`, `REFUSE`, `ECHEC` |
| `detail_json` | TEXT | détail (source page/API, vue, accès au salaire, leviers…) |
| `ip` | TEXT | adresse cliente |

UPDATE et DELETE interdits par triggers.

#### `app_job` — file de traitements

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `type` | TEXT | `IMPORT`, `AGGREGATE`, `FEATURES`, `SCORING`, `ANOMALIES`, `BATCH_MENSUEL` |
| `target` | TEXT | mois, dossier d'inbox… ; un seul job actif par (type, cible) |
| `status` | TEXT | `EN_FILE`, `EN_COURS`, `TERMINE`, `ECHEC` |
| `payload_json` | TEXT | paramètres |
| `created_at`, `started_at`, `finished_at`, `heartbeat_at` | TEXT | suivi |
| `error` | TEXT | message d'échec ou de reprise |
| `created_by` | INTEGER | réf. `app_user.id` |

#### `app_setting` — paramètres et état

Clé-valeur (`key` PK, `value`, `updated_at`, `updated_by`) ; détail au § 3.

### 2.5 bis Protection des données (migration `0005_privacy`)

#### `privacy_request` — demandes d'exercice des droits

| Colonne | Type | Sens |
|---|---|---|
| `id` | INTEGER PK | |
| `employee_id` | INTEGER | salarié concerné (réf.) |
| `type` | TEXT | `ACCES`, `OPPOSITION`, `RECTIFICATION` |
| `status` | TEXT | `OUVERTE`, `TRAITEE`, `REFUSEE` |
| `note` | TEXT | commentaire RH |
| `created_at`, `created_by`, `closed_at`, `closed_by` | TEXT, INTEGER | suivi (audit `privacy.request.*`) |

#### `employee_opposition` — opposition au traitement prédictif (loi 2004-63, art. 42)

| Colonne | Type | Sens |
|---|---|---|
| `employee_id` | INTEGER PK | salarié exclu de tout traitement prédictif individuel : variables, panel exporté, scoring, what-if, recommandations et alertes turnover, risques de formation, recommandations individuelles des IA par sujet |
| `since` | TEXT | date d'effet |
| `request_id` | INTEGER | réf. `privacy_request.id` |
| `recorded_by` | INTEGER | réf. `app_user.id` |

L'enregistrement purge les résultats prédictifs existants (`purgePredictiveData`) ; la levée ne restaure rien.

## 3. Paramètres (`app_setting`)

| Clé | Défaut | Bornes (écran Paramètres) | Sens | Modifiable par |
|---|---|---|---|---|
| `capacity_rate` | 0,02 | 0,005 à 0,2 | part de l'effectif scoré classée ÉLEVÉ (capacité d'entretiens du mois) | ADMIN |
| `medium_lift` | 2 | 1 à 10 | lift minimal du niveau MOYEN | ADMIN |
| `quality_threshold` | 0,95 | 0,5 à 1 | score qualité sous lequel un import est BLOQUE | ADMIN |
| `smig_monthly` | 528,320 TND | 100 à 5 000 | SMIG mensuel, contrôle `SALAIRE_SOUS_SMIG` (**à valider**, § 8) | ADMIN |
| `bradford_threshold` | 250 | 10 à 5 000 (entier) | seuil du signal individuel de Bradford | ADMIN |
| `smig_schedule` | JSON, 528,320 TND puis 554,736 TND au 01/01/2026 | — | barème SMIG daté appliqué selon le mois de paie ; `smig_monthly` en repli (**à valider**) | base (écran à venir) |
| `min_events_for_model` | 30 | entier ≥ 0 proposé : 0 à 10 000 | démarrage à froid : sous ce nombre de démissions observées, un champion LOGREG est remplacé par B0 (0 = règle désactivée) | ADMIN (écran à venir) |
| `indicative_until_events` | 150 | entier ≥ 0 proposé : 0 à 100 000 | sous ce nombre, la probabilité est présentée comme indicative | ADMIN (écran à venir) |
| `retention_inbox_days` | 90 | entier ≥ 1 proposé : 7 à 3 650 | conservation des exports déposés dans `data/inbox` (jours) ; `RETENTION_INBOX_DAYS` prime | ADMIN (écran à venir) |
| `retention_prediction_months` | 24 | entier ≥ 1 proposé : 6 à 120 | conservation des prédictions, facteurs et risques de formation hors calcul publié (mois) ; `RETENTION_PREDICTION_MONTHS` prime | ADMIN (écran à venir) |
| `workload_ot_threshold_h` | 20 | 1 à 200 h (lu dans ces bornes) | seuil mensuel d'heures sup pointées de la surcharge individuelle | ADMIN (écran à venir) |
| `workload_ot_months` | 3 | entier 1 à 12 (lu dans ces bornes) | nombre de mois consécutifs au-dessus du seuil | ADMIN (écran à venir) |
| `abs_reco_seuil_niveau` | 0,5 | ≥ 0 | niveau prévu élevé : prévision ≥ (1 + x) × taux entreprise sur 12 mois | ADMIN (écran à venir) |
| `abs_reco_seuil_hausse` | 0,25 | ≥ 0 | hausse : prévision moyenne ≥ (1 + x) × taux 12 mois de l'unité | ADMIN (écran à venir) |
| `abs_reco_ecart_min` | 0,002 | ≥ 0 | écart minimal en taux (0,2 point) contre le bruit des petites équipes | ADMIN (écran à venir) |
| `abs_reco_anomalies_min` | 2 | entier ≥ 0 | anomalies collectives sur 3 mois déclenchant « anomalie persistante » | ADMIN (écran à venir) |
| `budget_masse_salariale_<AAAA>` | aucun | montant > 0 | budget annuel de masse salariale brute (TND) de l'année AAAA ; absent = pas de recommandation budgétaire | ADMIN (écran à venir) |
| `lag_absence_days` | 10 | — | délai de saisie supposé des absences sans `recorded_at` | base seulement |
| `lag_evaluation_days` | 90 | — | délai de saisie supposé des évaluations sans `recorded_at` | base seulement |
| `current_run_id` | vide | — | pointeur du run publié courant | calcul (scoring) |
| `data_end_date` | — | — | dernier pointage accepté, jamais en recul ; date de référence des écrans | calcul (import) |
| `worker_heartbeat` | — | — | dernier signal du worker | calcul (worker) |

## 4. Contrôles qualité de l'import (24 règles)

Source : [src/lib/import/rules.ts](../src/lib/import/rules.ts), [src/lib/import/index.ts](../src/lib/import/index.ts).

| Règle | Sévérité | Déclenchement |
|---|---|---|
| `EN_TETE_INVALIDE` | REJET | colonne obligatoire absente de l'en-tête : fichier ignoré (ECHEC si `departments.csv` ou `employees.csv`) |
| `FORMAT_LIGNE` | REJET | ligne illisible ou nombre de colonnes différent de l'en-tête |
| `CHAMP_OBLIGATOIRE` | REJET | champ requis vide (dont matricule d'un compte MANAGER) |
| `DATE_INVALIDE` | REJET | date ou mois mal formé |
| `VALEUR_INVALIDE` | REJET | valeur hors énumération ou négative, note hors 1-5, jours ≤ 0 |
| `MATRICULE_DUPLIQUE` | REJET | matricule répété dans `employees.csv` |
| `DOUBLON` | REJET | clé naturelle répétée (département, contrat, sortie, événement, paie, absence, formation, évaluation, compte) |
| `MATRICULE_INCONNU` | REJET | matricule absent des salariés |
| `DEPARTEMENT_INCONNU` | REJET | code département absent |
| `SORTIE_AVANT_EMBAUCHE` | REJET | `exit_date < hire_date` |
| `FIN_AVANT_DEBUT` | REJET | fin de contrat, d'absence ou de formation avant le début |
| `ABSENCE_HORS_EMPLOI` | REJET | absence hors de la période d'emploi |
| `SALAIRE_SOUS_SMIG` | REJET | salaire de base < `smig_monthly` hors contrat SIVP ou stage du mois |
| `POINTAGE_DUPLIQUE` | REJET | deuxième pointage le même jour |
| `POINTAGE_FUTUR` | REJET | pointage postérieur à la date d'import |
| `POINTAGE_HORS_EMPLOI` | REJET | pointage hors de la période d'emploi |
| `GRADE_INCONNU` | CORRECTION | grade hors `G1`-`G8` : grade laissé vide |
| `MANAGER_INEXISTANT` | CORRECTION | manager inconnu : salarié importé sans manager |
| `CYCLE_HIERARCHIQUE` | CORRECTION | auto-rattachement ou cycle : le membre au plus petit matricule perd son manager |
| `SORTIE_SANS_MOTIF` | CORRECTION | motif absent ou inconnu : `AUTRE` |
| `POINTAGE_SANS_SORTIE` | AVERTISSEMENT | pointage sans heure de sortie |
| `PAIE_INCOMPLETE` | AVERTISSEMENT | salarié en poste sans paie du dernier mois de paie importé |
| `VARIATION_VOLUME` | AVERTISSEMENT | nombre de lignes d'un fichier à ± 30 % de l'import précédent |
| `FIN_DONNEES_AVANCE` | AVERTISSEMENT | fin des données avancée de plus de 45 jours d'un coup |

## 5. Dictionnaire des KPI

Notations : m = mois, P = période affichée (3 à 24 derniers mois jusqu'au mois de `data_end_date`) ; « contrat de travail » = CDI ou CDD ; **début de travail** `work_start` = début du premier CDI/CDD (au plus tôt l'embauche), l'embauche si aucun contrat n'est connu, NULL si le salarié n'a eu que des stages ou SIVP (`workStartSql`). Deux implémentations aux mêmes définitions : `agg_kpi_monthly` (RH sans filtre de population) et `computeMonthlyRows` (filtres contrat/âge/ancienneté, ou périmètre manager). Le tableau de bord lit le **dernier état connu** des sources (pas de règle as-of).

| # | KPI | Formule exacte | Rôles | Code |
|---|---|---|---|---|
| K1 | Effectif | `headcount(m)` = nombre de salariés avec `work_start ≤ fin(m)` et (`exit_date` NULL ou `> fin(m)`) ; **hors stages et SIVP**. KPI affiché : effectif du dernier mois de P | RH, Manager | `agg_out.headcount`, `computeMonthlyRows` |
| K2 | Entrées | `entries(m)` = salariés avec `work_start ∈ [début(m), fin(m)]` (une conversion SIVP → CDD compte comme entrée) ; KPI = Σ sur P | RH, Manager | idem |
| K3 | Sorties | `exits(m)` = salariés ayant un `work_start` et `exit_date ∈ [début(m), fin(m)]` ; KPI = Σ sur P | RH ; Manager si ≥ 5 personnes | idem |
| K4 | Sorties volontaires | sorties de K3 dont le salarié a un `exit_event` de motif `DEMISSION` ou `ABANDON` | RH ; Manager si ≥ 5 | idem |
| K5 | Turnover glissant 12 mois (total) | `T12(m) = Σ_{j=m−11..m} exits(j) / ( (1/12) · Σ_{j=m−11..m} headcount(j) )` ; NULL si moins de 12 mois d'historique ou effectif moyen nul. KPI = T12 du dernier mois ; série = T12 de chaque mois de P | RH ; Manager si ≥ 5 contrats de travail présents sur les 12 mois | `rollingTurnover` |
| K6 | Turnover glissant 12 mois volontaire | même formule avec `voluntary_exits` | idem | `rollingTurnover(…, true)` |
| K7 | Taux d'absentéisme hors santé non planifié (tableau de bord) | `Σ_{m∈P} jours_absence(m) / Σ_{m∈P} jours_ouvrables(m)`. Numérateur : épisodes `is_health = 0` et catégorie ≠ `CONGE_ANNUEL` (soit `ABSENCE_INJUSTIFIEE`, `CONGE_SANS_SOLDE`, `AUTRE`), chaque épisode ventilé sur les mois au prorata de ses jours ouvrés (jours calendaires s'il n'en a aucun). Dénominateur, agrégé comme détaillé : Σ par salarié présent (**tous contrats**) des jours ouvrés du mois entre son embauche et sa sortie incluses (lundi-vendredi hors fériés de `dim_date`, ponts inclus) ; une entrée ou une sortie en cours de mois est proratisée | RH ; Manager si ≥ 5 présents | `agg_abs`, `workableDaysByBucket` |
| K8 | Taux d'absentéisme par groupe (page Absentéisme) | par semaine (26 dernières) ou par mois (12 derniers) et par département ou équipe : Σ jours d'absence (même numérateur que K7, prorata des jours ouvrés du seau) / Σ par salarié des jours ouvrés de présence dans le seau ; 8 séries au plus (les plus élevées pour la RH) | RH (axe département ou équipe) ; Manager (équipes, masquage sous 5) | `getAbsenteeism` |
| K9 | Formations obligatoires | `due(m)` = formations `mandatory = 1` d'échéance dans m ; `done(m)` = parmi elles, statut **courant** `TERMINEE` ; taux = `Σ_P done / Σ_P due` (le respect de l'échéance n'est pas vérifié) | RH, Manager | `agg_trn`, `computeMonthlyRows` |
| K10 | Masse salariale | `Σ gross_salary` des bulletins du mois des salariés présents dans le mois (tous contrats, gratifications de stage comprises) ; affichés : dernier mois de P et cumul sur P, en TND | **RH seulement** | `payroll_mass` |
| K11 | Niveaux de risque par département | parmi les salariés `ACTIF` de la population filtrée : nombre d'ÉLEVÉ, MOYEN, FAIBLE du run publié et **part non évaluée** (`nonScored` = actifs sans prédiction : SIVP, stages, CDD courts, nouveaux entrants, proches de la retraite, démission connue) | RH, Manager | `riskRows` |
| K12 | Lift individuel et lift moyen | `lift_i = score_i / (1/n) Σ_k score_k` sur les n salariés scorés du run ; lift moyen par département = moyenne des `lift_i` | RH, modèle LOGREG seulement (masqué avec B0) | `rankAndLevel`, `riskRows` |
| K13 | Performance à capacité (Transparence, backtesting) | sur les snapshots à suivi complet, avec les salariés signalés S (niveau ÉLEVÉ du mois, règle de § 6.3) : `precision@k = |S ∩ {y6=1}| / |S|` ; `recall@k = |S ∩ {y6=1}| / |{y6=1}|` ; `lift@k = precision@k / prévalence` ; O/E = `Σ y6 / Σ p` ; AUC, Brier, pente de calibration. Calculés hors ligne ([ml/train/metrics.py](../ml/train/metrics.py)) et stockés dans `metrics_json` ; le backtesting ([src/lib/dal/backtest.ts](../src/lib/dal/backtest.ts), en cours) ajoute le délai moyen d'anticipation | RH, ADMIN (Transparence) ; RH (backtesting) | `parseMetrics` |
| K14 | Adoption des recommandations | `adoption = réalisées / (réalisées + rejetées)` ; `pertinence = PERTINENTE / retours donnés` ; nombre d'interventions | RH | `listRecommendations` |
| K15 | Score qualité d'un import | `rowScore = moyenne sur les fichiers de données présents (hors users.csv) de (lignes OK / lignes lues)` (0 si en-tête invalide, 1 si fichier vide) ; `complétude = 1 − actifs sans paie / actifs` pour le dernier mois de paie importé ; `score = arrondi(rowScore × complétude, 4)` ; BLOQUE si `< quality_threshold` | RH, ADMIN | `runImport` |
| K16 | Facteur de Bradford (signal individuel) | `B = S² × D` sur les 12 mois précédant la fin de la période analysée : S = épisodes non planifiés hors santé (`ABSENCE_INJUSTIFIEE`, `CONGE_SANS_SOLDE`, `AUTRE`) couvrant au moins un jour ouvré non santé de la fenêtre ; D = Σ des jours ouvrés non santé couverts × min(1, jours déclarés / jours ouvrés de l'épisode) ; signal si `B ≥ bradford_threshold` | RH seulement, « à vérifier » | `detectBradford` |
| K17 | Anomalie collective d'absentéisme | pour chaque équipe ou département d'au moins 5 actifs : taux hebdomadaire `r_w` (jours d'absence pondérés / jours ouvrés non santé) ; facteur de classe `f_c = taux entreprise des semaines de classe c / taux des semaines normales` (classes : Ramadan, férié ou pont, séance unique, normale) ; attendu `e_w = médiane(r_k / f_{c(k)}, 26 semaines précédentes, au moins 8) × f_{c(w)}` ; `σ_w = max(1,4826 × MAD × f, √(p(1−p)/n_w))` avec `p = min(0,5 ; max(e_w ; 0,02 f))` ; `z_w = (r_w − e_w) / σ_w` ; signal si `z > 3,5` deux semaines de suite (début d'épisode) | Manager (ses équipes), RH | `zSeries`, `detectAnomalies` |
| K18 | État du worker | âge du heartbeat : ≤ 2 min ACTIF, ≤ 10 min EN_RETARD, au-delà PERIME (alerte SYSTEME), absent sinon | ADMIN, RH ; `/api/health` public | `workerStatus` |

Filtres de population : **âge** à la date de référence (`data_end_date`), tranches < 30, 30-39, 40-49, ≥ 50 ans ; **ancienneté** à la date de référence ou à la sortie, tranches < 1, 1-3, 3-5, 5-10, ≥ 10 ans ; **contrat** = dernier contrat connu. Le manager n'a que les filtres période, département et niveau ([ADR-011](adr/011-gardes-petites-populations-cote-manager.md)).

## 6. Population, cible et décision

### 6.1 Éligibilité à t (`eligibleContract`)

Un salarié est scoré à t si toutes les conditions suivantes sont vraies (lignes visibles à t, [ADR-005](adr/005-visibilite-as-of-par-date-de-saisie.md)) :

1. actif à t : embauché au plus tard à t, aucune sortie visible avec `exit_date ≤ t` ;
2. embauché depuis au moins 1 mois (`hire_date ≤ t − 1 mois`) ;
3. pas de démission ou d'abandon déjà visible à t (`resignation_date`, sinon `exit_date − 1 mois`, ≤ t) ;
4. contrat en vigueur à t : CDI, ou CDD dont le terme est postérieur à t + 6 mois (ou sans terme) ; SIVP et stage exclus ;
5. âge inférieur à 60 ans à t + 6 mois (**à valider**, § 8).

### 6.2 Cible

`y6` de la vue `v_label_panel` (§ 2.4) ; autres sorties = 0 ; entraînement et évaluation sur `followup_complete = 1` ([ADR-004](adr/004-cible-demission-6-mois-risques-concurrents.md)).

### 6.3 Score, niveau, explication

- **LOGREG** : `z_j = (x_j − mean_j) / std_j` (std nul remplacé par 1) ; `logit = intercept + Σ coef_j z_j` ; `p = sigmoid(a · logit + b)` (Platt) ; contribution de la variable j : `a · coef_j · z_j`.
- **B0** : somme des points des règles déclenchées :

| Règle | Points | Groupe |
|---|---|---|
| `compa_ratio < 0,9` | 2 | Rémunération |
| `absence_rate_3m > 0,04` | 1 | Absences |
| `short_episodes_12m ≥ 3` | 1 | Absences |
| `mandatory_training_overdue ≥ 1` | 1 | Formation et évaluation |
| `overtime_h_avg_3m > 20` | 1 | Temps de travail |
| `months_since_promotion > 48` | 1 | Carrière |

- **Niveau** ([ADR-006](adr/006-niveaux-de-risque-par-capacite-rh.md)) : `k = max(1, ⌊n × capacity_rate⌋)` ; ÉLEVÉ si rang ≤ k et score strictement supérieur au (k+1)-ième (et > 0 pour B0) ; MOYEN si lift ≥ `medium_lift` (et score > 0 pour B0) ; FAIBLE sinon.
- **Démarrage à froid** ([src/lib/scoring/cold-start.ts](../src/lib/scoring/cold-start.ts)) : démissions observées à t = salariés distincts avec un snapshot `y6 = 1` (définition de `v_label_panel`) dont l'horizon est clos à t (`as_of + 6 mois ≤ t`) et la sortie saisie à t. Sous `min_events_for_model`, le run est calculé par B0 (champion LOGREG conservé, raison dans l'audit `scoring.publish` et sur la page Transparence) ; sous `indicative_until_events`, la probabilité est « indicative ». Base de démonstration au 31/08/2026 : 484 démissions observées, LOGREG utilisé.
- **Recommandations** : pour ÉLEVÉ et MOYEN, chaque groupe actionnable (Rémunération → `REVISION_SALARIALE`, Temps de travail → `CHARGE_TRAVAIL`, Formation et évaluation → `PLAN_FORMATION`) présent dans les 3 premiers facteurs avec une contribution en HAUSSE ; `ENTRETIEN` pour tout ÉLEVÉ.

## 7. Les 25 variables (fsv `v1`)

Conventions communes ([src/lib/features/compute.ts](../src/lib/features/compute.ts)) :

- **Fenêtres** : « 3 mois » = jours de ]t − 3 mois, t] ; idem 6 et 12 mois. Chaque fenêtre commence au plus tôt au maximum de l'embauche et du premier pointage présent en base ; `partial_history = 1` si la fenêtre de 12 mois est ainsi tronquée.
- **Visibilité** : une ligne compte si sa date d'événement ≤ t **et** sa date de saisie ≤ t (sources sans date de saisie : pointages, formations, contrats → date d'événement seule).
- **Jours disponibles** : jours ouvrés du calendrier (lundi-vendredi hors fériés **et hors ponts**) non couverts par une absence de santé visible à t (masquage santé, [ADR-009](adr/009-exclusion-des-donnees-de-sante.md)). Les pointages d'un jour de santé sont ignorés.
- **Absences comptées** : épisodes visibles hors santé de catégorie `ABSENCE_INJUSTIFIEE`, `CONGE_SANS_SOLDE` ou `AUTRE` ; fraction journalière `min(1, days / jours ouvrés de l'épisode)`, cumul plafonné à 1 par jour.
- **État à t** du grade et du manager : valeur « nouvelle » du dernier événement visible (`PROMOTION`, `CHANGEMENT_MANAGER`), sinon valeur « ancienne » du premier événement connu, sinon valeur courante.
- **Finalisation** : valeur non calculable → **imputation** fixe ; puis **plafond** éventuel ; arrondi à 10⁻⁶.

| # | Variable | Groupe | Définition exacte | Fenêtre | Sources | Imputation / plafond | Unité |
|---|---|---|---|---|---|---|---|
| 1 | `tenure_months` | Carrière et contrat | mois entiers entre `hire_date` et t | — | `employee` | 0 | mois |
| 2 | `contract_cdd` | Carrière et contrat | 1 si le contrat en vigueur à t est un CDD, 0 si CDI | — | `contract` | 0 | 0/1 |
| 3 | `grade_level` | Carrière et contrat | numéro du grade à t (`G3` → 3) | — | `employee.grade`, `career_event` PROMOTION | 1 | niveau |
| 4 | `months_since_promotion` | Carrière et contrat | mois depuis la dernière PROMOTION visible ; à défaut, ancienneté | — | `career_event` | 36 ; plafond 120 | mois |
| 5 | `job_change_12m` | Carrière et contrat | 1 si un CHANGEMENT_POSTE visible est daté dans la fenêtre | 12 mois | `career_event` | 0 | 0/1 |
| 6 | `compa_ratio` | Rémunération | dernier salaire de base visible (paies des 24 derniers mois jusqu'au mois de t, base > 0) / médiane des mêmes salaires des salariés actifs à t de même famille de métier et même grade à t | 24 mois | `payroll_monthly`, `employee.job_family` | 1 | ratio |
| 7 | `raise_pct_12m` | Rémunération | `Π (new / old) − 1` sur les AUGMENTATION visibles de la fenêtre (salaires > 0) | 12 mois | `career_event` | 0 | ratio |
| 8 | `months_since_raise` | Rémunération | mois depuis la dernière AUGMENTATION visible ; à défaut, ancienneté | — | `career_event` | 12 ; plafond 60 | mois |
| 9 | `overtime_h_avg_3m` | Temps de travail | `(Σ overtime_minutes des jours pointés disponibles / 60) / jours disponibles × 21,67` (heures par mois standard) | 3 mois | `attendance_daily` | 0 (sans pointage) | h/mois |
| 10 | `overtime_trend_6m` | Temps de travail | pente des moindres carrés des heures sup mensuelles normalisées (formule de la variable 9 par mois glissant, abscisse −m, m = 0..5), mois retenus si jours disponibles ≥ 50 % des jours ouvrés, au moins 3 mois | 6 mois | `attendance_daily` | 0 | h/mois par mois |
| 11 | `late_count_3m` | Temps de travail | jours pointés disponibles avec `late_minutes > 10` | 3 mois | `attendance_daily` | 0 | jours |
| 12 | `arrival_std_min_3m` | Temps de travail | écart-type (population) des heures d'arrivée en minutes des jours pointés disponibles, si au moins 5 arrivées | 3 mois | `attendance_daily.check_in` | 0 | min |
| 13 | `no_badge_days_3m` | Temps de travail | jours disponibles sans pointage et sans absence justifiée (toute absence hors santé autre qu'`ABSENCE_INJUSTIFIEE`, congé annuel compris) | 3 mois | `attendance_daily`, `absence_episode` | 0 | jours |
| 14 | `absence_rate_3m` | Absences (hors santé) | Σ des fractions d'absence comptées sur les jours disponibles / jours disponibles | 3 mois | `absence_episode` | 0 | ratio |
| 15 | `absence_rate_12m` | Absences (hors santé) | idem sur 12 mois | 12 mois | `absence_episode` | 0 | ratio |
| 16 | `short_episodes_12m` | Absences (hors santé) | épisodes comptés débutant dans la fenêtre, de `days ≤ 3`, couvrant au moins un jour disponible | 12 mois | `absence_episode` | 0 | nombre |
| 17 | `bradford_12m` | Absences (hors santé) | `S² × D` : S = épisodes comptés couvrant au moins un jour disponible de la fenêtre, D = Σ des fractions d'absence sur les jours disponibles | 12 mois | `absence_episode` | 0 | score |
| 18 | `training_hours_12m` | Formation et évaluation | Σ `hours` des formations `TERMINEE` dont la fin (à défaut le début) tombe dans la fenêtre | 12 mois | `training` | 0 | h |
| 19 | `mandatory_training_overdue` | Formation et évaluation | 1 si une formation obligatoire a une échéance < t et n'est pas terminée à t (`TERMINEE` avec fin ≤ t ou sans fin) | — | `training` | 0 | 0/1 |
| 20 | `last_eval_score` | Formation et évaluation | note de la dernière évaluation visible | — | `evaluation` | 3 | note /5 |
| 21 | `eval_delta` | Formation et évaluation | dernière note − avant-dernière note visibles ; 0 s'il n'y en a qu'une | — | `evaluation` | 0 | points |
| 22 | `eval_missing` | Formation et évaluation | 1 si aucune évaluation visible | — | `evaluation` | 0 | 0/1 |
| 23 | `team_exit_rate_6m` | Équipe | départs volontaires visibles (DEMISSION ou ABANDON saisis ≤ t, sortie dans la fenêtre) des salariés rattachés au même manager à t, divisés par (taille de l'équipe + ces départs) | 6 mois | `exit_event`, `career_event` | 0 (sans manager) | ratio |
| 24 | `manager_change_12m` | Équipe | 1 si un CHANGEMENT_MANAGER visible est daté dans la fenêtre | 12 mois | `career_event` | 0 | 0/1 |
| 25 | `team_size` | Équipe | salariés actifs à t ayant le même manager à t (salarié compris) | — | `employee`, `career_event` | 8 (sans manager) | personnes |

Groupes et rôle dans les explications ([shared/features.json](../shared/features.json)) :

| Groupe | Libellé RH | Libellé manager | Actionnable (recommandation) | Visible par le manager |
|---|---|---|---|---|
| `CARRIERE` | Carrière et contrat | Évolution de carrière | non | oui |
| `REMUNERATION` | Rémunération | Rémunération | oui | oui, sauf avec B0 |
| `TEMPS_TRAVAIL` | Temps de travail | Charge de travail | oui | oui |
| `ABSENCES` | Absences (hors santé) | Assiduité | non | **jamais** |
| `FORMATION_EVAL` | Formation et évaluation | Développement des compétences | oui | oui |
| `EQUIPE` | Équipe | Contexte d'équipe | non | oui |

Exclus des variables et conservés pour l'audit d'équité : sexe, âge (date de naissance), situation familiale, gouvernorat. Toute modification de la liste, de l'ordre ou d'une définition impose une nouvelle `fsv` et un backfill.

## 7 bis. Variables des IA par sujet

Chaque IA a son propre jeu de variables, figé dans son bundle (`features`), calculé en TypeScript à la date d'origine O (fin de mois) avec les seules données visibles à O, et vérifié contre Python par le `golden.json` (écarts ≤ 1e-9). Aucune donnée de santé ; maladie et maternité exclues. Détail et résultats : `docs/RESULTATS_IA_*.md`.

### Absentéisme — `abs-ridge-v1-20260930` (ridge direct par horizon 1-3)

Cible : taux mensuel d'absence **hors santé non planifiée** (absence injustifiée, congé sans solde, autre) = jours d'absence / jours ouvrés de présence de l'unité, exprimé en écart à la moyenne 12 mois ; épisodes saisis au plus 10 jours après la fin du mois O (`visibility_lag_days`).

| Variable | Définition |
|---|---|
| `r_last`, `ma3`, `ma12` | taux du dernier mois, moyennes 3 et 12 mois de l'unité |
| `seasonal` | taux du même mois un an plus tôt |
| `parent_ma12` | moyenne 12 mois de l'unité parente (département ou entreprise) |
| `trend`, `company_trend` | tendance (moyenne 3 mois − moyenne 12 mois) de l'unité et de l'entreprise |
| `ramadan_share`, `ramadan_delta12` | part de jours de Ramadan du mois prévu, écart avec l'année précédente |
| `bridge_days`, `holidays` | jours de pont, jours fériés en semaine du mois prévu |
| `seance_unique_share` | part de séance unique hors Ramadan du mois prévu |
| `workdays`, `log_size` | jours ouvrés du mois prévu ; log des jours ouvrés de l'unité (taille) |
| `is_team`, `is_dept` | indicatrices de portée |

### Effectifs — `effectif-v1-20260930` (stock-flux) et masse salariale — `masse-v1-20260930` (régression log saisonnière)

Pas de vecteur de variables : paramètres de flux ré-estimés à chaque calcul depuis la base ([src/lib/ai/workforce/queries.json](../src/lib/ai/workforce/queries.json)) : taux de démission par département sur 24 mois (ou probabilités `prob6` du run publié si le champion turnover est LOGREG, hasard mensuel `1 − (1 − prob6)^(1/6)`), taux des autres sorties sur 24 mois, probabilité de non-renouvellement des CDD à leur terme (24 mois), retraite au mois des 60 ans, sorties déjà saisies, rythme d'embauche des 12 derniers mois × hypothèse du scénario. Masse = base projetée (survies × salaire de base individuel + embauches × salaire moyen des embauchés) × exp(niveau du département + effet du mois) × hausse de janvier × dérive mensuelle. Cibles : K1 (effectif de fin de mois, CDI et CDD) et K10 (masse brute mensuelle) de `agg_kpi_monthly`.

### Formations obligatoires — `formation-logreg-v1-20260930` (régression logistique, Platt)

Ligne = (t, formation obligatoire ouverte : échéance dans ]t, t + 120 j], non terminée, non abandonnée, salarié actif) ; cible : non terminée à l'échéance.

| Variable | Définition |
|---|---|
| `days_to_due`, `log_days_to_due` | jours restants avant l'échéance et leur log |
| `hours` | durée de la formation |
| `log_tenure`, `new_hire` | log(1 + ancienneté en mois) ; arrivé depuis moins de 3 mois |
| `emp_margin_days` | marge moyenne (échéance − fin, bornée à ±120 j) des formations obligatoires échues du salarié (imputée 43,3 j) |
| `team_late_rate_12m` | part en retard des formations obligatoires échues sur 12 mois dans l'équipe, hors salarié (manquante sous 5 formations, imputée 0,113) |
| `overtime_h_3m` | heures sup par mois sur les 3 derniers mois |
| `due_summer` | échéance en juillet ou août |

La date de début d'une formation planifiée n'est jamais lue (fuite du futur dans l'historique reconstruit).

### Charge de travail — `workload-ridge-v1-20260930` (6 ridges : équipe / département × horizon 1-3)

Intensité d'un groupe au mois m : `I = Σ heures sup pointées / ETP`, `ETP = Σ jours pointés / jours ouvrés` ; cible `log(1 + I)` du mois O + h en écart à sa moyenne 12 mois ; groupe = composition à l'origine (rattachés directs d'un manager, ou département).

| Variable | Définition |
|---|---|
| `z_last_dev`, `z_3m_dev` | dernier mois et moyenne 3 mois, en écart à la moyenne 12 mois |
| `seas_group`, `seas_dept` | écart du même mois un an plus tôt à sa moyenne centrée, pour le groupe et son département |
| `trend_6m` | tendance sur 6 mois |
| `ramadan_T`, `summer_su_T`, `bridges_T`, `workdays_T` | calendrier du mois cible : part de Ramadan, de séance unique d'été, de ponts ; jours ouvrés |
| `ramadan_diff`, `summer_su_diff`, `bridges_diff`, `workdays_diff` | écarts de ces 4 grandeurs au même mois N-1 |
| `log_headcount`, `headcount_change_3m` | log de l'effectif, variation sur 3 mois |
| `unfilled_exits_3m` | départs non remplacés sur 3 mois : max(0, sorties − embauches) / effectif à O-3 |
| `m02` … `m12` | indicatrices du mois cible |

Seuil de tension d'équipe : 12,8 h par ETP (quantile 85 % de l'apprentissage). Surcharge individuelle : règle `workload_ot_threshold_h` / `workload_ot_months` (§ 3), pas de modèle.

## 8. Glossaire RH tunisien

| Terme | Définition utilisée dans le module | À valider |
|---|---|---|
| **AJIR** | Progiciel de gestion RH et paie d'ArabSoft ; source de vérité des données importées | format et fréquence de l'export, présence des dates de saisie, du motif de sortie et de la date de démission (S0) |
| **Matricule** | Identifiant du salarié dans AJIR, clé de rapprochement des fichiers | — |
| **CDI** | Contrat à durée indéterminée ; population scorée | — |
| **CDD** | Contrat à durée déterminée ; scoré seulement si son terme dépasse t + 6 mois, sa fin prévue est affichée comme un fait | effets de la réforme du Code du travail de 2025 (CDI comme règle, CDD encadrés) sur la part de CDD et le mapping des sorties : **à vérifier** |
| **SIVP** | Stage d'Initiation à la Vie Professionnelle : dispositif d'insertion des diplômés (contrat aidé) ; exclu de la population scorée, de l'effectif et du turnover, autorisé sous le SMIG | autres contrats aidés (Karama, CAIP…) absents de l'énumération : une valeur inconnue est rejetée à l'import ; nomenclature à relever dans AJIR |
| **Stage** | Stagiaire, gratification possible sous le SMIG ; exclu comme le SIVP | — |
| **SMIG** | Salaire Minimum Interprofessionnel Garanti ; paramètre `smig_monthly` = 528,320 TND/mois (régime 48 heures) pour le contrôle d'import | montant du dernier décret et régime (40 h ou 48 h) du client : **à valider** ; le SMAG (agricole) n'est pas géré |
| **TND** | Dinar tunisien ; tous les montants (millimes en 3 décimales) | — |
| **Grade** | Niveau de classification `G1` (bas) à `G8` ; référence du compa-ratio avec la famille de métier | correspondance avec les catégories et échelons des conventions collectives du client |
| **Famille de métier** | Regroupement de postes (`job_family`) ; référence salariale | — |
| **Compa-ratio** | Salaire de base / médiane des salaires de base de la même famille et du même grade | — |
| **Masse salariale** | Somme des salaires bruts du mois (`gross_salary`) | inclusion des charges patronales : non (brut seulement) |
| **Charges patronales** | Taux appliqué au coût annuel du what-if, 16,57 % par défaut (cotisations CNSS du régime général) | taux et assiette exacts du client : **à valider** |
| **Heures supplémentaires** | Minutes au-delà de l'horaire, pointées (`overtime_minutes`) et payées (`overtime_hours`) ; normalisées à 21,67 jours par mois | majorations légales (25 % et plus) non utilisées par le module |
| **Séance unique** | Horaire continu réduit : dans le code, 1er juillet–31 août et tout le Ramadan (horaires du secteur public) | application et dates dans le secteur privé du client, parfois fixées par convention : **à valider** |
| **Ramadan** | Mois de jeûne ; horaires réduits et absentéisme différent, pris en compte comme classe calendaire dans la détection d'anomalies | dates religieuses estimées chaque année dans [tn-dates.ts](../src/lib/calendar/tn-dates.ts) (table 2019-2030, repli Umm al-Qura) : **à relire chaque année** |
| **Jours fériés** | Nouvel An, Indépendance (20 mars), Martyrs (9 avril), Travail (1er mai), République (25 juillet), Femme (13 août), Évacuation (15 octobre), Révolution (14 janvier jusqu'en 2021, 17 décembre depuis 2021), Ras el Am el Hejri, Mouled, Aïd el-Fitr (2 jours), Aïd el-Idha (2 jours) | changement de la fête de la Révolution et références du décret cité dans le code : **à valider** ; jours fériés propres à une convention |
| **Pont** | Jour ouvré isolé entre un férié et un week-end ; ouvré pour les KPI, non ouvré pour les variables et les anomalies | pratique réelle du client (pont chômé ou non) |
| **Préavis** | Délai entre la démission et la sortie ; fixé à **1 mois** pour estimer la date de démission absente | durée selon le Code du travail, la catégorie et la convention collective : **à valider** |
| **Démission** | Rupture à l'initiative du salarié (`DEMISSION`) ; événement prédit | — |
| **Abandon de poste** | Absence prolongée sans justification conduisant à la rupture (`ABANDON`) ; assimilé à un départ volontaire | qualification juridique (faute grave, rupture à l'initiative de l'employeur) et codage réel dans AJIR : **à valider** |
| **Fin de CDD, licenciement, retraite, décès, mutation** | Autres sorties, traitées en risques concurrents (non-démission) | — |
| **Retraite** | Salariés de 60 ans et plus à t + 6 mois exclus de la population scorée | l'âge légal de départ a été relevé pour certains régimes depuis 2019 (62 ans) : **à vérifier** pour le régime du client |
| **Période d'essai** | Non modélisée (aucun champ dans l'export) | à ajouter si AJIR la stocke |
| **Congé annuel** | Absence planifiée, exclue de l'absentéisme et des variables d'absence | — |
| **Congé sans solde** | Absence non rémunérée, comptée comme absence non planifiée hors santé | — |
| **Absence injustifiée** | Absence sans justificatif ; comptée, et considérée comme non justifiée pour les jours sans badge | — |
| **Maladie, maternité** | Absences de santé (`is_health = 1`), exclues de toute variable et de tout score | table de correspondance des motifs AJIR (accident du travail, longue maladie…) : **à valider** |
| **Facteur de Bradford** | `S² × D` : pondère davantage les absences courtes et répétées ; signal individuel RH « à vérifier », seuil 250 | seuil adapté au client |
| **Absentéisme hors santé non planifié** | Jours d'absence injustifiée, sans solde ou autre / jours ouvrables | — |
| **Turnover (rotation)** | Sorties sur 12 mois / effectif moyen sur 12 mois ; volontaire = démissions et abandons | — |
| **Exposition au risque** | Vocabulaire du module : niveau ÉLEVÉ/MOYEN/FAIBLE, « facteurs associés », jamais « causes » ni « départs évités » | — |
| **Gouvernorat** | Division administrative (24) ; audit d'équité seulement | — |
| **Loi organique n° 2004-63** | Loi du 27 juillet 2004 portant sur la protection des données à caractère personnel ; le client, responsable du traitement, déclare le traitement à l'INPDP | absence de réforme adoptée depuis : **à vérifier** (S0) |
| **INPDP** | Instance Nationale de Protection des Données Personnelles, autorité de contrôle tunisienne | procédure (déclaration ou autorisation) applicable à ce traitement : **à valider** avec le client |
| **Convention 108** | Convention du Conseil de l'Europe pour la protection des personnes à l'égard du traitement automatisé des données, à laquelle la Tunisie a adhéré | — |
| **RGPD, AI Act** | Référentiels européens utilisés comme grille de lecture pour les clients travaillant avec l'Europe (emploi = système à haut risque, annexe III) | analyse de conformité, jamais « conforme » |
| **INS** | Institut National de la Statistique ; source visée pour caler le simulateur | calage non encore réalisé |
| **ArabSoft** | Éditeur d'AJIR, propriétaire du format d'export | accord écrit avant toute publication du simulateur |

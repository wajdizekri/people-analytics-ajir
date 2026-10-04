import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ---------- Sources (importées depuis AJIR, lecture seule dans l'app) ----------

export const department = sqliteTable("department", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const employee = sqliteTable(
  "employee",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matricule: text("matricule").notNull().unique(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    sex: text("sex", { enum: ["F", "M"] }),
    birthDate: text("birth_date"),
    hireDate: text("hire_date").notNull(),
    departmentId: integer("department_id").references(() => department.id),
    jobFamily: text("job_family"),
    jobTitle: text("job_title"),
    grade: text("grade"),
    managerId: integer("manager_id"),
    governorate: text("governorate"),
    maritalStatus: text("marital_status"),
    status: text("status", { enum: ["ACTIF", "SORTI"] }).notNull().default("ACTIF"),
    exitDate: text("exit_date"),
  },
  (t) => [index("employee_dept_idx").on(t.departmentId), index("employee_manager_idx").on(t.managerId)],
);

export const contract = sqliteTable(
  "contract",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    type: text("type", { enum: ["CDI", "CDD", "SIVP", "STAGE"] }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
  },
  (t) => [index("contract_emp_idx").on(t.employeeId)],
);

export const EXIT_REASONS = ["DEMISSION", "ABANDON", "FIN_CDD", "LICENCIEMENT", "RETRAITE", "DECES", "MUTATION", "AUTRE"] as const;

export const exitEvent = sqliteTable(
  "exit_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    exitDate: text("exit_date").notNull(),
    reason: text("reason", { enum: EXIT_REASONS }).notNull(),
    resignationDate: text("resignation_date"),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [index("exit_emp_idx").on(t.employeeId)],
);

// Historique des changements de carrière (promotion, augmentation, mutation, manager, poste)
export const careerEvent = sqliteTable(
  "career_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    date: text("date").notNull(),
    type: text("type", { enum: ["PROMOTION", "AUGMENTATION", "MUTATION", "CHANGEMENT_MANAGER", "CHANGEMENT_POSTE"] }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [index("career_emp_date_idx").on(t.employeeId, t.date)],
);

export const attendanceDaily = sqliteTable(
  "attendance_daily",
  {
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    date: text("date").notNull(),
    checkIn: text("check_in"),
    checkOut: text("check_out"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.date] }), index("attendance_date_idx").on(t.date)],
);

export const ABSENCE_CATEGORIES = ["CONGE_ANNUEL", "MALADIE", "MATERNITE", "ABSENCE_INJUSTIFIEE", "CONGE_SANS_SOLDE", "AUTRE"] as const;

export const absenceEpisode = sqliteTable(
  "absence_episode",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    days: real("days").notNull(),
    category: text("category", { enum: ABSENCE_CATEGORIES }).notNull(),
    // maladie / maternité : donnée de santé, jamais utilisée dans un score individuel
    isHealth: integer("is_health", { mode: "boolean" }).notNull().default(false),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [index("absence_emp_idx").on(t.employeeId, t.startDate)],
);

export const payrollMonthly = sqliteTable(
  "payroll_monthly",
  {
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    month: text("month").notNull(), // YYYY-MM
    baseSalary: real("base_salary").notNull(),
    grossSalary: real("gross_salary").notNull(),
    overtimeHours: real("overtime_hours").notNull().default(0),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.month] })],
);

export const training = sqliteTable(
  "training",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    code: text("code").notNull(),
    title: text("title").notNull(),
    mandatory: integer("mandatory", { mode: "boolean" }).notNull().default(false),
    startDate: text("start_date"),
    endDate: text("end_date"),
    dueDate: text("due_date"),
    hours: real("hours").notNull().default(0),
    status: text("status", { enum: ["PLANIFIEE", "EN_COURS", "TERMINEE", "ABANDONNEE"] }).notNull(),
  },
  (t) => [index("training_emp_idx").on(t.employeeId)],
);

export const evaluation = sqliteTable(
  "evaluation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employee.id),
    evalDate: text("eval_date").notNull(),
    score: real("score").notNull(), // 1..5
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [index("evaluation_emp_idx").on(t.employeeId, t.evalDate)],
);

// Calendrier tunisien
export const dimDate = sqliteTable("dim_date", {
  date: text("date").primaryKey(),
  isWeekend: integer("is_weekend", { mode: "boolean" }).notNull(),
  isHoliday: integer("is_holiday", { mode: "boolean" }).notNull().default(false),
  holidayName: text("holiday_name"),
  isRamadan: integer("is_ramadan", { mode: "boolean" }).notNull().default(false),
  isBridge: integer("is_bridge", { mode: "boolean" }).notNull().default(false),
  isSeanceUnique: integer("is_seance_unique", { mode: "boolean" }).notNull().default(false),
});

// ---------- Imports et qualité ----------

export const importBatch = sqliteTable("import_batch", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  startedAt: text("started_at").notNull().default(now),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["EN_COURS", "OK", "BLOQUE", "ECHEC"] }).notNull().default("EN_COURS"),
  rowsOk: integer("rows_ok").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  qualityScore: real("quality_score"),
  reportJson: text("report_json"),
  userId: integer("user_id"),
});

export const importRejection = sqliteTable(
  "import_rejection",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id").notNull().references(() => importBatch.id),
    file: text("file").notNull(),
    line: integer("line"),
    rule: text("rule").notNull(),
    message: text("message").notNull(),
    raw: text("raw"),
    // REJET : ligne non importée ; CORRECTION : importée avec un champ neutralisé ; AVERTISSEMENT : contrôle informatif
    severity: text("severity", { enum: ["REJET", "CORRECTION", "AVERTISSEMENT"] }).notNull().default("REJET"),
  },
  (t) => [index("rejection_batch_idx").on(t.batchId)],
);

// ---------- Agrégats pour dashboards (remplacent les vues matérialisées) ----------

export const aggKpiMonthly = sqliteTable(
  "agg_kpi_monthly",
  {
    month: text("month").notNull(),
    departmentId: integer("department_id").notNull(),
    headcount: integer("headcount").notNull(),
    entries: integer("entries").notNull(),
    exits: integer("exits").notNull(),
    voluntaryExits: integer("voluntary_exits").notNull(),
    absenceDaysNonHealth: real("absence_days_non_health").notNull(),
    absenceDaysHealth: real("absence_days_health").notNull(),
    workableDays: real("workable_days").notNull(),
    lateCount: integer("late_count").notNull(),
    overtimeHours: real("overtime_hours").notNull(),
    payrollMass: real("payroll_mass").notNull(),
    trainingHours: real("training_hours").notNull(),
    trainingsDone: integer("trainings_done").notNull(),
    trainingsDue: integer("trainings_due").notNull(),
  },
  (t) => [primaryKey({ columns: [t.month, t.departmentId] })],
);

// ---------- Couche ML ----------

export const featureSnapshot = sqliteTable(
  "feature_snapshot",
  {
    employeeId: integer("employee_id").notNull(),
    asOf: text("as_of").notNull(), // fin de mois YYYY-MM-DD
    fsv: text("fsv").notNull(), // version du jeu de features
    valuesJson: text("values_json").notNull(), // tableau ordonné selon shared/features.json
    partialHistory: integer("partial_history", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.asOf, t.fsv] }), index("snapshot_asof_idx").on(t.asOf, t.fsv)],
);

export const modelVersion = sqliteTable(
  "model_version",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    version: text("version").notNull().unique(),
    kind: text("kind", { enum: ["B0", "LOGREG", "LGBM"] }).notNull(),
    status: text("status", { enum: ["CANDIDAT", "CHAMPION", "RETIRE"] }).notNull().default("CANDIDAT"),
    fsv: text("fsv").notNull(),
    bundlePath: text("bundle_path"),
    manifestJson: text("manifest_json"),
    metricsJson: text("metrics_json"),
    createdAt: text("created_at").notNull().default(now),
    promotedAt: text("promoted_at"),
    promotedBy: integer("promoted_by"),
  },
  (t) => [uniqueIndex("model_one_champion").on(t.status).where(sql`status = 'CHAMPION'`)],
);

export const scoringRun = sqliteTable(
  "scoring_run",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    asOf: text("as_of").notNull(),
    modelVersionId: integer("model_version_id").notNull(),
    status: text("status", { enum: ["STAGING", "PUBLIE", "ECHEC"] }).notNull().default("STAGING"),
    startedAt: text("started_at").notNull().default(now),
    finishedAt: text("finished_at"),
    nScored: integer("n_scored").notNull().default(0),
    error: text("error"),
  },
  (t) => [uniqueIndex("run_asof_model").on(t.asOf, t.modelVersionId)],
);

export const RISK_LEVELS = ["FAIBLE", "MOYEN", "ELEVE"] as const;

export const prediction = sqliteTable(
  "prediction",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull().references(() => scoringRun.id),
    employeeId: integer("employee_id").notNull(),
    asOf: text("as_of").notNull(),
    prob6: real("prob6").notNull(),
    level: text("level", { enum: RISK_LEVELS }).notNull(),
    rank: integer("rank").notNull(),
    lift: real("lift").notNull(),
    modelVersionId: integer("model_version_id").notNull(),
  },
  (t) => [index("prediction_run_emp_idx").on(t.runId, t.employeeId), index("prediction_emp_idx").on(t.employeeId, t.asOf)],
);

// Groupes : CARRIERE, REMUNERATION, TEMPS_TRAVAIL, ABSENCES, FORMATION_EVAL, EQUIPE
export const predictionFactor = sqliteTable(
  "prediction_factor",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    predictionId: integer("prediction_id").notNull().references(() => prediction.id),
    groupCode: text("group_code").notNull(),
    contribution: real("contribution").notNull(), // en log-odds
    rank: integer("rank").notNull(),
    direction: text("direction", { enum: ["HAUSSE", "BAISSE"] }).notNull(),
    topFeature: text("top_feature"),
    topFeatureValue: real("top_feature_value"),
    phraseRh: text("phrase_rh"),
    phraseManager: text("phrase_manager"),
  },
  (t) => [index("factor_pred_idx").on(t.predictionId)],
);

export const recommendation = sqliteTable(
  "recommendation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull(),
    predictionId: integer("prediction_id"),
    actionCode: text("action_code").notNull(),
    triggerGroup: text("trigger_group").notNull(),
    status: text("status", { enum: ["PROPOSEE", "REALISEE", "REJETEE"] }).notNull().default("PROPOSEE"),
    feedback: text("feedback", { enum: ["PERTINENTE", "NON_PERTINENTE"] }),
    comment: text("comment"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at"),
    updatedBy: integer("updated_by"),
  },
  (t) => [index("reco_emp_idx").on(t.employeeId)],
);

export const intervention = sqliteTable("intervention", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull(),
  recommendationId: integer("recommendation_id"),
  date: text("date").notNull(),
  actionCode: text("action_code").notNull(),
  createdBy: integer("created_by"),
});

export const anomaly = sqliteTable(
  "anomaly",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scope: text("scope", { enum: ["EQUIPE", "DEPARTEMENT", "SALARIE"] }).notNull(),
    departmentId: integer("department_id"),
    managerId: integer("manager_id"),
    employeeId: integer("employee_id"),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    metric: text("metric").notNull(),
    observed: real("observed").notNull(),
    expected: real("expected"),
    score: real("score").notNull(),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("anomaly_period_idx").on(t.periodStart)],
);

export const ALERT_TYPES = ["TURNOVER", "ABSENTEISME", "DONNEES", "SYSTEME"] as const;
export const ALERT_STATUSES = ["NOUVELLE", "EN_COURS", "TRAITEE", "REJETEE"] as const;

export const alert = sqliteTable(
  "alert",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ALERT_TYPES }).notNull(),
    severity: text("severity", { enum: ["INFO", "ATTENTION", "CRITIQUE"] }).notNull(),
    status: text("status", { enum: ALERT_STATUSES }).notNull().default("NOUVELLE"),
    // qui peut la voir : RH, MANAGER (le manager du périmètre + RH), ADMIN seulement (système)
    audience: text("audience", { enum: ["RH", "MANAGER", "ADMIN"] }).notNull(),
    departmentId: integer("department_id"),
    managerId: integer("manager_id"),
    employeeId: integer("employee_id"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    dedupKey: text("dedup_key").notNull().unique(),
    comment: text("comment"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at"),
    updatedBy: integer("updated_by"),
  },
  (t) => [index("alert_status_idx").on(t.status, t.type)],
);

// ---------- Application ----------

export const ROLES = ["ADMIN", "RH", "MANAGER"] as const;
export type Role = (typeof ROLES)[number];

export const appUser = sqliteTable("app_user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ROLES }).notNull(),
  employeeId: integer("employee_id"), // obligatoire pour MANAGER : racine de son périmètre
  email: text("email"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  activationTokenHash: text("activation_token_hash"),
  activationExpiresAt: text("activation_expires_at"),
  createdAt: text("created_at").notNull().default(now),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(), // SHA-256 du jeton, jamais le jeton lui-même
    userId: integer("user_id").notNull().references(() => appUser.id),
    createdAt: text("created_at").notNull().default(now),
    expiresAt: text("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

// Append-only : triggers dans la migration personnalisée (drizzle/*_audit_triggers.sql)
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull().default(now),
    userId: integer("user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome", { enum: ["OK", "REFUSE", "ECHEC"] }).notNull().default("OK"),
    detailJson: text("detail_json"),
    ip: text("ip"),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);

export const appJob = sqliteTable(
  "app_job",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ["IMPORT", "AGGREGATE", "FEATURES", "SCORING", "ANOMALIES", "BATCH_MENSUEL"] }).notNull(),
    target: text("target"),
    status: text("status", { enum: ["EN_FILE", "EN_COURS", "TERMINE", "ECHEC"] }).notNull().default("EN_FILE"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull().default(now),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
    error: text("error"),
    createdBy: integer("created_by"),
  },
  (t) => [
    index("job_status_idx").on(t.status),
    uniqueIndex("job_one_active").on(t.type, t.target).where(sql`status in ('EN_FILE','EN_COURS')`),
  ],
);

// Clés : current_run_id, capacity_rate (part de l'effectif scoré classée ÉLEVÉ), quality_threshold...
export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
  updatedBy: integer("updated_by"),
});

// ---------- IA par sujet (absentéisme, effectifs et masse salariale, formation) ----------

export const AI_TOPICS = ["ABSENTEISME", "EFFECTIF", "MASSE_SALARIALE", "FORMATION", "TURNOVER", "CHARGE_TRAVAIL"] as const;

// Registre des modèles hors turnover (le turnover garde model_version)
export const topicModel = sqliteTable(
  "topic_model",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topic: text("topic", { enum: AI_TOPICS }).notNull(),
    version: text("version").notNull().unique(),
    kind: text("kind").notNull(), // ex. NAIF_SAISONNIER, RIDGE, LOGREG
    status: text("status", { enum: ["CANDIDAT", "CHAMPION", "RETIRE"] }).notNull().default("CANDIDAT"),
    bundlePath: text("bundle_path"),
    metricsJson: text("metrics_json"),
    createdAt: text("created_at").notNull().default(now),
    promotedAt: text("promoted_at"),
  },
  (t) => [uniqueIndex("topic_model_one_champion").on(t.topic).where(sql`status = 'CHAMPION'`)],
);

// Prévisions agrégées (jamais individuelles) : taux d'absentéisme, effectif, masse salariale
export const forecast = sqliteTable(
  "forecast",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topic: text("topic", { enum: AI_TOPICS }).notNull(),
    scope: text("scope", { enum: ["ENTREPRISE", "DEPARTEMENT", "EQUIPE"] }).notNull(),
    departmentId: integer("department_id"),
    managerId: integer("manager_id"),
    asOf: text("as_of").notNull(), // fin du dernier mois observé
    month: text("month").notNull(), // mois prévu YYYY-MM
    horizon: integer("horizon").notNull(), // 1..12
    value: real("value").notNull(),
    lower: real("lower"),
    upper: real("upper"),
    modelVersion: text("model_version").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("forecast_topic_idx").on(t.topic, t.asOf, t.scope)],
);

// Risque individuel de ne pas terminer une formation obligatoire avant l'échéance
export const trainingRisk = sqliteTable(
  "training_risk",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trainingId: integer("training_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    asOf: text("as_of").notNull(),
    prob: real("prob").notNull(),
    level: text("level", { enum: RISK_LEVELS }).notNull(),
    factorsJson: text("factors_json"),
    modelVersion: text("model_version").notNull(),
  },
  (t) => [index("training_risk_asof_idx").on(t.asOf, t.employeeId)],
);

// Recommandations par sujet (collectives ou individuelles), distinctes des recommandations turnover
export const insightRecommendation = sqliteTable(
  "insight_recommendation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topic: text("topic", { enum: AI_TOPICS }).notNull(),
    scope: text("scope", { enum: ["ENTREPRISE", "DEPARTEMENT", "EQUIPE", "SALARIE"] }).notNull(),
    audience: text("audience", { enum: ["RH", "MANAGER"] }).notNull(),
    departmentId: integer("department_id"),
    managerId: integer("manager_id"),
    employeeId: integer("employee_id"),
    actionCode: text("action_code").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(), // explication en langage RH, sans donnée de santé
    priority: integer("priority").notNull().default(2), // 1 haute, 2 moyenne, 3 basse
    status: text("status", { enum: ["PROPOSEE", "REALISEE", "REJETEE"] }).notNull().default("PROPOSEE"),
    comment: text("comment"),
    dedupKey: text("dedup_key").notNull().unique(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at"),
    updatedBy: integer("updated_by"),
  },
  (t) => [index("insight_topic_idx").on(t.topic, t.status)],
);

// ---------- Protection des données (loi organique 2004-63 : accès, opposition, rectification) ----------

export const privacyRequest = sqliteTable(
  "privacy_request",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull(),
    type: text("type", { enum: ["ACCES", "OPPOSITION", "RECTIFICATION"] }).notNull(),
    status: text("status", { enum: ["OUVERTE", "TRAITEE", "REFUSEE"] }).notNull().default("OUVERTE"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
    createdBy: integer("created_by"),
    closedAt: text("closed_at"),
    closedBy: integer("closed_by"),
  },
  (t) => [index("privacy_request_emp_idx").on(t.employeeId)],
);

// Salarié opposé au traitement prédictif : exclu du scoring, du what-if et des recommandations individuelles
export const employeeOpposition = sqliteTable("employee_opposition", {
  employeeId: integer("employee_id").primaryKey(),
  since: text("since").notNull(),
  requestId: integer("request_id"),
  recordedBy: integer("recorded_by"),
});

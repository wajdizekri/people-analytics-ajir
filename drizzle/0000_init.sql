CREATE TABLE `absence_episode` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`days` real NOT NULL,
	`category` text NOT NULL,
	`is_health` integer DEFAULT false NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `absence_emp_idx` ON `absence_episode` (`employee_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `agg_kpi_monthly` (
	`month` text NOT NULL,
	`department_id` integer NOT NULL,
	`headcount` integer NOT NULL,
	`entries` integer NOT NULL,
	`exits` integer NOT NULL,
	`voluntary_exits` integer NOT NULL,
	`absence_days_non_health` real NOT NULL,
	`absence_days_health` real NOT NULL,
	`workable_days` real NOT NULL,
	`late_count` integer NOT NULL,
	`overtime_hours` real NOT NULL,
	`payroll_mass` real NOT NULL,
	`training_hours` real NOT NULL,
	`trainings_done` integer NOT NULL,
	`trainings_due` integer NOT NULL,
	PRIMARY KEY(`month`, `department_id`)
);
--> statement-breakpoint
CREATE TABLE `alert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'NOUVELLE' NOT NULL,
	`audience` text NOT NULL,
	`department_id` integer,
	`manager_id` integer,
	`employee_id` integer,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`link` text,
	`dedup_key` text NOT NULL,
	`comment` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text,
	`updated_by` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_dedup_key_unique` ON `alert` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `alert_status_idx` ON `alert` (`status`,`type`);--> statement-breakpoint
CREATE TABLE `anomaly` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`department_id` integer,
	`manager_id` integer,
	`employee_id` integer,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`metric` text NOT NULL,
	`observed` real NOT NULL,
	`expected` real,
	`score` real NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `anomaly_period_idx` ON `anomaly` (`period_start`);--> statement-breakpoint
CREATE TABLE `app_job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`target` text,
	`status` text DEFAULT 'EN_FILE' NOT NULL,
	`payload_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`heartbeat_at` text,
	`error` text,
	`created_by` integer
);
--> statement-breakpoint
CREATE INDEX `job_status_idx` ON `app_job` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_one_active` ON `app_job` (`type`,`target`) WHERE status in ('EN_FILE','EN_COURS');--> statement-breakpoint
CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_by` integer
);
--> statement-breakpoint
CREATE TABLE `app_user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`employee_id` integer,
	`email` text,
	`active` integer DEFAULT true NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`activation_token_hash` text,
	`activation_expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_user_login_unique` ON `app_user` (`login`);--> statement-breakpoint
CREATE TABLE `attendance_daily` (
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`check_in` text,
	`check_out` text,
	`worked_minutes` integer DEFAULT 0 NOT NULL,
	`overtime_minutes` integer DEFAULT 0 NOT NULL,
	`late_minutes` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`employee_id`, `date`),
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attendance_date_idx` ON `attendance_daily` (`date`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`outcome` text DEFAULT 'OK' NOT NULL,
	`detail_json` text,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `career_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `career_emp_date_idx` ON `career_event` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `contract` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contract_emp_idx` ON `contract` (`employee_id`);--> statement-breakpoint
CREATE TABLE `department` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_code_unique` ON `department` (`code`);--> statement-breakpoint
CREATE TABLE `dim_date` (
	`date` text PRIMARY KEY NOT NULL,
	`is_weekend` integer NOT NULL,
	`is_holiday` integer DEFAULT false NOT NULL,
	`holiday_name` text,
	`is_ramadan` integer DEFAULT false NOT NULL,
	`is_bridge` integer DEFAULT false NOT NULL,
	`is_seance_unique` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employee` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`matricule` text NOT NULL,
	`last_name` text NOT NULL,
	`first_name` text NOT NULL,
	`sex` text,
	`birth_date` text,
	`hire_date` text NOT NULL,
	`department_id` integer,
	`job_family` text,
	`job_title` text,
	`grade` text,
	`manager_id` integer,
	`governorate` text,
	`marital_status` text,
	`status` text DEFAULT 'ACTIF' NOT NULL,
	`exit_date` text,
	FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_matricule_unique` ON `employee` (`matricule`);--> statement-breakpoint
CREATE INDEX `employee_dept_idx` ON `employee` (`department_id`);--> statement-breakpoint
CREATE INDEX `employee_manager_idx` ON `employee` (`manager_id`);--> statement-breakpoint
CREATE TABLE `evaluation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`eval_date` text NOT NULL,
	`score` real NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evaluation_emp_idx` ON `evaluation` (`employee_id`,`eval_date`);--> statement-breakpoint
CREATE TABLE `exit_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`exit_date` text NOT NULL,
	`reason` text NOT NULL,
	`resignation_date` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exit_emp_idx` ON `exit_event` (`employee_id`);--> statement-breakpoint
CREATE TABLE `feature_snapshot` (
	`employee_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`fsv` text NOT NULL,
	`values_json` text NOT NULL,
	`partial_history` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`employee_id`, `as_of`, `fsv`)
);
--> statement-breakpoint
CREATE INDEX `snapshot_asof_idx` ON `feature_snapshot` (`as_of`,`fsv`);--> statement-breakpoint
CREATE TABLE `import_batch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'EN_COURS' NOT NULL,
	`rows_ok` integer DEFAULT 0 NOT NULL,
	`rows_rejected` integer DEFAULT 0 NOT NULL,
	`quality_score` real,
	`report_json` text,
	`user_id` integer
);
--> statement-breakpoint
CREATE TABLE `import_rejection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`file` text NOT NULL,
	`line` integer,
	`rule` text NOT NULL,
	`message` text NOT NULL,
	`raw` text,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batch`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rejection_batch_idx` ON `import_rejection` (`batch_id`);--> statement-breakpoint
CREATE TABLE `intervention` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`recommendation_id` integer,
	`date` text NOT NULL,
	`action_code` text NOT NULL,
	`created_by` integer
);
--> statement-breakpoint
CREATE TABLE `model_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'CANDIDAT' NOT NULL,
	`fsv` text NOT NULL,
	`bundle_path` text,
	`manifest_json` text,
	`metrics_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`promoted_at` text,
	`promoted_by` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_version_version_unique` ON `model_version` (`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `model_one_champion` ON `model_version` (`status`) WHERE status = 'CHAMPION';--> statement-breakpoint
CREATE TABLE `payroll_monthly` (
	`employee_id` integer NOT NULL,
	`month` text NOT NULL,
	`base_salary` real NOT NULL,
	`gross_salary` real NOT NULL,
	`overtime_hours` real DEFAULT 0 NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`employee_id`, `month`),
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prediction` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`prob6` real NOT NULL,
	`level` text NOT NULL,
	`rank` integer NOT NULL,
	`lift` real NOT NULL,
	`model_version_id` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `scoring_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prediction_run_emp_idx` ON `prediction` (`run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `prediction_emp_idx` ON `prediction` (`employee_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `prediction_factor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prediction_id` integer NOT NULL,
	`group_code` text NOT NULL,
	`contribution` real NOT NULL,
	`rank` integer NOT NULL,
	`direction` text NOT NULL,
	`top_feature` text,
	`top_feature_value` real,
	`phrase_rh` text,
	`phrase_manager` text,
	FOREIGN KEY (`prediction_id`) REFERENCES `prediction`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `factor_pred_idx` ON `prediction_factor` (`prediction_id`);--> statement-breakpoint
CREATE TABLE `recommendation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`prediction_id` integer,
	`action_code` text NOT NULL,
	`trigger_group` text NOT NULL,
	`status` text DEFAULT 'PROPOSEE' NOT NULL,
	`feedback` text,
	`comment` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text,
	`updated_by` integer
);
--> statement-breakpoint
CREATE INDEX `reco_emp_idx` ON `recommendation` (`employee_id`);--> statement-breakpoint
CREATE TABLE `scoring_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`as_of` text NOT NULL,
	`model_version_id` integer NOT NULL,
	`status` text DEFAULT 'STAGING' NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	`n_scored` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_asof_model` ON `scoring_run` (`as_of`,`model_version_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `training` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`mandatory` integer DEFAULT false NOT NULL,
	`start_date` text,
	`end_date` text,
	`due_date` text,
	`hours` real DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `training_emp_idx` ON `training` (`employee_id`);
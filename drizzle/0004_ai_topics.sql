CREATE TABLE `forecast` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`scope` text NOT NULL,
	`department_id` integer,
	`manager_id` integer,
	`as_of` text NOT NULL,
	`month` text NOT NULL,
	`horizon` integer NOT NULL,
	`value` real NOT NULL,
	`lower` real,
	`upper` real,
	`model_version` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forecast_topic_idx` ON `forecast` (`topic`,`as_of`,`scope`);--> statement-breakpoint
CREATE TABLE `insight_recommendation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`scope` text NOT NULL,
	`audience` text NOT NULL,
	`department_id` integer,
	`manager_id` integer,
	`employee_id` integer,
	`action_code` text NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'PROPOSEE' NOT NULL,
	`comment` text,
	`dedup_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text,
	`updated_by` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insight_recommendation_dedup_key_unique` ON `insight_recommendation` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `insight_topic_idx` ON `insight_recommendation` (`topic`,`status`);--> statement-breakpoint
CREATE TABLE `topic_model` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic` text NOT NULL,
	`version` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'CANDIDAT' NOT NULL,
	`bundle_path` text,
	`metrics_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`promoted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_model_version_unique` ON `topic_model` (`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `topic_model_one_champion` ON `topic_model` (`topic`) WHERE status = 'CHAMPION';--> statement-breakpoint
CREATE TABLE `training_risk` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`training_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`prob` real NOT NULL,
	`level` text NOT NULL,
	`factors_json` text,
	`model_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `training_risk_asof_idx` ON `training_risk` (`as_of`,`employee_id`);
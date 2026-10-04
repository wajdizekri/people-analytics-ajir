CREATE TABLE `employee_opposition` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`since` text NOT NULL,
	`request_id` integer,
	`recorded_by` integer
);
--> statement-breakpoint
CREATE TABLE `privacy_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'OUVERTE' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` integer,
	`closed_at` text,
	`closed_by` integer
);
--> statement-breakpoint
CREATE INDEX `privacy_request_emp_idx` ON `privacy_request` (`employee_id`);
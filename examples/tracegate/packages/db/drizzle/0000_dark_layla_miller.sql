CREATE TABLE `assertion_evidence` (
	`run_id` text PRIMARY KEY NOT NULL,
	`evidence_hash` text NOT NULL,
	`captured_at` text NOT NULL,
	`redacted_display_url` text,
	`document_id_hash` text NOT NULL,
	`loader_id_hash` text NOT NULL,
	`unverifiable_count` integer NOT NULL,
	`evidence_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assertion_evidence_captured_index` ON `assertion_evidence` (`captured_at`);--> statement-breakpoint
CREATE INDEX `assertion_evidence_hash_index` ON `assertion_evidence` (`evidence_hash`);--> statement-breakpoint
CREATE TABLE `browser_sessions` (
	`run_id` text PRIMARY KEY NOT NULL,
	`provider_session_id` text NOT NULL,
	`region` text,
	`acquired_at` text NOT NULL,
	`released_at` text,
	`release_status` text NOT NULL,
	`release_confirmed` integer NOT NULL,
	`replay_status` text NOT NULL,
	`recording_requested` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_sessions_provider_session_unique` ON `browser_sessions` (`provider_session_id`);--> statement-breakpoint
CREATE INDEX `browser_sessions_release_index` ON `browser_sessions` (`release_status`);--> statement-breakpoint
CREATE TABLE `capability_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`details_json` text NOT NULL,
	`checked_at` text NOT NULL,
	`error_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_checks_kind_subject_unique` ON `capability_checks` (`kind`,`subject`);--> statement-breakpoint
CREATE INDEX `capability_checks_checked_at_index` ON `capability_checks` (`checked_at`);--> statement-breakpoint
CREATE TABLE `discovered_interfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`metadata_json` text NOT NULL,
	`discovered_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discovered_interfaces_run_index` ON `discovered_interfaces` (`run_id`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`specification_hash` text NOT NULL,
	`target_start_url` text NOT NULL,
	`allowed_navigation_origins_json` text NOT NULL,
	`prompt` text NOT NULL,
	`assertions_json` text NOT NULL,
	`config_json` text NOT NULL,
	`entity_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evaluations_status_created_index` ON `evaluations` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`cursor` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`run_id` text,
	`run_sequence` integer,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_event_id_unique` ON `events` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_run_sequence_unique` ON `events` (`run_id`,`run_sequence`);--> statement-breakpoint
CREATE INDEX `events_evaluation_cursor_index` ON `events` (`evaluation_id`,`cursor`);--> statement-breakpoint
CREATE TABLE `grade_results` (
	`run_id` text PRIMARY KEY NOT NULL,
	`evidence_hash` text NOT NULL,
	`outcome` text NOT NULL,
	`assertion_results_json` text NOT NULL,
	`graded_at` text NOT NULL,
	`result_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grade_results_outcome_index` ON `grade_results` (`outcome`);--> statement-breakpoint
CREATE TABLE `provider_create_attempts` (
	`run_id` text NOT NULL,
	`attempt_correlation_id` text NOT NULL,
	`status` text NOT NULL,
	`provider_session_id` text,
	`potential_session_leak` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`record_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_create_attempts_run_correlation_unique` ON `provider_create_attempts` (`run_id`,`attempt_correlation_id`);--> statement-breakpoint
CREATE INDEX `provider_create_attempts_unresolved_index` ON `provider_create_attempts` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`interaction_mode` text NOT NULL,
	`observation_revision` integer,
	`duration_ms` integer,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_steps_run_sequence_unique` ON `run_steps` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `run_steps_run_index` ON `run_steps` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`run_index` integer NOT NULL,
	`model_id` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`evidence_hash` text,
	`release_status` text NOT NULL,
	`potential_session_leak` integer NOT NULL,
	`entity_json` text NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_evaluation_run_index_unique` ON `runs` (`evaluation_id`,`run_index`);--> statement-breakpoint
CREATE INDEX `runs_evaluation_index` ON `runs` (`evaluation_id`);--> statement-breakpoint
CREATE INDEX `runs_status_index` ON `runs` (`status`);
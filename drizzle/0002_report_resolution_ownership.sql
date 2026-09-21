-- Consumes the committed social report-resolution schema at
-- 5c8ab78997497d5c2be26ba7c6a476b91b60d764. Original consumer migration:
-- apps/pokeforos/drizzle/0002_report_resolution_ownership.sql (unchanged SQL).
-- Additive: existing reports retain their data and a NULL operation link.
CREATE TABLE `report_resolution_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_version` text NOT NULL,
	`fingerprint` text NOT NULL,
	`report_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`verdict` text NOT NULL,
	`delete_content` integer NOT NULL,
	`outcome` text NOT NULL,
	`owns_effects` integer NOT NULL,
	`canonical_operation_id` text NOT NULL,
	`committed_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`canonical_operation_id`) REFERENCES `report_resolution_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `report_resolution_operations_id_check` CHECK(length(`id`) > 0 AND trim(`id`) = `id`),
	CONSTRAINT `report_resolution_operations_contract_check` CHECK(`contract_version` = 'report_resolution_v1'),
	CONSTRAINT `report_resolution_operations_fingerprint_check` CHECK(
		length(`fingerprint`) = 64
		AND `fingerprint` = lower(`fingerprint`)
		AND `fingerprint` NOT GLOB '*[^0-9a-f]*'
	),
	CONSTRAINT `report_resolution_operations_verdict_check` CHECK(`verdict` IN ('resolved', 'dismissed')),
	CONSTRAINT `report_resolution_operations_delete_content_check` CHECK(`delete_content` IN (0, 1)),
	CONSTRAINT `report_resolution_operations_committed_at_check` CHECK(
		typeof(`committed_at`) = 'integer' AND `committed_at` >= 0
	),
	CONSTRAINT `report_resolution_operations_takedown_check` CHECK(`verdict` = 'resolved' OR `delete_content` = 0),
	CONSTRAINT `report_resolution_operations_outcome_check` CHECK(
		(`outcome` = 'applied' AND `owns_effects` = 1 AND `canonical_operation_id` = `id`)
		OR (`outcome` = 'transition_conflict' AND `owns_effects` = 0 AND `canonical_operation_id` != `id`)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_resolution_operations_owner_idx`
ON `report_resolution_operations` (`report_id`) WHERE `owns_effects` = 1;
--> statement-breakpoint
CREATE INDEX `report_resolution_operations_report_committed_idx`
ON `report_resolution_operations` (`report_id`, `committed_at`, `id`);
--> statement-breakpoint
CREATE INDEX `report_resolution_operations_canonical_idx`
ON `report_resolution_operations` (`canonical_operation_id`);
--> statement-breakpoint
CREATE TABLE `report_resolution_effects` (
	`operation_id` text NOT NULL,
	`effect_type` text NOT NULL,
	`committed_at` integer NOT NULL,
	PRIMARY KEY (`operation_id`, `effect_type`),
	FOREIGN KEY (`operation_id`) REFERENCES `report_resolution_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `report_resolution_effects_type_check` CHECK(`effect_type` IN (
		'report_terminal_state',
		'verdict_audit',
		'content_takedown',
		'content_takedown_audit'
	)),
	CONSTRAINT `report_resolution_effects_committed_at_check` CHECK(
		typeof(`committed_at`) = 'integer' AND `committed_at` >= 0
	)
);
--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution_operation_id` text
REFERENCES `report_resolution_operations`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_resolution_operation_unique_idx`
ON `reports` (`resolution_operation_id`) WHERE `resolution_operation_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `report_resolution_operations_validate_insert`
BEFORE INSERT ON `report_resolution_operations`
BEGIN
	SELECT RAISE(ABORT, 'applied report resolution requires an open unclaimed report')
	WHERE NEW.`outcome` = 'applied'
		AND NOT EXISTS (
			SELECT 1 FROM `reports`
			WHERE `id` = NEW.`report_id`
				AND `status` = 'open'
				AND `resolution_operation_id` IS NULL
		);

	SELECT RAISE(ABORT, 'report resolution conflict must reference the canonical owner')
	WHERE NEW.`outcome` = 'transition_conflict'
		AND NOT EXISTS (
			SELECT 1 FROM `report_resolution_operations` AS canonical
			WHERE canonical.`id` = NEW.`canonical_operation_id`
				AND canonical.`report_id` = NEW.`report_id`
				AND canonical.`outcome` = 'applied'
				AND canonical.`owns_effects` = 1
				AND EXISTS (
					SELECT 1 FROM `reports` AS report
					WHERE report.`id` = canonical.`report_id`
						AND report.`resolution_operation_id` = canonical.`id`
				)
		);
END;
--> statement-breakpoint
CREATE TRIGGER `report_resolution_operations_no_update`
BEFORE UPDATE ON `report_resolution_operations`
BEGIN
	SELECT RAISE(ABORT, 'report_resolution_operations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `report_resolution_operations_no_delete`
BEFORE DELETE ON `report_resolution_operations`
BEGIN
	SELECT RAISE(ABORT, 'report_resolution_operations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `report_resolution_effects_validate_insert`
BEFORE INSERT ON `report_resolution_effects`
BEGIN
	SELECT RAISE(ABORT, 'report resolution effects require the canonical owner and commit time')
	WHERE NOT EXISTS (
		SELECT 1 FROM `report_resolution_operations` AS operation
		WHERE operation.`id` = NEW.`operation_id`
			AND operation.`outcome` = 'applied'
			AND operation.`owns_effects` = 1
			AND operation.`committed_at` = NEW.`committed_at`
	);

	SELECT RAISE(ABORT, 'content takedown effects require takedown intent')
	WHERE NEW.`effect_type` IN ('content_takedown', 'content_takedown_audit')
		AND NOT EXISTS (
			SELECT 1 FROM `report_resolution_operations` AS operation
			WHERE operation.`id` = NEW.`operation_id`
				AND operation.`delete_content` = 1
		);
END;
--> statement-breakpoint
CREATE TRIGGER `report_resolution_effects_no_update`
BEFORE UPDATE ON `report_resolution_effects`
BEGIN
	SELECT RAISE(ABORT, 'report_resolution_effects are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `report_resolution_effects_no_delete`
BEFORE DELETE ON `report_resolution_effects`
BEGIN
	SELECT RAISE(ABORT, 'report_resolution_effects are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `reports_validate_resolution_operation`
BEFORE UPDATE OF `resolution_operation_id` ON `reports`
WHEN NEW.`resolution_operation_id` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'report resolution ownership is immutable')
	WHERE OLD.`resolution_operation_id` IS NOT NULL;

	SELECT RAISE(ABORT, 'report terminal state does not match its resolution owner')
	WHERE OLD.`status` != 'open'
		OR NOT EXISTS (
			SELECT 1 FROM `report_resolution_operations` AS operation
			WHERE operation.`id` = NEW.`resolution_operation_id`
				AND operation.`report_id` = NEW.`id`
				AND operation.`outcome` = 'applied'
				AND operation.`owns_effects` = 1
				AND operation.`verdict` = NEW.`status`
				AND operation.`actor_id` = NEW.`resolved_by`
				AND operation.`committed_at` = NEW.`resolved_at`
				AND (SELECT count(*) FROM `report_resolution_effects` AS effect
					WHERE effect.`operation_id` = operation.`id`)
					= CASE operation.`delete_content` WHEN 1 THEN 4 ELSE 2 END
				AND EXISTS (SELECT 1 FROM `report_resolution_effects` AS effect
					WHERE effect.`operation_id` = operation.`id`
						AND effect.`effect_type` = 'report_terminal_state')
				AND EXISTS (SELECT 1 FROM `report_resolution_effects` AS effect
					WHERE effect.`operation_id` = operation.`id`
						AND effect.`effect_type` = 'verdict_audit')
		);
END;
--> statement-breakpoint
CREATE TRIGGER `reports_resolution_operation_no_unlink`
BEFORE UPDATE OF `resolution_operation_id` ON `reports`
WHEN OLD.`resolution_operation_id` IS NOT NULL AND NEW.`resolution_operation_id` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'report resolution ownership is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `reports_linked_resolution_no_update`
BEFORE UPDATE OF `status`, `resolved_by`, `resolved_at` ON `reports`
WHEN OLD.`resolution_operation_id` IS NOT NULL
	AND (
		NEW.`status` IS NOT OLD.`status`
		OR NEW.`resolved_by` IS NOT OLD.`resolved_by`
		OR NEW.`resolved_at` IS NOT OLD.`resolved_at`
	)
BEGIN
	SELECT RAISE(ABORT, 'linked report resolution is immutable');
END;

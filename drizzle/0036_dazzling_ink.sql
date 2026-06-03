ALTER TABLE `unit` ADD `display_fraction` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- One-time backfill for existing databases: spoon/cup units read naturally as
-- fractions. Fresh installs get this default via the seeder instead (the table
-- is empty here). Idempotent: re-running sets the same rows to the same value.
UPDATE `unit` SET `display_fraction` = 1 WHERE `name` IN ('TL', 'EL', 'Cup');
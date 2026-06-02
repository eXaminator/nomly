DROP INDEX `ingredient_alias_name_unique`;
--> statement-breakpoint
INSERT OR IGNORE INTO `app_setting` (`key`, `value`)
SELECT 'global_default_unit_id', CAST(`id` AS TEXT) FROM `unit` WHERE `name` = 'Stück' LIMIT 1;

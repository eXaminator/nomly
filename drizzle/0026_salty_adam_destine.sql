ALTER TABLE `ingredient_sub_unit` ADD `plural` text;--> statement-breakpoint
ALTER TABLE `unit` ADD `plural` text;--> statement-breakpoint
ALTER TABLE `unit_alias` ADD `plural` text;--> statement-breakpoint
--> Backfill sub-unit plurals from the suffix rule the parser previously
--> generated at runtime (e-ending -> +n, else -> +e), so existing sub-units
--> keep matching their plural in imports/reparse after that rule is removed.
UPDATE `ingredient_sub_unit`
SET `plural` = CASE WHEN lower(`name`) LIKE '%e' THEN `name` || 'n' ELSE `name` || 'e' END
WHERE `plural` IS NULL AND `name` <> '';
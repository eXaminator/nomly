ALTER TABLE `ingredient_alias` ADD `default_unit_id` integer REFERENCES `unit`(`id`) ON DELETE SET NULL;

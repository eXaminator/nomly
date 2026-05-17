CREATE TABLE `api_token` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_token_hash_unique` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_name_unique` ON `category` (`name`);--> statement-breakpoint
CREATE TABLE `category_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_alias_name_unique` ON `category_alias` (`name`);--> statement-breakpoint
CREATE TABLE `ical_feed` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`last_error_at` integer,
	`last_error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_category_id` integer,
	`exclude_from_shopping_list` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_name_unique` ON `ingredient` (`name`);--> statement-breakpoint
CREATE TABLE `ingredient_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingredient_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_alias_name_unique` ON `ingredient_alias` (`name`);--> statement-breakpoint
CREATE TABLE `meal_plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`date` text NOT NULL,
	`servings_override` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `meal_plan_date_idx` ON `meal_plan` (`date`);--> statement-breakpoint
CREATE TABLE `product` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_category_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_name_unique` ON `product` (`name`);--> statement-breakpoint
CREATE TABLE `product_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_alias_name_unique` ON `product_alias` (`name`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`source_url` text,
	`photo_path` text,
	`servings` integer DEFAULT 1 NOT NULL,
	`prep_time_min` integer,
	`cook_time_min` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipe_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`ingredient_id` integer NOT NULL,
	`quantity` real,
	`unit_id` integer,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `recipe_section`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_ingredient_section_idx` ON `recipe_ingredient` (`section_id`);--> statement-breakpoint
CREATE TABLE `recipe_section` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` integer NOT NULL,
	`title` text,
	`instructions` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_section_recipe_idx` ON `recipe_section` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_tag` (
	`recipe_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopping_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingredient_id` integer,
	`product_id` integer,
	`quantity` real,
	`unit_id` integer,
	`category_id` integer,
	`checked` integer DEFAULT false NOT NULL,
	`checked_at` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shopping_item_xor" CHECK(("shopping_item"."ingredient_id" IS NOT NULL AND "shopping_item"."product_id" IS NULL) OR ("shopping_item"."ingredient_id" IS NULL AND "shopping_item"."product_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `shopping_item_checked_idx` ON `shopping_item` (`checked`,`checked_at`);--> statement-breakpoint
CREATE TABLE `shopping_item_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`meal_plan_id` integer NOT NULL,
	`recipe_ingredient_id` integer NOT NULL,
	`contributed_quantity` real,
	`contributed_unit_id` integer,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_ingredient_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributed_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_item_source_item_idx` ON `shopping_item_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_item_source_meal_idx` ON `shopping_item_source` (`meal_plan_id`);--> statement-breakpoint
CREATE TABLE `supermarket` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supermarket_name_unique` ON `supermarket` (`name`);--> statement-breakpoint
CREATE TABLE `supermarket_category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supermarket_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`supermarket_id`) REFERENCES `supermarket`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supermarket_category_unique` ON `supermarket_category` (`supermarket_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `unit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`dimension` text NOT NULL,
	`base_unit_id` integer,
	`factor` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`base_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_name_unique` ON `unit` (`name`);--> statement-breakpoint
CREATE TABLE `unit_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_alias_name_unique` ON `unit_alias` (`name`);
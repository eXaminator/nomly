CREATE TABLE `recipe_favorite` (
	`user_id` integer NOT NULL,
	`recipe_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sub` text NOT NULL,
	`name` text NOT NULL,
	`last_login_at` integer DEFAULT (unixepoch()) NOT NULL,
	`favorites_seeded_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sub_unique` ON `user` (`sub`);
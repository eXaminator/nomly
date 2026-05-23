CREATE TABLE `ingredient_supermarket_unavailable` (
	`ingredient_id` integer NOT NULL,
	`supermarket_id` integer NOT NULL,
	PRIMARY KEY(`ingredient_id`, `supermarket_id`),
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supermarket_id`) REFERENCES `supermarket`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_supermarket_unavailable` (
	`product_id` integer NOT NULL,
	`supermarket_id` integer NOT NULL,
	PRIMARY KEY(`product_id`, `supermarket_id`),
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supermarket_id`) REFERENCES `supermarket`(`id`) ON UPDATE no action ON DELETE cascade
);

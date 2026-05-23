CREATE TABLE `shopping_item_amount` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`unit_id` integer,
	`quantity` real,
	`dimension` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_item_amount_dim_unique` ON `shopping_item_amount` (`item_id`,`dimension`);--> statement-breakpoint
CREATE INDEX `shopping_item_amount_item_idx` ON `shopping_item_amount` (`item_id`);--> statement-breakpoint
-- Backfill: lift existing `shopping_item.quantity/unit_id` (the previous
-- single-dimension manual override) into per-dimension rows. NULL unit_id
-- maps to dimension 'none' (unitless); a unit's own dimension otherwise.
INSERT INTO shopping_item_amount (item_id, unit_id, quantity, dimension)
SELECT
  si.id,
  si.unit_id,
  si.quantity,
  COALESCE(u.dimension, 'none')
FROM shopping_item si
LEFT JOIN unit u ON u.id = si.unit_id
WHERE si.quantity IS NOT NULL OR si.unit_id IS NOT NULL;--> statement-breakpoint
-- Clear the legacy columns so the new model is the single source of truth.
UPDATE shopping_item SET quantity = NULL, unit_id = NULL;
DROP INDEX `shopping_item_amount_dim_unique`;--> statement-breakpoint
-- Manual amounts now combine ADDITIVELY with source contributions (no longer
-- per-dimension overrides). Legacy override rows would silently double-count
-- under the new aggregator, so clear them — the user can re-edit amounts
-- they want to change (those edits now scale the underlying sources).
DELETE FROM shopping_item_amount;
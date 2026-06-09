import { z } from "zod";

/**
 * Canonical zod building blocks for ingredient ("article") creation, shared by
 * the `/ingredients/manage` upsert endpoint and the recipe-save / bulk-reparse
 * `newIngredientDefaults` payloads. Keeping them in one place stops the create
 * paths from drifting apart.
 */

export const aliasDefaultSchema = z.object({
  aliasName: z.string().min(1),
  unitId: z.number().int().positive().nullable().default(null),
  unitDisplay: z.string().nullable().default(null),
});

export const conversionSchema = z.object({
  fromUnitId: z.number().int().positive(),
  toUnitId: z.number().int().positive(),
  factor: z.number().positive(),
  isContainer: z.boolean().default(false),
});

/** Full create/update payload accepted by `POST /api/v1/ingredients/manage`. */
export const ingredientUpsertSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  aliasUnitDefaults: z.array(aliasDefaultSchema).default([]),
  aliasDisplayNames: z.record(z.string(), z.string()).default({}),
  conversions: z.array(conversionSchema).default([]),
  defaultUnitId: z.number().int().positive().nullable().default(null),
  defaultUnitDisplay: z.string().nullable().default(null),
  defaultCategoryId: z.number().int().positive().nullable(),
  excludeFromShoppingList: z.boolean(),
  isEquipment: z.boolean().default(false),
  dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable(),
  excludedSupermarketIds: z.array(z.number().int().positive()).default([]),
});

/**
 * The four "advanced" field groups a create flow can attach to a brand-new
 * ingredient (default unit, conversions, aliases + their per-alias unit/display,
 * excluded supermarkets). All optional with empty defaults so the minimal
 * create path and existing callers stay valid.
 */
export const advancedArticleFieldsShape = {
  aliases: z.array(z.string()).default([]),
  aliasUnitDefaults: z.array(aliasDefaultSchema).default([]),
  aliasDisplayNames: z.record(z.string(), z.string()).default({}),
  conversions: z.array(conversionSchema).default([]),
  defaultUnitId: z.number().int().positive().nullable().default(null),
  defaultUnitDisplay: z.string().nullable().default(null),
  excludedSupermarketIds: z.array(z.number().int().positive()).default([]),
} as const;

/**
 * Per-name defaults the recipe form / mass-parser collects for ingredients that
 * don't exist yet. The base metadata (category, diet, equipment, exclude) plus
 * the advanced field groups. Applied verbatim when the save inserts the row.
 */
export const newIngredientDefaultsSchema = z.object({
  name: z.string().min(1),
  defaultCategoryId: z.number().int().positive().nullable(),
  dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable(),
  excludeFromShoppingList: z.boolean(),
  isEquipment: z.boolean().default(false),
  ...advancedArticleFieldsShape,
});

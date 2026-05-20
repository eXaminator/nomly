import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  check,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const recipe = sqliteTable("recipe", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  sourceUrl: text("source_url"),
  photoPath: text("photo_path"),
  servings: integer("servings").notNull().default(1),
  prepTimeMin: integer("prep_time_min"),
  cookTimeMin: integer("cook_time_min"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const recipeSection = sqliteTable(
  "recipe_section",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    title: text("title"),
    instructions: text("instructions").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_section_recipe_idx").on(t.recipeId)],
);

export const unit = sqliteTable("unit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  dimension: text("dimension", { enum: ["mass", "volume", "count"] }).notNull(),
  baseUnitId: integer("base_unit_id").references((): AnySQLiteColumn => unit.id, {
    onDelete: "set null",
  }),
  factor: real("factor").notNull().default(1),
  /**
   * Set on units that describe a physical container (Dose, Glas, Tube,
   * Packung, Flasche, Karton, Schachtel). The ingredient parser uses this
   * to suppress conjunction-splitting and prep-word stripping when a
   * container is present — the trailing adjective is then part of the
   * product name ("1 Dose chopped tomatoes" rather than "chopped" as a
   * prep instruction).
   */
  isContainer: integer("is_container", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const unitAlias = sqliteTable("unit_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => unit.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
});

export const category = sqliteTable("category", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const categoryAlias = sqliteTable("category_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => category.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
});

export const ingredient = sqliteTable("ingredient", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  defaultCategoryId: integer("default_category_id").references(() => category.id, {
    onDelete: "set null",
  }),
  excludeFromShoppingList: integer("exclude_from_shopping_list", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * Diet classification used to derive recipe-level vegan/vegetarian flags.
   * NULL = unknown (user hasn't tagged this ingredient yet) and disqualifies
   * the recipe from being claimed as vegan or vegetarian. "vegan" implies
   * "vegetarian"; "meat" covers anything that is neither (fish, gelatin,
   * meat, etc.).
   */
  dietaryClass: text("dietary_class", {
    enum: ["vegan", "vegetarian", "meat"],
  }),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const ingredientAlias = sqliteTable("ingredient_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ingredientId: integer("ingredient_id")
    .notNull()
    .references(() => ingredient.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
});

export const product = sqliteTable("product", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  defaultCategoryId: integer("default_category_id").references(() => category.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const productAlias = sqliteTable("product_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id")
    .notNull()
    .references(() => product.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
});

export const recipeIngredient = sqliteTable(
  "recipe_ingredient",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sectionId: integer("section_id")
      .notNull()
      .references(() => recipeSection.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "restrict" }),
    /**
     * The name the user picked or typed for this row — e.g. "Tomaten" even
     * though `ingredient_id` points at the canonical "Tomate". The recipe
     * view uses this for display; the shopping-list merge logic uses
     * `ingredient_id` so aliased rows still merge with their canonical
     * counterparts.
     */
    displayName: text("display_name"),
    quantity: real("quantity"),
    unitId: integer("unit_id").references(() => unit.id, { onDelete: "set null" }),
    notes: text("notes"),
    /**
     * When true, this ingredient is "(optional) garnish"-style — the recipe
     * still works without it. The read view dims optional rows and the
     * shopping-list builder skips them when seeding from a meal plan.
     */
    isOptional: integer("is_optional", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recipe_ingredient_section_idx").on(t.sectionId)],
);

export const tag = sqliteTable("tag", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const recipeTag = sqliteTable(
  "recipe_tag",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.tagId] })],
);

export const mealPlan = sqliteTable(
  "meal_plan",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "restrict" }),
    date: text("date").notNull(), // ISO date YYYY-MM-DD
    servingsOverride: integer("servings_override"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("meal_plan_date_idx").on(t.date)],
);

export const supermarket = sqliteTable("supermarket", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const supermarketCategory = sqliteTable(
  "supermarket_category",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    supermarketId: integer("supermarket_id")
      .notNull()
      .references(() => supermarket.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("supermarket_category_unique").on(t.supermarketId, t.categoryId),
  ],
);

export const shoppingItem = sqliteTable(
  "shopping_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ingredientId: integer("ingredient_id").references(() => ingredient.id, {
      onDelete: "set null",
    }),
    productId: integer("product_id").references(() => product.id, {
      onDelete: "set null",
    }),
    quantity: real("quantity"),
    unitId: integer("unit_id").references(() => unit.id, { onDelete: "set null" }),
    categoryId: integer("category_id").references(() => category.id, {
      onDelete: "set null",
    }),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
    checkedAt: integer("checked_at"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    check(
      "shopping_item_xor",
      sql`(${t.ingredientId} IS NOT NULL AND ${t.productId} IS NULL) OR (${t.ingredientId} IS NULL AND ${t.productId} IS NOT NULL)`,
    ),
    index("shopping_item_checked_idx").on(t.checked, t.checkedAt),
  ],
);

export const shoppingItemSource = sqliteTable(
  "shopping_item_source",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => shoppingItem.id, { onDelete: "cascade" }),
    mealPlanId: integer("meal_plan_id")
      .notNull()
      .references(() => mealPlan.id, { onDelete: "cascade" }),
    recipeIngredientId: integer("recipe_ingredient_id")
      .notNull()
      .references(() => recipeIngredient.id, { onDelete: "cascade" }),
    contributedQuantity: real("contributed_quantity"),
    contributedUnitId: integer("contributed_unit_id").references(() => unit.id, {
      onDelete: "set null",
    }),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [
    index("shopping_item_source_item_idx").on(t.itemId),
    index("shopping_item_source_meal_idx").on(t.mealPlanId),
  ],
);

export const icalFeed = sqliteTable("ical_feed", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastFetchedAt: integer("last_fetched_at"),
  lastErrorAt: integer("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  createdAt: integer("created_at").notNull().default(now),
});

export const apiToken = sqliteTable("api_token", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull().default(now),
  revokedAt: integer("revoked_at"),
});

export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Recipe = typeof recipe.$inferSelect;
export type NewRecipe = typeof recipe.$inferInsert;
export type Ingredient = typeof ingredient.$inferSelect;
export type Unit = typeof unit.$inferSelect;
export type Category = typeof category.$inferSelect;
export type Supermarket = typeof supermarket.$inferSelect;
export type Product = typeof product.$inferSelect;
export type ShoppingItem = typeof shoppingItem.$inferSelect;
export type MealPlan = typeof mealPlan.$inferSelect;
export type ApiToken = typeof apiToken.$inferSelect;

import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
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
  /**
   * User flag: "this recipe needs a later edit" (a wrong amount, a missing
   * step, a photo to add …). Set/cleared from the recipe detail page; the
   * recipe list can filter to just the flagged ones. Purely a reminder — it
   * has no effect on parsing, planning or shopping.
   */
  needsUpdate: integer("needs_update", { mode: "boolean" })
    .notNull()
    .default(false),
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

/**
 * Bulk-reparse mute: suppress a recipe (raw_line NULL) or a single source line
 * (raw_line = the trimmed raw line) from the bulk-reparse scan, for diffs the
 * user has intentionally hand-handled. Keyed on (recipe_id, raw_line) — NOT a
 * recipe_ingredient id, because apply recreates rows while the raw source line
 * is stable. Permanent until removed; editing the line's raw text changes the
 * key (a new line resurfaces), and deleting the recipe cascades the mute.
 */
export const reparseMute = sqliteTable(
  "reparse_mute",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipe.id, { onDelete: "cascade" }),
    rawLine: text("raw_line"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("reparse_mute_recipe_idx").on(t.recipeId)],
);

export const unit = sqliteTable("unit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /**
   * Optional explicit plural of the canonical name ("Dose" → "Dosen"). When
   * set, it is matched against ingredient text alongside the singular and used
   * for display whenever the amount is not exactly 1. NULL = no plural; the
   * singular is shown for every amount.
   */
  plural: text("plural"),
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
  /**
   * When set, recipe read views render this unit's quantities as fractions
   * ("1/4 TL", "1 1/2 EL") instead of decimals. Display-only: storage stays decimal and
   * values that aren't close to a clean fraction fall back to the decimal
   * format. Natural for spoon/cup units; off by default for g/ml.
   */
  displayFraction: integer("display_fraction", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const unitAlias = sqliteTable("unit_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => unit.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
  /**
   * Optional explicit plural of this alias ("tablespoon" → "tablespoons").
   * Matched against ingredient text alongside the singular; when this alias is
   * the matched label, its plural is shown for any amount other than 1.
   */
  plural: text("plural"),
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
  /**
   * Canonical-name parser default unit. When a recipe line matches this
   * ingredient by its *canonical* name (not via an alias) and carries no
   * explicit unit, the parser substitutes this instead of the generic
   * "Stück" fallback. Resolution order: alias default → ingredient default →
   * "Stück".
   */
  defaultUnitId: integer("default_unit_id").references(() => unit.id, {
    onDelete: "set null",
  }),
  /**
   * Optional display spelling for {@link defaultUnitId} — a unit alias the user
   * picked instead of the canonical (e.g. "clove" for unit "Zehe"). When the
   * canonical-name default unit is applied, the recipe row's display_unit gets
   * this spelling. NULL = show the canonical unit name.
   */
  defaultUnitDisplay: text("default_unit_display"),
  excludeFromShoppingList: integer("exclude_from_shopping_list", { mode: "boolean" })
    .notNull()
    .default(false),
  /**
   * Set on items the user usually owns and has stock of (Backpapier,
   * Einmachgläser, Backform, Frischhaltefolie, …). The parser auto-marks
   * the resulting recipe row as `is_optional=true` so the user decides
   * per-recipe whether to actually shop the row. Equipment items still
   * appear on the shopping list when not marked optional — the flag only
   * shifts the *default* at recipe-create time. See the unified-items
   * design notes in docs/familywall-ingredient-merge.md.
   */
  isEquipment: integer("is_equipment", { mode: "boolean" })
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
  /**
   * NOT globally unique: two ingredients may share an alias (e.g. "tomatoes"
   * on both fresh Tomate and canned Dosentomate), disambiguated at match time
   * by the line's unit (see the unit decider in `findIngredientCandidates`).
   * Collisions are advisory — surfaced as a warning in the management UI, not
   * blocked. Canonical `ingredient.name` stays unique.
   */
  name: text("name").notNull(),
  /**
   * Per-alias default unit (global). Used when the parser hits this alias
   * with no explicit unit — e.g. "Knoblauchzehe" → "Zehe", "Olivenöl extra
   * virgin" → "ml".
   */
  defaultUnitId: integer("default_unit_id").references(() => unit.id, {
    onDelete: "set null",
  }),
  /**
   * Optional display spelling for {@link defaultUnitId} — a unit alias picked
   * instead of the canonical (e.g. "clove" for "Zehe"). Applied as the recipe
   * row's display_unit when this alias's default unit drives the row. NULL =
   * canonical unit name.
   */
  defaultUnitDisplay: text("default_unit_display"),
  /**
   * Optional rename applied when a recipe line matches THIS alias: the row's
   * display name becomes this instead of the alias text. Lets a unit-compound
   * alias drop its embedded unit — "Knoblauchzehe" (default unit Zehe) →
   * displayName "Knoblauch", so the line reads "3 Zehen Knoblauch" not
   * "3 Zehen Knoblauchzehe". NULL = show the matched alias verbatim (default).
   */
  displayName: text("display_name"),
});

/**
 * Per-ingredient unit conversion edge: `1 from_unit = factor × to_unit`.
 * Together with each unit's global dimension factor these form a graph the
 * shopping aggregator walks (see src/lib/units/convert.ts): contributions
 * normalize to a component's base unit and sum, then — when `is_container` is
 * set — the summed total is converted to the container unit (`from_unit`) and
 * rounded up ("buy whole packs"). Examples: `1 ml = 0,5 g` (density,
 * is_container=0); `1 Packung = 4 Stangen`, `1 Glas = 100 g`
 * (container, is_container=1).
 */
export const ingredientUnitConversion = sqliteTable(
  "ingredient_unit_conversion",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "cascade" }),
    fromUnitId: integer("from_unit_id")
      .notNull()
      .references(() => unit.id, { onDelete: "cascade" }),
    toUnitId: integer("to_unit_id")
      .notNull()
      .references(() => unit.id, { onDelete: "cascade" }),
    factor: real("factor").notNull(),
    isContainer: integer("is_container", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("ingredient_unit_conversion_unique").on(
      t.ingredientId,
      t.fromUnitId,
      t.toUnitId,
    ),
  ],
);

export const recipeIngredient = sqliteTable(
  "recipe_ingredient",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sectionId: integer("section_id")
      .notNull()
      .references(() => recipeSection.id, { onDelete: "cascade" }),
    /**
     * Canonical article this line points at. NULL marks an "unassigned" line
     * (the "Nicht zugeordnet" pill): free text that isn't a reusable article
     * and never reaches a shopping list (leftovers, garnish, things kept at
     * home). For these rows `display_name` carries the text and `sub_unit_id`
     * stays NULL. RESTRICT only bites when non-null.
     */
    ingredientId: integer("ingredient_id").references(() => ingredient.id, {
      onDelete: "restrict",
    }),
    /**
     * The name the user picked or typed for this row — e.g. "Tomaten" even
     * though `ingredient_id` points at the canonical "Tomate". The recipe
     * view uses this for display; the shopping-list merge logic uses
     * `ingredient_id` so aliased rows still merge with their canonical
     * counterparts. For unassigned lines (`ingredient_id` NULL) this is the
     * line's only text and is always set.
     */
    displayName: text("display_name"),
    quantity: real("quantity"),
    unitId: integer("unit_id").references(() => unit.id, { onDelete: "set null" }),
    /**
     * Mirror of `display_name` for units: when the source said "Tasse" but
     * the row resolves to canonical unit "Cup", `display_unit` preserves
     * "Tasse" for display. Shopping-list math still keys off `unit_id`.
     */
    displayUnit: text("display_unit"),
    notes: text("notes"),
    /**
     * When true, this ingredient is "(optional) garnish"-style — the recipe
     * still works without it. The read view dims optional rows and the
     * shopping-list builder skips them when seeding from a meal plan.
     */
    isOptional: integer("is_optional", { mode: "boolean" }).notNull().default(false),
    /**
     * When true, the ingredient's quantity does NOT scale with the planned
     * servings (e.g. "1 Prise Salz", "etwas Öl"). Shopping-list contributions
     * use the recipe's amount verbatim regardless of the meal's
     * `servings_override`. Auto-set on import for rows with no parsed quantity.
     */
    fixedAmount: integer("fixed_amount", { mode: "boolean" }).notNull().default(false),
    /**
     * Original source substring this row was parsed from — kept verbatim so
     * the edit UI can show the user what the parser was working from, the
     * same way the import-review screen surfaces it. Populated by importers
     * (URL + Familywall + clipboard paste); null for manually-added rows.
     */
    rawLine: text("raw_line"),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Self-referencing FK: when non-null, this row is an ALTERNATIVE for
     * the recipe_ingredient row with the given id. Alternatives are always
     * `isOptional = true`, sort immediately after their primary, and are
     * grouped under it in both the editor and the read-only view. Depth is
     * always exactly 1 — an alternative cannot itself have alternatives
     * (enforced in the service layer, not the DB).
     */
    alternativeForId: integer("alternative_for_id").references(
      (): AnySQLiteColumn => recipeIngredient.id,
      { onDelete: "cascade" },
    ),
  },
  (t) => [
    index("recipe_ingredient_section_idx").on(t.sectionId),
    index("recipe_ingredient_alternative_for_idx").on(t.alternativeForId),
  ],
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
    /**
     * "We're eating the same dish again" — a leftover day. A leftover meal is
     * skipped by the shopping-list builder and by the "when is this ingredient
     * next needed" timing (you cooked/bought for it on the original day), and
     * doesn't count toward recipe usage stats. It still shows on the plan,
     * muted and labelled.
     */
    isLeftover: integer("is_leftover", { mode: "boolean" })
      .notNull()
      .default(false),
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
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "cascade" }),
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
    index("shopping_item_checked_idx").on(t.checked, t.checkedAt),
  ],
);

/**
 * Additive manual amounts on a shopping item. Each row is its own
 * contribution — the aggregator sums these together with the per-meal
 * `shopping_item_source` contributions for the matching dimension.
 *
 * Multiple rows per (item, dimension) are allowed: the "Weitere Menge"
 * button always inserts a fresh row, and edits to displayed amounts
 * proportionally scale whatever's already in that dimension.
 */
export const shoppingItemAmount = sqliteTable(
  "shopping_item_amount",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references((): AnySQLiteColumn => shoppingItem.id, { onDelete: "cascade" }),
    unitId: integer("unit_id").references(() => unit.id, { onDelete: "set null" }),
    quantity: real("quantity"),
    /**
     * Persisted (not derived) so the aggregator can group without a unit
     * join. Must match `unit.dimension` when `unit_id` is set, else "none".
     */
    dimension: text("dimension", {
      enum: ["mass", "volume", "count", "none"],
    }).notNull(),
  },
  (t) => [index("shopping_item_amount_item_idx").on(t.itemId)],
);

/**
 * The "Auf Lager" (in‑stock) line of a shopping item — at most one row per
 * item (unique on `item_id`). The aggregator treats it as a *subtraction*:
 * the quantity is converted to the matching connected component's base unit
 * and removed from the summed total before containerization, clamped at zero.
 * Stock whose unit shares no component with a positive contribution is stored
 * and displayed as a position but has no effect on the total.
 */
export const shoppingItemStock = sqliteTable(
  "shopping_item_stock",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => shoppingItem.id, { onDelete: "cascade" }),
    quantity: real("quantity"),
    unitId: integer("unit_id").references(() => unit.id, { onDelete: "set null" }),
    /**
     * Persisted (not derived) so the aggregator can group without a unit join.
     * Must match `unit.dimension` when `unit_id` is set, else "none".
     */
    dimension: text("dimension", {
      enum: ["mass", "volume", "count", "none"],
    }).notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("shopping_item_stock_item_unique").on(t.itemId)],
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

export const stapleGroup = sqliteTable("staple_group", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const stapleGroupItem = sqliteTable(
  "staple_group_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .notNull()
      .references(() => stapleGroup.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "cascade" }),
    /**
     * Optional default quantity. NULL = no quantity preset; the add still
     * writes a `shopping_item_staple_source` row (with NULL quantity) so the
     * contribution is traceable, but it does not contribute to displayed
     * amounts.
     */
    quantity: real("quantity"),
    unitId: integer("unit_id").references(() => unit.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("staple_group_item_unique").on(t.groupId, t.ingredientId),
    index("staple_group_item_group_idx").on(t.groupId),
  ],
);

/**
 * Mirrors `shopping_item_source` for staple-group adds. One row per
 * "this shopping item received a contribution from this staple group".
 * The read-side aggregator sums these alongside meal sources and manual
 * amounts; the "Liste leeren" dialog groups by `staple_group_id` to offer
 * per-group removal.
 */
export const shoppingItemStapleSource = sqliteTable(
  "shopping_item_staple_source",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => shoppingItem.id, { onDelete: "cascade" }),
    stapleGroupId: integer("staple_group_id")
      .notNull()
      .references(() => stapleGroup.id, { onDelete: "cascade" }),
    /**
     * Nullable so removing a single staple-group entry doesn't retroactively
     * strip past contributions from the running list. The clear dialog
     * groups by `staple_group_id` regardless.
     */
    stapleGroupItemId: integer("staple_group_item_id").references(
      () => stapleGroupItem.id,
      { onDelete: "set null" },
    ),
    contributedQuantity: real("contributed_quantity"),
    contributedUnitId: integer("contributed_unit_id").references(() => unit.id, {
      onDelete: "set null",
    }),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [
    index("shopping_item_staple_source_item_idx").on(t.itemId),
    index("shopping_item_staple_source_group_idx").on(t.stapleGroupId),
  ],
);

/**
 * Marker rows: `(ingredient_id, supermarket_id)` means "this ingredient is
 * not carried at this supermarket". The shopping list renders matching items
 * in a muted bottom group when that supermarket is the active filter (spec
 * §6). Composite primary key — at most one row per pair.
 */
export const ingredientSupermarketUnavailable = sqliteTable(
  "ingredient_supermarket_unavailable",
  {
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredient.id, { onDelete: "cascade" }),
    supermarketId: integer("supermarket_id")
      .notNull()
      .references(() => supermarket.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ingredientId, t.supermarketId] })],
);

export const icalFeed = sqliteTable("ical_feed", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  rawIcs: text("raw_ics"),
  rawIcsFetchedAt: integer("raw_ics_fetched_at"),
  lastFetchedAt: integer("last_fetched_at"),
  lastErrorAt: integer("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
});

export const apiToken = sqliteTable("api_token", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  // Access scope. "full" tokens reach the whole API (the historical default,
  // so existing rows keep working). "embed" tokens are restricted to the
  // read-only embed allow-list (see proxy.ts) — used by the Home Assistant
  // recipe iframe, where the token must travel in the URL.
  scope: text("scope", { enum: ["full", "embed"] })
    .notNull()
    .default("full"),
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
export type ShoppingItem = typeof shoppingItem.$inferSelect;
export type MealPlan = typeof mealPlan.$inferSelect;
export type ApiToken = typeof apiToken.$inferSelect;
export type StapleGroup = typeof stapleGroup.$inferSelect;
export type StapleGroupItem = typeof stapleGroupItem.$inferSelect;
export type ShoppingItemStapleSource = typeof shoppingItemStapleSource.$inferSelect;
export type IcalFeed = typeof icalFeed.$inferSelect;
export type NewIcalFeed = typeof icalFeed.$inferInsert;

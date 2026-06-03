/**
 * Curated unit seed — the canonical list of units the app ships with.
 * Originally extracted from an external snapshot; now hand-edited and
 * checked into the repo as the single source of truth.
 *
 * Each entry's `name` is the canonical German unit; `aliases` carries the
 * English variants, plural forms, and recipe-source spellings the matcher
 * relies on. `dimension` + `factor` describe the unit's physical meaning
 * so conversions across the same dimension stay correct.
 *
 * App-specific extras (container units, niche measurements like Bund /
 * Handvoll) are layered on top via `topUpUnits` in `src/db/seed.ts`.
 */
export type SeedUnit = {
  /** Canonical (German) unit name written to the `unit.name` column. */
  name: string;
  /** Alias rows attached to the canonical. Mostly English variants and
   *  plural forms; the matcher hits any of these. Duplicates of `name`
   *  are tolerated — the seeder skips them. */
  aliases: string[];
  dimension: "mass" | "volume" | "count";
  /** Factor to the per-dimension base ("g" for mass, "ml" for volume,
   *  always 1 for count). Tandoor expressed this via `base_unit` strings;
   *  here we pre-compute the factor so the seeder doesn't need a lookup
   *  table at runtime. */
  factor: number;
  /** Default for the `display_fraction` flag at *insert* time only. Spoon/cup
   *  units read naturally as fractions ("1/4 TL"). The seeder never overwrites
   *  it on a re-run, so a user's later toggle in the unit UI is preserved. */
  displayFraction?: boolean;
};

export const SEED_UNITS: SeedUnit[] = [
  { name: "g", aliases: ["gram", "grams", "Gramm", "gramm", "gr", "gr."], dimension: "mass", factor: 1 },
  { name: "kg", aliases: ["kilogram", "kilograms", "Kilogramm", "kilogramm", "Kilo", "kilo"], dimension: "mass", factor: 1000 },
  { name: "oz", aliases: ["ounce", "ounces"], dimension: "mass", factor: 28.349523125 },
  { name: "lb", aliases: ["lbs", "Pfund", "pound", "pounds"], dimension: "mass", factor: 453.59237 },
  { name: "ml", aliases: ["milliliter", "milliliters", "Milliliter"], dimension: "volume", factor: 1 },
  { name: "l", aliases: ["liter", "liters", "Liter"], dimension: "volume", factor: 1000 },
  { name: "fl oz", aliases: [], dimension: "volume", factor: 29.5735295625 },
  { name: "EL", aliases: ["tbsp", "tbsps", "tablespoon", "tablespoons", "Esslöffel", "esslöffel", "Eßlöffel"], dimension: "volume", factor: 14.7867647813, displayFraction: true },
  { name: "TL", aliases: ["tl", "tsp", "tsps", "teaspoon", "teaspoons", "Teelöffel", "teelöffel"], dimension: "volume", factor: 4.92892159375, displayFraction: true },
  { name: "Cup", aliases: ["Cups", "cup", "cups", "Tasse", "tassen", "Tassen", "c.", "c"], dimension: "volume", factor: 236.5882365, displayFraction: true },
  { name: "Prise", aliases: ["Prisen", "pinch", "pinches"], dimension: "volume", factor: 1 },
  { name: "Dose", aliases: ["Dosen", "can", "cans"], dimension: "count", factor: 1 },
  { name: "Flasche", aliases: ["Flaschen", "Bottle", "Bottles", "bottle", "bottles"], dimension: "count", factor: 1 },
  { name: "Stück", aliases: ["pcs", "piece", "pieces"], dimension: "count", factor: 1 },
];

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  ingredient,
  ingredientSubUnit,
  recipe,
  recipeIngredient,
  recipeSection,
  unit,
} from "@/db/schema";
import {
  buildIngredientCatalog,
  buildIngredientLookup,
  buildSubUnitLookup,
  buildUnitLookup,
  parseIngredientLines,
} from "@/lib/recipe-import";
import type { ParsedIngredientResponse } from "@/components/recipes/types";
import type {
  RecipeIngredientInput,
  RecipeInput,
  RecipeView,
} from "@/lib/recipes/types";

/**
 * Bulk re-parse: scan every recipe's ingredient source lines with the current
 * parser, surface only the line-groups whose output differs from what's
 * stored, and (on apply) rebuild affected recipes through the normal update
 * path. See docs/superpowers/specs/2026-05-30-bulk-reparse-recipes-design.md.
 */

/** Current (stored) ingredient row, reduced to the fields that decide whether
 *  a re-parse would change anything. */
export type CurrentRow = {
  id: number;
  ingredientId: number | null;
  name: string;
  quantity: number | null;
  unitId: number | null;
  subUnitId: number | null;
  notes: string | null;
  isOptional: boolean;
  alternativeForId: number | null;
};

const QTY_EPSILON = 1e-4;

function normNotes(n: string | null | undefined): string {
  return (n ?? "").trim();
}

function qtyEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < QTY_EPSILON;
}

/** Comparison key for a current row — every field except quantity (compared
 *  separately with an epsilon). */
function currentKey(r: CurrentRow): string {
  return JSON.stringify([
    r.ingredientId ?? null,
    r.name.trim(),
    normNotes(r.notes),
    r.unitId ?? null,
    r.subUnitId ?? null,
    r.isOptional,
    r.alternativeForId != null,
  ]);
}

/** Comparison key for a freshly-parsed row, aligned field-for-field with
 *  {@link currentKey}. */
function proposedKey(p: ParsedIngredientResponse): string {
  return JSON.stringify([
    p.ingredientId ?? null,
    p.name.trim(),
    normNotes(p.notes),
    p.unit?.id ?? null,
    p.subUnit?.id ?? null,
    p.isOptional ?? false,
    p.isAlternative ?? false,
  ]);
}

/**
 * True when the freshly parsed rows differ from the current rows on any
 * meaningful field — ingredient mapping, display name, notes, quantity,
 * unit / sub-unit, optional flag, alternative flag — or in row count.
 */
export function isLineGroupChanged(
  current: CurrentRow[],
  proposed: ParsedIngredientResponse[],
): boolean {
  if (current.length !== proposed.length) return true;
  for (let i = 0; i < current.length; i++) {
    if (currentKey(current[i]) !== proposedKey(proposed[i])) return true;
    if (!qtyEqual(current[i].quantity, proposed[i].quantity)) return true;
  }
  return false;
}

/**
 * Split rows (already ordered by recipe → section → sortOrder) into the
 * contiguous runs that share a non-empty `rawLine` within the same section.
 * A run breaks on a section change or a different `rawLine`.
 *
 * A row with an empty `rawLine` that is an alternative (`alternativeForId`
 * pointing into the run directly above it) is a manually-added alternative —
 * it carries no source line because the user created it in the editor, not by
 * parsing text. It's absorbed into its primary's group so the reparse dialog
 * can show and preserve it. Any other empty-`rawLine` row (no alternative
 * linkage) is dropped — there's nothing to re-parse.
 */
export function groupContiguousByRawLine<
  T extends {
    sectionId: number;
    rawLine: string | null;
    id?: number;
    alternativeForId?: number | null;
  },
>(rows: readonly T[]): T[][] {
  const groups: T[][] = [];
  let i = 0;
  while (i < rows.length) {
    const raw = (rows[i].rawLine ?? "").trim();
    if (raw.length === 0) {
      // Manually-added alternative: attach to the group of the primary it
      // links to (which sits immediately above it in sort order).
      const last = groups[groups.length - 1];
      const altFor = rows[i].alternativeForId;
      if (
        last &&
        altFor != null &&
        last[0].sectionId === rows[i].sectionId &&
        last.some((r) => r.id === altFor)
      ) {
        last.push(rows[i]);
      }
      i += 1;
      continue;
    }
    const group: T[] = [];
    const sectionId = rows[i].sectionId;
    while (
      i < rows.length &&
      rows[i].sectionId === sectionId &&
      (rows[i].rawLine ?? "").trim() === raw
    ) {
      group.push(rows[i]);
      i += 1;
    }
    groups.push(group);
  }
  return groups;
}

/** Compact read-only summary of a current row for the review UI. */
export type ScanRowSummary = {
  /** Catalog ingredient id this row resolves to (null = unassigned). The diff
   *  compares this against the proposed row's id to decide whether the mapping
   *  actually changed — a label that only differs in casing/alias is NOT a
   *  change. */
  ingredientId: number | null;
  name: string;
  canonicalName: string | null;
  quantity: number | null;
  unitLabel: string | null;
  notes: string | null;
  isOptional: boolean;
  isAlternative: boolean;
};

/** One changed source-line group within a recipe. */
export type ReparseScanEntry = {
  recipeId: number;
  title: string;
  sectionId: number;
  rawLine: string;
  /** recipe_ingredient ids of the current group — the apply target. */
  currentRowIds: number[];
  current: ScanRowSummary[];
  proposed: ParsedIngredientResponse[];
};

/**
 * Build the `proposed` representation of a manually-added alternative. It has
 * no source line to re-parse, so it's mirrored straight from its stored row
 * and carried through the diff/apply unchanged. `rawText` stays undefined so
 * it re-persists as a manual alternative (empty rawLine) on the next scan,
 * making the round-trip stable.
 */
function carriedAlternativeToProposed(g: {
  ingredientId: number | null;
  name: string | null;
  canonicalName: string | null;
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  displayUnit: string | null;
  subUnitId: number | null;
  subUnitName: string | null;
  notes: string | null;
}): ParsedIngredientResponse {
  return {
    quantity: g.quantity,
    unit:
      g.unitId != null
        ? { id: g.unitId, name: g.displayUnit ?? g.unitName ?? "" }
        : null,
    subUnit:
      g.subUnitId != null
        ? { id: g.subUnitId, name: g.subUnitName ?? "", perPurchase: 1 }
        : null,
    unitMatch: "matched",
    rawUnit: null,
    name: g.name ?? "",
    ingredientId: g.ingredientId,
    ingredientMatch: g.ingredientId != null ? "existing" : "new",
    canonicalIngredientName: g.canonicalName ?? null,
    notes: g.notes,
    isOptional: true,
    isAlternative: true,
    fixedAmount: g.quantity == null,
  };
}

/**
 * Existing alternatives in a scanned group that the re-parse does NOT
 * reproduce, so they must be carried through unchanged — otherwise applying a
 * change to the ingredient silently trims its alternative unit. Two sources:
 *
 *  - **Manual** alternatives (empty rawLine): never produced by parsing. Kept
 *    unless the parser now produces the same ingredient on its own (avoids a
 *    duplicate / phantom diff once the parser catches up to a hand-add).
 *  - **Surplus source-line** alternatives: the parser's output replaces the
 *    source-line rows (primary + in-source alternatives) positionally. When
 *    re-parsing yields FEWER rows than the group's source-line rows, the
 *    trailing alternatives have no counterpart and would be deleted on apply,
 *    so they're carried. Source-line alternatives the parser DOES still
 *    produce are left to it — that's how a re-map of an alternative applies.
 *
 * `group` is sort-order-ordered (primary first); `proposedCount` is the number
 * of rows the re-parse produced for the line.
 */
export function carriedAlternatives<
  T extends {
    rawLine: string | null;
    alternativeForId?: number | null;
    ingredientId: number | null;
  },
>(
  group: readonly T[],
  proposedCount: number,
  derivedIngredientIds: ReadonlySet<number>,
): T[] {
  const sourceRows = group.filter((g) => (g.rawLine ?? "").trim().length > 0);
  const manualRows = group.filter((g) => (g.rawLine ?? "").trim().length === 0);
  const droppedSource = sourceRows
    .slice(proposedCount)
    .filter((g) => g.alternativeForId != null);
  const carriedManual = manualRows.filter(
    (g) =>
      g.alternativeForId != null &&
      (g.ingredientId == null || !derivedIngredientIds.has(g.ingredientId)),
  );
  return [...droppedSource, ...carriedManual];
}

/**
 * Scan every recipe. For each contiguous source-line group, re-parse the line
 * with the current parser and keep only groups whose output differs from the
 * stored rows. One DB read for all ingredient rows; parsing is in-process.
 */
export function scanAllRecipesForReparse(): ReparseScanEntry[] {
  const lookups = {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
    ingredientCatalog: buildIngredientCatalog(),
    subUnits: buildSubUnitLookup(),
  };
  const rows = db
    .select({
      recipeId: recipe.id,
      title: recipe.title,
      sectionId: recipeSection.id,
      sectionSort: recipeSection.sortOrder,
      id: recipeIngredient.id,
      sortOrder: recipeIngredient.sortOrder,
      ingredientId: recipeIngredient.ingredientId,
      name: recipeIngredient.displayName,
      canonicalName: ingredient.name,
      quantity: recipeIngredient.quantity,
      unitId: recipeIngredient.unitId,
      unitName: unit.name,
      displayUnit: recipeIngredient.displayUnit,
      subUnitId: recipeIngredient.subUnitId,
      subUnitName: ingredientSubUnit.name,
      notes: recipeIngredient.notes,
      isOptional: recipeIngredient.isOptional,
      alternativeForId: recipeIngredient.alternativeForId,
      rawLine: recipeIngredient.rawLine,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(recipe, eq(recipe.id, recipeSection.recipeId))
    .leftJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    .leftJoin(
      ingredientSubUnit,
      eq(ingredientSubUnit.id, recipeIngredient.subUnitId),
    )
    .orderBy(
      asc(recipe.id),
      asc(recipeSection.sortOrder),
      asc(recipeSection.id),
      asc(recipeIngredient.sortOrder),
    )
    .all();

  const entries: ReparseScanEntry[] = [];
  for (const group of groupContiguousByRawLine(rows)) {
    const head = group[0];
    const rawLine = (head.rawLine ?? "").trim();
    const current: CurrentRow[] = group.map((g) => ({
      id: g.id,
      ingredientId: g.ingredientId,
      name: g.name ?? "",
      quantity: g.quantity,
      unitId: g.unitId,
      subUnitId: g.subUnitId,
      notes: g.notes,
      isOptional: g.isOptional,
      alternativeForId: g.alternativeForId,
    }));
    const proposedDerived = parseIngredientLines(
      [rawLine],
      lookups,
    ) as unknown as ParsedIngredientResponse[];
    // A line that now reads as noise (no rows) shouldn't propose deleting a
    // real ingredient — skip it (mirrors the per-row re-parse guard).
    if (proposedDerived.length === 0) continue;
    // Alternatives the re-parse doesn't reproduce (manual ones, or in-source
    // ones the parser no longer extracts) are carried through unchanged on
    // BOTH sides, so the whole alternative unit survives a reparse instead of
    // being silently trimmed on apply. See {@link carriedAlternatives}.
    const derivedIds = new Set(
      proposedDerived
        .map((p) => p.ingredientId)
        .filter((id): id is number => id != null),
    );
    const carried = carriedAlternatives(
      group,
      proposedDerived.length,
      derivedIds,
    ).map(carriedAlternativeToProposed);
    const proposed = [...proposedDerived, ...carried];
    if (!isLineGroupChanged(current, proposed)) continue;
    entries.push({
      recipeId: head.recipeId,
      title: head.title,
      sectionId: head.sectionId,
      rawLine,
      currentRowIds: group.map((g) => g.id),
      current: group.map((g) => ({
        ingredientId: g.ingredientId,
        name: g.name ?? "",
        canonicalName: g.canonicalName ?? null,
        quantity: g.quantity,
        // Match the recipe read view: display_unit, then the canonical unit
        // name, then the sub-unit name.
        unitLabel: g.displayUnit ?? g.unitName ?? g.subUnitName ?? null,
        notes: g.notes,
        isOptional: g.isOptional,
        isAlternative: g.alternativeForId != null,
      })),
      proposed,
    });
  }
  return entries;
}

/** One line-group replacement: the current rows to drop (by id) and the new
 *  rows to insert in their place. */
export type ReparseReplacement = {
  replaceRowIds: number[];
  rows: RecipeIngredientInput[];
};

function viewRowToInput(
  v: RecipeView["sections"][number]["ingredients"][number],
): RecipeIngredientInput {
  const hasSubUnit = v.subUnitId != null;
  return {
    ingredientName: v.ingredientName,
    ingredientId: v.ingredientId,
    unassigned: v.ingredientId == null,
    addAsAlias: false,
    quantity: v.quantity,
    unitId: hasSubUnit ? null : v.unitId,
    subUnitId: v.subUnitId,
    displayUnit: hasSubUnit ? null : v.unitName,
    notes: v.notes,
    isOptional: v.isOptional,
    fixedAmount: v.fixedAmount,
    rawLine: v.rawLine,
    isAlternative: v.alternativeForId != null,
  };
}

/**
 * Rebuild a recipe's {@link RecipeInput} from its current {@link RecipeView},
 * substituting each replacement's row-group (matched by the first present id
 * in `replaceRowIds`) with the replacement's `rows`, and mapping every other
 * row through unchanged. Order and sections are preserved; replaced rows keep
 * their `rawLine` (the caller carries it on the new rows). A replacement whose
 * ids are all absent from the recipe is counted in `skipped` and ignored.
 */
export function buildReparsedRecipeInput(
  view: RecipeView,
  replacements: ReparseReplacement[],
): { input: RecipeInput; appliedGroups: number; skipped: number } {
  // Map each current row id → the replacement that owns it.
  const byRowId = new Map<number, ReparseReplacement>();
  for (const rep of replacements) {
    for (const id of rep.replaceRowIds) byRowId.set(id, rep);
  }
  const applied = new Set<ReparseReplacement>();

  const sections = view.sections.map((section) => {
    const ingredients: RecipeIngredientInput[] = [];
    for (const row of section.ingredients) {
      const rep = byRowId.get(row.id);
      if (rep) {
        // First row of this group we encounter → emit the replacement once.
        if (!applied.has(rep)) {
          applied.add(rep);
          for (const r of rep.rows) ingredients.push(r);
        }
        // Skip the current row either way (it belongs to a replaced group).
        continue;
      }
      ingredients.push(viewRowToInput(row));
    }
    return {
      title: section.title,
      instructions: section.instructions,
      ingredients,
    };
  });

  const input: RecipeInput = {
    title: view.title,
    description: view.description,
    servings: view.servings,
    prepTimeMin: view.prepTimeMin,
    cookTimeMin: view.cookTimeMin,
    sourceUrl: view.sourceUrl,
    photoPath: view.photoPath,
    tags: view.tags,
    sections,
  };
  return {
    input,
    appliedGroups: applied.size,
    skipped: replacements.length - applied.size,
  };
}

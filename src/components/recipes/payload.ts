import type { DraftIngredient } from "./types";

/** Parse a draft's freeform numeric input ("1,5") into a number or null. */
export function toNumberOrNull(raw: string): number | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the row is in range mode but the low bound is missing, non-numeric,
 * or not strictly below the high bound. Used to show an inline error and block
 * save. A non-range row is never a range error.
 */
export function rangeError(ing: DraftIngredient): boolean {
  if (!ing.isRange) return false;
  const low = toNumberOrNull(ing.quantityLow);
  const high = toNumberOrNull(ing.quantity);
  if (low === null || high === null) return true;
  return low >= high;
}

/**
 * Map a {@link DraftIngredient} (form / pill-UI state) to the recipe-ingredient
 * payload the server's recipe-update path expects. Returns null when the row
 * has no usable name. Shared by the recipe form and the bulk re-parse dialog so
 * both produce identical row inputs.
 */
export function ingredientToPayload(ing: DraftIngredient) {
  const name = ing.name.trim();
  if (name.length === 0) return null;
  // "Nicht zugeordnet": free-text line with no article. Drop the ingredient
  // link and alias intent; the server persists ingredient_id NULL with `name`
  // as display_name.
  return {
    ingredientName: name,
    ingredientId: ing.unassigned ? null : ing.selectedIngredientId,
    unassigned: ing.unassigned,
    addAsAlias: ing.unassigned ? false : ing.addAsAlias,
    quantity: toNumberOrNull(ing.quantity),
    // Only carry the low bound when the row is explicitly in range mode.
    quantityLow: ing.isRange ? toNumberOrNull(ing.quantityLow) : null,
    unitId: ing.unit?.id ?? null,
    displayUnit: ing.unit?.name ?? null,
    notes: ing.notes.trim() || null,
    isOptional: ing.isOptional,
    fixedAmount: ing.fixedAmount,
    // Round-trip the source line so the resulting row stays re-parseable.
    rawLine: ing.rawText ?? null,
    isAlternative: ing.isAlternative,
  };
}

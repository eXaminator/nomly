import type { DraftIngredient } from "./types";

/** Parse a draft's freeform numeric input ("1,5") into a number or null. */
export function toNumberOrNull(raw: string): number | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
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
  // link, alias intent and any sub-unit (sub-units are article-scoped); the
  // server persists ingredient_id NULL with `name` as display_name.
  const hasSubUnit = ing.subUnit !== null && !ing.unassigned;
  return {
    ingredientName: name,
    ingredientId: ing.unassigned ? null : ing.selectedIngredientId,
    unassigned: ing.unassigned,
    addAsAlias: ing.unassigned ? false : ing.addAsAlias,
    quantity: toNumberOrNull(ing.quantity),
    unitId: hasSubUnit ? null : ing.unit?.id ?? null,
    subUnitId: hasSubUnit ? ing.subUnit!.id : null,
    displayUnit: hasSubUnit ? null : ing.unit?.name ?? null,
    notes: ing.notes.trim() || null,
    isOptional: ing.isOptional,
    fixedAmount: ing.fixedAmount,
    // Round-trip the source line so the resulting row stays re-parseable.
    rawLine: ing.rawText ?? null,
    isAlternative: ing.isAlternative,
  };
}

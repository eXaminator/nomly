import type { DraftIngredient } from "./types";

/** Parse a draft's freeform numeric input ("1,5") into a number or null. */
export function toNumberOrNull(raw: string): number | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * A quantifier the amount field can resolve typed text against. Mirrors the
 * `GET /api/v1/quantifiers` payload shape: canonical name, optional numeric
 * value (null for vague ones like "einige"), and accepted aliases.
 */
export type AmountQuantifier = {
  id: number;
  name: string;
  value: number | null;
  aliases: string[];
};

/** Result of resolving the amount input against the quantifier list. */
export type AmountResolution = {
  /** The numeric quantity string to keep on the draft (empty for a quantifier
   *  or for empty/invalid input). */
  quantity: string;
  /** The resolved quantifier id, or null when the input is numeric/empty/invalid. */
  quantifierId: number | null;
  /** False only for non-empty text that is neither a number nor a known
   *  quantifier — the form blocks save while a row is invalid. */
  valid: boolean;
};

/**
 * Resolve what the user typed in the amount field to either a numeric quantity
 * or a quantifier reference. The single place that interprets the amount input:
 *   - empty/whitespace   → valid, no amount (quantity "", quantifierId null).
 *   - parses as a number → numeric quantity (text kept verbatim), id cleared.
 *   - matches a known quantifier name/alias (case-insensitive, trimmed) → its
 *     id, numeric quantity cleared.
 *   - anything else      → invalid (quantity "", id null, valid false).
 * Numbers win over quantifier matching, so a digit string is never re-read as a
 * word-form quantifier.
 */
export function resolveAmountInput(
  text: string,
  quantifiers: readonly AmountQuantifier[],
): AmountResolution {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { quantity: "", quantifierId: null, valid: true };
  }
  if (toNumberOrNull(trimmed) !== null) {
    // Keep the user's spelling ("2,5" stays "2,5") — the numeric parse happens
    // later at the payload boundary.
    return { quantity: text, quantifierId: null, valid: true };
  }
  const key = trimmed.toLowerCase();
  for (const q of quantifiers) {
    if (q.name.toLowerCase() === key) {
      return { quantity: "", quantifierId: q.id, valid: true };
    }
    if (q.aliases.some((a) => a.toLowerCase() === key)) {
      return { quantity: "", quantifierId: q.id, valid: true };
    }
  }
  return { quantity: "", quantifierId: null, valid: false };
}

/**
 * True when this row's amount input can't be interpreted — a non-empty value
 * that is neither numeric nor a known quantifier. Blocks save the same way a
 * {@link rangeError} does. A quantifier-backed row (id already set, displayed
 * as its name) is valid by construction. Empty is always valid (no amount).
 */
export function amountInputError(
  ing: DraftIngredient,
  quantifiers: readonly AmountQuantifier[],
): boolean {
  // A row already carrying a quantifier reference is valid: its quantity string
  // holds the quantifier wording, which would not parse as a number.
  if (ing.quantifierId != null) return false;
  return !resolveAmountInput(ing.quantity, quantifiers).valid;
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
  //
  // The persisted invariant: a row's amount is EITHER a literal number OR a
  // quantifier reference, never both. When a quantifier is set, the reference
  // wins and we emit quantity/quantityLow as null (the draft may still carry
  // a numeric `quantity` string from the import-preview convenience, where a
  // numeric quantifier like "zwei" sets both — we collapse it here).
  const hasQuantifier = ing.quantifierId != null;
  return {
    ingredientName: name,
    ingredientId: ing.unassigned ? null : ing.selectedIngredientId,
    unassigned: ing.unassigned,
    addAsAlias: ing.unassigned ? false : ing.addAsAlias,
    quantity: hasQuantifier ? null : toNumberOrNull(ing.quantity),
    // Only carry the low bound when the row is explicitly in range mode (and
    // not a quantifier row, where the reference wins).
    quantityLow:
      hasQuantifier || !ing.isRange ? null : toNumberOrNull(ing.quantityLow),
    quantifierId: ing.quantifierId,
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

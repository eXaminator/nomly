import type { ParsedIngredientResponse } from "@/components/recipes/types";

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
 * Rows with an empty `rawLine` are dropped (nothing to re-parse). A run breaks
 * on a section change or a different `rawLine`.
 */
export function groupContiguousByRawLine<
  T extends { sectionId: number; rawLine: string | null },
>(rows: readonly T[]): T[][] {
  const groups: T[][] = [];
  let i = 0;
  while (i < rows.length) {
    const raw = (rows[i].rawLine ?? "").trim();
    if (raw.length === 0) {
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

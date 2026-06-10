import type { CatalogBlockIndex, IngredientCatalog } from "../matching";
import { lex } from "./lexer";
import { renderNote, tidyNote, type Leaf } from "./render-notes";
import { applyOptional } from "./passes/optional";
import { applyPrepNoun } from "./passes/prep-noun";
import { applyAmountUnit } from "./passes/amount-unit";
import { applyMatch } from "./passes/match-ingredient";

/** The structured result of parsing one ingredient segment (no alternatives /
 *  conjunctions yet — that's the segmentation layer). A subset of
 *  ImportedIngredient; unit-id resolution + candidate lists are layered on by
 *  the orchestrator that has the lookups. */
export type ParsedRow = {
  quantity: number | null;
  unitName: string | null;
  name: string;
  canonicalName: string | null;
  ingredientId: number | null;
  sourceName: string | null;
  notes: string | null;
  isOptional: boolean;
  fixedAmount: boolean;
  matched: boolean;
};

export type SegmentLookups = {
  knownUnitTokens: ReadonlySet<string>;
  catalog: IngredientCatalog;
  catalogIndex?: CatalogBlockIndex;
  threshold?: number;
};

/**
 * Compose a row's notes: the range expression (with its unit) leads, then the
 * verbatim remainder. e.g. "100-200 g" + "fein" → "100-200 g, fein".
 */
function assembleNotes(
  rangeExpression: string | null,
  unitName: string | null,
  rendered: string | null,
): string | null {
  if (!rangeExpression) return rendered;
  const rangeFrag = unitName ? `${rangeExpression} ${unitName}` : rangeExpression;
  if (!rendered) return tidyNote(rangeFrag);
  // With a unit the range reads as a measurement ("2-3 cups, for frying" —
  // comma); without one it glues to a trailing modifier ("5-6 große").
  const sep = unitName ? ", " : " ";
  return tidyNote(`${rangeFrag}${sep}${rendered}`);
}

/** Parse one ingredient segment into a structured row. */
export function parseSegment(source: string, lookups: SegmentLookups): ParsedRow {
  const leaves: Leaf[] = lex(source).map((t) => ({ ...t }));
  const isOptional = applyOptional(leaves);
  // Prep noun ("Juice of …") runs before the amount pass so the quantity that
  // follows the dropped connector is still found; its text leads the notes.
  const prepNote = applyPrepNoun(leaves);
  const { quantity, unitName, rangeExpression } = applyAmountUnit(
    source,
    leaves,
    lookups.knownUnitTokens,
  );
  const m = applyMatch(source, leaves, lookups.catalog, {
    index: lookups.catalogIndex,
    threshold: lookups.threshold,
  });
  const rendered = renderNote(source, leaves);
  const baseNotes = assembleNotes(rangeExpression, unitName, rendered);
  const notes = prepNote
    ? tidyNote([prepNote, baseNotes].filter((s) => s != null && s.length > 0).join(", "))
    : baseNotes;
  return {
    quantity,
    unitName,
    name: m.name,
    canonicalName: m.canonicalName,
    ingredientId: m.ingredientId,
    sourceName: m.sourceName,
    notes,
    isOptional,
    fixedAmount: quantity === null,
    matched: m.matched,
  };
}

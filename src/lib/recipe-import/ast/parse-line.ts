import type {
  CatalogBlockIndex,
  IngredientCatalog,
} from "../matching";
import type { ImportedCandidateMatch, ImportedNameProposal } from "../index";
import type { HighlightPart } from "../source-ranges";
import { lex } from "./lexer";
import { renderNote, tidyNote, type Leaf } from "./render-notes";
import { renderHighlights } from "./render-highlights";
import { applyLeadingNoise } from "./passes/leading-noise";
import { applyOptional } from "./passes/optional";
import { applyPluralMarkers } from "./passes/plural-marker";
import { applyPrepNoun, applyLeadingNotePhrase } from "./passes/prep-noun";
import { applyAmountUnit } from "./passes/amount-unit";
import { applyColonAmount } from "./passes/colon-amount";
import { applyMatch } from "./passes/match-ingredient";
import { collapseRedundantParens } from "./passes/redundant-parens";

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
  isEquipment: boolean;
  defaultUnit: { id: number; name: string } | null;
  candidateMatches: ImportedCandidateMatch[];
  newNameProposals: ImportedNameProposal[];
  /** Categorised highlight spans for the row's own segment, relative to the
   *  piece source (the caller rebases onto the full line). */
  highlightParts: HighlightPart[];
};

export type SegmentLookups = {
  knownUnitTokens: ReadonlySet<string>;
  /** Container units (Dose/can/package…). When the segment carries one, the
   *  matcher keeps a leading prep adjective in the name ("crushed tomatoes")
   *  rather than peeling it to the notes — the adjective is part of the canned
   *  product. */
  containerTokens?: ReadonlySet<string>;
  catalog: IngredientCatalog;
  catalogIndex?: CatalogBlockIndex;
  threshold?: number;
  /** Resolve the line's unit id from its (raw) name + quantity — the matcher's
   *  canned-vs-fresh decider. Injected by the caller (closure over the unit
   *  lookup) to avoid an index.ts import cycle. */
  lineUnitId?: (unitName: string | null, quantity: number | null) => number | null;
};

/**
 * Compose a row's notes: the range expression (with its unit) leads, then the
 * verbatim remainder. e.g. "100-200 g" + "fein" → "100-200 g, fein".
 */
function assembleNotes(
  rangeExpression: string | null,
  unitName: string | null,
  rendered: string | null,
  rangeSep: ", " | " ",
): string | null {
  if (!rangeExpression) return rendered;
  const rangeFrag = unitName ? `${rangeExpression} ${unitName}` : rangeExpression;
  if (!rendered) return tidyNote(rangeFrag);
  // With a unit the range reads as a measurement ("2-3 cups, for frying" —
  // comma). Without one the separator depends on what sat between the range and
  // the remainder: a comma if a CONTENT token (the ingredient) was removed
  // there ("4-5 scallions, finely sliced" → "4-5, finely sliced"), a space if
  // the remainder abuts the range directly ("5-6 große").
  const sep = unitName ? ", " : rangeSep;
  return tidyNote(`${rangeFrag}${sep}${rendered}`);
}

/**
 * The separator between a unitless range note and the verbatim remainder: a
 * comma when a consumed CONTENT token (ingredient/unit/marker) was skipped
 * between the range's last amount leaf and the first surviving note leaf;
 * otherwise a space. Mirrors the note rule "a removed token is a comma
 * boundary, unless it's a fully-ignored paren".
 */
function rangeNoteSeparator(source: string, leaves: readonly Leaf[]): ", " | " " {
  let lastAmountEnd = -1;
  for (const lf of leaves) {
    if (lf.role === "amount") lastAmountEnd = Math.max(lastAmountEnd, lf.end);
  }
  if (lastAmountEnd < 0) return " ";
  const isIgnored = (lf: Leaf): boolean =>
    ((lf.kind === "open" || lf.kind === "close") && lf.depth === 0 && !lf.bracket) ||
    ((lf.kind === "open" || lf.kind === "close") && lf.bracket);
  let firstNoteStart = Number.POSITIVE_INFINITY;
  for (const lf of leaves) {
    if (lf.start < lastAmountEnd) continue;
    if (lf.consumed || isIgnored(lf)) continue;
    firstNoteStart = lf.start;
    break;
  }
  if (!Number.isFinite(firstNoteStart)) return " ";
  for (const lf of leaves) {
    if (lf.start < lastAmountEnd || lf.end > firstNoteStart) continue;
    if (
      lf.consumed &&
      (lf.role === "ingredient" ||
        lf.role === "unit" ||
        lf.role === "optional-marker" ||
        lf.role === "connector")
    ) {
      return ", ";
    }
  }
  return " ";
}

/** Parse one ingredient segment into a structured row by lexing the source. A
 *  convenience wrapper over {@link parseLeaves} for callers that have only a
 *  string; the segmentation layer lexes the whole line ONCE and calls
 *  parseLeaves per segment instead. */
export function parseSegment(source: string, lookups: SegmentLookups): ParsedRow {
  return parseLeaves(source, lex(source).map((t) => ({ ...t })), lookups);
}

/**
 * Parse one ingredient segment from its already-lexed leaves into a structured
 * row. `source` is the FULL original line (leaf offsets index into it, so the
 * note/highlight renderers slice it directly); `leaves` is this segment's slice
 * of the leaf array. Every transformation is an in-place AST annotation, never
 * a source rewrite, so leaf offsets stay faithful to the input. The lexer has
 * already run (exactly once for the whole line) before this is called.
 */
export function parseLeaves(
  source: string,
  leaves: Leaf[],
  lookups: SegmentLookups,
): ParsedRow {
  // Annotate (don't rewrite) inline plural markers "Tomate(n)" → dropped.
  applyPluralMarkers(leaves);
  // Drop leading punctuation/symbol noise ("+ 100 ml", "*Pfeffer", "▢ …").
  applyLeadingNoise(leaves);
  const isOptional = applyOptional(leaves);
  // Prep noun ("Juice of …") runs before the amount pass so the quantity that
  // follows the dropped connector is still found; its text leads the notes.
  const prepNote = applyPrepNoun(leaves);
  // A leading fixed note phrase before the amount ("Nach Belieben 1 Eigelb") —
  // moved to the notes so the amount pass reaches the quantity behind it.
  const leadNote = applyLeadingNotePhrase(leaves);
  // The inverted "Name: qty unit" form extracts its amount from after the colon
  // in place; otherwise the normal leading-amount pass runs.
  const { quantity, unitName, rangeExpression } =
    applyColonAmount(source, leaves, lookups.knownUnitTokens) ??
    applyAmountUnit(source, leaves, lookups.knownUnitTokens);
  // Does the segment carry a container unit? Scans THIS segment's word leaves
  // (not the whole line) so a container in a sibling segment doesn't leak in.
  const hasContainer =
    lookups.containerTokens != null &&
    lookups.containerTokens.size > 0 &&
    leaves.some(
      (lf) => lf.kind === "word" && lookups.containerTokens!.has(lf.text.toLowerCase()),
    );
  const m = applyMatch(source, leaves, lookups.catalog, {
    index: lookups.catalogIndex,
    threshold: lookups.threshold,
    quantity,
    lineUnitId: lookups.lineUnitId?.(unitName, quantity) ?? null,
    units: lookups.knownUnitTokens,
    hasContainer,
  });
  // Flatten redundant "double" parens ("((1 1/4 cups))") before the note/
  // highlight renderers so the surviving single layer unwraps normally.
  collapseRedundantParens(leaves);
  const rendered = renderNote(source, leaves);
  const baseNotes = assembleNotes(
    rangeExpression,
    unitName,
    rendered,
    rangeNoteSeparator(source, leaves),
  );
  // Note prefixes captured before the amount (prep noun, leading note phrase)
  // lead the assembled notes, in source order.
  const prefixes = [prepNote, leadNote].filter((s) => s != null && s.length > 0);
  const notes = prefixes.length
    ? tidyNote([...prefixes, baseNotes].filter((s) => s != null && s.length > 0).join(", "))
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
    isEquipment: m.isEquipment,
    defaultUnit: m.defaultUnit,
    candidateMatches: m.candidateMatches,
    // The "Aufgeräumt" proposal's notes should match the row's assembled notes
    // (range/prep prefix included), not just the bare render.
    newNameProposals: m.newNameProposals.map((p, i) =>
      i === 0 ? { ...p, notes } : p,
    ),
    // Highlights fall out of the annotated leaf roles (one source of truth).
    highlightParts: renderHighlights(source, leaves),
  };
}

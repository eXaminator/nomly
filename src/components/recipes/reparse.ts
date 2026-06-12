import {
  parsedIngredientToDraft,
  type DraftIngredient,
  type ParsedIngredientResponse,
} from "./types";

/**
 * Re-parse helpers for the recipe editor. Each row carries the original
 * source line it was parsed from (`rawText`); these run that line back
 * through the current parser so the row(s) reflect parser improvements — or
 * revert manual edits. Rows without a `rawText` (manually added, or never
 * imported) are left untouched.
 */

/** POST the lines to the re-parse endpoint. Returns parsed rows per line,
 *  parallel to the input (a line may expand into a primary + alternatives).
 *  `forceFoldRanges` (parallel to `lines`) folds the given alternative ranges
 *  into their primary's note instead of emitting rows. */
type Range = readonly [number, number];

async function reparseLines(
  lines: string[],
  directives?: {
    forceFoldRanges?: ReadonlyArray<ReadonlyArray<Range>>;
    forceEmitRanges?: ReadonlyArray<ReadonlyArray<Range>>;
  },
): Promise<ParsedIngredientResponse[][]> {
  if (lines.length === 0) return [];
  const r = await fetch("/api/v1/ingredients/reparse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines, ...directives }),
  });
  if (!r.ok) throw new Error("re-parse request failed");
  const data = (await r.json()) as { results: ParsedIngredientResponse[][] };
  return data.results;
}

/**
 * Delete an alternative row by RE-PARSING its source line with that
 * alternative folded into the primary's note — the note is regenerated purely
 * by the parser (no client-side string folding). Replaces the whole group of
 * rows that share the deleted row's `rawText`. Returns `null` when the row has
 * no source line/range to fold (e.g. a manually-added alternative); the caller
 * should fall back to a plain remove.
 */
const rangeKey = (r: Range): string => `${r[0]},${r[1]}`;

/** Bounds [start,end] of the contiguous run of rows sharing `rawText`. */
function groupBounds(
  ingredients: readonly DraftIngredient[],
  index: number,
  rawText: string,
): [number, number] {
  let start = index;
  let end = index;
  while (start - 1 >= 0 && ingredients[start - 1].rawText?.trim() === rawText) start -= 1;
  while (end + 1 < ingredients.length && ingredients[end + 1].rawText?.trim() === rawText) end += 1;
  return [start, end];
}

/**
 * Re-parse the source line behind a row's group, with the set of alternatives
 * the user wants AS ROWS adjusted by `change` (emit a folded range, or remove a
 * row), then replace the group. The note is regenerated entirely by the parser.
 *
 * Default disposition per alternative: a MATCHED one is a row, an UNMATCHED one
 * folds. We recover that from a clean parse, then express the user's deviations
 * as forceEmit (unmatched ranges they kept as rows) and forceFold (matched
 * ranges they removed) — so chips and deletes compose without clobbering.
 */
async function reparseGroupWithChange(
  ingredients: readonly DraftIngredient[],
  anchorIndex: number,
  change: { emit?: Range; removeRange?: Range },
): Promise<DraftIngredient[] | null> {
  const rawText = ingredients[anchorIndex]?.rawText?.trim();
  if (!rawText) return null;
  const [start, end] = groupBounds(ingredients, anchorIndex, rawText);
  // Alternative ranges currently shown AS ROWS in the group.
  const emitted = new Set<string>();
  for (let i = start; i <= end; i++) {
    const r = ingredients[i].sourceRange;
    if (ingredients[i].isAlternative && r) emitted.add(rangeKey(r));
  }
  if (change.emit) emitted.add(rangeKey(change.emit));
  if (change.removeRange) emitted.delete(rangeKey(change.removeRange));
  // Clean-parse to learn the default disposition of every alternative.
  const [clean] = await reparseLines([rawText]);
  const emittedByDefault = (clean ?? [])
    .filter((p) => p.isAlternative && p.sourceRange)
    .map((p) => p.sourceRange as Range);
  const foldedByDefault = (clean ?? []).flatMap((p) => p.foldedAlternatives ?? []).map((f) => f.range);
  // forceEmit: unmatched (default-fold) ranges the user wants as rows.
  const forceEmit = foldedByDefault.filter((r) => emitted.has(rangeKey(r)));
  // forceFold: matched (default-emit) ranges the user removed.
  const forceFold = emittedByDefault.filter((r) => !emitted.has(rangeKey(r)));
  const [parsed] = await reparseLines([rawText], {
    forceEmitRanges: [forceEmit],
    forceFoldRanges: [forceFold],
  });
  const drafts = (parsed ?? []).map(parsedIngredientToDraft);
  if (drafts.length === 0) return null;
  const out = ingredients.slice();
  out.splice(start, end - start + 1, ...drafts);
  return out;
}

/** Delete an alternative row: re-parse the line with it folded (and any prior
 *  folds preserved). Returns null when the row has no source line to re-parse. */
export async function reparseDeletingAlternative(
  ingredients: readonly DraftIngredient[],
  index: number,
): Promise<DraftIngredient[] | null> {
  const row = ingredients[index];
  if (!row?.rawText?.trim() || !row.sourceRange) return null;
  const next = await reparseGroupWithChange(ingredients, index, {
    removeRange: row.sourceRange,
  });
  if (next) return next;
  // Parser yielded nothing — fall back to a plain remove.
  const out = ingredients.slice();
  out.splice(index, 1);
  return out;
}

/** Promote a folded alternative (a "create alternative" chip) to its own row:
 *  re-parse the primary's line with that range force-emitted. */
export async function reparsePromotingAlternative(
  ingredients: readonly DraftIngredient[],
  primaryIndex: number,
  range: Range,
): Promise<DraftIngredient[] | null> {
  if (!ingredients[primaryIndex]?.rawText?.trim()) return null;
  return reparseGroupWithChange(ingredients, primaryIndex, { emit: range });
}

/** True when at least one row has an original source line to re-parse. */
export function hasReparsableRows(ingredients: readonly DraftIngredient[]): boolean {
  return ingredients.some((i) => Boolean(i.rawText?.trim()));
}

/**
 * Re-parse the contiguous run of rows that share the clicked row's `rawText`
 * (alternatives expanded from one source line share it), returning a new
 * ingredient list with that run replaced by the freshly parsed rows. When the
 * row has no `rawText`, or the parser yields nothing, the list is returned
 * unchanged.
 */
export async function reparseGroupAt(
  ingredients: readonly DraftIngredient[],
  index: number,
): Promise<DraftIngredient[]> {
  const rawText = ingredients[index]?.rawText?.trim();
  if (!rawText) return ingredients.slice();
  let start = index;
  let end = index;
  while (start - 1 >= 0 && ingredients[start - 1].rawText?.trim() === rawText) {
    start -= 1;
  }
  while (
    end + 1 < ingredients.length &&
    ingredients[end + 1].rawText?.trim() === rawText
  ) {
    end += 1;
  }
  const [parsed] = await reparseLines([rawText]);
  const drafts = (parsed ?? []).map(parsedIngredientToDraft);
  const out = ingredients.slice();
  // Parser produced nothing (e.g. a line that reads as noise now) — keep the
  // existing row(s) rather than silently deleting them.
  if (drafts.length === 0) return out;
  out.splice(start, end - start + 1, ...drafts);
  return out;
}

type Segment =
  | { kind: "keep"; index: number }
  | { kind: "reparse"; rawText: string; indices: number[] };

/**
 * Re-parse every row that has a `rawText`, preserving order and passing
 * rows without one through unchanged. Contiguous rows sharing a `rawText`
 * (an alternative group from one source line) are re-parsed together as a
 * single line.
 */
export async function reparseAll(
  ingredients: readonly DraftIngredient[],
): Promise<DraftIngredient[]> {
  const segments: Segment[] = [];
  ingredients.forEach((ing, i) => {
    const rawText = ing.rawText?.trim();
    if (!rawText) {
      segments.push({ kind: "keep", index: i });
      return;
    }
    const last = segments[segments.length - 1];
    if (last && last.kind === "reparse" && last.rawText === rawText) {
      last.indices.push(i);
    } else {
      segments.push({ kind: "reparse", rawText, indices: [i] });
    }
  });
  const reparseSegs = segments.filter(
    (s): s is Extract<Segment, { kind: "reparse" }> => s.kind === "reparse",
  );
  if (reparseSegs.length === 0) return ingredients.slice();
  const results = await reparseLines(reparseSegs.map((s) => s.rawText));
  const out: DraftIngredient[] = [];
  let ri = 0;
  for (const seg of segments) {
    if (seg.kind === "keep") {
      out.push(ingredients[seg.index]);
      continue;
    }
    const drafts = (results[ri] ?? []).map(parsedIngredientToDraft);
    ri += 1;
    if (drafts.length === 0) {
      // Keep the originals when the parser yields nothing for this line.
      for (const idx of seg.indices) out.push(ingredients[idx]);
    } else {
      out.push(...drafts);
    }
  }
  return out;
}

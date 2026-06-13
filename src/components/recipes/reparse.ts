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

/** Whether the row at `idx` is a conjunction main — a main (non-alternative)
 *  row that shares its source line with at least one OTHER main ("Salz und
 *  Pfeffer"). Deleting one of these folds it into a sibling (like an
 *  alternative); a lone main, or an alternatives primary (whose line-mates are
 *  alternatives, not mains), is not one. */
export function isConjunctionMember(
  rows: readonly DraftIngredient[],
  idx: number,
): boolean {
  const row = rows[idx];
  const raw = row?.rawText?.trim();
  if (!row || row.isAlternative || !raw) return false;
  return rows.some(
    (r, j) => j !== idx && !r.isAlternative && r.rawText?.trim() === raw,
  );
}

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
 * Re-parse the source line behind a row's group, with the set of MEMBERS the
 * user wants AS ROWS adjusted by `change` (emit a folded range, or remove a
 * row), then replace the group. The note is regenerated entirely by the parser.
 * A "member" is any row from the line with a `sourceRange` — an alternative OR a
 * conjunction main ("Salz und Pfeffer").
 *
 * Default disposition: a MATCHED alternative and every conjunction main are
 * rows; an UNMATCHED alternative folds (chip). We recover that from a clean
 * parse, then express the user's deviations as forceEmit (default-fold ranges
 * they kept as rows) and forceFold (default-emit ranges they removed) — so chips
 * and deletes compose without clobbering. The alternatives primary always stays
 * a row (it's never the removed range here), so it's never force-folded.
 */
async function reparseGroupWithChange(
  ingredients: readonly DraftIngredient[],
  anchorIndex: number,
  change: { emit?: Range; removeIndex?: number },
): Promise<DraftIngredient[] | null> {
  const rawText = ingredients[anchorIndex]?.rawText?.trim();
  if (!rawText) return null;
  const [start, end] = groupBounds(ingredients, anchorIndex, rawText);
  // Clean-parse to learn the canonical members of the line + their default
  // disposition. Rows loaded from a SAVED recipe carry no sourceRange (it's
  // parse-session only), so we resolve a row's range from its position within
  // the group against the clean parse's members.
  const [clean] = await reparseLines([rawText]);
  const cleanMembers = (clean ?? [])
    .filter((p) => p.sourceRange)
    .map((p) => p.sourceRange as Range);
  const rangeOf = (i: number): Range | null =>
    ingredients[i].sourceRange ?? cleanMembers[i - start] ?? null;
  // Member ranges currently shown AS ROWS in the group (mains + alternatives).
  const emitted = new Set<string>();
  for (let i = start; i <= end; i++) {
    const r = rangeOf(i);
    if (r) emitted.add(rangeKey(r));
  }
  if (change.emit) emitted.add(rangeKey(change.emit));
  if (change.removeIndex != null) {
    const r = rangeOf(change.removeIndex);
    if (r) emitted.delete(rangeKey(r));
  }
  const emittedByDefault = cleanMembers;
  // Default-fold ranges include BOTH unmatched alternatives and unmatched
  // coordinated-list ingredient members ("+ add ingredient" pills) — promoting
  // either force-emits its range; the parser emits it with the role its segment
  // carries (alternative vs main).
  const foldedByDefault = (clean ?? [])
    .flatMap((p) => [...(p.foldedAlternatives ?? []), ...(p.foldedIngredients ?? [])])
    .map((f) => f.range);
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

/** Delete a member row (an alternative, or a conjunction main): re-parse the
 *  line with it folded into a sibling's note (and any prior folds preserved),
 *  leaving a chip to re-add it. Returns null when the row has no source line. */
export async function reparseDeletingAlternative(
  ingredients: readonly DraftIngredient[],
  index: number,
): Promise<DraftIngredient[] | null> {
  const row = ingredients[index];
  // Needs a source line to re-parse; the range is resolved inside (sourceRange
  // when present, else positional against the clean parse for saved rows).
  if (!row?.rawText?.trim()) return null;
  const next = await reparseGroupWithChange(ingredients, index, {
    removeIndex: index,
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

/** Promote a folded INGREDIENT (a "+ add ingredient" pill) to its own MAIN row:
 *  re-parse the primary's line with that range force-emitted. Identical to
 *  {@link reparsePromotingAlternative} — the parser emits the range with the role
 *  its segment carries, which for a coordinated-list member is a main. Named
 *  separately so the UI wiring reads clearly. */
export async function reparsePromotingIngredient(
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

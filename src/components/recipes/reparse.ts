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
async function reparseLines(
  lines: string[],
  forceFoldRanges?: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): Promise<ParsedIngredientResponse[][]> {
  if (lines.length === 0) return [];
  const r = await fetch("/api/v1/ingredients/reparse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(forceFoldRanges ? { lines, forceFoldRanges } : { lines }),
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
const rangeKey = (r: readonly [number, number]): string => `${r[0]},${r[1]}`;

export async function reparseDeletingAlternative(
  ingredients: readonly DraftIngredient[],
  index: number,
): Promise<DraftIngredient[] | null> {
  const row = ingredients[index];
  const rawText = row?.rawText?.trim();
  const delRange = row?.sourceRange;
  if (!rawText || !delRange) return null;
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
  // Alternatives the user is KEEPING in this group (present rows minus the one
  // being deleted), by source-range. Everything else from the line folds —
  // including alternatives folded by a PREVIOUS delete (which are no longer
  // rows here), so they don't reappear.
  const kept = new Set<string>();
  for (let i = start; i <= end; i++) {
    const r = ingredients[i].sourceRange;
    if (i !== index && ingredients[i].isAlternative && r) kept.add(rangeKey(r));
  }
  // Clean-parse the line to recover the full set of alternative ranges, then
  // fold every one the user isn't keeping.
  const [clean] = await reparseLines([rawText]);
  const foldRanges = (clean ?? [])
    .filter((p) => p.isAlternative && p.sourceRange)
    .map((p) => p.sourceRange as [number, number])
    .filter((r) => !kept.has(rangeKey(r)));
  const [parsed] = await reparseLines([rawText], [foldRanges]);
  const drafts = (parsed ?? []).map(parsedIngredientToDraft);
  const out = ingredients.slice();
  // Parser yielded nothing (shouldn't happen with a folded alt, but be safe):
  // just drop the deleted row rather than wiping the group.
  if (drafts.length === 0) {
    out.splice(index, 1);
    return out;
  }
  out.splice(start, end - start + 1, ...drafts);
  return out;
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

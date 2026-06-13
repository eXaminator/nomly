import { emptyAlternative, emptyIngredient, type DraftIngredient } from "./types";

/**
 * Pure helpers for the primary/alternative grouping of a draft ingredient
 * list. Alternatives always sit directly after their primary (a depth-1
 * invariant the server write path also assumes), so a "group" is a primary
 * row plus the run of `isAlternative` rows immediately below it.
 *
 * Every mutator returns a NEW array and never mutates its input, so callers
 * can feed the result straight into their state setter. Shared by the recipe
 * section editor and the bulk-reparse edit panel so both behave identically.
 */

/** Row index of the primary that owns the row at `idx` (itself if primary). */
export function findPrimaryIndex(
  rows: readonly DraftIngredient[],
  idx: number,
): number {
  let j = idx;
  while (j > 0 && rows[j].isAlternative) j -= 1;
  return j;
}

/** Index of the LAST row in the group rooted at `primaryIdx`. */
export function lastInGroup(
  rows: readonly DraftIngredient[],
  primaryIdx: number,
): number {
  let j = primaryIdx;
  while (j + 1 < rows.length && rows[j + 1].isAlternative) j += 1;
  return j;
}

/** Insert a fresh empty alternative at the end of the group containing
 *  `afterIdx`. */
export function addAlternativeAfter(
  rows: readonly DraftIngredient[],
  afterIdx: number,
): DraftIngredient[] {
  const primaryIdx = findPrimaryIndex(rows, afterIdx);
  const insertAt = lastInGroup(rows, primaryIdx) + 1;
  const next = rows.slice();
  next.splice(insertAt, 0, emptyAlternative());
  return next;
}

/** Insert a fresh empty MAIN row immediately after the group containing
 *  `afterIdx`. Carries no `rawText` — a manual, non-reparsable addition that
 *  the group reparse treats as a pass-through row (see reparse reconciliation).
 *  Used by the "add ingredient" control. */
export function addMainAfter(
  rows: readonly DraftIngredient[],
  afterIdx: number,
): DraftIngredient[] {
  const primaryIdx = findPrimaryIndex(rows, afterIdx);
  const insertAt = lastInGroup(rows, primaryIdx) + 1;
  const next = rows.slice();
  // Remember the group's source line (display-only) so the manual row can show
  // a read-only "Aus Zeile:" hint + best-effort highlight of the typed name.
  const fromLine = rows[primaryIdx]?.rawText?.trim() || undefined;
  next.splice(insertAt, 0, { ...emptyIngredient(), manualFromLine: fromLine });
  return next;
}

/**
 * Swap an alternative with its primary: the alternative becomes the new
 * primary; the old primary becomes an alternative alongside any siblings. The
 * group stays intact, just under a different leader. No-op if `altIdx` is
 * already a primary.
 */
export function promoteAlternative(
  rows: readonly DraftIngredient[],
  altIdx: number,
): DraftIngredient[] {
  const next = rows.slice();
  const primaryIdx = findPrimaryIndex(next, altIdx);
  if (primaryIdx === altIdx) return next;
  const promoted: DraftIngredient = {
    ...next[altIdx],
    isAlternative: false,
    // Inherit the old primary's optional status so the recipe's shape is
    // preserved (a required pair stays required after the swap).
    isOptional: next[primaryIdx].isOptional,
  };
  const demoted: DraftIngredient = {
    ...next[primaryIdx],
    isAlternative: true,
    // Old primary becomes an alternative — alternatives are always optional.
    isOptional: true,
  };
  const lastIdx = lastInGroup(next, primaryIdx);
  const siblings = next
    .slice(primaryIdx + 1, lastIdx + 1)
    .filter((_, k) => primaryIdx + 1 + k !== altIdx);
  next.splice(primaryIdx, lastIdx - primaryIdx + 1, promoted, demoted, ...siblings);
  return next;
}

/**
 * Detach an alternative: it becomes a standalone primary positioned right
 * after the old group's last sibling. The previous primary and any remaining
 * siblings stay grouped. No-op if `altIdx` is already a primary.
 */
export function detachAlternative(
  rows: readonly DraftIngredient[],
  altIdx: number,
): DraftIngredient[] {
  const primaryIdx = findPrimaryIndex(rows, altIdx);
  if (primaryIdx === altIdx) return rows.slice();
  const next = rows.slice();
  const lastInOldGroup = lastInGroup(next, primaryIdx);
  const [row] = next.splice(altIdx, 1);
  // After the splice the old group's last sibling shifted left by one, so
  // inserting at `lastInOldGroup` lands the row immediately after the group.
  next.splice(lastInOldGroup, 0, { ...row, isAlternative: false });
  return next;
}

/**
 * Reorder an alternative WITHIN its own group. `fromIdx` must point at an
 * alternative; `toIdx` is the desired destination index, clamped to the
 * group's alternative range (after the primary, up to the last sibling) so a
 * drag can never cross into a neighbouring group nor displace the primary.
 * Mirrors dnd-kit's `arrayMove` semantics. No-op on a primary row.
 */
export function moveAlternativeWithinGroup(
  rows: readonly DraftIngredient[],
  fromIdx: number,
  toIdx: number,
): DraftIngredient[] {
  const next = rows.slice();
  if (!next[fromIdx]?.isAlternative) return next;
  const primaryIdx = findPrimaryIndex(next, fromIdx);
  const altStart = primaryIdx + 1;
  const altEnd = lastInGroup(next, primaryIdx);
  const to = Math.max(altStart, Math.min(altEnd, toIdx));
  if (to === fromIdx) return next;
  next.splice(to, 0, next.splice(fromIdx, 1)[0]);
  return next;
}

/**
 * Demote a primary into an alternative of the row immediately above it. No-op
 * when it's the first row, already an alternative, or has its own alternatives
 * (which {@link canDemote} guards against to keep the depth-1 invariant).
 */
export function demoteToAlternative(
  rows: readonly DraftIngredient[],
  idx: number,
): DraftIngredient[] {
  const next = rows.slice();
  if (!canDemote(next, idx)) return next;
  next[idx] = { ...next[idx], isAlternative: true, isOptional: true };
  return next;
}

/** Whether the row at `idx` may be demoted into the previous group. */
export function canDemote(
  rows: readonly DraftIngredient[],
  idx: number,
): boolean {
  return idx > 0 && !rows[idx].isAlternative && lastInGroup(rows, idx) === idx;
}

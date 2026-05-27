export type DeleteMode = "hard" | "replace";

/**
 * Pick the delete dialog's mode once a row's usage (impact) is known.
 *
 * When nothing references the row, deletion is always safe, so we default to a
 * plain delete ("hard") regardless of `hardDeleteAllowed` — otherwise an unused
 * article (which has no replacement to pick, and whose replace UI is hidden)
 * would leave the delete button permanently disabled.
 *
 * When the row IS referenced, require a replacement unless the entity allows a
 * force-delete (`hardDeleteAllowed`).
 */
export function initialDeleteMode(
  anyRefs: boolean,
  hardDeleteAllowed: boolean,
): DeleteMode {
  if (!anyRefs) return "hard";
  return hardDeleteAllowed ? "hard" : "replace";
}

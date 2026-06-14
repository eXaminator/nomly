import type { QuantifierLookup, QuantifierLookupEntry } from "../../index";
import { type Group } from "../tokens";

const norm = (s: string): string => s.toLowerCase().replace(/[.,]+$/, "");

/**
 * Match a LEADING quantifier window (longest-first, up to
 * `quantifiers.maxTokens`) at group index `i`. Joins group texts with single
 * spaces and probes the quantifier table from the widest window down to one
 * token — so a multi-word quantifier ("ein paar") wins over its first word.
 * Skips windows that include an already-consumed group. Returns the matched
 * entry plus the window length, or null.
 *
 * Recognition only; the caller ({@link applyAmountUnit}) decides whether the
 * quantifier actually claims the amount slot per the unit-first resolution rule
 * (a quantifier that is itself the segment's ONLY unit stays a unit).
 */
export function matchQuantifierAt(
  groups: readonly Group[],
  i: number,
  quantifiers: QuantifierLookup,
): { len: number; entry: QuantifierLookupEntry } | null {
  const maxLen = Math.min(quantifiers.maxTokens, groups.length - i);
  for (let len = maxLen; len >= 1; len--) {
    const win = groups.slice(i, i + len);
    if (win.some((g) => g.leaves.every((l) => l.consumed))) continue;
    const raw = win.map((g) => g.text).join(" ");
    const lower = raw.toLowerCase();
    const entry =
      quantifiers.byNameOrAlias.get(lower) ?? quantifiers.byNameOrAlias.get(norm(lower));
    if (entry) return { len, entry };
  }
  return null;
}

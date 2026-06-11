import { aliasDedupKey } from "@/lib/recipe-import/ast/candidate-tokens";

/** Why an alias is flagged: it folds onto the canonical name, or onto another
 *  alias in the same list. */
export type AliasCollision = { collidesWith: "name" | "alias" };

/**
 * For each alias (keyed by its list index), report whether it is "virtually
 * identical" to the canonical name or to another alias — i.e. it shares the
 * matcher's dedup key (same after folding case, diacritics, ß, separators and
 * the &/und/and conjunction). These are the pairs the matcher cannot tell
 * apart, so keeping both is redundant; the editor surfaces a non-blocking
 * warning. Blank aliases are ignored. A name collision outranks an alias
 * collision when both apply.
 */
export function findAliasCollisions(
  canonicalName: string,
  aliases: readonly string[],
): Map<number, AliasCollision> {
  const out = new Map<number, AliasCollision>();
  const nameKey = aliasDedupKey(canonicalName);
  const keys = aliases.map((a) => aliasDedupKey(a));
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (key.length === 0) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  keys.forEach((key, i) => {
    if (key.length === 0) return;
    if (nameKey.length > 0 && key === nameKey) {
      out.set(i, { collidesWith: "name" });
    } else if ((counts.get(key) ?? 0) > 1) {
      out.set(i, { collidesWith: "alias" });
    }
  });
  return out;
}

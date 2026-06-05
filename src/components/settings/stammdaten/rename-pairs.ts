/**
 * Renames the user made to the canonical name or to EXISTING aliases (whose
 * draft key encodes the original name as `existing-<name>`). New/removed
 * aliases aren't renames.
 *
 * A pair only counts as a rename when its old spelling is gone after the
 * edit: swapping the canonical name with an alias (or re-adding the old name
 * as a new alias) keeps both spellings on the article, so recipe display
 * names that match them stay correct and nothing must be propagated. This
 * also protects the server's sequential exact-match propagation from
 * double-applying the two halves of a swap.
 */
export function computeRenamePairs(args: {
  originalName: string;
  name: string;
  aliases: Array<{ key: string; name: string }>;
}): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  const push = (from: string, to: string) => {
    const f = from.trim();
    const t = to.trim();
    if (f.length === 0 || t.length === 0 || f === t) return;
    const k = f.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ from: f, to: t });
  };
  push(args.originalName, args.name);
  const prefix = "existing-";
  for (const a of args.aliases) {
    if (a.key.startsWith(prefix)) push(a.key.slice(prefix.length), a.name);
  }
  const remaining = new Set(
    [args.name, ...args.aliases.map((a) => a.name)]
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0),
  );
  return pairs.filter((p) => !remaining.has(p.from.toLowerCase()));
}

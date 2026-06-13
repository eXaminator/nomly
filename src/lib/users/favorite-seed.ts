/**
 * Maps a user's display name to the tag whose recipes should be auto-favorited
 * for them on first login. Partial, case-insensitive substring match — enough
 * for a small household. Returns null when no mapping applies.
 *
 * The source tags come from the Familywall import: "Familywall-Favorit" marks
 * Steven's favorites, "Janine" marks Janine's.
 */
const NAME_TAG_MAP: ReadonlyArray<{ needle: string; tag: string }> = [
  { needle: "steven", tag: "Familywall-Favorit" },
  { needle: "janine", tag: "Janine" },
];

export function tagForUserName(name: string): string | null {
  const n = name.toLowerCase();
  for (const m of NAME_TAG_MAP) if (n.includes(m.needle)) return m.tag;
  return null;
}

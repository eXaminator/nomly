import type { Leaf, Role } from "./render-notes";

/** A run of adjacent leaves with NO source whitespace between them — i.e. one
 *  whitespace-delimited token ("100-200" stays one group even though the lexer
 *  split it into number/dash/number). Amount/unit detection works on these so
 *  it sees the same tokens the legacy whitespace tokenizer did. */
export type Group = {
  text: string;
  leaves: Leaf[];
  start: number;
  end: number;
};

/** Group leaves by source adjacency (no intervening whitespace), but always
 *  break where a number is DIRECTLY adjacent to a word so a glued amount+unit
 *  like "200g" stays two groups ("200", "g"). A dash between them does NOT
 *  break, so a numeric run ("100-200", "1/2"), a size compound ("12-count",
 *  "28-ounce") and a word+punct abbreviation ("geh.", "z.B.") stay merged. */
export function groupByWhitespace(source: string, leaves: readonly Leaf[]): Group[] {
  const groups: Group[] = [];
  for (const lf of leaves) {
    const prev = groups[groups.length - 1];
    const lastKind = prev?.leaves[prev.leaves.length - 1].kind;
    const crossNumWord =
      (lastKind === "number" && lf.kind === "word") ||
      (lastKind === "word" && lf.kind === "number");
    if (prev && source.slice(prev.end, lf.start) === "" && !crossNumWord) {
      prev.text += lf.text;
      prev.leaves.push(lf);
      prev.end = lf.end;
    } else {
      groups.push({ text: lf.text, leaves: [lf], start: lf.start, end: lf.end });
    }
  }
  return groups;
}

/** Mark every leaf in a group consumed with the given role. */
export function consumeGroup(g: Group, role: Role): void {
  for (const lf of g.leaves) {
    lf.consumed = true;
    lf.role = role;
  }
}

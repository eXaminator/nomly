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

/** Group leaves by source adjacency (no intervening whitespace). */
export function groupByWhitespace(source: string, leaves: readonly Leaf[]): Group[] {
  const groups: Group[] = [];
  for (const lf of leaves) {
    const prev = groups[groups.length - 1];
    if (prev && source.slice(prev.end, lf.start) === "") {
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

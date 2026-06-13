import type { Leaf } from "../render-notes";

/**
 * Collapse redundant "double" parentheses — a paren (or bracket) group whose
 * ONLY content is a single nested paren group, e.g. `((1 1/4 cups))`. The outer
 * wrapper adds no information, so its delimiters are dropped and everything
 * inside is promoted one level (depth − 1). Runs repeatedly so `((( x )))`
 * fully reduces to a single `( x )`, at any nesting depth.
 *
 * A wrapper with any OTHER content is kept: `(chopped (⅔ cup))` is NOT
 * collapsed because the outer paren also holds the word "chopped". After this
 * pass, the note renderer's normal root-level unwrap removes the surviving
 * single layer.
 *
 * Also drops a paren whose entire content was CONSUMED, leaving it empty —
 * `(optional)` once "optional" is taken as the optional marker — so the note
 * doesn't render a stray "( )". Mutates `leaves` in place (offsets untouched).
 */
export function collapseRedundantParens(leaves: Leaf[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    // Match open/close delimiters into pairs, ignoring already-dropped ones.
    const stack: number[] = [];
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i];
      if (l.consumed) continue;
      if (l.kind === "open") stack.push(i);
      else if (l.kind === "close") {
        const o = stack.pop();
        if (o != null) pairs.push([o, i]);
      }
    }
    const closeOf = new Map(pairs.map(([o, c]) => [o, c]));

    for (const [o, c] of pairs) {
      // The first and last LIVE leaves strictly inside this pair.
      let first = -1;
      let last = -1;
      for (let i = o + 1; i < c; i++) {
        if (leaves[i].consumed) continue;
        if (first < 0) first = i;
        last = i;
      }
      if (first < 0) {
        // All content was consumed (e.g. "(optional)" once "optional" is taken
        // as the optional marker) — the now-empty parens carry nothing, so drop
        // them too instead of rendering a stray "( )".
        leaves[o].consumed = true;
        leaves[o].role = "connector";
        leaves[c].consumed = true;
        leaves[c].role = "connector";
        changed = true;
        continue;
      }
      // Redundant only when the sole content is one paren group: the first live
      // leaf is an open whose matching close is the last live leaf.
      if (
        leaves[first].kind === "open" &&
        leaves[last].kind === "close" &&
        closeOf.get(first) === last
      ) {
        leaves[o].consumed = true;
        leaves[o].role = "connector";
        leaves[c].consumed = true;
        leaves[c].role = "connector";
        for (let i = o + 1; i < c; i++) {
          leaves[i].depth = Math.max(0, leaves[i].depth - 1);
        }
        changed = true;
      }
    }
  }
}

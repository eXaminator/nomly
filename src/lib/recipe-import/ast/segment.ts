import type { Leaf } from "./render-notes";

/** The connector word that introduced a segment (null for the primary). */
export type Connector = "und" | "and" | "&" | "oder" | "or" | "/" | null;

export type Segment = {
  /** The leaves belonging to this segment (the connector leaf itself is NOT
   *  included — it's recorded in `connector`). */
  leaves: Leaf[];
  connector: Connector;
  /** True for `oder`/`or`/`/` segments (an alternative ingredient); false for
   *  `und`/`and`/`&` (a co-ingredient) and the primary. */
  isAlternative: boolean;
};

const ALT_WORDS = new Set(["oder", "or"]);
const CONJ_WORDS = new Set(["und", "and"]);

/**
 * Split a line's leaves into ingredient segments at depth-0 connectors.
 *  - `oder`/`or` (and a depth-0 `/`) start an ALTERNATIVE and split anywhere.
 *  - `und`/`and`/`&` start a CO-INGREDIENT but only before the first
 *    depth-0 comma (a conjunction after a comma is a prep note, not a split).
 *
 * The container / color-adjective / known-ingredient-overlap / dash-compound
 * guards from the legacy splitter are layered on later; this is the structural
 * core.
 */
export function splitSegments(leaves: Leaf[]): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let seenComma = false;
  let connector: Connector = null;
  let isAlternative = false;

  const close = (endExclusive: number): void => {
    segments.push({ leaves: leaves.slice(start, endExclusive), connector, isAlternative });
  };

  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i];
    if (lf.depth !== 0) continue;
    if (lf.kind === "comma") {
      seenComma = true;
      continue;
    }
    let conn: Connector = null;
    let alt = false;
    if (lf.kind === "word") {
      const w = lf.text.toLowerCase();
      if (ALT_WORDS.has(w)) {
        conn = w as Connector;
        alt = true;
      } else if (CONJ_WORDS.has(w) && !seenComma) {
        conn = w as Connector;
        alt = false;
      }
    } else if (lf.kind === "slash" && !seenComma) {
      conn = "/";
      alt = true;
    } else if (lf.kind === "punct" && lf.text === "&" && !seenComma) {
      conn = "&";
      alt = false;
    }
    if (conn) {
      close(i);
      start = i + 1;
      connector = conn;
      isAlternative = alt;
      seenComma = false;
    }
  }
  close(leaves.length);
  return segments;
}

import type { Leaf } from "../render-notes";

/**
 * Drop a leading run of non-content punctuation/symbols ("+ 100 ml", "~ 2 EL",
 * "*Pfeffer", "▢ Mehl", bullets/emoji) — annotated as consumed (role
 * "connector"), in place, so the amount/name passes see the real start. Stops
 * at the first word, number, or opening paren (a leading "(28 oz.)" size stays).
 * Mutates `leaves`.
 */
export function applyLeadingNoise(leaves: Leaf[]): void {
  for (const lf of leaves) {
    if (lf.kind === "word" || lf.kind === "number" || lf.kind === "open") break;
    if (lf.depth !== 0) break;
    lf.consumed = true;
    lf.role = "connector";
  }
}

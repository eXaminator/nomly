import {
  isColorAdjective,
  isStandaloneDescriptor,
  normalizeForMatch,
  preIsHeadlessModifier,
} from "../ingredient";
import type { HighlightPart } from "../source-ranges";
import type { Leaf } from "./render-notes";

/**
 * AST-based line segmentation — replaces the legacy string functions
 * (expandIngredientLine / splitConjunctions / preprocessAlternatives). The line
 * is lexed ONCE; this splits the leaves into ingredient segments at their
 * ORIGINAL paren depth, so a separator inside "(...)" is never a top-level split
 * (the legacy code lost that when it sliced paren content into a bare string,
 * which is why "&" inside an alternative was mis-split). Each ingredient segment
 * carries a depth-normalized clone of its leaves for {@link parseLeaves}.
 */
export type LineSegment =
  | { kind: "header"; title: string }
  | {
      kind: "ingredient";
      /** This segment's leaves, cloned and depth-normalized to 0 so they read
       *  as a standalone line for the per-segment parser. */
      leaves: Leaf[];
      /** Source offsets [start, end) of the segment — the row's sourceRange. */
      range: [number, number] | null;
      /** Verbatim source slice (trimmed) — used for alternative fold-back. */
      segText: string;
      /** Origin shown on the row: the whole line for expanded rows, the
       *  sub-piece for plain conjunction/or splits (mirrors legacy rawText). */
      rawText: string;
      forceOptional: boolean;
      isAlternative: boolean;
      connector: string | null;
      /** The connector token leaves preceding an alternative ("oder", "/",
       *  "alternativ:") — cloned, depth-normalized. Used when the alternative
       *  folds into its primary's note so the connector word renders from the
       *  AST ("oder X"), never string-appended. Null for primaries. */
      connectorLeaves?: Leaf[];
      localNote: boolean;
      tailNote: string | null;
      /** Leaves of a tail note after a parenthetical alternative ("(or X),
       *  peeled" → ", peeled") — cloned, depth-normalized. Folded onto the
       *  primary via the AST at end of line. */
      tailNoteLeaves?: Leaf[];
      /** Compound-elision rows ("Weizen- oder Dinkelmehl" → "Weizenmehl") have
       *  a SYNTHESIZED name that isn't a contiguous source slice. When set, the
       *  orchestrator parses THIS string (amount + stitched name) instead of
       *  `leaves`, and uses `highlightOverride` for the source attribution. */
      syntheticSource?: string;
      /** Explicit highlight spans (absolute into the original line) for a
       *  synthetic row: the shared amount, the stem item, and the borrowed
       *  suffix substring of the head word. */
      highlightOverride?: HighlightPart[];
    };

export type SegmentOptions = {
  containerTokens: ReadonlySet<string>;
  knownIngredients: ReadonlySet<string>;
  useFirstWins: boolean;
};

const norm = (s: string): string => s.toLowerCase().replace(/[.,:]+$/, "");

const OPTIONAL_PREFIX_WORDS = new Set([
  "optional",
  "optionally",
  "opt",
  "opional",
  "optionale",
]);
const ALT_SEP_WORDS = new Set(["alternativ", "alternative", "alternatively", "alternativly"]);
const SUB_MARKER_WORDS = new Set([
  "substituted",
  "substitute",
  "sub",
  "ersatzweise",
  "notfalls",
]);
const ALT_LEADER_WORDS = new Set([
  ...ALT_SEP_WORDS,
  ...SUB_MARKER_WORDS,
]);
const OR_WORDS = new Set(["oder", "or"]);
const CONJ_WORDS = new Set(["und", "and"]);
/** Well-known adjacent pairs that read as two ingredients even without a
 *  conjunction ("Salz Pfeffer") — split only in the Familywall first-wins mode
 *  (mirrors the legacy preprocessAlternatives injection). */
const KNOWN_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["salz", "pfeffer"],
  ["salt", "pepper"],
];

/** A depth-0 word leaf whose text equals one of `set` (normalised). */
function isWordIn(l: Leaf, set: ReadonlySet<string>): boolean {
  return l.kind === "word" && set.has(norm(l.text));
}

/**
 * Clone a leaf range into a standalone segment, normalising depth so the
 * outermost leaves sit at depth 0 (paren content extracted from `(...)` reads
 * like a top-level line). Offsets are preserved (they index into the original
 * source, which the renderers slice).
 */
function makeIngredient(
  source: string,
  all: readonly Leaf[],
  from: number,
  to: number,
  baseDepth: number,
  meta: Omit<Extract<LineSegment, { kind: "ingredient" }>, "kind" | "leaves" | "range" | "segText">,
): LineSegment | null {
  // Trim a trailing comma/semicolon left by a split ("ungesalzen," from
  // "(oder ungesalzen, oder X)") — the alternative's own note keeps no dangling
  // separator (mirrors the legacy splitOrOptions clean()).
  let end = to;
  while (end > from && (all[end - 1].kind === "comma" || all[end - 1].kind === "semicolon")) {
    end -= 1;
  }
  const slice = all
    .slice(from, end)
    .map((l) => ({ ...l, depth: Math.max(0, l.depth - baseDepth) }));
  if (slice.length === 0) return null;
  // The note/highlight range starts at the leaf content, but for an ALTERNATIVE
  // it extends back over the connector ("oder X", "alternativ: X") so the
  // highlighter can mark the connector as dropped — mirrors the legacy
  // findSegmentRange(withConnector) behaviour.
  // Capture the connector token(s) before this segment for BOTH alternatives
  // ("oder X") and conjunction members ("und Pfeffer") — used when the member
  // folds into a sibling's note. Only an ALTERNATIVE extends its range back over
  // the connector (so the highlighter strikes it); a conjunction main keeps its
  // range at its own content.
  const connLeaves = connectorLeavesBefore(all, from, baseDepth);
  const rangeStart =
    meta.isAlternative && connLeaves[0] ? connLeaves[0].start : slice[0].start;
  const range: [number, number] = [rangeStart, slice[slice.length - 1].end];
  const segText = source.slice(slice[0].start, range[1]).trim();
  if (segText.length === 0) return null;
  return {
    kind: "ingredient",
    leaves: slice,
    range,
    segText,
    ...meta,
    ...(connLeaves.length ? { connectorLeaves: connLeaves } : {}),
  };
}

/** Walk back from `from` over a run of connector tokens (oder/or/o./ "/" /
 *  alternativ/sub + ":") preceding an alternative's content, skipping an
 *  enclosing "(" — returns the connector token LEAVES (cloned, depth-normalized
 *  to `baseDepth`) in source order, for folding an alternative into its
 *  primary's note via the AST. Empty when there's no connector. */
function connectorLeavesBefore(
  all: readonly Leaf[],
  from: number,
  baseDepth: number,
): Leaf[] {
  const idxs: number[] = [];
  for (let k = from - 1; k >= 0; k--) {
    const l = all[k];
    if (l.kind === "open") continue; // skip the alt paren's "("
    const w = norm(l.text);
    const isConnTok =
      isWordIn(l, OR_WORDS) ||
      isWordIn(l, CONJ_WORDS) ||
      l.kind === "slash" ||
      (l.kind === "punct" && l.text === "&") ||
      ALT_LEADER_WORDS.has(w) ||
      w === "o" ||
      (l.kind === "punct" && (l.text === ":" || l.text === "."));
    if (!isConnTok) break;
    idxs.push(k);
  }
  return idxs
    .reverse()
    .map((k) => ({ ...all[k], depth: Math.max(0, all[k].depth - baseDepth) }));
}

/**
 * Find the indices of depth-`baseDepth` leaves between [from, to) that begin a
 * separator matched by `match`. Returns each split point as the index of the
 * FIRST leaf of the separator and how many leaves it spans (for multi-leaf
 * separators like "o." → word "o" + punct ".").
 */
type Sep = { at: number; span: number; word: string };

/** A separator only qualifies with content on BOTH sides (it joins two things);
 *  a leading/trailing "und"/"oder"/"&" is filler, not a split. */
function hasContentAround(
  all: readonly Leaf[],
  at: number,
  span: number,
  from: number,
  to: number,
): boolean {
  return (
    prevContentWord(all, at, from) != null && nextContentWord(all, at + span, to) != null
  );
}

/** Top-level "or" separators: "oder" / "or" / "/" / "o." (not "o. ä."). */
function orSeparators(all: readonly Leaf[], from: number, to: number, depth: number): Sep[] {
  const seps: Sep[] = [];
  for (let i = from; i < to; i++) {
    const l = all[i];
    if (l.depth !== depth) continue;
    let cand: Sep | null = null;
    if (isWordIn(l, OR_WORDS)) {
      cand = { at: i, span: 1, word: norm(l.text) };
    } else if (l.kind === "slash") {
      // A standalone " / " separator has whitespace on a side. A slash glued to
      // tokens on BOTH sides is usually a plural marker ("Dose/n") or fraction
      // ("1/2") — NOT a separator. The exception: two full words glued by a
      // slash where the right side is CAPITALIZED ("Kurkuma/Gelbwurz") are
      // alternatives. German plural endings are lowercase (n/en/e/…), so an
      // uppercase suffix is a separate noun — the same signal the plural-marker
      // pass uses, keeping the two rules complementary.
      const prev = all[i - 1];
      const next = all[i + 1];
      const gluedBoth = prev && next && prev.end === l.start && l.end === next.start;
      const gluedWords =
        gluedBoth &&
        prev.kind === "word" &&
        next.kind === "word" &&
        /^\p{Lu}/u.test(next.text);
      if (!gluedBoth || gluedWords) cand = { at: i, span: 1, word: "/" };
    } else if (l.kind === "word" && norm(l.text) === "o") {
      // "o." short for "oder": word "o" + punct "." — but NOT "o. ä." (similar).
      const dot = all[i + 1];
      if (dot?.kind === "punct" && dot.text === ".") {
        const nextWord = all[i + 2];
        if (nextWord && norm(nextWord.text) === "ä") continue;
        cand = { at: i, span: 2, word: "o." };
      }
    }
    if (cand && hasContentAround(all, cand.at, cand.span, from, to)) seps.push(cand);
  }
  return seps;
}

/** Top-level conjunction separators: "und" / "and" / "&". */
function conjSeparators(all: readonly Leaf[], from: number, to: number, depth: number): Sep[] {
  const seps: Sep[] = [];
  for (let i = from; i < to; i++) {
    const l = all[i];
    if (l.depth !== depth) continue;
    let cand: Sep | null = null;
    if (isWordIn(l, CONJ_WORDS)) cand = { at: i, span: 1, word: norm(l.text) };
    else if (l.kind === "punct" && l.text === "&") cand = { at: i, span: 1, word: "&" };
    if (cand && hasContentAround(all, cand.at, cand.span, from, to)) seps.push(cand);
  }
  return seps;
}

/** First depth-0 top-level comma index in [from,to), or -1. A comma between two
 *  digits is a decimal, not a separator. */
function firstTopComma(all: readonly Leaf[], from: number, to: number, depth: number): number {
  for (let i = from; i < to; i++) {
    const l = all[i];
    if (l.depth === depth && l.kind === "comma") return i;
  }
  return -1;
}

/** The last word/number/content leaf index before `idx` (skipping nothing —
 *  used to read the token before a separator). */
function prevContentWord(all: readonly Leaf[], idx: number, from: number): Leaf | null {
  for (let i = idx - 1; i >= from; i--) {
    if (all[i].kind === "word" || all[i].kind === "number") return all[i];
  }
  return null;
}
function nextContentWord(all: readonly Leaf[], idx: number, to: number): Leaf | null {
  for (let i = idx; i < to; i++) {
    if (all[i].kind === "word" || all[i].kind === "number") return all[i];
  }
  return null;
}

export function segmentLine(
  source: string,
  leaves: Leaf[],
  opts: SegmentOptions,
): LineSegment[] {
  // The whole line lives at depth 0; sub-segments inside parens are handled by
  // passing a higher baseDepth.
  return segmentRange(source, leaves, 0, leaves.length, 0, false, opts);
}

/**
 * Segment a leaf range [from,to) whose top level is `baseDepth`. `optional`
 * forces every produced row optional (inherited from an Optional: wrapper).
 */
function segmentRange(
  source: string,
  all: Leaf[],
  from: number,
  to: number,
  baseDepth: number,
  optional: boolean,
  opts: SegmentOptions,
): LineSegment[] {
  // Trim leading/trailing whitespace-only is implicit (no whitespace leaves);
  // skip leading noise is left to the per-segment parser.
  if (from >= to) return [];

  // ── Optional: prefix (only at the very start, baseDepth) ──────────────────
  {
    const first = all[from];
    if (first && isWordIn(first, OPTIONAL_PREFIX_WORDS)) {
      const colon = all[from + 1];
      if (colon?.kind === "punct" && colon.text === ":") {
        return segmentRange(source, all, from + 2, to, baseDepth, true, opts);
      }
    }
  }

  // ── each-distribution: "<qty …> each: A, B, C" ────────────────────────────
  {
    const eachIdx = findEach(all, from, to, baseDepth);
    if (eachIdx >= 0) {
      const colon = all[eachIdx + 1];
      if (colon?.kind === "punct" && colon.text === ":") {
        // qty/unit prefix is [from, eachIdx); it must carry a number.
        const hasNumber = all
          .slice(from, eachIdx)
          .some((l) => l.kind === "number");
        if (hasNumber) {
          const items = splitListItems(all, eachIdx + 2, to, baseDepth);
          if (items.length > 0) {
            const out: LineSegment[] = [];
            for (const [a, b] of items) {
              // Prepend the shared qty/unit leaves (cloned) to each item.
              const prefix = all
                .slice(from, eachIdx)
                .map((l) => ({ ...l, depth: Math.max(0, l.depth - baseDepth) }));
              const item = all
                .slice(a, b)
                .map((l) => ({ ...l, depth: Math.max(0, l.depth - baseDepth) }));
              const merged = [...prefix, ...item];
              const range: [number, number] = [merged[0].start, merged[merged.length - 1].end];
              out.push({
                kind: "ingredient",
                leaves: merged,
                range: null,
                segText: source.slice(range[0], range[1]).trim(),
                rawText: source.trim(),
                forceOptional: optional,
                isAlternative: false,
                connector: null,
                localNote: false,
                tailNote: null,
              });
            }
            return out;
          }
        }
      }
    }
  }

  // ── Trailing paren alternative: "X (oder Y)" / "X (Alternativ: Y)" ─────────
  {
    const alt = extractParenAlt(all, from, to, baseDepth);
    if (alt) return buildParenAlt(source, all, from, to, baseDepth, optional, alt, opts);
  }

  // ── "alternativ:" inline separator ────────────────────────────────────────
  {
    const sepIdx = findAlternativSep(all, from, to, baseDepth);
    if (sepIdx >= 0) {
      const connector = norm(all[sepIdx].text);
      const out: LineSegment[] = [];
      // Primary part [from, sepIdx).
      out.push(
        ...segmentRange(source, all, from, sepIdx, baseDepth, optional, opts).map((s) =>
          s.kind === "ingredient" ? { ...s, rawText: source.trim() } : s,
        ),
      );
      // Alternative part(s) after the separator — split into or/comma items.
      const altItems = splitListItems(all, sepIdx + 1, to, baseDepth);
      altItems.forEach(([a, b], idx) => {
        const seg = makeIngredient(source, all, a, b, baseDepth, {
          rawText: source.trim(),
          forceOptional: true,
          isAlternative: true,
          connector: idx === 0 ? `${connector}:` : "oder",
          localNote: false,
          tailNote: null,
        });
        if (seg) out.push(seg);
      });
      if (out.length >= 2) return out;
    }
  }

  // ── List-after-colon: "Title: A, B, C" → header + items ───────────────────
  {
    const colonIdx = findHeaderColon(all, from, to, baseDepth);
    if (colonIdx >= 0) {
      const itemsStart = colonIdx + 1;
      const firstItem = nextContentWord(all, itemsStart, to);
      // Skip the inverted "Name: qty unit" form (post-colon starts with a digit).
      const inverted = firstItem != null && firstItem.kind === "number" &&
        all.slice(itemsStart, to).findIndex((l) => l.kind === "word" || l.kind === "number") >= 0 &&
        nextContentWord(all, itemsStart, to)?.kind === "number";
      const titleText = source.slice(all[from].start, all[colonIdx].start).trim();
      if (!inverted && titleText.length > 0) {
        const items = splitListItems(all, itemsStart, to, baseDepth);
        if (items.length > 0) {
          const titleHasOptional = /\b(?:optional|optionally|nach\s+belieben)\b/i.test(titleText);
          const force = optional || titleHasOptional;
          const out: LineSegment[] = [{ kind: "header", title: titleText }];
          for (const [a, b] of items) {
            const seg = makeIngredient(source, all, a, b, baseDepth, {
              rawText: source.trim(),
              forceOptional: force,
              isAlternative: false,
              connector: null,
              localNote: false,
              tailNote: null,
            });
            if (seg) out.push(seg);
          }
          return out;
        }
      }
    }
  }

  // ── Compound-elision list: "Weizen- oder Dinkelmehl", "Mandel-, Hafer- oder
  //    Kokosdrink" → one row per stem, each borrowing the head's suffix. ──────
  {
    const elided = expandElision(source, all, from, to, baseDepth, optional, opts);
    if (elided) return elided;
  }

  // ── "oder"/"or"/"/"/"o." chain ────────────────────────────────────────────
  {
    const seps = orSeparators(all, from, to, baseDepth);
    if (seps.length > 0) {
      const segs = sliceBySeps(all, from, to, seps);
      const primaryEnd = segs[0].to;
      // Guards on the primary (first segment).
      const primaryLastWord = prevContentWord(all, primaryEnd, segs[0].from);
      const endsWithDash =
        primaryEnd - 1 >= segs[0].from && all[primaryEnd - 1].kind === "dash";
      const primaryText = source.slice(all[segs[0].from].start, all[primaryEnd - 1].end).trim();
      void primaryLastWord;
      const allNonEmpty = segs.every((s) => s.to > s.from);
      // A dash-compound stem ("Weizen- oder Dinkelmehl") that the elision
      // expander above could NOT resolve (no catalog hit) stays ONE ingredient.
      if (allNonEmpty && !endsWithDash && !preIsHeadlessModifier(primaryText)) {
        const out: LineSegment[] = [];
        segs.forEach((s, idx) => {
          // Strip a leading substitute marker on alternatives ("or sub X").
          let a = s.from;
          if (idx > 0) {
            const w = all[a];
            if (w && isWordIn(w, SUB_MARKER_WORDS)) a += 1;
          }
          const seg = makeIngredient(source, all, a, s.to, baseDepth, {
            rawText: source.trim(),
            forceOptional: idx === 0 ? optional : true,
            isAlternative: idx > 0,
            connector: idx > 0 ? s.connector : null,
            localNote: false,
            tailNote: null,
          });
          if (seg) out.push(seg);
        });
        if (out.length > 0) return out;
      }
    }
  }

  // ── Conjunction split: "A und B", "Salz & Pfeffer" ───────────────────────
  {
    const segs = conjunctionSplit(source, all, from, to, baseDepth, opts);
    if (segs.length > 1) {
      return segs.map((s, idx) => {
        const seg = makeIngredient(source, all, s.from, s.to, baseDepth, {
          rawText: s.rawText,
          forceOptional: optional,
          isAlternative: false,
          connector: null,
          localNote: false,
          tailNote: null,
        });
        return seg;
      }).filter((s): s is LineSegment => s != null);
    }
  }

  // ── Pass-through: one ingredient ──────────────────────────────────────────
  const seg = makeIngredient(source, all, from, to, baseDepth, {
    rawText: source.trim(),
    forceOptional: optional,
    isAlternative: false,
    connector: null,
    localNote: false,
    tailNote: null,
  });
  return seg ? [seg] : [];
}

// ── helpers ──────────────────────────────────────────────────────────────

function findEach(all: readonly Leaf[], from: number, to: number, depth: number): number {
  for (let i = from + 1; i < to; i++) {
    const l = all[i];
    if (l.depth === depth && l.kind === "word" && norm(l.text) === "each") {
      const colon = all[i + 1];
      if (colon?.kind === "punct" && colon.text === ":") return i;
    }
  }
  return -1;
}

function findAlternativSep(all: readonly Leaf[], from: number, to: number, depth: number): number {
  // A standalone "alternativ"/"alternative" word (colon optional) used as a
  // separator: there must be content before AND after it.
  for (let i = from + 1; i < to - 1; i++) {
    const l = all[i];
    if (l.depth === depth && l.kind === "word" && ALT_SEP_WORDS.has(norm(l.text))) {
      const before = prevContentWord(all, i, from);
      const after = nextContentWord(all, i + 1, to);
      if (before && after) return i;
    }
  }
  return -1;
}

function findHeaderColon(all: readonly Leaf[], from: number, to: number, depth: number): number {
  for (let i = from; i < to; i++) {
    const l = all[i];
    if (l.depth === depth && l.kind === "punct" && l.text === ":") return i;
  }
  return -1;
}

/**
 * Split a list region [from,to) into item ranges at top-level commas and "or"/
 * "oder" separators (decimals excluded). Used for colon-lists and each-lists.
 */
function splitListItems(
  all: readonly Leaf[],
  from: number,
  to: number,
  depth: number,
): Array<[number, number]> {
  const items: Array<[number, number]> = [];
  let start = from;
  for (let i = from; i < to; i++) {
    const l = all[i];
    if (l.depth !== depth) continue;
    let sepSpan = 0;
    if (l.kind === "comma") {
      // decimal comma guard
      const prev = all[i - 1];
      const next = all[i + 1];
      const decimal =
        prev?.kind === "number" && next?.kind === "number" &&
        prev.end === l.start && l.end === next.start;
      if (!decimal) sepSpan = 1;
    } else if (isWordIn(l, OR_WORDS)) {
      sepSpan = 1;
    }
    if (sepSpan > 0) {
      if (i > start) items.push([start, i]);
      start = i + sepSpan;
    }
  }
  if (to > start) items.push([start, to]);
  return items.filter(([a, b]) => b > a);
}

/** Split an or-chain region into segments at the given separators. */
function sliceBySeps(
  all: readonly Leaf[],
  from: number,
  to: number,
  seps: Sep[],
): Array<{ from: number; to: number; connector: string | null }> {
  const out: Array<{ from: number; to: number; connector: string | null }> = [];
  let start = from;
  let connector: string | null = null;
  for (const sep of seps) {
    out.push({ from: start, to: sep.at, connector });
    connector = sep.word;
    start = sep.at + sep.span;
  }
  out.push({ from: start, to, connector });
  return out;
}

/** Index of the last word leaf in [a,b), or -1. */
function lastWordIdx(all: readonly Leaf[], a: number, b: number): number {
  for (let i = b - 1; i >= a; i--) if (all[i].kind === "word") return i;
  return -1;
}

/** The longest suffix T of `head` (≥2 chars) such that `stem + T` is a known
 *  catalog ingredient for at least one stem. The catalog is the dictionary that
 *  decides where the head's shared suffix begins ("Kokos|drink"). */
function sharedSuffix(head: string, stems: string[], known: ReadonlySet<string>): string | null {
  for (let len = Math.min(head.length - 1, 14); len >= 2; len--) {
    const t = head.slice(-len);
    if (stems.some((s) => known.has(normalizeForMatch(s + t)))) return t;
  }
  return null;
}

/**
 * German compound-elision list: "Weizen- oder Dinkelmehl", "500 ml Mandel-,
 * Hafer-, Soja- oder Kokosdrink". Non-final items are stems (a trailing "-"
 * marks the elision; a missing dash on one item is tolerated once the pattern
 * is triggered); the final item is the full head compound. Each stem borrows
 * the head's shared suffix (see {@link sharedSuffix}) → one synthesized row per
 * stem + the head, with the leading amount shared. Returns null when it isn't
 * an elision list or no catalog suffix validates (caller keeps it as one row).
 */
function expandElision(
  source: string,
  all: Leaf[],
  from: number,
  to: number,
  baseDepth: number,
  optional: boolean,
  opts: SegmentOptions,
): LineSegment[] | null {
  const items = splitListItems(all, from, to, baseDepth);
  if (items.length < 2) return null;
  const headRange = items[items.length - 1];
  // The head is a full compound — it must NOT end with a trailing dash.
  if (all[headRange[1] - 1]?.kind === "dash") return null;
  const stemRanges = items.slice(0, -1);
  // The pattern triggers only when at least one stem carries the elision dash.
  if (!stemRanges.some(([, b]) => all[b - 1]?.kind === "dash")) return null;

  const headLast = all[headRange[1] - 1];
  const headText = source.slice(all[headRange[0]].start, headLast.end).trim();
  const stemWordIdxs = stemRanges.map(([a, b]) => lastWordIdx(all, a, b));
  if (stemWordIdxs.some((i) => i < 0)) return null;
  const stems = stemWordIdxs.map((i) => all[i].text);

  const t = sharedSuffix(headText, stems, opts.knownIngredients);
  if (t == null) return null;

  // Shared amount = item0 from its start up to its stem word.
  const firstStemIdx = stemWordIdxs[0];
  const amountStart = all[stemRanges[0][0]].start;
  const amountHl: HighlightPart | null =
    firstStemIdx > stemRanges[0][0]
      ? { kind: "amount", range: [amountStart, all[firstStemIdx - 1].end] }
      : null;
  const amountText = amountHl ? source.slice(amountHl.range[0], amountHl.range[1]).trim() : "";
  const amountPrefix = amountText ? `${amountText} ` : "";
  const suffixSpan: [number, number] = [headLast.end - t.length, headLast.end];

  const out: LineSegment[] = [];
  stemRanges.forEach(([, b], k) => {
    const stemWord = all[stemWordIdxs[k]];
    const name = stemWord.text + t;
    const stemEnd = all[b - 1].kind === "dash" ? all[b - 1].end : stemWord.end;
    const hl: HighlightPart[] = [];
    if (amountHl) hl.push(amountHl);
    hl.push({ kind: "name", range: [stemWord.start, stemEnd] });
    hl.push({ kind: "name", range: suffixSpan });
    out.push({
      kind: "ingredient",
      leaves: [],
      range: [stemWord.start, stemEnd],
      segText: name,
      rawText: source.trim(),
      forceOptional: k === 0 ? optional : true,
      isAlternative: k > 0,
      connector: k > 0 ? "oder" : null,
      localNote: false,
      tailNote: null,
      syntheticSource: amountPrefix + name,
      highlightOverride: hl,
    });
  });
  const headHl: HighlightPart[] = [];
  if (amountHl) headHl.push(amountHl);
  headHl.push({ kind: "name", range: [all[headRange[0]].start, headLast.end] });
  out.push({
    kind: "ingredient",
    leaves: [],
    range: [all[headRange[0]].start, headLast.end],
    segText: headText,
    rawText: source.trim(),
    forceOptional: true,
    isAlternative: true,
    connector: "oder",
    localNote: false,
    tailNote: null,
    syntheticSource: amountPrefix + headText,
    highlightOverride: headHl,
  });
  return out;
}

type ParenAlt = {
  open: number; // index of "(" delimiter
  close: number; // index of ")" delimiter
  contentFrom: number;
  contentTo: number;
  leader: string; // connector for the first alternative
  tailFrom: number; // index after close (for the trailing note)
  /** Depth of the alt content (open.depth + 1) — higher than baseDepth+1 when a
   *  redundant wrapping paren was peeled ("((or penne))"). */
  contentDepth: number;
  /** A leading nested paren BEFORE the leader ("((10 g) oder X)") that belongs
   *  to the primary — its leaf range [from,to), hoisted onto the primary. */
  leadParen: [number, number] | null;
};

/**
 * Detect a trailing alternative parenthetical: the LAST top-level paren whose
 * content opens with "(oder …)" / "(or …)" / "(Alternativ: …)" / "(sub …)".
 */
function extractParenAlt(
  all: readonly Leaf[],
  from: number,
  to: number,
  depth: number,
): ParenAlt | null {
  // Find the last top-level close paren in range.
  let close = -1;
  for (let i = to - 1; i >= from; i--) {
    const l = all[i];
    if (l.depth === depth && l.kind === "close" && !l.bracket) {
      close = i;
      break;
    }
  }
  if (close < 0) return null;
  // A tail with a list separator (und/and/oder/or/sowie) → leave to other rules.
  for (let i = close + 1; i < to; i++) {
    const l = all[i];
    if (l.kind === "word" && (OR_WORDS.has(norm(l.text)) || CONJ_WORDS.has(norm(l.text)) || norm(l.text) === "sowie")) {
      return null;
    }
  }
  // Matching open.
  let open = -1;
  for (let i = close - 1; i >= from; i--) {
    const l = all[i];
    if (l.depth === depth && l.kind === "open" && !l.bracket) {
      open = i;
      break;
    }
  }
  if (open < 0) return null;
  // Peel a redundant paren that wraps the WHOLE content ("((or penne))" →
  // "(or penne)") so the leader inside is found. The OUTER open/close stay for
  // the primary boundary + tail; innerOpen/innerClose drive leader/content.
  let innerOpen = open;
  let innerClose = close;
  for (;;) {
    let cFirst = -1;
    let cLast = -1;
    for (let i = innerOpen + 1; i < innerClose; i++) {
      if (cFirst < 0) cFirst = i;
      cLast = i;
    }
    if (
      cFirst < 0 ||
      all[cFirst].kind !== "open" || all[cFirst].bracket ||
      all[cLast].kind !== "close" || all[cLast].bracket
    ) {
      break;
    }
    // cFirst's matching close must be cLast (a single wrapping paren).
    let d = 0;
    let match = -1;
    for (let i = cFirst; i <= cLast; i++) {
      if (all[i].kind === "open") d += 1;
      else if (all[i].kind === "close") {
        d -= 1;
        if (d === 0) {
          match = i;
          break;
        }
      }
    }
    if (match !== cLast) break;
    innerOpen = cFirst;
    innerClose = cLast;
  }
  // Leader word inside the (innermost) paren, tolerating a leading "or"/"oder".
  let cf = innerOpen + 1;
  let leadParen: [number, number] | null = null;
  // A leading nested paren that PRECEDES the leader belongs to the primary
  // ("((10 g) oder X)") — skip it for leader detection and hoist it onto the
  // primary.
  const firstInner = all[cf];
  if (firstInner?.kind === "open") {
    // skip the nested group
    let d = 0;
    let j = cf;
    for (; j < innerClose; j++) {
      if (all[j].kind === "open") d += 1;
      else if (all[j].kind === "close") {
        d -= 1;
        if (d === 0) {
          j += 1;
          break;
        }
      }
    }
    // only treat as lead-paren when an alt leader follows it
    const after = nextContentWord(all, j, innerClose);
    if (after && (OR_WORDS.has(norm(after.text)) || ALT_LEADER_WORDS.has(norm(after.text)))) {
      leadParen = [cf, j];
      cf = j;
    }
  }
  const leadWord = nextContentWord(all, cf, innerClose);
  if (!leadWord) return null;
  let leaderIdx = all.indexOf(leadWord, cf);
  let leader = norm(leadWord.text);
  let isOr = OR_WORDS.has(leader);
  // "(or alternativ X)" — tolerate a leading or/oder before an explicit marker.
  if (isOr) {
    const nextW = nextContentWord(all, leaderIdx + 1, innerClose);
    if (nextW && ALT_LEADER_WORDS.has(norm(nextW.text))) {
      leaderIdx = all.indexOf(nextW, leaderIdx + 1);
      leader = norm(nextW.text);
      isOr = false;
    }
  }
  if (!isOr && !ALT_LEADER_WORDS.has(leader)) return null;
  // Content begins after the leader (skip a ":" right after an explicit marker).
  let contentFrom = leaderIdx + 1;
  if (!isOr && all[contentFrom]?.kind === "punct" && all[contentFrom].text === ":") {
    contentFrom += 1;
  }
  const connector = isOr ? leadWord.text.toLowerCase() : `${leader}:`;
  return {
    open,
    close,
    contentFrom,
    contentTo: innerClose,
    contentDepth: all[innerOpen].depth + 1,
    leader: connector,
    tailFrom: close + 1,
    leadParen,
  };
}

function buildParenAlt(
  source: string,
  all: Leaf[],
  from: number,
  to: number,
  baseDepth: number,
  optional: boolean,
  alt: ParenAlt,
  opts: SegmentOptions,
): LineSegment[] {
  const out: LineSegment[] = [];
  // Tail note after the paren ("(or X), peeled").
  const tail =
    alt.tailFrom < to
      ? source.slice(all[alt.tailFrom].start, all[to - 1].end).replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "").trim()
      : "";
  const tailLeaves =
    alt.tailFrom < to
      ? all
          .slice(alt.tailFrom, to)
          .map((l) => ({ ...l, depth: Math.max(0, l.depth - baseDepth) }))
      : [];
  // Primary = [from, open). Re-expand so its own or/alternativ chain splits.
  let hasPrimary = false;
  if (alt.open > from) {
    const primarySegs = segmentRange(source, all, from, alt.open, baseDepth, optional, opts);
    primarySegs.forEach((s, idx) => {
      if (s.kind !== "ingredient") {
        out.push(s);
        return;
      }
      hasPrimary = hasPrimary || !s.isAlternative;
      // Hoist a leading paren note ("((10 g) oder X)" → "(10 g)" is the
      // primary's note) onto the FIRST primary segment's leaves so it parses as
      // a note on the primary, not dropped.
      let leaves = s.leaves;
      if (idx === 0 && alt.leadParen) {
        // The lead-paren sits INSIDE the outer alt paren (one level deeper), so
        // normalise by baseDepth+1 — its "(" then reads as a root paren on the
        // primary and unwraps to a plain note ("(10 g)" → "10 g").
        const hoisted = all
          .slice(alt.leadParen[0], alt.leadParen[1])
          .map((l) => ({ ...l, depth: Math.max(0, l.depth - (baseDepth + 1)) }));
        leaves = [...s.leaves, ...hoisted];
      }
      out.push({
        ...s,
        leaves,
        rawText: source.trim(),
        forceOptional: idx === 0 ? optional || s.forceOptional : s.forceOptional,
        ...(idx === 0 && tail ? { tailNote: tail, tailNoteLeaves: tailLeaves } : {}),
      });
    });
  }
  // Alternative items: split the paren content by "oder"/"or" at the content's
  // depth (deeper than baseDepth+1 when a redundant wrapping paren was peeled).
  // Commas stay glued (a comma inside an alternative is its own note).
  // Conjunctions ("&"/"und") are NOT split — they conjoin prep within one alt.
  const contentDepth = alt.contentDepth;
  const orSeps = orSeparators(all, alt.contentFrom, alt.contentTo, contentDepth);
  const itemRanges = sliceBySeps(all, alt.contentFrom, alt.contentTo, orSeps);
  itemRanges.forEach((r, idx) => {
    const isAlt = hasPrimary || idx > 0;
    const seg = makeIngredient(source, all, r.from, r.to, contentDepth, {
      rawText: source.trim(),
      forceOptional: true,
      isAlternative: isAlt,
      connector: !isAlt ? null : idx === 0 && hasPrimary ? alt.leader : "oder",
      localNote: true,
      tailNote: null,
    });
    if (seg) out.push(seg);
  });
  return out;
}

/**
 * Split a region into conjunction-separated pieces ("Salz und Pfeffer"), with
 * the legacy guards: container present → never split; after a top-level comma
 * the conjunction connects prep, not ingredients; parallel color adjectives;
 * a known ingredient spanning the conjunction; a dash-compound stem.
 */
function conjunctionSplit(
  source: string,
  all: Leaf[],
  from: number,
  to: number,
  depth: number,
  opts: SegmentOptions,
): Array<{ from: number; to: number; rawText: string }> {
  const whole = source.slice(all[from].start, all[to - 1].end).trim();
  const single = [{ from, to, rawText: whole }];

  // Container guard.
  if (opts.containerTokens.size > 0) {
    for (let i = from; i < to; i++) {
      if (all[i].kind === "word" && opts.containerTokens.has(norm(all[i].text))) return single;
    }
  }

  // First-wins (Familywall): a well-known adjacent pair with no conjunction
  // ("Salz Pfeffer") reads as two ingredients — split between them.
  if (opts.useFirstWins) {
    for (let i = from; i + 1 < to; i++) {
      const a = all[i];
      const b = all[i + 1];
      if (a.depth !== depth || b.depth !== depth || a.kind !== "word" || b.kind !== "word") {
        continue;
      }
      if (KNOWN_PAIRS.some(([x, y]) => x === norm(a.text) && y === norm(b.text))) {
        return [
          { from, to: i + 1, rawText: source.trim() },
          { from: i + 1, to, rawText: source.trim() },
        ];
      }
    }
  }

  const commaIdx = firstTopComma(all, from, to, depth);
  const seps = conjSeparators(all, from, to, depth).filter((sep) => {
    // Comma guard: a conjunction after the first top-level comma connects prep.
    if (commaIdx >= 0 && sep.at > commaIdx) return false;
    // Dash-compound: "Weizen- und …" (the leaf before the separator is a dash,
    // i.e. the preceding token ends with a dash — even across whitespace).
    if (all[sep.at - 1]?.kind === "dash") return false;
    // Color-adjective guard: parallel adjectives modify one downstream noun.
    const before = prevContentWord(all, sep.at, from);
    const after = nextContentWord(all, sep.at + sep.span, to);
    if (before && after && isColorAdjective(before.text) && isColorAdjective(after.text)) {
      return false;
    }
    return true;
  });
  if (seps.length === 0) return single;

  // Overlap guard: a known ingredient name spans the conjunction.
  if (opts.knownIngredients.size > 0) {
    const lower = whole.toLowerCase();
    const baseStart = all[from].start;
    for (const sep of seps) {
      const sepStart = all[sep.at].start - baseStart;
      const sepEnd = all[sep.at + sep.span - 1].end - baseStart;
      let overlapped = false;
      for (const known of opts.knownIngredients) {
        if (known.length < 4 || !known.includes(" ")) continue;
        let pos = lower.indexOf(known);
        while (pos !== -1) {
          if (pos < sepStart && pos + known.length > sepEnd) {
            overlapped = true;
            break;
          }
          pos = lower.indexOf(known, pos + 1);
        }
        if (overlapped) break;
      }
      if (overlapped) return single;
    }
  }

  const ranges = sliceBySeps(all, from, to, seps);
  // Each conjunction member keeps the FULL original line as rawText (not its
  // sub-piece): it links the members into one source-line group and keeps each
  // row's highlightParts (absolute into the line) aligned with what it renders.
  return ranges.map((r) => ({
    from: r.from,
    to: r.to,
    rawText: source.trim(),
  }));
}

void normalizeForMatch;
void isStandaloneDescriptor;

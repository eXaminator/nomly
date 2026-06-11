/**
 * Lossless lexer for ingredient lines.
 *
 * Every non-whitespace character of the (trimmed) source becomes exactly one
 * token carrying its half-open `[start, end)` offset. Whitespace is NOT
 * tokenised — it survives as the gap between adjacent tokens
 * (`source.slice(prev.end, next.start)`), so stitching any subset of tokens
 * back together reproduces the source byte-for-byte. This losslessness is the
 * foundation of the note renderer: notes are sliced from the original string,
 * never reconstructed from normalized pieces.
 */

export type LexKind =
  | "word" // a run of letters (incl. diacritics)
  | "number" // a numeric run (digits / fraction glyphs / digit-flanked . , /)
  | "comma"
  | "semicolon"
  | "slash"
  | "open" // ( or [
  | "close" // ) or ]
  | "dash" // - – —
  | "punct"; // any other single non-space char (* : ! " …)

export type Lexeme = {
  text: string;
  start: number;
  end: number;
  kind: LexKind;
  /** Paren/bracket nesting. An open/close delimiter carries its OUTER depth, so
   *  a root-level `(` has depth 0 and the content inside it has depth 1. */
  depth: number;
  /** True when this token sits inside (or is) a `[ ]` group rather than `( )`. */
  bracket: boolean;
};

const FRACTION_GLYPHS = "½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚⅐⅑⅒";

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isFraction = (ch: string): boolean => FRACTION_GLYPHS.includes(ch);
const isLetter = (ch: string): boolean => /\p{L}/u.test(ch);
const isSpace = (ch: string): boolean => /\s/u.test(ch);

/** Tokenise a (preferably trimmed) source line losslessly. */
export function lex(source: string): Lexeme[] {
  const out: Lexeme[] = [];
  const n = source.length;
  let i = 0;
  let depth = 0;
  const bracketStack: boolean[] = [];

  const push = (start: number, end: number, kind: LexKind): void => {
    out.push({
      text: source.slice(start, end),
      start,
      end,
      kind,
      depth,
      bracket: bracketStack[bracketStack.length - 1] ?? false,
    });
  };

  while (i < n) {
    const ch = source[i];
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(" || ch === "[") {
      const bracket = ch === "[";
      // The delimiter carries the OUTER depth; content gets depth+1.
      out.push({ text: ch, start: i, end: i + 1, kind: "open", depth, bracket });
      bracketStack.push(bracket);
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]") {
      const bracket = ch === "]";
      depth = Math.max(0, depth - 1);
      bracketStack.pop();
      out.push({ text: ch, start: i, end: i + 1, kind: "close", depth, bracket });
      i += 1;
      continue;
    }
    if (ch === ",") {
      push(i, i + 1, "comma");
      i += 1;
      continue;
    }
    if (ch === ";") {
      push(i, i + 1, "semicolon");
      i += 1;
      continue;
    }
    if (isDigit(ch) || isFraction(ch) || (ch === "." && isDigit(source[i + 1]))) {
      // A numeric run keeps digit-flanked separators (German decimal "0,5",
      // fraction "1/2", decimal "1.5") inside the single token; a bare slash or
      // dash is left as its own token. A leading-dot decimal (".5") begins the
      // run at the dot so it isn't mistaken for leading punctuation noise.
      let j = i + 1;
      while (j < n) {
        const c = source[j];
        if (isDigit(c) || isFraction(c)) {
          j += 1;
          continue;
        }
        if (
          (c === "." || c === "," || c === "/") &&
          isDigit(source[j - 1]) &&
          j + 1 < n &&
          (isDigit(source[j + 1]) || isFraction(source[j + 1]))
        ) {
          j += 1;
          continue;
        }
        break;
      }
      push(i, j, "number");
      i = j;
      continue;
    }
    if (isLetter(ch)) {
      let j = i + 1;
      while (j < n && isLetter(source[j])) j += 1;
      push(i, j, "word");
      i = j;
      continue;
    }
    if (ch === "/") {
      push(i, i + 1, "slash");
      i += 1;
      continue;
    }
    if (ch === "-" || ch === "–" || ch === "—") {
      push(i, i + 1, "dash");
      i += 1;
      continue;
    }
    push(i, i + 1, "punct");
    i += 1;
  }
  return out;
}

/** Stitch a token list back into a string using the original inter-token gaps.
 *  `lex(s)` followed by `stitch(s, lex(s))` must equal `s.replace(/^\s+|\s+$/g,"")`
 *  shape — used by tests to assert losslessness. */
export function stitch(source: string, toks: readonly Lexeme[]): string {
  if (toks.length === 0) return "";
  let out = toks[0].text;
  for (let k = 1; k < toks.length; k++) {
    out += source.slice(toks[k - 1].end, toks[k].start) + toks[k].text;
  }
  return out;
}

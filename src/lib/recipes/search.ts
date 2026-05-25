/**
 * Recipe search: token-and-score query parser used by `listRecipes`.
 *
 * Grammar:
 *   token   := [polarity] [field-prefix] (phrase | word)
 *   polarity := "+" | "-"          (default: include)
 *   field-prefix := "zutat:"       (case-insensitive; absent = title field)
 *   phrase  := '"' .*? ('"' | EOL)
 *   word    := non-whitespace, non-quote
 *
 * All token text is ASCII-folded and lowercased so a query like "mohre"
 * matches "Möhre". The same folding runs on each indexed field at match
 * time. See spec §1 in
 * docs/superpowers/specs/2026-05-25-recipe-search-and-diet-filter-design.md.
 */

export type ParsedToken = {
  kind: "title" | "zutat";
  text: string;
  isPhrase: boolean;
  polarity: "include" | "exclude";
};

export type ParsedQuery = { tokens: ParsedToken[] };

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

const FIELD_PREFIX = "zutat:";

export function parseQuery(input: string): ParsedQuery {
  const tokens: ParsedToken[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;

    let polarity: "include" | "exclude" = "include";
    if (input[i] === "+") {
      i++;
    } else if (input[i] === "-") {
      polarity = "exclude";
      i++;
    }

    let kind: "title" | "zutat" = "title";
    if (input.slice(i, i + FIELD_PREFIX.length).toLowerCase() === FIELD_PREFIX) {
      kind = "zutat";
      i += FIELD_PREFIX.length;
    }

    let raw: string;
    let isPhrase = false;
    if (input[i] === '"') {
      isPhrase = true;
      i++;
      const start = i;
      while (i < n && input[i] !== '"') i++;
      raw = input.slice(start, i);
      if (i < n && input[i] === '"') i++;
    } else {
      const start = i;
      while (i < n && !/\s/.test(input[i])) i++;
      raw = input.slice(start, i);
    }

    const text = fold(raw.trim());
    if (text.length === 0) continue;
    tokens.push({ kind, text, isPhrase, polarity });
  }
  return { tokens };
}

export type RecipeSearchIndex = {
  titleFolded: string;
  ingredientsFolded: string;
};

export type MatchResult = { passes: boolean; rank: number };

function levenshtein(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** True when `s` contains `needle` at a word boundary — either it starts at
 *  position 0 / after a non-letter (prefix-of-word), or it ends at the end of
 *  the word / before a non-letter (suffix-of-word). Permits `suppe`
 *  → `tomatensuppe` (German compound suffix) and `basilikum` →
 *  `thai-basilikum` while blocking `reis` → `preiselbeere`. */
function containsAtBoundary(s: string, needle: string): boolean {
  if (needle.length === 0) return true;
  const isLetter = (c: string) => /[\p{L}\p{N}]/u.test(c);
  let from = 0;
  while (from <= s.length - needle.length) {
    const idx = s.indexOf(needle, from);
    if (idx < 0) return false;
    const startsAtBoundary = idx === 0 || !isLetter(s[idx - 1]);
    const endIdx = idx + needle.length;
    const endsAtBoundary = endIdx === s.length || !isLetter(s[endIdx]);
    if (startsAtBoundary || endsAtBoundary) return true;
    from = idx + 1;
  }
  return false;
}

function scoreWord(tokenText: string, word: string): number {
  if (word === tokenText) return 100;
  if (word.startsWith(tokenText)) return 80;
  if (containsAtBoundary(word, tokenText)) return 60;
  const cap = Math.max(1, Math.floor(tokenText.length / 5));
  const d = levenshtein(tokenText, word, cap);
  if (d <= cap) return 40 - 5 * d;
  return 0;
}

export function scoreToken(token: ParsedToken, fieldFolded: string): number {
  if (token.isPhrase) {
    return fieldFolded.includes(token.text) ? 80 : 0;
  }
  let best = 0;
  for (const word of fieldFolded.split(/\s+/)) {
    if (word.length === 0) continue;
    const s = scoreWord(token.text, word);
    if (s > best) best = s;
    if (best === 100) break;
  }
  return best;
}

export function matchRecipe(
  query: ParsedQuery,
  index: RecipeSearchIndex,
): MatchResult {
  let rank = 0;
  for (const token of query.tokens) {
    const field =
      token.kind === "zutat" ? index.ingredientsFolded : index.titleFolded;
    const score = scoreToken(token, field);
    if (token.polarity === "exclude") {
      if (score > 0) return { passes: false, rank: 0 };
    } else {
      if (score === 0) return { passes: false, rank: 0 };
      rank += score;
    }
  }
  return { passes: true, rank };
}

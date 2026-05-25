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

/** A clause is one unit of match logic, ANDed together with other clauses.
 *  An OR-group passes when any of its include tokens score > 0; its
 *  contribution to the rank is the best score in the group. Exclude tokens
 *  never participate in an OR-group — they always stand alone. */
export type ParsedClause =
  | { kind: "single"; token: ParsedToken }
  | { kind: "or"; tokens: ParsedToken[] };

export type ParsedQuery = {
  /** Flat list of every searchable token (OR markers stripped). */
  tokens: ParsedToken[];
  /** Logical clauses ANDed together. OR-groups are kept intact. */
  clauses: ParsedClause[];
};

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

const FIELD_PREFIX = "zutat:";
const OR_KEYWORD = "OR";

type Item = ParsedToken | { kind: "or-marker" };

export function parseQuery(input: string): ParsedQuery {
  const items: Item[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i])) i++;
    if (i >= n) break;

    const rawStart = i;

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

    // Treat a bare "OR" (any case, no polarity, no field prefix, no quotes)
    // as the OR keyword. Inside a phrase the whole quoted span is one token,
    // so a quoted "or" is naturally preserved as a literal word.
    if (
      input.slice(rawStart, i).toLowerCase() === OR_KEYWORD.toLowerCase() &&
      !isPhrase
    ) {
      items.push({ kind: "or-marker" });
      continue;
    }

    const text = fold(raw.trim());
    if (text.length === 0) continue;
    items.push({ kind, text, isPhrase, polarity });
  }

  return buildClauses(items);
}

function buildClauses(items: Item[]): ParsedQuery {
  const tokens: ParsedToken[] = [];
  const clauses: ParsedClause[] = [];
  let idx = 0;
  while (idx < items.length) {
    const item = items[idx];
    if ("kind" in item && item.kind === "or-marker") {
      idx++;
      continue;
    }
    const token = item as ParsedToken;
    tokens.push(token);
    if (token.polarity === "exclude") {
      clauses.push({ kind: "single", token });
      idx++;
      continue;
    }
    const group: ParsedToken[] = [token];
    let look = idx + 1;
    while (look + 1 < items.length) {
      const sep = items[look];
      const next = items[look + 1];
      const isOrSep = "kind" in sep && sep.kind === "or-marker";
      const isIncludeToken =
        !("kind" in next && next.kind === "or-marker") &&
        (next as ParsedToken).polarity === "include";
      if (!isOrSep || !isIncludeToken) break;
      group.push(next as ParsedToken);
      tokens.push(next as ParsedToken);
      look += 2;
    }
    if (group.length === 1) {
      clauses.push({ kind: "single", token });
    } else {
      clauses.push({ kind: "or", tokens: group });
    }
    idx = look;
  }
  return { tokens, clauses };
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

function fieldFor(token: ParsedToken, index: RecipeSearchIndex): string {
  return token.kind === "zutat" ? index.ingredientsFolded : index.titleFolded;
}

export function matchRecipe(
  query: ParsedQuery,
  index: RecipeSearchIndex,
): MatchResult {
  let rank = 0;
  for (const clause of query.clauses) {
    if (clause.kind === "single") {
      const token = clause.token;
      const score = scoreToken(token, fieldFor(token, index));
      if (token.polarity === "exclude") {
        if (score > 0) return { passes: false, rank: 0 };
      } else {
        if (score === 0) return { passes: false, rank: 0 };
        rank += score;
      }
    } else {
      let best = 0;
      for (const token of clause.tokens) {
        const s = scoreToken(token, fieldFor(token, index));
        if (s > best) best = s;
      }
      if (best === 0) return { passes: false, rank: 0 };
      rank += best;
    }
  }
  return { passes: true, rank };
}

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

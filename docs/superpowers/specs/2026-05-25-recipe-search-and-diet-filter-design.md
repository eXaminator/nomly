# Recipe search, diet filter, probable-diet inference — design

**Date:** 2026-05-25
**Status:** Approved (autonomous mode)
**Scope:** Recipe list page (`/rezepte`) and the diet badge wherever it appears.

## Goals

1. **Diet filter on the recipe list** — let the user narrow to vegetarian or vegan recipes.
2. **Google-style search** — tokenized query with quoted phrases, `+`/`-` operators, and a `zutat:` field prefix that searches ingredient names and their aliases. Typo-tolerant.
3. **"Wahrscheinlich Vegetarisch/Vegan"** — when some non-optional ingredients are still untagged, derive a best-effort verdict from the tagged ones and label the badge accordingly.

## Non-goals

- Full-text search across recipe instructions or notes.
- Fuzzy tag matching (the dedicated tag bar already covers tags exactly).
- Persisting search history.
- Re-introducing the "no matcher word lists" pattern — probable-diet inference uses only the existing `ingredient.dietary_class` signal, no name heuristics. (See memory `feedback_no_matcher_word_lists`.)

## Constraints

- Catalog is small (< 500 recipes today, ≤ a few thousand at the upper bound). Full table scans on every keystroke are acceptable and chosen deliberately.
- All filtering moves server-side for consistency. The current client-side tag filter in `RecipeGrid` is collapsed into the same pipeline.
- ASCII-folding for matching: `ä→a`, `ö→o`, `ü→u`, `ß→ss`. Applied once at parse time and once per indexed field so a query like `mohre` matches `Möhre`.

---

## 1. Query parser

New module: `src/lib/recipes/search.ts`.

### Token shape

```ts
type ParsedToken = {
  kind: "title" | "zutat";
  text: string;          // unquoted, lowercased, ASCII-folded
  isPhrase: boolean;     // true when the source token was quoted
  polarity: "include" | "exclude";
};

type ParsedQuery = { tokens: ParsedToken[] };
```

### Grammar

- Whitespace splits tokens unless inside a `"…"` pair.
- Leading `-` on a token (after any prefix) marks it **exclude**. Leading `+` is allowed but redundant (include is the default).
- A `zutat:` prefix (case-insensitive) scopes the token to ingredients. Format: `zutat:<token>` or `zutat:"<phrase>"`. The `-` polarity sits *outside* the prefix: `-zutat:fleisch`.
- Tokens without a prefix have `kind: "title"`.
- A trailing unterminated quote is treated as if closed at end-of-input. An empty token after stripping (`zutat:`, `-`, `""`) is dropped.

### Folding rules

`fold(s)` = `s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ß/g, "ss").toLowerCase()`.

Applied to:
- Each token's `text` at parse time.
- Each recipe's title and per-recipe ingredient text at index-build time.

### Scoring per (token, field)

```
exact equality          → 100
prefix match            →  80
substring match         →  60
Levenshtein(text,field) ≤ max(1, floor(len/5))  →  40 - 5*distance
otherwise                                       →   0
```

For multi-word fields (ingredient index is a `" "`-joined list of names+aliases), the score is the max across each whitespace-separated word in the field. Phrases (`isPhrase: true`) skip the per-word and fuzzy steps: they score `80` if the folded phrase appears as a contiguous substring of the *full* folded field (including the joining spaces), `0` otherwise.

### Recipe-level matching

A recipe **passes** when:
- Every include token has score > 0 against its target field (`title` for `kind: "title"`, ingredient index for `kind: "zutat"`).
- No exclude token has score > 0 against its target field.

A recipe's **rank** = sum of best-per-include-token scores. Ties broken by `title.localeCompare(de)`. Empty `ParsedQuery` → rank ignored.

---

## 2. Diet derivation

Extend `src/lib/recipes/diet.ts`:

```ts
type DietConfidence = "definite" | "probable" | "unknown";

type RecipeDiet = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  confidence: DietConfidence;
};
```

`deriveDiet(classes)` rules (input: non-optional ingredients' `dietary_class`):

| Input shape | Output |
|---|---|
| Any `meat` | `{ vegan: false, veg: false, confidence: "definite" }` |
| Input is empty (no non-optional ingredients) | `{ vegan: true, veg: true, confidence: "definite" }` (vacuous, unchanged) |
| All non-optional tagged, no meat, all `vegan` | `{ vegan: true, veg: true, confidence: "definite" }` |
| All non-optional tagged, no meat, any `vegetarian` | `{ vegan: false, veg: true, confidence: "definite" }` |
| Some `null`, no meat, ≥1 tagged, all tagged are `vegan` | `{ vegan: true, veg: true, confidence: "probable" }` |
| Some `null`, no meat, ≥1 tagged, any tagged `vegetarian` | `{ vegan: false, veg: true, confidence: "probable" }` |
| ≥1 non-optional ingredient, all `null` (no tagged signal) | `{ vegan: null, veg: null, confidence: "unknown" }` |

`RecipeDiet.confidence` is the new bit consumers branch on.

`RecipeListItem` and `RecipeView` both gain `dietConfidence: DietConfidence`.

---

## 3. Service layer

### `ListRecipesOptions` (extended)

```ts
type ListRecipesOptions = {
  query?: string;
  mustTags?: string[];
  notTags?: string[];
  diet?: "vegetarian" | "vegan";
};
```

### `listRecipes` pipeline

1. Load every recipe row (no SQL `LIKE`).
2. Load tag-by-recipe map (existing query).
3. Compute `dietByRecipe` via `computeDietForRecipes` (existing query).
4. **New:** build `ingredientIndexByRecipe: Map<number, string>` — one folded `" "`-joined string per recipe containing every non-optional ingredient's canonical name + each alias. One SQL query that joins `recipe_section → recipe_ingredient → ingredient → ingredient_alias (LEFT)`. Only run when `parsed.tokens` contains at least one `zutat:` token (skip the join cost otherwise).
5. Parse `query` once via `parseQuery`.
6. Iterate recipes and apply filters in order: tags (must/not) → diet → query match. Compute rank when query is non-empty.
7. Sort: by rank desc, then title alpha when query is non-empty; pure title alpha otherwise.
8. Project to `RecipeListItem` including new `dietConfidence`.

The current client-side tag filtering in `RecipeGrid` (`?must=`, `?not=` parsed in the browser) moves entirely server-side. The page already reads `?must` / `?not` from `searchParams` and forwards them to `listRecipes`; the grid becomes a pure renderer.

### Diet filter rule

- `diet === "vegetarian"`: keep recipes where `isVegetarian === true` (covers both definite and probable tiers — `null` is excluded).
- `diet === "vegan"`: keep recipes where `isVegan === true` (both tiers).

---

## 4. UI

### `RecipeSearch` (`src/components/recipes/recipe-search.tsx`)

- Placeholder: `Suche: tomate "rote linsen" zutat:basilikum -nudeln`.
- A small `(?)` button at the right edge opens a popover listing the supported syntax (quotes, `+`/`-`, `zutat:`). Static markdown content — no further behaviour.
- Debounce stays at 200ms. URL writeback stays on `?q=`.

### `DietFilter` (new, `src/components/recipes/diet-filter.tsx`)

- Three-segment toggle: `Alle` / `Vegetarisch` / `Vegan`. Vegetarian uses the same accent as the badge (`--color-warning`); vegan uses `--color-success`.
- Reads `?diet=vegetarian|vegan` from URL params; absent or any other value = `Alle`.
- Writes via `router.replace` keeping other params intact (same pattern as `TagFilterBar`).
- Sits in its own row between the search input and the tag filter bar.

### `RecipeGrid` (`src/components/recipes/recipe-grid.tsx`)

- Becomes a pure render — drop the in-browser `must`/`not` filter. Empty-state copy updated:
  - `Keine Treffer mit den aktuellen Filtern.` when any of `?q`, `?must`, `?not`, `?diet` is active.
  - `Noch keine Rezepte – jetzt das erste anlegen.` otherwise.
- Counter line stays.

### `RezeptePage` (`src/app/rezepte/page.tsx`)

- `searchParams` now includes `must`, `not`, `diet` alongside `q`. All four are forwarded to `listRecipes`.
- Renders `<DietFilter />` between `<RecipeSearch />` and `<TagFilterBar />`.

### `DietBadge` (`src/components/recipes/diet-badge.tsx`)

- Signature gains `confidence: DietConfidence`.
- For `confidence === "definite"`: today's appearance, label `Vegan` / `Vegetarisch`.
- For `confidence === "probable"`: label `Wahrscheinlich Vegan` / `Wahrscheinlich Vegetarisch`. Visual treatment: same icon and accent colour, but the background mix is replaced with a 1px dashed border (`border-dashed border-[accent]`) and a transparent background so it reads as "not certain".
- For `confidence === "unknown"`: render nothing (today's fallback).
- Used in both the recipe card and the recipe detail page — both call sites pass `confidence` from the service.

---

## 5. Wiring

- `listRecipes` consumers: only `RezeptePage` today (verified). The Familywall importer's own list logic is unrelated.
- `getRecipe` also returns `dietConfidence` (uses the same updated `deriveDiet`). The detail page passes it to `DietBadge`.
- Memory note `range_high_bound` is unrelated; `prep_vs_identity_tokens` is unrelated; `no_matcher_word_lists` is *honoured* — no new word lists.

---

## 6. Tests

New / extended Vitest suites:

- `tests/search-parser.test.ts` — token splitting, quoted phrases, `+`/`-`, `zutat:`, mixed `-zutat:` exclusion, malformed input (empty quote, prefix-only token).
- `tests/search-scoring.test.ts` — exact > prefix > substring > fuzzy ranking, threshold edges (`max(1, len/5)`), ASCII folding (`möhre` ↔ `mohre`, `straße` ↔ `strasse`), phrase contiguity.
- `tests/diet.test.ts` (extend) — confidence tiers for all six rule rows, including the "no tagged ingredients" case and the "optional-only meat" edge.
- `tests/recipes-service.test.ts` (new) — end-to-end on `listRecipes`:
  - Plain query against title.
  - `zutat:` matches canonical and alias.
  - `+`/`-` semantics.
  - `diet=vegetarian` includes probable + definite, excludes unknown.
  - Combined `query` + `diet` + `must`/`not`.
  - Empty-query path still returns title-sorted.

---

## 7. File touch list

**New:**
- `src/lib/recipes/search.ts` — parser, folder, scorer.
- `src/components/recipes/diet-filter.tsx` — three-segment toggle.
- `tests/search-parser.test.ts`, `tests/search-scoring.test.ts`, `tests/recipes-service.test.ts`.

**Modified:**
- `src/lib/recipes/diet.ts` — confidence field.
- `src/lib/recipes/service.ts` — pipeline rewrite + ingredient index loader + `dietConfidence` in projection.
- `src/lib/recipes/types.ts` — `dietConfidence` on `RecipeListItem` and `RecipeView`; `RecipeDiet` re-export.
- `src/components/recipes/recipe-search.tsx` — placeholder + syntax help.
- `src/components/recipes/recipe-grid.tsx` — strip client tag filter, update empty state.
- `src/components/recipes/diet-badge.tsx` — confidence-aware rendering.
- `src/app/rezepte/page.tsx` — forward all four params, render `DietFilter`.
- `src/app/rezepte/[id]/page.tsx` — pass `dietConfidence` to badge.
- `tests/diet.test.ts` — extended cases.

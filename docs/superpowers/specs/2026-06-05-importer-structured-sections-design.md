# URL Importer: Structured Section Detection

**Date:** 2026-06-05
**Status:** Approved

## Problem

Pages like https://cozypeachkitchen.com/veggie-reuben-with-quick-pickled-cabbage/ present
their recipe in named groups ("Quick Pickled Cabbage", "Horseradish Sauce", "Vegetarian
Reuben"), but the importer flattens them into a single unnamed section. Two causes:

1. **JSON-LD `recipeIngredient` is flat.** schema.org has no concept of ingredient groups,
   so the group headers never appear in the array and `detectSectionHeader()` has nothing
   to detect.
2. **JSON-LD `recipeInstructions` HAS sections** (`HowToSection` objects with `name` +
   nested `HowToStep`s), but `asStringList()` recurses into `itemListElement` and drops
   the section names.

The HTML, however, carries full ingredient grouping: the page uses WP Recipe Maker
(`.wprm-recipe-ingredient-group` with `.wprm-recipe-group-name` headers). Tasty Recipes
and Mediavine Create — the other dominant WordPress recipe plugins — have equivalent
markup.

## Approach (Option B: structured plumbing)

Recover sections from two independent signals and feed them through the existing
section pipeline as **pre-grouped structures** rather than synthetic header lines:

- Instruction sections from JSON-LD `HowToSection` (plugin-agnostic).
- Ingredient groups from plugin-specific HTML markup, aligned against the flat JSON-LD
  ingredient list.

The existing `mergeIngredientAndInstructionSections()` joins both by normalized title —
unchanged.

## Components

### 1. `json-ld.ts`: `asInstructionGroups()`

```ts
asInstructionGroups(v: unknown): { title: string | null; lines: string[] }[]
```

- Walks `recipeInstructions`. A `HowToSection` (object with `itemListElement` array)
  becomes a group titled by its `name`; loose `HowToStep`s/strings accumulate into a
  current unnamed group.
- No sections present → a single `{ title: null, lines }` group (downstream behavior
  identical to today).
- Section names and step text go through the existing `clean()` entity handling.
- `asStringList()` stays for all other callers.

### 2. New `html-groups.ts`: plugin ingredient-group extractors

```ts
type HtmlIngredientGroup = { title: string | null; items: string[] };
extractIngredientGroupsFromHtml(html: string): HtmlIngredientGroup[] | null;
```

- Per-plugin extractors tried in order: WP Recipe Maker, Tasty Recipes, Mediavine
  Create. First extractor yielding ≥1 **titled** group wins; otherwise `null`.
  (Exact Tasty/Create selectors verified against real fixture pages during
  implementation.)
- Each extractor scopes to the **first recipe container** for its plugin — WPRM pages
  carry the group markup twice (card + fallback/print copy); duplicates must not
  concatenate.
- Parsed with **`node-html-parser`** (new runtime dependency: small, zero transitive
  deps). Regex is too brittle for three plugins' nested markup; jsdom is dev-only and
  too heavy for the request path.
- Any extraction failure degrades to `null` → current flat behavior.

### 3. Alignment in `importRecipeFromUrl()`: HTML gives boundaries, JSON-LD gives text

If HTML groups were found **and** the groups' total item count equals
`recipeIngredient.length`, slice the flat JSON-LD list by group sizes into
`{ title, lines[] }[]`. The JSON-LD strings remain what the ingredient parser
consumes (it is tuned for them). On any count mismatch: fall back to the flat list.
Strictly additive; never guesses.

### 4. `index.ts`: grouped parsing variants

- `parseIngredientLinesIntoSections()` is refactored so its body iterates pre-grouped
  input `{ title, lines[] }[]`. The flat signature stays as a thin wrapper passing
  `[{ title: null, lines }]`. Inner logic (expansion, conjunction splitting, matching,
  alternatives folding, `applyAlternativeInheritance`) is untouched.
- Within **trusted** groups (boundaries known from HTML/JSON-LD structure), the
  raw-line-level `detectSectionHeader()` check is skipped — an item ending in `:`
  cannot spuriously split a structurally-known group. The text-heuristic (flat) path
  keeps it. Inner-loop header emission from `expandIngredientLine()` and the defensive
  colon fallback stay active in both modes.
- `parseInstructionsIntoSections()` gets the same treatment: when fed titled groups
  from `asInstructionGroups()`, step lines are taken verbatim (no header re-detection
  inside trusted groups).
- `mergeIngredientAndInstructionSections()` unchanged.

## Expected result for the reference page

3 merged sections — "Quick Pickled Cabbage" (7 ingredients), "Horseradish Sauce" (5),
"Vegetarian Reuben(s)" (7) — each with its matching instruction steps. (Ingredient
groups say "Vegetarian Reuben", instructions "Vegetarian Reubens"; if the
normalized-title merge treats these as distinct, the instruction group becomes its own
ingredient-less section — acceptable, user fixes in review. No fuzzy matching added.)

## Error handling

- HTML extraction wrapped; any throw → `null` → flat fallback.
- JSON-LD remains required (`noRecipe` error unchanged); HTML only ever refines it.

## Testing

- `asInstructionGroups`: sections / flat strings / mixed / single object.
- Each plugin extractor against trimmed checked-in HTML fixtures.
- Alignment: exact count match slices; mismatch falls back flat.
- Grouped parse variants: trusted groups don't re-split on `:`; flat wrapper is
  behavior-identical (existing tests pass unchanged).
- End-to-end: cozypeachkitchen fixture → 3 sections, correct titles, ingredient
  counts, instructions in the right sections.

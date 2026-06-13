# Unspecific Units — Design

**Date:** 2026-06-13
**Status:** Approved for planning

## Problem

Some units carry no measurable amount: "etwas" (Öl), "a sprinkle" (of salt),
"ein Schuss". Today the parser is forced to invent `quantity = 1` whenever it
matches a unit with no explicit number (`amount-unit.ts:258,284`), so these
phrases either get a bogus quantity or the unit word is left stranded in the
ingredient name. There is no way to say "this unit takes no amount".

## Goal

Let a unit be marked **unspecific**. An unspecific unit is dimensionless and
amount-less: it does not expect — and does not allow — a quantity. Used for
units like "etwas" / "a sprinkle" / "ein Schuss".

## Decisions (from brainstorming)

- **Number + unspecific unit** (e.g. "2 etwas Salz"): the unit's "no amount"
  rule always wins — drop the number, `quantity` stays `null`.
- **Leading articles** ("a sprinkle", "ein Schuss"): handled via **multi-word
  aliases**, not generic article-swallowing. This requires multi-token unit
  matching, which does not exist today and is added here.
- **Shopping list**: two contributions of the same ingredient + same unspecific
  unit **collapse to one line** with no quantity.
- **Schema model**: a single **boolean flag** on `unit`, not a new dimension and
  not a nullable dimension.

## Data model

Add one column to the `unit` table (`src/db/schema.ts`):

```
unspecific: integer("unspecific", { mode: "boolean" }).notNull().default(false)
```

Migration: new head `0038`. The column is added with a default of `false`, so
all existing units are unaffected and the migration applies cleanly on prod
container start (no manual steps).

When `unspecific = true` the unit is dimensionless and amount-less.
`dimension`, `factor`, and `baseUnitId` are meaningless for it: we keep
`dimension` non-null (store the harmless default `"count"`), and force
`factor = 1` and `baseUnitId = NULL` on save. **The `unspecific` flag — not the
dimension — is what every consumer checks.**

## Parser behavior (`src/lib/recipe-import/ast/passes/amount-unit.ts`)

### Strict multi-token unit matching

Today `isUnit` probes a single whitespace group against `knownUnitTokens`
(`amount-unit.ts:109-110`). We add a multi-token probe at the unit position that
mirrors the ingredient matcher (`matching.ts`) but is **stricter**:

- Tries the longest contiguous window first, down to a single token; takes the
  longest exact match.
- **Exact token equality only** — no prefix/suffix matching, no fuzzy
  edit-distance, no interior gaps, no token reordering, no post-comma discount.
  (These are exactly the lenient features the ingredient matcher has that we
  deliberately omit.)
- Tokens normalized through the existing pipeline (`normalizeForMatch` /
  `canonicalizeMatchToken`) so matching is consistent with the rest of the AST.

### Window size is self-tuning

When the unit lookup set is built (alongside `knownUnitTokens`, see
`src/lib/recipe-import/index.ts` where `lookups.units.byNameOrAlias` feeds the
token set), also compute:

```
maxUnitTokens = max token-count across all unit names + aliases
                (tokenized through the same normalization pipeline)
```

The strict probe tries windows from `maxUnitTokens` down to `1`. A single-word
catalog needs no multi-token probing; adding the alias `"a sprinkle"` (2 tokens)
automatically raises the window to 2. The matcher never scans wider than the
widest real unit.

### Unspecific outcome

- The multi-token probe replaces / wraps the existing single-token unit
  detection (the size-modifier skip loop at `amount-unit.ts:245-267` still runs;
  the probe is the unit check inside it). The trailing single-token fallback
  (`amount-unit.ts:351`) is updated to use the same matcher.
- When the matched unit is **unspecific**:
  - `quantity` is forced to `null` (never the `quantity = 1` default).
  - Any explicit number parsed in front of it is **dropped** (not carried to
    notes).
  - The matched token(s) are consumed/stripped from the ingredient name as
    usual; `unitName` is set to the matched unit.
- `fixedAmount` is already auto-set to `true` whenever `quantity === null`
  (`index.ts:238`, `953`, `1605`), so unspecific rows are non-scaling for free.

## Editor & management UI

### Unit form (`src/components/settings/stammdaten/edit-forms/unit-form.tsx`)

- Add an **"Unspezifisch"** switch (same pattern as the existing `isContainer` /
  `displayFraction` switches), with help text explaining it marks units that take
  no amount (etwas, a sprinkle, ein Schuss).
- When the switch is on, **hide/disable** the Dimension, Basis-Einheit, and
  Faktor fields — they are irrelevant.
- Wire `isUnspecific` into form state and into the payload sent to the manage
  API.

### Manage API (`src/app/api/v1/units/manage/route.ts`)

- `upsertSchema` gains `unspecific: z.boolean().default(false)`.
- When `unspecific === true`, the service normalizes the stored row:
  `factor = 1`, `baseUnitId = null` (dimension keeps its default). This keeps the
  invariant true regardless of what the client sends.

### Ingredient edit row

- When the selected unit is unspecific, **disable the amount input** and store
  `quantity = null` + `fixedAmount = true`.
- Switching the unit away from an unspecific one re-enables the amount field.
- (Exact component pinned during planning — the row that currently edits
  quantity + unit on a recipe ingredient.)

## Display & shopping list

### Display

Already correct: `formatQuantity(null)` returns `""`
(`ingredient-read-line.tsx:14-27`), so "etwas Öl" renders with no number.
Plural never triggers for unspecific units (`pluralizeLabel` needs
`quantity > 1`). Verify only — no code change expected.

### Shopping list — collapse to one entry

Aggregation groups by `ingredientId` (`src/lib/shopping/merge.ts:135-140`), then
`buildAggregatedAmounts` (`src/lib/shopping/items.ts`) buckets contributions by
unit. An unspecific unit carries a non-null `unitId` and `quantity = null`.

Required behavior: a bucket whose contributions are all null-quantity for the
same (ingredient, unspecific unit) must yield **exactly one** line with **no
quantity** (not `0`). Verify the existing non-null-unit bucket path produces
`quantity: null` for an all-null bucket; adjust `buildAggregatedAmounts` if it
currently emits `0` or one line per source. Result: two meals' "etwas Öl" merge
into a single "Öl — etwas" line. (An "etwas Öl" alongside a "200 ml Öl" stays as
two lines, as expected — dimensionless can't merge with ml.)

## Testing

Parser (`amount-unit` / import tests):
- Single-token unspecific: "etwas Öl" → `unitName = "etwas"`, `quantity = null`,
  `fixedAmount = true`, ingredient = "Öl".
- Multi-word alias: "a sprinkle of salt" and "ein Schuss Öl" match the unspecific
  unit via alias; quantity null.
- Number dropped: "2 etwas Salz" → quantity null (number not carried to notes).
- Strict-matcher negative: a near-miss multi-word phrase (e.g. partial overlap,
  wrong order, or an extra interior token) does **not** match the multi-word
  alias.
- `maxUnitTokens` is derived from the catalog (adding a 2-token alias enables
  2-token probing).

Aggregation (`shopping`):
- Two unspecific contributions of the same ingredient collapse to one
  null-quantity line.
- An unspecific contribution plus a dimensional one for the same ingredient
  stay as two lines.

Form / API:
- `unspecific = true` normalizes `factor = 1`, `baseUnitId = null`.

## Out of scope

- Seeding specific unspecific units (etwas, a sprinkle, …) — the user adds them
  via the unit management UI. We may seed "etwas" as a convenience, decided in
  planning.
- Any richer "unspecified amount" amount model beyond the existing null-quantity
  path (tracked separately in the backlog).

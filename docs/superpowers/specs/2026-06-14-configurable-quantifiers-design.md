# Configurable Quantifiers — Design

**Date:** 2026-06-14
**Status:** Approved design; ready for planning

## Problem

The amount slot of an ingredient can only hold a *number* (`quantity`, plus
`quantity_low` for a range). Two things suffer:

1. **Unspecified counts are misrepresented.** `einige Stiele Petersilie` parses
   to `1 Stiele` — the parser invents "1" because `Stiel` is a unit and `einige`
   isn't a number. "Several" silently becomes "one".
2. **Number-words are a hardcoded code list.** `TEXT_ONE`, `TEXT_HALF`,
   `TEXT_QUARTER`, `WRITTEN_CARDINALS` (~40 entries across `amount-unit.ts`) live
   in code — the same kind of vocabulary list the catalog work has been removing.

## Goal

A **configurable `quantifier`** concept: amount-words that occupy the *amount*
slot. Each quantifier optionally maps to a numeric value:

- **Numeric** (`zwei`→2, `a`→1, `ein halber`→0.5): an input spelling of a number.
- **Unspecified** (`einige`, `ein paar`, `mehrere`, `some`): no numeric value;
  a real unit may still follow (`einige **Stiele**`).

This kills the hardcoded number-word lists (they become seed rows) and lets the
amount slot hold a non-numeric quantifier while everything downstream keeps
working off a single derived number.

### Distinction from the existing `unspecific` unit (`Etwas`)
- **`Etwas` lives in the *unit* slot** (`unit.unspecific = true`): it *replaces*
  the unit and forbids an amount. You never say "etwas Stiele".
- **A quantifier lives in the *amount* slot**: it replaces the *number* and a
  real unit may still follow. `some` is **both** — an unspecific unit *and* a
  quantifier — resolved by the rule below.

### Non-goals
- Digit/fraction/range/decimal **syntax** (`2`, `1/2`, `0,5`, `2-3`, `1 1/2`,
  Unicode `½`) stays in the numeric parser — closed grammar, not vocabulary.
- Approx markers (`ca.`, `etwa`, `about`) stay in code — not amounts.
- `SIZE_MODIFIERS`, `POST_UNIT_CONNECTORS`, the no-match-namer `VAGUE_WORDS` are
  untouched (separate concerns).
- A quantifier is single-valued (a number **or** null) — never itself a range.

## Data model

### New tables (mirror `unit` / `unit_alias`)
```
quantifier
  id            integer pk
  name          text not null unique         -- canonical, e.g. "einige", "zwei"
  value         real                          -- numeric value, NULL = unspecified
  sort_order    integer not null default 0
  created_at    integer not null default (unixepoch())

quantifier_alias
  id            integer pk
  quantifier_id integer not null → quantifier(id) on delete cascade
  name          text not null unique
```
Multi-word names/aliases are allowed (`ein paar`, `a couple of`, `ein halber`),
matched with the same widest-window probe units already use (`maxTokens`).

### Reference on the amount
```
recipe_ingredient
  + quantifier_id integer → quantifier(id) on delete RESTRICT
```
`ON DELETE RESTRICT` is the DB backstop for the delete-guard; the service refuses
deletion while referenced and the UI mirrors it (below).

### Representation rule (one amount per row)
A row's amount is **exactly one** of:
- a literal number: `quantity` set (`quantity_low` set too for a range),
  `quantifier_id` null; **or**
- a quantifier: `quantifier_id` set, `quantity` and `quantity_low` null.

We store **only** the reference for a quantifier — never a denormalized copy of
its value — so there is a single source of truth and editing a quantifier's
`value` flows to its rows.

### Effective value (the single derivation everything reads)
```
effectiveQuantity(row, quantifierById) =
  row.quantity ?? quantifierById.get(row.quantifierId)?.value ?? null
```
- literal `2` → 2 · `zwei`(value 2) → 2 · `einige`(value null) → null · none → null.

## Recognition & resolution (parser)

A new **quantifier pass** runs in `parseLeaves` between `applyLeadingNotePhrase`
and the amount/unit pass. It reads a DB-driven `quantifiers` lookup added to
`ParseLookups` (built like `buildUnitLookup`).

**Resolution rule** (unit-first, then quantifier-wins-unless-it-strips-the-unit):
1. Units are detected as today (this already sees `some` as an unspecific unit
   and `sprigs`/`Stiele` as a unit).
2. A **leading** token the quantifier table knows becomes the **amount** unless
   doing so leaves the amount/unit region with no unit. Precisely: it's a
   quantifier if it isn't a unit at all, **or** it's a unit but another unit
   token follows it to serve as the real unit.

| Line | Outcome |
|---|---|
| `einige Stiele Petersilie` | amount `einige`(null) · unit `Stiele` · `Petersilie` |
| `some sprigs` | `some` not the only unit → amount `some` · unit `sprigs` |
| `some bananas` | `some` is the only unit → stays unit `some`, name `bananas` |
| `zwei Äpfel` | `zwei`(2) → amount(ref zwei) · `Äpfel` |
| `a pinch of salt` | `a`(1, not a unit) → amount(ref a, eff 1) · unit `pinch` · `salt` |

**Numeric word-lists migrate into seed quantifiers.** `TEXT_ONE`/`TEXT_HALF`/
`TEXT_QUARTER`/`WRITTEN_CARDINALS` are deleted from `amount-unit.ts`; the amount
pass instead consults the quantifier lookup for word-forms. A recognized
numeric quantifier produces a `quantifier_id` reference whose `value` is the
number (so `zwei` round-trips as a reference, not a bare `2`). Digit/fraction/
range syntax is unchanged.

## Display, aggregation, scaling (read the effective value)

- **Render** (`ingredient-read-line.tsx` `formatAmount`/`formatQuantity`,
  recipe detail, planner preview, embed): if the effective value is a number,
  show the number (fractions via the existing `toFractionDisplay`, ranges via
  `quantity_low`); if null **and** a quantifier is referenced, show the
  quantifier **name** (`einige Stiele Petersilie`). The reference is invisible
  here — `zwei Äpfel` displays as `2 …`.
- **Shopping aggregation** (`shopping/items.ts` `buildAggregatedAmounts`,
  `units/convert.ts`): use the effective value. A null effective value behaves
  exactly like today's null-quantity rows — added as a check-off, contributes 0,
  cannot merge numerically.
- **Scaling** (`meal-plans/service.ts`, `shopping/merge.ts`): scale the effective
  value. A numeric quantifier scales like any number (`zwei Äpfel` ×2 → 4, shown
  as `4` — the reference is irrelevant to the scaled display). A null effective
  value never scales. Snapshot tables (`shopping_item_source.contributed_quantity`)
  store the *resolved effective number*, so the shopping pipeline needs no
  quantifier awareness beyond the snapshot step.

## Recipe edit form & validation

- The amount field accepts **a number-expression OR a known quantifier**, nothing
  else (validated). It reuses the *same* recognizer the importer uses, so the
  field and the parser never diverge. The edit form is the one place that shows
  the **wording** (`zwei`, `einige`) rather than the resolved number.
- Typing `2` over `zwei` drops the reference (literal `quantity=2`); typing
  `einige` sets `quantifier_id`, clears `quantity`.
- `DraftIngredient` gains `quantifierId: number | null`; `payload.ts` serializes
  it; `validate.ts` enforces: at most one of {numeric quantity, quantifier};
  a quantifier may still carry a unit (unlike `unspecific` units).

## Mass-parse diff

- Each side renders the **effective number** (reads like the recipe), but the
  diff **equality key is the representation** `(quantity, quantity_low,
  quantifier_id)` — so literal `2` vs `zwei` (ref) is a flagged change even
  though both show "2".
- When a side references a quantifier, its amount gets a dotted-underline
  **hover tooltip** revealing the quantifier name, mirroring the existing
  matched-ingredient tooltip on the name (`ingredient-line.tsx` Popover). This is
  exactly the migration scenario: old rows are literal numbers (wording lost), a
  reparse re-discovers `zwei`, and the diff shows `2`→`2` flagged, tooltip "zwei".

## Management UI (Stammdaten)

Mirror the unit management stack:
- **Service** `src/lib/stammdaten/quantifier/service.ts`: list/get/create/update/
  delete + `recipeRefCount` via `count(recipe_ingredient.quantifier_id)` + linked
  recipes; **delete blocked while `recipeRefCount > 0`** (and a replace-with-other
  option, like units). Merge adapter rewiring `recipe_ingredient.quantifier_id`.
- **API** `/api/v1/quantifiers/manage`(`/[id]`)(`/impact`): GET/POST/PATCH/DELETE
  mirroring units; `publishShoppingChanged()` on mutation (value edits change
  aggregates).
- **UI** a Stammdaten list page + edit form (name, value, aliases, sort) with the
  "used in N recipes" column and the existing delete-dialog impact/replace flow.
  Add `"quantifier"` to the `EntityKind` enum + `pluralFor`.

## Migration & seed

- **Migration** `0041`: create `quantifier` + `quantifier_alias`, add
  `recipe_ingredient.quantifier_id`. **Prefill** the seed set (cardinals,
  articles→1, word-fractions→0.5/0.25/0.75, vague words→null) — prefer the seed
  script (`src/db/seed-data/quantifiers.ts` + `runSeed`) for the catalog, with the
  migration only creating structure, matching how units are handled.
- **Existing data is not back-filled.** Rows already collapsed `zwei`→`2`; they
  stay literal numbers. Only a re-parse re-introduces references — which is
  precisely what the diff tooltip surfaces for review.

### Seed set (initial)
- value 1: `ein/eine/einen/einem/einer/eins`, `a`, `an`, `one`
- 2–12: `zwei…zwölf`, `two…twelve`
- fractions: `ein halber`/`halbe…`→0.5, `viertel`/`quarter`→0.25, `dreiviertel`→0.75
- unspecified (value null): `einige`, `ein paar`, `mehrere`, `some`, `a few`,
  `a couple of`

## Edge cases & decisions
- **Editing a quantifier's `value`** retroactively changes every referencing row
  (single-source). Accepted; rare; surfaced by `publishShoppingChanged()`.
- **Numeric quantifier + range** is not representable (quantifier is single-valued);
  ranges always use literal `quantity`/`quantity_low`.
- **`a`/`an`/`ein` overlap** between "value-1 quantifier" and the existing
  article-drop-after-fraction syntax: recognition of the standalone word moves to
  the quantifier lookup; the "drop a bare article sitting after a fraction" tidy
  stays as numeric syntax.
- **`some` dual role** is handled entirely by the resolution rule; it's seeded as
  both an unspecific unit (existing) and a quantifier (new).

## Testing strategy
- Parser unit tests for the resolution rule (the table above), numeric-word
  round-trip via seed quantifiers, and "no unit invented for `einige`".
- Effective-value unit tests (display/scale/aggregate) incl. null behavior.
- Validation tests (mutual exclusivity; quantifier+unit allowed).
- Service tests (refCount, delete-guard, merge rewire).
- The existing parser parity/golden suites must stay green (number-words still
  parse to the same values, now via the DB).

## Phased rollout
1. **Schema + seed + lookup** (no behavior change; lookup unused).
2. **Parser**: quantifier pass + resolution rule; migrate number-word lists to the
   lookup; thread `quantifierId` through `ParsedRow`/`ImportedIngredient`.
3. **Persistence**: payload/validate/service write+read `quantifier_id`;
   effective-value helper.
4. **Display + scaling + aggregation** read the effective value.
5. **Edit form** amount field (number-or-quantifier) + validation.
6. **Mass-parse diff** effective number + representation-diff + tooltip.
7. **Stammdaten management** UI + service + API (usage tab, delete-guard, merge).

Each phase keeps the suite green and is independently shippable.

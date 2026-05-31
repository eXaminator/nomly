# Configurable plurals for units, aliases, and sub-units

**Date:** 2026-05-31
**Status:** Approved, implementing autonomously

## Goal

Each unit, unit alias, and ingredient sub-unit gets a primary singular name and an
optional plural string. Both the singular and the plural are matched against
ingredient text during import. At display time, when a plural is configured it is
used for any amount **other than 1**; amount `1` (and `null`) uses the singular.

## Decisions (from brainstorming)

1. **Display source:** the *matched label* drives display. If a recipe used the alias
   "Esslöffel", that alias's singular/plural is shown; if it used the canonical, the
   canonical's. Resolution happens at display time (no new `recipe_ingredient` column,
   no recipe-row backfill, always reflects current edits).
2. **Sub-unit hardcoded plural rule is removed.** The suffix-generation rule in
   `buildSubUnitLookup` (append `n`/`e`) is dropped; matching uses the configured
   plural only. To avoid an import/reparse regression for existing sub-units, a
   one-time data backfill seeds `ingredient_sub_unit.plural` using that same rule
   (`e`-ending → `+n`, else → `+e`).
3. **Built-in units ship with empty plurals.** No seed change beyond the new columns;
   no behavior change until a plural is configured.
4. **Sub-unit management:** a dedicated cross-ingredient Stammdaten list page
   ("Untereinheiten") using the standard `ListShell` + drawer-form pattern (Stammdaten
   has no inline editing). Edits are id-stable `UPDATE`s; delete is usage-guarded.

## Data model

Add nullable `plural text` to three tables (`src/db/schema.ts`):

- `unit.plural`
- `unitAlias.plural`
- `ingredientSubUnit.plural`

Migration `0026_*` (drizzle-kit generate) adds the columns, plus a hand-added data
backfill:

```sql
UPDATE ingredient_sub_unit
SET plural = CASE WHEN lower(name) LIKE '%e' THEN name || 'n' ELSE name || 'e' END
WHERE plural IS NULL AND name <> '';
```

Migrations auto-run on container start (clean-migrations rule). Backfill is idempotent
(`WHERE plural IS NULL`).

## Matching (`src/lib/recipe-import/index.ts`)

- `buildUnitLookup`: select `unit.plural` and `unitAlias.plural`; index each non-empty
  plural as an additional key → same `UnitLookupEntry` (don't overwrite an existing
  key; canonical/alias singulars win).
- `buildSubUnitLookup`: select `plural`; index `name` + configured `plural` only.
  Remove the `+n`/`+e` suffix rule (lines 314–321).
- `subUnitTokenSet`: unchanged (it flattens whatever keys the lookup holds).
- `resolveUnit`: unchanged — `rawUnit` already preserves a plural-cased source token.

## Display label resolver (new `src/lib/units/label.ts`)

Pure, unit-tested function:

```ts
type LabelForm = { name: string; plural: string | null };
type UnitLabelInfo = LabelForm & { aliases: LabelForm[] };

function pluralizeLabel(form: LabelForm, quantity: number | null): string;
// quantity !== 1 && plural set → plural; else name.

function resolveUnitLabel(opts: {
  unit: UnitLabelInfo | null;
  subUnit: LabelForm | null;
  displayUnit: string | null;
  quantity: number | null;
}): string | null;
```

Rules:
- `subUnit` set → `pluralizeLabel(subUnit, qty)`.
- else find the matched label: if `displayUnit` is null → canonical unit; else match
  `displayUnit` (case-insensitive) against the unit's name/plural and each alias
  name/plural. Found → `pluralizeLabel(matched, qty)`. Not found (free text) →
  `displayUnit` verbatim.
- no unit at all → null.

## Recipe read view (`src/lib/recipes/service.ts` ~394)

Replace the SQL `coalesce(displayUnit, subUnitName, unitName)` with explicit columns
(`unit.name`, `unit.plural`, `displayUnit`, `subUnit.name`, `subUnit.plural`,
`quantity`), load the aliases (name+plural) for the recipe's units into a map, and
compute the per-row label via `resolveUnitLabel`. The view model keeps `unitName` as a
string; `ingredient-read-line.tsx` is unchanged. Manually-entered units (displayUnit =
canonical name) pluralize because the canonical name resolves to its plural.

## Shopping display (`src/lib/shopping/items.ts`, `shopping-item-row.tsx`)

Shopping uses canonical units / sub-unit names (no `displayUnit`), so a simpler call:
fetch `unit.plural` / `subUnit.plural` and pluralize aggregated amounts and source
lines by their quantity.

## Stammdaten unit UI

- `unit-form.tsx`: add "Plural (optional)" for the canonical name; the alias editor
  becomes singular + optional-plural pairs per alias.
- `lib/stammdaten/unit/service.ts`: persist `unit.plural` and per-alias `plural`; fold
  plurals into the existing collision / "virtually-identical aliases" warning so a
  plural can't silently shadow another unit's token.
- API payload/types updated.

## Ingredient sub-unit UI (`ingredient-form.tsx` ~501, payload, ingredient service)

Add "Plural (optional)" next to name / perPurchase; persist on save.

## Sub-unit master-data page

- Nav: new `Untereinheiten` entry in `STAMMDATEN_LINKS`
  (`src/app/(app)/einstellungen/page.tsx`).
- Route: `src/app/(app)/einstellungen/untereinheiten/page.tsx`.
- Service `src/lib/stammdaten/sub-unit/service.ts`: `listSubUnitsManaged()`
  (join `ingredient` for the owning name, usage count via `recipeIngredient.subUnitId`),
  id-stable `updateSubUnit()`, usage-guarded `deleteSubUnit()`. **Must not** use the
  ingredient form's delete-all-reinsert path — update the row by id so
  `recipeIngredient.subUnitId` references survive.
- UI: `subunit-page-client.tsx` (`ListShell`, columns *Zutat · Untereinheit · Plural ·
  pro Einkauf · Verwendung*) + `subunit-form.tsx` drawer (name / plural / perPurchase).
- API: `/api/v1/ingredients/sub-units/manage` + `[id]` (GET/PATCH/DELETE).

## Testing

- `tests/` unit tests for `resolveUnitLabel` / `pluralizeLabel` (qty 1 vs ≠1, alias
  plural, canonical plural, sub-unit plural, free-text fallback, missing-plural
  fallback, null qty).
- Matching tests: "Dosen"→Dose, plural alias matches, sub-unit configured plural
  matches; extend `tests/ingredient-matching.test.ts` / `tests/reparse-scan.test.ts`.
- Sub-unit service tests: list shape + usage count, id-stable update, delete guard.
- `npm run test`, `npm run typecheck`, and `npm run build` (RSC boundaries) before push.

## Risks / notes

- The ingredient-form save path replaces a row's sub-units wholesale (new ids), which
  can null recipe references — pre-existing behavior, out of scope. The new dedicated
  update path is deliberately id-stable.
- Plural tokens entering the matching lookup must not overwrite existing singular keys;
  insert-if-absent only.

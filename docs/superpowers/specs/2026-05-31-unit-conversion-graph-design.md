# Per-ingredient unit conversion graph (replaces sub-units)

**Date:** 2026-05-31
**Status:** Approved, implementing on branch `feat/ingredient-custom-units`
(reshapes the earlier sub-unit/parent work on the same branch — not yet merged).

## Idea

Drop "sub-units" as a concept. Every unit is global. Conversions live in one
graph per ingredient, made of:

- **Global edges** — a unit's dimension factor (`1 TL = 5 ml`), within a
  dimension. (Existing `unit.factor` / `unit.baseUnitId`.)
- **Per-ingredient edges** — arbitrary conversions, including cross-dimension
  (`1 ml = 0,5 g` for Zimt) and container conversions (`1 Packung = 4 Stangen`).

Two phases, deliberately distinct:

- **Normalization** — per contribution, follow edges down to a component's
  **base** unit, *before* aggregation, so amounts sum correctly.
- **Container conversion** — applied **after** the per-component sum, ceiling
  the total to whole containers ("buy whole packs").

## Model

A per-ingredient conversion is a row `1 fromUnit = factor × toUnit` plus an
`isContainer` flag:

- Normalization: `1 ml = 0,5 g` (`from=ml, to=g, factor=0.5, isContainer=0`).
- Container: `1 Glas = 100 g`, `1 Packung = 4 Stangen`
  (`from=container, to=base, isContainer=1`).

Edges (global + per-ingredient, each usable in both directions via the factor)
partition the units used by an ingredient into **connected components**. Each
component:

1. has a **base** unit — the normalization terminal (follow edges toward the
   dimension base / the `to` side of edges). For `{TL, ml, g, Glas}` the base
   is `g`; for `{Stange, Packung}` it is `Stange`.
2. sums every contribution converted to that base. A contribution already in a
   container (`1 Packung`) normalizes back down via the container edge
   (`→ 4 Stangen`).
3. if it has a **container** unit, the summed base total is converted to the
   container and **ceiled** (`ceil(total_g / 100) Glas`); otherwise the base
   total is shown (auto g↔kg, ml↔l).

**Each component is one shopping-list line.** Zimt with `{TL,ml,g,Glas}` +
`{Stange,Packung}` → `1 Glas` + `1 Packung`, never merged. A unit with no edges
is its own component → its own line (`2 Stangen`).

Constraints: at most one container per component (the display target). Cycles
are rejected at write time; the graph is otherwise a forest of small components.

## Data model

- **Drop** `ingredient_sub_unit` (table), `recipe_ingredient.sub_unit_id`,
  `ingredient.default_sub_unit_id`, `ingredient_alias.default_sub_unit_id`,
  `ingredient.grams_per_ml`.
- **New** `ingredient_unit_conversion`:
  `id, ingredient_id (FK cascade), from_unit_id (FK), to_unit_id (FK),
  factor (real > 0), is_container (bool)`, unique on
  `(ingredient_id, from_unit_id, to_unit_id)`.
- Former sub-unit names ("Zehe", "Stange", …) become **global `unit` rows**
  (dimension `count`, factor 1, carrying the old sub-unit plural).

## Migration (chained after 0028; prod runs 0026→…→0030)

Two generated migrations (add-only, then drop-only) to keep drizzle snapshots
clean; data backfill hand-added to the add-only one, run while the old columns
still exist:

1. Create `ingredient_unit_conversion`.
2. Promote each distinct sub-unit **name** to a global `unit` (dedup by lower
   name; reuse an existing unit if the name already exists; copy the plural).
3. Repoint `recipe_ingredient.sub_unit_id → unit_id` (the promoted unit);
   `ingredient.default_sub_unit_id` and `ingredient_alias.default_sub_unit_id`
   → `default_unit_id`.
4. Each sub-unit with a parent → a container conversion
   `(ingredient_id, from=parent_unit_id, to=promoted_unit, factor=parent_amount,
   is_container=1)` — i.e. `1 parent = parent_amount sub`.
5. Each `ingredient.grams_per_ml` → a normalization conversion
   `(from=ml, to=g, factor=grams_per_ml, is_container=0)`.
6. Drop the old columns + `ingredient_sub_unit` table.

Verified against the dev DB (a copy of prod): counts of sub-units → conversions,
and that recipe lines keep a unit.

## Conversion engine (new pure module `src/lib/units/convert.ts`)

Pure, unit-tested, no DB:

```ts
type ConversionEdge = { from: number; to: number; factor: number; isContainer: boolean };
type UnitInfo = { id: number; name: string; plural: string | null;
                  dimension: Dimension; baseUnitId: number | null; factor: number };
type Contribution = { unitId: number; quantity: number | null };
type AggregatedLine = { unitId: number | null; unitName: string; quantity: number | null;
                        dimension: Dimension | "none" };

function aggregateContributions(
  contributions: Contribution[],
  edges: ConversionEdge[],          // per-ingredient
  units: Map<number, UnitInfo>,     // supplies global dimension edges + names/plurals
): AggregatedLine[];
```

Builds an undirected weighted graph (global dimension edges + `edges`), finds
components, picks each component's base (dimension base, else the `to` side of
its container edge, else the lowest-factor / first unit deterministically),
converts + sums, then containerizes (ceil) when the component has a container.
Names render via the existing `pluralizeLabel`. Cycle-safe (visited set;
inconsistent multi-paths resolved by first spanning-tree path, with a logged
warning).

## Shopping wiring (`items.ts`)

Replace `subunit-rollup` + density branches with: load each item ingredient's
`ingredient_unit_conversion` rows + the `UnitInfo` for every referenced/edge
unit, then call `aggregateContributions`. Manual amounts and staple/source
contributions feed in as `{unitId, quantity}`.

## Parser / recipe view

- Remove the sub-unit lookup (`buildSubUnitLookup`, `subUnitTokenSet`,
  `SubUnitRef`); promoted units are ordinary global tokens.
- Per-alias / per-ingredient defaults resolve to a global `unit` (no more
  `defaultSubUnit`).
- `recipe_ingredient` carries only `unit_id`; recipe read/edit views drop
  `subUnitId`. Recipe display unchanged. (Normalized-amount tooltip = future,
  not in this scope.)

## UI

- **Ingredient form:** a **Umrechnungen** editor — rows `1 [unit ▾] = [n]
  [unit ▾]` + a "Behälter (Einkaufseinheit)" toggle. Replaces the per-sub-unit
  parent editor and the density field. New units are created under `Einheiten`.
- **Einstellungen → Untereinheiten** page → repurposed as a cross-ingredient
  **Umrechnungen** list (ingredient · `1 A = n B` · container?), editable; or
  removed if it adds little. Decide during implementation; default: repurpose.

## Testing

- Engine unit tests: single component normalize+sum; container ceil; direct
  container contribution normalizes back; multiple components → multiple lines;
  unconverted unit stays its own line; cross-dimension via density edge; cycle
  safety.
- Migration: sub-units → units + conversions, recipe lines repointed, counts.
- Shopping integration: the Zimt scenario (`1 Glas` + `1 Packung`); existing
  shopping/staples sub-unit tests rewritten to the new model.
- `npm run test`, `npm run typecheck`, `npm run build`.

## Phasing

1. Pure engine + tests.
2. Schema + data migration (verify on dev DB).
3. Shopping wiring.
4. Parser/import + recipe view/types.
5. Services + APIs.
6. UI.
7. Full verify.

## Risks

- The data migration is the riskiest piece (name-based promotion + repointing);
  verified against a prod copy before commit.
- "Every unit global" reverses the earlier ingredient-scoping of sub-unit names
  — accepted; conversions stay per-ingredient so only configured ingredients
  convert.
- Base-unit selection within a component must be deterministic; specified in the
  engine and covered by tests.

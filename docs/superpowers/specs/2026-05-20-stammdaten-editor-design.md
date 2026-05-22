# Stammdaten-Editor — Design Specification

- **Date:** 2026-05-20
- **Status:** Approved; implementation in progress on `feature/stammdaten`
- **Owner:** Steven Weingärtner
- **Supersedes:** Master design (`2026-05-17-nomly-design.md`) Epic 7 — this spec is the concrete plan for that epic, expanded to also include Epic 6 (Supermarkets) and Tags.

## 1. Purpose

Provide an admin UI under `/einstellungen` to view and edit all base data the rest of the app reads from: ingredients, products, units, categories, tags, and supermarkets — with their aliases where applicable. Cover create, edit, delete, **and multi-row merge** for each entity. Absorb the existing `/einstellungen/zutaten` diet-class-only page into the new ingredient editor.

## 2. Scope

### 2.1 Entities

| Entity | Alias table | Editable fields | Merge | Delete |
|---|---|---|---|---|
| Zutat | `ingredient_alias` | name · aliases · default_category_id · exclude_from_shopping_list · dietary_class | ✓ | ✓ |
| Produkt | `product_alias` | name · aliases · default_category_id | ✓ | ✓ |
| Einheit | `unit_alias` | name · aliases · dimension · base_unit_id · factor | ✓ (same dimension+factor) | ✓ |
| Kategorie | `category_alias` | name · aliases | ✓ | ✓ |
| Tag | — | name | ✓ (loser names lost — no alias table) | ✓ |
| Supermarkt | — | name · category order | ✓ (unusual, warned) | ✓ |

### 2.2 Out of scope (deferred)

- Display-alias flag on `unit_alias` (`isDisplay`). Owner-deferred as part of a later polish epic; this spec does not touch the schema.
- iCal feeds, API tokens, supermarket-aware filtering of the shopping list — these have their own epics (12, 13).
- Per-row replacement targets in bulk delete (one shared replacement applies to all).

## 3. Routes & navigation

```
/einstellungen                   landing — cards link below
/einstellungen/zutaten           list + drawer-edit + merge + delete
/einstellungen/produkte          ditto
/einstellungen/einheiten         ditto + dimension-aware merge
/einstellungen/kategorien        ditto + supermarket_category dedupe on merge
/einstellungen/tags              lighter (no aliases)
/einstellungen/supermaerkte      list + drawer with embedded category-order list
```

The settings landing page (`src/app/einstellungen/page.tsx`) replaces its four "Epic N coming soon" placeholders with six real cards. The current standalone `/einstellungen/zutaten` (diet-class only) is replaced — diet class becomes one field among several in the new editor.

## 4. UX

### 4.1 List page

- Sticky header: page title, search input (debounced 200ms, substring match across canonical name + aliases, case-insensitive via `lower_u`), filter chips slot, "+ Neu" button (right).
- Filter chips per entity:
  - Zutaten: `Diät: vegan/vegetarisch/tierisch/unbekannt`, `Status: ausgeschlossen`
  - Einheiten: `Dimension: Masse / Volumen / Stück`
  - Others: none
- Table: leading checkbox column + entity columns + trailing chevron.
- Sort: alphabetical by canonical name (`Intl.Collator("de", { sensitivity: "base" })`). No custom sort UI.
- Pagination: none — render all rows; only add virtualization if a list exceeds ~500 visible rows after filtering.
- Multi-select: row checkbox + select-all in header. When ≥1 selected, a sticky bottom action bar shows: `Zusammenführen` (only ≥2 enabled) · `Löschen` · `Auswahl aufheben`.
- Row click (anywhere outside checkbox) opens the edit drawer.

Columns:

- **Zutaten** — Name · Aliase (chip cluster, max 3 + `+N`) · Default-Kategorie · Diät-Badge · `Nicht auf Liste`-Badge · `N Rezepte`
- **Produkte** — Name · Aliase · Default-Kategorie · `N Listen-Einträge`
- **Einheiten** — Name · Aliase · Dimension · Basis-Einheit · Faktor · `N Rezepte`
- **Kategorien** — Name · Aliase · `Verwendung: N` (sum of ingredients + products + shopping items)
- **Tags** — Name · `N Rezepte`
- **Supermärkte** — Name · `N Kategorien geordnet`

### 4.2 Edit & create drawer

- Right-side slide-in (`width: 520px`) on desktop, full-screen sheet on mobile. Built on Radix Dialog with custom `slide-in-from-right` animation.
- Header: entity name (heading, blank in create mode) + `Löschen` icon button (only in edit mode).
- Body: entity-specific form fields (§4.2.2); for entities with aliases: `<AliasChipEditor>` below the name field; expandable `Verwendung anzeigen` section showing references.
- Footer: `Abbrechen` (left) · `Speichern` (right, primary). `Cmd/Ctrl-S` also saves. `Esc` with unsaved changes triggers a discard-confirm.
- Validation: inline error messages under fields; save button disabled while errors present.
- Optimistic UI: save sends a PATCH; on success the list row updates from the response. On failure, the inline error appears and the row is not touched.

#### 4.2.1 `<AliasChipEditor>` rules

- Existing aliases shown as removable chips with `×`.
- Single-line input below adds a new alias on Enter or blur (trimmed; empty rejected).
- Live validation: a new alias is rejected if it duplicates an existing alias on the same row, equals the canonical name, or collides with any other canonical/alias name in the same entity table (server-side check called on blur; lower_u case-insensitive).
- Deleted/added aliases are batched and submitted with the row save (not per-chip POST), so an abandoned edit doesn't pollute the DB.

#### 4.2.2 Form fields per entity

- **Zutat** — Name · Aliase · Default-Kategorie (autocomplete combobox over `category`) · `Von Einkaufsliste ausschließen` (Switch) · Diät (radio group: `Vegan / Vegetarisch / Tierisch / Unbekannt`).
- **Produkt** — Name · Aliase · Default-Kategorie.
- **Einheit** — Name · Aliase · Dimension (radio, required; **disabled in edit mode** — changing dimension would break existing `recipe_ingredient` semantics) · Basis-Einheit (autocomplete filtered to same dimension, optional; null means *this is the base*) · Faktor (number input, default 1, positive finite).
- **Kategorie** — Name · Aliase.
- **Tag** — Name only.
- **Supermarkt** — Name · `<CategoryOrderList>`: drag-and-drop list of all categories with this supermarket's `sort_order`. Categories not yet in the supermarket appear in a separate "Nicht im Supermarkt" section with a `+ Hinzufügen` button. Drag-and-drop on desktop (`@dnd-kit/core` is **not** yet a dep — use up/down buttons on both desktop and mobile for v1 to avoid pulling in a new dep). Note: this is a sub-feature; for v1 keep it as a simple up/down list with no DnD.

### 4.3 Merge dialog

- Triggered from the list page's action bar (≥2 rows selected).
- Modal Dialog (Radix), wider than default (max-w-2xl).
- Title: `{N} {Entity-Plural} zusammenführen`.
- Body:
  1. Winner radio-list: each selected row with name, alias count, ref count. First row preselected.
  2. Preview block (recomputes when winner changes):
     - `{Winner} behält den Namen.`
     - For alias-supporting entities: `Die Namen {Loser1}, {Loser2} und ihre {n} Aliase werden zu Aliasen von {Winner}.`
     - `{X} Referenzen werden auf {Winner} umgehängt: {breakdown}.`
  3. Entity-specific warning banners:
     - **Einheit**: if not all selected units share `dimension` and `factor` → red banner + confirm disabled.
     - **Tag**: yellow banner `Die Namen der nicht ausgewählten Tags gehen verloren (Tags haben keine Aliase).`
     - **Supermarkt**: yellow banner `Supermärkte zusammenzuführen ist ungewöhnlich. Die Kategorienreihenfolgen werden zusammengeführt — bei Konflikten gewinnt der ausgewählte Supermarkt.`
- Footer: `Abbrechen` · `Zusammenführen` (primary, disabled when validation fails).
- POST to `/api/v1/<entity>/merge` with `{ winnerId, loserIds }`. Server-side runs the merge transaction (§5.3) and returns the winner row. UI closes dialog, refreshes list, shows toast: `{N} {Entity-Plural} zu "{Winner.name}" zusammengeführt.`

### 4.4 Delete dialog

- Triggered from drawer's `Löschen` button (single) or list action bar `Löschen` (bulk).
- Title: `{Entity-Singular} "{name}" löschen` (single) or `{N} {Entity-Plural} löschen` (bulk).
- Body:
  1. Impact preview (same data source as merge preview).
  2. If references exist, choice radios:
     - `Durch andere {Entity-Singular} ersetzen…` → autocomplete combobox (must not be any of the to-be-deleted rows). For bulk: one shared replacement.
     - `Trotzdem löschen` → enabled only when FK semantics permit (see table below). Disabled state shows a reason: e.g. `Diese Zutat wird in Rezepten verwendet — es muss eine Ersatz-Zutat gewählt werden.`
  3. If no references: skip radios, just `Wird nirgendwo verwendet.`
- Footer: `Abbrechen` · `Löschen` or `Ersetzen und löschen` (label depends on chosen radio).
- Replace-and-delete is implemented as the merge transaction with the replacement as winner and the to-be-deleted row(s) as losers.

FK reality (drives which "Trotzdem löschen" is allowed):

| Entity | Hard-blockers | Soft FKs (set null / cascade) |
|---|---|---|
| Zutat | `recipe_ingredient.ingredient_id` (restrict) + `shopping_item.ingredient_id` would break `shopping_item_xor` | — |
| Produkt | `shopping_item.product_id` would break `shopping_item_xor` | — |
| Einheit | none | `recipe_ingredient.unit_id`, `shopping_item.unit_id`, `shopping_item_source.contributed_unit_id`, `unit.base_unit_id` → set null |
| Kategorie | none | `ingredient.default_category_id`, `product.default_category_id`, `shopping_item.category_id` → set null; `supermarket_category` → cascade |
| Tag | none | `recipe_tag` → cascade |
| Supermarkt | none | `supermarket_category` → cascade |

For Zutat/Produkt, if any reference exists, "Trotzdem löschen" is disabled — only `Ersetzen und löschen` is available.

## 5. Server / service layer

### 5.1 Pattern

- REST endpoints under `/api/v1/<entity>/...` returning JSON. Matches the existing repo pattern (e.g. `PATCH /api/v1/ingredients/:id` for diet class) — no Server Actions.
- All routes are gated by OIDC at the middleware level (same as the current `/einstellungen/*`); no additional per-route checks.
- All mutating routes return the resulting row(s) on success.

### 5.2 File layout

```
src/lib/stammdaten/
  shared/
    merge.ts             generic runMerge<Adapter>(winnerId, loserIds, adapter)
    impact.ts            generic getImpact<Adapter>(ids[]) → per-id ref counts
    validation.ts        name normalization + cross-namespace alias uniqueness
    types.ts             shared adapter + dto types
  ingredient/
    service.ts           list, get, create, update, delete, merge, impact
    adapter.ts           merge/impact adapter (alias table, FK rewires, validators)
    validation.ts        zod schemas for create + update
  product/               (same shape)
  unit/                  (same shape; adapter validator checks dimension+factor)
  category/              (same shape; adapter has postProcess for supermarket_category dedupe)
  tag/                   (same shape; adapter aliasTable = null)
  supermarket/           (same shape + helpers for category-order CRUD)
```

### 5.3 Generic merge

```ts
type MergeAdapter<Row> = {
  table: SQLiteTable;
  aliasTable: SQLiteTable | null;   // null for tag, supermarket
  aliasParentColumn?: SQLiteColumn; // *.{entity}Id
  aliasNameColumn?: SQLiteColumn;
  fkRewires: Array<{
    table: SQLiteTable;
    column: SQLiteColumn;
    /** Dedupe key (other columns) — when winner already has a row matching
     * this composite, drop the loser's row instead of rewiring. */
    dedupeBy?: SQLiteColumn[];
  }>;
  validate?: (rows: Row[]) => string | null; // returns error message or null
  postProcess?: (tx: Tx, winner: Row, losers: Row[]) => void;
};

runMerge<Row>(winnerId: number, loserIds: number[], adapter: MergeAdapter<Row>): Row;
```

Runs in one `db.transaction(...)`:
1. Load winner + losers; refuse if winner id ∈ loser ids or any row missing.
2. Call `adapter.validate(rows)` — abort with error if non-null.
3. If `aliasTable` set: insert each loser's canonical name + each of the loser's aliases as a new alias of the winner, deduping against winner's existing name + existing aliases. Silent skip on duplicates.
4. For each `fkRewires` entry:
   - If `dedupeBy` set: for each loser-referencing row, check if winner already has a row matching `dedupeBy`; if yes, delete the loser's row; otherwise update its FK to winner.
   - Otherwise: bulk UPDATE.
5. Call `adapter.postProcess(tx, winner, losers)` if provided.
6. Delete loser rows.
7. Return the updated winner row.

### 5.4 Per-entity adapter specifics

- **Ingredient**: fkRewires = `[recipe_ingredient.ingredientId, shopping_item.ingredientId]`. No dedupe needed (recipe_ingredient may have many rows for the same ingredient in different recipes, and shopping_item may have multiple in different categories; merging within a single row's scope isn't a real concern). No validate, no postProcess.
- **Product**: fkRewires = `[shopping_item.productId]`. No dedupe.
- **Unit**: fkRewires = `[recipe_ingredient.unitId, shopping_item.unitId, shopping_item_source.contributedUnitId, unit.baseUnitId]`. `validate(rows)` returns error if rows differ in `dimension` or `factor`. No postProcess (no dedupe needed: unit columns are nullable FKs without composite uniqueness).
- **Category**: fkRewires = `[ingredient.defaultCategoryId, product.defaultCategoryId, shopping_item.categoryId, supermarket_category.categoryId]`. The last has `dedupeBy: [supermarket_category.supermarketId]` — drop loser's `supermarket_category` row when the winner already has one for the same supermarket. No validate.
- **Tag**: `aliasTable: null`. fkRewires = `[recipe_tag.tagId]` with `dedupeBy: [recipe_tag.recipeId]` (drop loser's recipe_tag when the winner already tags that recipe). No validate.
- **Supermarkt**: `aliasTable: null`. fkRewires = `[supermarket_category.supermarketId]` with `dedupeBy: [supermarket_category.categoryId]`. No validate.

### 5.5 Impact-count endpoint

`GET /api/v1/<entity>/impact?ids=1,2,3` returns:

```json
{ "items": [
  { "id": 1, "refs": { "recipes": 8, "shoppingItems": 4 }, "aliasCount": 2 },
  { "id": 2, "refs": { "recipes": 0, "shoppingItems": 1 }, "aliasCount": 0 }
] }
```

Cheap `SELECT COUNT(*) ... WHERE fk = ? GROUP BY fk`. Computed on-demand when a merge/delete dialog opens. No caching.

### 5.6 Validation rules

Common to all entities:
- `name` trimmed, non-empty after trim, ≤200 chars.
- Aliases (alias-supporting entities): each non-empty after trim, ≤200 chars, deduplicated within the row, cross-namespace check — rejects collisions with the row's own canonical name and with any other canonical or alias name in the same entity table (excluding the row being edited).

Unit-specific:
- `dimension` ∈ `{mass, volume, count}`; required; immutable after creation.
- `factor` finite, > 0.
- `baseUnitId`: optional; if set, must reference an existing unit with the same `dimension` and must not be self.

### 5.7 REST routes

For each entity `<e>` with plural `<es>`:

- `GET    /api/v1/<es>/manage` → full list with all editor fields (different from existing autocomplete `GET /api/v1/<es>?q=` which returns minimal hits). Returns canonical rows + aliases joined.
- `POST   /api/v1/<es>/manage` → create. Body: full editor payload. Returns created row.
- `GET    /api/v1/<es>/manage/:id` → single row with aliases.
- `PATCH  /api/v1/<es>/manage/:id` → update. Body: partial editor payload (`{ name?, aliases?, ... }`).
- `DELETE /api/v1/<es>/manage/:id` → delete. Query: `?replaceWith=<id>` to merge into another row, omit to refuse if refs present (server returns 409 with impact details).
- `POST   /api/v1/<es>/merge` → `{ winnerId, loserIds }`. Returns winner row.
- `GET    /api/v1/<es>/impact?ids=...` → impact counts.

Path prefix `/manage` distinguishes these admin endpoints from the existing autocomplete-shaped endpoints (`GET /api/v1/ingredients?q=`, `POST /api/v1/ingredients` for inline-create) which stay unchanged. No new top-level `/api/v1` shape.

Existing `PATCH /api/v1/ingredients/:id` for the diet-class flag stays — the new ingredient editor calls it for partial updates of the diet field, and the new full-editor PATCH lives at `/api/v1/ingredients/manage/:id`. (Yes, two endpoints touch the same table; that's OK because the legacy endpoint stays scoped to one field. We can converge later.)

## 6. Components

```
src/components/settings/stammdaten/
  list-shell.tsx         page-level: search + filters slot + table + action bar + drawer
  list-table.tsx         generic table from column defs
  column-defs/           per-entity column defs
    ingredient.tsx
    product.tsx
    unit.tsx
    category.tsx
    tag.tsx
    supermarket.tsx
  drawer-shell.tsx       slide-in container with header + body slot + footer
  alias-chip-editor.tsx  add/remove alias chips with inline validation
  impact-section.tsx     expandable "Verwendung anzeigen" inside drawer
  merge-dialog.tsx       winner picker + preview + warnings
  delete-dialog.tsx      replace radio + autocomplete + impact preview
  action-bar.tsx         sticky bottom bar shown when ≥1 row selected
  edit-forms/
    ingredient-form.tsx
    product-form.tsx
    unit-form.tsx
    category-form.tsx
    tag-form.tsx
    supermarket-form.tsx (embeds category-order list)
  category-order-list.tsx    up/down ordering for supermarket
```

Each `/einstellungen/<entity>/page.tsx` is a thin server component:
- Loads initial rows via the service's `list()` function.
- Renders `<AppShell>` + `<ListShell entity="ingredient" initial={rows} />`.

`<ListShell>` is parameterized by entity kind. Internally it dispatches to the right column defs, edit form, dialog content, and API endpoints. Adding a new entity later is a matter of adding one column-def file, one edit-form file, and one service module — `<ListShell>` itself doesn't change.

## 7. Testing

Vitest, tests live in `tests/<feature>.test.ts`. Each test file boots a fresh temp SQLite DB (see `tests/seed.test.ts` for the existing pattern).

### 7.1 Unit tests

- `tests/stammdaten-validation.test.ts` — name normalization, alias uniqueness rules (within row + cross-namespace), unit factor/dimension/baseUnitId rules.

### 7.2 Integration tests (one file per entity)

- `tests/stammdaten-ingredient.test.ts`:
  - merge: aliases absorbed, recipe_ingredient + shopping_item FKs rewired, losers deleted
  - delete with replaceWith: same effect as 1-loser merge
  - delete without replaceWith when refs exist → 409 with impact body
- `tests/stammdaten-product.test.ts` — same shape over `shopping_item.productId`.
- `tests/stammdaten-unit.test.ts`:
  - merge of same dimension+factor: succeeds
  - merge of differing dimension: rejected with descriptive error
  - merge of same dimension differing factor: rejected
  - delete without replaceWith on a unit referenced by recipe_ingredient.unitId: succeeds (set null)
- `tests/stammdaten-category.test.ts`:
  - merge: supermarket_category dedupe — winner's row kept; loser's transferred when only loser had one.
  - delete with replaceWith: rewires all four FK targets.
- `tests/stammdaten-tag.test.ts`:
  - merge: recipe_tag deduped (no `(recipe_id, tag_id)` PK violation).
- `tests/stammdaten-supermarket.test.ts`:
  - merge: supermarket_category deduped on `(supermarket_id, category_id)`.

### 7.3 No component tests in v1

Manual smoke test through the dev server is the acceptance gate.

## 8. Acceptance criteria

- All six settings pages render with their initial data.
- Search filters across canonical names + aliases.
- Filter chips on Zutaten (diet + exclude) and Einheiten (dimension) work.
- Create, edit, delete each entity end-to-end; aliases add/remove/persist.
- Existing `/einstellungen/zutaten` diet-class behavior continues to work (now part of the richer editor).
- Merge of 2 ingredients: aliases absorbed, recipe_ingredient.ingredient_id rewires, shopping_item.ingredient_id rewires, losers deleted — verified by inspecting a recipe that referenced a loser.
- Merge of 2 units with differing factor: refused with a clear error message.
- Delete an ingredient referenced by a recipe without replacement: server returns 409 with impact details; UI prompts for a replacement.
- Delete an ingredient with replacement: references rewire to the replacement and the original is removed.
- Tests pass (`npm run test`).
- Typecheck passes (`npm run typecheck`).
- Lint passes (`npm run lint`).

## 9. Migration / data

No schema changes. All required tables and FK constraints already exist. No data migrations.

## 10. Risks & mitigations

- **Cross-namespace alias uniqueness** is not DB-enforced. Mitigation: service-layer check covered by tests; race condition window is acceptable for a 2-user LAN app.
- **Unit merge can corrupt recipe quantities** if factors differ. Mitigation: refuse such merges outright; user has to delete-with-replacement instead, which doesn't claim equivalence.
- **Category-order DnD** is a UX nice-to-have. v1 ships up/down buttons only. DnD can come later without a schema change.
- **Settings landing displaces existing cards** — `StandarddatenCard` stays, the "Zutaten – Diät-Klassifikation" card disappears, four placeholder cards become real links. No deep-links to the old URL exist in the codebase.

## 11. Out-of-scope reminders

- Display-alias flag on `unit_alias` — separate epic.
- iCal feed CRUD, API token CRUD — Epics 12/13 from the master design.
- Supermarket-aware shopping-list filtering UI — Epic 6 from the master design.

# Configurable Quantifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable `quantifier` concept (amount-words like `einige`, `zwei`, `a`, `ein paar`, each with an optional numeric `value`) that occupies the *amount* slot of an ingredient — fixing "einige Stiele → 1 Stiele" and moving the hardcoded number-word lists into the DB.

**Architecture:** A new `quantifier` + `quantifier_alias` table and a `recipe_ingredient.quantifier_id` FK. The amount of a row is *either* a literal number (`quantity`/`quantity_low`) *or* a quantifier reference. Everything downstream reads a single derived **effective value** = `quantity ?? quantifier.value`. Display/scale/aggregate use the number when present, else the quantifier name. Recognition is DB-driven (mirrors `buildUnitLookup`); a new parser pass applies the unit-first→quantifier-wins resolution rule.

**Tech Stack:** Next.js 16, Drizzle + better-sqlite3, Vitest, React. Spec: `docs/superpowers/specs/2026-06-14-configurable-quantifiers-design.md`.

**Branch:** `feat/quantifiers` (already created).

**Conventions observed:** boolean/real Drizzle columns per `src/db/schema.ts`; migrations are drizzle-kit generated + hand-edited (`drizzle/NNNN_*.sql`, head is `0040`); lookups built in `src/lib/recipe-import/index.ts`; the parser pass order is in `src/lib/recipe-import/ast/parse-line.ts`; stammdaten CRUD mirrors `src/lib/stammdaten/unit/*` + `src/components/settings/stammdaten/*`; never run `npm run build` while the dev server is live.

---

## File structure

**New:**
- `src/db/seed-data/quantifiers.ts` — seed set (cardinals/articles/fractions/vague).
- `src/lib/recipe-import/ast/passes/quantifier.ts` — the recognition pass.
- `src/lib/recipes/effective-quantity.ts` — `effectiveQuantity()` helper (pure).
- `src/lib/stammdaten/quantifier/{service,adapter}.ts` — CRUD + merge.
- `src/app/api/v1/quantifiers/manage/route.ts`, `.../[id]/route.ts`, `.../impact/route.ts`.
- `src/components/settings/stammdaten/pages/quantifier-page-client.tsx`, `.../edit-forms/quantifier-form.tsx`.
- Tests under `tests/` per task.

**Modified:**
- `src/db/schema.ts` (tables + FK), `drizzle/0041_*.sql`, `src/db/seed.ts`.
- `src/lib/recipe-import/index.ts` (lookup, `ParseLookups`, `ImportedIngredient.quantifierId`, orchestration), `ast/parse-line.ts` (pass order, `ParsedRow`, `SegmentLookups`), `ast/passes/amount-unit.ts` (drop number-word lists; consult lookup).
- `src/components/recipes/{types,payload,ingredient-row,ingredient-read-line,bulk-reparse-dialog}.tsx`, `ingredient-line.tsx`.
- `src/lib/recipes/validate.ts`, `src/lib/recipes/service.ts` (write/read `quantifier_id`).
- display/scale/aggregate read sites: `recipe-detail.tsx`, `planner/recipe-preview-dialog.tsx`, `shopping/items.ts`, `shopping/merge.ts`, `meal-plans/service.ts`.
- `src/components/settings/stammdaten/types.ts` (+`"quantifier"` EntityKind), `list-shell.tsx` (`pluralFor`).

---

## Phase 1 — Schema, seed, lookup (no behavior change)

### Task 1.1: Add the `quantifier` + `quantifier_alias` tables and FK

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0041_quantifiers.sql`

- [ ] **Step 1: Add the Drizzle table definitions** (after the `unitAlias` block, ~line 130 in `src/db/schema.ts`)

```ts
export const quantifier = sqliteTable("quantifier", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** Numeric value of the quantifier; NULL = unspecified ("einige"). */
  value: real("value"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
});

export const quantifierAlias = sqliteTable("quantifier_alias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quantifierId: integer("quantifier_id")
    .notNull()
    .references(() => quantifier.id, { onDelete: "cascade" }),
  name: text("name").notNull().unique(),
});
```

- [ ] **Step 2: Add the FK column to `recipeIngredient`** (in the `recipe_ingredient` table, near `unitId`)

```ts
  quantifierId: integer("quantifier_id").references(() => quantifier.id, {
    onDelete: "restrict",
  }),
```

- [ ] **Step 3: Generate + hand-finalize the migration**

Run: `npx drizzle-kit generate` → produces `drizzle/0041_*.sql`. Verify it `CREATE TABLE quantifier` / `quantifier_alias` and `ALTER TABLE recipe_ingredient ADD quantifier_id`. (better-sqlite3 needs no table rebuild for an added nullable FK column.) Rename to `drizzle/0041_quantifiers.sql` only if drizzle-kit allows; otherwise keep its generated name.

- [ ] **Step 4: Apply + verify against a scratch DB**

Run: `DATABASE_URL=./data/scratch.db npm run migrate` then `sqlite3 ./data/scratch.db ".schema quantifier"` — expect the table. Run `rm -f ./data/scratch.db*` after.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): quantifier + quantifier_alias tables, recipe_ingredient.quantifier_id"
```

### Task 1.2: Seed data + seeding

**Files:**
- Create: `src/db/seed-data/quantifiers.ts`
- Modify: `src/db/seed.ts`
- Test: `tests/quantifier-seed.test.ts`

- [ ] **Step 1: Write the seed set**

```ts
export type SeedQuantifier = { name: string; aliases: string[]; value: number | null };

export const SEED_QUANTIFIERS: SeedQuantifier[] = [
  { name: "ein", aliases: ["eine", "einen", "einem", "einer", "eins", "a", "an", "one"], value: 1 },
  { name: "zwei", aliases: ["two"], value: 2 },
  { name: "drei", aliases: ["three"], value: 3 },
  { name: "vier", aliases: ["four"], value: 4 },
  { name: "fünf", aliases: ["five"], value: 5 },
  { name: "sechs", aliases: ["six"], value: 6 },
  { name: "sieben", aliases: ["seven"], value: 7 },
  { name: "acht", aliases: ["eight"], value: 8 },
  { name: "neun", aliases: ["nine"], value: 9 },
  { name: "zehn", aliases: ["ten"], value: 10 },
  { name: "elf", aliases: ["eleven"], value: 11 },
  { name: "zwölf", aliases: ["twelve", "dutzend", "a dozen"], value: 12 },
  { name: "ein halber", aliases: ["eine halbe", "ein halbes", "halber", "halbe", "halbes", "half"], value: 0.5 },
  { name: "viertel", aliases: ["quarter"], value: 0.25 },
  { name: "dreiviertel", aliases: ["three quarters"], value: 0.75 },
  { name: "einige", aliases: ["several"], value: null },
  { name: "ein paar", aliases: ["a few", "a couple", "a couple of"], value: null },
  { name: "mehrere", aliases: [], value: null },
  { name: "some", aliases: [], value: null },
];
```

- [ ] **Step 2: Write a failing seed test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
// (set up a temp migrated DB like tests/users-service.test.ts does)
describe("quantifier seed", () => {
  it("seeds canonical + alias rows with values", async () => {
    const { runSeed } = await import("@/db/seed");
    runSeed();
    const { buildQuantifierLookup } = await import("@/lib/recipe-import");
    const q = buildQuantifierLookup();
    expect(q.byNameOrAlias.get("zwei")?.value).toBe(2);
    expect(q.byNameOrAlias.get("two")?.value).toBe(2);   // alias
    expect(q.byNameOrAlias.get("einige")?.value).toBeNull();
    expect(q.byNameOrAlias.get("a")?.value).toBe(1);     // alias of "ein"
    expect(q.maxTokens).toBeGreaterThanOrEqual(2);        // "ein paar"
  });
});
```

- [ ] **Step 3: Add quantifier seeding to `runSeed`** (mirror the unit loop in `src/db/seed.ts`)

Insert canonical rows (name, value, sortOrder=index) idempotently (skip when name exists), then aliases via the existing `addAlias(tx, "quantifier", id, aliasName, …)` helper — extend `addAlias` to accept `"quantifier"` (it switches on entity to pick the alias table). Add `quantifiers: { added, skipped, aliasesAdded }` to `SeedCounts`.

- [ ] **Step 4: Run the test** — `npx vitest run tests/quantifier-seed.test.ts` → PASS (after Task 1.3 provides `buildQuantifierLookup`; if running 1.2 before 1.3, stub the import). Sequence 1.3 first if needed.

- [ ] **Step 5: Commit** — `git commit -m "feat(seed): seed configurable quantifiers"`

### Task 1.3: `buildQuantifierLookup` + add to `ParseLookups`

**Files:**
- Modify: `src/lib/recipe-import/index.ts`
- Test: `tests/quantifier-lookup.test.ts`

- [ ] **Step 1: Add the lookup type + builder** (mirror `buildUnitLookup`, ~line 234)

```ts
export type QuantifierLookupEntry = { id: number; name: string; value: number | null };
export type QuantifierLookup = {
  byNameOrAlias: Map<string, QuantifierLookupEntry>;
  byId: Map<number, QuantifierLookupEntry>;
  maxTokens: number;
};

export function buildQuantifierLookup(): QuantifierLookup {
  const byNameOrAlias = new Map<string, QuantifierLookupEntry>();
  const byId = new Map<number, QuantifierLookupEntry>();
  for (const q of db.select().from(quantifier).all()) {
    const entry = { id: q.id, name: q.name, value: q.value ?? null };
    byNameOrAlias.set(q.name.toLowerCase(), entry);
    byId.set(q.id, entry);
  }
  for (const a of db.select({ id: quantifier.id, name: quantifier.name, value: quantifier.value, alias: quantifierAlias.name })
    .from(quantifierAlias).innerJoin(quantifier, eq(quantifier.id, quantifierAlias.quantifierId)).all()) {
    const key = a.alias.toLowerCase();
    if (!byNameOrAlias.has(key)) byNameOrAlias.set(key, { id: a.id, name: a.name, value: a.value ?? null });
  }
  let maxTokens = 1;
  for (const k of byNameOrAlias.keys()) maxTokens = Math.max(maxTokens, k.trim().split(/\s+/).length);
  return { byNameOrAlias, byId, maxTokens };
}
```

- [ ] **Step 2: Add to `ParseLookups`** (~line 544): `quantifiers?: QuantifierLookup;`

- [ ] **Step 3: Build it at the call sites** where `ParseLookups` is assembled (the production builder that pairs `buildUnitLookup()` + `buildIngredientLookup()` — grep `buildIngredientCatalog(` usages): add `quantifiers: buildQuantifierLookup()`.

- [ ] **Step 4: Test** — `tests/quantifier-lookup.test.ts` asserts canonical+alias resolution + `maxTokens`. Run → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(parser): buildQuantifierLookup + ParseLookups.quantifiers"`

---

## Phase 2 — Parser recognition + migrate number-words

### Task 2.1: Quantifier recognition pass (numeric values first; keep existing behavior)

**Files:**
- Create: `src/lib/recipe-import/ast/passes/quantifier.ts`
- Modify: `src/lib/recipe-import/ast/parse-line.ts` (pass order + `SegmentLookups` + `ParsedRow`)
- Test: `tests/quantifier-parse.test.ts`

- [ ] **Step 1: Write failing parser tests** (use empty catalog + the seeded-like quantifier set passed via lookups; mirror `tests/recipe-import.test.ts` helpers, adding a `quantifiers` map)

```ts
// "einige Stiele Petersilie" with Stiel as a unit, Petersilie in catalog:
//   → quantity null, quantifierName "einige", unit "Stiele", name "Petersilie"
// "zwei Äpfel" → effective 2 via quantifier ref "zwei"
// "some sprigs"  → quantifier "some", unit "sprigs"
// "some bananas" → unit "some" (unspecific), NO quantifier
```

- [ ] **Step 2: Add `quantifierId`/`quantifierValue` to `ParsedRow` + `SegmentLookups`**

`ParsedRow`: `quantifierId: number | null; quantifierName: string | null;`. `SegmentLookups`: `quantifiers?: QuantifierLookup;`.

- [ ] **Step 3: Implement `applyQuantifier`** — recognize a leading quantifier token/window (widest-window probe via `maxTokens`), annotate the leaf(s) with a `quantifier` role + the matched entry; return `{ id, name, value } | null`. Do NOT consume amount yet — the amount/unit pass reads the annotation.

- [ ] **Step 4: Wire the resolution rule into `applyAmountUnit`** (`amount-unit.ts`): if a leading quantifier was annotated, and (it isn't a unit OR another unit follows), treat it as the amount: set `quantity = value` (may be null), record the quantifier id/name; otherwise leave it for the unit pass (the "some bananas" case keeps `some` as the unspecific unit). Never default a unit-bearing line to `quantity = 1` when a null-valued quantifier is present.

- [ ] **Step 5: Slot the pass into `parseLeaves`** between `applyLeadingNotePhrase` (line ~204) and `applyColonAmount`/`applyAmountUnit`; thread its result into `ParsedRow`.

- [ ] **Step 6: Run tests** → PASS. **Commit** — `git commit -m "feat(parser): quantifier recognition pass + unit-first resolution"`

### Task 2.2: Retire the hardcoded number-word lists

**Files:**
- Modify: `src/lib/recipe-import/ast/passes/amount-unit.ts`
- Test: existing parser suites (`recipe-import*.test.ts`, parity/golden) + `tests/quantifier-parse.test.ts`

- [ ] **Step 1: Make the test fixtures seed the numeric quantifiers** so the test lookups carry `ein`/`zwei`/`halbe`… (a shared helper `testQuantifiers()` mapping `SEED_QUANTIFIERS`).

- [ ] **Step 2: Delete `TEXT_ONE`, `TEXT_HALF`, `TEXT_QUARTER`, `WRITTEN_CARDINALS`** from `amount-unit.ts`; replace their consult sites with a lookup against `opts.quantifiers`. Keep digit/fraction/range syntax and the "drop a bare article sitting after a fraction" tidy.

- [ ] **Step 3: Run the FULL parser suite** — `npx vitest run tests/recipe-import-matching.test.ts tests/recipe-import.test.ts tests/recipe-import.golden.test.ts tests/recipe-import.parity.test.ts`. Number-words must still parse to the same values (now via the lookup). Fix divergences; a deliberate change gets a justification comment.

- [ ] **Step 4: Commit** — `git commit -m "refactor(parser): number-words come from the quantifier table, not code"`

### Task 2.3: Thread `quantifierId` to `ImportedIngredient`

**Files:** Modify `src/lib/recipe-import/index.ts`

- [ ] **Step 1:** Add `quantifierId: number | null` to `ImportedIngredient`; in the orchestration that maps `ParsedRow` → `ImportedIngredient` (parseIngredientLines + parseIngredientGroupsIntoSections), carry it through. **Step 2:** typecheck. **Step 3:** commit — `git commit -m "feat(parser): expose quantifierId on ImportedIngredient"`.

---

## Phase 3 — Persistence + effective-value helper

### Task 3.1: `effectiveQuantity` helper

**Files:** Create `src/lib/recipes/effective-quantity.ts`; Test `tests/effective-quantity.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { effectiveQuantity } from "@/lib/recipes/effective-quantity";
const byId = new Map([[7, { id: 7, name: "zwei", value: 2 }], [8, { id: 8, name: "einige", value: null }]]);
expect(effectiveQuantity({ quantity: 200, quantifierId: null }, byId)).toBe(200);
expect(effectiveQuantity({ quantity: null, quantifierId: 7 }, byId)).toBe(2);
expect(effectiveQuantity({ quantity: null, quantifierId: 8 }, byId)).toBeNull();
expect(effectiveQuantity({ quantity: null, quantifierId: null }, byId)).toBeNull();
```

- [ ] **Step 2: Implement** `effectiveQuantity(row, byId) = row.quantity ?? byId.get(row.quantifierId ?? -1)?.value ?? null`. **Step 3:** run → PASS. **Step 4:** commit.

### Task 3.2: Save + read `quantifier_id`

**Files:** Modify `src/components/recipes/{types,payload}.ts`, `src/lib/recipes/{validate,service,types}.ts`; Test `tests/recipe-quantifier-persistence.test.ts`

- [ ] **Step 1: Failing test** — save a recipe row with `quantifierId` set / `quantity` null; read it back; assert round-trip and that the view exposes `quantifierId` + resolved `quantifierName`.
- [ ] **Step 2:** `DraftIngredient` += `quantifierId: number | null`; `RecipeIngredientInput`/view types += the field + `quantifierName`/resolved value on the read view (`RecipeIngredientView`).
- [ ] **Step 3:** `validate.ts` ingredient schema += `quantifierId: z.number().int().positive().nullable().optional()`, with a `.refine` that **at most one** of {numeric `quantity`, `quantifierId`} is set (quantity must be null when a quantifier is set). A quantifier **may** coexist with a unit.
- [ ] **Step 4:** `service.ts` write path persists `quantifierId` (clearing `quantity`/`quantityLow` when set); read path joins `quantifier` to expose `quantifierName` + value on the view.
- [ ] **Step 5:** `payload.ts` `ingredientToPayload` serializes `quantifierId`.
- [ ] **Step 6:** run → PASS; typecheck. **Commit** — `git commit -m "feat(recipes): persist + expose recipe_ingredient.quantifier_id"`

---

## Phase 4 — Display, scaling, aggregation read the effective value

### Task 4.1: Rendering

**Files:** Modify `src/components/recipes/ingredient-read-line.tsx`, `recipe-detail.tsx`, `planner/recipe-preview-dialog.tsx`; Test `tests/ingredient-read-line.test.tsx` (or a pure formatter test)

- [ ] **Step 1: Failing test** for the formatter: effective number present → number (+ fraction/range); effective null + quantifierName → the name; reference invisible for numeric (`zwei` → "2").
- [ ] **Step 2:** Extend `formatAmount`/`formatQuantity` (or the read-line props) to take `quantifierName` + effective value; render name when value null. Pass the resolved values from `RecipeIngredientView` at the three call sites.
- [ ] **Step 3:** run → PASS. **Commit.**

### Task 4.2: Scaling + aggregation

**Files:** Modify `src/lib/shopping/items.ts`, `src/lib/shopping/merge.ts`, `src/lib/meal-plans/service.ts`; Test `tests/shopping-quantifier.test.ts`

- [ ] **Step 1: Failing tests** — `zwei Äpfel`(eff 2) + `3 Äpfel` aggregate to 5; `einige Stiele`(eff null) adds a check-off contributing 0; scaling `zwei Äpfel` ×2 → 4; `einige` never scales.
- [ ] **Step 2:** At the snapshot/merge step (`shopping/merge.ts` `applyAdd`), compute the **effective number** for the contribution (resolve `quantifierId` via the lookup/view) so `shopping_item_source.contributed_quantity` stores the resolved number — downstream aggregation/scaling stays unchanged. Confirm null effective → null contribution (existing path). `meal-plans/service.ts` scaling already skips null/fixed; effective null falls into that path.
- [ ] **Step 3:** run → PASS. **Commit** — `git commit -m "feat(shopping): aggregate/scale the effective quantifier value"`

---

## Phase 5 — Recipe edit form amount field + validation

### Task 5.1: Amount field accepts number or known quantifier

**Files:** Modify `src/components/recipes/ingredient-row.tsx`, `types.ts`, `payload.ts`; Test `tests/ingredient-row-amount.test.tsx`

- [ ] **Step 1: Failing test** — typing a known quantifier name sets `quantifierId` + clears numeric quantity; typing a number clears `quantifierId`; an unknown non-numeric value is invalid.
- [ ] **Step 2:** Beside the numeric `Menge` input, recognize the typed value: if it parses as a number → numeric path; else look it up against a quantifier list (fetched via a small `/api/v1/quantifiers/search?q=` or the page-provided list) → set `quantifierId`; else mark invalid (block, like `validate.ts` blocks bad input). Show the wording in the field (edit form is the one place wording shows).
- [ ] **Step 3:** run → PASS; typecheck. **Commit.**

---

## Phase 6 — Mass-parse diff (effective number + representation diff + tooltip)

### Task 6.1: Quantifier tooltip on the amount + representation-based diff

**Files:** Modify `src/components/recipes/ingredient-read-line.tsx`, `ingredient-line.tsx` (reuse the Popover), `bulk-reparse-dialog.tsx` (`computeHighlights` amount equality); Test `tests/bulk-reparse-amount-diff.test.ts`

- [ ] **Step 1: Failing test** — current literal `2` vs proposed quantifier `zwei` (eff 2): amount flagged changed even though both render "2"; the quantifier side exposes `quantifierName` for the tooltip.
- [ ] **Step 2:** Amount diff equality compares the representation tuple `(quantity, quantityLow, quantifierId)` (not just the effective number). Render a dotted-underline Popover on the amount (mirror `ingredient-line.tsx`) showing "Entspricht: {quantifierName}" when a quantifier is referenced.
- [ ] **Step 3:** run → PASS. **Commit** — `git commit -m "feat(reparse): quantifier-aware amount diff + tooltip"`

---

## Phase 7 — Stammdaten management (CRUD, usage tab, delete-guard, merge)

### Task 7.1: Service + adapter

**Files:** Create `src/lib/stammdaten/quantifier/{service,adapter}.ts`; Test `tests/quantifier-service.test.ts`

- [ ] **Step 1: Failing test** — create/list (with `recipeRefCount`)/update/delete; delete **blocked** when `recipeRefCount > 0`; `deleteQuantifier(id, replaceWith)` rewires `recipe_ingredient.quantifier_id`; merge rewires refs.
- [ ] **Step 2:** Mirror `src/lib/stammdaten/unit/service.ts`: `listQuantifiersManaged/getQuantifierDetail/createQuantifier/updateQuantifier/deleteQuantifier/mergeQuantifiers/getImpactForQuantifiers`. Ref count via `count(recipeIngredient.quantifierId)`; linked recipes via the `linked-recipes` helper keyed on `recipeIngredient.quantifierId`. Adapter `fkRewires` includes `{ table: recipeIngredient, column: recipeIngredient.quantifierId, refLabel: "recipes" }`.
- [ ] **Step 3:** run → PASS. **Commit.**

### Task 7.2: API routes

**Files:** Create `src/app/api/v1/quantifiers/manage/route.ts`, `.../[id]/route.ts`, `.../impact/route.ts`

- [ ] **Step 1:** Mirror `src/app/api/v1/units/manage/*`: GET(list)/POST(create) + GET/PATCH/DELETE(`?replaceWith=`) + impact. Zod `upsertSchema` = `{ name: string, value: number|null, aliases: string[], sortOrder?: number }`. Call `publishShoppingChanged()` on mutations. **Step 2:** typecheck + a thin route test. **Step 3:** commit.

### Task 7.3: List page + edit form + EntityKind

**Files:** Create `src/components/settings/stammdaten/pages/quantifier-page-client.tsx`, `.../edit-forms/quantifier-form.tsx`; Modify `src/components/settings/stammdaten/types.ts` (+`"quantifier"`), `list-shell.tsx` (`pluralFor`), and add the route page under `src/app/(app)/einstellungen/stammdaten/...`.

- [ ] **Step 1:** Mirror `unit-page-client.tsx` + `UnitForm`: columns name / value / aliases / **"Verwendung" (recipeRefCount Rezepte)**; `EditForm={QuantifierForm}` (fields: name, value (numeric, optional), aliases, sortOrder); `hardDeleteAllowed={false}` so the delete dialog blocks while referenced and offers replace-with. **Step 2:** `npm run build` (stop dev server first) to catch RSC boundary issues. **Step 3:** commit — `git commit -m "feat(stammdaten): quantifier management UI"`.

---

## Final verification

- [ ] Full suite green: `npx vitest run`.
- [ ] `npm run build` clean (dev server stopped).
- [ ] Manual smoke against prod-dump dev server: import "einige Stiele Petersilie, glatte" → `einige Stiele Petersilie` (note glatte); "zwei Äpfel" → shows "2", edit form shows "zwei"; Stammdaten quantifier page lists usage + blocks delete while used.

## Self-review notes
- **Spec coverage:** table+FK (1.1), seed (1.2), lookup (1.3), recognition+resolution (2.1), number-word migration (2.2), threading (2.3), effective value (3.1), persistence+validation (3.2), display (4.1), scale/aggregate (4.2), edit field (5.1), diff+tooltip (6.1), management+usage+delete-guard+merge (7.x). All spec sections map to a task.
- **Type consistency:** `quantifierId: number | null` used identically in `ParsedRow`, `ImportedIngredient`, `DraftIngredient`, `RecipeIngredientInput`; `QuantifierLookupEntry {id,name,value}` and `effectiveQuantity(row, byId)` signatures are stable across tasks.
- **Risk:** Task 2.2 (deleting the number-word lists) is the highest-risk step — gated by the full parser parity/golden suite. Sequence 1.x before 2.x; 2.1 must land (lookup-driven recognition working) before 2.2 removes the code lists.

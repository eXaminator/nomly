# Unit-aware ingredient matching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the parsed unit decide between name-plausible ingredient matches (canned vs fresh), via a post-gate rank-time score doubling, plus a configurable global default unit and advisory (non-unique) aliases.

**Architecture:** The matcher keeps its name-only `score` (the auto-match gate still reads that). A new rank step doubles a candidate's *sort* weight when its resolved unit equals the line's resolved unit — but only for candidates that already clear the gate, so the unit can never crash the gate. The line unit comes from the existing `resolveUnit`; each catalog entry carries a resolved unit (`alias default → ingredient default → global default`). The `"stück"` fallback becomes a configurable `app_setting` pointer.

**Tech Stack:** Next.js 16, SQLite + Drizzle, vitest. Spec: `docs/superpowers/specs/2026-06-02-unit-aware-ingredient-matching-design.md`.

---

## File structure

- `src/lib/recipe-import/matching.ts` — add `unitId` to `CatalogEntry`/`IngredientCandidateMatch`; add unit-aware re-ranking to `findIngredientCandidates`. (Engine — Phase A.)
- `src/db/schema.ts` — `app_setting` accessor lives elsewhere; no column change except dropping the alias unique index (Phase D).
- `src/lib/settings/global-default-unit.ts` (Create) — read/write the `global_default_unit_id` setting. (Phase B.)
- `src/lib/recipe-import/index.ts` — `resolveUnit` uses the global default; `buildIngredientCatalog` sets resolved `unitId`; pass line unit into `findIngredientCandidates`. (Phases B/C.)
- `drizzle/` migration — drop `ingredient_alias_name_unique`; seed `global_default_unit_id`. (Phase D.)
- `src/app/api/v1/units/manage/route.ts` (+ `[id]`) and the units UI — global-default checkbox. (Phase E.)
- Ingredient-management UI + an alias-collision lookup — advisory warning. (Phase E.)

---

## Phase A — Matcher unit decider (engine, DB-free, TDD)

### Task A1: Carry a resolved `unitId` on catalog entries and matches

**Files:**
- Modify: `src/lib/recipe-import/matching.ts` (`CatalogEntry`, `IngredientCandidateMatch`, `bestMatchForEntry`)

- [ ] **Step 1:** Add `unitId?: number;` to `CatalogEntry` (after `defaultUnit`), with a doc comment: "Resolved default unit id (alias → ingredient → global default) used by the unit decider in `findIngredientCandidates`. Distinct from `defaultUnit`, which is the display unit for the row."
- [ ] **Step 2:** Add `unitId?: number;` to `IngredientCandidateMatch` (after `defaultUnit`).
- [ ] **Step 3:** In `bestMatchForEntry`, set `unitId: entry.unitId,` on the returned match object (alongside `defaultUnit`).
- [ ] **Step 4:** `npx tsc --noEmit` → expect PASS (additive optional fields).
- [ ] **Step 5:** Commit: `feat(matching): carry resolved unitId on catalog entries/matches`.

### Task A2: Unit-aware re-ranking in `findIngredientCandidates`

**Files:**
- Modify: `src/lib/recipe-import/matching.ts` (`FindCandidatesOptions`, `findIngredientCandidates`)
- Test: `tests/ingredient-matching.test.ts`

- [ ] **Step 1: Write failing tests.** Append a `describe("unit decider", …)` block. Use a static catalog with explicit `unitId`s; gate = `MIN_AUTO_MATCH_SCORE`.

```ts
describe("unit decider", () => {
  const DOSE = 12, STUECK = 14, G = 1;
  // fresh Tomate (Stück) vs Dosentomate (Dose); both share base + descriptor aliases
  function cat() {
    const e = (id: number, c: string, a: string, unitId: number) => ({
      ingredientId: id, canonicalName: c, aliasName: a,
      tokens: a.toLowerCase().split(/\s+/), unitId,
    });
    return [
      e(123, "Tomate", "Tomate", STUECK), e(123, "Tomate", "tomatoes", STUECK),
      e(123, "Tomate", "Tomaten", STUECK),
      e(580, "Dosentomate", "Dosentomate", DOSE),
      e(580, "Dosentomate", "tomatoes", DOSE), e(580, "Dosentomate", "Tomaten", DOSE),
      e(580, "Dosentomate", "chopped tomatoes", DOSE),
    ];
  }

  it("unit Dose picks the canned variant when both clear the gate (shared alias)", () => {
    const { matches } = findIngredientCandidates("Tomaten", cat(), { lineUnitId: DOSE });
    expect(matches[0].ingredientId).toBe(580);
  });

  it("unit Stück picks fresh for the same shared alias", () => {
    const { matches } = findIngredientCandidates("Tomaten", cat(), { lineUnitId: STUECK });
    expect(matches[0].ingredientId).toBe(123);
  });

  it("unit Stück overrides a higher NAME score (fresh beats canned 'chopped tomatoes')", () => {
    // "tomatoes, chopped": canned matches both tokens (~200), fresh matches "tomatoes" (~130).
    const { matches } = findIngredientCandidates("tomatoes, chopped", cat(), { lineUnitId: STUECK });
    expect(matches[0].ingredientId).toBe(123);
  });

  it("non-matching unit (g) falls back to name score → canned wins on 'chopped tomatoes'", () => {
    const { matches } = findIngredientCandidates("chopped tomatoes", cat(), { lineUnitId: G });
    expect(matches[0].ingredientId).toBe(580);
  });

  it("doubling never crosses the gate: a below-gate unit match does not auto-clear", () => {
    // "Dosento" prefix-matches only "Dosentomate" (suffix/prefix, no bonus) → ~110 < 130.
    const only = [{ ingredientId: 580, canonicalName: "Dosentomate", aliasName: "Dosentomate",
      tokens: ["dosentomate"], unitId: DOSE }];
    const { matches } = findIngredientCandidates("Dosento", only, { lineUnitId: DOSE });
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE); // score stays name-only, undoubled
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/ingredient-matching.test.ts -t "unit decider"` → expect FAIL (option `lineUnitId` ignored).
- [ ] **Step 3: Implement.** Add to `FindCandidatesOptions`:

```ts
  /** Resolved canonical unit id of the line being matched (or null). When set,
   *  a gate-clearing candidate whose resolved unit equals this id gets its SORT
   *  weight doubled — the unit decides between name-plausible candidates. The
   *  gate itself still reads the undoubled `score`, so the unit can never push
   *  a below-gate match to an auto-pick. */
  lineUnitId?: number | null;
  /** Gate used to qualify a candidate for unit doubling. Defaults to
   *  MIN_AUTO_MATCH_SCORE. */
  gateScore?: number;
```

Then replace the `sorted` computation. Define a rank-weight helper and sort on it:

```ts
  const lineUnitId = options.lineUnitId ?? null;
  const gate = options.gateScore ?? MIN_AUTO_MATCH_SCORE;
  // Rank weight = name score, doubled when (a) the candidate already clears the
  // gate on its NAME score and (b) its resolved unit equals the line's unit.
  // Gating on the undoubled score is what stops the unit from crossing the gate.
  const rankWeight = (m: IngredientCandidateMatch): number =>
    lineUnitId != null && m.unitId === lineUnitId && m.score >= gate
      ? m.score * 2
      : m.score;
  const sorted = Array.from(bestById.values()).sort((a, b) => {
    const aw = rankWeight(a.match);
    const bw = rankWeight(b.match);
    if (aw !== bw) return bw - aw;
    if (a.match.isCanonical !== b.match.isCanonical) {
      return a.match.isCanonical ? -1 : 1;
    }
    if (a.match.aliasName.length !== b.match.aliasName.length)
      return b.match.aliasName.length - a.match.aliasName.length;
    return a.match.canonicalName.localeCompare(b.match.canonicalName, "de");
  });
```

(`match.score` is left untouched, so the caller's gate check is unaffected.)

- [ ] **Step 4:** Run the same vitest filter → expect PASS. Then run the whole file → expect PASS (no regressions).
- [ ] **Step 5:** Commit: `feat(matching): unit-aware re-ranking gated on the undoubled score`.

---

## Phase B — Global default unit

### Task B1: `global_default_unit_id` setting accessor

**Files:**
- Create: `src/lib/settings/global-default-unit.ts`
- Test: `tests/global-default-unit.test.ts`

- [ ] **Step 1:** Confirm the `app_setting` table shape: run `sqlite3 data/prod/nomly.db ".schema app_setting"`. Use the existing key/value accessor pattern (search `appSetting` usages in `src/lib`). If a generic getter/setter exists, wrap it; otherwise read/write `appSetting` directly via `db`.
- [ ] **Step 2: Write failing test** `tests/global-default-unit.test.ts`: set the setting to a unit id, read it back; unset → returns null. (Use an in-memory/seeded test db per existing db-test pattern; if none, make the module pure over an injected getter and test that.)
- [ ] **Step 3: Implement** `getGlobalDefaultUnitId(): number | null` and `setGlobalDefaultUnitId(id: number): void` over `app_setting` key `global_default_unit_id`.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(settings): global_default_unit_id accessor`.

### Task B2: `resolveUnit` + catalog use the global default

**Files:**
- Modify: `src/lib/recipe-import/index.ts` (`resolveUnit` ~245-274; `buildIngredientCatalog` ~293-352; `buildUnitLookup`)
- Test: `tests/ingredient-parse.test.ts` (or the existing resolveUnit test file)

- [ ] **Step 1:** Add the global default unit id to `UnitLookup` (a `globalDefaultUnitId: number | null` field, populated in `buildUnitLookup` from `getGlobalDefaultUnitId()`).
- [ ] **Step 2: Write failing test:** with a lookup whose `globalDefaultUnitId` points at `Stück`, `resolveUnit(lookup, null, 2)` returns `{ id: Stück }`; when it points elsewhere (e.g. a `Glas`), it returns that. Also: unset → current literal `"stück"` fallback.
- [ ] **Step 3: Implement** in `resolveUnit`: when no unit token and `quantity > 0`, prefer `lookup.globalDefaultUnitId` (look the entry up by id) and fall back to the literal `byCanonicalName.get("stück")` only when unset/missing.
- [ ] **Step 4:** In `buildIngredientCatalog`, set `unitId` on every entry = `alias default ?? ingredient default ?? globalDefaultUnitId`. For alias rows, add the parent `ingredient.defaultUnitId` to the select (`ingredient.defaultUnitId`) so the fallback can read it. `defaultUnit` (display) is unchanged.
- [ ] **Step 5:** Run tests → PASS; `npx tsc --noEmit` → PASS.
- [ ] **Step 6:** Commit: `feat(import): resolve missing unit + catalog unitId via global default`.

---

## Phase C — Wire the line unit into the matcher call

**Files:**
- Modify: `src/lib/recipe-import/index.ts` (the matcher call ~647-652)
- Test: `tests/ingredient-matching.test.ts` already covers the option; add one parse-level integration test if a parse harness exists.

- [ ] **Step 1:** At the `findIngredientCandidates(wideText, catalog)` call, resolve the line unit first (the parse path already has the parsed unit + `units` lookup): `const lineUnit = resolveUnit(lookups.units, parsed.unitName, parsed.quantity).resolved;` and pass `{ lineUnitId: lineUnit?.id ?? null, gateScore: autoMatchScoreThreshold }`.
- [ ] **Step 2:** `npx tsc --noEmit` → PASS; run the matcher + parse test files → PASS.
- [ ] **Step 3:** Commit: `feat(import): pass resolved line unit into the matcher`.

---

## Phase D — Migration: drop alias uniqueness + seed global default

**Files:**
- Modify: `src/db/schema.ts` (`ingredientAlias.name` — drop `.unique()`)
- Create: a Drizzle migration (via `npx drizzle-kit generate` or a hand-written SQL migration following the repo's existing migration style)

- [ ] **Step 1:** Inspect an existing migration in `drizzle/` to match the project's generation style (drizzle-kit vs hand-written). Follow it.
- [ ] **Step 2:** Remove `.unique()` from `ingredientAlias.name` in `schema.ts` (keep `ingredient.name` unique).
- [ ] **Step 3:** Generate/author the migration: `DROP INDEX ingredient_alias_name_unique;` and an idempotent insert of `app_setting('global_default_unit_id', <Stück id>)` if absent. Verify it's the next sequential migration (head was 0033 per project memory; new head 0034).
- [ ] **Step 4:** Apply migrations to a scratch copy of the prod db and confirm clean apply: `cp data/prod/nomly.db /tmp/mig.db` then run the migrate path against it (per repo tooling). Expect no errors; index gone; setting present.
- [ ] **Step 5:** `npm run build` → PASS (catches RSC/boundary + drizzle issues).
- [ ] **Step 6:** Commit: `feat(db): drop alias name uniqueness; seed global default unit (0034)`.

---

## Phase E — UI: global-default checkbox + advisory alias warning

### Task E1: Global-default checkbox in units management

**Files:**
- Modify: `src/app/api/v1/units/manage/route.ts` and/or `[id]/route.ts` (accept a `globalDefault: true` toggle → calls `setGlobalDefaultUnitId`)
- Modify: the units management UI component (find via the `units/manage` consumer)

- [ ] **Step 1:** Read the existing manage route + UI to follow patterns.
- [ ] **Step 2:** API: add handling so setting a unit as global default writes the pointer (overwrite = silent switch-over; never errors). Expose current pointer in the units GET.
- [ ] **Step 3:** UI: a single-select checkbox/radio per unit row, checked for the pointer unit; toggling another switches it.
- [ ] **Step 4:** `npm run build` → PASS. Manual/Playwright check the toggle persists and switches.
- [ ] **Step 5:** Commit: `feat(units): global default unit checkbox`.

### Task E2: Advisory alias-collision warning

**Files:**
- Create/Modify: an alias-collision lookup (given a normalized name, return other ingredients using it + their resolved unit) in `src/lib/recipe-import/index.ts` or a new `src/lib/ingredients/alias-collisions.ts`
- Modify: the ingredient-management UI alias editor to surface the warning inline

- [ ] **Step 1:** Read the alias-editing UI + its save endpoint.
- [ ] **Step 2:** Add a query: for a (normalized) alias name, return catalog entries elsewhere sharing it, each with its resolved unit name.
- [ ] **Step 3:** UI: when the edited alias name collides, show a non-blocking inline warning listing the colliding ingredient(s) + unit(s). Saving still succeeds.
- [ ] **Step 4:** `npm run build` → PASS.
- [ ] **Step 5:** Commit: `feat(ingredients): advisory warning for duplicate alias names`.

---

## Self-review

- **Spec coverage:** Section 1 (global default) → B1/B2/D/E1. Section 2 (non-unique + warning) → D/E2. Section 3 (decider, gate on undoubled score) → A1/A2/C. Section 4 (shared-alias curation) → data, enabled by D; covered by A2 tests. Section 5 (migration + tests) → D + the A2 matrix. No gaps.
- **Gate-crasher guard:** A2 Step 1 includes the explicit below-gate test.
- **Type consistency:** `unitId` added in A1 to both `CatalogEntry` and `IngredientCandidateMatch`; `lineUnitId`/`gateScore` options in A2; `globalDefaultUnitId` on `UnitLookup` in B2. Names consistent across tasks.
- **Degradation:** with no default units / unset pointer, `lineUnitId` and entry `unitId` are null/Stück → doubling rarely/uniformly fires → behaviour reverts to today's name-only ranking.

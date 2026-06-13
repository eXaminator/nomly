# Unspecific Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a unit be flagged "unspecific" (etwas / a sprinkle / ein Schuss) so it takes no amount: the parser never invents a quantity for it, the editor hides the amount, and the shopping list collapses duplicate contributions to one line.

**Architecture:** A single boolean column `unspecific` on `unit`. The flag is threaded into the AST amount/unit parser (which gains strict multi-token unit matching to fire multi-word aliases like "a sprinkle"). When a matched unit is unspecific, `quantity` is forced to `null` (dropping any leading number); the existing `fixedAmount = quantity === null` rule then makes it non-scaling. Display and shopping-list aggregation already handle null-quantity unit-bearing rows correctly, so they get verifying tests rather than new logic.

**Tech Stack:** Next.js 16, SQLite + Drizzle, Vitest, React.

---

## File structure

- `src/db/schema.ts` — add `unspecific` column to `unit`.
- `drizzle/0038_*.sql` — generated migration (head 0037 → 0038).
- `src/lib/recipe-import/index.ts` — `UnitLookup` gains `unspecificTokens` + `maxUnitTokens`; `buildUnitLookup` populates them; `parseIngredientLines` (both call sites) pass them into segment lookups.
- `src/lib/recipe-import/ast/parse-line.ts` — `SegmentLookups` gains `unspecificUnitTokens` + `maxUnitTokens`; passes them to the amount passes.
- `src/lib/recipe-import/ast/passes/amount-unit.ts` — strict multi-token matcher + unspecific handling (leading short-circuit, main probe, trailing fallback).
- `src/lib/recipe-import/ast/passes/colon-amount.ts` — thread the new opts through to `applyAmountUnit`.
- `src/lib/stammdaten/unit/service.ts` — persist + normalize `unspecific` (factor=1, baseUnitId=null), expose it in list/detail types.
- `src/app/api/v1/units/manage/route.ts` + `.../[id]/route.ts` — add `unspecific` to the zod schemas.
- `src/components/settings/stammdaten/edit-forms/unit-form.tsx` — "Unspezifisch" switch; hide Dimension/Basis-Einheit/Faktor when on; send `unspecific` in payload.
- `src/components/recipes/<ingredient edit row>.tsx` — disable amount input when the selected unit is unspecific (pin exact file during Task 6).
- Tests colocated per existing convention (`*.test.ts(x)` next to source or under existing test dirs).

---

## Task 1: Schema column + migration

**Files:**
- Modify: `src/db/schema.ts` (unit table, after `displayFraction`)
- Create: `drizzle/0038_*.sql` (generated)

- [ ] **Step 1: Add the column to the schema**

In `src/db/schema.ts`, inside the `unit` table definition, after the `displayFraction` column, add:

```ts
  /**
   * When true, this unit takes NO amount (e.g. "etwas", "a sprinkle", "ein
   * Schuss"). The parser never assigns it a quantity (any leading number is
   * dropped); dimension/factor/baseUnit are meaningless and forced to the
   * defaults (dimension stays non-null, factor = 1, baseUnitId = NULL).
   */
  unspecific: integer("unspecific", { mode: "boolean" })
    .notNull()
    .default(false),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0038_*.sql` adding `unspecific` to `unit` with `DEFAULT false NOT NULL`, plus updated `drizzle/meta` snapshot.

- [ ] **Step 3: Apply to the local dev DB and verify it's clean**

Run: `npm run migrate`
Expected: migration 0038 applies with no error.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(units): add unspecific column to unit (migration 0038)"
```

---

## Task 2: Unit lookup exposes unspecific tokens + max token width

**Files:**
- Modify: `src/lib/recipe-import/index.ts` (`UnitLookup`, `buildUnitLookup`, both `parseIngredientLines` segLookups blocks ~705 and ~1440)
- Test: `src/lib/recipe-import/build-unit-lookup.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/db";
import { unit, unitAlias } from "@/db/schema";
import { buildUnitLookup } from "@/lib/recipe-import";

describe("buildUnitLookup unspecific", () => {
  beforeEach(() => {
    db.delete(unitAlias).run();
    db.delete(unit).run();
  });

  it("collects unspecific tokens and the max alias token width", () => {
    const [u] = db
      .insert(unit)
      .values({ name: "etwas", dimension: "count", factor: 1, unspecific: true })
      .returning({ id: unit.id })
      .all();
    db.insert(unitAlias).values({ unitId: u.id, name: "a sprinkle" }).run();
    db.insert(unit).values({ name: "g", dimension: "mass", factor: 1 }).run();

    const lookup = buildUnitLookup();
    expect(lookup.unspecificTokens.has("etwas")).toBe(true);
    expect(lookup.unspecificTokens.has("a sprinkle")).toBe(true);
    expect(lookup.unspecificTokens.has("g")).toBe(false);
    expect(lookup.maxUnitTokens).toBe(2); // "a sprinkle"
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- build-unit-lookup`
Expected: FAIL (`unspecificTokens`/`maxUnitTokens` undefined).

- [ ] **Step 3: Implement**

In `UnitLookup` type add:

```ts
  /** Lowercased names/aliases/plurals of units flagged `unspecific` — these
   *  take no amount; the parser forces their quantity to null. */
  unspecificTokens: Set<string>;
  /** Largest token-count across all unit names/aliases (split on whitespace).
   *  The amount pass probes unit windows from this width down to 1. */
  maxUnitTokens: number;
```

In `buildUnitLookup`, add `unspecific: unit.unspecific` to the `canonical` select and `isUnspecific: unit.unspecific` to the `aliases` select. Build the set alongside `containerTokens`:

```ts
  const unspecificTokens = new Set<string>();
```

For each canonical unit `u`, after adding tokens:

```ts
    if (u.unspecific) {
      unspecificTokens.add(lower);
      if (u.plural) unspecificTokens.add(u.plural.toLowerCase());
    }
```

For each alias row `a` (with `isUnspecific` selected), inside the `for (const token …)` loop:

```ts
      if (a.isUnspecific) unspecificTokens.add(key);
```

After both loops, compute the width and return it:

```ts
  let maxUnitTokens = 1;
  for (const key of byNameOrAlias.keys()) {
    const n = key.trim().split(/\s+/).length;
    if (n > maxUnitTokens) maxUnitTokens = n;
  }
  return { byNameOrAlias, byCanonicalName, byId, containerTokens,
    unspecificTokens, maxUnitTokens,
    globalDefaultUnitId: getGlobalDefaultUnitId() };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- build-unit-lookup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-import/index.ts src/lib/recipe-import/build-unit-lookup.test.ts
git commit -m "feat(units): expose unspecific tokens + max unit token width from buildUnitLookup"
```

---

## Task 3: Thread unspecific opts into the amount passes

**Files:**
- Modify: `src/lib/recipe-import/ast/parse-line.ts` (`SegmentLookups`, the amount-pass call)
- Modify: `src/lib/recipe-import/ast/passes/amount-unit.ts` (signature only)
- Modify: `src/lib/recipe-import/ast/passes/colon-amount.ts` (signature + pass-through)
- Modify: `src/lib/recipe-import/index.ts` (both segLookups objects)

This task is the plumbing; behavior comes in Task 4. No new test (Task 4 covers it); just keep the suite green.

- [ ] **Step 1: Add the opts type to `amount-unit.ts`**

At the top of `amount-unit.ts`, add and export:

```ts
export type UnspecificOpts = {
  /** Lowercased tokens of units that take no amount. */
  unspecificTokens?: ReadonlySet<string>;
  /** Max unit-name token width to probe (default 1 = single-token only). */
  maxUnitTokens?: number;
};
```

Change the signature to:

```ts
export function applyAmountUnit(
  source: string,
  leaves: Leaf[],
  knownUnitTokens: ReadonlySet<string>,
  opts: UnspecificOpts = {},
): AmountUnit {
```

Add near the top of the body (after `const norm = …` is in scope):

```ts
  const unspecificTokens = opts.unspecificTokens ?? new Set<string>();
  const maxUnitTokens = Math.max(1, opts.maxUnitTokens ?? 1);
```

- [ ] **Step 2: Thread through `colon-amount.ts`**

Change `applyColonAmount`'s signature to accept `opts: UnspecificOpts = {}` (import the type) and pass it: `applyAmountUnit(source, leaves.slice(colonIdx + 1), knownUnitTokens, opts)`.

- [ ] **Step 3: Extend `SegmentLookups` and the call in `parse-line.ts`**

In `SegmentLookups` add:

```ts
  unspecificUnitTokens?: ReadonlySet<string>;
  maxUnitTokens?: number;
```

In `parseLeaves`, change the amount-pass call to pass opts:

```ts
  const unspecificOpts = {
    unspecificTokens: lookups.unspecificUnitTokens,
    maxUnitTokens: lookups.maxUnitTokens,
  };
  const { quantity, unitName, rangeExpression } =
    applyColonAmount(source, leaves, lookups.knownUnitTokens, unspecificOpts) ??
    applyAmountUnit(source, leaves, lookups.knownUnitTokens, unspecificOpts);
```

- [ ] **Step 4: Pass them from `index.ts`**

In `parseIngredientLines`, in the `segLookups` object (~line 704), add:

```ts
          unspecificUnitTokens: lookups.units.unspecificTokens,
          maxUnitTokens: lookups.units.maxUnitTokens,
```

Find the second `segLookups`/parse call near line 1440 (the bulk-reparse path) and add the same two fields.

- [ ] **Step 5: Run the suite**

Run: `npm run test -- recipe-import`
Expected: PASS (no behavior change yet).

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipe-import
git commit -m "refactor(parser): thread unspecific-unit opts into amount passes"
```

---

## Task 4: Parser — strict multi-token matching + unspecific behavior

**Files:**
- Modify: `src/lib/recipe-import/ast/passes/amount-unit.ts`
- Test: `src/lib/recipe-import/ast/passes/amount-unit.unspecific.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Use the real parse entry point so tokens/opts are wired the same way the app wires them.

```ts
import { describe, expect, it } from "vitest";
import { parseSegment } from "@/lib/recipe-import/ast/parse-line";

const lookups = (over = {}) => ({
  knownUnitTokens: new Set(["etwas", "a sprinkle", "ein schuss", "g"]),
  unspecificUnitTokens: new Set(["etwas", "a sprinkle", "ein schuss"]),
  maxUnitTokens: 2,
  catalog: [],
  ...over,
});

describe("unspecific units in the amount pass", () => {
  it("single-token unspecific gets a null quantity", () => {
    const r = parseSegment("etwas Öl", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName).toBe("etwas");
  });

  it("drops a leading number before an unspecific unit", () => {
    const r = parseSegment("2 etwas Salz", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName).toBe("etwas");
  });

  it("matches a multi-word unspecific alias whose first word is an article", () => {
    const r = parseSegment("a sprinkle of salt", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName?.toLowerCase()).toBe("a sprinkle");
  });

  it("matches a multi-word German unspecific alias", () => {
    const r = parseSegment("ein Schuss Öl", lookups());
    expect(r.quantity).toBeNull();
    expect(r.unitName?.toLowerCase()).toBe("ein schuss");
  });

  it("does NOT match a near-miss partial of a multi-word alias", () => {
    // "a pinch" is not a registered alias; "a" must not be swallowed as a unit.
    const r = parseSegment("a pinch of salt", lookups());
    expect(r.unitName).not.toBe("a sprinkle");
  });

  it("a normal unit still defaults a bare unit to quantity 1", () => {
    const r = parseSegment("g Mehl", lookups());
    expect(r.quantity).toBe(1);
    expect(r.unitName).toBe("g");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- amount-unit.unspecific`
Expected: FAIL (leading article "a" currently consumed as quantity 1; "etwas" not recognized as a unit unless seeded; multi-word never matches).

- [ ] **Step 3: Implement the matcher + behavior**

In `amount-unit.ts`, add these helpers after `unspecificTokens`/`maxUnitTokens` are defined:

```ts
  const isUnspecificName = (name: string): boolean => {
    const l = name.toLowerCase();
    return unspecificTokens.has(l) || unspecificTokens.has(norm(l));
  };
  // Longest contiguous unit window at index i: join group texts with single
  // spaces and probe the known-unit set from maxUnitTokens down to 1. STRICT —
  // exact joined-token equality only (no fuzzy/prefix/gaps). Skips windows that
  // include an already-consumed group. Returns the matched length + display
  // name, or null.
  const matchUnitAt = (i: number): { len: number; name: string } | null => {
    const maxLen = Math.min(maxUnitTokens, groups.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const win = groups.slice(i, i + len);
      if (win.some((g) => g.leaves.every((l) => l.consumed))) continue;
      const raw = win.map((g) => g.text).join(" ");
      const lower = raw.toLowerCase();
      if (knownUnitTokens.has(lower) || knownUnitTokens.has(norm(lower))) {
        return { len, name: raw.replace(/\.$/, "") };
      }
    }
    return null;
  };
  const consumeUnitWindow = (i: number, len: number) => {
    for (let k = 0; k < len; k++) consumeGroup(groups[i + k], "unit");
  };
```

Insert the **leading short-circuit** right after the leading-skip `while` loop (after the `break;`/closing brace around line 103), before `let quantity`:

```ts
  // Unspecific units ("etwas", "a sprinkle", "ein Schuss") take NO amount. If
  // the segment leads with one — including a multi-word alias whose first word
  // is an article ("a sprinkle") — claim it as the unit with a null quantity
  // and stop. The "2 etwas" shape (number first) is handled by the main probe.
  {
    const m = matchUnitAt(cur);
    if (m && isUnspecificName(m.name)) {
      consumeUnitWindow(cur, m.len);
      cur += m.len;
      if (cur < groups.length && POST_UNIT_CONNECTORS.has(norm(groups[cur].text))) {
        consumeGroup(groups[cur], "unit");
        cur += 1;
      }
      return { quantity: null, unitName: m.name, rangeExpression: null };
    }
  }
```

(Note: `quantity`/`unitName`/`rangeExpression` `let`s are declared just below; the early `return` here uses literals so it is fine to sit above them. If the linter prefers, move this block to just after those three `let` declarations and `return { quantity: null, unitName: m.name, rangeExpression: null }` unchanged.)

Replace the **main probe** block (the `let probe = cur; while (… !isUnit(groups[probe]) …)` loop and the `if (probe < groups.length && isUnit(groups[probe])) { … } else { … }`) with:

```ts
  let probe = cur;
  while (
    probe < groups.length &&
    !matchUnitAt(probe) &&
    (SIZE_MODIFIERS.has(norm(groups[probe].text)) ||
      isSizeCompound(groups[probe]) ||
      isParenGroup(groups[probe]))
  ) {
    probe += 1;
  }
  const probed = probe < groups.length ? matchUnitAt(probe) : null;
  if (probed) {
    consumeUnitWindow(probe, probed.len);
    unitName = probed.name;
    if (isUnspecificName(probed.name)) {
      quantity = null; // unspecific: drop any number parsed in front ("2 etwas")
    } else if (quantity === null) {
      quantity = 1;
    }
    cur = probe + probed.len;
    if (cur < groups.length && POST_UNIT_CONNECTORS.has(norm(groups[cur].text))) {
      consumeGroup(groups[cur], "unit");
      cur += 1;
    }
  } else {
    // Trailing-unit fallback: "1 garlic clove" — the unit follows the name.
    const region: Group[] = [];
    for (let k = cur; k < groups.length; k++) {
      const g = groups[k];
      if (g.leaves.some((l) => l.depth === 0 && (l.kind === "comma" || l.kind === "open"))) break;
      region.push(g);
    }
    const hasNumber = region.some((g) => g.leaves.some((l) => l.kind === "number"));
    const last = region[region.length - 1];
    if (!hasNumber && region.length >= 2 && last && isUnit(last)) {
      consumeGroup(last, "unit");
      unitName = last.text.replace(/\.$/, "");
      if (isUnspecificName(unitName)) quantity = null;
      else if (quantity === null) quantity = 1;
    }
  }
```

(`isUnit` stays defined and is still used by the range-detection block and the size-compound block; only the probe switches to `matchUnitAt`.)

- [ ] **Step 4: Run the new tests**

Run: `npm run test -- amount-unit.unspecific`
Expected: PASS.

- [ ] **Step 5: Run the full recipe-import suite (regression guard)**

Run: `npm run test -- recipe-import`
Expected: PASS — the existing single-token behavior is unchanged (a single-word catalog yields `maxUnitTokens = 1`, so `matchUnitAt` reduces to the old `isUnit`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/recipe-import/ast/passes/amount-unit.ts src/lib/recipe-import/ast/passes/amount-unit.unspecific.test.ts
git commit -m "feat(parser): strict multi-token unit matching + unspecific units take no amount"
```

---

## Task 5: Service + API persist and normalize `unspecific`

**Files:**
- Modify: `src/lib/stammdaten/unit/service.ts` (`UnitListItem`, `UnitUpsertInput`, `loadUnitsBase` select, list/detail mapping, `createUnit`, `updateUnit`)
- Modify: `src/app/api/v1/units/manage/route.ts` and `.../[id]/route.ts` (zod schemas)
- Test: `src/lib/stammdaten/unit/service.unspecific.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/db";
import { unit, unitAlias } from "@/db/schema";
import { createUnit, getUnitDetail } from "@/lib/stammdaten/unit/service";

describe("createUnit unspecific", () => {
  beforeEach(() => {
    db.delete(unitAlias).run();
    db.delete(unit).run();
  });

  it("stores unspecific and forces factor=1, baseUnitId=null", () => {
    const created = createUnit({
      name: "etwas",
      aliases: ["a sprinkle"],
      dimension: "mass", // deliberately wrong-ish; should be ignored for math
      baseUnitId: 999,
      factor: 42,
      isContainer: false,
      displayFraction: false,
      unspecific: true,
    });
    expect(created.unspecific).toBe(true);
    const detail = getUnitDetail(created.id)!;
    expect(detail.unspecific).toBe(true);
    expect(detail.factor).toBe(1);
    expect(detail.baseUnitId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- service.unspecific`
Expected: FAIL (`unspecific` not on the type / not persisted; baseUnitId=999 would throw "not found").

- [ ] **Step 3: Implement**

In `service.ts`:
- Add `unspecific: boolean;` to `UnitListItem` and `UnitUpsertInput`.
- Add `unspecific: unit.unspecific` to BOTH `db.select({...})` blocks in `loadUnitsBase`.
- Add `unspecific: row.unspecific,` to the object literals returned by `listUnitsManaged` and `getUnitDetail`.
- In `createUnit` and `updateUnit`, normalize before validation/persist. At the very top of each, derive effective values:

```ts
  const effective: UnitUpsertInput = input.unspecific
    ? { ...input, baseUnitId: null, factor: 1 }
    : input;
```

Then use `effective` everywhere `input` was used for validation and the `.values(...)`/`.set(...)` calls, and add `unspecific: effective.unspecific` to the insert `.values({...})` and the update `.set({...})`.

- [ ] **Step 4: Add `unspecific` to the API schemas**

In both `route.ts` files add to the zod object:

```ts
  unspecific: z.boolean().default(false),
```

- [ ] **Step 5: Run the test**

Run: `npm run test -- service.unspecific`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stammdaten/unit/service.ts src/app/api/v1/units/manage
git commit -m "feat(units): persist + normalize unspecific flag (factor=1, no base unit)"
```

---

## Task 6: Unit form — switch + conditional fields

**Files:**
- Modify: `src/components/settings/stammdaten/edit-forms/unit-form.tsx`
- Test: none (UI wiring; covered by typecheck/build). Manual check noted below.

- [ ] **Step 1: Add state and payload**

Add `unspecific: boolean;` to the `UnitItem` type. Add state:

```tsx
  const [unspecific, setUnspecific] = React.useState<boolean>(
    item?.unspecific ?? false,
  );
```

Add `unspecific` to the `onPayloadChange` payload object and to the effect dependency array. Because factor is irrelevant when unspecific, relax the `valid` gate so an unspecific unit with an empty/"1" factor still validates:

```tsx
    const valid =
      trimmed.length > 0 && (unspecific || (Number.isFinite(factor) && factor > 0));
```

and send `factor: unspecific ? 1 : (Number.isFinite(factor) ? factor : 0)`.

- [ ] **Step 2: Add the switch and hide irrelevant fields**

Add a switch block (same shape as the Behälter block) — place it directly above the Dimension block:

```tsx
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Unspezifisch</Label>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Aktivieren für Einheiten ohne Menge (etwas, a sprinkle, ein Schuss).
            Solche Einheiten bekommen beim Import keine Zahl; Dimension, Faktor
            und Basis-Einheit entfallen.
          </p>
        </div>
        <Switch checked={unspecific} onCheckedChange={(v) => setUnspecific(Boolean(v))} />
      </div>
```

Wrap the **Dimension**, **Basis-Einheit**, and **Faktor** blocks each in `{!unspecific && ( … )}` so they disappear when the switch is on.

- [ ] **Step 3: Typecheck + build (RSC boundary guard)**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm run build`
Expected: PASS (per project rule — tsc/vitest miss client/server boundary errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/stammdaten/edit-forms/unit-form.tsx
git commit -m "feat(units): 'Unspezifisch' switch hides dimension/factor/base unit"
```

---

## Task 7: Ingredient edit row disables amount for unspecific units

**Files:**
- Modify: the recipe ingredient edit-row component (find with `grep -rln "displayUnit\\|unitId" src/components/recipes | grep -i edit`; the row that renders a quantity input + unit picker)
- Test: none beyond typecheck/build; behavior is small and UI-local.

- [ ] **Step 1: Locate the row and how it knows the selected unit's flags**

Find the component editing a recipe ingredient's quantity + unit. Determine how it has the selected unit object (it already needs dimension/displayFraction etc. for other behavior). Confirm whether `unspecific` is available on that unit object; if the unit list/search payload feeds it, ensure `unspecific` is included (the service now returns it).

- [ ] **Step 2: Disable the amount input when the unit is unspecific**

When the selected unit has `unspecific === true`:
- disable/clear the quantity input,
- store `quantity = null` and `fixedAmount = true` on save,
- re-enable when the unit changes to a non-unspecific one.

Mirror the existing pattern the row uses for `fixedAmount` / null quantity. (Pin exact prop/state names while editing — the row already distinguishes fixed-amount rows for the lock icon.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(recipes): disable amount input when the selected unit is unspecific"
```

---

## Task 8: Shopping-list collapse — verifying test

**Files:**
- Test: `src/lib/units/convert.unspecific.test.ts` (new)

The aggregation already produces one null-quantity line per (ingredient, unit) component for an unspecific unit (it has a non-null `unitId`, `baseUnitId = null`, no edges, and all-null contributions → `chooseDisplay` returns the base unit with `qty = null`). This test locks that behavior so a future change can't regress the "collapse to one entry" decision.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { aggregateContributions, type UnitInfo } from "@/lib/units/convert";

describe("unspecific unit aggregation", () => {
  const etwas: UnitInfo = {
    id: 50, name: "etwas", plural: null, dimension: "count",
    baseUnitId: null, factor: 1,
  };
  const units = new Map<number, UnitInfo>([[50, etwas]]);

  it("collapses two unspecific contributions into one null-quantity line", () => {
    const lines = aggregateContributions(
      [{ unitId: 50, quantity: null }, { unitId: 50, quantity: null }],
      [],
      units,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].unitId).toBe(50);
    expect(lines[0].quantity).toBeNull();
    expect(lines[0].unitName).toBe("etwas");
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test -- convert.unspecific`
Expected: PASS (no production change needed). If it FAILS (e.g. emits `0` or two lines), fix `buildAggregatedAmounts`/`aggregateContributions` so an all-null bucket for a real unit yields exactly one `quantity: null` line, then re-run.

- [ ] **Step 3: Commit**

```bash
git add src/lib/units/convert.unspecific.test.ts
git commit -m "test(shopping): unspecific-unit contributions collapse to one null-quantity line"
```

---

## Task 9: Full verification

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all green.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Final commit if anything was touched**

```bash
git add -A && git commit -m "chore(units): finalize unspecific units" || true
```

---

## Self-review notes

- **Spec coverage:** data model (T1), parser no-amount + number-drop + multi-word aliases + self-tuning width (T2–T4), form + API (T5–T6), editor (T7), display (handled by existing `formatQuantity(null) === ""`, no task needed), shopping collapse (T8), tests across all (T2,T4,T5,T8 + suite in T9). All spec sections map to a task.
- **Type consistency:** `unspecific` added consistently to schema, `UnitLookup`, `UnitListItem`, `UnitUpsertInput`, `UnitItem`, both zod schemas. `matchUnitAt`/`consumeUnitWindow`/`isUnspecificName`/`UnspecificOpts` named identically across Tasks 3–4.
- **Display:** confirmed no change needed — `pluralizeLabel` needs `quantity > 1`, and `formatQuantity(null)` returns `""`.

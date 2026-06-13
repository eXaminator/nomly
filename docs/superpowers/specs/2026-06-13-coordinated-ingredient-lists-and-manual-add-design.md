# Coordinated Ingredient Lists + Manual "Add Ingredient" — Design

**Date:** 2026-06-13
**Branch:** feat/ingredient-ast-parser (or a fresh feature branch off `main`)
**Status:** Approved design, ready for implementation plan

## Goal

Let a single source line that names several ingredients become several **main**
ingredient rows. Concretely, `Oregano, Majoran und Basilikum nach Belieben`
should yield three mains (`Oregano`, `Majoran`, `Basilikum`) sharing the note
`nach Belieben`. Provide both an automatic parser path and manual controls so
the user is never stuck when the parser declines to split.

## Background

The recipe-import AST parser already models a **source-line group**: several
rows that share one full-line `rawText`. Two kinds exist today:

- **Alternatives** — `Kurkuma/Gelbwurz`, `… oder …`, parenthetical options.
  Matched alternatives emit as `isAlternative` rows; unmatched ones fold into
  the primary's note and surface as **chips** (`foldedAlternatives`, rendered by
  `FoldedAltChips` with a `CornerDownRight` icon). A chip promotes the folded
  range to a row via `forceEmitRanges`; deleting an alternative folds it back via
  `reparseDeletingAlternative` / `reparseGroupWithChange`.
- **Conjunction mains** — `Salz und Pfeffer`. A bare `und` between two bare-name
  segments splits into multiple **main** rows that share the line. A trailing note
  (`nach Geschmack`) propagates to every member
  (`applyConjunctionNotePropagation`). (`oder` between bare names routes to the
  alternative path above, not to mains.)

Reparse groups rows by identical `rawText` and rebuilds each group from the
parser's output of that line, plus `forceEmitRanges`/`forceFoldRanges`
directives. Anything the parser does not re-derive is dropped from the group on
reparse.

This feature extends the **conjunction-main** concept to **comma-separated
coordinated lists**, reuses the **chip** mechanism for member-ingredients the
parser is unsure about, and adds a **manual free-text main** for everything
else.

## Scope

Three layers. Each is independently testable.

### Layer 1 — Parser: coordinated comma-lists

**The connector determines the member role — this is the central rule.** This
layer adds detection of **comma-coordinated lists** (today a comma-list is never
expanded — `Paprika, rot oder gelb` stays a single `Paprika` with the rest in the
note). Once detected, the **terminal connector** decides which rule-set the
members go through:

- **`und`** (and `&`, `+` where already treated as `und`) → members go through
  **main-ingredient rules**: matched → main rows, unmatched → ingredient pills
  (Layer 2). New behaviour.
- **`oder`** (and `/`, parenthetical options) → members go through the
  **existing alternative-generation rules**: the first member is the primary,
  the rest are alternatives (matched → `isAlternative` rows, unmatched → folded
  alternative **chips**, exactly as `Petersilie oder Dill` already does for the
  no-comma case). The comma-list *expansion* is new wiring, but it reuses the
  existing alternative classification and chip rendering — no new alternative
  logic.

So a comma-list's terminal connector decides everything: `A, B und C` → three
mains; `A, B oder C` → `A` primary with `B`/`C` as alternatives. `Paprika, rot
oder gelb` is therefore handled by the alternative path (rot/gelb become
alternatives, not mains, and — being absent from the catalog — fold into
alternative chips), and needs no capitalization heuristic.

**Definition of a coordinated `und`-list (the new main-split trigger):**
A segment run splits into mains when **all** hold:

1. It contains one or more commas separating items, AND
2. the final item boundary is an explicit **`und`** connector (any case — rule
   B), AND
3. each item is a **bare name** — no amount and no unit of its own. (A shared
   leading amount/unit or a shared trailing note is allowed and is attached to
   every member, exactly like `Salz und Pfeffer nach Geschmack`.)

A line with commas but **no** terminal `und`/`oder` (`Zwiebel, gewürfelt`) is
**not** a coordinated list and is left exactly as today (post-comma text stays a
note). A comma-list whose terminal connector is **`oder`** routes to the
alternative path, not here.

**Per-member classification of an `und`-list (the catalog gate):**
For each member of a coordinated `und`-list, run the existing ingredient matcher:

- **Match found in the catalog** → emit the member as its own **main** row
  (`isAlternative: false`), sharing the line's `rawText`. This is the auto-split.
- **No match** → do **not** emit a row. Fold the member into the note context
  and record it as a **potential ingredient** (new metadata; see Layer 2).

This per-member rule means a **mixed** list splits the known members and pills
the unknown ones: `Oregano, Schabziger und Basilikum` (Schabziger absent from
the catalog) → `Oregano` + `Basilikum` as mains, `+ Schabziger` as a pill.

**Why the catalog gate (vs. the pure `und` split):** the bare `Salz und Pfeffer`
split is unconditional and stays unchanged. The **new comma-`und`-list** path is
gated on catalog membership so it cannot wrongly split modifier lists that happen
to use commas + `und`. Unmatched members never become silent mains — they only
ever surface as opt-in pills.

**Shared note propagation:** a coordinated list's trailing note (`nach Belieben`)
propagates to every emitted member, reusing the existing
`applyConjunctionNotePropagation` path (extended if needed so comma-list members
are covered, not only `und`-split pairs).

**New metadata — `foldedIngredients`:** parallel to `foldedAlternatives` on the
parsed-row / `ImportedIngredient` shape:

```ts
// alongside foldedAlternatives?: { range: Range; label: string }[]
foldedIngredients?: { range: Range; label: string }[];
```

Each entry is an unmatched coordinated-list member: `range` is its span within
`rawText`; `label` is the member's display text (`Schabziger`). Recorded on the
group's primary row, exactly like `foldedAlternatives`.

### Layer 2 — "+ Potential ingredient" pills

Rendered next to the existing folded-alternative chips, on the same "Original:"
line, but visually distinct:

- **Icon:** `+` (e.g. lucide `Plus`), distinct from the `CornerDownRight` used
  for folded alternatives.
- **Label:** the member text (`Majoran`).
- **Click:** promote the folded range to its own **main** row. Reuses the
  existing `forceEmitRanges` reparse machinery (`reparsePromotingAlternative` →
  `reparseGroupWithChange` with `{ emit: range }`). Because the segment's role is
  a coordinated-list **member** (not `isAlternative`), force-emitting it yields a
  **main**, not an alternative. (Verify/extend the force-emit path so a
  member-range emits with `isAlternative: false`.)
- **Re-delete:** deleting a pill-promoted main folds it back to a pill — already
  covered by `isConjunctionMember` + `reparseDeletingAlternative`
  (`reparseGroupWithChange` with `{ removeIndex }`), since the member is a
  default-fold range.

Pills are **always shown** for every unmatched coordinated-list member,
regardless of whether sibling members auto-split. (Maximum discoverability:
e.g. `+ Schabziger` shows even though `Oregano`/`Basilikum` already split.)

**Component:** either a new `FoldedIngredientChips` component or a `variant`
prop on the existing `FoldedAltChips` (`folded-alt-chips.tsx`). Prefer a shared
component with a `kind: "alternative" | "ingredient"` prop driving icon + click
handler, to avoid duplicating the chip layout. A new prop
`onPromoteFoldedIngredient(range)` threads from the section editor / bulk dialog
parallel to the existing `onPromoteFolded`.

### Layer 3 — Manual "Add ingredient" button (free text)

A control alongside the existing "Add alternative" affordance, present in **both**
the bulk reparse dialog and the recipe section editor (they share group
components):

- **Action:** insert a new **main** row (`isAlternative: false`) immediately
  after the clicked row's source-line group, carrying **no** `rawText` (see the
  reparse decision below). It still renders adjacent to the group via ordering.
- **Name:** free text the user types.
- **Best-effort highlight:** when the typed name appears as a **token-aligned**
  span within the **adjacent group's** `rawText`, compute `highlightParts`
  marking that span as the ingredient highlight (via the existing AST highlight
  rendering, `candidateHighlights` / `renderHighlights`). The match is for
  **display only** — the row itself stores no source line. When the name does not
  appear, leave `highlightParts` empty — it is plain free text. Highlight is
  recomputed when the name changes; it never blocks input.
- **Reparse behaviour — `rawText = undefined`:** the manual main is not in the
  parser's output for any line, so it is a **pass-through manual row** in both
  surfaces:
  - In the **recipe editor** it **persists** across `reparseAll`/`reparseGroupAt`
    (rows without a `rawText` are passed through untouched) — the desired
    manual-edit behaviour.
  - In the **bulk dialog** it is a manual row the current-vs-proposed **diff**
    treats as current-only; the user keeps or drops it on review.

  This avoids the footgun where a manual main sharing the group's `rawText` would
  be silently dropped when the group is rebuilt from parser output. The earlier
  framing ("reparsing will likely prompt to remove it") is satisfied in the bulk
  dialog by the diff; in the editor the row simply persists.

## Data flow

```
source line ──▶ segmentLine (detect comma-coordinated list)
            │   terminal `oder` ──▶ existing ALTERNATIVE rules (matched→alt row,
            │                        unmatched→foldedAlternatives chip)
            │   terminal `und`  ──▶ MAIN rules; per-member catalog match
            ├─▶ matched und-members        ──▶ main rows (shared rawText + note)
            └─▶ unmatched und-members      ──▶ note fold + foldedIngredients[]
                                                      │
parsed row ──▶ ImportedIngredient.foldedIngredients ──┤
            ──▶ candidateMatches / DraftIngredient ───┘
                                                      ▼
                              FoldedIngredientChips (+ icon)
                                   │ click → forceEmitRanges (emit as main)
                                   ▼
                              reparseGroupWithChange({ emit })  ──▶ new main row

manual "Add ingredient" ──▶ emptyIngredient (rawText: undefined) appended to group
                         ──▶ best-effort highlight vs adjacent rawText (display only)
```

## Files (anticipated)

- `src/lib/recipe-import/ast/segment-line.ts` — detect coordinated comma-lists;
  classify members; carry member role so force-emit yields a main.
- `src/lib/recipe-import/ast/passes/match-ingredient.ts` /
  `src/lib/recipe-import/ast/parse-line.ts` — per-member catalog match; record
  `foldedIngredients`; ensure shared-note propagation reaches comma-list members.
- `src/lib/recipe-import/index.ts` — `ImportedIngredient.foldedIngredients`;
  force-emit of a member-range as a main; `applyConjunctionNotePropagation`
  coverage for comma-lists.
- `src/lib/recipe-import/types.ts` —
  `ParsedIngredientResponse.foldedIngredients`.
- `src/components/recipes/types.ts` — `DraftIngredient.foldedIngredients`;
  `parsedIngredientToDraft` copies it; a `emptyMainForGroup()`-style helper if
  warranted.
- `src/components/recipes/reparse.ts` — promote-folded-ingredient path
  (`reparsePromotingIngredient` or a `kind` arg on the existing promote helper).
- `src/components/recipes/alternatives.ts` — `addMainAfter(rows, idx)` inserting
  a sibling main at the end of the group.
- `src/components/recipes/folded-alt-chips.tsx` — `kind` prop (alternative vs
  ingredient) → icon + handler; or a sibling component.
- `src/components/recipes/ingredient-row.tsx` — render ingredient pills;
  `onPromoteFoldedIngredient`; "Add ingredient" affordance; best-effort
  highlight for a free-text manual main.
- `src/components/recipes/section-editor.tsx` &
  `src/components/recipes/bulk-reparse-dialog.tsx` — wire "Add ingredient" and
  the promote-ingredient handler in both surfaces.
- `src/app/api/v1/ingredients/reparse/route.ts` — no change expected (already
  passes `forceEmitRanges`/`forceFoldRanges`); confirm member-range emit.

## Testing

Parser (vitest, `tests/recipe-import*.test.ts`):

- `Oregano, Majoran und Basilikum nach Belieben` with all three in the catalog →
  3 mains, each note `nach Belieben`, no `foldedIngredients`.
- Same line with none in the catalog → 1 main `Oregano`, two `foldedIngredients`
  (`Majoran`, `Basilikum`) with correct ranges/labels.
- Mixed (`Oregano, Schabziger und Basilikum`, Schabziger absent) → `Oregano` +
  `Basilikum` mains, `+ Schabziger` folded.
- `Paprika, rot oder gelb` (terminal `oder`) → **alternative** path, not mains:
  single `Paprika` primary with `rot`/`gelb` as alternatives (folded as
  alternative chips since absent from the catalog). Confirms `oder` never produces
  mains. NOTE: today this line stays a single `Paprika` + note `rot oder gelb`;
  the comma-list expansion making `rot`/`gelb` alternatives is **new**.
- `Dill, Petersilie oder Schnittlauch` (terminal `oder`, all catalog) →
  `Dill` primary + `Petersilie`/`Schnittlauch` as **alternatives** (not mains) —
  the connector, not catalog membership, decides the role.
- `Zwiebel, gewürfelt` → unchanged: 1 main, `gewürfelt` stays in the note (no
  terminal und/oder → not a coordinated list).
- `Salz und Pfeffer nach Geschmack` → unchanged baseline (2 mains, shared note).
- `Dill oder Petersilie` (bare `oder`, no comma) → unchanged alternative
  behaviour; not affected by the comma-list rule.

Reparse (vitest):

- Promote a folded ingredient → it becomes a **main** (not alternative); deleting
  it folds it back to a pill.

Component (existing patterns): `FoldedIngredientChips` renders `+` icon and
fires the ingredient-promote handler; "Add ingredient" inserts a sibling main;
manual main highlight aligns to the adjacent line when the name matches.

End-to-end: `npm run build` (RSC boundary) before committing UI changes.

## Out of scope

- English (lowercase) comma-lists that are not in the catalog auto-splitting —
  the catalog gate covers known ingredients regardless of case; unknown
  lowercase items only ever surface as pills.
- Reordering manual mains within a group beyond existing group semantics.
- Persisting `foldedIngredients` to the database — it is parse-session metadata,
  like `foldedAlternatives`.

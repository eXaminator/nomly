# Recipe ingredient form redesign

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan
**Component:** `src/components/recipes/ingredient-row.tsx` (the recipe & staple ingredient editor row)

## Goal

The recipe ingredient row is crowded and some affordances no longer earn their
place. Declutter it — primarily the candidate-pill area, the free-text control,
and the "Original" line — without changing the matcher, the save payload, or the
article data model. This is a **presentation + control-wiring** change.

## Problems with the current row

Per ingredient, the row stacks three bands of UI:

1. An "Original: …" hint line (imported rows) with a single reparse button.
2. The input grid: Qty · Unit · Name · Note · 5 trailing icon buttons.
3. A pill band that can show up to **5** candidate pills — each carrying **three**
   buttons (select · `↻` use-name · `✎` edit-article) — plus three dashed pills
   (`als Alias`, `Neu`, `Nicht zugeordnet`) and a manual `+`.

The pill band is the worst offender: a matched row routinely renders 15+ buttons.

## Design

### 1. Candidate pills become plain text chips

- A chip shows the candidate's **canonical name**, with the matched **alias in
  parens** when it differs (e.g. `Tomate (Tomaten)`) — unchanged content.
- **Clicking the chip selects it** (existing `onSelectCandidate`), which already
  fills the name field. The chip carries no visible buttons at rest.
- **Removed:** the per-pill `↻` "use name" button (`onUseCanonical` /
  `useCanonicalInName`). Selecting already populates the name, so it is redundant.
- **Candidate cap: 3** (was 5). The currently-selected match is always shown even
  if it falls outside the top 3 (folds in the existing "selected out of list"
  special case).

### 2. Edit-article (`✎`) moves to hover-reveal, inside the chip

- Every chip can still open its article editor (`EditArticleDrawer`), but the
  `✎` is **hidden at rest** and **fades in on hover**, occupying space that is
  **permanently reserved** in the chip's right padding so nothing reflows.
- **Touch devices** (no hover): the `✎` stays faintly visible in that reserved
  space (so it is reachable without a hidden gesture and still causes no shift).
  Implement with `@media (hover: hover)` → reveal on hover; otherwise → always
  faint. *(Decision: revisit if mobile feels noisy.)*

### 3. `als Alias` pill removed; alias-keep shown on the selected chip

- The standalone `als Alias` toggle pill (`AliasToggle`) and the `+ Alias` badge
  on the out-of-list selected pill are **removed**.
- The "remember this spelling as an alias" intent continues to be set by the
  **checkbox already inside the manual `+` (force-match) popover**
  (`force-match-popover.tsx`, which already passes `addAsAlias` to `onForceMatch`).
- When `addAsAlias` is active, the **selected chip** renders the kept spelling in
  parens like any other match plus a small **`plus` glyph** meaning "this spelling
  will be saved as an alias" — e.g. `Tomate (Strauchtomaten) ＋`. This replaces the
  separate badge.

### 4. `Neu` chip: hidden when disabled

- The `Neu` chip shows only when the typed name is a valid new ingredient.
- When disabled — empty name, or an **exact name/alias collision** exists
  (`findExactMatch`, added in the prior bug fix) — it is **fully hidden**, not
  greyed. This supersedes the greyed-out disabled state from that fix.

### 5. Free-text toggle replaces the `Nicht zugeordnet` pill

- The `Nicht zugeordnet` dashed pill (`UnassignedPill`) is **removed** from the
  pill band and replaced by a **toggle button** among the row's trailing action
  icons, positioned as the **last action before Delete**.
- Free-text is the existing `unassigned` flag — no new state. The toggle only
  appears where `allowUnassigned` is true (recipe variant, not the staple editor).
- **Icon:** `link-2` when linked (default), `unlink` when free-text is active
  (highlighted/"on" styling).
- **The toggle is non-destructive** — it flips *only* the `unassigned` flag and
  the layout. Quantity, Unit, Name, Note, and the matched selection
  (`selectedIngredientId`, `canonicalName`, `addAsAlias`, …) are **preserved, not
  cleared**, so an accidental toggle is trivially undone by toggling back. This
  is a deliberate change from the current `selectUnassigned`, which wipes the
  selection. (The toggle handler must therefore *not* reuse the old clearing
  logic.)
- **When free-text is active:**
  - Quantity and Unit inputs are **hidden** (their values retained in state, not
    cleared). The **Name input grows** to consume the freed grid columns.
  - The **matching pill band is hidden entirely** (no candidates, no `+`, no
    `Neu`) — the dormant selection simply isn't shown.
  - The Optional / Fixed-amount / Indent-Outdent / Add-alternative icons are
    **hidden** (they do not apply). Only the free-text toggle and Delete remain.
- Save behavior is unchanged: `unassigned` rows persist `ingredient_id = NULL`
  with the text in `display_name` (`recipes/service.ts`), and never reach a
  shopping list.

### 6. "Original" line: boxed, indented, two actions

- Kept as a **boxed** element (subtle background + border), **indented to align
  with the inputs** (it already lives inside the fields container), on a **single
  line** with the text truncating and the action buttons inline at the right.
- **Two buttons:**
  - **`scan-text`** — reparse from the original line (today's `onReparse`),
    producing a **linked** ingredient.
  - **`unlink`** — drop the **whole original text into the Name field as a
    free-text** ingredient (sets `unassigned`, `name = rawText`). This is a
    deliberate one-shot transform (distinct from the non-destructive row toggle);
    it is reversible via the `scan-text` reparse button beside it.

### 7. Trailing action icons

- Stay **directly accessible** (no overflow menu). The free-text toggle is the
  **last action before Delete**: `[optional · fixed-amount · indent/outdent ·
  add-alt/promote · link-2/unlink · delete]`, collapsing to `[unlink · delete]`
  in free-text mode.

## Icons (Lucide)

| Action | Icon |
| --- | --- |
| Reparse → linked (Original box) | `scan-text` |
| Original → free text (Original box) | `unlink` |
| Free-text row toggle — linked (default) | `link-2` |
| Free-text row toggle — free-text active | `unlink` |
| Alias-keep marker on selected chip | `plus` (small) |
| Edit article (hover, in chip) | `pencil` (unchanged) |

## What is NOT changing

- The matcher / scoring (`/api/v1/ingredients/match`, `applyAutoSelect` selection
  rules beyond what the prior bug fix already changed).
- The recipe save payload and `resolveIngredient` logic.
- The article / ingredient data model and `EditArticleDrawer`.
- The staple-editor variant keeps its constraints (no free-text toggle).

## Affected code

- `src/components/recipes/ingredient-row.tsx`
  - `CandidatePills` — chip rendering, 3-cap, drop `als Alias`/`Nicht zugeordnet`
    pills, hide `Neu` when disabled, hover-edit, alias `＋` on selected chip.
  - `CandidatePill` — strip `↻`/`✎` from the resting layout; hover-reveal `✎`.
  - Remove `AliasToggle`, `UnassignedPill`; remove `onUseCanonical` plumbing.
  - Row grid — add free-text toggle; free-text layout (hide qty/unit, grow name,
    hide non-applicable icons); restyle the Original box with two actions.
  - `NewPill` — render only when enabled (full hide).
- `src/components/recipes/force-match-popover.tsx` — verify the `als Alias`
  checkbox copy/behavior is self-sufficient now that the pill is gone.

## Testing

- Unit: `findExactMatch` / `applyAutoSelect` already covered; extend for the
  `Neu`-hidden and free-text interactions where logic (not pure layout) changed.
- The free-text toggle's data effects (clearing qty/unit, setting `unassigned`)
  are logic worth a focused test if extracted into a helper.
- `npm run build` before pushing (RSC client/server boundary rule).

## Open decisions (defaults chosen, revisitable)

1. Touch shows the faint `✎` on every chip always (vs. only the selected chip).

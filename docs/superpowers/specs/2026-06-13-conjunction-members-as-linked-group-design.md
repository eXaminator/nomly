# Conjunction Members as a Linked Source-Line Group — Design

**Date:** 2026-06-13
**Status:** Draft → implementing

## Goal

Make a conjunction line like `Salz und Pfeffer` behave like an alternatives line: the members are a **linked group sharing the full original line**, with the same delete-folds-to-note + "re-create" chip UX — but the members stay **main** ingredients (not alternatives).

This also **fixes a live bug**: conjunction-split rows currently carry the *sub-piece* as `rawText` while their `highlightParts` are absolute offsets into the *full line*, so the "Original:" line renders garbled (spans shifted by the preceding members' length, e.g. `Pfeffer (nach Geschmack)` splitting "Geschmack" mid-word). Clicking reparse fixes it because it re-parses the sub-piece standalone. Giving every member the full line as `rawText` aligns the offsets.

## Decisions (confirmed)

1. **Delete a member** → fold its text into the **first remaining sibling's note** (verbatim, e.g. `Salz` gains note `und Pfeffer`), plus a chip to re-create it as a main row. Mirrors alternatives' delete-fold.
2. **Unmatched member** (`Salz und Schmackofatz`) → still **emitted as a main row** (a "new ingredient" proposal). Conjunction members always emit by default; only deletion folds them. (Contrast: an unmatched *alternative* folds by default.)
3. **Flat layout** — members render as normal full-width main rows, no indentation; linked only via shared `rawText`.

## Architecture

The existing alternatives machinery generalizes: a "source-line group" is the run of rows sharing one `rawText`. Within it each member is either an alternative (linked by `alternativeForId`) or a conjunction main (co-equal). Delete/re-create reuse the per-range `forceFold`/`forceEmit` reparse, and the chip (`foldedAlternatives` metadata + `FoldedAltChips`). The parser already knows a segment's natural role (main vs alternative), so a force-emitted range comes back in its correct role — the chip mechanism needs no main-vs-alt distinction.

### Parser
- **Full-line `rawText`** for conjunction-split mains (today: sub-piece). Fixes the highlight bug and enables grouping.
- **Force-fold a conjunction main** (delete): fold it into the **first surviving sibling main of the line**, recording a `foldedAlternatives` chip on that sibling. If the folded member is the *first* one (no earlier sibling yet emitted), defer the fold until the next sibling main is emitted (like `pendingTailLeaves`). Default disposition: a conjunction main always emits unless its range is in `forceFoldRanges`.

### reparse helper
- Generalize `reparseGroupWithChange` so a group's "members" are **all rows with a `sourceRange`** (conjunction mains + alternatives), not only `isAlternative` rows. `emittedByDefault` = every clean-parse row with a sourceRange; `foldedByDefault` = clean-parse `foldedAlternatives` (still only unmatched alternatives). A deleted main lands in `forceFold`; a re-created one in `emitted`. The alternatives behaviour is unchanged (a primary normally isn't deleted via this path; the primary-with-alternatives delete keeps its existing confirm dialog).

### UI
- Deleting a **main** row that belongs to a multi-row source-line group routes through the reparse-delete (fold + chip) instead of a plain splice. A standalone main (its own line) still plain-removes.
- Chips already render from a row's `foldedAlternatives` and create the member in its natural role (here, a main). Same `FoldedAltChips` component.

## Known wrinkles
- **First-member delete** (`delete Salz` from `Salz und Pfeffer`): folds into `Pfeffer`; the note reads `Salz` (no trailing connector) vs. `und Pfeffer` for the second-member case. Slightly asymmetric but faithful; the chip restores it.
- **Mixed lines** (`Salz und Pfeffer oder X`): out of scope for special handling — falls out of the generalized group logic; verify it doesn't regress.

## Testing
- Parser: conjunction mains carry full-line `rawText`; highlightParts align with `rawText`; force-fold a main folds into the first sibling + records a chip; force-emit re-creates it as a main; first-member fold.
- The existing `Pfeffer (nach Geschmack)` / `Salz und Pfeffer (nach Geschmack)` highlight desync is gone (parts slice `rawText` correctly).
- Enforced suites stay green; `npm run build`.

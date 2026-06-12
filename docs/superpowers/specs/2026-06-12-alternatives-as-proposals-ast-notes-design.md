# Alternatives as First-Class Proposals + AST-Only Notes — Design

**Date:** 2026-06-12
**Status:** Draft for review
**Supersedes:** the note-folding half of `2026-06-08-alternative-foldback-and-source-highlight-design.md` (the source-highlight half stays).

## Goal

Two coupled changes to recipe-import:

1. **Alternatives are first-class proposals.** An ingredient alternative that the catalog doesn't recognise (`"Penne oder Rigatoni"`, `"Kurkuma/Gelbwurz"`) is proposed as its own ingredient row — exactly like an unmatched *primary* — instead of being silently folded into the primary's note. The user decides in the form whether to create it, alias it onto an existing ingredient, or delete it (which folds it back into the note).
2. **Notes are generated only by the AST.** No code anywhere builds a note by string concatenation. Every note — including a folded alternative — is rendered by `renderNote(source, leaves)` over annotated lexer leaves.

## Background / current behaviour

- The parser segments a line, parses each segment, and **folds an unmatched alternative into the primary's note** via `appendAlternativeToNotes` / `alternativeNoteSeparator` / `sourceCommaBeforeAlt` (`src/lib/recipe-import/index.ts:814-891`) — fragile string heuristics that reconstruct the comma/space separator by `indexOf`-searching the source.
- Matched alternatives already become real rows: `recipe_ingredient.alternative_for_id` is a self-FK (`src/db/schema.ts:325`), always `isOptional`, sorted after the primary, depth-1. Shopping-list logic skips optional/alternative rows, so **amounts are never double-counted**.
- The edit UI already has full alternative management (`src/components/recipes/alternatives.ts`): group-by-primary, promote / demote / detach / reorder-within-group, add-alternative, and **delete-folds-to-note** (`removeAlternativeFoldingNote`). The delete-fold is string-based today (`alternativeFoldText`: slice source span or reconstruct `oder <amount> <name>, <notes>`, then `", "`-join).
- Per-row "add as alias" already exists (`toggleOriginalAsAlias` → `addIngredientAlias`, `service.ts:294-309`), reachable from both the bulk-reparse panel and the single-recipe form.
- `NewIngredientsDialog` lets the user create a brand-new ingredient (category, dietary class, flags) but has **no** alias-link option.

The net effect today: an unmatched alternative never reaches the user as an editable row — it is pre-folded into a note string before the form ever sees it.

## Architecture

### Part A — Parser: emit unmatched alternatives as rows

In `parseIngredientLines` / `parseGroupedIngredientLines` (`src/lib/recipe-import/index.ts`), remove the "fold an unmatched alternative into notes" branch (currently `index.ts:717-756`). An alternative segment that produces a real ingredient name becomes a normal row with `isAlternative: true` and (when unmatched) `ingredientMatch: "new"`.

**Exceptions that STILL fold to a note** (no sensible row exists). These keep folding, but via the AST mechanism in Part B, not string append:

| Case | Why it folds |
|---|---|
| **Alias-of-primary** | The alternative matches the **same `ingredientId`** as its primary (a true synonym, e.g. `Kurkuma/Gelbwurz` once "Gelbwurz" is an alias of "Kurkuma"). A second row for the same ingredient is meaningless. |
| **Nameless alternative** | `"½ large head"` — same article as the primary, just a different amount; no article of its own. |
| **Note-only alternative** | `"(oder nach Geschmack)"` — qualifies the whole group; folds onto the primary *and* every alternative emitted since. |
| **Tail note** | `"(or 1 large clove), peeled"` — the trailing `, peeled`. |
| **Leading-or fragment** | a split fragment that is just `"or X"` / `"oder X"`. |

The **alias-of-primary** rule is the mechanism behind "aliases of the main ingredient don't get proposed as alternatives," and it self-heals: once the user aliases "Gelbwurz" onto "Kurkuma", every future parse of that line folds it automatically.

### Part B — Notes: AST-only rendering via leaf-union

Delete `appendAlternativeToNotes`, `alternativeNoteSeparator`, `sourceCommaBeforeAlt`, and the inline `prev.notes = … oder ${alt}` append (`index.ts:704-711`).

A fold renders the primary's note from the **union of annotated leaves**: the primary segment's leaves + the connector leaf between them + the folded segment's leaves, all carrying their original absolute offsets and `consumed`/`role` annotations. `renderNote(source, unionLeaves)` then:
- drops `consumed` spans (amount / unit / matched name),
- emits everything else from the original source gaps (so the comma/space *between* clauses is reproduced from the source, not reconstructed),
- and `tidyNote` strips an edge `/` (so `"Kurkuma/Gelbwurz, gemahlen"` with "Kurkuma" consumed → leaf-union note `"/ Gelbwurz, gemahlen"` → `"Gelbwurz, gemahlen"`), while a word connector survives (`"oder Gelbwurz"`).

This is feasible because a segment's `leaves` are the **same objects** as the line's leaves (`makeIngredient` returns `all.slice(from,end)`), and `parseLeaves` annotates them in place — so after parsing every leaf already carries its role. The union is a contiguous slice of the line's leaves from the primary's start through the folded segment's end.

**Note formatting tweaks (per current preference, not the stale familywall golden):**
- `*` is kept at **both** edges — it's a footnote marker, not a stray separator. Fix `tidyNote`'s trailing trim to keep `*`; update the golden ideal for `"1 TL Salz*"`.
- Everything else unchanged: consumed spans out; the rest enters the note as close to source as possible, with the existing parenthesis/marker exceptions.

### Part C — UI: reuse, with one change

Reused unchanged: alternative grouping, promote/demote/detach/reorder, add-alternative, the per-row "add as alias" toggle (covers the synonym path), and `NewIngredientsDialog` (covers create-new). An unmatched alternative row now simply flows through the existing "new ingredient" machinery.

**The one change — delete-folds-to-note becomes a re-parse (chosen approach: purest):**

`removeAlternativeFoldingNote` / `alternativeFoldText` (the string-based fold in `alternatives.ts`) are replaced. Deleting an alternative row:
1. marks that alternative as "fold into note" (identified by its `sourceRange` within the line's `rawText`),
2. re-invokes the parser **for that single line** with a fold directive,
3. replaces the line's rows with the result — the primary now carries an AST-rendered note including the alternative, and the alternative row is gone.

**Parser API addition:** a single-line parse path (or an option on the existing one) that accepts, per line, a set of alternative source-ranges to force-fold. A segment whose `range` matches is routed down the same fold path as the alias-of-primary exception (Part B), so the note is AST-generated. Ranges are stable identifiers for a given source string.

### Persistence

No schema change. A folded alternative is gone (its text lives in the primary's note). A kept/created alternative persists exactly as today: a row with `alternativeForId = primary.id`, `isOptional = true` (`service.ts:315-345`). The shopping list already skips it, so amounts stay correct. Aliasing flows through the existing `addAsAlias` → `addIngredientAlias` path.

## Known interactions / risks (for review)

1. **Per-line reparse-on-delete reverts other manual edits to that line.** Re-parsing recomputes the whole line, so a manual rename/amount change on the *primary* would be lost when an alternative is deleted. This matches the existing "reparse reverts manual edits" model, but the delete is more surgical than the user may expect. *Decision needed at review:* accept (consistent), or re-apply the surviving rows' manual edits after reparse (more complex).
2. **A fold decision is not persisted against the source line.** After saving, a later global `reparse-scan` re-derives from `raw_line` and will re-propose the deleted alternative as a row (the source still says "Penne oder Rigatoni"). This surfaces as a normal reparse diff the user can decline — consistent with current reparse-scan semantics. No new persistence proposed.
3. **Bulk-reparse noise.** The first global reparse after this ships will surface alternatives that were previously silent notes as new-ingredient proposals — a one-time spike. Expected; it is surfacing real data that was hidden.

## Testing

- `tests/recipe-import.test.ts` and `tests/recipe-import-matching.test.ts` are the enforced oracle and must stay green; the familywall **golden** is informational (and its `Salz*` ideal gets updated).
- New parser tests: unmatched alternative → row with `ingredientMatch:"new"` + `isAlternative:true`; alias-of-primary → folds to note (same `ingredientId`); leaf-union note rendering for each fold case (incl. `/`-strip and word-connector-survives); `*` kept at both edges.
- New fold-directive test: parsing a line with a force-fold range produces the same AST note as the natural fold, and no row for that alternative.
- UI: deleting an alternative triggers the single-line reparse and yields the AST note; alias-link still works; promote/demote/detach unaffected.
- `npm run build` (RSC boundary check) before pushing UI changes.

## Out of scope

- Adding alias-linking to `NewIngredientsDialog` (the per-row toggle already covers it).
- Persisting fold decisions against the source line.
- Any change to matched-alternative behaviour.

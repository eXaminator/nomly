# Ingredient AST Parser Implementation Plan

> **For agentic workers:** Implement task-by-task. The existing test suite
> (`tests/recipe-import.test.ts`, `tests/recipe-import-matching.test.ts`,
> `tests/recipe-import.familywall-golden.test.ts`, `tests/reparse-scan*.test.ts`)
> is the detailed spec and the acceptance gate. Drive to green; only change a
> line→output expectation when the new output is **strictly more faithful to the
> input**, and log every such change.

**Goal:** Replace the string-mutation ingredient-line parser with an AST
pipeline (lossless lex → structural parse → annotate/consume passes → render),
so notes become the source text verbatim minus the consumed spans, and the
reparse highlights derive from the same node spans — killing the whole class of
"a character got dropped in the note" bugs by construction.

**Architecture:** One immutable trimmed source string per line. A tree of nodes,
each carrying a half-open `[start, end)` range into that string. Semantic passes
*annotate* nodes with roles and *consume* them; nothing ever mutates the string.
The note for a row is produced by stitching the unconsumed leaf ranges back
together from the original string, collapsing consumed runs to a comma and
stripping root-level parentheses. Highlights (`HighlightPart[]`) fall out of the
same node roles.

**Scope decision (load-bearing):** The catalog **matcher** (`matching.ts`), the
**numeric parsing** primitives (fraction/range/unicode/`formatRangeNumber`/
`toFractionDisplay`), and the **lookup builders** (`buildUnitLookup`,
`buildIngredientLookup`, `buildIngredientCatalog`, `buildCatalogBlockIndex`) are
**reused unchanged** — they are orthogonal to note fidelity and already well
tested. The rewrite replaces the *structural + notes + source-range spine*:
`parseIngredientString` internals, `computeNameAndNotes`/`spanText`/
`tidyRemainderFragment`, the note-fragment categorisation, `source-ranges.ts`,
and the expansion/conjunction logic — re-expressed as AST passes.

**Public contract (must not break):** `parseIngredientLines`,
`parseIngredientLinesIntoSections`, `parseIngredientGroupsIntoSections`, and the
`ImportedIngredient` shape (every field), `ParsedSectionGroup`, `SourceRange`,
`HighlightPart`, and all lookup/catalog types. Consumers: the parse/match/reparse
API routes, `reparse-scan.ts`, `familywall/transform.ts`, and the reparse dialog.

**Tech Stack:** TypeScript, Vitest, existing `@/lib/recipe-import` module.

---

## The note rule (the core deliverable)

For one parsed row, given its segment of the source line:

1. Start from the segment's exact source text.
2. **Remove** the spans consumed by structured fields: the leading amount, the
   unit, the matched ingredient span (or, on the no-match path, the chosen name
   region), each alternative span (including its connector `oder`/`or`/`/`/
   `alternativ:`), and optional-markers (`opt.`, `optional`, `evtl.`,
   `(optional)`, …) and bracket markers consumed for flags.
3. Each removed run that sits **between** surviving text collapses to a single
   `, `. A removed run at the very start/end leaves no comma (trimmed).
4. **Root-level parentheses** are unwrapped: the `(`/`)` characters are dropped
   and the boundary becomes a `, ` if there is surviving text on both sides.
   **Nested** parentheses are kept verbatim.
5. Everything not removed stays **byte-for-byte** (semicolons, slashes, internal
   spacing, casing, hyphens — all preserved).
6. Collapse runs of commas/space to a single `, `; trim leading/trailing
   separators. Empty → `null`.

This replaces token re-joining (`spanText`) entirely. Because surviving text is
sliced from the original string, no normalization can leak into the note.

### Deliberate behaviour changes (all "closer to input")

These are expected to re-baseline some assertions. Each must be confirmed
strictly more faithful before the expectation is edited, and logged:

- **No prep-word reordering.** "1 large onion chopped" → name `onion`,
  notes `large, chopped` (source order), not a hoisted `chopped` with `large`
  swallowed as a size modifier.
- **Modifiers verbatim, not normalized.** "gestrichener TL Zimt" → notes
  `gestrichener` (not `gestrichen`); "geh. TL Salz" → notes `geh.`.
- **Filler between prep-noun and amount is kept** ("Schale von 2 …" → `Schale von`)
  *unless* leaving it produces an obviously-broken note — decide per case, log.
- **"Dropped" words now stay** in notes unless they were a connector/optional
  marker the parser genuinely consumed.

### Behaviours preserved (NOT changed)

Amounts/ranges (`100-200 g`, `1/2-1 cup`, high-bound resolution, fraction
display), unit resolution + defaults, container/size-compound handling, optional
flag from markers, `nach Belieben`/`to taste` staying in notes (never optional),
alternative rows + amount/unit/notes inheritance, matched alias as display name +
`sourceName`, section detection/grouping, conjunction splitting guards, the
matcher's candidate ranking, id mappings, row counts.

---

## File structure

- Create `src/lib/recipe-import/ast/lexer.ts` — lossless tokeniser: source →
  `Tok[]` (`text`, `start`, `end`, `kind`). Concatenating `source.slice` over all
  toks reproduces the source exactly.
- Create `src/lib/recipe-import/ast/nodes.ts` — node types (`SeqNode`,
  `GroupNode` for paren/bracket, `LeafNode`), the `Role` union, and a `consume`
  helper. A node knows its `[start,end)`, `depth`, children, role, consumed flag.
- Create `src/lib/recipe-import/ast/parse.ts` — `Tok[]` → tree: nest paren/
  bracket groups, keep connector/comma/semicolon leaves in place.
- Create `src/lib/recipe-import/ast/segment.ts` — split the root sequence into
  ingredient segments (conjunction `und/and/&`, with the existing guards) and,
  within a segment, into primary + alternative sub-segments (`oder/or`, `/`,
  `alternativ:`, parenthetical `(oder …)`/`(Alternativ: …)`, `(sub …)`).
- Create `src/lib/recipe-import/ast/render-notes.ts` — implements the note rule
  above over a segment's nodes + the set of consumed ranges.
- Create `src/lib/recipe-import/ast/render-highlights.ts` — `HighlightPart[]`
  from node roles (amount→amount, ingredient→name, connector/marker→dropped,
  surviving→note).
- Create `src/lib/recipe-import/ast/numeric.ts` — move the pure numeric helpers
  here (extracted from `ingredient.ts`, behaviour identical), re-exported.
- Create `src/lib/recipe-import/ast/passes/` — one file per annotate pass:
  `optional.ts`, `amount-unit.ts`, `prep-noun.ts`, `match-ingredient.ts`
  (bridges to `matching.ts`), `alternatives.ts`. Each takes the tree, marks
  roles/consumes nodes, returns the structured fields it extracted.
- Rewrite `src/lib/recipe-import/index.ts` parse path to orchestrate:
  lex → parse → segment → passes → render → assemble `ImportedIngredient`.
  Keep the file's exports and types identical.
- Delete `src/lib/recipe-import/source-ranges.ts` only after highlights are
  proven equivalent; keep its types re-exported from `nodes.ts`/index.
- Keep `matching.ts` as-is. Keep `expandIngredientLine`/`splitConjunctions`
  available during migration; remove once `segment.ts` subsumes them and tests
  pass.

---

## Implementation phases (each ends green + committed)

Discipline for every phase: run the full recipe-import suite; for each failure,
classify **regression** (fix the parser) vs **faithful-change** (update the
expectation, append an entry to `docs/superpowers/plans/ast-expectation-changes.md`
with `input | old | new | why-more-faithful`). Never edit an expectation to make
a test pass unless the new value is closer to the input.

### Phase 1 — Lossless lexer + tree + note renderer (no behaviour wired yet)
Build `lexer.ts`, `nodes.ts`, `parse.ts`, `render-notes.ts`. Unit-test the
round-trip invariant (stitching all leaves == source) and the note rule on
synthetic node sets covering: middle removal → comma, edge removal → trim, root
paren unwrap → comma, nested paren kept, semicolon/slash preserved, comma-run
collapse. Commit.

### Phase 2 — Numeric + amount/unit + optional passes
Extract `numeric.ts` (assert the amount/range tests still pass by calling the
new module). Implement `passes/amount-unit.ts` (leading amount, range→high-bound,
container/size compounds, unit detection incl. trailing-unit fallback) and
`passes/optional.ts`. Wire a minimal single-segment parse that produces
quantity/unit/isOptional and a note from leftovers. Run the amount/unit/optional
slices of `recipe-import.test.ts`. Triage. Commit.

### Phase 3 — Ingredient match bridge + name/notes (matched + no-match)
Implement `passes/match-ingredient.ts`: build candidate tokens from the
segment's name-region leaves, call `findIngredientCandidates` (unchanged),
map `coveredCandidateTokens` back to source leaves, mark them consumed. Produce
`name` (matched alias verbatim / region text), `sourceName`, `candidateMatches`,
`newNameProposals`. Notes come from `render-notes.ts` over the unconsumed
leaves. Implement `passes/prep-noun.ts` (Saft/Schale/juice/peel → consumed, kept
in note position). Run the full `recipe-import-matching.test.ts` notes block.
Triage heavily here (this is where faithful changes cluster). Commit.

### Phase 4 — Alternatives + conjunctions (segment.ts) + inheritance
Implement `segment.ts` for conjunction split (port the container/comma/depth/
dash/color/known-overlap guards) and alternative extraction (all forms). Wire
alternative rows, connector consumption on the primary's note, amount/unit/notes
inheritance, `localNote`, and the carried/optional flags. Run the full matching
suite + reparse-scan tests. Triage. Commit.

### Phase 5 — Highlights from nodes; retire source-ranges.ts
Implement `render-highlights.ts`; point `ImportedIngredient.highlightParts`/
`sourceRange` at it. Run the highlight assertions + the reparse dialog reads.
Confirm equivalence, delete `source-ranges.ts`. Commit.

### Phase 6 — Sections, full suite, build, golden
`parseIngredientLinesIntoSections` / `…GroupsIntoSections` over the new pipeline;
`detectSectionHeader` reused. Run the **entire** test suite + `npm run build`.
Resolve remaining failures via the regression/faithful-change discipline. Commit.

### Phase 7 — Cleanup + report
Remove dead code from `ingredient.ts`/`index.ts`. Produce the final
expectation-change report for the user to verify.

---

## Verification

- `npx vitest run tests/recipe-import.test.ts tests/recipe-import-matching.test.ts`
  after each phase.
- Full `npx vitest run` + `npm run build` in Phase 6.
- The expectation-change log is the user-facing deliverable; keep it accurate.

## Rollback

All work is on `feat/ingredient-ast-parser`. Each phase is a commit; revert to
the last green commit if a phase diverges. The interim semicolon patch
(`7345f8a`) is the pre-rewrite baseline.

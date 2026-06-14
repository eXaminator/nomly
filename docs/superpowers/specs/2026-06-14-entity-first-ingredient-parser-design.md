# Entity-First Ingredient Parser — Design

**Date:** 2026-06-14
**Status:** Draft for review (large re-architecture; phased migration)

## Problem

The ingredient parser decides *structure* (where the amount/unit is, where to
split on "und"/"oder", what the ingredient name is) using ~40 hardcoded
vocabulary sets, many of which are **meaning-based judgment lists** consulted
*during matching/splitting*: `STANDALONE_DESCRIPTOR_NAMES`, `PREP_WORDS`,
`PREP_LEADING_TOKENS` (~50 participles), `COLOR_ADJECTIVE_BASES`,
`SIZE_MODIFIERS`, `VAGUE_WORDS`, `NOTE_BOUNDARY_TOKENS`, `TO_TASTE_PHRASES`, …

This is brittle and it causes real bugs. The trigger case:

> `20 oz. fresh or frozen cheese tortellini` → the segmenter splits on "or"
> into `20 oz. fresh | frozen cheese tortellini`, strands the amount on the
> throwaway "fresh" fragment, and the line collapses to "cheese tortellini —
> frozen". `oz` and the amount were fine; the *split* destroyed them.

The descriptor word list exists only to *guess* whether the left of "or" is a
real ingredient. That guess is exactly what we want to stop making.

## Goal

Reorder the parse so **the catalog drives structure**, confining
judgment vocabulary to one place: naming a brand-new ingredient when nothing
matched.

- No judgment vocabulary in amount/unit detection, in the split decision, or in
  name resolution for *matched* ingredients.
- Amounts can't be lost by a bad split.
- Word lists survive **only** in the zero-match new-ingredient namer.

### Non-goals
- Removing *closed grammatical sets* (number words, fractions, articles,
  connectors "und/oder/of/von", approx markers). These are finite language
  facts, not vocabulary guesses; they stay.
- Changing the public `parseIngredientLines` contract or the import-review UX
  (candidate pills, "create alternative", "+ add ingredient").

## Principles

1. **Annotate, don't mutate** (unchanged from today): every pass tags leaves;
   nothing is removed from the AST, so a later pass can never *lose* an earlier
   pass's finding.
2. **Catalog is identity** (existing project rule): what an ingredient *is*
   comes from the seeded catalog, not from code vocabulary.
3. **Matches decide structure.** Splitting, name extent, and amount association
   are derived from where amounts/units and catalog ingredients were found — not
   from guessing word roles.
4. **Judgment vocabulary is a last resort**, used only to name a new ingredient
   when the catalog found nothing.

## Current architecture (what changes)

Today: **segment-first**. `segmentLine` applies 10 ordered split rules
(or-chain, conjunction, coordinated list, elision, paren-alt, header colon,
each-distribution, …) to cut the line into segments *before* parsing; then
`parseLeaves` runs 10 passes per segment (plural markers, leading noise,
optional, prep-noun, lead-note, **amount/unit**, **match**, parens, notes,
highlights).

Because the split happens before the amount and the ingredient are known, the
split rules lean on judgment vocabulary to avoid bad cuts (e.g.
`preIsHeadlessModifier` + `STANDALONE_DESCRIPTOR_NAMES` to keep "fresh or frozen
X" whole). When that guess is wrong, the amount is stranded.

A second, subtler dependence: name cleanup. Today "chopped onion" is matched by
first *stripping* prep words (`PREP_LEADING_TOKENS`/`PREP_WORDS`) to expose
"onion". That stripping is judgment vocabulary doing matching-time work.

## New architecture: entity-first

One whole-line AST. Passes annotate it; structure is derived at the end.

### Pass 1 — Lex (unchanged)
`lex(line)` → leaves, with depth (paren nesting) already tracked.

### Pass 2 — Amounts & units (whole line, depth-aware)
Annotate every amount and unit on the **whole line** (not per segment), reusing
today's numeric logic (`consumeQuantity`, fractions, ranges, written cardinals,
articles → 1). Units come from the unit catalog (`knownUnitTokens`), matched
structurally (dot-stripped). Closed grammatical sets only — **no judgment
vocabulary**.

- Multiple amount/unit pairs may be annotated.
- **Depth rule:** a pair nested inside parentheses (`(15-ounce)`) is a *size
  note*, not an operative amount.
- **Main pair:** among **depth-0** pairs, the one whose amount token **starts
  earliest** is the main. (`1 (15-ounce) can` → `1 can`: "1" starts before "15"
  and is at depth 0; "(15-ounce)" is nested.)

This pass is a **stable checkpoint** — it does not depend on ingredient
detection, so the fallback (below) can always roll back to it.

### Pass 3 — Match all catalog ingredients (whole line)
Run the existing matcher (`findIngredientCandidatesFromLeaves`) across the whole
line. It already scores **every contiguous token window** against every catalog
entry and tolerates surrounding tokens ("Salt divided" → "Salt"). Collect all
candidate matches with their spans + scores. No name pre-cleaning — extra tokens
around a match are fine, they become notes later.

### Pass 4 — Resolve overlaps → final ingredient spans
Candidate matches overlap (`cheese`, `tortellini`, `cheese tortellini` all hit).
Resolve by **coverage / longest contiguous match** (existing ranking: score →
alignment quality → length). Keep the maximal non-overlapping set of accepted
matches (≥ `MIN_AUTO_MATCH_SCORE`). Lower-scored overlapping candidates are
retained as **potentials** (pills), not discarded.

### Pass 5 — Connector-driven partition
A connector (`und`/`oder`/`/`/comma-list) is a **real separator only when an
accepted ingredient span flanks it on both sides**. Partition the line into
groups at exactly those connectors.

- Both sides matched → split (`Honig oder Ahornsirup`, `Tomaten und Mozzarella`).
- Connector inside one matched span → not a separator (`macaroni and cheese` if
  it's a catalog entry; the whole-span match wins on coverage in Pass 4).
- Only one side matched → not a separator (`fresh or frozen cheese tortellini`:
  only "cheese tortellini" matched; "fresh" is not an ingredient) → no split.
- **No connector between two disjoint matches** (`Mozzarella Basilikum`) → do
  **not** split on bare juxtaposition; keep the best match as the ingredient,
  expose the other as a promotable potential. Bare adjacency is too weak a
  signal to cut on.

This subsumes the descriptor/color/headless split guards entirely:
`STANDALONE_DESCRIPTOR_NAMES`, `COLOR_ADJECTIVE_BASES`, `preIsHeadlessModifier`
are no longer consulted — the catalog decided.

### Pass 6 — Per-group assembly
For each group:
- **Ingredient** = its accepted matched span (canonical from the catalog).
- **Amount** = the amount/unit annotated **positionally within the group**;
  if the group has none, **inherit the main** (alternatives and conjunction
  members inherit, exactly today's `inheritWithinGroup`).
- **Notes** = the group's unconsumed tokens, rendered in source order
  (existing note assembly). This is where "fresh or frozen", "chopped",
  "finely", colors, sizes land — **as leftovers, not via a word list.**
- **>1 disjoint accepted matches, no connector** → best wins, the rest become
  potentials.
- **0 accepted matches** → the group goes to the fallback namer.

Because the catalog match consumes the head noun and everything else is a
leftover note, the prep/descriptor/color/size word lists that today *clean the
name before matching* are no longer needed on the matched path.

### Fallback — new-ingredient namer (the ONLY judgment-vocabulary home)
When a group has **zero** catalog matches, roll back to the Pass-2 state
(amounts/units intact) and run a heuristic over the non-amount tokens to pick
the most likely **new ingredient name**:
- Strip leading/trailing prep/descriptor/size words (`PREP_LEADING_TOKENS`,
  `STANDALONE_DESCRIPTOR_NAMES`, `SIZE_MODIFIER_TOKENS`, `VAGUE_WORDS`) to expose
  the head noun → the created ingredient's name.
- The amount = the group's main pair (depth-aware, earliest-start).
- Remainder → notes.
- **Per group**, so `Petersilie und Koriander` (both unknown → no matches → no
  connector-split in Pass 5 because neither side matched) is re-split here: the
  namer sees two head nouns (neither is a descriptor) → two new ingredients;
  `fresh or frozen cheese tortellini` (all unknown) → "fresh" is a descriptor,
  dropped → one new ingredient "cheese tortellini", note "fresh or frozen".

This is the agreed boundary: **word lists allowed, but only to name a brand-new
ingredient — never to match or split.**

## Word-list disposition

| Set | Today's job | New home |
|---|---|---|
| `TEXT_ONE/HALF/QUARTER`, `WRITTEN_CARDINALS`, `FRACTIONS`, `APPROX_TOKENS_RE` | amount parsing | **Keep** (closed grammatical) — Pass 2 |
| `ARTICLES`, `POST_UNIT_CONNECTORS`, `PREP_CONNECTORS` | article/connector consumption | **Keep** (closed grammatical) — Pass 2 |
| `OR_WORDS`, `CONJ_WORDS`, `CONJUNCTION_TOKENS`, slash | connector tokens | **Keep** (closed grammatical) — Pass 5 |
| `OPTIONAL_WORDS/PAIRS/PREFIX`, `SUB_MARKER_WORDS`, `ALT_*` | optional/alt markers | **Keep** (closed grammatical) — annotation |
| `PREP_NOUNS`, `LEADING_NOTE_PAIRS`, `TO_TASTE_PHRASES`, `USAGE_PREFIX*` | "Saft von", "nach Belieben", "zum Braten" → notes | **Keep but reframed**: structural note markers (closed-ish phrase sets); revisit case-by-case |
| `STANDALONE_DESCRIPTOR_NAMES`, `STANDALONE_USAGE_TARGETS` | split guard | **Move** → fallback namer only |
| `COLOR_ADJECTIVE_BASES` | prevent conjunction split | **Remove** (subsumed by "split only when both sides match") |
| `PREP_WORDS`, `PREP_LEADING_TOKENS`, `VAGUE_WORDS` | name cleanup before match | **Move** → fallback namer only (matched path uses leftover-notes) |
| `SIZE_MODIFIERS`, `SIZE_MODIFIER_TOKENS` | skip in amount pass / notes | **Mostly structural** (depth/paren + leftover-notes); residual → fallback namer |
| `KNOWN_PAIRS` ("Salz/Pfeffer" first-wins) | force-split heuristic | **Remove** (catalog both-sides-match handles it) |
| `NOTE_BOUNDARY_TOKENS`, `NAME_FILLER`, `REMAINDER_EDGE_FILLER` | no-match name/note trimming | **Move** → fallback namer |

Net: every **judgment** list leaves the matching/splitting path; the **closed
grammatical** sets stay where they are.

## Data model

Leaf annotations (extend the existing role tagging; annotate-don't-mutate):
- `role`: `amount | unit | ingredient | connector | optional-marker | note`
- `amountRef` / `unitRef`: links forming amount/unit pairs; `isMain` on the main
  pair.
- `matchId` + `matchSpan` + `matchScore`: accepted catalog match (Pass 4).
- `groupId`: assigned in Pass 5.
- Potentials: unaccepted candidate matches kept for pills.

`ParsedRow` / `ImportedIngredient` keep their current shape (quantity,
quantityLow, unit, name, notes, candidateMatches, foldedAlternatives,
foldedIngredients, isAlternative, …) so downstream and the UI are unchanged.

## Alternatives, conjunctions, potentials (UX preserved)
- Pass-5 splits with both sides matched produce alternatives (`oder`) or
  conjunction mains (`und`) exactly as today; `isAlternative`, inherit-the-main,
  and source-order notes are unchanged.
- Unaccepted/one-sided matches and bare-juxtaposition extras surface as
  `candidateMatches` / `foldedAlternatives` / `foldedIngredients` pills — same
  "create alternative" / "+ add ingredient" / promote flow.
- A promoted potential that is a bare modifier ("fresh") may, optionally, share
  the head noun of its group ("fresh [cheese tortellini]") via the existing
  elision mechanism — or be treated as a plain note. **Open question** (below).

## Worked examples
- `20 oz. fresh or frozen cheese tortellini` → P2: 20·oz (main). P3/4: "cheese
  tortellini". P5: only one side of "or" matched → no split. P6: qty 20 oz,
  ingredient cheese tortellini, note "fresh or frozen". ✅
- `1 (15-ounce) can crushed tomatoes` → P2: "1 can" (main, depth 0); "15-ounce"
  nested → size note. P3/4: "tomatoes" (or "crushed tomatoes" if catalog). P6:
  1 can tomatoes, note "(15-ounce), crushed". ✅
- `Honig oder Ahornsirup` → both match → split → two alternatives. ✅
- `Salz und Pfeffer` → both match, whole doesn't → split → two mains. ✅
- `macaroni and cheese` (catalog entry) → whole-span match wins coverage → one
  ingredient, no split. ✅
- `Petersilie und Koriander` (both unknown) → no matches → no connector split →
  fallback re-splits → two new ingredients (both head nouns). ✅
- `Mozzarella Basilikum` (no connector) → two matches, no separator → best match
  + potential pill; no whitespace split. ✅
- `100 g Mehl und Zucker` → split (both match); "100 g" in Mehl's group; Zucker
  has no own amount → unspecified (not inherited unless "je"/each). ✅

## Interface & UX preserved
`parseIngredientLines(lines, lookups, options)` and `ImportedIngredient`
unchanged. `parseLeaves`/`parseSegment` may be replaced internally but keep
their signatures for tests/callers (reparse-scan, import routes).

## Open questions (to pin before/within the plan)
1. **Coverage tiebreak** when both the whole span *and* the parts match
   (`A und B` where `A und B`, `A`, `B` are all catalog entries). Rule:
   longest-contiguous / highest-coverage wins; specify the exact comparator.
2. **Multi-amount association** for conjunctions: `je 100 g Mehl und Zucker`
   ("je"/each → both get 100 g) vs `100 g Mehl und Zucker` (Mehl only). Keep the
   existing "each" distribution rule; define inheritance precisely.
3. **Promoted-modifier head-sharing**: does promoting "fresh" yield "fresh
   cheese tortellini" (elision) or a bare "fresh"? Recommend: treat as note by
   default; head-share only via explicit elision (`Weizen- oder Dinkelmehl`).
4. **Prep-noun forms** (`Saft von 2 Zitronen`, `Abrieb einer Zitrone`): keep the
   existing prep-noun pass (structural "X von Y" → note + amount on Y) — confirm
   it composes with whole-line amount annotation.

## Migration strategy (phased — this is the crux of the risk)

~4,553 lines of tests (incl. a Familywall golden corpus) encode today's
behavior. A big-bang rewrite is high risk. Recommended phasing, each shippable
and gated by the **existing test suite + golden corpus as the parity oracle**:

- **Phase 0 (done):** the targeted `preIsHeadlessModifier` unit-skip fix
  (`fix/or-split-headless-unit`) keeps the tortellini class working in the
  meantime.
- **Phase 1 — Whole-line amount/unit annotation.** Move amount/unit detection
  ahead of segmentation; segments read annotations instead of re-parsing. No
  behavior change intended; locks the "amounts can't be stranded" property.
- **Phase 2 — Match-driven split.** Replace the or/conjunction split *guards*
  (descriptor/color/headless lists) with "split only when accepted matches flank
  the connector." Delete `STANDALONE_DESCRIPTOR_NAMES`, `COLOR_ADJECTIVE_BASES`,
  `KNOWN_PAIRS` from the split path.
- **Phase 3 — Matched-path name cleanup → leftover notes.** Stop pre-stripping
  prep words for *matched* ingredients; let the matcher tolerate extras and route
  leftovers to notes. Retire `PREP_WORDS`/`PREP_LEADING_TOKENS` from the matched
  path.
- **Phase 4 — Consolidate the fallback namer.** The only remaining judgment-vocab
  consumer; one well-tested module.

Each phase: keep all existing tests green; diff the new pipeline against the
current one over the golden corpus (and ideally the full prod recipe set via
`reparse-scan`) and review every changed line before flipping. A feature flag
lets both run in parallel during a phase.

## Testing strategy
- Existing ~4,553 lines stay as the behavioral spec; they must pass (or a change
  is explicitly justified, like the deliberate range-note change earlier).
- Add a **corpus parity harness**: run old vs new over the Familywall golden
  data + a snapshot of prod recipes; assert no unreviewed diffs.
- New unit tests per pass (amount annotation depth/main; overlap resolution;
  connector-flank split; fallback per-group naming).

## Risk & recommendation
The end state is clean and removes the word lists you object to from every
matching/splitting decision. The cost is real: it touches the most intricate,
most-tested part of the app. **Recommendation:** commit to the end-state design,
but execute it in the four phases above behind the corpus oracle — never as a
single rewrite. Phase 1+2 alone deliver the bug fix and kill the descriptor/color
split lists at modest risk; Phase 3 is the larger, higher-value step.

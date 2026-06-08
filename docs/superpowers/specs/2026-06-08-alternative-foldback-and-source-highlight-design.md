# Alternative fold-back on removal + source highlight

## Goal

Two related editor behaviours, both keyed on knowing which span(s) of an
ingredient's original line correspond to each parsed row:

1. **Fold-back on removal.** Removing an alternative (in the bulk-reparse edit
   panel and the normal recipe editor) appends its original source fragment to
   the primary's notes — as if the parser had never split it out. The connector
   stays verbatim (`or` vs `oder`); an amount the alternative never had stays
   absent.

2. **Source highlight.** In the "Original:" line shown per row, **mute** the
   text that did NOT contribute to that row, leaving the row's own parts at
   normal emphasis. A row's contributing parts are its own segment PLUS anything
   it inherits — the primary's amount/unit, and a shared note all alternatives
   inherit.

## Representation: source ranges

Each parsed row carries character ranges into its original line:

- `sourceRange: [start, end]` — the row's own segment. For an alternative this
  INCLUDES its connector (`oder Ahornsirup`). Drives fold-back text
  (`rawText.slice(sourceRange)`) and is the first kept span for the highlight.
- `inheritedRanges: [start, end][]` — extra kept spans the row inherits: the
  primary's amount/unit span (when the alt inherited the amount) and a shared
  note's span (when a sibling inherited it).

Highlight keeps `[sourceRange, ...inheritedRanges]` at normal emphasis and mutes
everything else in the line. Ranges index into the row's `rawText`, which for
grouped/expanded rows equals the original line.

## How ranges are derived (risk-bounded)

- **Own segment (exact, no splitter changes):** the `oder`/paren splitters slice
  RAW substrings of the line, so each `row.text` is a literal substring of the
  original. A post-pass over `expandIngredientLine`'s output locates each
  `row.text` in the original (sequential cursor), extending left to include the
  connector for alternatives. Cases where the text was reassembled (the
  `((10 g) oder X)` paren-hoist) won't be found → no range → that row simply
  isn't muted (graceful).
- **Amount / shared-note sub-spans:** a dedicated offset helper takes a
  segment's raw text plus its parsed result (quantity, unit, note value) and
  returns the amount-prefix range / note range via an anchored,
  parsed-value-validated scan. Computed at the inheritance stage where it is
  known what each row inherits. Not threaded through `normalize()`/`tokenize()`
  — that full rewrite is disproportionate risk for cosmetic highlighting.

## Threading

`ImportedIngredient` → `ParsedIngredientResponse` (carried by the existing
`as unknown as` cast in reparse-scan / import) → `DraftIngredient` (set in
`parsedIngredientToDraft`). Ranges are transient (parse session only); after
save+reload they are absent, so the highlight no-ops and fold-back reconstructs
the text from current fields.

## Components

- `expandIngredientLine` (+ post-pass): attach `sourceRange` to each row.
- offset helper (pure, tested): `amountSourceRange`, note range.
- `index.ts`: attach `sourceRange`/`inheritedRanges` to `ImportedIngredient`;
  compute inherited ranges in `inheritWithinGroup`.
- `alternatives.ts`: `removeAlternativeFoldingNote(rows, idx)` — splice the
  alternative and append its fold text (`rawText.slice(sourceRange)` if present,
  else reconstruct `oder <own-amount?> <name>[, <notes>]`) to the primary's
  notes. Blank → plain remove; non-alternative → plain remove. Unit-tested.
- `ingredient-row.tsx`: render the "Original:" line muting text outside the kept
  ranges.
- Wiring: alternative removal in the bulk dialog (`mutateDraft`) and the section
  editor (`requestRemove`). Primary removal + confirm dialog unchanged.

## Out of scope

- Persisting ranges to the DB (reloaded recipes use the graceful fallbacks).
- Bolding inherited amounts that the alternative only inherits is IN scope via
  `inheritedRanges`; the visual is muting-the-rest, not bold.

# Bulk-reparse performance — design

- **Date:** 2026-06-02
- **Status:** Approved (pending written-spec review)
- **Author:** Steven Weingärtner (with Claude)

## Problem

Opening the bulk-reparse dialog runs `scanAllRecipesForReparse`, which re-parses
every recipe line. Measured on the prod DB: 466 recipes, 5,803 ingredient rows,
4,519 distinct raw lines, 3,022 catalog entries → **~5.8 s**, of which lookups
are ~33 ms; the rest is per-line parsing (each line scored against all 3,022
catalog entries × 2 tokenizations). The pain is **reopening the dialog
repeatedly** — the same work is redone every open.

## Goal

Make reopening the dialog near-instant when the catalog hasn't changed, and
shave the within-scan duplicate work, without changing scan results.

## Non-goals

- No persistent (DB) cache — an in-memory cache is sufficient; it need not
  survive a server restart (a restart simply starts cold).
- No matcher changes (the token inverted-index, option D, is a separate future
  idea).
- No worker-thread parallelism.

## Design — one in-memory cache, used within a scan and across reopens

A module-level cache in `src/lib/recipes/reparse-scan.ts`:

```
let cacheFingerprint: string | null = null;
const parseCache = new Map<string, ParsedIngredientResponse[]>(); // key: trimmed raw line
```

- The proposed parse is a pure function of `(rawLine, lookups)`, so caching by
  trimmed raw line is sound. A raw line shared across recipes parses once
  (within-scan dedup); a reopen with an unchanged catalog reuses everything
  (cross-open reuse).
- `scanAllRecipesForReparse` per group: `parseCache.get(rawLine) ?? parseAndStore`.

### Invalidation by content fingerprint

At scan start compute a cheap fingerprint of the parse inputs and clear the cache
if it changed:

- **Catalog**: over the built catalog entries, join `id|aliasName|unitId`.
- **Unit lookup**: over `units.byNameOrAlias` (sorted `key→id`) plus
  `globalDefaultUnitId` — unit renames/aliases/global-default affect parsing but
  are not in the catalog.

Combine into one string and hash (cheap over ~3,000 entries). `fingerprint !==
cacheFingerprint` → `parseCache.clear(); cacheFingerprint = fingerprint`. In-memory,
so a deploy/restart starts empty (no parser-version token needed).

Expose a tiny seam for testing: `__resetReparseParseCache()` (clears map +
fingerprint) and a parse-call counter or an injectable parse fn.

## Why results are unchanged

Only the **proposed** side is cached. The "changed?" decision
(`isLineGroupChanged(current, proposed)`) reads the **current** rows fresh from
the DB every scan, so applies/edits are always reflected. Mute exclusion (other
spec) runs *before* the cache lookup, so muted groups cost nothing.

## Expected result

- First scan after start or any catalog change: unchanged (~5.8 s).
- Reopen with unchanged catalog: DB load + grouping + ~5,000 cheap comparisons →
  sub-second.

## Testing

- A second `scanAllRecipesForReparse` with an unchanged catalog calls the parse
  function zero times (counter/spy) and returns identical entries.
- A simulated catalog change (different fingerprint) clears the cache → parses
  again, and an actually-changed catalog yields updated proposals.
- Within one scan, a raw line repeated across recipes is parsed once.

## Scope

Confined to `reparse-scan.ts`. No migration, no API/UI change, no matcher change.

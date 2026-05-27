/**
 * Familywall import orchestrator — reads cached HTML snapshots
 * (downloaded earlier by `runFamilywallDownload`), parses each with
 * jsdom, and ingests into the nomly DB via `createRecipe`/`updateRecipe`.
 *
 * Network-free: the cache must already exist on disk. See
 * `scripts/familywall-download.mts` for the download step.
 */

import { readImageBytes, parseSnapshot } from "./parse-snapshot.ts";
import { resolveCacheQueue } from "./cache.ts";
import {
  buildLookups,
  ingestRawRecipe,
  type IngestLookups,
  type IngestOutcome,
} from "./ingest.ts";
import type {
  FamilywallImportSummary,
  FamilywallRawRecipe,
} from "./types.ts";

export type ImportOptions = {
  /** Parse + transform, but skip every DB write and photo store. */
  dryRun?: boolean;
  /** Re-import recipes that already exist (matched on title + source_url). */
  overwrite?: boolean;
  /** Cap how many cached recipes are ingested. */
  limit?: number;
  /** Only import a recipe whose cached id equals this (accepts "recipe/..." or just the suffix). */
  onlyRecipeId?: string;
  /** Only import recipes whose title contains this substring (case-insensitive). */
  onlyTitleSubstring?: string;
  /** Emit per-recipe parsing diagnostics. */
  debug?: boolean;
  /** Per-line progress hook the CLI uses for live output. */
  onRecipe?: (info: {
    index: number;
    total: number;
    title: string;
    outcome:
      | "imported"
      | "skipped"
      | "failed"
      | "would-import"
      | "updated"
      | "would-update";
    recipeId?: number;
    error?: string;
  }) => void;
};

async function ingestOne(
  raw: FamilywallRawRecipe,
  lookups: IngestLookups,
  opts: ImportOptions,
): Promise<IngestOutcome> {
  // Image bytes come straight from the local snapshot cache here (local-DB
  // import). The API path reads them off the wire instead.
  const imageBytes =
    raw.imageUrl && !opts.dryRun ? readImageBytes(raw.imageUrl) : null;
  return ingestRawRecipe(raw, imageBytes, {
    overwrite: opts.overwrite,
    dryRun: opts.dryRun,
    lookups,
  });
}

export async function runFamilywallImport(
  opts: ImportOptions,
): Promise<FamilywallImportSummary> {
  // `lookups` must be refreshed after every successful ingestion so the
  // substring matcher in `parseIngredientLines` sees ingredients that earlier
  // recipes in the same run just created. Without this, a fresh DB import
  // produces duplicates whenever two recipes mention the same ingredient with
  // different inflection / word order (e.g. "Paprikaschote" vs
  // "Paprikaschoten", or "Paprikapulver rosenscharf" vs "rosenscharfes
  // Paprikapulver"): neither variant is in the catalog when its row is
  // processed, so both get created as new ingredients.
  let lookups = buildLookups();
  const summary: FamilywallImportSummary = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const queue = resolveCacheQueue(opts);
  const cap = opts.limit ? Math.min(opts.limit, queue.length) : queue.length;
  if (opts.debug) {
    console.log(`[familywall] queue: ${queue.length} cached recipes, processing ${cap}`);
  }
  let index = 0;

  for (let i = 0; i < cap; i++) {
    const id = queue[i];
    index += 1;
    if (opts.debug) console.log(`[familywall] parsing snapshot ${id}`);
    const parsed = parseSnapshot(id);
    if (!parsed) {
      summary.failed += 1;
      summary.details.push({
        title: id,
        outcome: "failed",
        error: "snapshot missing or unparsable",
      });
      opts.onRecipe?.({
        index,
        total: cap,
        title: id,
        outcome: "failed",
        error: "snapshot missing or unparsable",
      });
      continue;
    }

    const result = await ingestOne(parsed.raw, lookups, opts);
    const title = parsed.raw.title;
    switch (result.outcome) {
      case "imported":
        summary.imported += 1;
        summary.details.push({ title, outcome: "imported", recipeId: result.id });
        opts.onRecipe?.({ index, total: cap, title, outcome: "imported", recipeId: result.id });
        // New ingredients may have been inserted; refresh lookups so the
        // next recipe's matcher can see them.
        lookups = buildLookups();
        break;
      case "updated":
        summary.updated += 1;
        summary.details.push({ title, outcome: "updated", recipeId: result.id });
        opts.onRecipe?.({ index, total: cap, title, outcome: "updated", recipeId: result.id });
        lookups = buildLookups();
        break;
      case "would-import":
        summary.imported += 1;
        summary.details.push({ title, outcome: "imported" });
        opts.onRecipe?.({ index, total: cap, title, outcome: "would-import" });
        break;
      case "would-update":
        summary.updated += 1;
        summary.details.push({ title, outcome: "updated", recipeId: result.id });
        opts.onRecipe?.({ index, total: cap, title, outcome: "would-update", recipeId: result.id });
        break;
      case "skipped":
        summary.skipped += 1;
        summary.details.push({ title, outcome: "skipped" });
        opts.onRecipe?.({ index, total: cap, title, outcome: "skipped" });
        break;
      case "failed":
        summary.failed += 1;
        summary.details.push({ title, outcome: "failed", error: result.error });
        opts.onRecipe?.({ index, total: cap, title, outcome: "failed", error: result.error });
        break;
    }
  }

  return summary;
}

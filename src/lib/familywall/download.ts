/**
 * Download orchestrator: drives the crawler and writes each captured
 * snapshot to the on-disk cache. Knows nothing about the nomly DB — its
 * only side effect is the filesystem under `data/familywall-cache`.
 */

import {
  clearCache,
  mergeIndex,
  writeIndex,
  writeRecipeSnapshot,
  type RecipeSnapshot,
} from "./cache.ts";
import { extractRawRecipeFromDocument } from "./extract.ts";
import { JSDOM } from "jsdom";
import {
  withFamilywallCrawler,
  type CrawlOptions,
  type CapturedSnapshot,
} from "./crawler.ts";

export type DownloadOptions = CrawlOptions & {
  /** Per-recipe progress callback, used by the CLI for live output. */
  onRecipe?: (info: {
    index: number;
    title: string;
    outcome: "saved" | "skipped" | "failed";
    error?: string;
  }) => void;
};

export type DownloadSummary = {
  saved: number;
  skipped: number;
  failed: number;
};

/**
 * Drive the Familywall crawler and persist each captured snapshot.
 *
 * Two modes:
 *   - **Full refresh** (no `--recipe-id` / `--title` filter): wipes the
 *     cache directory up front, then walks every recipe. The post-crawl
 *     index replaces whatever was there.
 *   - **Targeted re-download** (filter present): leaves the cache intact,
 *     overwrites only the matching snapshot directories, and *merges* the
 *     captured recipes into the existing index instead of replacing it.
 *     This lets the user refresh a single recipe (e.g. one they just
 *     edited in Familywall) without losing the other 465 cached entries.
 */
export async function runFamilywallDownload(
  opts: DownloadOptions,
): Promise<DownloadSummary> {
  const targeted = Boolean(opts.onlyRecipeId || opts.onlyTitleSubstring);
  if (!targeted) clearCache();
  const summary: DownloadSummary = { saved: 0, skipped: 0, failed: 0 };

  const sink = async (cap: CapturedSnapshot) => {
    try {
      // Parse the snapshot once during download so we can pull the
      // original `source_url` out of the times table — it goes into
      // meta.json for quick listing, and the import re-parses anyway.
      const dom = new JSDOM(cap.detailHtml);
      const raw = extractRawRecipeFromDocument(dom.window.document);
      const snapshot: RecipeSnapshot = {
        id: cap.id,
        title: cap.title,
        sourceUrl: raw?.sourceUrl ?? null,
        detailHtml: cap.detailHtml,
        image:
          cap.imageBytes && cap.imageExt
            ? { bytes: cap.imageBytes, ext: cap.imageExt }
            : null,
      };
      writeRecipeSnapshot(snapshot);
      summary.saved += 1;
      opts.onRecipe?.({
        index: summary.saved + summary.skipped + summary.failed,
        title: cap.title,
        outcome: "saved",
      });
    } catch (e) {
      summary.failed += 1;
      const error = e instanceof Error ? e.message : String(e);
      opts.onRecipe?.({
        index: summary.saved + summary.skipped + summary.failed,
        title: cap.title,
        outcome: "failed",
        error,
      });
    }
  };

  const result = await withFamilywallCrawler(opts, sink);
  // Anything not captured (yielded null) shows up as the gap between
  // `total` and the snapshots we actually saved.
  summary.skipped = result.total - summary.saved - summary.failed;
  if (targeted) {
    mergeIndex(result.capturedRecipes);
  } else {
    writeIndex(result.capturedRecipes);
  }
  return summary;
}

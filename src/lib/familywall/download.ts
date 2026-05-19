/**
 * Download orchestrator: drives the crawler and writes each captured
 * snapshot to the on-disk cache. Knows nothing about the nomly DB — its
 * only side effect is the filesystem under `data/familywall-cache`.
 */

import {
  clearCache,
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
 * Wipe the cache, then walk every recipe in Familywall and write each
 * snapshot to disk. After the crawl completes, write the cache index.
 */
export async function runFamilywallDownload(
  opts: DownloadOptions,
): Promise<DownloadSummary> {
  clearCache();
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
  writeIndex(result.capturedRecipes);
  return summary;
}

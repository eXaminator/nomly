/**
 * Familywall import orchestrator. Wires the Playwright crawler to the
 * recipe service via the pure transform, applies the (title, source_url)
 * dedup, and produces a structured summary.
 *
 * Designed to be called from a CLI entry point (`scripts/import-familywall.
 * mts`); also reusable from tests with a stubbed crawler.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { recipe } from "../../db/schema.ts";
import {
  buildIngredientLookup,
  buildUnitLookup,
} from "../recipe-import/index.ts";
import { createRecipe, updateRecipe } from "../recipes/service.ts";
import { savePhotoBuffer } from "../photos.ts";
import {
  fetchImageWithContext,
  withFamilywallCrawler,
  type CrawlOptions,
} from "./crawler.ts";
import { transformFamilywallRecipe } from "./transform.ts";
import type {
  FamilywallImportSummary,
  FamilywallRawRecipe,
} from "./types.ts";
import type { BrowserContext } from "playwright";

export type RunOptions = CrawlOptions & {
  /** When true: parse + transform but skip every DB write and photo store. */
  dryRun?: boolean;
  /** When true: re-import recipes that already exist in the DB (matched by
   *  the same title + source_url dedup as the skip path). The existing
   *  recipe row is updated in place, preserving its ID + relationships. */
  overwrite?: boolean;
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

function findExistingRecipeId(
  title: string,
  sourceUrl: string | null,
): number | null {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) return null;
  const matchSourceUrl = sourceUrl?.trim() ?? null;
  // Two recipes are "the same" iff they share title (case-insensitive)
  // AND have the same source_url — where same means both null, or both
  // strings equal. A sourced "Bolognese" and an unsourced "Bolognese" are
  // distinct recipes.
  const hit = db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      and(
        // lower_u (registered in src/db/index.ts) is Unicode-aware — SQLite's
        // built-in LOWER would skip umlauts and miss recipes like "Apfelkuchen
        // mit Äpfeln".
        sql`lower_u(${recipe.title}) = ${normalizedTitle.toLowerCase()}`,
        matchSourceUrl === null
          ? isNull(recipe.sourceUrl)
          : eq(recipe.sourceUrl, matchSourceUrl),
      ),
    )
    .get();
  return hit?.id ?? null;
}

async function ingestOne(
  raw: FamilywallRawRecipe,
  ctx: BrowserContext,
  lookups: ReturnType<typeof buildLookups>,
  opts: RunOptions,
): Promise<
  | { outcome: "imported"; id: number }
  | { outcome: "updated"; id: number }
  | { outcome: "skipped" }
  | { outcome: "failed"; error: string }
  | { outcome: "would-import" }
  | { outcome: "would-update"; id: number }
> {
  try {
    const existing = findExistingRecipeId(raw.title, raw.sourceUrl);
    if (existing !== null && !opts.overwrite) {
      return { outcome: "skipped" };
    }

    let photoPath: string | null = null;
    if (raw.imageUrl && !opts.dryRun) {
      const bytes = await fetchImageWithContext(ctx, raw.imageUrl);
      if (bytes) {
        try {
          photoPath = await savePhotoBuffer(bytes);
        } catch {
          // Image failed (corrupt, sharp rejected it); proceed without.
          photoPath = null;
        }
      }
    }

    const payload = transformFamilywallRecipe(raw, lookups, photoPath);

    if (existing !== null) {
      if (opts.dryRun) return { outcome: "would-update", id: existing };
      updateRecipe(existing, payload);
      return { outcome: "updated", id: existing };
    }

    if (opts.dryRun) return { outcome: "would-import" };
    const id = createRecipe(payload);
    return { outcome: "imported", id };
  } catch (e) {
    return {
      outcome: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildLookups() {
  return {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
  };
}

export async function runFamilywallImport(
  opts: RunOptions,
): Promise<FamilywallImportSummary> {
  const lookups = buildLookups();
  const summary: FamilywallImportSummary = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };
  let index = 0;

  await withFamilywallCrawler(
    opts,
    async (raw, { ctx }) => {
      index += 1;
      const result = await ingestOne(raw, ctx, lookups, opts);

      switch (result.outcome) {
        case "imported":
          summary.imported += 1;
          summary.details.push({
            title: raw.title,
            outcome: "imported",
            recipeId: result.id,
          });
          opts.onRecipe?.({
            index,
            total: -1,
            title: raw.title,
            outcome: "imported",
            recipeId: result.id,
          });
          break;
        case "updated":
          summary.updated += 1;
          summary.details.push({
            title: raw.title,
            outcome: "updated",
            recipeId: result.id,
          });
          opts.onRecipe?.({
            index,
            total: -1,
            title: raw.title,
            outcome: "updated",
            recipeId: result.id,
          });
          break;
        case "would-import":
          summary.imported += 1;
          summary.details.push({ title: raw.title, outcome: "imported" });
          opts.onRecipe?.({
            index,
            total: -1,
            title: raw.title,
            outcome: "would-import",
          });
          break;
        case "would-update":
          summary.updated += 1;
          summary.details.push({
            title: raw.title,
            outcome: "updated",
            recipeId: result.id,
          });
          opts.onRecipe?.({
            index,
            total: -1,
            title: raw.title,
            outcome: "would-update",
            recipeId: result.id,
          });
          break;
        case "skipped":
          summary.skipped += 1;
          summary.details.push({ title: raw.title, outcome: "skipped" });
          opts.onRecipe?.({
            index,
            total: -1,
            title: raw.title,
            outcome: "skipped",
          });
          break;
        case "failed":
          summary.failed += 1;
          summary.details.push({
            title: raw.title,
            outcome: "failed",
            error: result.error,
          });
          opts.onRecipe?.({
            index,
            total: -1,
            title: raw.title,
            outcome: "failed",
            error: result.error,
          });
          break;
      }
    },
  );

  return summary;
}

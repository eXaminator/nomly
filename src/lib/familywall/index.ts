/**
 * Familywall import orchestrator — reads cached HTML snapshots
 * (downloaded earlier by `runFamilywallDownload`), parses each with
 * jsdom, and ingests into the nomly DB via `createRecipe`/`updateRecipe`.
 *
 * Network-free: the cache must already exist on disk. See
 * `scripts/familywall-download.mts` for the download step.
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
import { readImageBytes, parseSnapshot } from "./parse-snapshot.ts";
import { readIndex, listCachedIds } from "./cache.ts";
import { transformFamilywallRecipe } from "./transform.ts";
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

function findExistingRecipeId(
  title: string,
  sourceUrl: string | null,
): number | null {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) return null;
  const matchSourceUrl = sourceUrl?.trim() ?? null;
  const hit = db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      and(
        sql`lower_u(${recipe.title}) = ${normalizedTitle.toLowerCase()}`,
        matchSourceUrl === null
          ? isNull(recipe.sourceUrl)
          : eq(recipe.sourceUrl, matchSourceUrl),
      ),
    )
    .get();
  return hit?.id ?? null;
}

function buildLookups() {
  return {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
  };
}

async function ingestOne(
  raw: FamilywallRawRecipe,
  lookups: ReturnType<typeof buildLookups>,
  opts: ImportOptions,
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
      const bytes = readImageBytes(raw.imageUrl);
      if (bytes) {
        try {
          photoPath = await savePhotoBuffer(bytes);
        } catch {
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

/**
 * Returns the cached recipe IDs that will be processed, after applying
 * `--recipe-id` / `--title` filters.
 */
function resolveQueue(opts: ImportOptions): string[] {
  const index = readIndex();
  const ids = index ? index.recipes.map((r) => r.id) : listCachedIds();
  const titlesById = new Map(
    (index?.recipes ?? []).map((r) => [r.id, r.title]),
  );

  if (opts.onlyRecipeId) {
    const target = opts.onlyRecipeId.startsWith("recipe/")
      ? opts.onlyRecipeId
      : `recipe/${opts.onlyRecipeId}`;
    const hit = ids.find((id) => id === target);
    return hit ? [hit] : [];
  }
  if (opts.onlyTitleSubstring) {
    const needle = opts.onlyTitleSubstring.toLowerCase();
    return ids.filter((id) =>
      (titlesById.get(id) ?? "").toLowerCase().includes(needle),
    );
  }
  return ids;
}

export async function runFamilywallImport(
  opts: ImportOptions,
): Promise<FamilywallImportSummary> {
  const lookups = buildLookups();
  const summary: FamilywallImportSummary = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const queue = resolveQueue(opts);
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
        break;
      case "updated":
        summary.updated += 1;
        summary.details.push({ title, outcome: "updated", recipeId: result.id });
        opts.onRecipe?.({ index, total: cap, title, outcome: "updated", recipeId: result.id });
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

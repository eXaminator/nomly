/**
 * jsdom-free ingest core for a single Familywall recipe. Takes an
 * already-parsed {@link FamilywallRawRecipe} plus optional raw image bytes,
 * resolves ingredients/units against the live catalog, and writes via
 * `createRecipe`/`updateRecipe`. Deliberately imports nothing from the
 * snapshot/cache layer (which pulls in jsdom) so it runs in the pruned
 * production image — both the CLI importer and the API route call this.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { recipe } from "../../db/schema.ts";
import {
  buildIngredientCatalog,
  buildIngredientLookup,
  buildSubUnitLookup,
  buildUnitLookup,
} from "../recipe-import/index.ts";
import { createRecipe, updateRecipe } from "../recipes/service.ts";
import { savePhotoBuffer } from "../photos.ts";
import { transformFamilywallRecipe } from "./transform.ts";
import type { FamilywallRawRecipe } from "./types.ts";

export type IngestLookups = ReturnType<typeof buildLookups>;

export function buildLookups() {
  return {
    units: buildUnitLookup(),
    ingredients: buildIngredientLookup(),
    ingredientCatalog: buildIngredientCatalog(),
    subUnits: buildSubUnitLookup(),
  };
}

export function findExistingRecipeId(
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

export type IngestOutcome =
  | { outcome: "imported"; id: number }
  | { outcome: "updated"; id: number }
  | { outcome: "skipped" }
  | { outcome: "failed"; error: string }
  | { outcome: "would-import" }
  | { outcome: "would-update"; id: number };

export type IngestRawOptions = {
  /** Re-import recipes that already exist (matched on title + source_url). */
  overwrite?: boolean;
  /** Parse + transform, but skip every DB write and photo store. */
  dryRun?: boolean;
  /**
   * Prebuilt lookups. When omitted they're built fresh from the current DB
   * state — which is what the API route wants (one request per recipe, so
   * each request sees ingredients created by earlier ones).
   */
  lookups?: IngestLookups;
};

/**
 * Ingest one raw recipe. `imageBytes` are the decoded photo bytes (or null);
 * when present and not a dry run they're normalized + stored and the recipe's
 * `photoPath` is set. Never throws — failures are returned as an outcome.
 */
export async function ingestRawRecipe(
  raw: FamilywallRawRecipe,
  imageBytes: Buffer | null,
  opts: IngestRawOptions = {},
): Promise<IngestOutcome> {
  try {
    const lookups = opts.lookups ?? buildLookups();
    const existing = findExistingRecipeId(raw.title, raw.sourceUrl);
    if (existing !== null && !opts.overwrite) {
      return { outcome: "skipped" };
    }

    let photoPath: string | null = null;
    if (imageBytes && !opts.dryRun) {
      try {
        photoPath = await savePhotoBuffer(imageBytes);
      } catch {
        photoPath = null;
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

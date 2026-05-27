/**
 * Client side of the API-targeted Familywall import. Runs locally (where
 * Playwright + jsdom live): reads the local snapshot cache, parses each
 * recipe, and POSTs the parsed recipe + photo bytes to the prod
 * `/api/v1/recipes/import-familywall` route, which does the catalog matching
 * and DB writes against the LIVE data. The local HTML/image cache is only
 * read here — never purged — so it stays as a personal backup.
 *
 * Imports nothing from the DB layer (the `IngestOutcome` import is type-only),
 * so this never opens a local SQLite file.
 */

import { parseSnapshot, readImageBytes } from "./parse-snapshot.ts";
import { resolveCacheQueue } from "./cache.ts";
import type { FamilywallImportSummary, FamilywallRawRecipe } from "./types.ts";
import type { IngestOutcome } from "./ingest.ts";

const IMPORT_PATH = "/api/v1/recipes/import-familywall";

export type ApiClientConfig = {
  /** Prod base URL, e.g. https://nomly.example.tld (trailing slash ok). */
  baseUrl: string;
  /** Bearer token minted via `npm run token:create`. */
  token: string;
  overwrite?: boolean;
  dryRun?: boolean;
};

/**
 * POST one parsed recipe (+ optional photo bytes) to the import route.
 * `doFetch` is injected so the transport is testable; pass the global
 * `fetch` in production. Never throws — transport/HTTP errors map to a
 * `failed` outcome.
 */
export async function postRawRecipe(
  doFetch: typeof fetch,
  cfg: ApiClientConfig,
  raw: FamilywallRawRecipe,
  imageBytes: Buffer | null,
): Promise<IngestOutcome> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}${IMPORT_PATH}`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({
        raw,
        imageBase64: imageBytes ? imageBytes.toString("base64") : null,
        overwrite: cfg.overwrite ?? false,
        dryRun: cfg.dryRun ?? false,
      }),
    });
  } catch (e) {
    return {
      outcome: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response body
  }

  if (!res.ok) {
    const error =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`;
    return { outcome: "failed", error };
  }
  return json as IngestOutcome;
}

export type ApiImportOptions = ApiClientConfig & {
  limit?: number;
  onlyRecipeId?: string;
  onlyTitleSubstring?: string;
  debug?: boolean;
  onRecipe?: (info: {
    index: number;
    total: number;
    title: string;
    outcome: IngestOutcome["outcome"];
    recipeId?: number;
    error?: string;
  }) => void;
  /** Injectable transport (defaults to global fetch). */
  fetchImpl?: typeof fetch;
};

/**
 * Walk the local snapshot cache and import each recipe via the prod API.
 * Sequential on purpose: each request rebuilds the server-side ingredient
 * lookups, so a recipe sees ingredients created by the ones before it.
 */
export async function runFamilywallImportViaApi(
  opts: ApiImportOptions,
): Promise<FamilywallImportSummary> {
  const doFetch = opts.fetchImpl ?? fetch;
  const queue = resolveCacheQueue({
    onlyRecipeId: opts.onlyRecipeId,
    onlyTitleSubstring: opts.onlyTitleSubstring,
  });
  const cap = opts.limit ? Math.min(opts.limit, queue.length) : queue.length;
  const summary: FamilywallImportSummary = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };
  if (opts.debug) {
    console.log(
      `[familywall] queue: ${queue.length} cached recipes, posting ${cap} to ${opts.baseUrl}`,
    );
  }

  for (let i = 0; i < cap; i++) {
    const id = queue[i];
    const index = i + 1;
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

    const raw = parsed.raw;
    const imageBytes =
      raw.imageUrl && !opts.dryRun ? readImageBytes(raw.imageUrl) : null;
    const result = await postRawRecipe(doFetch, opts, raw, imageBytes);
    const title = raw.title;

    switch (result.outcome) {
      case "imported":
      case "would-import":
        summary.imported += 1;
        break;
      case "updated":
      case "would-update":
        summary.updated += 1;
        break;
      case "skipped":
        summary.skipped += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
    }
    const recipeId = "id" in result ? result.id : undefined;
    summary.details.push({
      title,
      outcome:
        result.outcome === "would-import"
          ? "imported"
          : result.outcome === "would-update"
            ? "updated"
            : result.outcome,
      recipeId,
      error: result.outcome === "failed" ? result.error : undefined,
    });
    opts.onRecipe?.({
      index,
      total: cap,
      title,
      outcome: result.outcome,
      recipeId,
      error: result.outcome === "failed" ? result.error : undefined,
    });
  }

  return summary;
}

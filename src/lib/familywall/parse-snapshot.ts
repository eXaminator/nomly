/**
 * Parses a cached HTML snapshot into a `FamilywallRawRecipe`. Bridges
 * jsdom (Node DOM) to the shared `extractRawRecipeFromDocument` so the
 * same logic powers the live crawler and the offline parser.
 */

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { extractRawRecipeFromDocument } from "./extract.ts";
import { loadSnapshot, type LoadedSnapshot } from "./cache.ts";
import type { FamilywallRawRecipe } from "./types.ts";

export type ParsedSnapshot = {
  raw: FamilywallRawRecipe;
  snapshot: LoadedSnapshot;
};

export function parseSnapshot(id: string): ParsedSnapshot | null {
  const snap = loadSnapshot(id);
  if (!snap) return null;
  const raw = parseSnapshotHtml(snap.detailHtml);
  if (!raw) return null;
  // The locally-saved image is what we want the importer to use; rewrite
  // imageUrl to the absolute local path so the orchestrator can fetch
  // bytes via fs instead of HTTP.
  return {
    raw: { ...raw, imageUrl: snap.imagePath },
    snapshot: snap,
  };
}

export function parseSnapshotHtml(html: string): FamilywallRawRecipe | null {
  const dom = new JSDOM(html);
  return extractRawRecipeFromDocument(dom.window.document);
}

/** Convenience helper: read the bytes of a cached image by absolute path. */
export function readImageBytes(absolutePath: string): Buffer | null {
  try {
    return readFileSync(absolutePath);
  } catch {
    return null;
  }
}

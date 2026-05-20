/**
 * On-disk cache for the Familywall importer. Lets us decouple "fetch
 * snapshots from Familywall" from "parse + ingest into nomly" so the
 * parser can iterate without re-hitting the network.
 *
 * Layout under `data/familywall-cache/`:
 *
 *     index.json              { downloadedAt, count, recipes: [{id,title}] }
 *     recipes/<id-slug>/
 *       detail.html           standalone HTML page wrapping #recipeDetail
 *       meta.json             { id, title, sourceUrl, imageMime, …raw }
 *       image.<ext>           original photo bytes (when present)
 *
 * `<id-slug>` is the Familywall `data-fw-meta-id` with "/" → "_" so the
 * value is filesystem-safe (e.g. "recipe_8084800_2230040"). The original
 * id stays inside meta.json.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const CACHE_ROOT = resolve(process.cwd(), "data/familywall-cache");
const RECIPES_DIR = join(CACHE_ROOT, "recipes");
const INDEX_FILE = join(CACHE_ROOT, "index.json");

export type CacheIndex = {
  downloadedAt: string; // ISO timestamp
  count: number;
  recipes: Array<{ id: string; title: string }>;
};

export type CachedRecipeMeta = {
  id: string; // full Familywall id (e.g. "recipe/8084800_2230040")
  title: string;
  sourceUrl: string | null;
  imageFile: string | null; // basename of saved image, or null
  downloadedAt: string;
};

function slugify(id: string): string {
  return id.replace(/[^\w-]+/g, "_");
}

function recipeDir(id: string): string {
  return join(RECIPES_DIR, slugify(id));
}

export function getCacheRoot(): string {
  return CACHE_ROOT;
}

export function cacheStats(): {
  exists: boolean;
  count: number;
  downloadedAt: Date | null;
} {
  if (!existsSync(INDEX_FILE)) return { exists: false, count: 0, downloadedAt: null };
  try {
    const idx = JSON.parse(readFileSync(INDEX_FILE, "utf8")) as CacheIndex;
    return {
      exists: true,
      count: idx.count,
      downloadedAt: new Date(idx.downloadedAt),
    };
  } catch {
    return { exists: false, count: 0, downloadedAt: null };
  }
}

/** Wipe the cache directory. Idempotent — fine to call on a missing dir. */
export function clearCache(): void {
  if (existsSync(CACHE_ROOT)) {
    rmSync(CACHE_ROOT, { recursive: true, force: true });
  }
  mkdirSync(RECIPES_DIR, { recursive: true });
}

export type RecipeSnapshot = {
  id: string;
  title: string;
  sourceUrl: string | null;
  /** Standalone HTML document (full <html>…</html>), viewable directly. */
  detailHtml: string;
  /** Optional photo bytes + extension (jpg/png/webp). */
  image: { bytes: Buffer; ext: string } | null;
};

export function writeRecipeSnapshot(snapshot: RecipeSnapshot): void {
  const dir = recipeDir(snapshot.id);
  mkdirSync(dir, { recursive: true });

  let imageFile: string | null = null;
  if (snapshot.image) {
    imageFile = `image.${snapshot.image.ext}`;
    writeFileSync(join(dir, imageFile), snapshot.image.bytes);
  }

  // Rewrite the image src in the captured fragment so the saved HTML
  // references the local file instead of api.familywall.com. Keeps the
  // snapshot self-contained for offline viewing.
  let bodyHtml = snapshot.detailHtml;
  if (imageFile) {
    bodyHtml = bodyHtml.replace(
      /(<img[^>]*src=")[^"]*("[^>]*>)/i,
      `$1./${imageFile}$2`,
    );
  }
  const wrapped = wrapDetailForViewing(bodyHtml, snapshot.title);
  writeFileSync(join(dir, "detail.html"), wrapped, "utf8");

  const meta: CachedRecipeMeta = {
    id: snapshot.id,
    title: snapshot.title,
    sourceUrl: snapshot.sourceUrl,
    imageFile,
    downloadedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

/**
 * Build a self-contained HTML document around the captured `#recipeDetail`
 * fragment. Familywall's CSS isn't bundled — we just include a tiny
 * readability stylesheet so the snapshot opens cleanly in any browser.
 */
function wrapDetailForViewing(bodyHtml: string, title: string): string {
  const escaped = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escaped}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #222; }
  h1, .h1 { font-size: 1.6rem; margin: 1.2rem 0 0.6rem; }
  p { margin: 0.4rem 0; }
  ul, ol { padding-left: 1.5rem; }
  table.mp-recipe-times { border-collapse: collapse; margin: 0.5rem 0 1rem; }
  table.mp-recipe-times td { padding: 0.1rem 0.6rem 0.1rem 0; vertical-align: top; }
  .recipe-field-name { font-weight: 600; color: #555; }
  .mp-recipe-header-imgcontainer img { max-width: 100%; height: auto; border-radius: 8px; }
  .border-pane { margin: 0.6rem 0; }
  .mp-category { display: inline-block; background: #f1ebe0; padding: 0.1rem 0.6rem; border-radius: 999px; font-size: 0.9rem; margin: 0.1rem 0.3rem 0.1rem 0; vertical-align: middle; }
  .mp-category emoji { font-size: inherit; line-height: 1; vertical-align: middle; }
  /* Hide interactive action controls — the snapshot is read-only — but
     keep the tag chips (.mp-category, which also carry .mp-button-like)
     and the favorite marker (an <icon> whose title encodes the state). */
  .rb-button,
  .mp-button-like:not(.mp-category),
  icon[data-fw-onclick]:not([title*="bester Moment"]):not([title*="best moment"]) {
    display: none;
  }
  icon[data-fw-onclick="mpstar"][title*="bester Moment"],
  icon[data-fw-onclick="mpstar"][title*="best moment"] {
    display: inline-block;
    font-size: 1rem;
    line-height: 1;
    vertical-align: middle;
  }
  icon[data-fw-onclick="mpstar"][title*="bester Moment"]::before,
  icon[data-fw-onclick="mpstar"][title*="best moment"]::before {
    content: "⭐ Familywall-Favorit";
    background: #fff7d6;
    border: 1px solid #f5d97a;
    border-radius: 999px;
    padding: 0.1rem 0.6rem;
    font-size: 0.85rem;
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function writeIndex(items: Array<{ id: string; title: string }>): void {
  mkdirSync(dirname(INDEX_FILE), { recursive: true });
  const index: CacheIndex = {
    downloadedAt: new Date().toISOString(),
    count: items.length,
    recipes: items,
  };
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
}

export function readIndex(): CacheIndex | null {
  if (!existsSync(INDEX_FILE)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_FILE, "utf8")) as CacheIndex;
  } catch {
    return null;
  }
}

export type LoadedSnapshot = {
  id: string;
  meta: CachedRecipeMeta;
  detailHtml: string;
  imagePath: string | null;
};

export function loadSnapshot(id: string): LoadedSnapshot | null {
  const dir = recipeDir(id);
  if (!existsSync(dir)) return null;
  const metaPath = join(dir, "meta.json");
  const htmlPath = join(dir, "detail.html");
  if (!existsSync(metaPath) || !existsSync(htmlPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as CachedRecipeMeta;
  const detailHtml = readFileSync(htmlPath, "utf8");
  const imagePath =
    meta.imageFile && existsSync(join(dir, meta.imageFile))
      ? join(dir, meta.imageFile)
      : null;
  return { id, meta, detailHtml, imagePath };
}

/** All cached recipe IDs in alphabetical order. Useful when no index.json exists. */
export function listCachedIds(): string[] {
  if (!existsSync(RECIPES_DIR)) return [];
  return readdirSync(RECIPES_DIR)
    .filter((name) => {
      try {
        return statSync(join(RECIPES_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((slug) => {
      // recipe_8084800_2230040 → recipe/8084800_2230040
      const idx = slug.indexOf("_");
      return idx === -1 ? slug : `${slug.slice(0, idx)}/${slug.slice(idx + 1)}`;
    })
    .sort();
}

/**
 * Extracts a schema.org Recipe object from an HTML document's JSON-LD blocks.
 *
 * Handles:
 *   - top-level Recipe object
 *   - array of objects (multiple JSON-LD blocks per page)
 *   - `@graph` arrays (the common form embedded by SEO plugins)
 *   - `@type` being either a string or an array (`["Recipe", "Thing"]`)
 *
 * Returns the first Recipe-shaped object found, or null.
 */

export type JsonLdRecipe = Record<string, unknown>;

const SCRIPT_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function extractJsonLdRecipe(html: string): JsonLdRecipe | null {
  for (const match of html.matchAll(SCRIPT_RE)) {
    const raw = match[1].trim();
    if (raw.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Some sites template the script body in odd ways; skip rather than abort.
      continue;
    }
    const hit = findRecipe(parsed);
    if (hit) return hit;
  }
  return null;
}

function typeMatches(value: unknown, target: string): boolean {
  if (typeof value === "string") return value === target;
  if (Array.isArray(value)) return value.some((v) => v === target);
  return false;
}

function findRecipe(node: unknown): JsonLdRecipe | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecipe(child);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (typeMatches(obj["@type"], "Recipe")) {
    return obj as JsonLdRecipe;
  }
  // Recurse into `@graph` (the most common nesting) and any other arrays /
  // sub-objects, since SEO plugins occasionally nest a Recipe under a custom
  // key.
  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null) {
      const found = findRecipe(value);
      if (found) return found;
    }
  }
  return null;
}

// --- helpers for pulling typed values out of the loosely-typed Recipe object

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  Auml: "Ä",
  auml: "ä",
  Ouml: "Ö",
  ouml: "ö",
  Uuml: "Ü",
  uuml: "ü",
  szlig: "ß",
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) =>
      ENTITIES[name] !== undefined ? ENTITIES[name] : m,
    );
}

function clean(s: string): string {
  return decodeHtmlEntities(s).replace(/\s+/g, " ").trim();
}

export function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const cleaned = clean(v);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") {
    const cleaned = clean(v[0]);
    return cleaned.length > 0 ? cleaned : null;
  }
  return null;
}

/**
 * Extract a list of strings from a JSON-LD field that may be:
 *   - a single string
 *   - an array of strings
 *   - an array of `{ @type: "HowToStep", text: "..." }` objects
 *   - an array of `HowToSection` containing nested `itemListElement`
 *   - a single object of any of the above
 */
export function asStringList(v: unknown): string[] {
  const out: string[] = [];
  function visit(node: unknown) {
    if (node == null) return;
    if (typeof node === "string") {
      const s = clean(node);
      if (s.length > 0) out.push(s);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // HowToSection contains itemListElement
      if (Array.isArray(obj.itemListElement)) {
        visit(obj.itemListElement);
        return;
      }
      // HowToStep has `text`
      if (typeof obj.text === "string") {
        visit(obj.text);
        return;
      }
      if (typeof obj.name === "string") {
        visit(obj.name);
        return;
      }
    }
  }
  visit(v);
  return out;
}

/**
 * Recipe.image is one of:
 *   - "https://…/img.jpg"
 *   - ["https://…/a.jpg", "https://…/b.jpg"]
 *   - { "@type": "ImageObject", "url": "…" }
 *   - array of those
 * Return the first URL we can resolve.
 */
export function asImageUrl(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = asImageUrl(item);
      if (r) return r;
    }
    return null;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url.trim() || null;
    if (typeof obj["@id"] === "string") return (obj["@id"] as string).trim() || null;
  }
  return null;
}

/**
 * Recipe.recipeYield is "4", "4 Portionen", or a number. We just want a
 * positive integer; fall back to 1 if we can't extract one.
 */
export function asServings(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) {
    return Math.round(v);
  }
  if (Array.isArray(v) && v.length > 0) {
    return asServings(v[0]);
  }
  if (typeof v === "string") {
    const m = /(\d+)/.exec(v);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1) return n;
    }
  }
  return 1;
}

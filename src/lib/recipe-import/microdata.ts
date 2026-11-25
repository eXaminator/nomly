/**
 * Fallback for pages that mark their recipe up with schema.org **Microdata**
 * (`itemscope` / `itemtype` / `itemprop` attributes in the HTML) instead of a
 * JSON-LD block.
 *
 * The output has the same shape as a JSON-LD Recipe object, so the rest of
 * the import pipeline runs unchanged on it. Properties are collected per the
 * HTML Microdata spec: `itemref`, nested items, and the per-element value
 * rules (`content`, `datetime`, `src`, `href`, …). Two places need more than
 * the spec gives:
 *
 *  - Lists: Microdata has no array syntax. A single `recipeIngredient` /
 *    `recipeInstructions` element that wraps a whole list is split into its
 *    `<li>`s (or its lines/paragraphs); repeated elements are one entry each.
 *  - Sections: plain JSON-LD has `HowToSection`, Microdata pages usually
 *    just put a heading (`<h4>Füllung</h4>`) in front of each list. A
 *    heading directly before a list becomes that list's section title.
 *
 * Legacy vocabularies are accepted too: schema.org's deprecated
 * `ingredients` and the data-vocabulary.org Recipe (`ingredient`,
 * `instructions`, `yield`, `photo`, `summary`).
 */
import { parse, type HTMLElement, NodeType } from "node-html-parser";
import type { JsonLdRecipe } from "./json-ld.ts";

// ── element helpers ──

const WS = /\s+/g;

function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter(
    (n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE,
  );
}

function tagOf(el: HTMLElement): string {
  return (el.rawTagName ?? "").toUpperCase();
}

/** Text of an element, whitespace collapsed to single spaces. */
function flatText(el: HTMLElement): string {
  return el.structuredText.replace(WS, " ").trim();
}

/** Text of an element split on block boundaries and `<br>`. */
function textLines(el: HTMLElement): string[] {
  return el.structuredText
    .split("\n")
    .map((l) => l.replace(WS, " ").trim())
    .filter((l) => l.length > 0);
}

// h1 is the page/recipe title, never a section heading.
const SECTION_HEADING_TAGS = new Set(["H2", "H3", "H4", "H5", "H6"]);
const LIST_TAGS = new Set(["UL", "OL"]);

/** Section heading text without the trailing colon ("Füllung:" → "Füllung"). */
function headingTitle(el: HTMLElement): string | null {
  const t = flatText(el).replace(/\s*:\s*$/, "").trim();
  return t.length > 0 ? t : null;
}

/**
 * The section title for a block: an h2–h6 directly before it. A wrapper with
 * nothing else in it (`<div><ul>…</ul></div>` after the heading) is looked
 * through, so the heading still counts.
 */
function precedingHeading(block: HTMLElement): string | null {
  let el: HTMLElement | null = block;
  while (el) {
    const prev = el.previousElementSibling as HTMLElement | null;
    if (prev) {
      return SECTION_HEADING_TAGS.has(tagOf(prev)) ? headingTitle(prev) : null;
    }
    const parent = el.parentNode as HTMLElement | null;
    // Only climb out of a wrapper whose sole child is what we came from.
    if (!parent || elementChildren(parent).length !== 1) return null;
    el = parent;
  }
  return null;
}

/** `<li>`s that belong to this element's list(s), not to nested lists. */
function ownListItems(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: HTMLElement) => {
    for (const child of elementChildren(node)) {
      if (tagOf(child) === "LI") {
        out.push(child);
        continue; // a nested list inside an item is part of that item
      }
      walk(child);
    }
  };
  walk(el);
  return out;
}

// ── Microdata item model (per the WHATWG HTML Microdata spec) ──

type MicrodataProperty = { name: string; element: HTMLElement };

function attr(el: HTMLElement, name: string): string | null {
  const v = el.getAttribute(name);
  return v == null ? null : v;
}

function tokens(v: string | null): string[] {
  return (v ?? "").split(WS).filter((t) => t.length > 0);
}

/** "https://schema.org/recipeIngredient" → "recipeIngredient". */
function shortName(token: string): string {
  const m = /[/#]([^/#]+)$/.exec(token);
  return m ? m[1] : token;
}

function itemTypes(el: HTMLElement): string[] {
  return tokens(attr(el, "itemtype")).map(shortName);
}

function isItem(el: HTMLElement): boolean {
  return el.hasAttribute("itemscope");
}

/**
 * The properties of the item rooted at `item`, in document order. Descends
 * into everything except nested items (their properties are their own) and
 * follows `itemref` to elements elsewhere in the page.
 */
function itemProperties(
  item: HTMLElement,
  root: HTMLElement,
): MicrodataProperty[] {
  const out: MicrodataProperty[] = [];
  const seen = new Set<HTMLElement>();
  const visit = (el: HTMLElement) => {
    if (seen.has(el)) return;
    seen.add(el);
    for (const name of tokens(attr(el, "itemprop"))) {
      out.push({ name: shortName(name), element: el });
    }
    if (isItem(el)) return;
    for (const child of elementChildren(el)) visit(child);
  };
  seen.add(item);
  for (const child of elementChildren(item)) visit(child);
  for (const id of tokens(attr(item, "itemref"))) {
    const ref = root.getElementById(id);
    if (ref) visit(ref);
  }
  return out;
}

const URL_ELEMENTS = new Set([
  "AUDIO",
  "EMBED",
  "IFRAME",
  "IMG",
  "SOURCE",
  "TRACK",
  "VIDEO",
]);

/** First usable URL of a (possibly lazy-loaded) media element. */
function mediaUrl(el: HTMLElement): string | null {
  const src = attr(el, "src")?.trim();
  if (src && !src.startsWith("data:")) return src;
  for (const lazy of ["data-src", "data-lazy-src", "data-original"]) {
    const v = attr(el, lazy)?.trim();
    if (v) return v;
  }
  const srcset = attr(el, "srcset") ?? attr(el, "data-srcset");
  const first = srcset?.split(",")[0]?.trim().split(WS)[0];
  return first || null;
}

/** The string value of a non-item property element (Microdata value rules). */
function propertyValue(el: HTMLElement): string {
  // `content` is the spec's rule for <meta>; sites use it on any element.
  const content = attr(el, "content");
  if (content != null) return content;
  const tag = tagOf(el);
  if (URL_ELEMENTS.has(tag)) return mediaUrl(el) ?? "";
  if (tag === "A" || tag === "AREA" || tag === "LINK") {
    return attr(el, "href") ?? "";
  }
  if (tag === "OBJECT") return attr(el, "data") ?? "";
  if (tag === "DATA" || tag === "METER") return attr(el, "value") ?? "";
  if (tag === "TIME") return attr(el, "datetime") ?? flatText(el);
  return flatText(el);
}

const MAX_DEPTH = 6;

/** A nested item as a JSON-LD-like object. */
function itemToObject(
  item: HTMLElement,
  root: HTMLElement,
  depth: number,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const types = itemTypes(item);
  if (types.length > 0) obj["@type"] = types.length === 1 ? types[0] : types;
  for (const { name, element } of itemProperties(item, root)) {
    const value =
      isItem(element) && depth < MAX_DEPTH
        ? itemToObject(element, root, depth + 1)
        : propertyValue(element);
    const prev = obj[name];
    if (prev === undefined) obj[name] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else obj[name] = [prev, value];
  }
  return obj;
}

// ── Recipe-specific normalization ──

/** Legacy property names → the schema.org names the importer reads. */
const ALIASES: Record<string, string> = {
  ingredients: "recipeIngredient", // schema.org, deprecated
  ingredient: "recipeIngredient", // data-vocabulary.org
  instructions: "recipeInstructions", // data-vocabulary.org
  yield: "recipeYield", // data-vocabulary.org
  photo: "image", // data-vocabulary.org
  summary: "description", // data-vocabulary.org
};

function canonicalName(name: string): string {
  return ALIASES[name] ?? name;
}

/** The first element on the page typed as a Recipe (any vocabulary). */
export function findMicrodataRecipeElement(
  root: HTMLElement,
): HTMLElement | null {
  for (const el of root.querySelectorAll("[itemscope]")) {
    if (itemTypes(el).includes("Recipe")) return el;
  }
  return null;
}

function recipePropertyElements(
  recipeEl: HTMLElement,
  root: HTMLElement,
  name: string,
): HTMLElement[] {
  return itemProperties(recipeEl, root)
    .filter((p) => canonicalName(p.name) === name)
    .map((p) => p.element);
}

/** One ingredient/step entry together with the block it sits in. */
type ListEntry = { text: string; block: HTMLElement };

/**
 * Turn a property's elements into list entries. Several elements: one entry
 * each (an `<li itemprop="recipeIngredient">` per line). One element: it
 * wraps the whole list, so split it into its `<li>`s, or its lines.
 */
function listEntries(elements: HTMLElement[]): ListEntry[] {
  const entryBlock = (el: HTMLElement): HTMLElement => {
    const parent = el.parentNode as HTMLElement | null;
    return tagOf(el) === "LI" && parent && LIST_TAGS.has(tagOf(parent))
      ? parent
      : el;
  };
  if (elements.length === 1) {
    const el = elements[0];
    const items = ownListItems(el);
    if (items.length > 0) {
      return items
        .map((li) => ({ text: flatText(li), block: entryBlock(li) }))
        .filter((e) => e.text.length > 0);
    }
    return textLines(el).map((text) => ({ text, block: el }));
  }
  return elements
    .map((el) => ({ text: flatText(el), block: entryBlock(el) }))
    .filter((e) => e.text.length > 0);
}

export type MicrodataGroup = { title: string | null; items: string[] };

/** Consecutive entries sharing a block form one group, titled by the heading before it. */
function groupEntries(entries: ListEntry[]): MicrodataGroup[] {
  const groups: MicrodataGroup[] = [];
  let lastBlock: HTMLElement | null = null;
  for (const e of entries) {
    if (e.block !== lastBlock) {
      groups.push({ title: precedingHeading(e.block), items: [] });
      lastBlock = e.block;
    }
    groups[groups.length - 1].items.push(e.text);
  }
  return groups;
}

/** Ingredient lines of a Microdata recipe, grouped by the lists they sit in. */
function ingredientGroups(
  recipeEl: HTMLElement,
  root: HTMLElement,
): MicrodataGroup[] {
  return groupEntries(
    listEntries(recipePropertyElements(recipeEl, root, "recipeIngredient")),
  );
}

/** Step texts inside one `recipeInstructions` element. */
function instructionSteps(el: HTMLElement, root: HTMLElement): string[] {
  // HowToSection / HowToStep items, or a plain container whose step <li>s
  // carry `itemprop="step"` / `itemListElement` (both are schema.org's
  // names for the steps of a HowTo).
  const stepEls = (
    isItem(el)
      ? itemProperties(el, root)
      : el.querySelectorAll("[itemprop]").map((e) => ({
          name: shortName(tokens(attr(e, "itemprop"))[0] ?? ""),
          element: e,
        }))
  )
    .filter((p) => p.name === "step" || p.name === "itemListElement")
    .map((p) => p.element);
  if (stepEls.length > 0) {
    return stepEls
      .map((s) => {
        if (isItem(s)) {
          const textProp = itemProperties(s, root).find(
            (p) => p.name === "text",
          );
          if (textProp) return propertyValue(textProp.element);
        }
        return flatText(s);
      })
      .map((t) => t.replace(WS, " ").trim())
      .filter((t) => t.length > 0);
  }
  if (isItem(el)) {
    const textProp = itemProperties(el, root).find((p) => p.name === "text");
    if (textProp) return [propertyValue(textProp.element)];
  }
  const items = ownListItems(el);
  if (items.length > 0) {
    return items.map(flatText).filter((t) => t.length > 0);
  }
  return textLines(el);
}

/** `recipeInstructions` as JSON-LD: flat strings, or HowToSections when titled. */
function instructionsValue(
  recipeEl: HTMLElement,
  root: HTMLElement,
): unknown {
  const elements = recipePropertyElements(recipeEl, root, "recipeInstructions");
  if (elements.length === 0) return undefined;

  // One step per element (`<li itemprop="recipeInstructions">`): the list
  // around them is the section.
  const onePerElement =
    elements.length > 1 && elements.every((el) => tagOf(el) === "LI");
  const groups: MicrodataGroup[] = [];
  if (onePerElement) {
    groups.push(...groupEntries(listEntries(elements)));
  } else {
    for (const el of elements) {
      const steps = instructionSteps(el, root);
      if (steps.length === 0) continue;
      let title: string | null = null;
      if (isItem(el)) {
        const nameProp = itemProperties(el, root).find((p) => p.name === "name");
        if (nameProp) title = propertyValue(nameProp.element).trim() || null;
      }
      title ??= precedingHeading(el);
      groups.push({ title, items: steps });
    }
  }
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  if (nonEmpty.every((g) => g.title === null)) {
    return nonEmpty.flatMap((g) => g.items);
  }
  return nonEmpty.map((g) => ({
    "@type": "HowToSection",
    ...(g.title !== null ? { name: g.title } : {}),
    itemListElement: g.items.map((text) => ({ "@type": "HowToStep", text })),
  }));
}

/** An image property: a URL string, or an ImageObject's url/contentUrl. */
function imageValue(el: HTMLElement, root: HTMLElement): string | null {
  if (isItem(el)) {
    const props = itemProperties(el, root);
    const url = props.find((p) => p.name === "url" || p.name === "contentUrl");
    return url ? propertyValue(url.element).trim() || null : null;
  }
  const tag = tagOf(el);
  if (attr(el, "content") != null || URL_ELEMENTS.has(tag) || tag === "LINK" || tag === "A") {
    return propertyValue(el).trim() || null;
  }
  // itemprop="image" on a wrapper (<picture>, <div>): use the image inside.
  const img = el.querySelector("img");
  return img ? mediaUrl(img) : null;
}

function ogImage(root: HTMLElement): string | null {
  const meta = root
    .querySelectorAll("meta")
    .find((m) => (attr(m, "property") ?? attr(m, "name")) === "og:image");
  return (meta && attr(meta, "content")?.trim()) || null;
}

/**
 * Extract a schema.org Recipe from the page's Microdata, shaped like the
 * JSON-LD object the importer already understands. Returns null when the
 * page has no Recipe item or the item has neither ingredients nor steps.
 */
export function extractMicrodataRecipe(html: string): JsonLdRecipe | null {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return null;
  }
  const recipeEl = findMicrodataRecipeElement(root);
  if (!recipeEl) return null;

  const recipe: JsonLdRecipe = { "@type": "Recipe" };
  for (const { name: rawName, element } of itemProperties(recipeEl, root)) {
    const name = canonicalName(rawName);
    // Handled separately below: they need list/section structure, not
    // one value per element.
    if (
      name === "recipeIngredient" ||
      name === "recipeInstructions" ||
      name === "image" ||
      name === "step"
    ) {
      continue;
    }
    const value = isItem(element)
      ? itemToObject(element, root, 1)
      : propertyValue(element);
    const prev = recipe[name];
    if (prev === undefined) recipe[name] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else recipe[name] = [prev, value];
  }

  const ingredients = ingredientGroups(recipeEl, root).flatMap((g) => g.items);
  if (ingredients.length > 0) recipe.recipeIngredient = ingredients;

  const instructions = instructionsValue(recipeEl, root);
  if (instructions !== undefined) recipe.recipeInstructions = instructions;

  const image =
    recipePropertyElements(recipeEl, root, "image")
      .map((el) => imageValue(el, root))
      .find((u): u is string => !!u) ?? ogImage(root);
  if (image) recipe.image = image;

  const hasContent =
    ingredients.length > 0 ||
    (Array.isArray(instructions) && instructions.length > 0);
  return hasContent ? recipe : null;
}

/**
 * Ingredient groups from Microdata markup: each list of `recipeIngredient`
 * elements is a group, titled by the heading right before it. Same item
 * order as {@link extractMicrodataRecipe}'s `recipeIngredient`, so the
 * groups align 1:1 with those lines.
 */
export function extractMicrodataIngredientGroups(
  root: HTMLElement,
): MicrodataGroup[] | null {
  const recipeEl = findMicrodataRecipeElement(root);
  if (!recipeEl) return null;
  const groups = ingredientGroups(recipeEl, root);
  // A single list carries no grouping, even when a heading ("Zutaten")
  // sits in front of it.
  return groups.length > 1 ? groups : null;
}

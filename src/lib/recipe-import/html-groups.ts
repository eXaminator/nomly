/**
 * Ingredient-group extraction from recipe-plugin HTML markup.
 *
 * schema.org's `recipeIngredient` is a flat string list — group headers
 * ("For the sauce") exist only in the plugin's HTML. The extractors below
 * read those boundaries for the three dominant WordPress recipe plugins.
 * Extracted item text is used for ALIGNMENT ONLY: `alignHtmlGroupsToLines`
 * maps the titles onto the canonical JSON-LD strings and refuses on any
 * count mismatch, so a wrong parse can never corrupt an import — at worst
 * the grouping is skipped.
 */
import { parse, type HTMLElement, NodeType } from "node-html-parser";

export type HtmlIngredientGroup = {
  /** Group heading text (null = unnamed lead group before the first heading). */
  title: string | null;
  items: string[];
};

export function extractIngredientGroupsFromHtml(
  html: string,
): HtmlIngredientGroup[] | null {
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return null;
  }
  for (const extract of [extractWprm, extractTasty, extractMvCreate]) {
    let groups: HtmlIngredientGroup[] | null;
    try {
      groups = extract(root);
    } catch {
      groups = null;
    }
    if (!groups) continue;
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const hasTitle = groups.some((g) => g.title !== null);
    // A single untitled blob carries no grouping information.
    if (total === 0 || !hasTitle) continue;
    return groups;
  }
  return null;
}

/**
 * Map plugin-extracted group boundaries onto the canonical JSON-LD
 * ingredient strings. The HTML contributes titles and counts only — the
 * JSON-LD text is what the ingredient parser is tuned for. Returns null
 * whenever the counts disagree; grouping is then skipped, never guessed.
 */
export function alignHtmlGroupsToLines(
  groups: readonly HtmlIngredientGroup[],
  lines: readonly string[],
): { title: string | null; lines: string[] }[] | null {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0 || total !== lines.length) return null;
  const out: { title: string | null; lines: string[] }[] = [];
  let offset = 0;
  for (const g of groups) {
    out.push({
      title: g.title,
      lines: lines.slice(offset, offset + g.items.length),
    });
    offset += g.items.length;
  }
  return out;
}

// ── shared helpers ──

const WS = /\s+/g;

function textOf(el: HTMLElement): string {
  return el.text.replace(WS, " ").trim();
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter(
    (n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE,
  );
}

function tagOf(el: HTMLElement): string {
  // rawTagName preserves source case (lowercase for normal HTML); tagName
  // getter returns uppercase. Use rawTagName + toUpperCase() for safety.
  return (el.rawTagName ?? "").toUpperCase();
}

// h1 intentionally excluded: that's the page/card title, never a sub-group.
const HEADING_TAGS = new Set(["H2", "H3", "H4", "H5", "H6"]);

/**
 * Walk a container whose structure alternates heading elements and <ul>/<ol>
 * lists (possibly nested in wrapper divs): each accepted heading starts a
 * new group, each list contributes its <li>s to the current group. Items
 * before the first heading land in an unnamed lead group.
 */
function groupsFromHeadingsAndLists(
  container: HTMLElement,
  acceptHeading: (el: HTMLElement) => boolean,
): HtmlIngredientGroup[] {
  const groups: HtmlIngredientGroup[] = [{ title: null, items: [] }];
  const walk = (el: HTMLElement) => {
    for (const child of elementChildren(el)) {
      const tag = tagOf(child);
      if (HEADING_TAGS.has(tag)) {
        if (acceptHeading(child)) {
          groups.push({ title: textOf(child) || null, items: [] });
        }
        continue;
      }
      if (tag === "UL" || tag === "OL") {
        for (const li of elementChildren(child)) {
          if (tagOf(li) !== "LI") continue;
          const t = textOf(li);
          if (t.length > 0) groups[groups.length - 1].items.push(t);
        }
        continue;
      }
      walk(child);
    }
  };
  walk(container);
  if (
    groups.length > 1 &&
    groups[0].title === null &&
    groups[0].items.length === 0
  ) {
    groups.shift();
  }
  return groups;
}

// ── WP Recipe Maker ──
// <div class="wprm-recipe-ingredient-group">
//   <h4 class="wprm-recipe-group-name wprm-recipe-ingredient-group-name">…</h4>
//   <ul><li class="wprm-recipe-ingredient">
//     <span class="wprm-recipe-ingredient-amount">…</span> …
// CAUTION: `wprm-recipe-group-name` is ALSO on instruction-group headings —
// only the ingredient-group container scopes correctly.
function extractWprm(root: HTMLElement): HtmlIngredientGroup[] | null {
  // Scope to the first card so a second card or print/fallback copy can't
  // double the groups. Themes without the container class fall back to the
  // whole document — if that ever mixes cards, the count gate in
  // alignHtmlGroupsToLines rejects the result rather than mis-grouping.
  const container = root.querySelector(".wprm-recipe-container") ?? root;
  const groupEls = container.querySelectorAll(".wprm-recipe-ingredient-group");
  if (groupEls.length === 0) return null;
  return groupEls.map((groupEl) => {
    const titleEl = groupEl.querySelector(".wprm-recipe-ingredient-group-name");
    const items = groupEl
      .querySelectorAll("li.wprm-recipe-ingredient")
      .map(wprmIngredientText)
      .filter((s) => s.length > 0);
    return { title: titleEl ? textOf(titleEl) || null : null, items };
  });
}

function wprmIngredientText(li: HTMLElement): string {
  // The amount/unit/name/notes spans are the content; everything else in the
  // <li> is checkbox UI noise.
  const parts = li
    .querySelectorAll(
      ".wprm-recipe-ingredient-amount, .wprm-recipe-ingredient-unit, .wprm-recipe-ingredient-name, .wprm-recipe-ingredient-notes",
    )
    .map(textOf)
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(" ") : textOf(li);
}

// ── Tasty Recipes ──
// <div class="tasty-recipes-ingredients">
//   <div class="tasty-recipes-ingredients-header"><h3>Ingredients</h3></div>
//   <div class="tasty-recipes-ingredients-body">
//     <ul><li data-tr-ingredient-checkbox>…</li></ul>
//     <h4>Group</h4><ul>…</ul>
function extractTasty(root: HTMLElement): HtmlIngredientGroup[] | null {
  const container =
    root.querySelector(".tasty-recipes-ingredients-body") ??
    root.querySelector(".tasty-recipes-ingredients");
  if (!container) return null;
  // Older themes lack the -body wrapper; the card's own "Ingredients"
  // heading then sits inside the header div — skip that subtree.
  return groupsFromHeadingsAndLists(
    container,
    (h) => h.closest(".tasty-recipes-ingredients-header") === null,
  );
}

// ── Mediavine Create ──
// <div class="mv-create-ingredients">
//   <h3 class="mv-create-ingredients-title">Ingredients</h3>
//   <h4>Group</h4><ul><li>…</li></ul>
function extractMvCreate(root: HTMLElement): HtmlIngredientGroup[] | null {
  const container = root.querySelector(".mv-create-ingredients");
  if (!container) return null;
  return groupsFromHeadingsAndLists(
    container,
    (h) => !h.classList.contains("mv-create-ingredients-title"),
  );
}

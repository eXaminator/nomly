/**
 * Pure DOM → FamilywallRawRecipe extraction. Operates on a `Document` so
 * the same code runs in:
 *  - the live browser (via Playwright's `page.evaluate`, evaluating against
 *    the real page), and
 *  - Node (against a jsdom-parsed cached snapshot).
 *
 * Uses only `Document` / `Element` / `HTMLElement` APIs available in both
 * environments. `textContent` instead of `innerText` so whitespace handling
 * is consistent (we collapse with `replace(/\s+/g, " ")` anyway).
 */

import type { FamilywallRawRecipe } from "./types.ts";

const PREP_LABELS = new Set([
  "Zubereitungszeit",
  "Vorbereitungszeit",
  "Prep time",
  "Preparation time",
]);
const COOK_LABELS = new Set(["Kochzeit", "Cook time", "Cooking time"]);
const SERVING_LABELS = new Set([
  "Portionen",
  "Servings",
  "Portions",
  "Personen",
]);
const SOURCE_LABELS = new Set([
  "Ansehen auf",
  "View on",
  "Source",
  "Quelle",
]);

function txt(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function parseMins(t: string): number | null {
  const trimmed = t.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const hMatch = /(\d+)\s*h/i.exec(trimmed);
  const mMatch = /(\d+)\s*(?:mins?|min\.?|Min(?:uten)?)/i.exec(trimmed);
  const h = hMatch ? parseInt(hMatch[1], 10) : 0;
  const m = mMatch ? parseInt(mMatch[1], 10) : 0;
  if (h === 0 && m === 0) {
    const justNum = /^(\d+)$/.exec(trimmed);
    return justNum ? parseInt(justNum[1], 10) : null;
  }
  return h * 60 + m;
}

export function extractRawRecipeFromDocument(
  doc: Document,
): FamilywallRawRecipe | null {
  const detail = doc.getElementById("recipeDetail");
  if (!detail) return null;

  const titleEl = detail.querySelector(".h1.line, flexauto.h1, .h1");
  const title = txt(titleEl);
  if (!title) return null;

  const imgEl = detail.querySelector(
    ".mp-recipe-header-imgcontainer img",
  ) as Element | null;
  const imageUrl = imgEl?.getAttribute("src") || null;

  // Favorite ("bester Moment") — the heart icon's title swaps between
  // "Als bester Moment gekennzeichnet" (marked) and "Mir gefällt dieser
  // Post" (unmarked), so the title alone tells us the state.
  let isFavorite = false;
  for (const icon of Array.from(detail.querySelectorAll("icon"))) {
    const t = icon.getAttribute("title") || "";
    if (
      t === "Als bester Moment gekennzeichnet" ||
      t === "Marked as best moment"
    ) {
      isFavorite = true;
      break;
    }
  }

  // Category chips become tags. Familywall prefixes each with an emoji
  // (e.g. "🍚 Reis"); strip leading emoji + whitespace so the resulting
  // tags match plain user-created ones.
  const tags = Array.from(detail.querySelectorAll(".mp-category"))
    .map((el) => txt(el))
    .map((t) =>
      t.replace(/^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]+\s*/u, "").trim(),
    )
    .filter((t) => t.length > 0);

  let prepTimeMin: number | null = null;
  let cookTimeMin: number | null = null;
  let servings: number | null = null;
  let sourceUrl: string | null = null;

  const timesTable = detail.querySelector(".mp-recipe-times");
  if (timesTable) {
    for (const row of Array.from(timesTable.querySelectorAll("tr"))) {
      const cells = Array.from(row.querySelectorAll("td"));
      const labelCell = cells.find((c) =>
        c.classList.contains("recipe-field-name"),
      );
      if (!labelCell) continue;
      const valueCell = labelCell.nextElementSibling;
      if (!valueCell) continue;
      const label = txt(labelCell);
      const valueText = txt(valueCell);
      if (PREP_LABELS.has(label)) {
        prepTimeMin = parseMins(valueText);
      } else if (COOK_LABELS.has(label)) {
        cookTimeMin = parseMins(valueText);
      } else if (SERVING_LABELS.has(label)) {
        const n = /(\d+)/.exec(valueText);
        servings = n ? parseInt(n[1], 10) : null;
      } else if (SOURCE_LABELS.has(label)) {
        const link = valueCell.querySelector("a");
        const href = link?.getAttribute("href");
        if (href) sourceUrl = href;
      }
    }
  }

  function sectionContent(headingTexts: string[]): Element[] {
    for (const ht of headingTexts) {
      const heading = Array.from(detail!.querySelectorAll("p")).find(
        (p) => txt(p) === ht,
      );
      if (!heading) continue;
      const container = heading.parentElement;
      if (!container) continue;
      return Array.from(container.children).filter(
        (c) =>
          c !== heading &&
          !c.classList.contains("rb-button") &&
          !c.classList.contains("mp-button-like"),
      );
    }
    return [];
  }

  const descParts = sectionContent(["Beschreibung", "Description"])
    .map((el) => txt(el))
    .filter(Boolean);
  const description = descParts.length ? descParts.join("\n\n") : null;

  function listItemsFrom(els: Element[]): string[] {
    const out: string[] = [];
    for (const el of els) {
      if (el.tagName === "UL" || el.tagName === "OL") {
        for (const li of Array.from(el.querySelectorAll("li"))) {
          const t = txt(li);
          if (t) out.push(t);
        }
      } else {
        // Some recipes free-text the section. textContent doesn't preserve
        // line breaks for <br> elements automatically — use a normalised
        // snapshot of the raw text with newlines from <br>s.
        const raw = textWithBreaks(el);
        for (const line of raw.split(/\r?\n/)) {
          const t = line.replace(/\s+/g, " ").trim();
          if (t) out.push(t);
        }
      }
    }
    return out;
  }

  const ingredients = listItemsFrom(sectionContent(["Zutaten", "Ingredients"]));
  const instructions = listItemsFrom(
    sectionContent(["Anweisungen", "Zubereitung", "Instructions", "Steps"]),
  );

  return {
    title,
    description,
    servings,
    prepTimeMin,
    cookTimeMin,
    ingredients,
    instructions,
    imageUrl,
    sourceUrl,
    isFavorite,
    tags,
  };
}

/**
 * `textContent` skips <br> entirely (no newline). For free-text sections
 * we want each <br> to count as a paragraph break so list-items-from
 * splits correctly. Walks the node tree and inserts "\n" at every <br>.
 */
function textWithBreaks(el: Element): string {
  const parts: string[] = [];
  walk(el, parts);
  return parts.join("");
}

function walk(node: Node, parts: string[]): void {
  if (node.nodeType === 3) {
    // text node
    parts.push(node.nodeValue ?? "");
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (el.tagName === "BR") {
    parts.push("\n");
    return;
  }
  for (const child of Array.from(el.childNodes)) {
    walk(child, parts);
  }
  // Treat block-level elements as paragraph breaks too.
  if (/^(P|DIV|LI|TR|FLEXROW|FLEXAUTO|FLEXCOL)$/.test(el.tagName)) {
    parts.push("\n");
  }
}

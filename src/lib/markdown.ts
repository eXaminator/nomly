import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

marked.setOptions({ breaks: true, gfm: true });

/**
 * Render a user-supplied markdown string to a safe HTML fragment.
 * Returns `null` for empty/whitespace input so the caller can decide whether
 * to skip rendering the block entirely.
 */
export function renderMarkdown(input: string | null | undefined): string | null {
  if (!input || input.trim().length === 0) return null;
  const html = marked.parse(input, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

const MIN_MENTION_LENGTH = 2;
/**
 * Below this length a spelling may only pick up a plural-ish suffix, never an
 * arbitrary compound tail. The open-ended tail is what lets "Zwiebel" cover
 * "Zwiebeln" and "Knoblauch" cover "Knoblauchzehen", but on a two-letter
 * spelling it also swallows filler: "Ei" would light up every "Eine",
 * "Einen", "Eingeweichte" in the prose.
 */
const SHORT_SPELLING_LENGTH = 4;
/** Inflection endings a short spelling may take ("Ei" → "Eier", "Öl" →
 *  "Öle"), anchored at a word end so nothing longer sneaks through. */
const SHORT_SPELLING_SUFFIX = "(?:e|n|s|en|er|es)?(?![\\p{L}])";
/** Tags whose text content must never be highlighted (code samples, anchor
 *  labels). Matching inside these would either corrupt code or fight with the
 *  link styling. */
const SKIP_TAGS = new Set(["code", "pre", "a"]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** One ingredient to detect in instruction text. */
export type IngredientMention = {
  /** Every spelling that should match this ingredient — display name,
   *  canonical name, and accrued aliases. */
  spellings: string[];
  /** Opaque identifier echoed back as the `data-mention` attribute so the
   *  client tooltip can resolve the matched word to its ingredient. Empty
   *  string → underline only, no tooltip / no focus target. */
  id: string;
};

/**
 * Underline mentions of the given ingredients in the HTML produced by
 * {@link renderMarkdown}, wrapping each in
 * `<span class="ingredient-mention" data-mention="…">`. The CSS gives them a
 * dotted accent underline; a client component resolves `data-mention` to the
 * ingredient and shows a rich tooltip on hover/focus. `tabindex` makes the span
 * tap-focusable on touch devices.
 *
 * Matching is case-insensitive, anchored at a word start, and extends across
 * trailing letters — so a stored singular ("Zwiebel") highlights the whole
 * inflected word as it appears ("Zwiebeln") without firing mid-word ("zwei").
 * Spellings shorter than {@link SHORT_SPELLING_LENGTH} only take a plural
 * ending, so they can't swallow filler words. Spellings are matched
 * longest-first so a compound ("Tomatenmark") wins over a prefix ("Tomate")
 * and resolves to the right id. Text inside `<code>`/`<pre>`/`<a>` and HTML
 * tags/attributes is left untouched.
 *
 * The HTML is assumed already sanitized (entities escaped, well-formed tags) as
 * it comes from {@link renderMarkdown}; the inserted markup is a fixed safe
 * `<span>` and the id is attribute-escaped, so no re-sanitization is needed.
 */
export function highlightIngredientMentions(
  html: string,
  mentions: readonly IngredientMention[],
): string {
  // spellingLower → mention id. First spelling wins on collision.
  const idBySpelling = new Map<string, string>();
  for (const { spellings, id } of mentions) {
    for (const raw of spellings) {
      const spelling = raw?.trim();
      if (!spelling || spelling.length < MIN_MENTION_LENGTH) continue;
      const key = spelling.toLowerCase();
      if (!idBySpelling.has(key)) idBySpelling.set(key, id ?? "");
    }
  }
  if (idBySpelling.size === 0) return html;

  // Longest-first so the regex alternation prefers the more specific spelling
  // at a given position ("Tomatenmark" before "Tomate"), and so the per-match
  // lookup below resolves to that same spelling.
  const spellingsByLength = [...idBySpelling.keys()].sort(
    (a, b) => b.length - a.length,
  );
  // Two branches, long spellings first so the more specific one wins at a
  // given position: a long spelling absorbs whatever letters follow (German
  // compounds/inflections), a short one only a plural ending.
  const branches: string[] = [];
  const long = spellingsByLength.filter((s) => s.length >= SHORT_SPELLING_LENGTH);
  const short = spellingsByLength.filter((s) => s.length < SHORT_SPELLING_LENGTH);
  if (long.length > 0) {
    branches.push(`(?:${long.map(escapeRegex).join("|")})[\\p{L}]*`);
  }
  if (short.length > 0) {
    branches.push(
      `(?:${short.map(escapeRegex).join("|")})${SHORT_SPELLING_SUFFIX}`,
    );
  }
  const mention = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${branches.join("|")})`,
    "giu",
  );

  const wrap = (match: string): string => {
    const lower = match.toLowerCase();
    const spelling = spellingsByLength.find((s) => lower.startsWith(s));
    const id = spelling ? idBySpelling.get(spelling) : undefined;
    if (!id) return `<span class="ingredient-mention">${match}</span>`;
    return `<span class="ingredient-mention" tabindex="0" data-mention="${escapeHtmlAttr(
      id,
    )}">${match}</span>`;
  };

  // marked + DOMPurify escape literal `<`/`>` in text to entities, so splitting
  // on `<...>` cleanly separates tags (odd indices) from text (even indices).
  const parts = html.split(/(<[^>]*>)/);
  let skipDepth = 0;
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        const tag = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(part);
        if (tag && SKIP_TAGS.has(tag[2].toLowerCase())) {
          const isClosing = tag[1] === "/";
          const selfClosing = /\/\s*>$/.test(part);
          if (isClosing) skipDepth = Math.max(0, skipDepth - 1);
          else if (!selfClosing) skipDepth += 1;
        }
        return part;
      }
      if (skipDepth > 0 || part.length === 0) return part;
      return part.replace(mention, wrap);
    })
    .join("");
}

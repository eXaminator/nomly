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

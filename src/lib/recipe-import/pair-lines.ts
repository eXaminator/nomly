import { parseSegment } from "./ast/parse-line.ts";

/**
 * Split a clipboard blob into one cell per line. Newlines AND tabs become
 * line breaks — tabs are how table cells separate when copied from
 * <table> markup. List bullets ("- ", "• ", "* ") that paste-from-web
 * commonly leaves behind get stripped.
 */
export function splitClipboardToLines(text: string): string[] {
  return text
    .split(/[\r\n\t]+/)
    .map((line) => line.replace(/^\s*[-*•·]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function classifyLine(
  line: string,
  knownUnitTokens: ReadonlySet<string>,
): "quantity-only" | "name-only" | "complete" {
  const parsed = parseSegment(line, { knownUnitTokens, catalog: [] });
  const hasName = parsed.name.trim().length > 0;
  const hasQuantity = parsed.quantity !== null;
  if (hasQuantity && !hasName) return "quantity-only";
  if (!hasQuantity && hasName) return "name-only";
  return "complete";
}

/**
 * A name-only line that looks like its own ingredient — one or two short
 * Title-Cased words, no digits. Used to keep "Salz" / "Rapsöl" / "Pfeffer"
 * separate when they trail a paired (quantity + name) row, instead of
 * collapsing them into the previous row's notes.
 */
function looksStandalone(line: string): boolean {
  return /^\p{Lu}[\p{L}()ß]{0,30}(?:\s\p{Lu}[\p{L}()ß]{0,30})?$/u.test(
    line.trim(),
  );
}

/**
 * Pair quantity-only lines with the following name-only line(s) so the
 * per-ingredient parser receives a single coherent input. Table-pasted
 * recipe lists (chefkoch et al.) emit one cell per line; we glue them back
 * together here before handing off.
 *
 * Behaviour:
 *  - "complete" lines (already quantity + name on the same line) pass through.
 *  - A "quantity-only" line starts a buffer; the next "name-only" line
 *    becomes its name.
 *  - Subsequent "name-only" lines either get folded in as comma-joined
 *    notes, OR (if they look like a fresh ingredient name on their own)
 *    are pushed as standalone entries.
 *  - "name-only" lines with no preceding quantity buffer pass through as
 *    standalone entries.
 */
export function pairTableLines(
  lines: readonly string[],
  knownUnitTokens: ReadonlySet<string>,
): string[] {
  const result: string[] = [];
  let buffer: string | null = null;
  let bufferHasName = false;
  const flush = () => {
    if (buffer !== null) result.push(buffer);
    buffer = null;
    bufferHasName = false;
  };
  for (const line of lines) {
    const kind = classifyLine(line, knownUnitTokens);
    if (kind === "quantity-only") {
      flush();
      buffer = line;
      bufferHasName = false;
      continue;
    }
    if (kind === "complete") {
      flush();
      result.push(line);
      continue;
    }
    if (buffer === null) {
      result.push(line);
    } else if (!bufferHasName) {
      buffer = `${buffer} ${line}`;
      bufferHasName = true;
    } else if (looksStandalone(line)) {
      flush();
      result.push(line);
    } else {
      buffer = `${buffer}, ${line}`;
    }
  }
  flush();
  return result;
}

/**
 * One-off: walk the family wall cache, extract ingredient lines from every
 * cached detail.html, and print the unique set. Used as input for the
 * LLM-blessed "ideal parse" golden test.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

import { extractRawRecipeFromDocument } from "../src/lib/familywall/extract.ts";

const ROOT = "data/familywall-cache/recipes";

const all = new Set<string>();
let recipes = 0;
let failed = 0;
for (const dir of readdirSync(ROOT)) {
  const htmlPath = join(ROOT, dir, "detail.html");
  let html: string;
  try {
    html = readFileSync(htmlPath, "utf8");
  } catch {
    continue;
  }
  const dom = new JSDOM(html);
  const raw = extractRawRecipeFromDocument(dom.window.document);
  if (!raw) {
    failed += 1;
    continue;
  }
  recipes += 1;
  for (const line of raw.ingredients) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (trimmed) all.add(trimmed);
  }
}

console.error(`# recipes: ${recipes}, failed: ${failed}, unique lines: ${all.size}`);
for (const line of [...all].sort((a, b) => a.localeCompare(b, "de"))) {
  console.log(line);
}

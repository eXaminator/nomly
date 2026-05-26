/**
 * Probe how the parser handles colon-bearing ingredient lines in the
 * familywall cache. Dumps each problematic line + how the expansion +
 * parser handle it, so we can sanity-check the colon-handling rules.
 *
 * Usage: node scripts/scan-colon-ingredient-lines.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  expandIngredientLine,
  parseIngredientString,
} from "../src/lib/recipe-import/ingredient.ts";

const ROOT = path.resolve(
  "/Users/sweingaertner/Sites/private/projects/mealplaner/data/familywall-cache/recipes",
);
const entries = await fs.readdir(ROOT);

const TEST_UNITS = new Set(
  [
    "g", "kg", "mg", "gramm", "ml", "cl", "dl", "l", "el", "tl", "esslöffel",
    "teelöffel", "cup", "cups", "tasse", "tassen", "tsp", "teaspoon",
    "teaspoons", "tbsp", "tablespoon", "tablespoons", "pkg", "pck", "packung",
    "päckchen", "dose", "dosen", "stück", "stk", "bund", "bündel", "bunch",
    "handvoll", "prise", "prisen", "messerspitze", "msp", "zoll", "inch",
    "cm", "zehe", "zehen", "clove", "cloves",
  ].map((u) => u.toLowerCase()),
);

let affectedRecipes = 0;
let totalColonLines = 0;
let stillProblematic = 0;

for (const dir of entries) {
  const detailPath = path.join(ROOT, dir, "detail.html");
  let html;
  try {
    html = await fs.readFile(detailPath, "utf8");
  } catch {
    continue;
  }
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const headings = [...doc.querySelectorAll("flexauto.border-pane p")];
  const zutatenHeading = headings.find(
    (h) => h.textContent?.trim() === "Zutaten",
  );
  if (!zutatenHeading) continue;
  const ul = zutatenHeading.parentElement?.querySelector("ul");
  if (!ul) continue;
  const lis = [...ul.querySelectorAll("li")].map(
    (li) => li.textContent?.trim() ?? "",
  );
  let metaTitle = "(unknown)";
  try {
    const meta = JSON.parse(
      await fs.readFile(path.join(ROOT, dir, "meta.json"), "utf8"),
    );
    metaTitle = meta.title ?? metaTitle;
  } catch { /* ignore */ }

  const colonLines = lis.filter(
    (l) => /:/.test(l) && !/:\s*$/.test(l),
  );
  if (colonLines.length === 0) continue;
  affectedRecipes += 1;

  console.log(`\n=== ${metaTitle} ===`);
  for (const line of colonLines) {
    totalColonLines += 1;
    const expanded = expandIngredientLine(line);
    console.log(`  IN:  ${line}`);
    for (const row of expanded) {
      if (row.kind === "header") {
        console.log(`    HEADER: "${row.title}"`);
      } else {
        const parsed = parseIngredientString(row.text, TEST_UNITS);
        const flags = [
          row.forceOptional ? "optional" : null,
          row.isAlternative ? "ALT" : null,
        ]
          .filter(Boolean)
          .join(", ");
        const tag = flags ? ` [${flags}]` : "";
        console.log(
          `    ING: qty=${parsed.quantity} unit=${parsed.unitName ?? "-"} name="${parsed.name}" notes="${parsed.notes ?? ""}"${tag}`,
        );
        if (parsed.name.includes(":")) stillProblematic += 1;
      }
    }
  }
}

console.log(`\n--- summary ---`);
console.log(`Affected recipes: ${affectedRecipes}`);
console.log(`Colon-in-line entries: ${totalColonLines}`);
console.log(`Rows still containing ':' in parsed name: ${stillProblematic}`);

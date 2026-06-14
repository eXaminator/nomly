import { runSeed } from "../src/db/seed.ts";
import { runIngredientCatalogSeed } from "../src/lib/catalog/seed-catalog.ts";

const counts = runSeed();
console.log("Standarddaten geladen:");
console.log(JSON.stringify(counts, null, 2));

const catalogCounts = runIngredientCatalogSeed();
console.log("\nZutaten-Katalog geladen:");
const { warnings, ...catalogStats } = catalogCounts;
console.log(JSON.stringify(catalogStats, null, 2));
if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

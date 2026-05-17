import { runSeed } from "../src/db/seed";

const counts = runSeed();
console.log("Standarddaten geladen:");
console.log(JSON.stringify(counts, null, 2));

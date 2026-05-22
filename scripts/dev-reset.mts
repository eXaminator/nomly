/**
 * Dev-only DB reset: wipe the local SQLite DB + photo directory, re-run
 * migrations, and run the seed. Honours DATABASE_URL when set.
 *
 * Refuses to run unless NODE_ENV is empty or "development" — never wipe
 * a production DB by accident.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
  console.error(
    `Refusing to run dev:reset with NODE_ENV=${process.env.NODE_ENV}. ` +
      "Unset NODE_ENV or set it to 'development'.",
  );
  process.exit(1);
}

const dbPath = process.env.DATABASE_URL ?? "./data/nomly.db";
const dataDir = dirname(dbPath);

console.log(`→ wiping ${dbPath} (+ -shm/-wal) and ${dataDir}/photos/`);
for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}
rmSync(`${dataDir}/photos`, { recursive: true, force: true });
mkdirSync(`${dataDir}/photos`, { recursive: true });

console.log("→ applying migrations");
execSync("npx drizzle-kit migrate", { stdio: "inherit" });

console.log("→ running seed");
execSync("npm run seed", { stdio: "inherit" });

console.log("✓ dev:reset done — restart the dev server.");

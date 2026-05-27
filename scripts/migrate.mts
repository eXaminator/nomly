import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = process.env.DATABASE_URL ?? "./data/nomly.db";
const migrationsFolder = resolve(
  process.env.MIGRATIONS_FOLDER ?? "./drizzle",
);

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// Foreign keys MUST stay OFF for the duration of the migration run. Drizzle's
// generated table-rebuild migrations (create __new → copy → DROP old → rename)
// open with `PRAGMA foreign_keys=OFF`, but the migrator wraps each migration in
// a transaction, and that PRAGMA is a documented no-op inside a transaction.
// With FK enforcement on, `DROP TABLE` performs an implicit row-by-row delete
// that fires ON DELETE CASCADE actions — including recipe_ingredient's
// self-referential `alternative_for_id`, which silently wiped every alternative
// row on rebuild. So we disable FKs on the connection BEFORE the migrator's
// transaction begins, then re-check + re-enable afterwards.
sqlite.pragma("foreign_keys = OFF");

try {
  migrate(drizzle(sqlite), { migrationsFolder });
  const violations = sqlite.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `foreign key violations after migration: ${JSON.stringify(violations)}`,
    );
  }
  sqlite.pragma("foreign_keys = ON");
  console.log(`migrations applied (db=${dbPath}, migrations=${migrationsFolder})`);
} finally {
  sqlite.close();
}

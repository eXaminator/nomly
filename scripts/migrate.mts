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
sqlite.pragma("foreign_keys = ON");

try {
  migrate(drizzle(sqlite), { migrationsFolder });
  console.log(`migrations applied (db=${dbPath}, migrations=${migrationsFolder})`);
} finally {
  sqlite.close();
}

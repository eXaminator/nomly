import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.ts";

const DB_PATH = process.env.DATABASE_URL ?? "./data/nomly.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// SQLite's built-in LOWER() is ASCII-only — LOWER('Äpfel') returns 'Äpfel'
// unchanged, which breaks every "lookup by lower(name)" path the moment a
// non-ASCII letter shows up (German umlauts, ß, etc.). Register a Unicode-
// aware variant backed by JS `.toLowerCase()`. Use this for case-insensitive
// comparisons in queries.
sqlite.function("lower_u", { deterministic: true }, (s: unknown) =>
  typeof s === "string" ? s.toLowerCase() : s,
);

export const db = drizzle(sqlite, { schema });
export { schema };

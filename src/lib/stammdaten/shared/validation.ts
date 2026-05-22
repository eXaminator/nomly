import { and, eq, ne, or, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { db } from "../../../db/index.ts";

export const MAX_NAME_LENGTH = 200;

export function normalizeName(input: string): string {
  return input.trim();
}

export function validateName(input: string): string | null {
  const trimmed = normalizeName(input);
  if (trimmed.length === 0) return "Name darf nicht leer sein.";
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Name darf höchstens ${MAX_NAME_LENGTH} Zeichen lang sein.`;
  }
  return null;
}

export function dedupeAliasesIgnoreCase(
  aliases: string[],
  canonicalName: string,
): { aliases: string[]; error: string | null } {
  const seen = new Map<string, string>();
  const canonicalKey = canonicalName.toLowerCase();
  for (const raw of aliases) {
    const cleaned = normalizeName(raw);
    if (cleaned.length === 0) {
      return { aliases: [], error: "Aliase dürfen nicht leer sein." };
    }
    if (cleaned.length > MAX_NAME_LENGTH) {
      return {
        aliases: [],
        error: `Aliase dürfen höchstens ${MAX_NAME_LENGTH} Zeichen lang sein.`,
      };
    }
    const key = cleaned.toLowerCase();
    if (key === canonicalKey) {
      return {
        aliases: [],
        error: `"${cleaned}" ist bereits der Name dieser Zeile.`,
      };
    }
    if (seen.has(key)) {
      return {
        aliases: [],
        error: `Alias "${cleaned}" ist mehrfach angegeben.`,
      };
    }
    seen.set(key, cleaned);
  }
  return { aliases: Array.from(seen.values()), error: null };
}

/**
 * Verifies that the given name is unique across the canonical-name column
 * and the entity's alias-name column (case-insensitive via `lower_u`). Used
 * for both canonical-name uniqueness and per-alias uniqueness in service-
 * layer create/update flows.
 *
 * Pass `excludeId` to allow a row to keep its own name during an update;
 * pass `excludeAliasId` to allow an existing alias row to be reinserted as
 * part of an aliases-array replacement.
 */
export function findNameCollision(args: {
  name: string;
  canonicalTable: SQLiteTable;
  canonicalIdColumn: SQLiteColumn;
  canonicalNameColumn: SQLiteColumn;
  aliasTable: SQLiteTable | null;
  aliasParentColumn: SQLiteColumn | null;
  aliasNameColumn: SQLiteColumn | null;
  excludeCanonicalId?: number;
  excludeAliasParentId?: number;
}): { kind: "canonical" | "alias"; ownerId: number; name: string } | null {
  const lowered = args.name.toLowerCase();

  const canonicalWhere = args.excludeCanonicalId
    ? and(
        sql`lower_u(${args.canonicalNameColumn}) = ${lowered}`,
        ne(args.canonicalIdColumn, args.excludeCanonicalId),
      )
    : sql`lower_u(${args.canonicalNameColumn}) = ${lowered}`;

  const canonicalHit = db
    .select({
      id: args.canonicalIdColumn,
      name: args.canonicalNameColumn,
    })
    .from(args.canonicalTable)
    .where(canonicalWhere)
    .get() as { id: number; name: string } | undefined;

  if (canonicalHit) {
    return {
      kind: "canonical",
      ownerId: canonicalHit.id,
      name: canonicalHit.name,
    };
  }

  if (args.aliasTable && args.aliasParentColumn && args.aliasNameColumn) {
    const aliasWhere = args.excludeAliasParentId
      ? and(
          sql`lower_u(${args.aliasNameColumn}) = ${lowered}`,
          ne(args.aliasParentColumn, args.excludeAliasParentId),
        )
      : sql`lower_u(${args.aliasNameColumn}) = ${lowered}`;

    const aliasHit = db
      .select({
        ownerId: args.aliasParentColumn,
        name: args.aliasNameColumn,
      })
      .from(args.aliasTable)
      .where(aliasWhere)
      .get() as { ownerId: number; name: string } | undefined;

    if (aliasHit) {
      return {
        kind: "alias",
        ownerId: aliasHit.ownerId,
        name: aliasHit.name,
      };
    }
  }

  return null;
}

/**
 * Returns `or(eq(col, lower_u(name1)), eq(col, lower_u(name2)), …)` for a
 * batched IN-style case-insensitive name lookup, or `null` if names is empty.
 */
export function buildLowerInClause(column: SQLiteColumn, names: string[]) {
  if (names.length === 0) return null;
  const clauses = names.map(
    (n) => sql`lower_u(${column}) = ${n.toLowerCase()}`,
  );
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export { eq, ne };

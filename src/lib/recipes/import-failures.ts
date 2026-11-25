import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { importFailure } from "@/db/schema";

/**
 * The "failed imports" list: URLs the recipe importer couldn't handle, kept so
 * the importer can be fixed and the import retried. One row per URL.
 */

export type ImportFailure = {
  id: number;
  url: string;
  errorCode: string;
  errorMessage: string;
  attempts: number;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds. */
  lastAttemptAt: number;
};

/** All failures, most recently attempted first. */
export function listImportFailures(): ImportFailure[] {
  return db
    .select()
    .from(importFailure)
    .orderBy(desc(importFailure.lastAttemptAt), desc(importFailure.id))
    .all();
}

export function getImportFailure(id: number): ImportFailure | null {
  return (
    db.select().from(importFailure).where(eq(importFailure.id, id)).get() ??
    null
  );
}

/**
 * Record a failed import. Upserts on the URL: a repeat failure bumps
 * `attempts`, refreshes the error and the last-attempt time.
 */
export function recordImportFailure(
  url: string,
  errorCode: string,
  errorMessage: string,
): { id: number } {
  const row = db
    .insert(importFailure)
    .values({ url: url.trim(), errorCode, errorMessage })
    .onConflictDoUpdate({
      target: importFailure.url,
      set: {
        errorCode,
        errorMessage,
        attempts: sql`${importFailure.attempts} + 1`,
        lastAttemptAt: sql`(unixepoch())`,
      },
    })
    .returning({ id: importFailure.id })
    .get();
  return { id: row.id };
}

/** Saving a recipe imported from `url` clears it from the list. */
export function clearImportFailureForUrl(url: string): void {
  db.delete(importFailure).where(eq(importFailure.url, url.trim())).run();
}

/** Remove one entry; false if it didn't exist. */
export function removeImportFailure(id: number): boolean {
  return db.delete(importFailure).where(eq(importFailure.id, id)).run().changes > 0;
}

/** Remove every entry. Returns how many were removed. */
export function removeAllImportFailures(): number {
  return db.delete(importFailure).run().changes;
}

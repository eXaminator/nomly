import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { recipe, reparseMute } from "@/db/schema";

/**
 * Bulk-reparse mutes: suppress a whole recipe or a single source line from the
 * reparse scan. See docs/superpowers/specs/2026-06-02-bulk-reparse-mute-design.md.
 */

export type ReparseMute = {
  id: number;
  recipeId: number;
  recipeTitle: string;
  /** NULL = the whole recipe is muted; otherwise the muted trimmed raw line. */
  rawLine: string | null;
};

/** All mutes with their recipe title, newest first — for the "Muted" tab. */
export function listReparseMutes(): ReparseMute[] {
  return db
    .select({
      id: reparseMute.id,
      recipeId: reparseMute.recipeId,
      recipeTitle: recipe.title,
      rawLine: reparseMute.rawLine,
    })
    .from(reparseMute)
    .innerJoin(recipe, eq(recipe.id, reparseMute.recipeId))
    .orderBy(desc(reparseMute.createdAt), desc(reparseMute.id))
    .all();
}

/**
 * Mute a recipe (rawLine null/empty) or a single line. Idempotent on
 * (recipe_id, raw_line) — re-muting the same target returns the existing row.
 * A trimmed-empty rawLine is treated as a whole-recipe mute.
 */
export function addReparseMute(
  recipeId: number,
  rawLine: string | null,
): { id: number } {
  const line = rawLine != null && rawLine.trim().length > 0 ? rawLine.trim() : null;
  const existing = db
    .select({ id: reparseMute.id })
    .from(reparseMute)
    .where(
      and(
        eq(reparseMute.recipeId, recipeId),
        line == null ? isNull(reparseMute.rawLine) : eq(reparseMute.rawLine, line),
      ),
    )
    .get();
  if (existing) return { id: existing.id };
  const inserted = db
    .insert(reparseMute)
    .values({ recipeId, rawLine: line })
    .returning({ id: reparseMute.id })
    .all();
  return { id: inserted[0].id };
}

/** Remove a mute by id (unmute). */
export function removeReparseMute(id: number): void {
  db.delete(reparseMute).where(eq(reparseMute.id, id)).run();
}

/** Remove every mute (unmute all). */
export function removeAllReparseMutes(): void {
  db.delete(reparseMute).run();
}

/** The mute set the scan consults: recipe ids muted wholesale, and per-line
 *  keys `${recipeId} ${trimmedRawLine}`. */
export function loadMuteSet(): { recipes: Set<number>; lines: Set<string> } {
  const rows = db
    .select({ recipeId: reparseMute.recipeId, rawLine: reparseMute.rawLine })
    .from(reparseMute)
    .all();
  const recipes = new Set<number>();
  const lines = new Set<string>();
  for (const r of rows) {
    if (r.rawLine == null) recipes.add(r.recipeId);
    else lines.add(`${r.recipeId} ${r.rawLine}`);
  }
  return { recipes, lines };
}

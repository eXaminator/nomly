import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import { recipeTag, tag } from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import { linkedRecipesForTags } from "../shared/linked-recipes.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow } from "../shared/types.ts";
import { normalizeName, validateName } from "../shared/validation.ts";
import { tagAdapter, type TagRow } from "./adapter.ts";

export type TagListItem = {
  id: number;
  name: string;
  recipeRefCount: number;
};

export type TagUpsertInput = { name: string };

export class TagStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TagStammdatenError";
    this.status = status;
  }
}

function loadRecipeRefCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: recipeTag.tagId,
      count: sql<number>`count(*)`,
    })
    .from(recipeTag)
    .where(inArray(recipeTag.tagId, ids))
    .groupBy(recipeTag.tagId)
    .all();
  for (const row of rows) out.set(row.id, Number(row.count));
  return out;
}

export function listTags(query?: string): TagListItem[] {
  const base =
    !query || query.trim().length === 0
      ? db.select({ id: tag.id, name: tag.name }).from(tag).orderBy(asc(tag.name)).all()
      : (() => {
          const pattern = `%${query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
          return db
            .select({ id: tag.id, name: tag.name })
            .from(tag)
            .where(sql`lower_u(${tag.name}) LIKE ${pattern}`)
            .orderBy(asc(tag.name))
            .all();
        })();
  const ids = base.map((r) => r.id);
  const refs = loadRecipeRefCounts(ids);
  return base.map((row) => ({
    id: row.id,
    name: row.name,
    recipeRefCount: refs.get(row.id) ?? 0,
  }));
}

export function getTagDetail(id: number): TagListItem | null {
  const row = db
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(eq(tag.id, id))
    .get();
  if (!row) return null;
  const refs = loadRecipeRefCounts([id]);
  return { id: row.id, name: row.name, recipeRefCount: refs.get(row.id) ?? 0 };
}

function validateInput(input: TagUpsertInput, excludeId?: number): string {
  const nameError = validateName(input.name);
  if (nameError) throw new TagStammdatenError(nameError);
  const cleaned = normalizeName(input.name);

  const lowered = cleaned.toLowerCase();
  const where = excludeId
    ? sql`lower_u(${tag.name}) = ${lowered} AND ${tag.id} != ${excludeId}`
    : sql`lower_u(${tag.name}) = ${lowered}`;
  const collision = db
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(where)
    .get();
  if (collision) {
    throw new TagStammdatenError(
      `Der Tag "${collision.name}" existiert bereits.`,
      409,
    );
  }

  return cleaned;
}

export function createTag(input: TagUpsertInput): TagListItem {
  const name = validateInput(input);
  const inserted = db
    .insert(tag)
    .values({ name })
    .returning({ id: tag.id })
    .all();
  return getTagDetail(inserted[0].id) ?? unreachable();
}

export function updateTag(id: number, input: TagUpsertInput): TagListItem {
  const existing = db.select({ id: tag.id }).from(tag).where(eq(tag.id, id)).get();
  if (!existing) throw new TagStammdatenError("Tag nicht gefunden.", 404);
  const name = validateInput(input, id);
  db.update(tag).set({ name }).where(eq(tag.id, id)).run();
  return getTagDetail(id) ?? unreachable();
}

export type TagDeleteResult = { deletedId: number; replacedWith?: number };

export function deleteTag(id: number, replaceWith?: number): TagDeleteResult {
  const existing = db.select({ id: tag.id }).from(tag).where(eq(tag.id, id)).get();
  if (!existing) throw new TagStammdatenError("Tag nicht gefunden.", 404);

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new TagStammdatenError(
        "Ersatz-Tag darf nicht der zu löschende Tag sein.",
      );
    }
    const target = db
      .select({ id: tag.id })
      .from(tag)
      .where(eq(tag.id, replaceWith))
      .get();
    if (!target) throw new TagStammdatenError("Ersatz-Tag nicht gefunden.", 404);
    try {
      runMerge(replaceWith, [id], tagAdapter);
    } catch (e) {
      if (e instanceof MergeError) throw new TagStammdatenError(e.message, 409);
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  // recipe_tag cascades on tag delete — safe to drop directly.
  db.delete(tag).where(eq(tag.id, id)).run();
  return { deletedId: id };
}

export function mergeTags(
  winnerId: number,
  loserIds: number[],
): MergeResult<TagRow> {
  try {
    return runMerge(winnerId, loserIds, tagAdapter);
  } catch (e) {
    if (e instanceof MergeError) throw new TagStammdatenError(e.message, 409);
    throw e;
  }
}

export function getImpactForTags(ids: number[]): ImpactRow[] {
  const base = getImpact(ids, tagAdapter);
  const linkedByOwner = linkedRecipesForTags(ids);
  return base.map((row) => ({
    ...row,
    linkedRecipes: linkedByOwner.get(row.id) ?? [],
  }));
}

function unreachable(): never {
  throw new Error("unreachable");
}

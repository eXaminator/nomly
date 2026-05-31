import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  ingredient,
  ingredientSubUnit,
  recipeIngredient,
  unit,
} from "../../../db/schema.ts";

/**
 * A single ingredient sub-unit ("Zehe" on Knoblauch) as shown on the
 * cross-ingredient management page. Sub-units are ingredient-scoped, so each
 * row carries its owning ingredient's name for context.
 */
export type SubUnitManagedItem = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  name: string;
  plural: string | null;
  /** Parent global unit this custom unit converts into; null = standalone. */
  parentUnitId: number | null;
  parentUnitName: string | null;
  /** `1 ⟨this⟩ = parentAmount × ⟨parent⟩`. Ignored when standalone. */
  parentAmount: number;
  /** Number of recipe lines referencing this sub-unit. */
  usageCount: number;
};

export type SubUnitUpdateInput = {
  name: string;
  plural: string | null;
  parentUnitId: number | null;
  parentAmount: number;
};

export class SubUnitStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SubUnitStammdatenError";
    this.status = status;
  }
}

function loadUsageCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({ id: recipeIngredient.subUnitId, count: sql<number>`count(*)` })
    .from(recipeIngredient)
    .where(inArray(recipeIngredient.subUnitId, ids))
    .groupBy(recipeIngredient.subUnitId)
    .all();
  for (const row of rows) {
    if (row.id != null) out.set(row.id, Number(row.count));
  }
  return out;
}

export function listSubUnitsManaged(query?: string): SubUnitManagedItem[] {
  const q = query?.trim().toLowerCase() ?? "";
  const where =
    q.length > 0
      ? (() => {
          const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
          return or(
            sql`lower_u(${ingredientSubUnit.name}) LIKE ${pattern}`,
            sql`lower_u(${ingredientSubUnit.plural}) LIKE ${pattern}`,
            sql`lower_u(${ingredient.name}) LIKE ${pattern}`,
          );
        })()
      : undefined;

  const rows = db
    .select({
      id: ingredientSubUnit.id,
      ingredientId: ingredientSubUnit.ingredientId,
      ingredientName: ingredient.name,
      name: ingredientSubUnit.name,
      plural: ingredientSubUnit.plural,
      parentUnitId: ingredientSubUnit.parentUnitId,
      parentUnitName: unit.name,
      parentAmount: ingredientSubUnit.parentAmount,
    })
    .from(ingredientSubUnit)
    .innerJoin(ingredient, eq(ingredient.id, ingredientSubUnit.ingredientId))
    .leftJoin(unit, eq(unit.id, ingredientSubUnit.parentUnitId))
    .where(where)
    .orderBy(sql`unaccent(${ingredient.name})`, asc(ingredientSubUnit.name))
    .all();

  const counts = loadUsageCounts(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    usageCount: counts.get(r.id) ?? 0,
  }));
}

function buildItem(id: number): SubUnitManagedItem {
  const row = db
    .select({
      id: ingredientSubUnit.id,
      ingredientId: ingredientSubUnit.ingredientId,
      ingredientName: ingredient.name,
      name: ingredientSubUnit.name,
      plural: ingredientSubUnit.plural,
      parentUnitId: ingredientSubUnit.parentUnitId,
      parentUnitName: unit.name,
      parentAmount: ingredientSubUnit.parentAmount,
    })
    .from(ingredientSubUnit)
    .innerJoin(ingredient, eq(ingredient.id, ingredientSubUnit.ingredientId))
    .leftJoin(unit, eq(unit.id, ingredientSubUnit.parentUnitId))
    .where(eq(ingredientSubUnit.id, id))
    .get();
  if (!row) throw new SubUnitStammdatenError("Untereinheit nicht gefunden.", 404);
  return { ...row, usageCount: loadUsageCounts([id]).get(id) ?? 0 };
}

/**
 * Update a sub-unit in place by id. Unlike the ingredient-form save path
 * (which rewrites a row's sub-units wholesale), this preserves the row id so
 * `recipe_ingredient.sub_unit_id` references survive — and renames propagate
 * automatically because the recipe read view joins the live name.
 */
export function updateSubUnit(
  id: number,
  input: SubUnitUpdateInput,
): SubUnitManagedItem {
  const existing = db
    .select({ id: ingredientSubUnit.id, ingredientId: ingredientSubUnit.ingredientId })
    .from(ingredientSubUnit)
    .where(eq(ingredientSubUnit.id, id))
    .get();
  if (!existing) throw new SubUnitStammdatenError("Untereinheit nicht gefunden.", 404);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new SubUnitStammdatenError("Name darf nicht leer sein.");
  }
  const plural = input.plural?.trim() ? input.plural.trim() : null;
  // No parent ⇒ standalone (amount irrelevant). With a parent the amount must
  // be positive.
  const parentUnitId = input.parentUnitId ?? null;
  if (parentUnitId != null) {
    const target = db
      .select({ id: unit.id })
      .from(unit)
      .where(eq(unit.id, parentUnitId))
      .get();
    if (!target) {
      throw new SubUnitStammdatenError("Übergeordnete Einheit nicht gefunden.", 404);
    }
    if (!Number.isFinite(input.parentAmount) || input.parentAmount <= 0) {
      throw new SubUnitStammdatenError("Die Umrechnungsmenge muss positiv sein.");
    }
  }
  const parentAmount =
    parentUnitId != null && Number.isFinite(input.parentAmount) && input.parentAmount > 0
      ? input.parentAmount
      : 1;

  // (ingredientId, name) is unique — a rename must not collide with a sibling
  // sub-unit on the same ingredient.
  const clash = db
    .select({ id: ingredientSubUnit.id })
    .from(ingredientSubUnit)
    .where(
      and(
        eq(ingredientSubUnit.ingredientId, existing.ingredientId),
        ne(ingredientSubUnit.id, id),
        sql`lower(${ingredientSubUnit.name}) = ${name.toLowerCase()}`,
      ),
    )
    .get();
  if (clash) {
    throw new SubUnitStammdatenError(
      `Diese Zutat hat bereits eine Untereinheit „${name}“.`,
      409,
    );
  }

  db.update(ingredientSubUnit)
    .set({ name, plural, parentUnitId, parentAmount })
    .where(eq(ingredientSubUnit.id, id))
    .run();
  return buildItem(id);
}

export type SubUnitDeleteResult = { deletedId: number };

/**
 * Delete a sub-unit. `recipe_ingredient.sub_unit_id` is ON DELETE SET NULL, so
 * any recipe lines using it lose their sub-unit — the caller surfaces the
 * usage count before confirming.
 */
export function deleteSubUnit(id: number): SubUnitDeleteResult {
  const existing = db
    .select({ id: ingredientSubUnit.id })
    .from(ingredientSubUnit)
    .where(eq(ingredientSubUnit.id, id))
    .get();
  if (!existing) throw new SubUnitStammdatenError("Untereinheit nicht gefunden.", 404);
  db.delete(ingredientSubUnit).where(eq(ingredientSubUnit.id, id)).run();
  return { deletedId: id };
}

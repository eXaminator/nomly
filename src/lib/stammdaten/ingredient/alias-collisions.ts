import { eq } from "drizzle-orm";
import { db } from "../../../db/index.ts";
import { ingredient, ingredientAlias, unit } from "../../../db/schema.ts";
import { normalizeForMatch } from "../../recipe-import/ingredient.ts";

export type AliasCollision = {
  ingredientId: number;
  ingredientName: string;
  /** Where the colliding name lives on that ingredient. */
  kind: "canonical" | "alias";
  /** The other entry's CURATED matching unit name (alias default → ingredient
   *  default), or null when none is declared. Mirrors the matcher's unit
   *  decider exactly — the global default unit doesn't flow in there either —
   *  so what the user sees while curating is what disambiguates at match
   *  time. */
  unitName: string | null;
};

/**
 * Advisory lookup: other ingredients whose canonical name OR an alias matches
 * `name` (normalised), excluding `excludeIngredientId`. Non-unique aliases are
 * allowed (the unit decides at match time); the management UI uses this to warn
 * — not block — when a name is shared. Each hit carries the resolved unit so
 * the user can see whether it differs.
 */
export function findCrossIngredientAliasCollisions(
  name: string,
  excludeIngredientId?: number,
): AliasCollision[] {
  const key = normalizeForMatch(name);
  if (key.length === 0) return [];

  const unitNameById = new Map<number, string>(
    db
      .select({ id: unit.id, name: unit.name })
      .from(unit)
      .all()
      .map((u) => [u.id, u.name] as const),
  );
  const resolveUnitName = (
    own: number | null,
    ingredientDefault: number | null,
  ): string | null => {
    const id = own ?? ingredientDefault;
    return id != null ? unitNameById.get(id) ?? null : null;
  };

  const out: AliasCollision[] = [];
  const seen = new Set<number>();

  // Canonical-name hits.
  const canonicals = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      defaultUnitId: ingredient.defaultUnitId,
    })
    .from(ingredient)
    .all();
  for (const c of canonicals) {
    if (c.id === excludeIngredientId) continue;
    if (normalizeForMatch(c.name) !== key || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      ingredientId: c.id,
      ingredientName: c.name,
      kind: "canonical",
      unitName: resolveUnitName(c.defaultUnitId, c.defaultUnitId),
    });
  }

  // Alias hits (one row per ingredient — first match wins).
  const aliasRows = db
    .select({
      ingredientId: ingredientAlias.ingredientId,
      ingredientName: ingredient.name,
      aliasName: ingredientAlias.name,
      aliasUnitId: ingredientAlias.defaultUnitId,
      ingredientDefaultUnitId: ingredient.defaultUnitId,
    })
    .from(ingredientAlias)
    .innerJoin(ingredient, eq(ingredient.id, ingredientAlias.ingredientId))
    .all();
  for (const a of aliasRows) {
    if (a.ingredientId === excludeIngredientId) continue;
    if (normalizeForMatch(a.aliasName) !== key || seen.has(a.ingredientId)) continue;
    seen.add(a.ingredientId);
    out.push({
      ingredientId: a.ingredientId,
      ingredientName: a.ingredientName,
      kind: "alias",
      unitName: resolveUnitName(a.aliasUnitId, a.ingredientDefaultUnitId),
    });
  }

  return out;
}

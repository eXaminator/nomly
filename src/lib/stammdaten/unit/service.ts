import { asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";
import {
  recipeIngredient,
  unit,
  unitAlias,
} from "../../../db/schema.ts";
import { getImpact } from "../shared/impact.ts";
import {
  linkedDerivedUnits,
  linkedIngredientConversionsForUnits,
  linkedRecipesForUnits,
} from "../shared/linked-recipes.ts";
import { runMerge, MergeError, type MergeResult } from "../shared/merge.ts";
import type { ImpactRow } from "../shared/types.ts";
import {
  getGlobalDefaultUnitId,
  setGlobalDefaultUnitId,
} from "../../settings/global-default-unit.ts";
import {
  dedupeAliasesIgnoreCase,
  findNameCollision,
  normalizeName,
  validateName,
} from "../shared/validation.ts";
import { unitAdapter, type UnitRow } from "./adapter.ts";

export type Dimension = "mass" | "volume" | "count";

export type UnitListItem = {
  id: number;
  name: string;
  /** Optional plural of the canonical name; null = none. */
  plural: string | null;
  aliases: string[];
  /** Per-alias plural, keyed by the alias name. Only aliases that have a
   *  plural configured appear here. */
  aliasPlurals: Record<string, string>;
  dimension: Dimension;
  baseUnitId: number | null;
  baseUnitName: string | null;
  factor: number;
  isContainer: boolean;
  /** When true, recipe read views render this unit's quantities as fractions
   *  (¼ TL) instead of decimals. */
  displayFraction: boolean;
  /** True for the single unit configured as the global default (applied to a
   *  quantity-bearing line with no explicit unit). */
  isGlobalDefault: boolean;
  recipeRefCount: number;
};

export type UnitUpsertInput = {
  name: string;
  /** Optional canonical plural; omitted/empty/null = no plural. */
  plural?: string | null;
  aliases: string[];
  /** Optional per-alias plural, keyed by alias name. */
  aliasPlurals?: Record<string, string>;
  dimension: Dimension;
  baseUnitId: number | null;
  factor: number;
  isContainer: boolean;
  /** When true, recipe read views show this unit's quantities as fractions. */
  displayFraction: boolean;
  /** When true, point the global-default-unit setting at this unit on save
   *  (single-select; overwrites any previous pointer). */
  setAsGlobalDefault?: boolean;
};

export class UnitStammdatenError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UnitStammdatenError";
    this.status = status;
  }
}

type AliasRow = { name: string; plural: string | null };

function loadAliasesGrouped(ids: number[]): Map<number, AliasRow[]> {
  const out = new Map<number, AliasRow[]>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      unitId: unitAlias.unitId,
      name: unitAlias.name,
      plural: unitAlias.plural,
    })
    .from(unitAlias)
    .where(inArray(unitAlias.unitId, ids))
    .orderBy(asc(unitAlias.name))
    .all();
  for (const row of rows) {
    const list = out.get(row.unitId) ?? [];
    list.push({ name: row.name, plural: row.plural });
    out.set(row.unitId, list);
  }
  return out;
}

/** Split a unit's alias rows into the flat name list and the
 *  name → plural map the list/detail views expose. */
function aliasViews(rows: AliasRow[]): {
  aliases: string[];
  aliasPlurals: Record<string, string>;
} {
  const aliases = rows.map((r) => r.name);
  const aliasPlurals: Record<string, string> = {};
  for (const r of rows) if (r.plural) aliasPlurals[r.name] = r.plural;
  return { aliases, aliasPlurals };
}

function loadRecipeRefCounts(ids: number[]): Map<number, number> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = db
    .select({
      id: recipeIngredient.unitId,
      count: sql<number>`count(*)`,
    })
    .from(recipeIngredient)
    .where(inArray(recipeIngredient.unitId, ids))
    .groupBy(recipeIngredient.unitId)
    .all();
  for (const row of rows) {
    if (row.id != null) out.set(row.id, Number(row.count));
  }
  return out;
}

function loadUnitsBase(query?: string) {
  // Self-join to resolve base-unit name.
  const baseUnitAlias = {
    id: unit.id,
    name: unit.name,
  };
  void baseUnitAlias;

  if (!query || query.trim().length === 0) {
    return db
      .select({
        id: unit.id,
        name: unit.name,
        plural: unit.plural,
        dimension: unit.dimension,
        baseUnitId: unit.baseUnitId,
        factor: unit.factor,
        isContainer: unit.isContainer,
        displayFraction: unit.displayFraction,
      })
      .from(unit)
      .orderBy(sql`unaccent(${unit.name})`)
      .all();
  }
  const pattern = `%${query.trim().toLowerCase().replace(/[%_]/g, "\\$&")}%`;
  const aliasMatchIds = db
    .select({ id: unitAlias.unitId })
    .from(unitAlias)
    .where(sql`lower_u(${unitAlias.name}) LIKE ${pattern}`);
  return db
    .select({
      id: unit.id,
      name: unit.name,
      plural: unit.plural,
      dimension: unit.dimension,
      baseUnitId: unit.baseUnitId,
      factor: unit.factor,
      isContainer: unit.isContainer,
      displayFraction: unit.displayFraction,
    })
    .from(unit)
    .where(
      or(
        sql`lower_u(${unit.name}) LIKE ${pattern}`,
        inArray(unit.id, aliasMatchIds),
      ),
    )
    .orderBy(sql`unaccent(${unit.name})`)
    .all();
}

function resolveBaseUnitNames(ids: Array<number | null>): Map<number, string> {
  const distinct = Array.from(new Set(ids.filter((id): id is number => id != null)));
  const out = new Map<number, string>();
  if (distinct.length === 0) return out;
  const rows = db
    .select({ id: unit.id, name: unit.name })
    .from(unit)
    .where(inArray(unit.id, distinct))
    .all();
  for (const r of rows) out.set(r.id, r.name);
  return out;
}

export function listUnitsManaged(query?: string): UnitListItem[] {
  const base = loadUnitsBase(query);
  const ids = base.map((r) => r.id);
  const aliases = loadAliasesGrouped(ids);
  const recipeCounts = loadRecipeRefCounts(ids);
  const baseUnitNames = resolveBaseUnitNames(base.map((r) => r.baseUnitId));
  const globalDefaultId = getGlobalDefaultUnitId();
  return base.map((row) => ({
    id: row.id,
    name: row.name,
    plural: row.plural,
    ...aliasViews(aliases.get(row.id) ?? []),
    dimension: row.dimension,
    baseUnitId: row.baseUnitId,
    baseUnitName:
      row.baseUnitId != null ? baseUnitNames.get(row.baseUnitId) ?? null : null,
    factor: row.factor,
    isContainer: row.isContainer,
    displayFraction: row.displayFraction,
    isGlobalDefault: row.id === globalDefaultId,
    recipeRefCount: recipeCounts.get(row.id) ?? 0,
  }));
}

export function getUnitDetail(id: number): UnitListItem | null {
  const rows = loadUnitsBase();
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const aliases = loadAliasesGrouped([id]);
  const recipeCounts = loadRecipeRefCounts([id]);
  const baseUnitNames = resolveBaseUnitNames([row.baseUnitId]);
  return {
    id: row.id,
    name: row.name,
    plural: row.plural,
    ...aliasViews(aliases.get(row.id) ?? []),
    dimension: row.dimension,
    baseUnitId: row.baseUnitId,
    baseUnitName:
      row.baseUnitId != null ? baseUnitNames.get(row.baseUnitId) ?? null : null,
    factor: row.factor,
    isContainer: row.isContainer,
    displayFraction: row.displayFraction,
    isGlobalDefault: row.id === getGlobalDefaultUnitId(),
    recipeRefCount: recipeCounts.get(row.id) ?? 0,
  };
}

function validateInput(
  input: UnitUpsertInput,
  excludeId?: number,
): {
  name: string;
  plural: string | null;
  aliases: string[];
  /** Cleaned alias name → plural, keyed by the *cleaned* alias spelling. */
  aliasPlurals: Map<string, string>;
} {
  const nameError = validateName(input.name);
  if (nameError) throw new UnitStammdatenError(nameError);
  const cleanedName = normalizeName(input.name);

  if (!Number.isFinite(input.factor) || input.factor <= 0) {
    throw new UnitStammdatenError("Faktor muss eine positive Zahl sein.");
  }

  if (input.baseUnitId != null) {
    if (input.baseUnitId === excludeId) {
      throw new UnitStammdatenError(
        "Basis-Einheit darf nicht die Einheit selbst sein.",
      );
    }
    const target = db
      .select({ id: unit.id, dimension: unit.dimension })
      .from(unit)
      .where(eq(unit.id, input.baseUnitId))
      .get();
    if (!target) {
      throw new UnitStammdatenError("Basis-Einheit nicht gefunden.", 404);
    }
    if (target.dimension !== input.dimension) {
      throw new UnitStammdatenError(
        `Basis-Einheit hat die Dimension "${target.dimension}", die Einheit aber "${input.dimension}".`,
      );
    }
  }

  const aliasResult = dedupeAliasesIgnoreCase(input.aliases, cleanedName);
  if (aliasResult.error) throw new UnitStammdatenError(aliasResult.error);
  const cleanedAliases = aliasResult.aliases;

  const nameCollision = findNameCollision({
    name: cleanedName,
    canonicalTable: unit,
    canonicalIdColumn: unit.id,
    canonicalNameColumn: unit.name,
    aliasTable: unitAlias,
    aliasParentColumn: unitAlias.unitId,
    aliasNameColumn: unitAlias.name,
    excludeCanonicalId: excludeId,
    excludeAliasParentId: excludeId,
  });
  if (nameCollision) {
    throw new UnitStammdatenError(
      `Der Name "${cleanedName}" ist bereits vergeben (${
        nameCollision.kind === "canonical" ? "als Einheit" : "als Alias"
      }: "${nameCollision.name}").`,
      409,
    );
  }

  for (const alias of cleanedAliases) {
    const collision = findNameCollision({
      name: alias,
      canonicalTable: unit,
      canonicalIdColumn: unit.id,
      canonicalNameColumn: unit.name,
      aliasTable: unitAlias,
      aliasParentColumn: unitAlias.unitId,
      aliasNameColumn: unitAlias.name,
      excludeCanonicalId: excludeId,
      excludeAliasParentId: excludeId,
    });
    if (collision) {
      throw new UnitStammdatenError(
        `Alias "${alias}" ist bereits vergeben (${
          collision.kind === "canonical" ? "als Einheit" : "als Alias"
        }: "${collision.name}").`,
        409,
      );
    }
  }

  // Plurals are extra matchable spellings, not new identities, so they don't
  // get the strict collision treatment names/aliases do — the matcher inserts
  // them insert-if-absent and a duplicate simply never shadows an existing
  // token. We only normalise here (trim, drop empties).
  const plural = input.plural?.trim() ? input.plural.trim() : null;

  // Re-key the incoming alias→plural map onto the *cleaned* alias spellings,
  // matching case-insensitively so a plural sticks to its alias after dedupe.
  const incoming = new Map<string, string>();
  for (const [key, value] of Object.entries(input.aliasPlurals ?? {})) {
    const v = value?.trim();
    if (v) incoming.set(key.trim().toLowerCase(), v);
  }
  const aliasPlurals = new Map<string, string>();
  for (const alias of cleanedAliases) {
    const v = incoming.get(alias.toLowerCase());
    if (v) aliasPlurals.set(alias, v);
  }

  return { name: cleanedName, plural, aliases: cleanedAliases, aliasPlurals };
}

export function createUnit(input: UnitUpsertInput): UnitListItem {
  const { name, plural, aliases, aliasPlurals } = validateInput(input);
  const id = db.transaction((tx) => {
    const inserted = tx
      .insert(unit)
      .values({
        name,
        plural,
        dimension: input.dimension,
        baseUnitId: input.baseUnitId ?? null,
        factor: input.factor,
        isContainer: input.isContainer,
        displayFraction: input.displayFraction,
      })
      .returning({ id: unit.id })
      .all();
    const newId = inserted[0].id;
    if (aliases.length > 0) {
      tx.insert(unitAlias)
        .values(
          aliases.map((name) => ({
            unitId: newId,
            name,
            plural: aliasPlurals.get(name) ?? null,
          })),
        )
        .run();
    }
    return newId;
  });
  if (input.setAsGlobalDefault) setGlobalDefaultUnitId(id);
  return getUnitDetail(id) ?? unreachable();
}

export function updateUnit(id: number, input: UnitUpsertInput): UnitListItem {
  const existing = db
    .select({ id: unit.id, dimension: unit.dimension })
    .from(unit)
    .where(eq(unit.id, id))
    .get();
  if (!existing) throw new UnitStammdatenError("Einheit nicht gefunden.", 404);
  if (input.dimension !== existing.dimension) {
    throw new UnitStammdatenError(
      "Dimension einer Einheit kann nach der Anlage nicht mehr geändert werden.",
    );
  }

  const { name, plural, aliases, aliasPlurals } = validateInput(input, id);

  db.transaction((tx) => {
    tx.update(unit)
      .set({
        name,
        plural,
        baseUnitId: input.baseUnitId ?? null,
        factor: input.factor,
        isContainer: input.isContainer,
        displayFraction: input.displayFraction,
      })
      .where(eq(unit.id, id))
      .run();
    tx.delete(unitAlias).where(eq(unitAlias.unitId, id)).run();
    if (aliases.length > 0) {
      tx.insert(unitAlias)
        .values(
          aliases.map((name) => ({
            unitId: id,
            name,
            plural: aliasPlurals.get(name) ?? null,
          })),
        )
        .run();
    }
  });
  if (input.setAsGlobalDefault) setGlobalDefaultUnitId(id);
  return getUnitDetail(id) ?? unreachable();
}

export type UnitDeleteResult = { deletedId: number; replacedWith?: number };

export function deleteUnit(
  id: number,
  replaceWith?: number,
): UnitDeleteResult {
  const existing = db
    .select({ id: unit.id })
    .from(unit)
    .where(eq(unit.id, id))
    .get();
  if (!existing) throw new UnitStammdatenError("Einheit nicht gefunden.", 404);

  if (replaceWith != null) {
    if (replaceWith === id) {
      throw new UnitStammdatenError(
        "Ersatz-Einheit darf nicht die zu löschende Einheit sein.",
      );
    }
    const target = db
      .select({ id: unit.id })
      .from(unit)
      .where(eq(unit.id, replaceWith))
      .get();
    if (!target) {
      throw new UnitStammdatenError("Ersatz-Einheit nicht gefunden.", 404);
    }
    try {
      runMerge(replaceWith, [id], unitAdapter);
    } catch (e) {
      if (e instanceof MergeError) {
        throw new UnitStammdatenError(e.message, 409);
      }
      throw e;
    }
    return { deletedId: id, replacedWith: replaceWith };
  }

  // For units, all FKs are set-null on delete — no hard-blocker. We delete
  // and let SQLite null out the references.
  db.delete(unit).where(eq(unit.id, id)).run();
  return { deletedId: id };
}

export function mergeUnits(
  winnerId: number,
  loserIds: number[],
  options?: { replaceIds?: number[] },
): MergeResult<UnitRow> {
  try {
    return runMerge(winnerId, loserIds, unitAdapter, options);
  } catch (e) {
    if (e instanceof MergeError) throw new UnitStammdatenError(e.message, 409);
    throw e;
  }
}

export function getImpactForUnits(ids: number[]): ImpactRow[] {
  const base = getImpact(ids, unitAdapter);
  const linkedByOwner = linkedRecipesForUnits(ids);
  const linkedIngredientsByOwner = linkedIngredientConversionsForUnits(ids);
  const derivedByOwner = linkedDerivedUnits(ids);
  return base.map((row) => ({
    ...row,
    linkedRecipes: linkedByOwner.get(row.id) ?? [],
    linkedIngredients: linkedIngredientsByOwner.get(row.id) ?? [],
    linkedDerivedUnits: derivedByOwner.get(row.id) ?? [],
  }));
}

function unreachable(): never {
  throw new Error("unreachable");
}

import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { unit } from "../../db/schema.ts";
import type { Dimension, UnitRow } from "./format.ts";

export function loadUnitsById(ids: number[]): Map<number, UnitRow> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({
      id: unit.id,
      name: unit.name,
      plural: unit.plural,
      dimension: unit.dimension,
      baseUnitId: unit.baseUnitId,
      factor: unit.factor,
    })
    .from(unit)
    .where(inArray(unit.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, r as UnitRow]));
}

export function loadUnit(id: number): UnitRow | null {
  const row = db
    .select({
      id: unit.id,
      name: unit.name,
      plural: unit.plural,
      dimension: unit.dimension,
      baseUnitId: unit.baseUnitId,
      factor: unit.factor,
    })
    .from(unit)
    .where(eq(unit.id, id))
    .get();
  return (row as UnitRow | undefined) ?? null;
}

/**
 * The base mass unit (grams) — the mass-dimension row that is its own base
 * (factor 1, no base unit). Target of the per-ingredient density conversion.
 * Null only if the units table has no mass dimension at all.
 */
export function loadGramUnit(): UnitRow | null {
  const rows = loadUnitsByDimension("mass");
  return (
    rows.find((u) => u.baseUnitId == null && u.factor === 1) ??
    rows.slice().sort((a, b) => a.factor - b.factor)[0] ??
    null
  );
}

export function loadUnitsByDimension(dimension: Dimension): UnitRow[] {
  return db
    .select({
      id: unit.id,
      name: unit.name,
      plural: unit.plural,
      dimension: unit.dimension,
      baseUnitId: unit.baseUnitId,
      factor: unit.factor,
    })
    .from(unit)
    .where(eq(unit.dimension, dimension))
    .all() as UnitRow[];
}

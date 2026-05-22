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
      dimension: unit.dimension,
      baseUnitId: unit.baseUnitId,
      factor: unit.factor,
    })
    .from(unit)
    .where(eq(unit.id, id))
    .get();
  return (row as UnitRow | undefined) ?? null;
}

export function loadUnitsByDimension(dimension: Dimension): UnitRow[] {
  return db
    .select({
      id: unit.id,
      name: unit.name,
      dimension: unit.dimension,
      baseUnitId: unit.baseUnitId,
      factor: unit.factor,
    })
    .from(unit)
    .where(eq(unit.dimension, dimension))
    .all() as UnitRow[];
}

import { inArray, sql } from "drizzle-orm";

import { db } from "../../../db/index.ts";

import type { FkRewire, ImpactRow, MergeAdapter, RefBreakdown } from "./types.ts";

export function getImpact<Row>(
  ids: number[],
  adapter: MergeAdapter<Row>,
): ImpactRow[] {
  if (ids.length === 0) return [];

  const refsById = new Map<number, RefBreakdown>();
  for (const id of ids) refsById.set(id, {});

  for (const rewire of adapter.fkRewires) {
    countRefs(ids, rewire, refsById);
  }

  const aliasCountById = new Map<number, number>();
  for (const id of ids) aliasCountById.set(id, 0);

  if (adapter.aliasTable && adapter.aliasParentColumn) {
    const aliasRows = db
      .select({
        ownerId: adapter.aliasParentColumn,
        count: sql<number>`count(*)`,
      })
      .from(adapter.aliasTable)
      .where(inArray(adapter.aliasParentColumn, ids))
      .groupBy(adapter.aliasParentColumn)
      .all() as Array<{ ownerId: number; count: number }>;
    for (const row of aliasRows) {
      aliasCountById.set(row.ownerId, Number(row.count));
    }
  }

  return ids.map((id) => ({
    id,
    refs: refsById.get(id) ?? {},
    aliasCount: aliasCountById.get(id) ?? 0,
  }));
}

function countRefs(
  ids: number[],
  rewire: FkRewire,
  refsById: Map<number, RefBreakdown>,
): void {
  const rows = db
    .select({
      id: rewire.column,
      count: sql<number>`count(*)`,
    })
    .from(rewire.table)
    .where(inArray(rewire.column, ids))
    .groupBy(rewire.column)
    .all() as Array<{ id: number; count: number }>;

  for (const row of rows) {
    if (row.id == null) continue;
    const refs = refsById.get(row.id);
    if (!refs) continue;
    refs[rewire.refLabel] = (refs[rewire.refLabel] ?? 0) + Number(row.count);
  }
}

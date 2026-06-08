import { inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { shoppingItemStapleSource } from "../../db/schema.ts";
import { getGroup, listGroups } from "./groups.ts";

export type StaplePreviewItem = {
  stapleGroupItemId: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number | null;
  unitId: number | null;
  unitName: string | null;
  note: string | null;
};

export type StaplePreviewGroup = {
  stapleGroupId: number;
  name: string;
  /** True when this group already has at least one contribution on the list. */
  alreadyOnList: boolean;
  items: StaplePreviewItem[];
};

/**
 * Every standard list ("Standardliste" / staple group) with its items — the
 * data behind the meals-style add dialog, where the user selects/deselects
 * individual items (and whole lists) before adding. `alreadyOnList` mirrors
 * the meals preview badge.
 */
export function previewStapleGroups(): StaplePreviewGroup[] {
  const groups = listGroups();
  if (groups.length === 0) return [];

  const onListRows = db
    .select({ stapleGroupId: shoppingItemStapleSource.stapleGroupId })
    .from(shoppingItemStapleSource)
    .where(
      inArray(
        shoppingItemStapleSource.stapleGroupId,
        groups.map((g) => g.id),
      ),
    )
    .all();
  const onList = new Set(onListRows.map((r) => r.stapleGroupId));

  return groups.map((g) => {
    const detail = getGroup(g.id);
    return {
      stapleGroupId: g.id,
      name: g.name,
      alreadyOnList: onList.has(g.id),
      items: (detail?.items ?? []).map((it) => ({
        stapleGroupItemId: it.id,
        ingredientId: it.ingredientId,
        ingredientName: it.ingredientName,
        quantity: it.quantity,
        unitId: it.unitId,
        unitName: it.unitName,
        note: it.note,
      })),
    };
  });
}

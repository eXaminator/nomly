import type { SelectSearchItem } from "@/components/ui/select-search";

/** A unit-picker option that also carries the real `unitId` it resolves to.
 *  Alias options ("clove") have a synthetic negative `id` but a positive
 *  `unitId` (the canonical unit, e.g. Zehe). */
export type UnitPickerItem = SelectSearchItem & { unitId: number };

/**
 * Alias-aware unit search for {@link SelectSearch}: lists canonical units AND
 * each unit alias as its own option (e.g. "clove" under "Zehe"), so the user
 * can pick a specific spelling. Each option carries the real `unitId`; collapse
 * a pick with {@link resolveUnitPick} before storing it.
 */
export async function searchUnitsWithAliases(q: string): Promise<UnitPickerItem[]> {
  const res = await fetch(`/api/v1/units?aliases=1&q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { items: UnitPickerItem[] };
  return body.items;
}

/**
 * Collapse a picked option to its stored shape `{ id: <real unit id>, name:
 * <spelling> }`. Works for canonical options, alias options (whose own `id` is
 * synthetic), and freshly-created units (which carry no `unitId`, so the id is
 * the unit id itself).
 */
export function resolveUnitPick(
  picked: SelectSearchItem | null,
): { id: number; name: string } | null {
  if (!picked) return null;
  const unitId = (picked as Partial<UnitPickerItem>).unitId ?? picked.id;
  return { id: unitId, name: picked.name };
}

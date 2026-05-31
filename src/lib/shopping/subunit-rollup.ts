import type { UnitRow } from "./format.ts";
import { pluralizeLabel } from "../units/label.ts";

/**
 * An ingredient custom unit ("Zehe", "Stange") with its conversion to a parent
 * global unit for shopping aggregation: `1 ⟨this⟩ = parent.amount × parent.unit`.
 * `parent` null = **standalone** — the custom unit is never converted and shows
 * as its own shopping line ("2 Stangen").
 */
export type SubUnitRef = {
  id: number;
  name: string;
  plural: string | null;
  parent: { unit: UnitRow; amount: number } | null;
};

export type SubUnitTotal = {
  quantity: number | null;
  subUnitId: number;
  subUnitName: string;
};

/**
 * Standalone custom-unit totals: sum each custom unit on its own, preserving
 * first-seen order, so the list shows "22 Stäbchen" / "2 Stangen" as their own
 * lines rather than a bare number. Used for custom units with no parent unit.
 */
export function groupSubUnitTotals(
  contribs: Array<{ quantity: number | null; subUnit: SubUnitRef }>,
): SubUnitTotal[] {
  const acc = new Map<
    number,
    { name: string; plural: string | null; sum: number; anyKnown: boolean }
  >();
  const order: number[] = [];
  for (const c of contribs) {
    let entry = acc.get(c.subUnit.id);
    if (!entry) {
      entry = { name: c.subUnit.name, plural: c.subUnit.plural, sum: 0, anyKnown: false };
      acc.set(c.subUnit.id, entry);
      order.push(c.subUnit.id);
    }
    if (c.quantity != null) {
      entry.sum += c.quantity;
      entry.anyKnown = true;
    }
  }
  return order.map((id) => {
    const entry = acc.get(id)!;
    const quantity = entry.anyKnown ? round3(entry.sum) : null;
    return {
      quantity,
      subUnitId: id,
      subUnitName: pluralizeLabel({ name: entry.name, plural: entry.plural }, quantity),
    };
  });
}

/**
 * Ceil to a whole unit, but round to 6 dp first so floating-point noise on an
 * exact multiple (e.g. 32 ÷ 16 = 1.9999999998) doesn't bump 2 → 3. Used for
 * count/container aggregates ("buy whole packs").
 */
export function ceilToWhole(value: number): number {
  return Math.ceil(Math.round(value * 1e6) / 1e6);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

import type { Dimension, UnitRow } from "./format.ts";
import { pluralizeLabel } from "../units/label.ts";

/** An ingredient sub-unit with its purchase-unit conversion factor. */
export type SubUnitRef = {
  id: number;
  name: string;
  /** Optional plural of {@link name}; shown for amounts other than 1. */
  plural: string | null;
  perPurchase: number;
};

/** A single contribution feeding the purchase-unit rollup. `subUnit` set →
 *  expressed in that sub-unit; `subUnit` null → already in the purchase unit. */
export type PurchaseContribution = {
  quantity: number | null;
  subUnit: SubUnitRef | null;
};

export type RolledAmount = {
  quantity: number | null;
  unitId: number;
  unitName: string;
  dimension: Dimension;
};

export type SubUnitTotal = {
  quantity: number | null;
  subUnitId: number;
  subUnitName: string;
};

/**
 * Roll a set of sub-unit / purchase-unit contributions up into a single
 * purchase-unit amount. Each contribution becomes a fraction of a purchase
 * unit (`qty ÷ per_purchase` for a sub-unit, `qty` for a direct purchase-unit
 * entry); the fractions sum and round **up** to whole purchase units — you buy
 * whole packs. All contributions open-ended → quantity null (the unit name
 * still shows). 5 + 17 Stäbchen at 16/Packung → 22 ÷ 16 = 1.375 → 2 Packung.
 */
export function rollupPurchaseTrack(
  contribs: PurchaseContribution[],
  purchaseUnit: UnitRow,
): RolledAmount {
  let sum = 0;
  let anyKnown = false;
  for (const c of contribs) {
    if (c.quantity == null) continue;
    anyKnown = true;
    if (c.subUnit) {
      const per = c.subUnit.perPurchase > 0 ? c.subUnit.perPurchase : 1;
      sum += c.quantity / per;
    } else {
      sum += c.quantity;
    }
  }
  const quantity = anyKnown ? ceilPurchase(sum) : null;
  return {
    quantity,
    unitId: purchaseUnit.id,
    unitName: pluralizeLabel(purchaseUnit, quantity),
    dimension: purchaseUnit.dimension,
  };
}

/**
 * Fallback when the ingredient has no purchase unit: sum each sub-unit on its
 * own, preserving first-seen order, so the list shows "22 Stäbchen" rather
 * than a bare "22".
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
 * Ceil to a whole purchase unit, but round to 6 dp first so floating-point
 * noise on an exact multiple (e.g. 32 ÷ 16 = 1.9999999998) doesn't bump 2 → 3.
 */
function ceilPurchase(value: number): number {
  return Math.ceil(Math.round(value * 1e6) / 1e6);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

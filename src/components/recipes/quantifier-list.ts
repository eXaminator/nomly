import type { AmountQuantifier } from "./payload";

/**
 * Client-side loader for the configured quantifier list, mirroring the unit
 * picker's `searchUnitsWithAliases` (a plain fetch against a read-only GET
 * route). The amount field in {@link IngredientRow} resolves typed text against
 * this list via {@link resolveAmountInput}. Returns an empty list on failure so
 * a transient error degrades to "no quantifiers recognised", never a crash.
 */
export async function loadQuantifiers(): Promise<AmountQuantifier[]> {
  try {
    const res = await fetch("/api/v1/quantifiers");
    if (!res.ok) return [];
    const body = (await res.json()) as { items: AmountQuantifier[] };
    return body.items;
  } catch {
    return [];
  }
}

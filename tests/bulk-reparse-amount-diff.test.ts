import { describe, expect, it } from "vitest";
import { amountRepresentationChanged } from "@/components/recipes/bulk-reparse-dialog";

/**
 * The bulk-reparse amount diff is REPRESENTATION-based: the amount is flagged
 * changed when the tuple (quantity, quantityLow, quantifierId, unitLabel)
 * differs — so a literal `2` and a quantifier `zwei` (effective 2) are a
 * change even though both render "2".
 */
describe("amountRepresentationChanged", () => {
  it("literal 2 vs literal 2 (same unit) → not changed", () => {
    expect(
      amountRepresentationChanged(
        { quantity: 2, quantityLow: null, quantifierId: null, unitLabel: "Stück" },
        { quantity: 2, quantityLow: null, quantifierId: null, unitLabel: "Stück" },
      ),
    ).toBe(false);
  });

  it("literal 2 vs quantifier 'zwei' (eff 2) → changed", () => {
    expect(
      amountRepresentationChanged(
        { quantity: 2, quantityLow: null, quantifierId: null, unitLabel: null },
        { quantity: null, quantityLow: null, quantifierId: 7, unitLabel: null },
      ),
    ).toBe(true);
  });

  it("identical quantifier on both sides → not changed", () => {
    expect(
      amountRepresentationChanged(
        { quantity: null, quantityLow: null, quantifierId: 7, unitLabel: null },
        { quantity: null, quantityLow: null, quantifierId: 7, unitLabel: null },
      ),
    ).toBe(false);
  });

  it("different quantifier ids → changed", () => {
    expect(
      amountRepresentationChanged(
        { quantity: null, quantityLow: null, quantifierId: 7, unitLabel: null },
        { quantity: null, quantityLow: null, quantifierId: 8, unitLabel: null },
      ),
    ).toBe(true);
  });

  it("same numeric amount but different unit → changed", () => {
    expect(
      amountRepresentationChanged(
        { quantity: 2, quantityLow: null, quantifierId: null, unitLabel: "g" },
        { quantity: 2, quantityLow: null, quantifierId: null, unitLabel: "ml" },
      ),
    ).toBe(true);
  });

  it("range low bound changed → changed", () => {
    expect(
      amountRepresentationChanged(
        { quantity: 3, quantityLow: 2, quantifierId: null, unitLabel: "EL" },
        { quantity: 3, quantityLow: 1, quantifierId: null, unitLabel: "EL" },
      ),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyPending,
  nextGhosts,
  withGhosts,
  type PendingPatch,
} from "@/lib/shopping/ghost-items";
import type { ShoppingItemView } from "@/lib/shopping/items";

const item = (id: number, checked = false, skipped = false) =>
  ({
    id,
    checked,
    skippedAt: skipped ? [{ supermarketId: 1, on: "2026-11-03" }] : [],
  }) as unknown as ShoppingItemView;
const isOpen = (i: ShoppingItemView) => !i.checked && i.skippedAt.length === 0;

describe("ghost items", () => {
  it("ghosts rows that left the open list: checked, skipped or gone", () => {
    const g = nextGhosts(
      [item(1), item(2), item(3), item(4, true), item(5)],
      [item(1), item(2, true), item(4, true), item(5, false, true)],
      new Map(),
      isOpen,
    );
    expect([...g.keys()].sort()).toEqual([2, 3, 5]);
    expect(isOpen(g.get(2)!)).toBe(true);
    expect(isOpen(g.get(5)!)).toBe(true);
  });

  it("keeps existing ghosts, drops them when open again", () => {
    const ghost = new Map([[2, item(2)], [3, item(3)]]);
    const g = nextGhosts([item(1)], [item(1), item(2, true), item(3)], ghost, isOpen);
    expect([...g.keys()]).toEqual([2]);
  });

  it("adds ghosts as open rows next to the real item", () => {
    const ghosts = new Map([[2, item(2)], [3, item(3)]]);
    const out = withGhosts([item(1), item(2, true)], ghosts, isOpen);
    expect(out.map((i) => [i.id, i.checked])).toEqual([
      [1, false],
      [2, true],
      [2, false],
      [3, false],
    ]);
    expect(out[2]).toBe(ghosts.get(2));
  });

  it("drops a ghost whose item is open again", () => {
    const out = withGhosts([item(1)], new Map([[1, item(1)]]), isOpen);
    expect(out).toHaveLength(1);
  });

  it("re-applies pending local patches over a server snapshot", () => {
    const pending = new Map<string, PendingPatch>([
      ["skip:2", { itemId: 2, apply: (i) => item(i.id, i.checked, true), settledAtSeq: null }],
    ]);
    const out = applyPending([item(1), item(2)], pending);
    expect(out.map(isOpen)).toEqual([true, false]);
  });
});

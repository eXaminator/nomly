import type { ShoppingItemView } from "./items";

/**
 * "Ghost" items: rows that left this device's open list because of a change
 * made elsewhere — checked off (with or without counting), marked "heute
 * nicht da" / unavailable at the store, or removed. Dropping them on the spot
 * would pull every row below up under the user's thumb, so a tap meant for one
 * item lands on its neighbour. Instead they stay on screen, greyed out and
 * inert, as the open item the user last saw, until the user acts or returns
 * to the app (see `ShoppingListView`).
 */
export type GhostMap = ReadonlyMap<number, ShoppingItemView>;

/** Whether an item shows in the open list right now (store filter, day). */
export type IsOpen = (item: ShoppingItemView) => boolean;

/**
 * New ghost set after a remote refresh. `prev` is what's on screen now,
 * `fresh` what the server reports. A row becomes a ghost when it was in the
 * open list and no longer is; an existing ghost survives unless the item is
 * back in the open list.
 */
export function nextGhosts(
  prev: readonly ShoppingItemView[],
  fresh: readonly ShoppingItemView[],
  existing: GhostMap,
  isOpen: IsOpen,
): Map<number, ShoppingItemView> {
  const freshById = new Map(fresh.map((i) => [i.id, i]));
  const next = new Map<number, ShoppingItemView>();
  for (const [id, snapshot] of existing) {
    const f = freshById.get(id);
    if (!f || !isOpen(f)) next.set(id, snapshot);
  }
  for (const item of prev) {
    if (next.has(item.id) || !isOpen(item)) continue;
    const f = freshById.get(item.id);
    if (!f || !isOpen(f)) next.set(item.id, item);
  }
  return next;
}

/**
 * The items to render: each ghost is added as the open row it used to be, so
 * it keeps its place in the open list. The real item stays too, so it already
 * shows where it now belongs ("Erledigt", "Nicht verfügbar") and can be
 * changed back there. Ghost rows are the snapshot objects from `ghosts` —
 * tell them apart by identity.
 */
export function withGhosts(
  items: readonly ShoppingItemView[],
  ghosts: GhostMap,
  isOpen: IsOpen,
): ShoppingItemView[] {
  if (ghosts.size === 0) return items as ShoppingItemView[];
  const reopened = new Set(items.filter(isOpen).map((i) => i.id));
  const out = [...items];
  for (const [id, g] of ghosts) if (!reopened.has(id)) out.push(g);
  return out;
}

/**
 * A local change whose request is still in flight (or whose result no refetch
 * has picked up yet). Re-applied on top of every server snapshot so a refetch
 * racing the request can't flip the row back — and then flip it again, which
 * would read as a change made elsewhere.
 */
export type PendingPatch = {
  itemId: number;
  apply: (item: ShoppingItemView) => ShoppingItemView;
  /** Set once the request succeeded: refetches started after this seq include it. */
  settledAtSeq: number | null;
};

export function applyPending(
  items: readonly ShoppingItemView[],
  pending: ReadonlyMap<string, PendingPatch>,
): ShoppingItemView[] {
  if (pending.size === 0) return items as ShoppingItemView[];
  const patches = [...pending.values()];
  return items.map((i) =>
    patches.reduce((acc, p) => (p.itemId === acc.id ? p.apply(acc) : acc), i),
  );
}

/**
 * In-process pub/sub for shopping-list changes, used to drive realtime
 * WebSocket fan-out. Route handlers (bundled by Next) call
 * {@link publishShoppingChanged} after a mutation; the custom server
 * (`server.mts`) registers a listener via {@link onShoppingChanged} and
 * broadcasts to subscribed WebSocket clients.
 *
 * The listener set lives on `globalThis` under a global symbol so it's a true
 * singleton even if this module is instantiated twice — Next bundles route
 * handlers separately from `server.mts`'s own module graph, but both resolve
 * `Symbol.for(...)` to the same key and share the one set.
 */

type Listener = () => void;

const KEY = Symbol.for("nomly.shopping.realtime.listeners");

function listeners(): Set<Listener> {
  const g = globalThis as typeof globalThis & {
    [KEY]?: Set<Listener>;
  };
  return (g[KEY] ??= new Set<Listener>());
}

/** Notify every registered listener that the shopping list changed. */
export function publishShoppingChanged(): void {
  for (const listener of listeners()) {
    try {
      listener();
    } catch {
      // One bad listener must not stop the others (or crash the mutation path).
    }
  }
}

/** Register a change listener. Returns an unsubscribe function. */
export function onShoppingChanged(listener: Listener): () => void {
  const set = listeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * Pathname used to decide which nav item is active.
 *
 * Normally this matches `usePathname()`. But when offline, the service worker
 * serves the generic `/offline` document in response to a navigation to e.g.
 * `/rezepte` — so the browser's URL stays `/rezepte` while the hydrated router
 * state (and thus `usePathname()`) reads `/offline`, leaving no nav item
 * highlighted. The real URL is authoritative, so on the client we read
 * `window.location.pathname`. The server snapshot mirrors `usePathname()` so the
 * first paint matches the server-rendered markup (no hydration mismatch); React
 * then swaps in the live location. A re-render from `usePathname()` changing on
 * soft navigations re-reads the snapshot, keeping it current.
 *
 * Lives in its own client module (not `nav-items.tsx`) so the data/types in
 * `nav-items.tsx` stay importable from Server Components without pulling in the
 * client-only `usePathname`.
 */
export function useActiveNavPath(): string {
  const routerPath = usePathname();
  return React.useSyncExternalStore(
    subscribeToLocation,
    () => window.location.pathname || routerPath,
    () => routerPath,
  );
}

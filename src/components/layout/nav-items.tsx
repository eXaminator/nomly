import * as React from "react";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  CalendarDays,
  ShoppingCart,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix: string;
};

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: "/rezepte", label: "Rezepte", icon: BookOpenText, matchPrefix: "/rezepte" },
  { href: "/plan", label: "Plan", icon: CalendarDays, matchPrefix: "/plan" },
  { href: "/einkauf", label: "Einkauf", icon: ShoppingCart, matchPrefix: "/einkauf" },
  {
    href: "/einstellungen",
    label: "Einstellungen",
    icon: Settings,
    matchPrefix: "/einstellungen",
  },
] as const;

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
 */
export function useActiveNavPath(): string {
  const routerPath = usePathname();
  return React.useSyncExternalStore(
    subscribeToLocation,
    () => window.location.pathname || routerPath,
    () => routerPath,
  );
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(item.matchPrefix + "/");
}

import {
  BookOpenText,
  CalendarDays,
  House,
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
  // matchPrefix "/" only ever extends to "//…", so Start is active on "/" alone.
  { href: "/", label: "Start", icon: House, matchPrefix: "/" },
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

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(item.matchPrefix + "/");
}

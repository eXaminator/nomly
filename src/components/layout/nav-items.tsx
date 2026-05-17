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

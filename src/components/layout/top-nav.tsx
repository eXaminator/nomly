"use client";

import Link from "next/link";
import { NAV_ITEMS, isNavItemActive } from "./nav-items";
import { useActiveNavPath } from "./use-active-nav-path";
import { cn } from "@/lib/cn";

export function TopNav() {
  const pathname = useActiveNavPath();
  return (
    <nav className="hidden md:flex items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--color-muted)] text-[var(--color-fg)]"
                : "text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

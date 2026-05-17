"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/cn";

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-card)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-card)]/80 pb-[env(safe-area-inset-bottom)]"
      aria-label="Hauptnavigation"
    >
      <ul className="grid grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.matchPrefix + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  active
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

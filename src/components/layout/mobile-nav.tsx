"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/cn";

export function MobileNav() {
  const pathname = usePathname();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Navigation öffnen"
        className="inline-flex size-10 items-center justify-center rounded-md text-[var(--color-fg)] hover:bg-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] md:hidden"
      >
        <Menu className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-[12rem]">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.matchPrefix + "/");
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-2",
                  active && "bg-[var(--color-muted)] text-[var(--color-fg)]",
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

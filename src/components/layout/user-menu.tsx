"use client";

import * as React from "react";
import { LogOut, Moon, Sun, User as UserIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email }: { name: string; email?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-muted)] text-sm font-semibold text-[var(--color-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        aria-label="Benutzermenü"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium text-[var(--color-fg)]">{name}</span>
            {email ? (
              <span className="text-xs text-[var(--color-muted-fg)]">{email}</span>
            ) : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
          {isDark ? "Helles Design" : "Dunkles Design"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/api/auth/logout" className="flex w-full items-center">
            <LogOut className="mr-2 size-4" />
            Abmelden
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenuFallback() {
  return (
    <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-muted)]">
      <UserIcon className="size-5 text-[var(--color-muted-fg)]" />
    </div>
  );
}

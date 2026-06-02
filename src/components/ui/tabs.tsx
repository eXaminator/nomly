"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius)] bg-[var(--color-muted)] p-1 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[calc(var(--radius)-0.25rem)] px-3 py-1.5 font-medium text-[var(--color-muted-fg)] transition-colors",
        "hover:text-[var(--color-fg)]",
        "data-[state=active]:bg-[var(--color-card)] data-[state=active]:text-[var(--color-fg)] data-[state=active]:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Small count pill shown next to a tab label for list-bearing tabs (e.g.
 * "Aliase 3", "Aliase 0"). Always renders the number — an explicit "0" tells
 * the user the list is empty without opening the tab. The border keeps it
 * legible on both the active (card) and inactive (muted) trigger backgrounds;
 * the text inherits the trigger's color.
 */
export function TabCount({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-[1.375rem] items-center justify-center rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none tabular-nums">
      {count}
    </span>
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
        className,
      )}
      {...props}
    />
  );
}

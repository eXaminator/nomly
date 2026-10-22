"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SupermarketSummary } from "./shopping-list-view";

type Props = {
  value: number | null;
  supermarkets: SupermarketSummary[];
  /** Per-supermarket count of still-needed items that store carries. Shown in
   *  the option label so it's clear which stores have something left to buy. */
  neededCounts: Map<number, number>;
  onChange: (id: number | null) => void;
};

export function SupermarketFilter({
  value,
  supermarkets,
  neededCounts,
  onChange,
}: Props) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[var(--color-muted-fg)] sm:flex-none">
        <span className="hidden sm:inline">Supermarkt</span>
        <select
          aria-label="Supermarkt"
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          className="h-9 w-full min-w-0 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:w-auto"
        >
          <option value="">Ohne</option>
          {supermarkets.map((s) => {
            const count = neededCounts.get(s.id) ?? 0;
            return (
              <option key={s.id} value={s.id}>
                {s.name} ({count})
              </option>
            );
          })}
        </select>
      </label>
      {value != null ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-9 shrink-0 px-0"
          onClick={() => onChange(null)}
          aria-label="Supermarkt-Filter zurücksetzen"
          title="Supermarkt-Filter zurücksetzen"
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

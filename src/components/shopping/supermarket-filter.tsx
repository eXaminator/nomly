"use client";

import * as React from "react";
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
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
      <span className="hidden sm:inline">Supermarkt</span>
      <select
        aria-label="Supermarkt"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
        className="h-9 max-w-[8rem] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:max-w-none"
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
  );
}

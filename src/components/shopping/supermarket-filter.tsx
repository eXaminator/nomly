"use client";

import * as React from "react";
import type { SupermarketSummary } from "./shopping-list-view";

type Props = {
  value: number | null;
  supermarkets: SupermarketSummary[];
  onChange: (id: number | null) => void;
};

export function SupermarketFilter({ value, supermarkets, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
      <span>Supermarkt</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
        className="h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        <option value="">Ohne</option>
        {supermarkets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

"use client";

import * as React from "react";
import { X } from "lucide-react";
import type { SupermarketSummary } from "./shopping-list-view";

type Props = {
  value: number | null;
  supermarkets: SupermarketSummary[];
  onChange: (id: number | null) => void;
};

export function SupermarketFilter({ value, supermarkets, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 text-sm text-[var(--color-muted-fg)]">
      <label className="flex items-center gap-2">
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
      {value != null ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Supermarkt-Filter zurücksetzen"
          title="Filter zurücksetzen"
          className="inline-flex size-8 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";

export type Supermarket = { id: number; name: string };

/** Pill add/remove list of supermarkets where this article is unavailable.
 *  Controlled — the parent owns the list. The search hides already-picked
 *  entries. */
export function ExcludedSupermarketsField({
  value,
  onChange,
}: {
  value: Supermarket[];
  onChange: (value: Supermarket[]) => void;
}) {
  const searchSupermarkets = React.useCallback(
    async (q: string) => {
      const res = await fetch(
        `/api/v1/supermarkets/manage?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items: Array<{ id: number; name: string }>;
      };
      const taken = new Set(value.map((s) => s.id));
      return body.items
        .filter((s) => !taken.has(s.id))
        .map((s) => ({ id: s.id, name: s.name }));
    },
    [value],
  );

  function add(picked: { id: number; name: string } | null) {
    if (!picked) return;
    if (value.some((s) => s.id === picked.id)) return;
    onChange([...value, { id: picked.id, name: picked.name }]);
  }

  function remove(id: number) {
    onChange(value.filter((s) => s.id !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Nicht verfügbar bei</Label>
      <p className="text-xs text-[var(--color-muted-fg)]">
        Supermärkte, die diesen Artikel nicht führen. Auf der Einkaufsliste
        werden passende Einträge im jeweiligen Markt ausgegraut.
      </p>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((s) => (
            <li key={s.id}>
              <span className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] py-1 pl-2.5 pr-1 text-sm">
                {s.name}
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label={`${s.name} entfernen`}
                  className="inline-flex size-5 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <SelectSearch
        value={null}
        onChange={add}
        search={searchSupermarkets}
        placeholder="Supermarkt hinzufügen…"
      />
    </div>
  );
}

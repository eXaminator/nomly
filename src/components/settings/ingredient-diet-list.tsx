"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export type IngredientDietRow = {
  id: number;
  name: string;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
};

type Props = { initial: IngredientDietRow[] };

const OPTIONS: Array<{
  value: "vegan" | "vegetarian" | "meat" | "";
  label: string;
}> = [
  { value: "", label: "Unbekannt" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarisch" },
  { value: "meat", label: "Tierisch" },
];

/**
 * Two-column collator: case-insensitive, German rules so umlauts sort
 * sensibly ("Äpfel" lands next to "Apfel", not at the bottom).
 */
const collator = new Intl.Collator("de", { sensitivity: "base" });

export function IngredientDietList({ initial }: Props) {
  const [rows, setRows] = React.useState(initial);
  const [query, setQuery] = React.useState("");
  const [saving, setSaving] = React.useState<Map<number, boolean>>(new Map());
  const [error, setError] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q.length === 0
      ? rows
      : rows.filter((r) => r.name.toLowerCase().includes(q));
    return list.slice().sort((a, b) => collator.compare(a.name, b.name));
  }, [rows, query]);

  async function update(
    id: number,
    nextClass: IngredientDietRow["dietaryClass"],
  ) {
    setError(null);
    setSaving((m) => new Map(m).set(id, true));
    const prev = rows;
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, dietaryClass: nextClass } : r)),
    );
    try {
      const res = await fetch(`/api/v1/ingredients/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dietaryClass: nextClass }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving((m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      });
    }
  }

  const tally = React.useMemo(() => {
    let vegan = 0;
    let vegetarian = 0;
    let meat = 0;
    let unknown = 0;
    for (const r of rows) {
      if (r.dietaryClass === "vegan") vegan += 1;
      else if (r.dietaryClass === "vegetarian") vegetarian += 1;
      else if (r.dietaryClass === "meat") meat += 1;
      else unknown += 1;
    }
    return { vegan, vegetarian, meat, unknown };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zutat suchen…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-muted-fg)]">
          <span>{tally.vegan} vegan</span>
          <span>{tally.vegetarian} vegetarisch</span>
          <span>{tally.meat} tierisch</span>
          <span>{tally.unknown} unbekannt</span>
        </div>
      </div>

      {error ? (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_85%)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
        <ul className="max-h-[60vh] divide-y divide-[var(--color-border)] overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--color-muted-fg)]">
              Keine Treffer.
            </li>
          ) : (
            filtered.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 px-3 py-2 sm:px-4"
              >
                <span className="flex-1 truncate text-sm text-[var(--color-fg)]">
                  {row.name}
                </span>
                <span className="flex items-center gap-2">
                  <select
                    value={row.dietaryClass ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      update(
                        row.id,
                        v === "" ? null : (v as "vegan" | "vegetarian" | "meat"),
                      );
                    }}
                    aria-label={`Diät für ${row.name}`}
                    className={cn(
                      "h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm",
                      saving.get(row.id) && "opacity-60",
                    )}
                    disabled={saving.get(row.id) === true}
                  >
                    {OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {saving.get(row.id) ? (
                    <Loader2 className="size-4 animate-spin text-[var(--color-muted-fg)]" />
                  ) : null}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

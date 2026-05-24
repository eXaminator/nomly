"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";

/**
 * Force-match flow: the `+` pill next to candidate suggestions opens this
 * popover, which lets the user search the full ingredient catalog and pin
 * the recipe row to any ingredient — even one the matcher didn't surface.
 * An optional checkbox writes the row's current display name back as an
 * alias on save, so the next import of that text resolves directly.
 *
 * The popover stays completely separate from the row's auto-select rules:
 * picking here overrides them, the row's display name is left untouched.
 */
type IngredientSuggestion = {
  ingredientId: number;
  name: string;
  canonicalName?: string;
};

async function searchIngredients(q: string): Promise<IngredientSuggestion[]> {
  const trimmed = q.trim();
  if (trimmed.length === 0) return [];
  const r = await fetch(`/api/v1/ingredients?q=${encodeURIComponent(trimmed)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as { items: IngredientSuggestion[] };
  return data.items;
}

type Props = {
  /** The row's current input text. Pre-populates the search box and, when
   *  the user opts in, becomes the alias name on save. */
  typedName: string;
  onPick: (
    ingredientId: number,
    canonicalName: string,
    addAsAlias: boolean,
  ) => void;
};

export function ForceMatchPopover({ typedName, onPick }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<IngredientSuggestion[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [addAsAlias, setAddAsAlias] = React.useState(false);

  // When opening, seed the query with the typed text so the user sees
  // results they're likely looking for. Reset state on close. The
  // setState-in-effect linter rule is flagged because this is a derived
  // initial state on a transition — there's no reasonable way to push it
  // upstream since the trigger lives inside the popover root.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (open) {
      setQuery(typedName);
      setAddAsAlias(typedName.trim().length > 0);
    } else {
      setQuery("");
      setItems([]);
      setLoading(false);
      setAddAsAlias(false);
    }
  }, [open, typedName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounced search.
  const reqRef = React.useRef(0);
  React.useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      return;
    }
    const token = ++reqRef.current;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const next = await searchIngredients(trimmed);
      if (token !== reqRef.current) return;
      setItems(next);
      setLoading(false);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [open, query]);

  function pick(item: IngredientSuggestion) {
    const canonical = item.canonicalName ?? item.name;
    onPick(item.ingredientId, canonical, addAsAlias);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)] transition-colors",
            "hover:bg-[var(--color-muted)]",
          )}
          title="Mit einer beliebigen Zutat verknüpfen (Force-Match)."
          aria-label="Force-Match"
        >
          <Plus className="size-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-72 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2 shadow-md"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zutat suchen…"
              className="pl-8"
              autoFocus
            />
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-[var(--color-muted-fg)]">
                <Loader2 className="size-4 animate-spin" />
                Suche…
              </div>
            ) : items.length === 0 ? (
              <p className="px-2 py-3 text-sm text-[var(--color-muted-fg)]">
                {query.trim().length === 0
                  ? "Tippe zum Suchen."
                  : "Keine Treffer."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {items.map((it) => (
                  <li key={`${it.ingredientId}-${it.name}`}>
                    <button
                      type="button"
                      onClick={() => pick(it)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-[var(--color-muted)]"
                    >
                      <span className="font-medium">{it.name}</span>
                      {it.canonicalName && it.canonicalName !== it.name ? (
                        <span className="text-xs text-[var(--color-muted-fg)]">
                          ≈ {it.canonicalName}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {typedName.trim().length > 0 ? (
            <label className="mt-2 flex items-center gap-2 border-t border-[var(--color-border)] px-2 pt-2 text-xs text-[var(--color-fg)]">
              <Checkbox
                checked={addAsAlias}
                onCheckedChange={(v) => setAddAsAlias(v === true)}
              />
              <span>
                „{typedName.trim()}&quot; als Alias hinzufügen
              </span>
            </label>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

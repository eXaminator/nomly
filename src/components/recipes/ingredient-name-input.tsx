"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type Hit = { ingredientId: number; name: string; canonicalName?: string };

type Props = {
  value: string;
  /** Picked ingredient id when the user chose an item from the autocomplete
   *  popover (vs. free typing). Lets the parent select that item directly. */
  /** Called with the picked / typed name. `canonical` is set when the value
   *  is an alias of a known ingredient (so the parent can render a pill). */
  onChange: (
    next: string,
    canonical?: string | null,
    pickedIngredientId?: number,
  ) => void;
  placeholder?: string;
  className?: string;
};

const DEBOUNCE_MS = 150;

/**
 * Freeform ingredient name input. As the user types, a popover surfaces
 * existing ingredient names matching the typed text — clicking one replaces
 * the typed text with the canonical name. The user can also leave any text
 * and it will be resolved (or auto-created) on the server at save time.
 */
export function IngredientNameInput({
  value,
  onChange,
  placeholder,
  className,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Hit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const reqRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const q = value.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const my = ++reqRef.current;
    const handle = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/v1/ingredients?q=${encodeURIComponent(q)}`);
        if (!r.ok) {
          if (my === reqRef.current) setItems([]);
          return;
        }
        const data = (await r.json()) as { items: Hit[] };
        if (my === reqRef.current) {
          // Hide the popover when the only suggestion equals what's typed —
          // no useful hint to offer.
          const filtered = data.items.filter(
            (h) => h.name.toLowerCase() !== q.toLowerCase(),
          );
          setItems(filtered);
          setActiveIdx(0);
        }
      } finally {
        if (my === reqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [value, open]);

  const dropdownVisible = open && items.length > 0;

  function pick(item: Hit) {
    // If the item came from an alias hit (canonicalName !== name), surface
    // the canonical so the parent can render the "= canonical" pill.
    const canonical =
      item.canonicalName && item.canonicalName !== item.name
        ? item.canonicalName
        : null;
    onChange(item.name, canonical, item.ingredientId);
    setOpen(false);
    // Keep focus on the input so the user can keep tabbing.
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownVisible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Tab/Enter selects the highlighted suggestion (but Enter is also
      // intercepted at the form level — that's fine, the form swallows it).
      e.preventDefault();
      pick(items[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover.Root open={dropdownVisible} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn("relative", className)}>
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder ?? "Zutat"}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              // Typing invalidates a previously-set canonical — pass `null`
              // so the parent clears the pill.
              onChange(e.target.value, null);
              if (!open) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[var(--color-muted-fg)]" />
          ) : null}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
        >
          <ul className="max-h-72 overflow-auto py-1" role="listbox">
            {items.map((item, idx) => (
              <li
                key={`${item.ingredientId}-${item.name}`}
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                  idx === activeIdx
                    ? "bg-[var(--color-muted)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg)] hover:bg-[var(--color-muted)]",
                )}
              >
                <span className="flex-1 truncate">{item.name}</span>
                {item.canonicalName && item.canonicalName !== item.name ? (
                  <span className="truncate text-xs text-[var(--color-muted-fg)]">
                    ≈ {item.canonicalName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

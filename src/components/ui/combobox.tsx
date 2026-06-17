"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useScrollLockBypass } from "@/lib/use-scroll-lock-bypass";
import { Input } from "./input.tsx";

export type ComboboxItem = {
  id: number;
  name: string;
  /** Optional secondary text (e.g. alias that matched, dimension hint). */
  detail?: string;
  /** True when the item is a unit that takes no amount (etwas, a sprinkle). */
  unspecific?: boolean;
};

export type ComboboxProps = {
  value: ComboboxItem | null;
  onChange: (value: ComboboxItem | null) => void;
  /** Returns matching items for the given query (debounced for you). */
  search: (q: string) => Promise<ComboboxItem[]>;
  /** Optional inline create. Receives the typed name, returns the new item. */
  onCreate?: (name: string) => Promise<ComboboxItem>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Auto-focus the input when mounted. */
  autoFocus?: boolean;
};

const DEBOUNCE_MS = 150;

export function Combobox({
  value,
  onChange,
  search,
  onCreate,
  placeholder,
  className,
  disabled,
  autoFocus,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<ComboboxItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const reqRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Inside a Radix Dialog/Drawer `react-remove-scroll` kills touch/wheel
  // scrolling on this portaled popover; let the list scroll natively again.
  const listCallbackRef = useScrollLockBypass<HTMLUListElement>();

  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) {
      // Resets the rendered list when the user clears the input. The rule's
      // preferred patterns (useDeferredValue / external store) don't fit a
      // debounced text-input → fetch loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      setLoading(false);
      setActiveIdx(0);
      return;
    }
    setLoading(true);
    const my = ++reqRef.current;
    const handle = window.setTimeout(async () => {
      try {
        const result = await search(q);
        if (my === reqRef.current) {
          setItems(result);
          setActiveIdx(0);
        }
      } finally {
        if (my === reqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, open, search]);

  const exactMatch = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return items.find((i) => i.name.toLowerCase() === q) ?? null;
  }, [items, query]);

  const canCreate = Boolean(
    onCreate && query.trim().length > 0 && !exactMatch && !creating,
  );

  function commit(item: ComboboxItem) {
    onChange(item);
    setOpen(false);
    setQuery("");
  }

  async function handleCreate() {
    if (!onCreate || !canCreate) return;
    setCreating(true);
    try {
      const created = await onCreate(query.trim());
      commit(created);
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    const totalRows = items.length + (canCreate ? 1 : 0);
    if (totalRows === 0) {
      if (e.key === "Enter" && canCreate) {
        e.preventDefault();
        void handleCreate();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, totalRows - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx < items.length) {
        commit(items[activeIdx]);
      } else if (canCreate) {
        void handleCreate();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div
        className={cn(
          "inline-flex h-11 w-full items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm",
          disabled && "opacity-50",
          className,
        )}
      >
        <span className="flex-1 truncate text-[var(--color-fg)]">{value.name}</span>
        {!disabled ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
            aria-label="Auswahl entfernen"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn("relative", className)}>
          <Input
            ref={inputRef}
            value={query}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onBlur={() => {
              // Auto-commit when the typed text matches a result exactly.
              // Clicking on a popover option uses onMouseDown+preventDefault
              // so this onBlur never races with explicit selection.
              if (exactMatch) {
                commit(exactMatch);
              }
            }}
            onKeyDown={onKeyDown}
          />
          {loading || creating ? (
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
          <ul
            ref={listCallbackRef}
            className="max-h-72 overflow-auto py-1 overscroll-contain"
            role="listbox"
          >
            {items.length === 0 && !canCreate ? (
              <li className="px-3 py-2 text-sm text-[var(--color-muted-fg)]">
                {query.trim().length === 0
                  ? "Tippen, um zu suchen…"
                  : loading
                    ? "Suche…"
                    : "Keine Treffer."}
              </li>
            ) : null}
            {items.map((item, idx) => (
              <li
                key={item.id}
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(item);
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
                {item.detail ? (
                  <span className="truncate text-xs text-[var(--color-muted-fg)]">
                    {item.detail}
                  </span>
                ) : null}
              </li>
            ))}
            {canCreate ? (
              <li
                role="option"
                aria-selected={activeIdx === items.length}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleCreate();
                }}
                onMouseEnter={() => setActiveIdx(items.length)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-sm",
                  activeIdx === items.length
                    ? "bg-[var(--color-muted)]"
                    : "hover:bg-[var(--color-muted)]",
                )}
              >
                <Plus className="size-4 text-[var(--color-accent)]" />
                <span className="flex-1 truncate text-[var(--color-fg)]">
                  „{query.trim()}“ neu anlegen
                </span>
              </li>
            ) : null}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

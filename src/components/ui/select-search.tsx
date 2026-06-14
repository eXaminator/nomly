"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "./input.tsx";

export type SelectSearchItem = {
  id: number;
  name: string;
  detail?: string;
  /** True when the item is a unit that takes no amount (etwas, a sprinkle). */
  unspecific?: boolean;
};

export type SelectSearchProps = {
  value: SelectSearchItem | null;
  onChange: (next: SelectSearchItem | null) => void;
  /** Returns matching items for the given query (called debounced). */
  search: (q: string) => Promise<SelectSearchItem[]>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Optional list shown immediately when the popover opens with no query. */
  defaultItems?: SelectSearchItem[];
  emptyHint?: string;
  /** When provided, the dropdown shows a "+ … anlegen" row when the typed
   *  query has no exact match. Receives the trimmed name and must return the
   *  freshly-created item (the parent is responsible for the HTTP call). */
  onCreate?: (name: string) => Promise<SelectSearchItem>;
  createLabelPrefix?: string;
};

const DEBOUNCE_MS = 150;

/**
 * A searchable select: the trigger is a button styled like a native <select>
 * (placeholder/value on the left, chevron on the right). Click opens a
 * popover containing a search input + the result list. There is no inline
 * "create" — picking from existing entries is the only way to set a value.
 */
export function SelectSearch({
  value,
  onChange,
  search,
  placeholder = "Auswählen…",
  className,
  disabled,
  defaultItems = [],
  emptyHint = "Keine Treffer.",
  onCreate,
  createLabelPrefix = "anlegen",
}: SelectSearchProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<SelectSearchItem[]>(defaultItems);
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const reqRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  // Most callers pass `search` as an inline closure and rely on the default
  // `defaultItems = []` parameter, so both references change on every parent
  // render. Tunnel them through refs so the fetch effect only re-runs on
  // intent-bearing changes (query / open), not on every parent re-render —
  // otherwise the loader spins forever and `activeIdx` resets just as the
  // user is navigating with arrow keys.
  const searchRef = React.useRef(search);
  const defaultItemsRef = React.useRef(defaultItems);
  React.useEffect(() => {
    searchRef.current = search;
    defaultItemsRef.current = defaultItems;
  });

  const trimmedQuery = query.trim();
  const exactMatch = React.useMemo(() => {
    if (trimmedQuery.length === 0) return null;
    const q = trimmedQuery.toLowerCase();
    return items.find((i) => i.name.toLowerCase() === q) ?? null;
  }, [items, trimmedQuery]);
  const canCreate = Boolean(
    onCreate && trimmedQuery.length > 0 && !exactMatch && !creating,
  );
  const totalRows = items.length + (canCreate ? 1 : 0);

  async function handleCreate() {
    if (!onCreate || !canCreate) return;
    setCreating(true);
    try {
      const created = await onCreate(trimmedQuery);
      onChange(created);
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // Same debounced-fetch pattern as the other autocompletes; React's
    // preferred external-store mechanism doesn't fit cleanly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const my = ++reqRef.current;
    const handle = window.setTimeout(async () => {
      try {
        // Prefer caller-supplied `defaultItems` as the empty-query listing
        // (lets callers pre-bake "most used" rows). Otherwise hit the search
        // endpoint with an empty query — the server is expected to return the
        // full list for that case.
        const currentDefaults = defaultItemsRef.current;
        const useDefaults = q.length === 0 && currentDefaults.length > 0;
        const result = useDefaults
          ? currentDefaults
          : await searchRef.current(q);
        if (my === reqRef.current) {
          setItems(result);
          setActiveIdx(0);
        }
      } finally {
        if (my === reqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  React.useEffect(() => {
    if (open) {
      // Focus the search input shortly after the popover mounts. Use a
      // microtask so Radix's own focus management finishes first.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      // Clear the search query when the popover closes so the next open
      // starts fresh. This is a sync from React state to an internal scratch
      // value; the lint rule's preferred patterns don't help here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
    }
  }, [open]);

  // Touch twin of the onWheel workaround below: inside a Radix Dialog/Drawer,
  // `react-remove-scroll` preventDefaults touchmove on anything outside the
  // dialog body — including this portaled popover — so on mobile the list
  // can't be scrolled by finger. Scroll it manually and preventDefault, but
  // let the edges bubble so an overscroll doesn't feel stuck. A non-passive
  // native listener is required because React's touchmove is passive (can't
  // preventDefault).
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    let lastY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (el.scrollHeight <= el.clientHeight) return;
      const y = e.touches[0]?.clientY ?? lastY;
      const dy = lastY - y; // >0 → finger up → scroll content down
      lastY = y;
      const atTop = dy < 0 && el.scrollTop <= 0;
      const atBottom =
        dy > 0 && Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;
      if (atTop || atBottom) return;
      el.scrollTop += dy;
      e.preventDefault();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [open]);

  // Keep the active option in view when keyboard navigation moves it past
  // the visible region of the (potentially long) list.
  React.useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIdx] as HTMLElement | undefined;
    if (!active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [activeIdx, open, items.length]);

  function commit(item: SelectSearchItem) {
    onChange(item);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (totalRows === 0) {
      if (e.key === "Enter" && canCreate) {
        e.preventDefault();
        void handleCreate();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
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

  return (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-11 w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50",
            "hover:bg-[var(--color-muted)]",
            className,
          )}
        >
          <span
            className={cn(
              "flex-1 truncate",
              value
                ? "text-[var(--color-fg)]"
                : "text-[var(--color-muted-fg)]",
            )}
          >
            {value ? value.name : placeholder}
          </span>
          <span className="flex items-center gap-1 text-[var(--color-muted-fg)]">
            {value && !disabled ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Auswahl entfernen"
                className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <X className="size-4" />
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => {
            // Workaround: in Chrome/macOS the pointer-down event for a
            // scrollbar inside the popover reports a target outside the
            // content node, which Radix would treat as an outside click and
            // close the popover — making the list impossible to scroll via
            // the scrollbar. Compare against the bounding rect instead and
            // keep the popover open when the click is inside it.
            const rect = contentRef.current?.getBoundingClientRect();
            if (!rect) return;
            const ev = e.detail.originalEvent;
            if (
              ev.clientX >= rect.left &&
              ev.clientX <= rect.right &&
              ev.clientY >= rect.top &&
              ev.clientY <= rect.bottom
            ) {
              e.preventDefault();
            }
          }}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[14rem] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
        >
          <div className="relative border-b border-[var(--color-border)]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Suchen…"
              className="h-10 rounded-none border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
              autoComplete="off"
              spellCheck={false}
            />
            {loading || creating ? (
              <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[var(--color-muted-fg)]" />
            ) : null}
          </div>
          <ul
            ref={listRef}
            className="max-h-72 overflow-auto py-1 overscroll-contain"
            role="listbox"
            onWheel={(e) => {
              // Inside a Radix Dialog/Drawer the parent uses
              // `react-remove-scroll`, which preventDefaults wheel events on
              // anything outside the dialog body — including this portaled
              // popover, leaving the listbox unscrollable. Scroll manually
              // and preventDefault so this stays consistent inside and
              // outside dialogs (no double-scroll).
              const el = e.currentTarget;
              if (el.scrollHeight <= el.clientHeight) return;
              const atTop = e.deltaY < 0 && el.scrollTop === 0;
              const atBottom =
                e.deltaY > 0 &&
                Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;
              if (atTop || atBottom) return;
              el.scrollTop += e.deltaY;
              e.preventDefault();
            }}
          >
            {items.length === 0 && !canCreate ? (
              <li className="px-3 py-2 text-sm text-[var(--color-muted-fg)]">
                {loading
                  ? "Lade…"
                  : trimmedQuery.length === 0
                    ? "Keine Einträge vorhanden."
                    : emptyHint}
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
                {value?.id === item.id ? (
                  <Check className="size-4 text-[var(--color-accent)]" />
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
                  „{trimmedQuery}“ {createLabelPrefix}
                </span>
              </li>
            ) : null}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

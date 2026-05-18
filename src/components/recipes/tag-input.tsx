"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  /** Existing tag names from the DB; filtered as the user types. */
  suggestions?: string[];
  placeholder?: string;
};

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Tag eingeben…",
}: Props) {
  const [draft, setDraft] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const cleaned = raw.trim().replace(/,$/, "").trim();
    if (cleaned.length === 0) return;
    if (value.some((v) => v.toLowerCase() === cleaned.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, cleaned]);
    setDraft("");
    setActiveIdx(0);
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  const filtered = React.useMemo(() => {
    const q = draft.trim().toLowerCase();
    const taken = new Set(value.map((v) => v.toLowerCase()));
    const pool = suggestions.filter((s) => !taken.has(s.toLowerCase()));
    if (q.length === 0) return pool.slice(0, 8);
    return pool
      .filter((s) => s.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b, "de");
      })
      .slice(0, 8);
  }, [draft, suggestions, value]);

  const exactInSuggestions = filtered.some(
    (s) => s.toLowerCase() === draft.trim().toLowerCase(),
  );
  const showCreateRow =
    draft.trim().length > 0 &&
    !exactInSuggestions &&
    !value.some((v) => v.toLowerCase() === draft.trim().toLowerCase());

  const rows = showCreateRow ? filtered.length + 1 : filtered.length;
  const dropdownVisible = open && rows > 0;

  function commit(idx: number) {
    if (idx < filtered.length) {
      addTag(filtered[idx]);
    } else if (showCreateRow) {
      addTag(draft);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (dropdownVisible && activeIdx < rows) {
        commit(activeIdx);
      } else if (draft.trim().length > 0) {
        addTag(draft);
      }
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      removeTag(value[value.length - 1]);
      return;
    }
    if (!dropdownVisible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, rows - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover.Root open={dropdownVisible} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2"
          onClick={() => inputRef.current?.focus()}
        >
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-muted)] px-3 py-1 text-xs font-medium text-[var(--color-fg)]"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
                aria-label={`Tag „${tag}" entfernen`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              if (v.endsWith(",")) {
                addTag(v);
              } else {
                setDraft(v);
                setActiveIdx(0);
                setOpen(true);
              }
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={value.length === 0 ? placeholder : ""}
            className="h-8 min-w-[8rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          />
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
            {filtered.map((s, idx) => (
              <li
                key={s}
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(idx);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  "cursor-pointer truncate px-3 py-2 text-sm",
                  idx === activeIdx
                    ? "bg-[var(--color-muted)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg)] hover:bg-[var(--color-muted)]",
                )}
              >
                {s}
              </li>
            ))}
            {showCreateRow ? (
              <li
                role="option"
                aria-selected={activeIdx === filtered.length}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(filtered.length);
                }}
                onMouseEnter={() => setActiveIdx(filtered.length)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-sm",
                  activeIdx === filtered.length
                    ? "bg-[var(--color-muted)]"
                    : "hover:bg-[var(--color-muted)]",
                )}
              >
                <Plus className="size-4 text-[var(--color-accent)]" />
                <span className="flex-1 truncate text-[var(--color-fg)]">
                  „{draft.trim()}“ anlegen
                </span>
              </li>
            ) : null}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

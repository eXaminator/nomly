"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  /** All app-defined tag names. Rendered as clickable pills the user toggles
   *  on/off. */
  suggestions?: string[];
  placeholder?: string;
};

/**
 * Tag picker for the recipe form: every app-defined tag is shown as a pill
 * that toggles membership on click; a small input below lets the user type a
 * brand-new tag name. Selected-but-not-yet-existing tags are marked "(neu)".
 * Nothing is persisted here — new tags are created server-side when the recipe
 * form is submitted (see `resolveTags`).
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Neuen Tag anlegen…",
}: Props) {
  const [draft, setDraft] = React.useState("");

  const isSelected = React.useCallback(
    (tag: string) => value.some((v) => v.toLowerCase() === tag.toLowerCase()),
    [value],
  );
  const isExisting = React.useCallback(
    (tag: string) =>
      suggestions.some((s) => s.toLowerCase() === tag.toLowerCase()),
    [suggestions],
  );

  // The full pill set: every existing tag, plus any selected new tag the user
  // typed. Sorted alphabetically and stable, so toggling never reshuffles.
  const allTags = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...suggestions, ...value]) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out.sort((a, b) => a.localeCompare(b, "de"));
  }, [suggestions, value]);

  function toggle(tag: string) {
    if (isSelected(tag)) {
      onChange(value.filter((v) => v.toLowerCase() !== tag.toLowerCase()));
    } else {
      onChange([...value, tag]);
    }
  }

  function addTag(raw: string) {
    const cleaned = raw.trim().replace(/,$/, "").trim();
    if (cleaned.length === 0) return;
    // Reuse the existing tag's exact spelling when the typed name matches one
    // (case-insensitively), so we don't show a near-duplicate pill.
    const match = [...suggestions, ...value].find(
      (t) => t.toLowerCase() === cleaned.toLowerCase(),
    );
    const name = match ?? cleaned;
    if (!isSelected(name)) onChange([...value, name]);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(draft);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => {
            const selected = isSelected(tag);
            const isNew = selected && !isExisting(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                aria-pressed={selected}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                    : "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {tag}
                {isNew ? (
                  <span className="text-[0.65rem] opacity-80">(neu)</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            // A trailing comma commits the tag, matching the old behaviour.
            if (v.endsWith(",")) addTag(v);
            else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-9 max-w-xs"
          aria-label="Neuen Tag anlegen"
        />
        <button
          type="button"
          onClick={() => addTag(draft)}
          disabled={draft.trim().length === 0}
          className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-50"
          title="Tag anlegen (wird erst beim Speichern erstellt)"
        >
          <Plus className="size-3.5" />
          Anlegen
        </button>
      </div>
    </div>
  );
}

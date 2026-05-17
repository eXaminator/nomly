"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  /** Existing tags from the DB; rendered as quick-pick chips below the input. */
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

  function addTag(raw: string) {
    const cleaned = raw.trim().replace(/,$/, "").trim();
    if (cleaned.length === 0) return;
    if (value.some((v) => v.toLowerCase() === cleaned.toLowerCase())) return;
    onChange([...value, cleaned]);
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  const unusedSuggestions = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
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
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) addTag(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(draft);
            } else if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
              removeTag(value[value.length - 1]);
            }
          }}
          placeholder={placeholder}
          className="h-8 min-w-[8rem] flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
      </div>
      {unusedSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {unusedSuggestions.slice(0, 16).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className={cn(
                "rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs text-[var(--color-muted-fg)] transition-colors",
                "hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

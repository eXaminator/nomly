"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export type AliasChipEditorProps = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * Editable chip list. Adds a new alias on Enter (or blur); removes via the
 * X-button on each chip. Duplicate-within-row check runs client-side; full
 * cross-namespace validation runs server-side on save.
 */
export function AliasChipEditor({
  value,
  onChange,
  placeholder = "Alias hinzufügen…",
  disabled,
}: AliasChipEditorProps) {
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setDraft("");
      setError(null);
      return;
    }
    const lower = trimmed.toLowerCase();
    if (value.some((v) => v.toLowerCase() === lower)) {
      setError(`"${trimmed}" ist bereits in der Liste.`);
      return;
    }
    onChange([...value, trimmed]);
    setDraft("");
    setError(null);
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 ? (
          <span className="text-sm text-[var(--color-muted-fg)]">
            Keine Aliase.
          </span>
        ) : (
          value.map((alias, idx) => (
            <span
              key={alias + idx}
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-[var(--color-muted)] px-2.5 py-1 text-xs",
                disabled && "opacity-50",
              )}
            >
              {alias}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="rounded-full p-0.5 hover:bg-[var(--color-border)]"
                  aria-label={`${alias} entfernen`}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))
        )}
      </div>
      {!disabled && (
        <div>
          <Input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
          />
          {error && (
            <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

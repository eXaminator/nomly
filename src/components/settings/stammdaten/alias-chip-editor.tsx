"use client";

import * as React from "react";
import { AlertTriangle, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { findAliasCollisions } from "./alias-collisions";

export type AliasChipEditorProps = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Canonical name of the item being edited. When set, aliases that are
   *  virtually identical to it (or to each other) get a non-blocking warning. */
  canonicalName?: string;
};

/**
 * Editable chip list. Adds a new alias on Enter (or blur); removes via the
 * X-button on each chip. A byte-identical duplicate within the row is blocked;
 * aliases that are only *virtually* identical (same matcher dedup key as the
 * canonical name or another alias — differ only in case/diacritics/separators/
 * conjunction) are kept but flagged with a non-blocking warning. Full
 * cross-namespace validation still runs server-side on save.
 */
export function AliasChipEditor({
  value,
  onChange,
  placeholder = "Alias hinzufügen…",
  disabled,
  canonicalName = "",
}: AliasChipEditorProps) {
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const collisions = React.useMemo(
    () => findAliasCollisions(canonicalName, value),
    [canonicalName, value],
  );

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
          value.map((alias, idx) => {
            const collision = collisions.get(idx);
            const title = collision
              ? collision.collidesWith === "name"
                ? "Quasi identisch mit dem Namen"
                : "Quasi identisch mit einem anderen Alias"
              : undefined;
            return (
              <span
                key={alias + idx}
                title={title}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
                  collision
                    ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/40"
                    : "bg-[var(--color-muted)]",
                  disabled && "opacity-50",
                )}
              >
                {collision && (
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                )}
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
            );
          })
        )}
      </div>
      {collisions.size > 0 && (
        <p className="flex items-center gap-1 text-xs text-[var(--color-warning)]">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          Gelb markierte Aliase sind quasi identisch mit dem Namen oder einem
          anderen Alias.
        </p>
      )}
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

"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/cn";

type TagState = "off" | "include" | "exclude";

type Props = { allTags: string[] };

const NEXT_STATE: Record<TagState, TagState> = {
  off: "include",
  include: "exclude",
  exclude: "off",
};

const PREV_STATE: Record<TagState, TagState> = {
  off: "exclude",
  exclude: "include",
  include: "off",
};

/**
 * Parse a comma-separated tag list from a URL param into a Set of
 * case-folded keys. Empty / missing parameter yields an empty set.
 * Caller compares against the same key shape via {@link tagKey}.
 */
function parseTagList(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.toLowerCase()),
  );
}

const tagKey = (t: string) => t.toLowerCase();

export function TagFilterBar({ allTags }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const mustSet = React.useMemo(
    () => parseTagList(params.get("must")),
    [params],
  );
  const notSet = React.useMemo(
    () => parseTagList(params.get("not")),
    [params],
  );

  function stateFor(tag: string): TagState {
    const k = tagKey(tag);
    if (mustSet.has(k)) return "include";
    if (notSet.has(k)) return "exclude";
    return "off";
  }

  function toggle(tag: string, direction: "forward" | "backward") {
    const next =
      direction === "forward"
        ? NEXT_STATE[stateFor(tag)]
        : PREV_STATE[stateFor(tag)];
    const k = tagKey(tag);

    // Look up the existing canonical-cased value in the URL (or fall back to
    // the clicked tag's display casing) so we keep the user's spelling
    // round-trip stable in the address bar.
    const url = new URLSearchParams(params.toString());
    const displayTag = allTags.find((t) => tagKey(t) === k) ?? tag;

    const drop = (key: string, set: Set<string>) => {
      const remaining = Array.from(set).filter((x) => x !== k);
      if (remaining.length === 0) {
        url.delete(key);
      } else {
        // Re-derive display values from `allTags` so URL casing stays in
        // sync with the tag's canonical form.
        const display = remaining
          .map((rk) => allTags.find((t) => tagKey(t) === rk) ?? rk)
          .join(",");
        url.set(key, display);
      }
    };
    const add = (key: string, set: Set<string>) => {
      const values = Array.from(new Set([...set, k]));
      const display = values
        .map((rk) =>
          rk === k ? displayTag : (allTags.find((t) => tagKey(t) === rk) ?? rk),
        )
        .join(",");
      url.set(key, display);
    };

    if (next === "off") {
      drop("must", mustSet);
      drop("not", notSet);
    } else if (next === "include") {
      drop("not", notSet);
      add("must", mustSet);
    } else {
      // exclude
      drop("must", mustSet);
      add("not", notSet);
    }

    const qs = url.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function clearAll() {
    const url = new URLSearchParams(params.toString());
    url.delete("must");
    url.delete("not");
    const qs = url.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (allTags.length === 0) return null;

  const anyActive = mustSet.size > 0 || notSet.size > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-[var(--color-muted-fg)]">
          Tags ({allTags.length})
        </span>
        {anyActive ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-[var(--color-muted-fg)] underline-offset-2 hover:text-[var(--color-fg)] hover:underline"
          >
            Filter zurücksetzen
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {allTags.map((tag) => {
          const state = stateFor(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag, "forward")}
              onContextMenu={(e) => {
                e.preventDefault();
                toggle(tag, "backward");
              }}
              aria-pressed={state !== "off"}
              title={
                state === "include"
                  ? "Linksklick: ausschließen · Rechtsklick: aufheben"
                  : state === "exclude"
                    ? "Linksklick: aufheben · Rechtsklick: einschließen"
                    : "Linksklick: einschließen · Rechtsklick: ausschließen"
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                state === "off" &&
                  "border-[var(--color-border)] bg-transparent text-[var(--color-muted-fg)] hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]",
                state === "include" &&
                  "border-transparent bg-[var(--color-success)] text-white",
                state === "exclude" &&
                  "border-transparent bg-[var(--color-danger)] text-white",
              )}
            >
              {state === "include" ? (
                <Check className="size-3" />
              ) : state === "exclude" ? (
                <X className="size-3" />
              ) : (
                <Minus className="size-3 opacity-60" />
              )}
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}

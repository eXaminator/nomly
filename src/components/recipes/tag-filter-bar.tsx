"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Check, ChevronDown, Minus, X } from "lucide-react";
import { cn } from "@/lib/cn";

type TagState = "off" | "include" | "exclude";

export type TagFilterValue = {
  must: string[];
  not: string[];
};

type Props = {
  allTags: string[];
  /** Controlled value. When both `value` and `onChange` are passed, the
   *  component reads state from this prop and reports changes via the
   *  callback instead of writing to URL params. */
  value?: TagFilterValue;
  onChange?: (next: TagFilterValue) => void;
};

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

export function TagFilterBar({ allTags, value, onChange }: Props) {
  const isControlled = value != null && onChange != null;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();

  const mustSet = React.useMemo(
    () =>
      isControlled
        ? new Set(value.must.map(tagKey))
        : parseTagList(params.get("must")),
    [isControlled, value, params],
  );
  const notSet = React.useMemo(
    () =>
      isControlled
        ? new Set(value.not.map(tagKey))
        : parseTagList(params.get("not")),
    [isControlled, value, params],
  );

  // Translate a key-set back to the display-cased strings — needed when
  // bubbling controlled changes back to the parent.
  function toDisplay(keys: Set<string>): string[] {
    return Array.from(keys).map(
      (k) => allTags.find((t) => tagKey(t) === k) ?? k,
    );
  }

  function commit(nextMust: Set<string>, nextNot: Set<string>) {
    if (isControlled) {
      onChange({ must: toDisplay(nextMust), not: toDisplay(nextNot) });
      return;
    }
    const url = new URLSearchParams(params.toString());
    if (nextMust.size === 0) url.delete("must");
    else url.set("must", toDisplay(nextMust).join(","));
    if (nextNot.size === 0) url.delete("not");
    else url.set("not", toDisplay(nextNot).join(","));
    const qs = url.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Active chips bubble to the front so users always see what's selected,
  // even when the list is collapsed.
  const sortedTags = React.useMemo(() => {
    return [...allTags].sort((a, b) => {
      const aActive = mustSet.has(tagKey(a)) || notSet.has(tagKey(a));
      const bActive = mustSet.has(tagKey(b)) || notSet.has(tagKey(b));
      if (aActive === bActive) return 0;
      return aActive ? -1 : 1;
    });
  }, [allTags, mustSet, notSet]);

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
    const nextMust = new Set(mustSet);
    const nextNot = new Set(notSet);

    if (next === "off") {
      nextMust.delete(k);
      nextNot.delete(k);
    } else if (next === "include") {
      nextNot.delete(k);
      nextMust.add(k);
    } else {
      // exclude
      nextMust.delete(k);
      nextNot.add(k);
    }

    commit(nextMust, nextNot);
  }

  function clearAll() {
    commit(new Set(), new Set());
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
      <div
        id={listId}
        className={cn(
          "flex flex-wrap gap-1.5 overflow-hidden transition-[max-height] duration-200 ease-out motion-reduce:transition-none",
          // Two rows of chips: chip ≈ 26px + gap-1.5 (6px) → 58px ≈ 3.625rem.
          // Expanded `max-h-[40rem]` is generous enough to never bite for
          // any realistic tag count (we don't cap upstream).
          expanded ? "max-h-[40rem]" : "max-h-[3.625rem]",
        )}
      >
        {sortedTags.map((tag) => {
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
      {allTags.length > 6 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          className={cn(
            "inline-flex items-center justify-center gap-1 self-stretch rounded-md text-xs font-medium",
            "border border-transparent text-[var(--color-muted-fg)] transition-colors",
            "hover:border-[var(--color-border)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            // 44px tap target on touch / mobile, tighter on desktop.
            "min-h-11 px-3 py-2 md:min-h-8 md:py-1",
          )}
        >
          <span>{expanded ? "Weniger anzeigen" : "Mehr anzeigen"}</span>
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
}

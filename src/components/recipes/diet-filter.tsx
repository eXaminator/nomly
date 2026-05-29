"use client";

import * as React from "react";
import { Leaf, Salad } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUrlString } from "@/lib/url-state";

export type DietChoice = "all" | "vegetarian" | "vegan";

type Props = {
  /** Controlled value. When both `value` and `onChange` are passed, the
   *  component reads state from this prop and reports changes via the callback
   *  instead of writing to the URL — used by the planner's recipe filters. */
  value?: DietChoice;
  onChange?: (next: DietChoice) => void;
};

export function DietFilter({ value, onChange }: Props = {}) {
  const isControlled = value != null && onChange != null;
  // The URL-backed hook is always called (hooks rules) but its setter is only
  // used in uncontrolled mode; reading `diet` on a page that doesn't use it
  // (e.g. /plan) just yields the default and is harmless.
  const [urlRaw, setUrlRaw] = useUrlString<DietChoice>("diet", "all");
  const raw = isControlled ? value : urlRaw;
  const current: DietChoice =
    raw === "vegan" || raw === "vegetarian" ? raw : "all";

  function set(next: DietChoice) {
    if (isControlled) onChange(next);
    else setUrlRaw(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Diät-Filter"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] p-0.5"
    >
      <Segment
        label="Alle"
        active={current === "all"}
        onClick={() => set("all")}
      />
      <Segment
        label="Vegetarisch"
        icon={<Salad className="size-3.5" />}
        accent="var(--color-warning)"
        active={current === "vegetarian"}
        onClick={() => set("vegetarian")}
      />
      <Segment
        label="Vegan"
        icon={<Leaf className="size-3.5" />}
        accent="var(--color-success)"
        active={current === "vegan"}
        onClick={() => set("vegan")}
      />
    </div>
  );
}

function Segment({
  label,
  icon,
  accent,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  accent?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "text-white"
          : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
      )}
      style={
        active && accent
          ? { background: accent }
          : active
            ? { background: "var(--color-fg)", color: "var(--color-bg)" }
            : undefined
      }
    >
      {icon}
      {label}
    </button>
  );
}

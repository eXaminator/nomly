"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Leaf, Salad } from "lucide-react";
import { cn } from "@/lib/cn";

type Choice = "all" | "vegetarian" | "vegan";

const PARAM_BY_CHOICE: Record<Choice, string | null> = {
  all: null,
  vegetarian: "vegetarian",
  vegan: "vegan",
};

function readChoice(raw: string | null): Choice {
  if (raw === "vegan") return "vegan";
  if (raw === "vegetarian") return "vegetarian";
  return "all";
}

export function DietFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = readChoice(params.get("diet"));

  function set(next: Choice) {
    const url = new URLSearchParams(params.toString());
    const value = PARAM_BY_CHOICE[next];
    if (value) url.set("diet", value);
    else url.delete("diet");
    const qs = url.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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

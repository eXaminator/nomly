"use client";

import * as React from "react";
import { Input } from "./input.tsx";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shortWeekday(iso: string): string {
  if (!ISO_DATE_RE.test(iso)) return "";
  // Treat the ISO date as a calendar day in UTC so the weekday doesn't flip
  // across DST boundaries depending on the user's timezone.
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.toLocaleDateString("de-DE", { weekday: "short", timeZone: "UTC" });
}

type Props = {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  min?: string;
  /** Extra classes for the wrapper — useful for sizing (`w-44`, etc). */
  className?: string;
};

/**
 * Native `<input type="date">` can't be told to display the weekday next to
 * the date — the browser picks the format. Wrap the input in a relative
 * positioned div and float a small "Sa"/"So"/… badge in the input's leading
 * padding so the user sees "SA 23.05.2026" without a custom picker.
 */
export function DateInputWithWeekday({
  id,
  value,
  onChange,
  min,
  className,
}: Props) {
  const weekday = shortWeekday(value);
  return (
    <div className={["relative", className].filter(Boolean).join(" ")}>
      <Input
        id={id}
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className={weekday ? "pl-12" : undefined}
      />
      {weekday ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs font-medium uppercase tracking-wider text-[var(--color-muted-fg)]"
        >
          {weekday}
        </span>
      ) : null}
    </div>
  );
}

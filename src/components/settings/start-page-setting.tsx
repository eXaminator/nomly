"use client";

import * as React from "react";
import {
  START_PAGE_KEY,
  START_PAGE_OPTIONS,
  resolveStartPage,
} from "@/lib/start-page";

/**
 * Per-device start-page select (localStorage, not the DB — each device may
 * want a different entry page, and the value must be readable offline at
 * app launch).
 */
export function StartPageSetting() {
  const [value, setValue] = React.useState<string>("/");

  React.useEffect(() => {
    try {
      setValue(resolveStartPage(window.localStorage.getItem(START_PAGE_KEY)));
    } catch {
      // storage unavailable — keep the default
    }
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = resolveStartPage(e.target.value);
    setValue(next);
    try {
      window.localStorage.setItem(START_PAGE_KEY, next);
    } catch {
      // storage unavailable — the select still reflects the choice
    }
  };

  return (
    <select
      value={value}
      onChange={onChange}
      aria-label="Startseite"
      className="h-11 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      {START_PAGE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

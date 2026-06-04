"use client";

import * as React from "react";
import {
  START_PAGE_KEY,
  START_PAGE_OPTIONS,
  resolveStartPage,
  type StartPage,
} from "@/lib/start-page";

// localStorage is the store; same-tab writes don't fire "storage" events, so
// onChange notifies these listeners by hand.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStartPage(): StartPage {
  try {
    return resolveStartPage(window.localStorage.getItem(START_PAGE_KEY));
  } catch {
    return "/"; // storage unavailable — show the default
  }
}

/**
 * Per-device start-page select (localStorage, not the DB — each device may
 * want a different entry page, and the value must be readable offline at
 * app launch). The server snapshot renders the default; the stored value
 * swaps in after hydration.
 */
export function StartPageSetting() {
  const value = React.useSyncExternalStore(
    subscribe,
    readStartPage,
    (): StartPage => "/",
  );

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    try {
      window.localStorage.setItem(START_PAGE_KEY, resolveStartPage(e.target.value));
    } catch {
      // storage unavailable — nothing to persist
    }
    for (const notify of listeners) notify();
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

/**
 * Per-device start-page preference for the PWA. The manifest's start_url
 * points at /start, which reads this localStorage key and redirects. Stored
 * client-side only (deliberately per-device, works offline, no migration).
 */

export const START_PAGE_KEY = "nomly.startPage";

export const START_PAGE_OPTIONS = [
  { value: "/", label: "Dashboard" },
  { value: "/einkauf", label: "Einkaufsliste" },
  { value: "/plan", label: "Planer" },
  { value: "/rezepte", label: "Rezepte" },
] as const;

export type StartPage = (typeof START_PAGE_OPTIONS)[number]["value"];

/** Validates a raw (untrusted) stored value; anything unknown → dashboard. */
export function resolveStartPage(raw: unknown): StartPage {
  const hit = START_PAGE_OPTIONS.find((o) => o.value === raw);
  return hit ? hit.value : "/";
}

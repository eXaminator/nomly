"use client";

import * as React from "react";
import { START_PAGE_KEY, resolveStartPage } from "@/lib/start-page";

/**
 * PWA entry point (manifest start_url). Reads the per-device start-page
 * preference and redirects. A hard navigation (location.replace, not the
 * router) so the request goes through the service worker and the target can
 * be served from cache when offline. Unknown/broken stored values fall back
 * to the dashboard.
 */
export default function StartRedirectPage() {
  React.useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(START_PAGE_KEY);
    } catch {
      // storage unavailable — fall back to the dashboard
    }
    window.location.replace(resolveStartPage(raw));
  }, []);
  return null;
}

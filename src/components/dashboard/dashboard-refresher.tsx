"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConnectivity } from "@/components/shopping/offline-indicator";

// The SW may have answered this navigation with a cached snapshot. Refresh
// once per full page load — soft navigations already rendered fresh data
// (the page is force-dynamic), so they skip the extra request.
let refreshedThisPageLoad = false;

/**
 * Keeps the dashboard from going stale while online. router.refresh()
 * re-renders the Server Components in place (no reload, no lost state):
 * - on mount after a hard load (the SW-snapshot case),
 * - when connectivity recovers (offline → online),
 * - when the PWA resumes from the background while online.
 * Never fires offline — the snapshot is all we have then.
 */
export function DashboardRefresher() {
  const router = useRouter();
  const connectivity = useConnectivity();
  const lastState = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!refreshedThisPageLoad && navigator.onLine) {
      refreshedThisPageLoad = true;
      router.refresh();
    }
  }, [router]);

  React.useEffect(() => {
    const prev = lastState.current;
    lastState.current = connectivity;
    // "checking" → "online" is the normal mount probe; the mount refresh
    // already covered it. Only genuine recoveries re-fetch.
    if (
      connectivity === "online" &&
      (prev === "offline" || prev === "sessionExpired")
    ) {
      router.refresh();
    }
  }, [connectivity, router]);

  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return null;
}

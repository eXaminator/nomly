"use client";

import * as React from "react";

export function RegisterSW(): null {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    // Re-check for a deployed update when the app regains focus — a long-open
    // standalone PWA otherwise rarely asks the server for a new sw.js.
    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        registration?.update().catch(() => undefined);
      }
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("nomly:sw-update-available"));
            }
          });
        });
        reg.update().catch(() => undefined);
        document.addEventListener("visibilitychange", checkForUpdate);
      })
      .catch((err) => console.warn("[sw] registration failed", err));
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);
  return null;
}

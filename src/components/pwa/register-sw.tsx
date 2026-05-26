"use client";

import * as React from "react";

export function RegisterSW(): null {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent("nomly:sw-update-available"));
            }
          });
        });
      })
      .catch((err) => console.warn("[sw] registration failed", err));
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

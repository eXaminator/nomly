"use client";

import * as React from "react";

function isStandalone(): boolean {
  // `display-mode: standalone` covers installed PWAs per the manifest;
  // `navigator.standalone` is the iOS-Safari equivalent.
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as { standalone?: boolean }).standalone === true)
  );
}

/**
 * Renders children only when the app runs as an installed PWA. Used for
 * settings that only make sense there (e.g. the start page — on iOS the
 * installed app has isolated storage, so configuring it from a browser tab
 * wouldn't even reach the PWA). Server-renders nothing; appears after mount.
 */
export function StandaloneOnly({ children }: { children: React.ReactNode }) {
  const [standalone, setStandalone] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(isStandalone());
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return standalone ? <>{children}</> : null;
}

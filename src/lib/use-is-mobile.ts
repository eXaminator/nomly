"use client";

import * as React from "react";

/**
 * True on viewports narrower than `breakpointPx` (default 768px, Tailwind's
 * `md`). SSR-safe: starts `false` so the server render matches a desktop
 * client's first paint, then corrects in an effect after mount — phones flip
 * to the mobile layout post-hydration without a mismatch.
 */
export function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpointPx]);
  return isMobile;
}
